require('./setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../src/store');

test('clés spéciales (__proto__, constructor…) jamais lues comme des données', () => {
  const { own } = require('../src/shared');
  const obj = { a: 1 };
  for (const k of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) assert.equal(own(obj, k), undefined, k);
  assert.equal(own(obj, 'a'), 1);
  assert.equal(require('../src/tournaments').find('__proto__'), null);
  assert.equal(({}).status, undefined, 'aucune pollution');
});

test('commande personnalisée « !__proto__ » : ignorée sans erreur', async () => {
  const custom = require('../src/custom');
  let sent = false;
  const message = { guild: { name: 'G' }, author: { bot: false, id: 'u' }, channelId: 'c', content: '!__proto__', channel: { send: async () => (sent = true) } };
  await custom.onMessage(message);
  await custom.onMessage({ ...message, content: '!constructor' });
  assert.equal(sent, false);
  assert.equal(custom.setCommand?.('__proto__', 'piège') ?? null, null, 'nom réservé refusé');
  assert.equal(({}).uses, undefined);
});

test('quiz : l\'organisateur ne gagne rien, récompense plafonnée', () => {
  const lg = require('../src/livegames');
  const g = { type: 'quiz', question: '?', options: ['A', 'B'], correct: 0, reward: 500, by: 'staff', endsAt: Date.now(), answers: { staff: { choice: 0, at: 1 }, fan: { choice: 0, at: 2 } } };
  assert.deepEqual(lg.finishQuiz(g), ['fan']);
  assert.equal(db.economy?.staff?.bal ?? 0, 0);
  const cmd = lg.commands.find((c) => c.data.name === 'quiz').data.toJSON();
  const max = cmd.options[0].options.find((o) => o.name === 'recompense').max_value;
  assert.equal(max, 500);
});

test('défis et tournois : récompenses plafonnées', () => {
  assert.equal(require('../src/challenges').create({ title: 'x', type: 'messages', target: 1, days: 1, reward: 999_999 }).reward, 2000);
  assert.equal(require('../src/tournaments').create({ name: 'x', game: 'y', prize: 5_000_000 }).prize, 20_000);
});

test('moments forts : aucun lien ni mention venant du chat Twitch', () => {
  const { createDetector } = require('../src/twitchchat');
  const d = createDetector({ factor: 2, min: 5 });
  const t0 = 2_000_000_000_000;
  for (let s = 0; s < 300; s += 5) d.push(t0 + s * 1000, 'calme');
  for (let k = 0; k < 30; k++) d.push(t0 + 300_000 + k * 300, '@everyone https://arnaque.xyz <@&123> discord.gg/x GG');
  const spike = d.check(t0 + 310_000);
  assert.ok(spike);
  assert.ok(spike.words.includes('GG'));
  assert.ok(spike.words.every((w) => !/[@<>:/]|everyone|discord\.gg|https?/i.test(w)), spike.words.join(' '));
});

test('pronostic jamais clôturé : remboursé au bout de 24 h', async () => {
  const lg = require('../src/livegames');
  lg.games().stale = { type: 'prono', question: '?', options: ['A', 'B'], bets: { parieur: { choice: 0, amount: 300 } }, locked: true, endsAt: Date.now() - 25 * 3600_000, messageId: 'stale' };
  await lg.refundStale();
  assert.equal(db.economy.parieur.bal, 300);
  assert.equal(lg.games().stale.ended, true);
});
