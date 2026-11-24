require('./setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');
const { db } = require('../src/store');

const guild = { id: 'G', channels: { cache: new Collection() }, roles: { cache: new Collection() }, members: { me: { permissions: { has: () => false } } }, scheduledEvents: { fetch: async () => new Collection() } };

test('profils joueurs et recherche par jeu / plateforme / dispo', () => {
  const g = require('../src/gaming');
  Object.assign(g.profile('p1'), { platforms: ['pc', 'ps'], availability: ['soir'], games: ['Warzone', 'Valorant'] });
  Object.assign(g.profile('p2'), { platforms: ['xbox'], availability: ['weekend'], games: ['warzone'] });
  assert.equal(g.findPlayers({ game: 'WARZONE' }).length, 2);
  assert.deepEqual(g.findPlayers({ game: 'warzone', platform: 'pc' }).map((p) => p.userId), ['p1']);
  assert.deepEqual(g.findPlayers({ game: 'warzone', availability: 'weekend' }).map((p) => p.userId), ['p2']);
  const l = { author: 'p3', game: 'Warzone', platform: null, slots: 2, joined: ['p1'], note: '', expiresAt: Date.now() + 3600_000 };
  const p = g.lfgPayload(l);
  assert.match(p.embeds[0].data.description, /2\/3/);
  assert.match(p.embeds[0].data.description, /<@p2>/, 'suggère les joueurs du jeu');
  assert.equal(p.components[0].components.length, 3);
});

test('Elo et équipes équilibrées', () => {
  const g = require('../src/gaming');
  const d = g.recordMatch('Rocket League', ['a'], ['b']);
  assert.equal(d, 16, 'joueurs égaux : ±16');
  assert.equal(g.ratingOf('rocket league', 'a').elo, 1016);
  assert.equal(g.leaderboard('Rocket League')[0].userId, 'a');
  for (let k = 0; k < 5; k++) g.recordMatch('Rocket League', ['a', 'c'], ['b', 'd']);
  const teams = g.makeTeams(['a', 'b', 'c', 'd'], 2, 'Rocket League');
  assert.equal(teams.length, 2);
  assert.ok(teams.every((t) => t.length === 2));
  assert.ok(!(teams[0].includes('a') && teams[0].includes('c')), 'les deux meilleurs ne sont pas ensemble');
  assert.equal(g.makeTeams(['1', '2', '3', '4', '5'], 2).flat().length, 5);
});

test('tournoi : inscriptions, tableau avec exemptions, résultats, prix et Elo', async () => {
  const tn = require('../src/tournaments');
  const t = tn.create({ name: 'Coupe des Ronins', game: 'Tekken', teamSize: 1, max: 8, prize: 300 });
  for (const id of ['u1', 'u2', 'u3', 'u4', 'u5']) tn.register(t, { name: id, members: [id] });
  assert.throws(() => tn.register(t, { name: 'x', members: ['u1'] }), /déjà inscrit/);
  tn.start(t);
  assert.equal(t.rounds.length, 3, '8 places : quarts, demies, finale');
  assert.equal(tn.pending(t).length, 2, '3 exemptés : un quart à jouer + une demie déjà prête');
  let guard = 0;
  while (t.status === 'running' && guard++ < 10) {
    const m = tn.pending(t)[0];
    await tn.report(guild, t, m.id, m.a);
  }
  assert.equal(t.status, 'done');
  const champ = t.entrants.find((e) => e.id === t.champion).members[0];
  assert.equal(db.economy[champ].bal, 300);
  assert.ok(require('../src/gaming').ratingOf('Tekken', champ).elo > 1000);
  await assert.rejects(() => tn.report(guild, t, t.rounds[2][0].id, t.champion), /déjà/);
});

test('tournoi par équipes : taille imposée', () => {
  const tn = require('../src/tournaments');
  const t = tn.create({ name: 'Duo', game: 'Warzone', teamSize: 2 });
  assert.throws(() => tn.register(t, { name: 'Solo', members: ['x'] }), /2 joueur/);
  tn.register(t, { name: 'Les Lames', members: ['x', 'y'] });
  assert.equal(tn.payload(t).embeds[0].data.fields[0].value.includes('Les Lames'), true);
});

test('soirées : réservation, liste d\'attente, promotion, calendrier', async () => {
  const nt = require('../src/nights');
  const n = nt.create({ title: 'Soirée test', game: 'Warzone', startsAt: Date.now() + 2 * 3600_000, seats: 2 });
  assert.equal(nt.book(n, 'a'), 'booked');
  assert.equal(nt.book(n, 'b'), 'booked');
  assert.equal(nt.book(n, 'c'), 'waitlist');
  assert.throws(() => nt.book(n, 'a'), /déjà/);
  assert.equal(nt.cancel(n, 'a'), 'c', 'le premier en attente récupère la place');
  assert.deepEqual(n.booked, ['b', 'c']);
  const sent = [];
  await nt.tick({ users: { send: async (id, t) => sent.push([id, t]) } }, guild);
  assert.equal(sent.length, 0, 'pas encore l\'heure du rappel');
  n.startsAt = Date.now() + 30 * 60_000;
  await nt.tick({ users: { send: async (id, t) => sent.push([id, t]) } }, guild);
  assert.deepEqual(sent.map((s) => s[0]), ['b', 'c']);
  db.birthdays = { z: { d: Number(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }).slice(8, 10)), m: Number(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }).slice(5, 7)) } };
  const items = await nt.upcoming(guild, 14);
  assert.ok(items.some((x) => x.icon === '🌙'));
  assert.ok(items.some((x) => x.icon === '🎂'));
});
