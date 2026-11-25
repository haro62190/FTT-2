require('./setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../src/store');

test('vitrine : domaine public reconnu (avec www et port), autres refusés', () => {
  process.env.PUBLIC_HOST = 'haro62190.tech';
  const v = require('../src/vitrine');
  assert.ok(v.isPublicHost('haro62190.tech'));
  assert.ok(v.isPublicHost('WWW.haro62190.tech:443'));
  assert.ok(!v.isPublicHost('bot.haro62190.tech'));
  assert.ok(!v.isPublicHost('evil.example'));
});

test('vitrine : page complète, contenu échappé, lecteur Twitch pendant le live', async () => {
  process.env.PUBLIC_HOST = 'haro62190.tech';
  process.env.TWITCH_CHANNEL = 'haro62190';
  const settings = require('../src/settings');
  settings.set('vitrine.invite', 'https://discord.gg/ronins');
  settings.set('vitrine.about', '<script>alert(1)</script>');
  db.twitchLive = { title: 'Soirée <b>Warzone</b>', peak: 12 };
  db.twitchSchedule = { events: {}, upcoming: [{ start: Date.now() + 86_400_000, title: 'Ranked', game: 'Warzone' }] };
  db.clipsGallery = { a: { id: 'a', url: 'https://clips.twitch.tv/a', title: 'Clip', creator: 'x', views: 5, thumb: 'javascript:alert(1)', createdAt: Date.now() } };
  const html = await require('../src/vitrine').render({ name: 'Les Ronins', memberCount: 42 }, 'haro62190.tech');
  assert.ok(html.includes('https://discord.gg/ronins'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;b&gt;Warzone'));
  assert.ok(html.includes('player.twitch.tv/?channel=haro62190&parent=haro62190.tech'));
  assert.ok(html.includes('Ranked'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(html.includes('>42<'));
  db.twitchLive = null;
});

test('émojis : format vérifié par le contenu, taille, nom, places restantes', async () => {
  const { Collection } = require('discord.js');
  const em = require('../src/emojis');
  const created = [];
  const cache = new Collection();
  const guild = {
    premiumTier: 0,
    emojis: { cache, fetch: async () => cache, create: async ({ name, attachment }) => (created.push({ name, size: attachment.length }), { name, id: '9' }) },
  };
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
  const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40)]);
  assert.equal(em.sniff(png), 'image/png');
  assert.equal(em.sniff(gif), 'image/gif');
  assert.equal(em.sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">')), null);
  assert.equal(em.nameFrom('Mon Logo!.gif'), 'Mon_Logo');
  await em.add(guild, { name: 'katana', data: png });
  await assert.rejects(em.add(guild, { name: 'a b', data: png }), /Nom invalide/);
  await assert.rejects(em.add(guild, { name: 'faux', data: Buffer.from('pas une image du tout') }), /Format refusé/);
  await assert.rejects(em.add(guild, { name: 'gros', data: Buffer.concat([png, Buffer.alloc(300 * 1024)]) }), /trop lourde/);
  cache.set('1', { id: '1', name: 'katana', animated: false });
  await assert.rejects(em.add(guild, { name: 'katana', data: png }), /existe déjà/);
  for (let k = 0; k < 50; k++) cache.set(`a${k}`, { id: `a${k}`, name: `anim${k}`, animated: true });
  await assert.rejects(em.add(guild, { name: 'danse', data: gif }), /Plus de place pour les émojis animés/);
  assert.deepEqual(created.map((c) => c.name), ['katana']);
});

test('youtube : formats de chaîne acceptés', () => {
  const { normalize } = require('../src/youtube');
  assert.deepEqual(normalize('@haro62190'), { handle: 'haro62190' });
  assert.deepEqual(normalize('https://www.youtube.com/@haro62190/videos'), { handle: 'haro62190' });
  assert.deepEqual(normalize('https://youtube.com/channel/UCabcdefghijklmnopqrstuv'), { id: 'UCabcdefghijklmnopqrstuv' });
  assert.equal(normalize('<script>'), null);
});

test('youtube : flux lu, Shorts reconnus, rien annoncé au 1er passage puis seulement le nouveau', async () => {
  const yt = require('../src/youtube');
  const settings = require('../src/settings');
  const entry = (id, title, short, ageH) =>
    `<entry><yt:videoId>${id}</yt:videoId><title>${title}</title><link rel="alternate" href="https://www.youtube.com/${short ? `shorts/${id}` : `watch?v=${id}`}"/><published>${new Date(Date.now() - ageH * 3600_000).toISOString()}</published></entry>`;
  let feed = `<feed><author><name>Haro &amp; co</name></author>${entry('old11111111', 'Ancienne', false, 100)}</feed>`;
  const realFetch = global.fetch;
  global.fetch = async () => ({ ok: true, text: async () => feed });
  settings.set('stream.youtubeChannel', 'UCabcdefghijklmnopqrstuv');
  db.youtube = undefined;
  const sent = [];
  const channel = { name: '▶️┃youtube', send: async (m) => sent.push(m) };
  const guild = { channels: { cache: { find: (f) => [channel].find(f), get: () => undefined } }, roles: { cache: { find: () => undefined } } };
  try {
    assert.equal(yt.parseFeed(feed)[0].author, 'Haro & co');
    await yt.check(guild); // 1er passage : mémorise sans annoncer
    assert.equal(sent.length, 0);
    feed = `<feed>${entry('new22222222', 'Clip &lt;fou&gt;', true, 1)}${entry('old11111111', 'Ancienne', false, 100)}</feed>`;
    await yt.check(guild);
    assert.equal(sent.length, 1);
    assert.match(sent[0].content, /Nouveau Short/);
    assert.equal(sent[0].embeds[0].data.title, 'Clip <fou>');
    assert.equal(sent[0].embeds[0].data.url, 'https://www.youtube.com/shorts/new22222222');
    await yt.check(guild); // déjà vue : pas de doublon
    assert.equal(sent.length, 1);
  } finally {
    global.fetch = realFetch;
    settings.set('stream.youtubeChannel', '');
  }
});

test('compteur YouTube : textes d’abonnés lus (anglais, français, arrondis)', () => {
  const { parseSubs } = require('../src/stats');
  assert.equal(parseSubs('1.23K'), 1230);
  assert.equal(parseSubs('12,3 k abonnés'), 12300);
  assert.equal(parseSubs('1 234 abonnés'), 1234);
  assert.equal(parseSubs('1,234 subscribers'), 1234);
  assert.equal(parseSubs('2.5M subscribers'), 2_500_000);
  assert.equal(parseSubs('aucun'), null);
});
