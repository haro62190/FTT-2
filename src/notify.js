/**
 * 🔔 Préférences de notification de chaque membre (/notifications) :
 *  - messages privés du bot : oui / non, et par type (rappels, suggestions, recherche de joueurs, parrainage, signalements) ;
 *  - heures calmes (pas de MP la nuit) : les messages qui peuvent attendre sont envoyés à la fin des heures calmes,
 *    les rappels liés à une heure précise sont simplement abandonnés ;
 *  - un maximum de MP par jour, pour que Kensei ne devienne jamais envahissant ;
 *  - les rôles de notification (🔴 Notif Live, ▶️ Notif YouTube…) à cocher au même endroit.
 * Les messages de modération (avertissement, expulsion, bannissement) ne passent pas par ici : ils sont toujours envoyés.
 */
const { ActionRowBuilder, EmbedBuilder, MessageFlags, SlashCommandBuilder, StringSelectMenuBuilder } = require('discord.js');
const { BRAND_COLOR, config, findRole } = require('./shared');
const { db, save } = require('./store');

const KINDS = {
  reminder: { label: 'Rappels de soirées et d\'événements', emoji: '⏰', timed: true },
  suggestion: { label: 'Suivi de mes suggestions', emoji: '💡' },
  lfg: { label: 'Quelqu\'un rejoint ma recherche de joueurs', emoji: '🎮', timed: true },
  referral: { label: 'Parrainage', emoji: '🤝' },
  report: { label: 'Suivi de mes signalements', emoji: '🚩' },
};
const QUIET = [
  ['none', 'Aucune', null],
  ['22-8', '22 h → 8 h', [22, 8]],
  ['23-9', '23 h → 9 h', [23, 9]],
  ['0-10', 'Minuit → 10 h', [0, 10]],
];
const CAPS = [3, 6, 10, 0]; // 0 = illimité
const DEFAULT = { dm: true, off: [], quiet: 'none', cap: 6 };

const all = () => (db.notifyPrefs ??= {});
const prefs = (id) => ({ ...DEFAULT, ...(all()[id] ?? {}) });
const setPrefs = (id, patch) => {
  all()[id] = { ...prefs(id), ...patch };
  save();
  return all()[id];
};
const parisHour = (now) => Number(new Date(now).toLocaleString('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }));
function inQuiet(p, now = Date.now()) {
  const range = QUIET.find(([k]) => k === p.quiet)?.[2];
  if (!range) return false;
  const [from, to] = range;
  const h = parisHour(now) % 24;
  return from < to ? h >= from && h < to : h >= from || h < to;
}
const dayKey = (now) => new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
function countToday(id, now = Date.now()) {
  const c = (db.notifyCount ??= {});
  const k = dayKey(now);
  if (c._day !== k) {
    for (const key of Object.keys(c)) delete c[key];
    c._day = k;
  }
  return c[id] ?? 0;
}

/**
 * Décide si un MP peut partir maintenant : 'send' · 'queue' (heures calmes, message qui peut attendre) · 'skip'.
 */
function decide(userId, kind, now = Date.now()) {
  const p = prefs(userId);
  if (!p.dm || p.off.includes(kind)) return 'skip';
  if (p.cap && countToday(userId, now) >= p.cap) return 'skip';
  if (inQuiet(p, now)) return KINDS[kind]?.timed ? 'skip' : 'queue';
  return 'send';
}

let clientRef = null;
/** Envoie un MP en respectant les préférences du membre. Renvoie 'sent' | 'queued' | 'skipped' | 'failed'. */
async function dm(client, userId, payload, kind) {
  clientRef ??= client;
  const d = decide(userId, kind);
  if (d === 'skip') return 'skipped';
  if (d === 'queue') {
    (db.notifyQueue ??= []).push({ userId, payload: typeof payload === 'string' ? { content: payload } : payload, kind, at: Date.now() });
    if (db.notifyQueue.length > 500) db.notifyQueue.splice(0, db.notifyQueue.length - 500);
    save();
    return 'queued';
  }
  try {
    await client.users.send(userId, payload);
    const c = (db.notifyCount ??= {});
    countToday(userId);
    c[userId] = (c[userId] ?? 0) + 1;
    save();
    return 'sent';
  } catch {
    return 'failed';
  }
}

/** Toutes les 10 min : envoie les MP mis en attente pendant les heures calmes (abandonnés après 24 h). */
async function flush(client = clientRef) {
  const q = db.notifyQueue ?? [];
  if (!q.length || !client) return;
  const keep = [];
  for (const item of q) {
    if (Date.now() - item.at > 86_400_000) continue;
    const d = decide(item.userId, item.kind);
    if (d === 'queue') keep.push(item);
    else if (d === 'send') await dm(client, item.userId, item.payload, item.kind);
  }
  db.notifyQueue = keep;
  save();
}

function start(client) {
  clientRef = client;
  require('./guardian').every('notify', 'MP en attente', 10 * 60_000, () => flush(client)).unref?.();
}

// ───────── Panneau /notifications ─────────
const notifRoles = () => config.roles.filter((r) => r.key.startsWith('notif_') && r.selfAssign);

function panel(member) {
  const p = prefs(member.id);
  const has = (key) => {
    const r = findRole(member.guild, key);
    return !!r && member.roles.cache.has(r.id);
  };
  const quietLabel = QUIET.find(([k]) => k === p.quiet)?.[1] ?? 'Aucune';
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🔔 Mes notifications')
    .setDescription(
      [
        `📣 **Mentions** : ${notifRoles().filter((r) => has(r.key)).map((r) => r.name).join(', ') || 'aucune'}`,
        `✉️ **Messages privés du bot** : ${p.dm ? 'oui' : 'non'}${p.dm && p.off.length ? ` (sauf ${p.off.map((k) => KINDS[k]?.label.toLowerCase()).filter(Boolean).join(', ')})` : ''}`,
        `🌙 **Heures calmes** : ${quietLabel}`,
        `📏 **Maximum par jour** : ${p.cap || 'illimité'}`,
        '',
        '_Les messages de modération te sont toujours envoyés._',
      ].join('\n'),
    );
  const rows = [];
  const roles = notifRoles().filter((r) => findRole(member.guild, r.key));
  if (roles.length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('nf:roles')
          .setPlaceholder('Les annonces qui te mentionnent')
          .setMinValues(0)
          .setMaxValues(roles.length)
          .addOptions(roles.map((r) => ({ label: r.name.replace(/^\S+\s/, ''), value: r.key, emoji: r.emoji, description: r.description?.slice(0, 100), default: has(r.key) }))),
      ),
    );
  }
  rows.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('nf:kinds')
        .setPlaceholder('Les MP que tu acceptes')
        .setMinValues(0)
        .setMaxValues(Object.keys(KINDS).length)
        .addOptions(Object.entries(KINDS).map(([value, k]) => ({ label: k.label, value, emoji: k.emoji, default: p.dm && !p.off.includes(value) }))),
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('nf:quiet')
        .setPlaceholder('Heures calmes')
        .addOptions(QUIET.map(([value, label]) => ({ label: `🌙 ${label}`, value, default: p.quiet === value }))),
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('nf:cap')
        .setPlaceholder('Maximum de MP par jour')
        .addOptions(CAPS.map((c) => ({ label: c ? `📏 ${c} MP par jour maximum` : '📏 Pas de limite', value: String(c), default: p.cap === c }))),
    ),
  );
  return { embeds: [embed], components: rows, flags: MessageFlags.Ephemeral };
}

async function handleInteraction(i) {
  const id = i.customId ?? '';
  if (!id.startsWith('nf:') || !i.isStringSelectMenu()) return false;
  const member = await i.guild.members.fetch(i.user.id);
  if (id === 'nf:roles') {
    for (const r of notifRoles()) {
      const role = findRole(i.guild, r.key);
      if (!role?.editable) continue;
      const want = i.values.includes(r.key);
      if (want && !member.roles.cache.has(role.id)) await member.roles.add(role, 'Préférences de notification').catch(() => {});
      if (!want && member.roles.cache.has(role.id)) await member.roles.remove(role, 'Préférences de notification').catch(() => {});
    }
    await member.fetch(true).catch(() => {});
  } else if (id === 'nf:kinds') {
    const off = Object.keys(KINDS).filter((k) => !i.values.includes(k));
    setPrefs(i.user.id, { dm: i.values.length > 0, off: i.values.length ? off : [] });
  } else if (id === 'nf:quiet') {
    if (QUIET.some(([k]) => k === i.values[0])) setPrefs(i.user.id, { quiet: i.values[0] });
  } else if (id === 'nf:cap') {
    const c = Number(i.values[0]);
    if (CAPS.includes(c)) setPrefs(i.user.id, { cap: c });
  }
  const { flags, ...rest } = panel(member);
  await i.update(rest);
  return true;
}

const commands = [
  {
    category: '🎉 Général',
    data: new SlashCommandBuilder().setName('notifications').setDescription('Choisir tes notifications : mentions, MP du bot, heures calmes, maximum par jour'),
    async run(i) {
      const member = await i.guild.members.fetch(i.user.id);
      return i.reply(panel(member));
    },
  },
];

module.exports = { KINDS, prefs, setPrefs, decide, inQuiet, dm, flush, start, panel, handleInteraction, commands };
