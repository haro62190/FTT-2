/**
 * 🛡️ Kensei Guardian : surveille le bot en permanence, sans JAMAIS rien modifier sur le serveur.
 *  - contrôle tous les modules et intégrations toutes les 5 minutes ;
 *  - repère les erreurs répétées (la même erreur 5 fois en une heure) ;
 *  - repère les intégrations qui ne répondent plus (Twitch, TikTok, YouTube, compteurs, sauvegardes…) ;
 *  - prévient les admins dans 🚨┃alertes-sécurité quand un problème apparaît, puis quand il est résolu ;
 *  - propose pour chaque problème une correction à faire soi-même (commande, page du site, réglage).
 */
const fs = require('fs');
const { execFile } = require('child_process');
const { EmbedBuilder, MessageFlags, PermissionFlagsBits: P, SlashCommandBuilder } = require('discord.js');
const { config, findChannel, findRole } = require('./shared');
const { db, save } = require('./store');
const settings = require('./settings');

const EVERY_MS = 5 * 60_000;
const REPEAT_WINDOW = 60 * 60_000;
const REPEAT_MIN = 5;
const REMIND_MS = 12 * 3600_000;
const ICON = { ok: '🟢', warn: '🟠', error: '🔴', off: '⚪' };

const state = () => (db.guardian ??= { issues: {}, lastRun: 0 });
let clientRef = null;
let guildRef = null;
let ytdlpOk = null;
let ytdlpCheckedAt = 0;

// ───────── Erreurs répétées (alimenté par le journal) ─────────
const recent = []; // { at, key, text }
/** Normalise un message d'erreur : chiffres, IDs et URLs retirés pour regrouper les répétitions. */
const keyOf = (text) =>
  String(text)
    .split('\n')[0]
    .replace(/https?:\/\/\S+/g, 'URL')
    .replace(/\d+/g, '#')
    .slice(0, 160);
function recordLog(level, text) {
  if (level !== 'ERREUR') return;
  recent.push({ at: Date.now(), key: keyOf(text), text: String(text).split('\n')[0].slice(0, 300) });
  while (recent.length && Date.now() - recent[0].at > REPEAT_WINDOW) recent.shift();
  if (recent.length > 2000) recent.splice(0, recent.length - 2000);
}
function repeatedErrors() {
  const groups = new Map();
  for (const e of recent) {
    if (Date.now() - e.at > REPEAT_WINDOW) continue;
    const g = groups.get(e.key) ?? { count: 0, text: e.text, last: 0 };
    g.count++;
    g.last = Math.max(g.last, e.at);
    groups.set(e.key, g);
  }
  return [...groups.values()].filter((g) => g.count >= REPEAT_MIN).sort((a, b) => b.count - a.count);
}

/** Correction proposée selon le module de l'erreur (préfixe « Module : … »). */
function fixFor(text) {
  const t = String(text).toLowerCase();
  if (t.includes('yt-dlp')) return 'Installer ou mettre à jour yt-dlp sur le VPS (README → Musique) : `yt-dlp -U`.';
  if (t.startsWith('tiktok')) return 'Vérifier le compte TikTok sur la page 📡 du site ; mettre yt-dlp à jour (`yt-dlp -U`).';
  if (t.startsWith('youtube')) return 'Vérifier la chaîne sur la page 📡 du site (« Enregistrer et tester ») ; mettre l\'ID UC… de la chaîne.';
  if (t.includes('twitch')) return 'Vérifier la chaîne Twitch et TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET dans .env.';
  if (t.includes('missing permissions') || t.includes('permission')) return 'Donner au bot les permissions manquantes : `npm run invite` sur le VPS, ou mettre son rôle tout en haut.';
  if (t.includes('unknown channel') || t.includes('unknown message')) return 'Un salon ou un message du bot a été supprimé : relancer `/setup`.';
  if (t.includes('enospc') || t.includes('no space')) return 'Disque plein : supprimer de vieux fichiers sur le VPS.';
  return 'Regarder le détail dans 💓 État du bot → Dernières erreurs ; si ça persiste, redémarrer le bot (`pm2 restart bot-discord`).';
}

// ───────── Tâches automatiques (battement à la fin de chaque passage) ─────────
const tasks = new Map(); // key → { label, ms, since, last, runs }
/** setInterval suivi par le gardien : il prévient si la tâche ne termine plus ses passages. */
function every(key, label, ms, fn) {
  const t = { label, ms, since: Date.now(), last: null, runs: 0 };
  tasks.set(key, t);
  const run = () =>
    Promise.resolve()
      .then(fn)
      .catch(() => {})
      .finally(() => {
        t.last = Date.now();
        t.runs++;
      });
  return setInterval(run, ms);
}
/** Tâches en retard : aucun passage terminé depuis 3 intervalles (5 min minimum). */
function lateTasks(now = Date.now()) {
  return [...tasks.entries()]
    .map(([key, t]) => ({ key, ...t, limit: Math.max(3 * t.ms, 5 * 60_000) }))
    .filter((t) => now - (t.last ?? t.since) > t.limit);
}

// ───────── Commandes qui échouent ─────────
const CMD_WINDOW = 24 * 3600_000;
const cmdEvents = []; // { at, name, ok, error }
/** Appelé par commands.handle après chaque commande. */
function commandResult(name, ok, error = null) {
  cmdEvents.push({ at: Date.now(), name, ok, error: error ? String(error).split('\n')[0].slice(0, 200) : null });
  while (cmdEvents.length && Date.now() - cmdEvents[0].at > CMD_WINDOW) cmdEvents.shift();
  if (cmdEvents.length > 5000) cmdEvents.splice(0, cmdEvents.length - 5000);
}
/** Statistiques par commande sur 24 h, les plus fragiles d'abord. */
function commandStats() {
  const by = new Map();
  for (const e of cmdEvents) {
    if (Date.now() - e.at > CMD_WINDOW) continue;
    const c = by.get(e.name) ?? { name: e.name, ok: 0, fail: 0, lastError: null };
    if (e.ok) c.ok++;
    else {
      c.fail++;
      c.lastError = e.error;
    }
    by.set(e.name, c);
  }
  return [...by.values()].map((c) => ({ ...c, rate: c.fail / (c.ok + c.fail) })).sort((a, b) => b.fail - a.fail || b.ok - a.ok);
}

// ───────── Contrôles ─────────
const ago = (t) => (t ? Math.round((Date.now() - t) / 60_000) : Infinity);

function checkYtdlp() {
  if (Date.now() - ytdlpCheckedAt < 3600_000) return;
  ytdlpCheckedAt = Date.now();
  execFile(require('./ytdlp').YTDLP, ['--version'], { timeout: 10_000 }, (err) => (ytdlpOk = !err));
}

/** Erreurs de configuration (.env, réglages) : [{ id, status, detail, fix }]. Aucune valeur secrète n'est affichée. */
function configIssues(env = process.env) {
  const out = [];
  const add = (id, status, detail, fix) => out.push({ id: `cfg:${id}`, label: 'Configuration', status, detail, fix });
  const snowflake = (v) => /^\d{17,20}$/.test(String(v ?? '').trim());
  if (!env.DISCORD_TOKEN) add('token', 'error', 'DISCORD_TOKEN absent du fichier .env.', 'Ajouter le token du bot dans /root/bot/.env puis `pm2 restart bot-discord`.');
  if (!snowflake(env.GUILD_ID)) add('guild', 'error', 'GUILD_ID n\'est pas un identifiant de serveur valide (17 à 20 chiffres).', 'Clic droit sur le serveur → Copier l\'identifiant, le coller dans GUILD_ID du .env.');
  if (env.SECOURS_GUILD_ID && env.SECOURS_GUILD_ID === env.GUILD_ID) add('rescue', 'error', 'Le serveur de secours est le même que le serveur principal.', 'Mettre l\'identifiant d\'un AUTRE serveur dans SECOURS_GUILD_ID (ou le vider).');
  if (env.SECOURS_GUILD_ID && !snowflake(env.SECOURS_GUILD_ID)) add('rescue-id', 'warn', 'SECOURS_GUILD_ID n\'est pas un identifiant valide.', 'Corriger ou vider SECOURS_GUILD_ID dans .env.');
  if (env.DASHBOARD_ENABLED !== 'false') {
    if (!env.DISCORD_CLIENT_SECRET) add('secret', 'warn', 'DISCORD_CLIENT_SECRET absent : le site est désactivé.', 'Discord Developer Portal → OAuth2 → Client Secret, à mettre dans .env.');
    const url = String(env.DASHBOARD_URL ?? '');
    if (env.PUBLIC_HOST || /^https:/.test(url)) {
      if (url && !/^https:\/\//.test(url)) add('https', 'warn', 'DASHBOARD_URL n\'est pas en https:// alors que le site est en ligne.', 'Mettre DASHBOARD_URL=https://bot.haro62190.tech dans .env.');
      if (env.DASHBOARD_TRUST_PROXY !== '1')
        add('proxy', 'warn', `DASHBOARD_TRUST_PROXY n'est pas à 1 derrière Caddy : tous les visiteurs semblent venir de la même adresse (limites anti-abus faussées).${env.TRUST_PROXY ? ' Une variable TRUST_PROXY existe : elle n\'a pas le bon nom.' : ''}`, 'Mettre DASHBOARD_TRUST_PROXY=1 dans .env puis `pm2 restart bot-discord --update-env`.');
    }
    if (env.DASHBOARD_HOST && env.DASHBOARD_HOST !== '127.0.0.1' && env.DASHBOARD_HOST !== 'localhost' && env.PUBLIC_HOST)
      add('host', 'warn', `Le site écoute sur ${env.DASHBOARD_HOST} : il est joignable sans passer par Caddy (sans HTTPS).`, 'Mettre DASHBOARD_HOST=127.0.0.1 dans .env (Caddy reste le seul point d\'entrée).');
  }
  if (env.PUBLIC_HOST && /[/:]/.test(env.PUBLIC_HOST)) add('public', 'warn', 'PUBLIC_HOST doit être un nom de domaine seul (sans https:// ni /).', 'Mettre PUBLIC_HOST=haro62190.tech dans .env.');
  if (env.TWITCH_CLIENT_ID && !env.TWITCH_CLIENT_SECRET) add('twitch', 'warn', 'TWITCH_CLIENT_ID est rempli mais pas TWITCH_CLIENT_SECRET.', 'Ajouter TWITCH_CLIENT_SECRET (console des développeurs Twitch) dans .env.');
  return out;
}

/** Tous les contrôles : [{ id, label, status: ok|warn|error|off, detail, fix }] */
function runChecks(client = clientRef, guild = guildRef) {
  const out = [];
  const add = (id, label, status, detail = '', fix = '') => out.push({ id, label, status, detail, fix });

  // Discord
  const ping = client?.ws?.ping ?? -1;
  if (!client?.isReady?.()) add('discord', 'Connexion Discord', 'error', 'Le bot n\'est pas connecté.', 'Redémarrer le bot : `pm2 restart bot-discord`, puis vérifier DISCORD_TOKEN dans .env.');
  else if (ping > 1500) add('discord', 'Connexion Discord', 'warn', `Latence élevée : ${ping} ms.`, 'Souvent passager. Si ça dure, redémarrer le bot ou vérifier le réseau du VPS.');
  else add('discord', 'Connexion Discord', 'ok', `${ping} ms`);

  if (guild) {
    // Permissions
    const missing = require('./permissions').missing(guild);
    if (missing.length) add('permissions', 'Permissions du bot', 'error', `Manquantes : ${missing.join(', ')}`, 'Sur le VPS : `cd /root/bot && npm run invite`, ouvrir le 1er lien et valider.');
    else add('permissions', 'Permissions du bot', 'ok');

    // Rôle du bot au-dessus des rôles qu'il gère
    const blocked = config.roles.map((d) => findRole(guild, d.key)).filter((r) => r && !r.editable && !r.managed);
    if (blocked.length) add('hierarchy', 'Position du rôle du bot', 'warn', `Rôles au-dessus du bot : ${blocked.map((r) => r.name).slice(0, 6).join(', ')}`, 'Paramètres du serveur → Rôles : glisser le rôle du bot tout en haut.');
    else add('hierarchy', 'Position du rôle du bot', 'ok');

    // Structure (salons / rôles manquants)
    try {
      const p = require('./builder').plan(guild);
      const miss = [...p.rolesCreate, ...p.chCreate];
      if (miss.length) add('structure', 'Salons et rôles', 'warn', `${miss.length} manquant(s) : ${miss.slice(0, 6).join(', ')}${miss.length > 6 ? '…' : ''}`, 'Lancer `/setup` (crée ce qui manque, ne supprime rien).');
      else add('structure', 'Salons et rôles', 'ok');
    } catch {}
  }

  // Intégrations
  const st = db.stats ?? {};
  const { twitchLogin, tiktokUser } = require('./shared');
  if (!twitchLogin()) add('twitch', 'Twitch', 'off', 'Chaîne non configurée.', 'Page 📡 du site.');
  else if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) add('twitch', 'Twitch', 'error', 'Identifiants de l\'API absents.', 'Ajouter TWITCH_CLIENT_ID et TWITCH_CLIENT_SECRET dans .env puis redémarrer.');
  else if (st.twitchError) add('twitch', 'Twitch', 'warn', st.twitchError, fixFor(`twitch ${st.twitchError}`));
  else add('twitch', 'Twitch', 'ok');

  if (settings.get('notifications.tiktok') === false || !tiktokUser()) add('tiktok', 'TikTok', 'off');
  else if (ytdlpOk === false) add('tiktok', 'TikTok', 'error', 'yt-dlp n\'est pas installé.', fixFor('yt-dlp'));
  else if (st.tiktokError) add('tiktok', 'TikTok', 'warn', st.tiktokError, fixFor(`tiktok ${st.tiktokError}`));
  else add('tiktok', 'TikTok', 'ok');

  const yt = db.youtube ?? {};
  if (settings.get('notifications.youtube') === false || !require('./youtube').source()) add('youtube', 'YouTube', 'off');
  else if (yt.error) add('youtube', 'YouTube', 'warn', yt.error, fixFor(`youtube ${yt.error}`));
  else if (ago(yt.lastCheck) > 45) add('youtube', 'YouTube', 'warn', 'Pas de vérification depuis plus de 45 min.', 'Redémarrer le bot si ça dure.');
  else add('youtube', 'YouTube', 'ok');

  if (!settings.on('stats')) add('stats', 'Salons compteurs', 'off');
  else if (ago(st.updatedAt) > 40) add('stats', 'Salons compteurs', 'warn', `Dernière mise à jour il y a ${ago(st.updatedAt) === Infinity ? 'jamais' : `${ago(st.updatedAt)} min`}.`, 'Lancer `/stats rafraichir` ; si ça échoue, regarder 💓 État du bot.');
  else add('stats', 'Salons compteurs', 'ok');

  // Sauvegardes
  const lastFile = db.lastFileBackup?.at;
  if (ago(lastFile) > 26 * 60) add('backups', 'Copie de la base', 'warn', `Dernière copie : ${lastFile ? `il y a ${Math.round(ago(lastFile) / 60)} h` : 'jamais'}.`, 'Page 💾 Copies de la base du site → « Faire une copie maintenant ».');
  else if (db.lastFileBackup && !db.lastFileBackup.verified) add('backups', 'Copie de la base', 'error', 'La dernière copie n\'a pas passé la vérification.', 'Faire une nouvelle copie depuis le site ; si elle échoue aussi, prévenir le développeur.');
  else add('backups', 'Copie de la base', 'ok');

  const rescue = require('./rescue');
  if (rescue.rescueGuildId?.() && settings.on('rescue')) {
    const at = rescue.status(client).at;
    if (ago(at) > 36 * 60) add('rescue', 'Serveur de secours', 'warn', `Dernière copie : ${at ? `il y a ${Math.round(ago(at) / 60)} h` : 'jamais'}.`, 'Page 🛟 Serveur de secours → « Faire une copie maintenant ».');
    else add('rescue', 'Serveur de secours', 'ok');
  }

  // Exercice de restauration à blanc (chaque nuit, sur la dernière copie)
  const drill = db.lastRestoreDrill;
  if (drill && !drill.ok) add('drill', 'Exercice de restauration', 'error', `La copie ${drill.file} ne se restaure pas : ${drill.error}`, 'Faire une nouvelle copie depuis le site (💾 Copies de la base) ; si l\'exercice échoue encore, prévenir le développeur.');
  else if (drill && ago(drill.at) > 50 * 60) add('drill', 'Exercice de restauration', 'warn', `Dernier exercice il y a ${Math.round(ago(drill.at) / 60)} h.`, 'Il se lance après la copie de nuit : vérifier que les copies se font.');
  else if (drill) add('drill', 'Exercice de restauration', 'ok', `${drill.levels ?? 0} profils, ${drill.sections ?? 0} sections relues`);

  // Mise à jour bloquée par les tests
  try {
    const blocked = JSON.parse(fs.readFileSync(require('path').join(require('./store').DIR, 'update-blocked.json'), 'utf8'));
    add('update', 'Mise à jour', 'error', `La version ${String(blocked.bad).slice(0, 7)} a échoué aux tests : elle n'a pas été installée, le bot tourne toujours sur ${String(blocked.good).slice(0, 7)}.${blocked.failures ? ` (${String(blocked.failures).split('|').filter(Boolean).slice(0, 2).join(' · ')})` : ''}`, 'Rien à faire côté serveur : la correction doit venir du code (GitHub). Elle s\'installera seule une fois les tests réparés.');
  } catch {}

  // Mode maintenance oublié ?
  const maint = settings.maintenance();
  if (maint && !maint.until && Date.now() - maint.since > 2 * 3600_000) add('maintenance', 'Mode maintenance', 'warn', `Actif depuis ${Math.round((Date.now() - maint.since) / 3600_000)} h, sans fin prévue : ${(maint.modules ?? []).length} fonction(s) coupée(s).`, 'Site → 🛠️ Mode maintenance → « Terminer la maintenance » si elle n\'est plus utile.');
  else if (maint) add('maintenance', 'Mode maintenance', 'off', `En cours${maint.until ? `, fin automatique ${new Date(maint.until).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}` : ''}.`);

  // Configuration
  const cfg = configIssues();
  if (cfg.length) out.push(...cfg);
  else add('config', 'Configuration', 'ok');

  // Machine
  const rss = process.memoryUsage().rss / 1024 / 1024;
  if (rss > 1500) add('memory', 'Mémoire du bot', 'warn', `${Math.round(rss)} Mo utilisés.`, 'Redémarrer le bot (`pm2 restart bot-discord`) ; prévenir le développeur si ça revient.');
  else add('memory', 'Mémoire du bot', 'ok', `${Math.round(rss)} Mo`);
  try {
    const s = fs.statfsSync(require('./store').DIR);
    const freeMb = (s.bavail * s.bsize) / 1024 / 1024;
    if (freeMb < 300) add('disk', 'Espace disque', 'error', `Plus que ${Math.round(freeMb)} Mo libres.`, 'Libérer de la place sur le VPS (vieux journaux, `docker system prune`, `apt clean`).');
    else if (freeMb < 1024) add('disk', 'Espace disque', 'warn', `${Math.round(freeMb)} Mo libres.`, 'Penser à libérer de la place sur le VPS.');
    else add('disk', 'Espace disque', 'ok', `${(freeMb / 1024).toFixed(1).replace('.', ',')} Go libres`);
  } catch {}

  // Tâches automatiques
  const late = lateTasks();
  for (const t of late) add(`task:${t.key}`, `Tâche « ${t.label} »`, 'warn', `Aucun passage terminé depuis ${Math.round((Date.now() - (t.last ?? t.since)) / 60_000)} min (prévu toutes les ${Math.max(1, Math.round(t.ms / 60_000))} min).`, 'La tâche semble bloquée : redémarrer le bot (`pm2 restart bot-discord`) ; si ça revient, prévenir le développeur.');
  if (tasks.size && !late.length) add('tasks', 'Tâches automatiques', 'ok', `${tasks.size} tâches suivies`);

  // Commandes qui échouent souvent (au moins 3 échecs et 30 % des utilisations sur 24 h)
  for (const c of commandStats().filter((x) => x.fail >= 3 && x.rate >= 0.3).slice(0, 5)) {
    add(`cmd:${c.name}`, `Commande /${c.name}`, c.rate >= 0.7 ? 'error' : 'warn', `${c.fail} échec(s) sur ${c.ok + c.fail} utilisations en 24 h${c.lastError ? ` — ${c.lastError}` : ''}`, fixFor(`${c.name} ${c.lastError ?? ''}`));
  }

  // Erreurs répétées
  for (const g of repeatedErrors().slice(0, 5)) {
    add(`err:${keyOf(g.text)}`, 'Erreur répétée', 'error', `${g.count}× en 1 h : ${g.text}`, fixFor(g.text));
  }
  return out;
}

// ───────── Alertes (au changement d'état, rappel toutes les 12 h) ─────────
async function notify(guild, changes) {
  const channel = guild && (findChannel(guild, 'security_alerts') ?? findChannel(guild, 'mod_logs'));
  if (!channel || !changes.length) return;
  const embed = new EmbedBuilder()
    .setColor(changes.some((c) => c.status === 'error') ? 0xe10600 : changes.every((c) => c.resolved) ? 0x54c987 : 0xf5b942)
    .setTitle('🛡️ Kensei Guardian')
    .setDescription(
      changes
        .slice(0, 10)
        .map((c) => (c.resolved ? `✅ **${c.label}** : résolu.` : `${ICON[c.status]} **${c.label}**${c.detail ? ` — ${c.detail}` : ''}${c.fix ? `\n　💡 ${c.fix}` : ''}`))
        .join('\n')
        .slice(0, 4000),
    )
    .setFooter({ text: 'Je ne modifie jamais rien moi-même : ce sont des suggestions. /guardian pour tout voir.' })
    .setTimestamp();
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
}

// ───────── Historique des incidents ─────────
const KEEP_INCIDENTS = 300;
const incidents = () => (state().incidents ??= []);
const openIncident = (checkId) => incidents().find((x) => x.check === checkId && !x.resolvedAt);

/** Un admin indique qu'il a vu l'incident (rien d'autre ne change : le gardien ne corrige rien). */
function acknowledge(incidentId, who) {
  const inc = incidents().find((x) => x.id === incidentId);
  if (!inc) throw new Error('Incident introuvable.');
  if (!inc.ack) inc.ack = { by: String(who).slice(0, 64), at: Date.now() };
  save();
  return inc;
}

/** Met à jour l'historique à partir des contrôles. Renvoie { opened, worsened, resolved }. */
function track(checks, now = Date.now()) {
  const list = incidents();
  const bad = checks.filter((c) => c.status === 'warn' || c.status === 'error');
  const out = { opened: [], worsened: [], resolved: [] };
  for (const c of bad) {
    const inc = openIncident(c.id);
    if (!inc) {
      const n = { id: `i${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`, check: c.id, label: c.label, status: c.status, worst: c.status, detail: c.detail, fix: c.fix, openedAt: now, lastSeen: now, resolvedAt: null, ack: null };
      list.unshift(n);
      out.opened.push(n);
    } else {
      if (c.status === 'error' && inc.worst !== 'error') out.worsened.push(inc);
      inc.status = c.status;
      inc.worst = inc.worst === 'error' || c.status === 'error' ? 'error' : 'warn';
      inc.detail = c.detail;
      inc.fix = c.fix;
      inc.lastSeen = now;
    }
  }
  const active = new Set(bad.map((c) => c.id));
  for (const inc of list) {
    if (!inc.resolvedAt && !active.has(inc.check)) {
      inc.resolvedAt = now;
      out.resolved.push(inc);
    }
  }
  if (list.length > KEEP_INCIDENTS) list.length = KEEP_INCIDENTS;
  return out;
}

async function run() {
  checkYtdlp();
  const checks = runChecks();
  const s = state();
  track(checks);
  const changes = [];
  const seen = new Set();
  for (const c of checks) {
    if (c.status !== 'warn' && c.status !== 'error') continue;
    seen.add(c.id);
    const prev = s.issues[c.id];
    // Un incident déjà « vu » par un admin n'est plus rappelé toutes les 12 h (seulement s'il s'aggrave)
    const acked = openIncident(c.id)?.ack;
    if (!prev || prev.status !== c.status || (!acked && Date.now() - prev.notifiedAt > REMIND_MS)) {
      changes.push(c);
      s.issues[c.id] = { status: c.status, label: c.label, since: prev?.since ?? Date.now(), notifiedAt: Date.now() };
    }
  }
  for (const [id, prev] of Object.entries(s.issues)) {
    if (!seen.has(id)) {
      changes.push({ id, label: prev.label, resolved: true });
      delete s.issues[id];
    }
  }
  s.lastRun = Date.now();
  s.last = checks.map(({ id, label, status }) => ({ id, label, status }));
  save();
  if (settings.on('guardian')) await notify(guildRef, changes);
  return checks;
}

function start(client, guild) {
  clientRef = client;
  guildRef = guild;
  require('./logger').onLog(recordLog);
  require('./logger').onClear(() => recent.splice(0)); // erreurs effacées : le décompte des répétitions repart de zéro
  setTimeout(() => run().catch((e) => console.warn('Guardian :', e.message)), 90_000).unref(); // laisse les modules démarrer
  setInterval(() => run().catch((e) => console.warn('Guardian :', e.message)), EVERY_MS).unref();
}

function reportEmbed(checks) {
  const bad = checks.filter((c) => c.status === 'warn' || c.status === 'error');
  return new EmbedBuilder()
    .setColor(bad.some((c) => c.status === 'error') ? 0xe10600 : bad.length ? 0xf5b942 : 0x54c987)
    .setTitle(`🛡️ Kensei Guardian — ${bad.length ? `${bad.length} point(s) à regarder` : 'tout va bien'}`)
    .setDescription(
      checks
        .map((c) => `${ICON[c.status]} **${c.label}**${c.detail ? ` — ${c.detail}` : ''}${(c.status === 'warn' || c.status === 'error') && c.fix ? `\n　💡 ${c.fix}` : ''}`)
        .join('\n')
        .slice(0, 4000),
    )
    .setFooter({ text: 'Contrôles toutes les 5 minutes · suggestions seulement, rien n\'est modifié automatiquement' })
    .setTimestamp();
}

const commands = [
  {
    category: '🏯 Kensei',
    staff: true,
    data: new SlashCommandBuilder().setName('guardian').setDescription('🛡️ Kensei Guardian : contrôle complet du bot maintenant (staff)').setDefaultMemberPermissions(P.ManageGuild),
    async run(i) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const checks = runChecks(i.client, i.guild);
      return i.editReply({ embeds: [reportEmbed(checks)] });
    },
  },
];

module.exports = { start, run, runChecks, configIssues, track, acknowledge, incidents, every, lateTasks, tasks, commandResult, commandStats, repeatedErrors, recordLog, keyOf, fixFor, reportEmbed, ICON, commands };
