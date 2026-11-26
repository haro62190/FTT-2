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

// ───────── Contrôles ─────────
const ago = (t) => (t ? Math.round((Date.now() - t) / 60_000) : Infinity);

function checkYtdlp() {
  if (Date.now() - ytdlpCheckedAt < 3600_000) return;
  ytdlpCheckedAt = Date.now();
  execFile(require('./ytdlp').YTDLP, ['--version'], { timeout: 10_000 }, (err) => (ytdlpOk = !err));
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

async function run() {
  checkYtdlp();
  const checks = runChecks();
  const s = state();
  const changes = [];
  const seen = new Set();
  for (const c of checks) {
    if (c.status !== 'warn' && c.status !== 'error') continue;
    seen.add(c.id);
    const prev = s.issues[c.id];
    if (!prev || prev.status !== c.status || Date.now() - prev.notifiedAt > REMIND_MS) {
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

module.exports = { start, run, runChecks, repeatedErrors, recordLog, keyOf, fixFor, reportEmbed, ICON, commands };
