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
