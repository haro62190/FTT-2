require('./setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const polls = require('../src/polls');

test('sondages : durées lues (30m, 2h, 1j12h, minutes), invalides refusées', () => {
  assert.equal(polls.parseDuration('30m'), 30 * 60_000);
  assert.equal(polls.parseDuration('2h'), 2 * 3_600_000);
  assert.equal(polls.parseDuration('1j12h'), 36 * 3_600_000);
  assert.equal(polls.parseDuration('90'), 90 * 60_000);
  assert.equal(polls.parseDuration('demain'), null);
  assert.equal(polls.parseDuration('2h et plus'), null);
});

test('sondages : un choix, plusieurs choix, retrait, anonymat respecté', () => {
  assert.throws(() => polls.create({ question: 'Q', options: ['A', 'A'], ms: 3_600_000 }), /2 choix/);
  assert.throws(() => polls.create({ question: 'Q', options: ['A', 'B'], ms: 1000 }), /Durée invalide/);
  const p = polls.create({ question: 'Quel jeu ?', options: ['Warzone', ' Fortnite ', '', 'Minecraft'], ms: 3_600_000 });
  assert.deepEqual(p.options, ['Warzone', 'Fortnite', 'Minecraft']);
  polls.vote(p, 'u1', 0);
  polls.vote(p, 'u1', 2); // un seul choix : remplace
  polls.vote(p, 'u2', 2);
  assert.deepEqual(polls.counts(p), [0, 0, 2]);
  polls.vote(p, 'u2', 2); // recliquer = retirer
  assert.deepEqual(polls.counts(p), [0, 0, 1]);
  // Anonyme et résultats cachés : ni décompte ni nom pendant le vote
  let out = JSON.stringify(polls.render(p).embeds[0].toJSON());
  assert.ok(!out.includes('%') && !out.includes('<@u1>'));
  const m = polls.create({ question: 'Dispos ?', options: ['Lundi', 'Mardi'], ms: 3_600_000, multi: true, anonymous: false, live: true });
  polls.vote(m, 'u1', 0);
  polls.vote(m, 'u1', 1);
  assert.deepEqual(polls.counts(m), [1, 1]);
  assert.ok(JSON.stringify(polls.render(m).embeds[0].toJSON()).includes('50 %'));
  m.closed = Date.now();
  out = JSON.stringify(polls.render(m).embeds[0].toJSON());
  assert.ok(out.includes('<@u1>'), 'vote public : votants affichés à la fin');
  assert.equal(polls.render(m).components.length, 0, 'plus de boutons une fois terminé');
  assert.throws(() => polls.vote(m, 'u2', 0), /terminé/);
});

test('sondages : clôture automatique à la date limite, résultats publiés', async () => {
  const p = polls.create({ question: 'Fin ?', options: ['Oui', 'Non'], ms: 60_000 });
  polls.vote(p, 'u1', 0);
  const sent = [];
  const edits = [];
  const channel = { send: async (m) => sent.push(m), messages: { fetch: async () => ({ url: 'https://discord.com/x', edit: async (m) => edits.push(m) }) } };
  polls.start({ channels: { cache: { get: () => channel } } });
  p.channelId = 'c';
  p.messageId = 'm';
  p.endsAt = Date.now() - 1;
  await polls.tick();
  assert.ok(p.closed);
  assert.match(sent[0].content, /Gagnant : \*\*Oui\*\*/);
  assert.ok(edits.length >= 1);
});

test('accueil personnalisé : guide adapté, rôles donnés, jeux ajoutés au profil', async () => {
  const { Collection } = require('discord.js');
  const ob = require('../src/onboarding');
  const { db } = require('../src/store');
  const mk = (key, name) => ({ id: key, name, editable: true });
  const roleList = [mk('r_live', '🔴 Notif Live'), mk('r_gamer', '🕹️ Joueur'), mk('r_art', '🎨 Artiste')];
  const channels = new Collection([['c1', { id: 'c1', name: '🔴┃en-live', toString: () => '<#c1>' }], ['c2', { id: 'c2', name: '🎮┃recherche-joueurs', toString: () => '<#c2>' }]]);
  const guild = { channels: { cache: channels }, roles: { cache: new Collection(roleList.map((r) => [r.id, r])) } };
  const given = [];
  const member = { id: 'u9', guild, roles: { cache: new Collection(), add: async (r) => given.push(r.name) } };
  db.players = {};
  const c = { interests: ['lives', 'play'], games: ['Fortnite'] };
  const added = await ob.apply(member, c);
  assert.deepEqual(added.sort(), ['🔴 Notif Live', '🕹️ Joueur'].sort());
  assert.deepEqual(db.players.u9.games, ['Fortnite']);
  const g = JSON.stringify(ob.guide(guild, c).embeds[0].toJSON());
  assert.ok(g.includes('<#c1>') && g.includes('<#c2>'));
  assert.ok(g.includes('Fortnite'));
  assert.ok(!g.includes('Création & fan-art'), 'seulement ce qui a été choisi');
  const picker = ob.picker('u9');
  assert.equal(picker.flags, require('discord.js').MessageFlags.Ephemeral);
});

test('lives : comparaison avec les lives précédents et regroupement par semaine', () => {
  const { db } = require('../src/store');
  const streams = require('../src/streams');
  const now = Date.now();
  db.streams = [];
  const mk = (daysAgo, avg, peak, dur, f) => streams.record({ platform: 'twitch', startedAt: now - daysAgo * 86_400_000, endedAt: now - daysAgo * 86_400_000 + dur * 60_000, avg, peak, followersGained: f });
  mk(30, 10, 20, 120, 2);
  mk(20, 10, 20, 120, 2);
  const last = mk(0.1, 15, 30, 180, 5);
  const c = streams.compare(last);
  assert.equal(c.count, 2);
  assert.equal(c.avg, 50);
  assert.equal(c.peak, 50);
  assert.equal(c.duration, 50);
  assert.equal(c.followers, 3);
  const w = streams.weekly(8);
  assert.equal(w.length, 8);
  assert.equal(w.reduce((n, x) => n + x.count, 0) >= 1, true);
  assert.equal(w[0].count >= 1 || w[1].count >= 1, true);
  assert.equal(streams.compare(db.streams.at(-1)), null, 'premier live : rien à comparer');
});
