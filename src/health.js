/**
 * Santé du bot :
 *  - battement de cœur (data/heartbeat.json) lu par scripts/update.sh pour décider d'un retour arrière
 *  - erreurs graves postées dans 🚨┃alertes-sécurité (sans spam)
 *  - /statut : temps de marche, latence, mémoire, version, dernières sauvegardes
 *  - prévient le staff si la dernière mise à jour a été annulée (retour arrière)
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { EmbedBuilder, MessageFlags, PermissionFlagsBits: P, SlashCommandBuilder } = require('discord.js');
const { BRAND_COLOR, findChannel } = require('./shared');
const { db } = require('./store');

const DATA = require('./store').DIR;
const HEARTBEAT = path.join(DATA, 'heartbeat.json');
const ROLLBACK = path.join(DATA, 'rollback.json');
const startedAt = Date.now();

function version() {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%h|%cI|%s'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 5000 }).trim();
    const [sha, date, subject] = out.split('|');
    return { sha, date, subject };
  } catch {
    return { sha: '?', date: null, subject: '' };
  }
}
const VERSION = version();

let guildRef = null;
const lastAlert = new Map();

/** Poste une alerte staff, au plus une fois toutes les 10 minutes pour la même erreur. */
async function alert(title, text) {
  const key = `${title}:${String(text).slice(0, 80)}`;
  if (Date.now() - (lastAlert.get(key) ?? 0) < 10 * 60_000) return;
  lastAlert.set(key, Date.now());
  const channel = guildRef && (findChannel(guildRef, 'security_alerts') ?? findChannel(guildRef, 'mod_logs'));
  await channel
    ?.send({ embeds: [new EmbedBuilder().setColor(0xff8800).setTitle(`⚠️ ${title}`).setDescription(`\`\`\`\n${require('./redact').redact(text).slice(0, 1800)}\n\`\`\``).setTimestamp()] })
    .catch(() => {});
}

function beat(client) {
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(HEARTBEAT, JSON.stringify({ at: Date.now(), pid: process.pid, ready: client.isReady(), ping: client.ws.ping, sha: VERSION.sha }));
  } catch {}
}

/** Erreurs non rattrapées : notées dans le terminal + alerte staff. */
function installErrorHandlers(client) {
  process.on('unhandledRejection', (err) => {
    console.error('Erreur non gérée :', err);
    alert('Erreur du bot', err?.stack ?? err).catch(() => {});
  });
  process.on('uncaughtException', (err) => {
    console.error('Erreur fatale :', err);
    // On enregistre les données, on prévient, puis on quitte : pm2 (ou npm run dev) redémarre un bot propre
    try {
      require('./store').flush();
    } catch {}
    alert('Erreur fatale — redémarrage', err?.stack ?? err).finally(() => setTimeout(() => process.exit(1), 1500));
  });
  client.on('error', (err) => alert('Erreur Discord', err?.message ?? err).catch(() => {}));
}

async function start(client, guild) {
  guildRef = guild;
  const { recovery } = require('./store');
  if (recovery.happened) {
    await alert('Base de données restaurée', `${recovery.reason}\n${recovery.from ? `Copie utilisée : ${recovery.from}` : 'Aucune copie disponible : base repartie de zéro.'}\nL'ancienne base a été gardée de côté dans data/.`);
  }
  beat(client);
  setInterval(() => beat(client), 20_000).unref();
  // Le script de mise à jour a annulé la dernière version : on prévient le staff
  if (fs.existsSync(ROLLBACK)) {
    try {
      const r = JSON.parse(fs.readFileSync(ROLLBACK, 'utf8'));
      await alert('Mise à jour annulée automatiquement', `La version ${r.bad?.slice(0, 7)} empêchait le bot de démarrer.\nRetour à ${r.good?.slice(0, 7)} effectué le ${new Date(r.at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}.\nCette version sera ignorée jusqu'à la prochaine correction sur GitHub.`);
    } catch {}
    fs.rmSync(ROLLBACK, { force: true });
  }
}

function fmtUptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return [d && `${d} j`, (d || h) && `${h} h`, `${m} min`].filter(Boolean).join(' ');
}

function status(client) {
  const mem = process.memoryUsage();
  const dbFile = path.join(DATA, 'ronin.db');
  const dbSize = fs.existsSync(dbFile) ? fs.statSync(dbFile).size : 0;
  const lastBackup = require('./backup').listBackups()[0];
  return {
    ok: client.isReady(),
    uptime: Date.now() - startedAt,
    ping: client.ws.ping,
    memoryMb: Math.round(mem.rss / 1024 / 1024),
    node: process.version,
    version: VERSION,
    dbKb: Math.round(dbSize / 1024),
    lastBackup: lastBackup?.created_at ?? null,
    lastOffsite: db.lastOffsiteBackup ?? null,
    lastFileBackup: db.lastFileBackup ?? null,
  };
}

const commands = [
  {
    category: '🏯 Kensei',
    staff: true,
    data: new SlashCommandBuilder().setName('statut').setDescription('État du bot : temps de marche, latence, version, sauvegardes').setDefaultMemberPermissions(P.ManageGuild),
    run(i) {
      const s = status(i.client);
      const t = (ms) => (ms ? `<t:${Math.floor(ms / 1000)}:R>` : 'jamais');
      return i.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [
          new EmbedBuilder()
            .setColor(BRAND_COLOR)
            .setTitle('🩺 État de 剣聖 Kensei')
            .addFields(
              { name: '⏱️ En marche depuis', value: fmtUptime(s.uptime), inline: true },
              { name: '📶 Latence', value: `${s.ping} ms`, inline: true },
              { name: '🧠 Mémoire', value: `${s.memoryMb} Mo`, inline: true },
              { name: '🏷️ Version', value: `\`${s.version.sha}\` ${s.version.date ? `<t:${Math.floor(new Date(s.version.date) / 1000)}:R>` : ''}\n${s.version.subject.slice(0, 100)}` },
              { name: '💾 Sauvegarde serveur', value: t(s.lastBackup), inline: true },
              { name: '📦 Copie de la base', value: t(s.lastOffsite), inline: true },
              { name: '🗄️ Base', value: `${s.dbKb} Ko · Node ${s.node}`, inline: true },
            ),
        ],
      });
    },
  },
];

module.exports = { start, installErrorHandlers, status, alert, commands, VERSION };
