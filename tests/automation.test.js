require('./setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection, ChannelType } = require('discord.js');
const { db } = require('../src/store');

test('activité : salons inutilisés, meilleurs créneaux, suggestions', () => {
  const ins = require('../src/insights');
  db.trackingSince = Date.now() - 40 * 86_400_000;
  const mk = (id, name, type = ChannelType.GuildText) => [id, { id, name, type }];
  const guild = { channels: { cache: new Collection([mk('g', '🍜┃discussion'), mk('m', '👾┃memes'), mk('a', '📡┃annonces'), mk('v', '🌃 Shibuya', ChannelType.GuildVoice)]) } };
  ins.track('g');
  db.channelActivity.m = Date.now() - 45 * 86_400_000;
  const u = ins.unusedChannels(guild);
  assert.ok(u.ready);
  assert.deepEqual(u.list.map((c) => c.id).sort(), ['m', 'v'], 'annonces (lecture seule) ignoré, discussion actif');
  db.activityHeat = Array(168).fill(0);
  db.activityHeat[4 * 24 + 21] = 50; // jeudi 21 h
  db.activityHeat[6 * 24 + 3] = 99; // samedi 3 h du matin : ignoré
  assert.deepEqual(ins.bestSlots(1)[0], { dow: 4, hour: 21, v: 50 });
  db.players = { p: { games: ['Warzone'] }, q: { games: ['warzone', 'Valorant'] } };
  assert.equal(ins.topGames(1)[0].name, 'Warzone');
  assert.match(ins.suggestions()[0], /Warzone.*jeudi à 21 h/);
});

test('signalements : suivi, MP à chaque étape, staff seulement', async () => {
  const rp = require('../src/reports');
  const r = rp.create({ reporter: 'rep', target: 'bad', reason: 'insultes' });
  assert.equal(rp.pendingCount(), 1);
  const dms = [];
  const guild = { channels: { cache: new Collection() }, client: { users: { send: async (id, t) => dms.push([id, t]) } } };
  await rp.update(guild, r, 'claimed', 'mod');
  await rp.update(guild, r, 'resolved', 'mod', 'averti');
  assert.equal(r.history.length, 3);
  assert.deepEqual(dms.map((d) => d[0]), ['rep', 'rep']);
  assert.match(dms[1][1], /traité/);
  assert.equal(rp.pendingCount(), 0);
  assert.equal(rp.card(r).components.length, 0, 'plus de boutons une fois résolu');
});
