require('./setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../src/store');

test('durées des giveaways', () => {
  const { parseDuration } = require('../src/giveaway');
  assert.equal(parseDuration('30m'), 30 * 60_000);
  assert.equal(parseDuration('1h30'), 90 * 60_000);
  assert.equal(parseDuration('2j'), 2 * 86_400_000);
  assert.equal(parseDuration('abc'), null);
});

test('dates d\'événement à l\'heure de Paris', () => {
  const { parisDate } = require('../src/admin');
  assert.equal(parisDate('25/12/2026 20:30').toISOString(), '2026-12-25T19:30:00.000Z'); // hiver
  assert.equal(parisDate('15/07/2026 20:30').toISOString(), '2026-07-15T18:30:00.000Z'); // été
  assert.equal(parisDate('31/02/2027 20:00'), null);
  assert.equal(parisDate('25/12/2026 24:00'), null);
  assert.equal(parisDate('n\'importe quoi'), null);
});

test('niveaux : seuils et passage de niveau', () => {
  const levels = require('../src/levels');
  assert.deepEqual(levels.levelInfo(0), { level: 0, xp: 0, needed: 100, totalXp: 0 });
  assert.equal(levels.levelInfo(100).level, 1);
  assert.equal(levels.levelInfo(255).level, 2);
  assert.equal(levels.addXp('t1', 99), null);
  assert.equal(levels.addXp('t1', 1), 1);
  assert.equal(db.season.xp.t1, 100, 'l\'XP compte aussi pour la saison');
});

test('réglages : valeurs par défaut, modification, remise à zéro', () => {
  const settings = require('../src/settings');
  assert.equal(settings.get('security.raidJoins'), 8);
  settings.set('security.raidJoins', 12);
  assert.equal(settings.get('security.raidJoins'), 12);
  assert.equal(settings.get('security.spamMessages'), 6, 'les autres valeurs restent');
  settings.reset(['security']);
  assert.equal(settings.get('security.raidJoins'), 8);
});

test('validation des fichiers de sauvegarde', () => {
  const { isValidBackup } = require('../src/backup');
  assert.equal(isValidBackup({ version: 1, guild: { id: '1' }, roles: [], channels: [] }), true);
  assert.equal(isValidBackup({ version: 1, roles: [] }), false);
  assert.equal(isValidBackup({ version: 1, guild: { id: '1' }, roles: [], channels: [], settings: [] }), false);
  assert.equal(isValidBackup(null), false);
});

test('économie : solde jamais négatif', () => {
  const eco = require('../src/economy');
  assert.equal(eco.add('e1', 100), 100);
  assert.equal(eco.add('e1', -500), 0);
});

test('saisons : classement et clôture', async () => {
  const seasons = require('../src/seasons');
  const { Collection } = require('discord.js');
  db.season = { month: '2000-01', xp: { a: 50, b: 80, c: 10 } };
  assert.deepEqual(seasons.top(2).map((p) => p.userId), ['b', 'a']);
  const sent = [];
  const guild = { roles: { cache: new Collection() }, channels: { cache: new Collection([['x', { name: '📡┃annonces', send: async (p) => sent.push(p) }]]) }, members: { fetch: async () => null } };
  await seasons.close(guild);
  assert.equal(sent.length, 1, 'podium annoncé');
  assert.equal(db.economy.b.bal, 3000, 'récompense du premier');
  assert.deepEqual(db.season.xp, {}, 'nouvelle saison vide');
});

test('commandes personnalisées et rôles sûrs', () => {
  const custom = require('../src/custom');
  const { PermissionsBitField } = require('discord.js');
  assert.equal(custom.setCommand('!Discord', 'lien'), 'discord');
  assert.equal(custom.setCommand('', 'x'), null);
  const guild = { id: 'G' };
  const role = (perm, extra = {}) => ({ id: 'r', guild, managed: false, editable: true, permissions: new PermissionsBitField(perm), ...extra });
  assert.equal(custom.safeRole(role(0n)), true);
  assert.equal(custom.safeRole(role(PermissionsBitField.Flags.Administrator)), false);
  assert.equal(custom.safeRole(role(0n, { editable: false })), false);
});

test('graphiques : SVG sans valeur invalide', () => {
  const { lineChart } = require('../src/charts');
  const points = [{ date: '2026-11-01', a: 1, b: 2 }, { date: '2026-11-02', a: 3 }, { date: '2026-11-03', a: 2, b: 0 }];
  const svg = lineChart({ points, series: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }] });
  assert.match(svg, /<svg/);
  assert.doesNotMatch(svg, /NaN|undefined/);
  assert.match(lineChart({ points: [{ date: '2026-11-01' }], series: [{ key: 'a', label: 'A' }] }), /Pas encore de données/);
});

test('carte de rang : image PNG', async () => {
  const { renderRankCard } = require('../src/rankcard');
  const png = await renderRankCard({ username: 'Test <&>', level: 3, xp: 10, needed: 100, rank: 1, totalXp: 400, messages: 20, voiceMinutes: 90, ryo: 50 });
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
});

test('construction : aperçu sur un serveur vide', () => {
  const { plan } = require('../src/builder');
  const empty = { roles: { cache: { find: () => undefined } }, channels: { cache: { find: () => undefined, get: () => undefined } } };
  const p = plan(empty);
  assert.ok(p.rolesCreate.length > 10);
  assert.ok(p.chCreate.length > 30);
});

test('le script de mise à jour est valide', () => {
  const { execFileSync } = require('child_process');
  execFileSync('bash', ['-n', require('path').join(__dirname, '..', 'scripts', 'update.sh')]);
});
