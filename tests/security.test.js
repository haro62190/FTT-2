require('./setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection, PermissionsBitField, PermissionFlagsBits: P, AuditLogEvent: A, Events } = require('discord.js');
const { EventEmitter } = require('events');
const { db } = require('../src/store');

// Faux serveur minimal
function fakeGuild() {
  const roles = new Collection();
  const guild = { id: 'G', name: 'Ronins', ownerId: 'owner', roles: { cache: roles, everyone: { id: 'G' } }, channels: { cache: new Collection() }, members: { cache: new Collection() } };
  const mkRole = (id, name, perms = 0n, extra = {}) => {
    const r = { id, name, guild, editable: true, managed: false, position: 1, permissions: new PermissionsBitField(perms), setPermissions: async (b) => (r.permissions = new PermissionsBitField(b)), ...extra };
    roles.set(id, r);
    return r;
  };
  mkRole('G', '@everyone');
  const sent = [];
  const ch = (key, name) => guild.channels.cache.set(key, { id: key, name, send: async (p) => sent.push(p) });
  ch('logs', '📋┃logs');
  ch('alerts', '🚨┃alertes-sécurité');
  ch('jail', '🏚️┃cachot');
  const mkMember = (id, roleIds = []) => {
    const rc = new Collection(roleIds.map((r) => [r, roles.get(r)]));
    const m = {
      id, guild, user: { id, tag: id, bot: false, createdTimestamp: Date.now() - 400 * 86400e3, avatar: 'a' },
      permissions: new PermissionsBitField(0n), moderatable: true, voice: { disconnect: async () => {} },
      roles: { cache: rc, set: async (ids) => { rc.clear(); for (const r of ids) rc.set(r, roles.get(r)); }, add: async (r) => rc.set(r.id ?? r, roles.get(r.id ?? r)), remove: async (r) => rc.delete(r.id ?? r) },
      timeout: async (ms) => (m.timedOut = ms), send: async () => {}, toString: () => `<@${id}>`,
    };
    guild.members.cache.set(id, m);
    return m;
  };
  guild.members.fetch = async (id) => guild.members.cache.get(id) ?? null;
  return { guild, mkRole, mkMember, sent };
}

test('quarantaine : rôles mémorisés puis rendus', async () => {
  const shared = require('../src/shared');
  const { guild, mkRole, mkMember } = fakeGuild();
  mkRole('q', '⛓️ Quarantaine');
  mkRole('ronin', '⚔️ Ronin');
  mkRole('vip', '🩸 VIP');
  const origRole = shared.findRole;
  const origCh = shared.findChannel;
  shared.findRole = (g, k) => (k === 'quarantine' ? g.roles.cache.get('q') : null);
  shared.findChannel = (g, k) => g.channels.cache.get(k === 'jail' ? 'jail' : 'logs');
  delete require.cache[require.resolve('../src/quarantine')];
  const q = require('../src/quarantine');
  const m = mkMember('u1', ['ronin', 'vip']);
  await q.quarantine(m, { ms: 3600e3, reason: 'test' });
  assert.deepEqual([...m.roles.cache.keys()], ['q']);
  assert.ok(q.isQuarantined('u1'));
  await q.release(guild, 'u1');
  assert.deepEqual([...m.roles.cache.keys()].sort(), ['ronin', 'vip']);
  assert.equal(q.isQuarantined('u1'), false);
  shared.findRole = origRole;
  shared.findChannel = origCh;
});

test('anti-spam : avertissement d\'abord, mute ensuite', async () => {
  const { guild, mkMember, sent } = fakeGuild();
  const security = require('../src/security');
  const client = new EventEmitter();
  security.register(client, 'G');
  const m = mkMember('spammer');
  const channel = { id: 'c', toString: () => '#c', send: async (p) => (sent.push(p), { delete: async () => {} }) };
  guild.channels.cache.set('c', channel);
  channel.bulkDelete = async () => {};
  const msg = (n) => ({ id: `m${n}`, guild, member: m, author: m.user, channel, channelId: 'c', content: `message différent ${n}`, delete: async () => {}, mentions: { users: new Collection(), roles: new Collection(), everyone: false, repliedUser: null } });
  for (let n = 0; n < 6; n++) client.emit(Events.MessageCreate, msg(n));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(m.timedOut, undefined, '1re fois : pas de mute');
  assert.ok(sent.some((p) => String(p.content ?? '').includes('attention')));
  for (let n = 10; n < 16; n++) client.emit(Events.MessageCreate, msg(n));
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(m.timedOut > 0, '2e fois : mute');
});

test('anti-nuke : permissions dangereuses ajoutées à un rôle = annulées', async () => {
  const { guild, mkRole } = fakeGuild();
  guild.client = { user: { id: 'bot' } };
  const r = mkRole('r', 'Rôle piégé', P.Administrator);
  const security = require('../src/security');
  const client = new EventEmitter();
  security.register(client, 'G');
  client.emit(Events.GuildAuditLogEntryCreate, { action: A.RoleUpdate, executorId: 'intrus', targetId: 'r', changes: [{ key: 'permissions', old: '0', new: String(P.Administrator) }] }, guild);
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(r.permissions.has(P.Administrator), false);
});

test('permissions minimales : on ne retire jamais ce que le bot ne contrôle pas', () => {
  const { grantable, missing } = require('../src/permissions');
  const guild = { members: { me: { permissions: new PermissionsBitField([P.KickMembers, P.ManageMessages]) } } };
  const { bits, dropped } = grantable(guild, [P.KickMembers, P.BanMembers], P.Administrator);
  assert.ok((bits & P.KickMembers) === P.KickMembers, 'donne ce qu\'il a');
  assert.ok((bits & P.Administrator) === P.Administrator, 'garde Administrateur déjà présent');
  assert.deepEqual(dropped, ['BanMembers']);
  assert.ok(missing(guild).includes('ManageRoles'));
  assert.deepEqual(missing({ members: { me: { permissions: new PermissionsBitField(P.Administrator) } } }), []);
});

test('secrets masqués dans les journaux', () => {
  // Faux tokens fabriqués à l'exécution (jamais écrits en entier dans le dépôt, sinon GitHub bloque l'envoi)
  const fake = (mid) => [Buffer.from('123456789012345678').toString('base64').replace(/=+$/, ''), mid, 'x'.repeat(10) + 'FAUX' + 'y'.repeat(24)].join('.');
  process.env.DISCORD_TOKEN = fake('GaBcDe');
  const { redact } = require('../src/redact');
  assert.doesNotMatch(redact(`erreur avec ${process.env.DISCORD_TOKEN}`), /GaBcDe/);
  assert.doesNotMatch(redact(`autre : ${fake('XyZ123')}`), /XyZ123/);
});

test('toutes les commandes du staff exigent une permission Discord', () => {
  const { commands } = require('../src/commands');
  const free = commands.filter((c) => c.staff && !c.data.toJSON().default_member_permissions).map((c) => c.data.name);
  assert.deepEqual(free, []);
  const ban = commands.find((c) => c.data.name === 'ban').data.toJSON();
  assert.equal(BigInt(ban.default_member_permissions), P.BanMembers);
});
