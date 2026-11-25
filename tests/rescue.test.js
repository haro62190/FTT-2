require('./setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection, ChannelType, PermissionsBitField, PermissionFlagsBits: P } = require('discord.js');
const { db } = require('../src/store');

// ── Faux serveur Discord, assez complet pour une copie et une restauration ──
let nextId = 1000;
function makeGuild({ id, name, ownerId = 'owner', admin = true } = {}) {
  const g = { id, name, ownerId, memberCount: 3 };
  const roles = new Collection();
  const everyone = { id, name: '@everyone', position: 0, managed: false, editable: false, permissions: new PermissionsBitField(0n), setPermissions: async (p) => (everyone.permissions = new PermissionsBitField(p)) };
  roles.set(id, everyone);
  const mkRole = (data) => {
    const r = { id: String(nextId++), name: data.name, color: data.color ?? 0, hoist: !!data.hoist, mentionable: false, managed: false, editable: true, position: roles.size, permissions: new PermissionsBitField(data.permissions ?? 0n), guild: g };
    r.edit = async (f) => Object.assign(r, { ...f, permissions: new PermissionsBitField(f.permissions ?? r.permissions.bitfield) });
    roles.set(r.id, r);
    return r;
  };
  const channels = new Collection();
  const sent = [];
  const mkChannel = (data) => {
    const msgs = new Collection();
    const c = {
      id: String(nextId++), name: data.name, type: data.type, parentId: data.parent ?? null, rawPosition: channels.size, topic: data.topic ?? null, nsfw: false, userLimit: 0, rateLimitPerUser: 0, viewable: true, guild: g,
      isThread: () => false, isTextBased: () => data.type !== ChannelType.GuildVoice && data.type !== ChannelType.GuildCategory, isVoiceBased: () => data.type === ChannelType.GuildVoice,
      permissionOverwrites: { cache: new Collection(), set: async () => {} },
      setParent: async (p) => (c.parentId = p),
      messages: { fetch: async (q) => (typeof q === 'object' ? msgs : msgs.get(q) ?? null) },
      send: async (p) => { const m = { id: String(nextId++), ...p, author: { id: 'bot' }, edit: async () => {} }; sent.push([c.name, p]); msgs.set(m.id, m); return m; },
      createInvite: async () => ({ url: `https://discord.gg/secours${c.id}` }),
      _msgs: msgs,
    };
    channels.set(c.id, c);
    return c;
  };
  Object.assign(g, {
    roles: { cache: roles, everyone, fetch: async () => roles, create: async (d) => mkRole(d), setPositions: async (list) => list.forEach(({ role, position }) => (role.position = position)) },
    channels: { cache: channels, fetch: async () => channels, create: async (d) => mkChannel({ ...d, parent: d.parent }) },
    emojis: { cache: new Collection(), fetch: async () => {}, create: async (e) => { g.emojis.cache.set(String(nextId++), { name: e.name }); } },
    members: { me: { permissions: new PermissionsBitField(admin ? P.Administrator : 0n) }, cache: new Collection(), fetch: async () => g.members.cache },
    client: { user: { id: 'bot' } },
    edit: async (f) => Object.assign(g, f.name ? { name: f.name } : {}),
    setIcon: async () => {}, setBanner: async () => {},
    features: [], verificationLevel: 1, explicitContentFilter: 2, defaultMessageNotifications: 1, afkTimeout: 300, afkChannelId: null, systemChannelId: null,
    iconURL: () => null,
  });
  g._mkRole = mkRole;
  g._mkChannel = mkChannel;
  g._sent = sent;
  return g;
}

function mainServer() {
  const g = makeGuild({ id: 'MAIN', name: 'Les Ronins de haro62190' });
  const mod = g._mkRole({ name: '🛡️ Modérateur', color: 0xb30000, permissions: P.KickMembers });
  const ronin = g._mkRole({ name: '⚔️ Ronin', color: 0x5c5c5c });
  const chef = g._mkRole({ name: '👑 Chef', permissions: P.Administrator });
  const cat = g._mkChannel({ name: '🏯 道場 ・ LE DOJO', type: ChannelType.GuildCategory });
  const general = g._mkChannel({ name: '🍜┃discussion', type: ChannelType.GuildText, parent: cat.id, topic: 'Discussion' });
  g._mkChannel({ name: '🌃 Shibuya', type: ChannelType.GuildVoice, parent: cat.id });
  for (let k = 0; k < 3; k++) general._msgs.set(`m${k}`, { id: `m${k}`, author: { id: `u${k}`, username: `user${k}`, displayAvatarURL: () => 'https://cdn.discordapp.com/a.png' }, member: { displayName: `Membre ${k}` }, content: `Bonjour ${k} @everyone`, createdTimestamp: 1000 + k, attachments: new Collection(), embeds: [], pinned: k === 0 });
  const mem = (id, rs) => ({ id, user: { bot: false }, roles: { cache: new Collection(rs.map((r) => [r.id, r])) } });
  g.members.cache.set('alice', mem('alice', [ronin, mod]));
  g.members.cache.set('boss', mem('boss', [chef, ronin]));
  return g;
}

test('copie de secours : structure, rôles des membres, messages', async () => {
  const rescue = require('../src/rescue');
  const g = mainServer();
  const r = await rescue.capture(g, { force: true });
  assert.equal(r.members, 2);
  assert.equal(r.messages, 3);
  assert.deepEqual(db.rescue.members.alice.sort(), ['⚔️ Ronin', '🛡️ Modérateur'].sort());
  assert.equal(db.rescue.messages['🍜┃discussion'][0].content, 'Bonjour 0 @everyone');
  assert.equal(db.rescue.ownerId, 'owner');
});

test('copie de secours : jamais écrasée par un serveur qui vient d\'être vidé', async () => {
  const rescue = require('../src/rescue');
  const before = db.rescue.at;
  const nuked = makeGuild({ id: 'MAIN', name: 'pwned' });
  assert.equal(rescue.looksNuked(nuked, db.rescue), true);
  const r = await rescue.capture(nuked);
  assert.equal(r.skipped, true);
  assert.equal(db.rescue.at, before, 'ancienne copie gardée');
  assert.equal(db.rescue.guildName, 'Les Ronins de haro62190');
});

test('restauration sur le serveur de secours, puis rôles rendus aux membres (sauf Administrateur)', async () => {
  const rescue = require('../src/rescue');
  const target = makeGuild({ id: 'SECOURS', name: 'vide' });
  await assert.rejects(() => rescue.restoreTo(makeGuild({ id: 'X', name: 'x', admin: false })), /Permissions manquantes/);
  const lines = [];
  const res = await rescue.restoreTo(target, { log: (l) => lines.push(l) });
  const names = [...target.roles.cache.values()].map((r) => r.name);
  for (const n of ['🛡️ Modérateur', '⚔️ Ronin', '👑 Chef']) assert.ok(names.includes(n), n);
  const chans = [...target.channels.cache.values()].map((c) => c.name);
  for (const n of ['🏯 道場 ・ LE DOJO', '🍜┃discussion', '🌃 Shibuya']) assert.ok(chans.includes(n), n);
  assert.equal(target.channels.cache.find((c) => c.name === '🍜┃discussion').parentId, target.channels.cache.find((c) => c.name === '🏯 道場 ・ LE DOJO').id, 'salon rangé dans sa catégorie');
  const archived = target._sent.filter(([ch, p]) => ch === '🍜┃discussion' && p.embeds?.length);
  assert.equal(archived[0][1].embeds.length, 3, 'les 3 messages recopiés');
  assert.deepEqual(archived[0][1].allowedMentions, { parse: [] }, 'aucune mention réveillée');
  assert.equal(target.name, 'Les Ronins de haro62190');
  assert.ok(res.invite.startsWith('https://discord.gg/'));
  const ordered = [...target.roles.cache.values()].filter((r) => r.editable).sort((a, b) => a.position - b.position).map((r) => r.name);
  assert.deepEqual(ordered, ['🛡️ Modérateur', '⚔️ Ronin', '👑 Chef'], 'ordre des rôles d\'origine');
  // Arrivée des membres
  const added = [];
  const join = (id) => ({ id, guild: target, roles: { add: async (ids) => added.push([id, ids.map((x) => target.roles.cache.get(x).name)]) } });
  assert.deepEqual((await rescue.onMemberJoin(join('alice'))).sort(), ['⚔️ Ronin', '🛡️ Modérateur'].sort());
  assert.deepEqual(await rescue.onMemberJoin(join('boss')), ['⚔️ Ronin'], 'pas de rôle Administrateur redonné');
  assert.deepEqual(await rescue.onMemberJoin({ ...join('alice'), guild: makeGuild({ id: 'AUTRE', name: 'x' }) }), [], 'seulement sur le serveur de secours');
});

test('serveur de secours : réservé au propriétaire', () => {
  const rescue = require('../src/rescue');
  assert.equal(rescue.isOwner('owner', null), true);
  assert.equal(rescue.isOwner('pirate', { ownerId: 'pirate2' }), false);
});
