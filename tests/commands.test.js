require('./setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { commands } = require('../src/commands');

test('toutes les commandes / sont valides pour Discord', () => {
  const json = commands.map((c) => c.data.toJSON());
  assert.ok(json.length > 0 && json.length <= 100, `${json.length} commandes (max 100)`);
  const names = json.map((j) => j.name);
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), [], 'noms en double');
  for (const j of json) {
    assert.match(j.name, /^[\p{Ll}\p{N}_-]{1,32}$/u, `nom invalide : ${j.name}`);
    assert.ok(j.description.length >= 1 && j.description.length <= 100, `description de /${j.name}`);
  }
  assert.ok(JSON.stringify(json).length < 64_000, 'taille totale des commandes');
});

test('chaque commande a une catégorie et une fonction run', () => {
  for (const c of commands) {
    assert.equal(typeof c.run, 'function', c.data.name);
    assert.ok(c.category, c.data.name);
  }
});

test('Discord accepte au plus 100 commandes / par serveur', () => {
  const { commands } = require('../src/commands');
  assert.ok(commands.length <= 100, `${commands.length} commandes`);
  assert.equal(new Set(commands.map((c) => c.data.name)).size, commands.length, 'pas de doublon');
});
