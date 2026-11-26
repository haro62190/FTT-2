require('./setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');
const { db } = require('../src/store');

test('notifications : MP refusés, heures calmes (attente ou abandon), maximum par jour', async () => {
  const nf = require('../src/notify');
  const sent = [];
  const client = { users: { send: async (id, p) => sent.push([id, p]) } };
  db.notifyQueue = [];
  // Par défaut : envoyé
  assert.equal(await nf.dm(client, 'a', 'Salut', 'suggestion'), 'sent');
  // MP coupés pour un type
  nf.setPrefs('b', { off: ['lfg'] });
  assert.equal(await nf.dm(client, 'b', 'x', 'lfg'), 'skipped');
  assert.equal(await nf.dm(client, 'b', 'x', 'suggestion'), 'sent');
  // Maximum par jour
  nf.setPrefs('c', { cap: 3 });
  for (let k = 0; k < 3; k++) await nf.dm(client, 'c', `m${k}`, 'suggestion');
  assert.equal(await nf.dm(client, 'c', 'de trop', 'suggestion'), 'skipped');
  // Heures calmes : à 3 h du matin (Paris), un rappel est abandonné, une suggestion attend
  nf.setPrefs('d', { quiet: '22-8' });
  const night = new Date('2026-11-26T02:00:00Z').getTime(); // 3 h à Paris
  assert.equal(nf.inQuiet(nf.prefs('d'), night), true);
  assert.equal(nf.decide('d', 'reminder', night), 'skip');
  assert.equal(nf.decide('d', 'suggestion', night), 'queue');
  const noon = new Date('2026-11-26T11:00:00Z').getTime();
  assert.equal(nf.decide('d', 'suggestion', noon), 'send');
  // MP désactivés complètement
  nf.setPrefs('e', { dm: false });
  assert.equal(nf.decide('e', 'report'), 'skip');
});

test('notifications : les MP mis en attente partent après les heures calmes', async () => {
  const nf = require('../src/notify');
  const sent = [];
  const client = { users: { send: async (id, p) => sent.push(id) } };
  db.notifyQueue = [{ userId: 'q1', payload: { content: 'plus tard' }, kind: 'suggestion', at: Date.now() }, { userId: 'q2', payload: { content: 'trop vieux' }, kind: 'suggestion', at: Date.now() - 2 * 86_400_000 }];
  nf.setPrefs('q1', { quiet: 'none' });
  await nf.flush(client);
  assert.deepEqual(sent, ['q1']);
  assert.equal(db.notifyQueue.length, 0);
});

test('salons inactifs : archivage réversible (place et permissions rendues), garder, relancer', async () => {
  const ins = require('../src/insights');
  const overwrites = new Collection([['everyone', { id: 'G', type: 0, allow: { bitfield: 1024n }, deny: { bitfield: 0n } }]]);
  const calls = [];
  const ch = {
    id: 'c1',
    name: 'vieux-salon',
    parentId: 'cat-dojo',
    rawPosition: 3,
    isTextBased: () => true,
    isVoiceBased: () => false,
    permissionOverwrites: { cache: overwrites, edit: async (who, perms) => calls.push(['edit', perms]), set: async (list) => calls.push(['set', list]) },
    setParent: async (id) => calls.push(['parent', id]),
    send: async (m) => calls.push(['send', m.content]),
  };
  const channels = new Collection([['c1', ch]]);
  const guild = { roles: { everyone: { id: 'G' } }, channels: { cache: channels, create: async (o) => ({ id: 'arch', name: o.name }) } };
  db.archivedChannels = {};
  await ins.channelAction(guild, 'c1', 'archive', 'Haro');
  assert.ok(db.archivedChannels.c1);
  assert.deepEqual(calls[0], ['parent', 'arch']);
  assert.equal(calls[1][1].SendMessages, false);
  await assert.rejects(ins.channelAction(guild, 'c1', 'archive', 'Haro'), /déjà archivé/);
  await ins.channelAction(guild, 'c1', 'restore', 'Haro');
  assert.deepEqual(calls[2], ['parent', 'cat-dojo']);
  assert.equal(calls[3][0], 'set');
  assert.equal(calls[3][1][0].allow, 1024n);
  assert.equal(db.archivedChannels.c1, undefined);
  await ins.channelAction(guild, 'c1', 'keep', 'Haro');
  assert.ok(db.channelKeep.c1 > Date.now());
  await ins.channelAction(guild, 'c1', 'nudge', 'Haro');
  assert.equal(calls.at(-1)[0], 'send');
  assert.equal(ins.actionMenu([{ id: 'c1', name: 'vieux-salon', voice: false }])[0].components[0].options.length, 3);
});

test('idées de contenu : clips les plus vus d\'abord, moments du chat sans doublon, liens horodatés', () => {
  const { ideas } = require('../src/contentideas');
  const startedAt = Date.now() - 3600_000;
  const list = ideas({
    startedAt,
    vodUrl: 'https://www.twitch.tv/videos/1',
    clips: [
      { title: 'Petit clip', url: 'https://clips.twitch.tv/a', creator: 'x', views: 3, createdAt: startedAt + 600_000 },
      { title: 'Gros clip', url: 'https://clips.twitch.tv/b', creator: 'y', views: 40, createdAt: startedAt + 1200_000 },
    ],
    highlights: [
      { offset: 610, rate: 50, words: ['GG'] }, // même moment que « Petit clip » : ignoré
      { offset: 2400, rate: 30, words: ['incroyable'] },
    ],
  });
  assert.deepEqual(list.map((x) => x.title), ['Gros clip', 'Petit clip', '« incroyable »']);
  assert.match(list[2].url, /videos\/1\?t=/);
});

test('erreurs : « Effacer » masque les anciennes, garde le fichier, affiche les nouvelles', () => {
  const fs = require('fs');
  const logger = require('../src/logger');
  logger.install();
  const realError = console.error;
  console.error = () => {}; // pas de bruit dans la sortie des tests (le journal est quand même écrit)
  logger.install();
  console.error('Ancienne erreur');
  assert.ok(logger.tail(50).some((l) => l.includes('Ancienne erreur')));
  logger.clear();
  assert.ok(!logger.tail(50).some((l) => l.includes('Ancienne erreur')), 'masquée sur le site');
  const file = require('path').join(require('../src/store').DIR, 'logs', 'erreurs.log');
  assert.ok(fs.readFileSync(file, 'utf8').includes('Ancienne erreur'), 'toujours dans le fichier');
  // Une erreur qui arrive après l'effacement s'affiche
  const later = Date.now() + 5;
  while (Date.now() < later);
  console.error('Nouvelle erreur');
  assert.ok(logger.tail(50).some((l) => l.includes('Nouvelle erreur')));
  console.error = realError;
});
