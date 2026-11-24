require('./setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');
const { db } = require('../src/store');
const config = require('../config/server');

const chanName = (key) => config.categories.flatMap((c) => c.channels).find((c) => c.key === key).name;

function fakeChannel(id, name) {
  const sent = [];
  const messages = new Map();
  const ch = {
    id,
    name,
    sent,
    async send(payload) {
      const msg = { id: `m${sent.length + 1}`, payload, edits: [], async edit(p) { this.edits.push(p); } };
      sent.push(msg);
      messages.set(msg.id, msg);
      return msg;
    },
    messages: { fetch: async (mid) => messages.get(mid) ?? null },
  };
  return ch;
}

test('paliers : calcul et annonce une seule fois', async () => {
  const streams = require('../src/streams');
  assert.equal(streams.milestoneOf(9), 0);
  assert.equal(streams.milestoneOf(99), 50);
  assert.equal(streams.milestoneOf(1000), 1000);
  assert.equal(streams.milestoneOf(123456), 100000);
  const ann = fakeChannel('a1', chanName('announcements'));
  const guild = { channels: { cache: new Collection([[ann.id, ann]]) }, roles: { cache: new Collection() } };
  await streams.checkMilestones(guild, { twitch: 480 });
  assert.equal(ann.sent.length, 0, 'premier passage : mémorisé sans annonce');
  await streams.checkMilestones(guild, { twitch: 505 });
  assert.equal(ann.sent.length, 1);
  assert.match(ann.sent[0].payload.embeds[0].data.title, /500/);
  await streams.checkMilestones(guild, { twitch: 520 });
  assert.equal(ann.sent.length, 1, 'pas de double annonce');
});

test('historique et résumé des lives', () => {
  const streams = require('../src/streams');
  db.streams = [];
  const now = Date.now();
  streams.record({ platform: 'twitch', title: 'A', games: ['Valorant'], startedAt: now - 3 * 3600_000, endedAt: now - 3600_000, peak: 40, avg: 20, followersGained: 5 });
  streams.record({ platform: 'tiktok', title: 'B', games: [], startedAt: now - 1800_000, endedAt: now, peak: 10, avg: null });
  const s = streams.summary(30);
  assert.equal(s.count, 2);
  assert.equal(s.hours, 2.5);
  assert.equal(s.avg, 20);
  assert.equal(s.peak, 40);
  assert.equal(s.followers, 5);
  assert.deepEqual(s.games, [['Valorant', 1]]);
  assert.equal(streams.list()[0].durationMin, 30);
});

test('live Twitch : annonce, mise à jour, récap et historique', async () => {
  const settings = require('../src/settings');
  settings.set('stream.twitchChannel', 'haro62190');
  const tl = require('../src/twitchlive');
  const live = fakeChannel('l1', chanName('live'));
  const guild = { channels: { cache: new Collection([[live.id, live]]) }, roles: { cache: new Collection() } };
  let stream = {
    id: 's1', user_login: 'haro62190', user_name: 'Haro62190', title: 'Ranked', game_name: 'Valorant',
    viewer_count: 10, started_at: new Date(Date.now() - 2 * 3600_000).toISOString(), thumbnail_url: 'https://x/{width}x{height}.jpg',
  };
  let followers = 100;
  tl._setClient({
    getLiveStream: async () => stream,
    getUser: async () => ({ id: 'u1', login: 'haro62190', display_name: 'Haro62190', profile_image_url: 'https://x/p.png' }),
    getFollowerCount: async () => followers,
    getLatestVod: async () => ({ url: 'https://twitch.tv/videos/1' }),
  });
  db.streams = [];
  await tl.checkLive(guild);
  assert.equal(live.sent.length, 1);
  assert.equal(live.sent[0].payload.components[0].components[0].data.url, 'https://twitch.tv/haro62190');

  stream = { ...stream, viewer_count: 30, game_name: 'Just Chatting' };
  require('../src/streams').onMessage('fan1');
  await tl.checkLive(guild);
  assert.equal(db.twitchLive.peak, 30);
  assert.deepEqual(db.twitchLive.games, ['Valorant', 'Just Chatting']);
  assert.equal(live.sent[0].edits.length, 1, 'changement de jeu : annonce mise à jour');

  stream = null;
  followers = 112;
  await tl.checkLive(guild);
  assert.equal(db.twitchLive, null);
  const h = db.streams[0];
  assert.equal(h.platform, 'twitch');
  assert.equal(h.peak, 30);
  assert.equal(h.avg, 20);
  assert.equal(h.followersGained, 12);
  assert.equal(h.vod, 'https://twitch.tv/videos/1');
  assert.deepEqual(h.topChatters, ['fan1']);
  assert.ok(h.durationMin >= 119);
  const recap = live.sent[0].edits.at(-1);
  assert.match(recap.content, /terminé/);
  assert.equal(recap.components[0].components[0].data.label, 'Revoir le live');
  assert.equal(require('../src/memberstats').board('lives')[0].userId, 'fan1');
});
