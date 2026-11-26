require('./setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection, PermissionsBitField } = require('discord.js');
const { db } = require('../src/store');
const g = require('../src/guardian');

test('guardian : erreurs répétées regroupées malgré les chiffres différents', () => {
  for (let k = 0; k < 6; k++) g.recordLog('ERREUR', `TikTok vidéos : délai dépassé après ${1000 + k} ms`);
  g.recordLog('ATTENTION', 'juste un avertissement');
  g.recordLog('ERREUR', 'Une erreur isolée');
  const rep = g.repeatedErrors();
  assert.equal(rep.length, 1);
  assert.equal(rep[0].count, 6);
  assert.match(g.fixFor(rep[0].text), /TikTok/);
});

test('guardian : problèmes détectés avec une correction proposée, sans rien modifier', () => {
  // Serveur piégé : toute tentative de modification fait échouer le test
  const forbid = () => {
    throw new Error('Le gardien ne doit rien modifier !');
  };
  const me = { permissions: new PermissionsBitField(0n), roles: { add: forbid, remove: forbid } };
  const guild = {
    members: { me },
    roles: { cache: new Collection(), create: forbid },
    channels: { cache: new Collection(), create: forbid },
    edit: forbid,
  };
  const client = { isReady: () => true, ws: { ping: 42 } };
  db.lastFileBackup = { at: Date.now() - 3 * 86_400_000, verified: true };
  const checks = g.runChecks(client, guild);
  const by = (id) => checks.find((c) => c.id === id);
  assert.equal(by('discord').status, 'ok');
  assert.equal(by('permissions').status, 'error');
  assert.match(by('permissions').fix, /npm run invite/);
  assert.equal(by('structure').status, 'warn');
  assert.match(by('structure').fix, /\/setup/);
  assert.equal(by('backups').status, 'warn');
  assert.ok(checks.some((c) => c.label === 'Erreur répétée'));
  for (const c of checks.filter((x) => x.status === 'warn' || x.status === 'error')) assert.ok(c.fix, `correction proposée pour ${c.id}`);
  const embed = g.reportEmbed(checks).toJSON();
  assert.match(embed.title, /point\(s\) à regarder/);
});
