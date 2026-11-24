require('./setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../src/store');

test('classes méta : saisie, recherche, mise à jour, suppression', () => {
  const lo = require('../src/loadouts');
  const atts = lo.parseAttachments('bouche: Compensateur; Canon = Long 20" | Optique: Viseur 2x\nnimportequoi');
  assert.deepEqual(atts.map((a) => a.slot), ['Bouche', 'Canon', 'Optique']);
  const l = lo.upsert({ game: 'Warzone', weapon: 'MCW 6.8', mode: 'Warzone', tier: 'S', attachments: atts, code: 'A01-XYZ' }, 'haro');
  assert.equal(l.id, 'warzone:warzone:mcw-6-8');
  assert.equal(lo.find('mcw')?.id, l.id, 'recherche souple');
  assert.equal(lo.find(l.id)?.weapon, 'MCW 6.8', 'recherche par identifiant (autocomplétion)');
  lo.upsert({ game: 'MW4', weapon: 'Exemple SMG', mode: 'Multijoueur', tier: 'B', attachments: [{ slot: 'Canon', name: 'Court' }] });
  assert.equal(lo.list({ game: 'Warzone' }).length, 1);
  assert.throws(() => lo.upsert({ game: 'Warzone', weapon: 'Vide', attachments: [] }), /accessoire/);
  // Renommer l'arme garde la même publication
  db.loadouts[l.id].messageId = 'm1';
  const renamed = lo.upsert({ game: 'Warzone', weapon: 'MCW', mode: 'Warzone', tier: 'A', attachments: atts, previousId: l.id });
  assert.equal(renamed.messageId, 'm1');
  assert.equal(db.loadouts[l.id], undefined);
  const tl = lo.tierList('Warzone').toJSON();
  assert.match(tl.fields[0].value, /\*\*A\*\* — MCW/);
  assert.ok(lo.remove(renamed.id));
  assert.equal(lo.find('mcw', 'Warzone'), null);
});

test('classes méta : image de la classe', () => {
  const lo = require('../src/loadouts');
  const l = lo.upsert({ game: 'Warzone', weapon: 'Exemple AR 🔥', tier: 'S', attachments: lo.parseAttachments('Bouche: A; Canon: B; Optique: C; Crosse: D; Chargeur: E; Munitions: F; Laser: G; Poignée: H') });
  const p = lo.payload(l);
  assert.equal(p.files.length, 1);
  assert.equal(p.embeds[0].data.image.url, 'attachment://exemple-ar.png');
});

test('classes méta : liens vers la source (aucune copie du site)', () => {
  const lo = require('../src/loadouts');
  assert.equal(lo.safeUrl('javascript:alert(1)'), '');
  assert.equal(lo.safeUrl('http://exemple.com'), '', 'https uniquement');
  const l = lo.upsert({ game: 'MW4', weapon: 'Exemple', attachments: [{ slot: 'Canon', name: 'Long' }], sourceUrl: 'https://nolagvpn.com/en/best-loadouts/exemple-mw4' });
  const row = lo.payload(l).components[0].toJSON().components;
  assert.equal(row.length, 2);
  assert.equal(row[0].url, 'https://nolagvpn.com/en/best-loadouts/exemple-mw4');
  assert.equal(row[1].url, 'https://nolagvpn.com/en/mw4/meta');
});
