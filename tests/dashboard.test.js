require('./setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { Collection, ChannelType, PermissionsBitField } = require('discord.js');

// Accès aux pages internes du tableau de bord
const file = path.join(__dirname, '..', 'src', 'dashboard.js');
const m = new Module(file, module);
m.filename = file;
m.paths = Module._nodeModulePaths(path.dirname(file));
m._compile(fs.readFileSync(file, 'utf8') + '\nmodule.exports.__t = { pages, page, NAV };', file);
const { pages, page, NAV } = m.exports.__t;

function fakeGuild() {
  const perms = new PermissionsBitField(PermissionsBitField.Flags.Administrator);
  const role = { id: 'r1', name: '⚔️ Ronin <script>', managed: false, editable: true, position: 2, permissions: new PermissionsBitField(0n) };
  const text = { id: 'c1', name: '📡┃annonces', type: ChannelType.GuildText, rawPosition: 1, isTextBased: () => true, isVoiceBased: () => false, members: new Collection() };
  const client = { user: { id: 'bot', username: 'Kensei' }, ws: { ping: 42 }, isReady: () => true, users: { fetch: async () => null } };
  const guild = {
    id: 'G', name: 'Les Ronins', memberCount: 128, ownerId: 'owner', client,
    members: { me: { nickname: '剣聖 ・ Kensei', permissions: perms, roles: { highest: { name: 'Kensei', position: 50 } } }, cache: new Collection(), fetch: async () => new Collection() },
    channels: { cache: new Collection([['c1', text]]), fetch: async () => {} },
    emojis: { cache: new Collection([['e1', { id: 'e1', name: '<katana>', animated: false }]]), fetch: async () => {} },
    roles: { cache: new Collection([['G', { id: 'G', name: '@everyone' }], ['r1', role]]), fetch: async () => {} },
    scheduledEvents: { fetch: async () => new Collection() },
    autoModerationRules: { fetch: async () => new Collection() },
  };
  for (const r of guild.roles.cache.values()) r.guild = guild;
  return guild;
}

test('chaque page du menu s\'affiche sans erreur et échappe le contenu', async () => {
  const guild = fakeGuild();
  const sess = { userId: 'owner', username: 'haro', csrf: 'tok' };
  const paths = NAV.filter(([h]) => h !== '#').map(([h]) => h);
  assert.ok(paths.length >= 30, `${paths.length} pages`);
  for (const p of paths) {
    assert.ok(pages[p], `page manquante : ${p}`);
    const r = await pages[p](guild, sess, new URLSearchParams());
    const html = page(sess, p, r.title, r.body, '', r.refresh);
    assert.ok(html.includes('<main>'), p);
    assert.doesNotMatch(r.body, /<script>/, `${p} : contenu non échappé`);
  }
});

test('modules : tous les interrupteurs s\'enregistrent', async () => {
  const settings = require('../src/settings');
  const msg = await pages['POST /modules'](fakeGuild(), { username: 'haro' }, new URLSearchParams('m_tickets=on&m_music=on'));
  assert.ok(msg.includes('⛔'));
  assert.equal(settings.on('tickets'), true);
  assert.equal(settings.on('giveaways'), false);
});

test('éditeur de messages : embed, boutons https seulement, aucune mention', async () => {
  const guild = fakeGuild();
  const sent = [];
  guild.channels.cache.get('c1').send = async (p) => sent.push(p);
  const body = new URLSearchParams({ channel: 'c1', content: '@everyone salut', title: 'Titre', description: 'Texte', color: '#ff0000', buttons: 'Site | https://exemple.fr\nPiège | javascript:alert(1)', image: 'http://pas-https.fr/x.png' });
  const msg = await pages['POST /editeur'](guild, { username: 'haro' }, body);
  assert.match(msg, /envoyé/);
  assert.equal(sent[0].embeds[0].data.title, 'Titre');
  assert.equal(sent[0].embeds[0].data.color, 0xff0000);
  assert.equal(sent[0].embeds[0].data.image, undefined, 'image non https ignorée');
  assert.equal(sent[0].components[0].components.length, 1, 'bouton javascript: refusé');
  assert.deepEqual(sent[0].allowedMentions, { parse: [] });
  assert.match(await pages['POST /editeur'](guild, { username: 'haro' }, new URLSearchParams({ channel: 'c1' })), /vide/);
});

test('centre d\'alertes : traiter un signalement depuis le site', async () => {
  const rp = require('../src/reports');
  const r = rp.create({ reporter: 'r1', target: 't1', reason: 'spam' });
  const guild = fakeGuild();
  guild.client.users = { send: async () => {}, fetch: async () => null };
  const msg = await pages['POST /alertes'](guild, { userId: 'staff', username: 'haro' }, new URLSearchParams({ action: 'report', id: String(r.id), status: 'resolved' }));
  assert.match(msg, /Résolu/);
  assert.equal(r.status, 'resolved');
});
