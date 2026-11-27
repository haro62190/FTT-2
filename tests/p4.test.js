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
  console.error('Ancienne erreur', new Error('avec une pile\nsur plusieurs lignes'));
  assert.ok(logger.tail(50).some((l) => l.includes('Ancienne erreur')));
  logger.clear();
  assert.equal(logger.tail(50).length, 0, 'toute l\'erreur est masquée, pile d\'appels comprise');
  const file = require('path').join(require('../src/store').DIR, 'logs', 'erreurs.log');
  assert.ok(fs.readFileSync(file, 'utf8').includes('Ancienne erreur'), 'toujours dans le fichier');
  // Une erreur qui arrive après l'effacement s'affiche
  const later = Date.now() + 5;
  while (Date.now() < later);
  console.error('Nouvelle erreur');
  assert.ok(logger.tail(50).some((l) => l.includes('Nouvelle erreur')));
  console.error = realError;
});

test('yt-dlp : trouvé dans les dossiers d\'installation même si le PATH de pm2 est incomplet', () => {
  if (process.platform === 'win32') return;
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bin-'));
  const bin = path.join(dir, 'outil-test');
  fs.writeFileSync(bin, '#!/bin/sh\necho ok\n', { mode: 0o755 });
  const { findBinary } = require('../src/ytdlp');
  const before = process.env.PATH;
  process.env.PATH = `${before}:${dir}`;
  assert.equal(findBinary('outil-test'), bin);
  assert.equal(findBinary('outil-test', '/chemin/force'), '/chemin/force', 'YTDLP_PATH reste prioritaire');
  assert.equal(findBinary('introuvable-xyz'), 'introuvable-xyz');
  process.env.PATH = before;
  assert.ok(process.env.PATH.split(':').includes('/usr/local/bin'), '/usr/local/bin toujours dans le PATH du bot');
});

test('musique : blocage YouTube reconnu, titre nettoyé, bascule SoundCloud tentée avec un message clair', async () => {
  const music = require('../src/music');
  assert.ok(music.isBotBlock("ERROR: [youtube] 5EpyN: Sign in to confirm you're not a bot. Use --cookies-from-browser"));
  assert.ok(!music.isBotBlock('ERROR: Video unavailable'));
  assert.ok(music.isYouTube('https://www.youtube.com/watch?v=x') && music.isYouTube('https://youtu.be/x'));
  assert.ok(!music.isYouTube('https://soundcloud.com/a/b'));
  assert.equal(music.cleanTitle('The Weeknd, Playboi Carti - Timeless (Official Video) [4K]'), 'The Weeknd, Playboi Carti - Timeless');
  // File factice, recherche SoundCloud simulée : le test ne dépend pas de la machine (yt-dlp installé ou non)
  const q = Object.create(music.GuildQueue.prototype);
  const said = [];
  Object.assign(q, { tracks: [], current: null, destroyed: false, send: (m) => said.push(m), next: () => said.push('next'), resolve: async () => [] });
  const track = { title: 'Timeless (Official Video)', url: 'https://www.youtube.com/watch?v=5EpyN', requestedBy: 'u1' };
  q.current = track;
  await q.onFail(track, "ERROR: [youtube] 5EpyN: Sign in to confirm you're not a bot");
  assert.match(said[0], /SoundCloud/);
  assert.match(said.at(-1), /Introuvable sur SoundCloud/);
  assert.ok(!said.join(' ').includes('github.com'), 'pas de lien vers la FAQ yt-dlp');
  // Trouvé sur SoundCloud : mis en tête de file et joué tout de suite, sans rejouer le morceau raté
  said.length = 0;
  let searched = null;
  q.resolve = async (title, source) => ((searched = [title, source]), [{ title: 'Timeless', url: 'https://soundcloud.com/x/timeless' }]);
  q.current = track;
  await q.onFail(track, "ERROR: [youtube] 5EpyN: Sign in to confirm you're not a bot");
  assert.deepEqual(searched, ['Timeless', 'soundcloud']);
  assert.equal(q.tracks[0].url, 'https://soundcloud.com/x/timeless');
  assert.equal(q.tracks[0].fallback, true);
  assert.equal(said.at(-1), 'next');
  // Le morceau de secours échoue aussi : pas de boucle infinie
  said.length = 0;
  q.tracks = [];
  await q.onFail({ ...track, fallback: true }, 'ERROR: Sign in to confirm you are not a bot');
  assert.equal(said.length, 0);
  // Autre erreur : message normal
  said.length = 0;
  await q.onFail({ title: 'X', url: 'https://soundcloud.com/a/b' }, 'ERROR: 404');
  assert.match(said[0], /Impossible de lire \*\*X\*\*/);
});

test('musique : égalisation, volume et limiteur anti-saturation dans les filtres audio', () => {
  const music = require('../src/music');
  const settings = require('../src/settings');
  assert.equal(music.audioFilters(100, true), 'loudnorm=I=-16:TP=-2:LRA=11,alimiter=limit=0.89:level=disabled');
  assert.equal(music.audioFilters(150, false), 'volume=1.50,alimiter=limit=0.89:level=disabled');
  settings.set('music.volume', 999);
  assert.equal(music.volumePct(), 150, 'volume plafonné');
  settings.set('music.volume', 3);
  assert.equal(music.volumePct(), 10, 'volume plancher');
  settings.set('music.volume', 100);
  assert.ok(music.commands.some((c) => c.data.name === 'volume'));
});
