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

test('guardian : erreurs de configuration détectées sans afficher de secret', () => {
  const base = { DISCORD_TOKEN: 'secret-token-ne-pas-afficher', GUILD_ID: '123456789012345678', DISCORD_CLIENT_SECRET: 'zzz-secret' };
  assert.deepEqual(g.configIssues(base), []);
  const bad = g.configIssues({
    ...base,
    GUILD_ID: '12ab',
    SECOURS_GUILD_ID: '12ab',
    DASHBOARD_URL: 'http://bot.haro62190.tech',
    PUBLIC_HOST: 'https://haro62190.tech/',
    TRUST_PROXY: '1',
    DASHBOARD_HOST: '0.0.0.0',
  });
  const ids = bad.map((x) => x.id);
  for (const id of ['cfg:guild', 'cfg:rescue', 'cfg:https', 'cfg:proxy', 'cfg:public', 'cfg:host']) assert.ok(ids.includes(id), id);
  assert.match(bad.find((x) => x.id === 'cfg:proxy').detail, /TRUST_PROXY/);
  const text = JSON.stringify(bad);
  assert.ok(!text.includes('secret-token') && !text.includes('zzz-secret'), 'aucun secret dans les messages');
  for (const x of bad) assert.ok(x.fix);
});

test('exercice de restauration : la vraie copie est relue dans un dossier temporaire, la base réelle intacte', async () => {
  const fs = require('fs');
  const { db: realDb, DB_FILE } = require('../src/store');
  const dbb = require('../src/dbbackup');
  realDb.levels = { u1: { xp: 42 } };
  const before = fs.statSync(DB_FILE).mtimeMs;
  const e = dbb.create('manual');
  assert.ok(e.verified);
  const r = await dbb.drill(e.file);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.levels, 1);
  assert.ok(fs.statSync(DB_FILE).mtimeMs >= before);
  assert.deepEqual(realDb.levels, { u1: { xp: 42 } });
  const bad = await dbb.drill('/nexiste/pas.db');
  assert.equal(bad.ok, false);
});

test('mise à jour : les tests passent AVANT la configuration du serveur et le redémarrage', () => {
  const s = require('fs').readFileSync(require('path').join(__dirname, '..', 'scripts', 'update.sh'), 'utf8');
  const tests = s.indexOf('npm test');
  assert.ok(tests > 0);
  assert.ok(tests < s.indexOf('npm run setup'), 'tests avant /setup');
  assert.ok(tests < s.indexOf('pm2 restart'), 'tests avant redémarrage');
  assert.match(s, /flock -n 9/);
  assert.match(s, /update-blocked\.json/);
});

test('guardian : incidents ouverts, aggravés, vus par un admin puis résolus', () => {
  const t0 = Date.now();
  const warn = [{ id: 'stats', label: 'Salons compteurs', status: 'warn', detail: 'en retard', fix: '/stats rafraichir' }];
  let r = g.track(warn, t0);
  assert.equal(r.opened.length, 1);
  const inc = r.opened[0];
  r = g.track([{ ...warn[0], status: 'error' }], t0 + 60_000);
  assert.equal(r.worsened.length, 1);
  assert.equal(inc.worst, 'error');
  g.acknowledge(inc.id, 'Haro');
  assert.equal(inc.ack.by, 'Haro');
  r = g.track([], t0 + 120_000);
  assert.equal(r.resolved.length, 1);
  assert.equal(inc.resolvedAt, t0 + 120_000);
  r = g.track(warn, t0 + 180_000); // le même problème revient : nouvel incident
  assert.equal(r.opened.length, 1);
  assert.notEqual(r.opened[0].id, inc.id);
  assert.throws(() => g.acknowledge('inconnu', 'x'), /introuvable/);
});

test('guardian : commandes qui échouent souvent et tâches bloquées repérées', async () => {
  for (let k = 0; k < 4; k++) g.commandResult('play', false, 'Error: yt-dlp n\'est pas installé');
  g.commandResult('play', true);
  for (let k = 0; k < 10; k++) g.commandResult('rang', true);
  g.commandResult('rang', false, 'oups');
  const stats = g.commandStats();
  assert.equal(stats[0].name, 'play');
  assert.equal(stats[0].fail, 4);
  const checks = g.runChecks({ isReady: () => true, ws: { ping: 10 } }, null);
  const play = checks.find((c) => c.id === 'cmd:play');
  assert.ok(play && play.status === 'error', 'play échoue 80 % du temps');
  assert.match(play.fix, /yt-dlp/);
  assert.ok(!checks.find((c) => c.id === 'cmd:rang'), '1 échec sur 11 : pas d\'alerte');

  // Tâche qui ne termine plus : en retard ; tâche qui tourne : ok
  const timer = g.every('test-ok', 'Tâche test', 60_000, () => {});
  clearInterval(timer);
  g.tasks.get('test-ok').since = Date.now() - 4 * 60_000;
  g.tasks.get('test-ok').last = Date.now();
  g.every('test-bloquee', 'Tâche bloquée', 60_000, () => new Promise(() => {})).unref();
  g.tasks.get('test-bloquee').since = Date.now() - 10 * 60_000;
  const late = g.lateTasks().map((t) => t.key);
  assert.ok(late.includes('test-bloquee'));
  assert.ok(!late.includes('test-ok'));
  for (const [k, t] of g.tasks) if (k.startsWith('test')) g.tasks.delete(k), void t;
});

test('historique des réglages : auteur, avant → après, regroupement, secrets masqués', async () => {
  const settings = require('../src/settings');
  db.configHistory = [];
  await settings.withActor({ user: 'Haro', source: 'web', page: '/bienvenue' }, async () => {
    settings.set('welcome.enabled', false);
    settings.set('welcome.message', 'Salut {user} !');
    settings.set('welcome.message', 'Salut {user} !'); // sans changement : rien de plus
  });
  settings.set('stream.apiToken', 'abc123'); // valeur sensible, auteur « bot »
  const [last, first] = db.configHistory;
  assert.equal(first.user, 'Haro');
  assert.equal(first.source, 'web');
  assert.equal(first.changes.length, 2, 'un seul formulaire = une seule entrée');
  assert.deepEqual(first.changes.find((c) => c.path === 'welcome.enabled'), { path: 'welcome.enabled', before: 'true', after: 'false' });
  assert.equal(last.source, 'bot');
  assert.equal(last.changes[0].after, '••••••');
  assert.ok(!JSON.stringify(db.configHistory).includes('abc123'));
  settings.reset(['welcome']);
  assert.ok(db.configHistory[0].changes.some((c) => c.path === 'welcome.enabled' && c.after === '(remis par défaut)'));
});

test('mode maintenance : coupe sans perdre les réglages, fin automatique, rappel du gardien', () => {
  const settings = require('../src/settings');
  settings.set('notifications.tiktok', true);
  settings.set('maintenance', { active: true, modules: ['tiktok', 'music'], staffOnly: true, since: Date.now() - 3 * 3600_000, until: null, by: 'Haro' });
  assert.equal(settings.on('tiktok'), false);
  assert.equal(settings.get('notifications.tiktok'), false, 'lecture directe aussi coupée');
  assert.equal(settings.raw('notifications.tiktok'), true, 'le réglage enregistré est intact');
  assert.equal(settings.on('levels'), true, 'les autres modules continuent');
  const checks = g.runChecks({ isReady: () => true, ws: { ping: 10 } }, null);
  assert.equal(checks.find((c) => c.id === 'maintenance')?.status, 'warn');
  // Fin automatique
  settings.set('maintenance', { ...settings.raw('maintenance'), until: Date.now() - 1000 });
  assert.equal(settings.maintenance(), null);
  assert.equal(settings.on('tiktok'), true);
  settings.set('maintenance', { active: false });
});

test('comparateur de sauvegardes : rôles, salons, serveur et réglages', () => {
  const { compare } = require('../src/backup');
  const base = {
    guild: { id: 'G', name: 'Ronins', verificationLevel: 1, everyonePermissions: '0' },
    roles: [
      { id: 'r1', name: '⚔️ Ronin', color: 1, hoist: false, mentionable: false, permissions: '0' },
      { id: 'r2', name: '🎨 Artiste', color: 2, hoist: false, mentionable: false, permissions: '0' },
    ],
    channels: [
      { id: 'cat', name: 'DOJO', type: 4, parentId: null },
      { id: 'c1', name: 'discussion', type: 0, parentId: 'cat', topic: 'a', overwrites: [] },
    ],
    settings: { welcome: { enabled: true } },
  };
  const next = structuredClone(base);
  next.guild.verificationLevel = 2;
  next.roles[0].color = 9;
  next.roles.splice(1, 1);
  next.roles.push({ id: 'r3', name: '▶️ Notif YouTube', color: 3, hoist: false, mentionable: false, permissions: '0' });
  next.channels[1].topic = 'b';
  next.channels[1].parentId = null;
  next.channels.push({ id: 'c2', name: 'youtube', type: 0, parentId: 'cat', overwrites: [] });
  next.settings.welcome.enabled = false;
  const d = compare(base, next);
  assert.deepEqual(d.roles.added, ['▶️ Notif YouTube']);
  assert.deepEqual(d.roles.removed, ['🎨 Artiste']);
  assert.deepEqual(d.roles.changed, [{ name: '⚔️ Ronin', what: ['couleur'] }]);
  assert.deepEqual(d.channels.added, ['youtube (texte)']);
  assert.match(d.channels.changed[0].what.join(','), /déplacé.*sujet/);
  assert.deepEqual(d.guild, ['niveau de vérification']);
  assert.equal(d.settings[0].path, 'welcome.enabled');
  assert.equal(compare(base, base).total, 0);
});
