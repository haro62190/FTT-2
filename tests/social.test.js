require('./setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');
const { db } = require('../src/store');

test('réputation : 3 merci par jour, pas deux fois la même personne, pas soi-même', () => {
  const s = require('../src/social');
  assert.equal(s.thank('a', 'b'), 1);
  assert.throws(() => s.thank('a', 'b'), /déjà remercié/);
  assert.throws(() => s.thank('a', 'a'), /toi-même/);
  s.thank('a', 'c');
  s.thank('a', 'd');
  assert.throws(() => s.thank('a', 'e'), /3 remerciements/);
  s.thank('x', 'b');
  assert.equal(s.repBoard()[0].userId, 'b');
  assert.equal(db.monthStats.b.rep, 2, 'compte pour le membre du mois');
});

test('membre du mois : plusieurs critères pondérés, rôle, ryō et remise à zéro', async () => {
  const s = require('../src/social');
  db.monthStats = { m1: { xp: 1000, voice: 10 }, m2: { xp: 400, voice: 300, rep: 5, quests: 6 }, m3: { live: 3 } };
  const r = s.motmRanking();
  assert.equal(r[0].userId, 'm2', 'le plus complet gagne, pas seulement le plus d\'XP');
  const sent = [];
  const role = { id: 'motm', name: '🌟 Membre du mois', editable: true, members: new Collection() };
  const member = { id: 'm2', displayName: 'M2', roles: { add: async () => sent.push('role') } };
  const ann = { id: 'ann', name: '📡┃annonces', send: async (p) => sent.push(p) };
  const guild = { channels: { cache: new Collection([['ann', ann]]) }, roles: { cache: new Collection([['motm', role]]) }, members: { fetch: async () => member } };
  await s.closeMonth(guild, 'novembre 2026');
  assert.equal(db.economy.m2.bal, 2000);
  assert.ok(sent.includes('role'));
  assert.match(sent.find((x) => x.embeds).embeds[0].data.title, /novembre 2026/);
  assert.deepEqual(db.monthStats, {});
  assert.equal(db.motmHistory[0].winner, 'm2');
});

test('parrainage : invitation utilisée détectée, récompense au niveau 3', async () => {
  const s = require('../src/social');
  db.referrals = { codes: { abc: 'sponsor' }, members: {}, uses: { abc: 0, other: 4 } };
  const invites = new Collection([['abc', { code: 'abc', uses: 1 }], ['other', { code: 'other', uses: 4 }]]);
  const dms = [];
  const guild = { invites: { fetch: async () => invites }, client: { users: { send: async (id, t) => dms.push([id, t]) } }, members: { fetch: async (id) => ({ id, displayName: 'Filleul' }) } };
  const old = Date.now() - 400 * 86_400_000;
  assert.equal(await s.onJoin({ id: 'alt', user: { username: 'alt', createdTimestamp: Date.now() - 86_400_000 }, guild }), null, 'compte créé hier : pas de parrainage');
  invites.get('abc').uses = 2;
  db.referrals.uses.abc = 1;
  const sponsor = await s.onJoin({ id: 'newbie', user: { username: 'newbie', createdTimestamp: old }, guild });
  assert.equal(sponsor, 'sponsor');
  assert.equal(db.referrals.members.newbie.sponsor, 'sponsor');
  await s.checkReferrals(guild);
  assert.equal(db.economy?.sponsor?.bal ?? 0, 0, 'pas encore niveau 3');
  db.levels.newbie = { xp: 1000, messages: 10 };
  await s.checkReferrals(guild);
  assert.equal(db.economy.sponsor.bal, 500);
  assert.equal(db.economy.newbie.bal, 250);
  await s.checkReferrals(guild);
  assert.equal(db.economy.sponsor.bal, 500, 'une seule fois');
});

test('défis collectifs : progression, réussite, récompense de chaque participant', () => {
  const ch = require('../src/challenges');
  const c = ch.create({ title: 'Bavards', type: 'messages', target: 3, days: 7, reward: 100 });
  ch.progress('voice', 'a');
  assert.equal(c.progress, 0, 'mauvais type');
  ch.progress('messages', 'a');
  ch.progress('messages', 'b');
  assert.match(ch.render(c).embeds[0].data.description, /2 \/ 3/);
  const done = ch.progress('messages', 'a');
  assert.equal(done.length, 1);
  assert.ok(c.done);
  assert.deepEqual(c.contributors, { a: 2, b: 1 });
  assert.equal(db.economy.a.bal, 100);
  assert.equal(db.economy.b.bal, 100);
});

test('candidatures : une seule en attente, attente de 14 jours après un refus', async () => {
  const ap = require('../src/applications');
  db.applications = { a1: { id: 'a1', userId: 'cand', kind: 'mod', answers: { why: 'motivé' }, status: 'pending', at: Date.now() } };
  assert.match(ap.canApply('cand', 'mod'), /en attente/);
  assert.equal(ap.canApply('cand', 'streamer'), null);
  const roleAdds = [];
  const helper = { id: 'h', name: '🔰 Sentinelle', editable: true };
  const guild = { channels: { cache: new Collection() }, roles: { cache: new Collection([['h', helper]]) }, members: { fetch: async () => ({ id: 'cand', user: {}, roles: { add: async (r) => roleAdds.push(r.id) }, send: async () => {} }) } };
  await ap.decide(guild, db.applications.a1, false, 'boss');
  assert.match(ap.canApply('cand', 'mod'), /recandidater/);
  db.applications.a2 = { id: 'a2', userId: 'cand2', kind: 'mod', answers: {}, status: 'pending' };
  await ap.decide(guild, db.applications.a2, true, 'boss');
  assert.deepEqual(roleAdds, ['h']);
  await assert.rejects(() => ap.decide(guild, db.applications.a2, true, 'boss'), /déjà été traitée/);
});
