/**
 * Salons compteurs (catégorie 📊 STATS) : membres Discord, followers Twitch, abonnés TikTok et YouTube.
 * Le nom des salons vocaux est mis à jour toutes les 10 minutes
 * (Discord limite le renommage d'un salon à 2 fois par 10 minutes).
 */
const { EmbedBuilder, MessageFlags, PermissionFlagsBits: P, SlashCommandBuilder } = require('discord.js');
const { BRAND_COLOR, config, findChannel } = require('./shared');
const { db, save } = require('./store');
const { ytdlpJson } = require('./ytdlp');

const INTERVAL_MS = 10 * 60_000;
const TIKTOK_USERNAME_ = () => require('./shared').tiktokUser();
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const state = () => (db.stats ??= {});
let twitchClient = null;
let twitchId = null;
let busy = false;

/** 1 234 · 12,3 k · 1,2 M */
function fmt(n) {
  if (n === null || n === undefined) return '…';
  if (n < 10_000) return n.toLocaleString('fr-FR');
  return new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

const LABELS = {
  discord: (n) => `👥 Membres : ${fmt(n)}`,
  twitch: (n) => `🟣 Twitch : ${fmt(n)}`,
  tiktok: (n) => `📱 TikTok : ${fmt(n)}`,
  youtube: (n) => `▶️ YouTube : ${fmt(n)}`,
};

// ───────────────────────── Sources ─────────────────────────

function discordCount(guild) {
  // Membres humains si la liste est chargée, sinon le total Discord
  const humans = guild.members.cache.filter((m) => !m.user.bot).size;
  return humans > 0 && guild.members.cache.size >= guild.memberCount - 5 ? humans : guild.memberCount;
}

async function twitchCount() {
  const login = require('./shared').twitchLogin();
  if (!twitchClient || !login) return null;
  twitchId ??= (await twitchClient.getUser(login))?.id;
  if (!twitchId) throw new Error(`chaîne Twitch « ${login} » introuvable`);
  return twitchClient.getFollowerCount(twitchId);
}

async function tiktokCount() {
  if (!TIKTOK_USERNAME_()) return null;
  // 1) Page publique du profil
  try {
    const res = await fetch(`https://www.tiktok.com/@${encodeURIComponent(TIKTOK_USERNAME_())}`, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'fr-FR,fr;q=0.9' },
      signal: AbortSignal.timeout(20_000),
    });
    const html = await res.text();
    const m = html.match(/"followerCount":(\d+)/);
    if (m) return Number(m[1]);
  } catch {}
  // 2) yt-dlp (lit le profil via la première vidéo)
  try {
    const info = await ytdlpJson(['-J', '--playlist-items', '1', '--no-warnings', `https://www.tiktok.com/@${TIKTOK_USERNAME_()}`], { cookies: false });
    const first = info.entries?.[0] ?? info;
    const n = first?.channel_follower_count;
    if (Number.isFinite(n)) return n;
  } catch {}
  // 3) Valeur réglée à la main avec /stats tiktok
  return state().tiktokManual ?? null;
}

/** « 1.23K subscribers » / « 12,3 k abonnés » / « 1 234 abonnés » → nombre (YouTube arrondit en public). */
function parseSubs(text) {
  const m = String(text ?? '').replace(/\u00a0|\u202f/g, ' ').match(/([\d][\d.,\s]*)\s*([KkMmBb]|k|M|Md|Mrd)?\b/);
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9, md: 1e9, mrd: 1e9 }[String(m[2] ?? '').toLowerCase()] ?? 1;
  let num = m[1].trim().replace(/\s/g, '');
  num = mult > 1 ? num.replace(',', '.') : num.replace(/[.,]/g, '');
  const n = Math.round(parseFloat(num) * mult);
  return Number.isFinite(n) ? n : null;
}

async function youtubeCount() {
  const yt = require('./youtube');
  if (!yt.source()) return null;
  const id = await yt.channelId();
  // 1) Page publique de la chaîne (en anglais pour un format stable)
  try {
    const res = await fetch(`https://www.youtube.com/channel/${id}`, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+cb; SOCS=CAI' },
      signal: AbortSignal.timeout(20_000),
    });
    const html = await res.text();
    const m = html.match(/"([\d.,]+\s*[KMB]?) subscribers"/) ?? html.match(/"subscriberCountText":\{[^}]*?"simpleText":"([^"]+)"/);
    const n = m && parseSubs(m[1]);
    if (n !== null) return n;
  } catch {}
  // 2) yt-dlp
  try {
    const info = await ytdlpJson(['-J', '--flat-playlist', '--playlist-end', '1', '--no-warnings', `https://www.youtube.com/channel/${id}`], { cookies: false });
    if (Number.isFinite(info?.channel_follower_count)) return info.channel_follower_count;
  } catch {}
  // 3) Valeur réglée à la main (/stats youtube ou site)
  return state().youtubeManual ?? null;
}

// ───────────────────────── Mise à jour ─────────────────────────

async function refresh(guild) {
  if (busy || !require('./settings').on('stats')) return state();
  busy = true;
  try {
    const s = state();
    const sources = { discord: async () => discordCount(guild), twitch: twitchCount, tiktok: tiktokCount, youtube: youtubeCount };
    for (const [key, getter] of Object.entries(sources)) {
      try {
        const n = await getter();
        if (n !== null && n !== undefined) s[key] = n;
        s[`${key}Error`] = null;
      } catch (err) {
        s[`${key}Error`] = err.message.slice(0, 200);
      }
      const channel = findChannel(guild, `stat_${key}`);
      const name = LABELS[key](s[key]);
      if (channel && channel.name !== name) {
        await channel.setName(name, 'Mise à jour des statistiques').catch((err) => (s[`${key}Error`] = `renommage : ${err.message}`));
      }
    }
    s.updatedAt = Date.now();
    const history = require('./history');
    for (const k of ['discord', 'twitch', 'tiktok', 'youtube']) history.gauge(k, s[k]);
    save();
    await require('./streams')
      .checkMilestones(guild, { discord: s.discord, twitch: s.twitch, tiktok: s.tiktok, youtube: s.youtube })
      .catch((e) => console.error('Paliers :', e.message));
    return s;
  } finally {
    busy = false;
  }
}

async function start(guild, twitch) {
  twitchClient = twitch;
  const hasStats = config.categories.some((c) => c.channels.some((d) => d.stat));
  if (!hasStats) return;
  // Charger la liste des membres une fois pour compter les humains (les arrivées/départs la tiennent à jour)
  await guild.members.fetch().catch(() => {});
  setTimeout(() => refresh(guild).catch((e) => console.error('Stats :', e.message)), 15_000);
  setInterval(() => refresh(guild).catch((e) => console.error('Stats :', e.message)), INTERVAL_MS);
  console.log('📊 Salons compteurs : mise à jour toutes les 10 minutes');
}

// ───────────────────────── Commande ─────────────────────────

function statsEmbed(s) {
  const line = (key, label) => `${label} : **${fmt(s[key])}**${s[`${key}Error`] ? `\n　⚠️ ${s[`${key}Error`]}` : ''}`;
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('📊 統計 ・ Statistiques')
    .setDescription(
      [
        line('discord', '👥 Membres Discord'),
        line('twitch', `🟣 Followers Twitch${require('./shared').twitchLogin() ? '' : ' (chaîne Twitch non configurée)'}`),
        line('tiktok', `📱 Abonnés TikTok${TIKTOK_USERNAME_() ? '' : ' (compte TikTok non configuré)'}${s.tiktokManual ? ' — valeur manuelle en secours' : ''}`),
        line('youtube', `▶️ Abonnés YouTube${require('./youtube').source() ? '' : ' (chaîne YouTube non configurée)'}${s.youtubeManual ? ' — valeur manuelle en secours' : ''}`),
      ].join('\n'),
    )
    .setFooter({ text: s.updatedAt ? `Mis à jour ${new Date(s.updatedAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })} · toutes les 10 min` : 'Pas encore mis à jour' });
}

const commands = [
  {
    category: '📊 Statistiques',
    data: new SlashCommandBuilder()
      .setName('stats')
      .setDescription('Statistiques Discord, Twitch, TikTok et YouTube')
      .addSubcommand((s) => s.setName('voir').setDescription('Voir les compteurs'))
      .addSubcommand((s) => s.setName('rafraichir').setDescription('Mettre à jour les salons compteurs maintenant (staff)'))
      .addSubcommand((s) =>
        s
          .setName('tiktok')
          .setDescription('Valeur de secours pour TikTok, utilisée si la lecture automatique échoue (staff)')
          .addIntegerOption((o) => o.setName('nombre').setDescription('Nombre d\'abonnés (0 = pas de valeur de secours)').setRequired(true).setMinValue(0)),
      )
      .addSubcommand((s) =>
        s
          .setName('youtube')
          .setDescription('Valeur de secours pour YouTube, utilisée si la lecture automatique échoue (staff)')
          .addIntegerOption((o) => o.setName('nombre').setDescription('Nombre d\'abonnés (0 = pas de valeur de secours)').setRequired(true).setMinValue(0)),
      ),
    async run(i) {
      const sub = i.options.getSubcommand();
      if (sub !== 'voir' && !i.memberPermissions.has(P.ManageGuild)) {
        return i.reply({ content: 'Réservé au staff (permission « Gérer le serveur »).', flags: MessageFlags.Ephemeral });
      }
      if (sub === 'voir') return i.reply({ embeds: [statsEmbed(state())] });
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      if (sub === 'tiktok' || sub === 'youtube') {
        const n = i.options.getInteger('nombre');
        state()[`${sub}Manual`] = n || null;
        if (n) state()[sub] = n;
        save();
      }
      const s = await refresh(i.guild);
      return i.editReply({ content: '✅ Compteurs mis à jour.', embeds: [statsEmbed(s)] });
    },
  },
];

module.exports = { start, refresh, commands, fmt, parseSubs };
