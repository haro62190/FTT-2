/**
 * Historique et statistiques des lives (Twitch et TikTok), paliers d'abonnés et commande /streams.
 *  - chaque live terminé est enregistré : durée, pic et moyenne de viewers, jeux, followers gagnés, rediffusion
 *  - paliers : 🎉 annonce quand les followers Twitch, abonnés TikTok ou membres Discord passent 100, 250, 500, 1000…
 *  - pendant un live, les messages Discord comptent pour le classement /top « pendant les lives »
 */
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { BRAND_COLOR, findChannel } = require('./shared');
const { db, save } = require('./store');
const settings = require('./settings');

const KEEP = 300;
const list = () => (db.streams ??= []);

/** Enregistre un live terminé (le plus récent en premier). */
function record(entry) {
  const durationMin = Math.max(0, Math.round((entry.endedAt - entry.startedAt) / 60_000));
  const s = { durationMin, ...entry };
  list().unshift(s);
  db.streams = list().slice(0, KEEP);
  save();
  return s;
}

/** Résumé sur une période : nombre de lives, heures, moyenne et pic de viewers, followers gagnés. */
function summary(days = 30, platform = null) {
  const since = Date.now() - days * 86_400_000;
  const items = list().filter((s) => s.endedAt >= since && (!platform || s.platform === platform));
  const withViewers = items.filter((s) => typeof s.avg === 'number');
  return {
    count: items.length,
    hours: items.reduce((n, s) => n + s.durationMin, 0) / 60,
    avg: withViewers.length ? withViewers.reduce((n, s) => n + s.avg, 0) / withViewers.length : null,
    peak: items.reduce((n, s) => Math.max(n, s.peak ?? 0), 0) || null,
    followers: items.reduce((n, s) => n + (s.followersGained ?? 0), 0),
    games: Object.entries(items.flatMap((s) => s.games ?? []).reduce((m, g) => ((m[g] = (m[g] ?? 0) + 1), m), {}))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5),
  };
}

/** Comparaison d'un live avec la moyenne des `n` lives précédents de la même plateforme (en %). */
function compare(entry, n = 4) {
  const prev = list()
    .filter((s) => s !== entry && s.platform === entry.platform && s.startedAt < entry.startedAt)
    .slice(0, n);
  if (!prev.length) return null;
  const mean = (f) => {
    const v = prev.map(f).filter((x) => typeof x === 'number');
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const delta = (cur, ref) => (typeof cur === 'number' && ref ? Math.round(((cur - ref) / ref) * 100) : null);
  return {
    count: prev.length,
    avg: delta(entry.avg, mean((s) => s.avg)),
    peak: delta(entry.peak, mean((s) => s.peak)),
    duration: delta(entry.durationMin, mean((s) => s.durationMin)),
    followers: typeof entry.followersGained === 'number' ? entry.followersGained - Math.round(mean((s) => s.followersGained) ?? 0) : null,
  };
}

/** Lives regroupés par semaine (lundi), de la plus récente à la plus ancienne. */
function weekly(weeks = 8, platform = 'twitch') {
  const monday = (t) => {
    const d = new Date(new Date(t).toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  };
  const start = monday(Date.now());
  const out = [];
  for (let w = 0; w < weeks; w++) {
    const from = new Date(start);
    from.setDate(from.getDate() - 7 * w);
    const to = new Date(from);
    to.setDate(to.getDate() + 7);
    const items = list().filter((s) => (!platform || s.platform === platform) && monday(s.startedAt).getTime() === from.getTime());
    const withAvg = items.filter((s) => typeof s.avg === 'number');
    out.push({
      week: from,
      count: items.length,
      hours: items.reduce((n, s) => n + s.durationMin, 0) / 60,
      avg: withAvg.length ? withAvg.reduce((n, s) => n + s.avg, 0) / withAvg.length : null,
      peak: items.reduce((n, s) => Math.max(n, s.peak ?? 0), 0) || null,
      followers: items.reduce((n, s) => n + (s.followersGained ?? 0), 0),
    });
  }
  return out;
}

const fmtDuration = (min) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min} min`);

/** Bouton « Regarder » pour les annonces de live. */
const watchButton = (url, label = 'Regarder le live') =>
  new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel(label).setEmoji('▶️'));

// ───────────────────────── Paliers d'abonnés ─────────────────────────

const STEPS = [10, 25, 50, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000, 15000, 20000, 25000, 50000, 75000, 100000];
/** Plus haut palier atteint (au-delà de 100 000 : tous les 50 000). */
function milestoneOf(n) {
  if (!Number.isFinite(n) || n < STEPS[0]) return 0;
  if (n >= 100000) return Math.floor(n / 50000) * 50000;
  return STEPS.filter((s) => s <= n).at(-1);
}

const PLATFORM = {
  twitch: { label: 'followers sur Twitch', emoji: '🟣', url: () => `https://twitch.tv/${require('./shared').twitchLogin()}` },
  tiktok: { label: 'abonnés sur TikTok', emoji: '📱', url: () => `https://www.tiktok.com/@${require('./shared').tiktokUser()}` },
  youtube: { label: 'abonnés sur YouTube', emoji: '▶️', url: () => (db.youtube?.channelId ? `https://www.youtube.com/channel/${db.youtube.channelId}` : null) },
  discord: { label: 'membres sur le Discord', emoji: '👥', url: () => null },
};

/** Appelé à chaque mise à jour des compteurs. Premier passage : on mémorise sans annoncer. */
async function checkMilestones(guild, counts) {
  const m = (db.milestones ??= {});
  for (const [key, n] of Object.entries(counts)) {
    if (!PLATFORM[key] || typeof n !== 'number') continue;
    const reached = milestoneOf(n);
    if (m[key] === undefined) {
      m[key] = reached;
      continue;
    }
    if (reached <= m[key]) continue;
    m[key] = reached;
    save();
    if (!settings.on('milestones')) continue;
    const p = PLATFORM[key];
    const channel = findChannel(guild, 'announcements') ?? findChannel(guild, 'general');
    const url = p.url();
    await channel
      ?.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xffc400)
            .setTitle(`🎉 ${reached.toLocaleString('fr-FR')} ${p.label} !`)
            .setDescription(`${p.emoji} On vient de passer la barre des **${reached.toLocaleString('fr-FR')} ${p.label}** (${n.toLocaleString('fr-FR')} actuellement).\nMerci à tous les ronins ⚔️ Prochain objectif : **${(STEPS.find((s) => s > n) ?? reached + 50000).toLocaleString('fr-FR')}** !`),
        ],
        components: url ? [watchButton(url, 'Voir la chaîne')] : [],
      })
      .catch(() => {});
    require('./feed').push('🎉', `Palier atteint : ${reached.toLocaleString('fr-FR')} ${p.label}`);
    console.log(`🎉 Palier ${key} : ${reached}`);
  }
  save();
}

// ───────────────────────── Activité pendant les lives ─────────────────────────

const isLive = () => Boolean(db.twitchLive || db.tiktok?.liveId);

function onMessage(userId) {
  if (!isLive()) return;
  require('./memberstats').bump(userId, 'liveMessages');
  require('./social').track(userId, 'live');
  require('./challenges').progress('live', userId);
  const l = db.twitchLive;
  if (l) {
    l.discordMsgs = (l.discordMsgs ?? 0) + 1;
    l.chatters ??= {};
    l.chatters[userId] = (l.chatters[userId] ?? 0) + 1;
  }
}

// ───────────────────────── Commande ─────────────────────────

const commands = [
  {
    category: '📺 Stream',
    data: new SlashCommandBuilder()
      .setName('clips')
      .setDescription('Les meilleurs clips de la chaîne')
      .addIntegerOption((o) => o.setName('jours').setDescription('Période (7 jours par défaut)').addChoices({ name: '7 jours', value: 7 }, { name: '30 jours', value: 30 }, { name: '1 an', value: 365 })),
    run(i) {
      const days = i.options.getInteger('jours') ?? 7;
      const top = require('./twitchlive').bestClips(days, 10);
      return i.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(BRAND_COLOR)
            .setTitle(`🎬 Meilleurs clips (${days} jours)`)
            .setDescription(top.map((c, k) => `**${k + 1}.** [${c.title}](${c.url}) — ${c.creator} · ${c.views.toLocaleString('fr-FR')} vues`).join('\n') || '_Aucun clip sur cette période._')
            .setImage(top[0]?.thumb ?? null),
        ],
        allowedMentions: { parse: [] },
      });
    },
  },
  {
    category: '📺 Stream',
    data: new SlashCommandBuilder()
      .setName('streams')
      .setDescription('Historique et statistiques des lives')
      .addIntegerOption((o) => o.setName('jours').setDescription('Période (30 jours par défaut)').addChoices({ name: '7 jours', value: 7 }, { name: '30 jours', value: 30 }, { name: '90 jours', value: 90 }, { name: '1 an', value: 365 }))
      .addBooleanOption((o) => o.setName('semaines').setDescription('Comparer les 8 dernières semaines')),
    run(i) {
      if (i.options.getBoolean('semaines')) {
        const w = weekly(8);
        const nn = (x) => (x === null ? '—' : Math.round(x).toLocaleString('fr-FR'));
        const arrow = (cur, prev) => (cur === null || prev === null || prev === 0 ? '' : cur > prev ? ' ↗️' : cur < prev ? ' ↘️' : ' ➡️');
        const lines = w.map((x, k) => {
          const prev = w[k + 1];
          const d = x.week.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
          return x.count
            ? `**Sem. du ${d}** · ${x.count} live${x.count > 1 ? 's' : ''} · ${x.hours.toFixed(1).replace('.', ',')} h · moy. ${nn(x.avg)}${prev ? arrow(x.avg, prev.avg) : ''} · pic ${nn(x.peak)} · ${x.followers >= 0 ? '+' : ''}${x.followers} followers`
            : `Sem. du ${d} · _pas de live_`;
        });
        return i.reply({ embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('📈 Les lives semaine par semaine').setDescription(lines.join('\n'))], allowedMentions: { parse: [] } });
      }
      const days = i.options.getInteger('jours') ?? 30;
      const s = summary(days);
      const last = list().slice(0, 8);
      const n = (x) => (x === null ? '—' : Math.round(x).toLocaleString('fr-FR'));
      const embed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle(`📺 配信 ・ Les lives (${days} derniers jours)`)
        .addFields(
          { name: '🎬 Lives', value: `${s.count}`, inline: true },
          { name: '⏱️ Temps de live', value: `${s.hours.toFixed(1).replace('.', ',')} h`, inline: true },
          { name: '👀 Viewers', value: `moy. ${n(s.avg)} · pic ${n(s.peak)}`, inline: true },
          { name: '🟣 Followers gagnés en live', value: `${s.followers >= 0 ? '+' : ''}${n(s.followers)}`, inline: true },
          { name: '🎮 Jeux les plus joués', value: s.games.map(([g, c]) => `${g} (${c})`).join(' · ') || '—' },
          {
            name: '🗓️ Derniers lives',
            value:
              last
                .map((x) => `${x.platform === 'tiktok' ? '📱' : '🟣'} <t:${Math.floor(x.startedAt / 1000)}:d> · ${fmtDuration(x.durationMin)}${x.peak ? ` · pic ${x.peak}` : ''}${x.vod ? ` · [revoir](${x.vod})` : ''}\n　${(x.title ?? '').slice(0, 80)}`)
                .join('\n')
                .slice(0, 1024) || '_Aucun live enregistré pour l\'instant._',
          },
        );
      return i.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    },
  },
];

module.exports = { record, summary, compare, weekly, list, milestoneOf, checkMilestones, watchButton, fmtDuration, onMessage, isLive, commands };
