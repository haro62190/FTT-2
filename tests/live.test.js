require('./setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../src/store');

test('moments forts : détection d\'un pic du chat Twitch', () => {
  const { createDetector, recapLines } = require('../src/twitchchat');
  const d = createDetector({ factor: 3, min: 15 });
  const t0 = 1_000_000_000_000;
  // 5 minutes calmes : 1 message toutes les 5 s
  for (let s = 0; s < 300; s += 5) d.push(t0 + s * 1000, 'salut');
  assert.equal(d.check(t0 + 300_000), null, 'rien d\'anormal');
  // Pic : 40 messages en 20 s
  for (let k = 0; k < 40; k++) d.push(t0 + 300_000 + k * 500, 'KEKW GG KEKW');
  const spike = d.check(t0 + 320_000);
  assert.ok(spike, 'pic détecté');
  assert.deepEqual(spike.words.slice(0, 2).sort(), ['GG', 'KEKW']);
  assert.equal(d.check(t0 + 325_000), null, 'pas deux alertes de suite');
  const lines = recapLines([{ offset: 3725, words: ['GG'] }], 'https://www.twitch.tv/videos/1');
  assert.equal(lines[0], '💥 [1:02:05 — « GG »](https://www.twitch.tv/videos/1?t=1h2m5s)');
});

test('quiz : bonus pour les 3 plus rapides, rien pour les mauvaises réponses', () => {
  const lg = require('../src/livegames');
  const g = { type: 'quiz', question: 'Q ?', options: ['A', 'B'], correct: 1, reward: 100, endsAt: Date.now(), answers: { a: { choice: 1, at: 1 }, b: { choice: 1, at: 2 }, c: { choice: 0, at: 3 }, d: { choice: 1, at: 4 }, e: { choice: 1, at: 5 } } };
  const w = lg.finishQuiz(g);
  assert.deepEqual(w, ['a', 'b', 'd', 'e']);
  assert.equal(db.economy.a.bal, 150);
  assert.equal(db.economy.e.bal, 100);
  assert.equal(db.economy.c?.bal ?? 0, 0);
  g.ended = true;
  assert.match(lg.render(g).embeds[0].data.description, /4 bonne\(s\) réponse/);
});

test('pronostics : pari mutuel, remboursement si personne n\'a gagné', () => {
  const lg = require('../src/livegames');
  const eco = require('../src/economy');
  const g = { type: 'prono', question: 'Top 1 ?', options: ['Oui', 'Non'], bets: { x: { choice: 0, amount: 100 }, y: { choice: 0, amount: 300 }, z: { choice: 1, amount: 400 } } };
  const pay = lg.settleProno(g, 0);
  assert.deepEqual(Object.fromEntries(pay), { x: 200, y: 600 }, 'le pot de 800 est partagé au prorata');
  assert.equal(eco.wallet('z').bal, 0);
  const g2 = { type: 'prono', question: '?', options: ['A', 'B', 'C'], bets: { p: { choice: 0, amount: 50 } } };
  lg.settleProno(g2, 2);
  assert.equal(eco.wallet('p').bal, 50, 'remboursé');
  const g3 = { type: 'prono', question: '?', options: ['A', 'B'], bets: { q: { choice: 1, amount: 70 } } };
  lg.settleProno(g3, null);
  assert.equal(eco.wallet('q').bal, 70, 'annulé = remboursé');
});

test('votes : barres de résultat', () => {
  const lg = require('../src/livegames');
  const g = { type: 'vote', question: 'Quel jeu ?', options: ['Warzone', 'Valorant'], votes: { a: 0, b: 0, c: 1 }, endsAt: Date.now() + 60_000 };
  const r = lg.render(g);
  assert.match(r.embeds[0].data.description, /2 \(67 %\)/);
  assert.equal(r.components[0].components.length, 2);
});

test('galerie de clips : stockage et meilleurs clips', () => {
  const tl = require('../src/twitchlive');
  const now = new Date().toISOString();
  tl.storeClips([
    { id: 'c1', url: 'https://clips.twitch.tv/c1', title: 'Ace', creator_name: 'fan', view_count: 50, thumbnail_url: 'https://x/1.jpg', created_at: now },
    { id: 'c2', url: 'https://clips.twitch.tv/c2', title: 'Fail', creator_name: 'fan2', view_count: 120, thumbnail_url: 'https://x/2.jpg', created_at: now },
  ]);
  assert.deepEqual(tl.bestClips(7).map((c) => c.id), ['c2', 'c1']);
});
