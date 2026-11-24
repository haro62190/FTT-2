require('./setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../src/store');
const { Collection } = require('discord.js');
const C = (entries) => new Collection(entries);

const fakeRole = (id, extra = {}) => ({ id, name: id, editable: true, members: new Map(), ...extra });
function fakeMember(id, roleIds = [], extra = {}) {
  const has = new Set(roleIds);
  const member = {
    id,
    premiumSince: null,
    roles: { cache: { has: (r) => has.has(r) }, add: async (r) => has.add(r.id ?? r), remove: async (r) => has.delete(r.id ?? r) },
    ...extra,
  };
  return member;
}

test('quêtes : tirage stable, progression et récompense en ryō', () => {
  const quests = require('../src/quests');
  const a = quests.userState('q1');
  const b = quests.userState('q1');
  assert.equal(a.daily.length, 3);
  assert.equal(a.weekly.length, 3);
  assert.deepEqual(a.daily.map((q) => q.id), b.daily.map((q) => q.id), 'mêmes quêtes pendant la journée');
  // Forcer une quête connue pour tester la récompense
  a.daily = [{ id: 'react5', n: 0, done: false }];
  a.weekly = [];
  const before = db.economy?.q1?.bal ?? 0;
  for (let i = 0; i < 4; i++) quests.progress('q1', 'reactions');
  assert.equal(a.daily[0].done, false);
  quests.progress('q1', 'reactions');
  assert.equal(a.daily[0].done, true);
  assert.equal(db.economy.q1.bal - before, 40);
  quests.progress('q1', 'reactions');
  assert.equal(db.economy.q1.bal - before, 40, 'pas de double récompense');
  assert.equal(a.completed, 1);
});

test('quêtes : module coupé = aucune progression', () => {
  const settings = require('../src/settings');
  const quests = require('../src/quests');
  const s = quests.userState('q2');
  s.daily = [{ id: 'daily', n: 0, done: false }];
  settings.set('modules.quests', false);
  quests.progress('q2', 'daily');
  assert.equal(s.daily[0].n, 0);
  settings.set('modules.quests', true);
  quests.progress('q2', 'daily');
  assert.equal(s.daily[0].done, true);
});

test('niveaux : messages trop courts et salon des commandes sans XP', () => {
  const levels = require('../src/levels');
  assert.equal(levels.counts({ content: 'ok' }), false);
  assert.equal(levels.counts({ content: 'ok', attachments: 1 }), true, 'une image compte');
  assert.equal(levels.counts({ content: 'salut tout le monde' }), true);
  const guild = { channels: { cache: C([['c1', { id: 'c1', name: '🤖┃commandes' }]]) } };
  require('../src/settings').set('levels.noXpChannels', ['c9']);
  assert.equal(levels.counts({ content: 'bonjour à tous', channelId: 'c9', guild }), false);
});

test('boost : multiplicateurs d\'événement et de rôle', async () => {
  const boost = require('../src/boost');
  assert.equal(boost.multiplier(null, 'xp'), 1);
  const guild = { channels: { cache: C([]) }, roles: { cache: C([['vipId', { id: 'vipId', name: '🩸 VIP' }]]) } };
  const vip = fakeMember('v1', ['vipId'], { guild });
  assert.equal(boost.multiplier(vip, 'xp'), 1.25);
  await boost.startBoost(guild, { xp: 2, ryo: 3, hours: 1 });
  assert.equal(boost.multiplier(null, 'xp'), 2);
  assert.equal(boost.multiplier(null, 'ryo'), 3);
  assert.equal(boost.multiplier(vip, 'xp'), 2.5);
  db.boost.until = Date.now() - 1;
  assert.equal(boost.multiplier(null, 'xp'), 1, 'boost expiré');
  boost.stopBoost();
});

test('grades : prime de ryō une seule fois, bonus /daily', async () => {
  const levels = require('../src/levels');
  const ashigaru = fakeRole('ashId', { name: '🗡️ Ashigaru' });
  const guild = { channels: { cache: C([]) }, roles: { cache: C([['ashId', ashigaru]]) } };
  const m = fakeMember('g1', [], { guild });
  const got = await levels.applyRewards(m, 5);
  assert.equal(got.length, 1);
  assert.equal(got[0].bonus, 500);
  assert.equal(db.economy.g1.bal, 500);
  await m.roles.remove(ashigaru);
  await levels.applyRewards(m, 5);
  assert.equal(db.economy.g1.bal, 500, 'pas de deuxième prime');
  assert.equal(levels.gradeDailyBonus(m), 10);
});

test('semaine : pilier, classement et remise à zéro', async () => {
  const seasons = require('../src/seasons');
  seasons.add('w1', 300);
  seasons.add('w2', 500);
  assert.equal(seasons.weekRankOf('w2'), 1);
  assert.equal(seasons.weekRankOf('w1'), 2);
  const pillar = fakeRole('pilId', { name: '🔥 Pilier de la semaine' });
  const w2 = fakeMember('w2');
  const guild = {
    channels: { cache: C([]) },
    roles: { cache: C([['pilId', pillar]]) },
    members: { fetch: async () => w2 },
  };
  const before = db.economy?.w2?.bal ?? 0;
  await seasons.closeWeek(guild);
  assert.equal(db.economy.w2.bal - before, 750);
  assert.deepEqual(db.week.xp, {});
  assert.equal(db.weeksHistory[0].top[0].userId, 'w2');
  assert.equal(require('../src/memberstats').full('w2').pillarWins, 1);
});

test('/top et statistiques individuelles', () => {
  const stats = require('../src/memberstats');
  db.levels.s1 = { xp: 5000, messages: 40, voiceMinutes: 130 };
  db.levels.s2 = { xp: 100, messages: 90, voiceMinutes: 10 };
  assert.equal(stats.board('messages')[0].userId, 's2');
  assert.equal(stats.board('vocal')[0].label, '2 h 10 min');
  stats.bump('s1', 'duels', 3);
  stats.bump('s1', 'duelsWon', 2);
  const f = stats.full('s1');
  assert.equal(f.duelsWon, 2);
  assert.equal(f.messages, 40);
  assert.ok(f.level > 0);
});
