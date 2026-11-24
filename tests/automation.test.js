require('./setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection, ChannelType } = require('discord.js');
const { db } = require('../src/store');

test('assistant IA : contexte stable (cache), sans infos du staff, limites, requête et refus', async () => {
  const a = require('../src/assistant');
  const p1 = a.systemPrompt({ name: 'Les Ronins' });
  assert.equal(p1, a.systemPrompt({ name: 'Les Ronins' }), 'identique à chaque appel (sinon pas de cache)');
  assert.ok(p1.includes('/quetes') || p1.includes('/rang'), 'contient le guide des commandes');
  assert.ok(!p1.includes('🛡️┃staff') && !p1.includes('📋┃logs'), 'pas de salons du staff');
  for (let k = 0; k < 5; k++) assert.equal(a.checkLimits('lim'), null);
  assert.match(a.checkLimits('lim'), /10 minutes/);
  let sent = null;
  a._setClient({
    beta: {
      messages: {
        create: async (req) => {
          sent = req;
          return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Tape /quetes @everyone' }], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2000 } };
        },
      },
    },
  });
  const answer = await a.ask({ name: 'Les Ronins' }, 'Comment voir mes quêtes ?', 'haro');
  assert.equal(sent.model, 'claude-opus-5-5');
  assert.equal(sent.system[0].cache_control.type, 'ephemeral');
  assert.equal(sent.fallbacks, 'default');
  assert.ok(!answer.includes('@everyone'), 'mention neutralisée');
  const day = Object.keys(db.assistantUsage)[0];
  assert.equal(db.assistantUsage[day].cacheRead, 2000);
  a._setClient({ beta: { messages: { create: async () => ({ stop_reason: 'refusal', content: [], usage: {} }) } } });
  assert.match(await a.ask({ name: 'x' }, '?', 'x'), /ticket/);
  a._setClient({ beta: { messages: { create: async () => { throw new Error('réseau'); } } } });
  assert.match(await a.ask({ name: 'x' }, '?', 'x'), /ne répond pas/);
});

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
