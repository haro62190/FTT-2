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
