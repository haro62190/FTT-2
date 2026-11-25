/**
 * ▶️ Alertes YouTube : nouvelles vidéos et Shorts, via le flux RSS public de la chaîne
 * (gratuit, sans clé d'API). Vérification toutes les 10 minutes.
 * Chaîne réglée sur le tableau de bord (📡 Réseaux) ou YOUTUBE_CHANNEL dans .env : @pseudo, lien ou ID « UC… ».
 */
const { EmbedBuilder } = require('discord.js');
const { findChannel, findRole } = require('./shared');
const { db, save } = require('./store');
const settings = require('./settings');

const POLL_MS = 10 * 60_000;
const YT_COLOR = 0xff0033;
const state = () => (db.youtube ??= { seen: [], channelId: null, source: null });
const source = () => String(settings.get('stream.youtubeChannel') || process.env.YOUTUBE_CHANNEL || '').trim();
const ID = /^UC[\w-]{22}$/;

/** « @pseudo », « https://youtube.com/@pseudo », « …/channel/UC… » ou « UC… » → URL de la chaîne (ou ID). */
function normalize(input) {
  const s = String(input ?? '').trim();
  if (!s) return null;
  const id = s.match(/(UC[\w-]{22})/)?.[1];
  if (id) return { id };
  const handle = s.match(/(?:youtube\.com\/)?@([\w.-]{3,30})/i)?.[1] ?? (/^[\w.-]{3,30}$/.test(s) ? s : null);
  return handle ? { handle } : null;
}

const decode = (s) =>
  String(s ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(amp|lt|gt|quot|#39|apos);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" })[e]);

/** Lit le flux RSS (Atom) d'une chaîne. */
function parseFeed(xml) {
  const author = decode(xml.match(/<author>\s*<name>([\s\S]*?)<\/name>/)?.[1] ?? '');
  return [...String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    .map(([, e]) => {
      const id = e.match(/<yt:videoId>([\w-]{6,20})<\/yt:videoId>/)?.[1];
      const link = e.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? '';
      return id
        ? {
            id,
            title: decode(e.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '').slice(0, 200),
            published: Date.parse(e.match(/<published>([^<]+)<\/published>/)?.[1] ?? '') || 0,
            short: link.includes('/shorts/'),
            url: link.includes('/shorts/') ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`,
            thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
            author,
          }
        : null;
    })
    .filter(Boolean);
}

/** Trouve l'ID « UC… » d'une chaîne à partir de son @pseudo (page publique, puis yt-dlp en secours). */
async function resolveId(handle) {
  try {
    const res = await fetch(`https://www.youtube.com/@${encodeURIComponent(handle)}`, {
      headers: { 'Accept-Language': 'fr-FR,fr;q=0.9', Cookie: 'CONSENT=YES+cb; SOCS=CAI' },
      signal: AbortSignal.timeout(15_000),
    });
    const html = await res.text();
    const id = html.match(/"(?:externalId|channelId)":"(UC[\w-]{22})"/)?.[1] ?? html.match(/youtube\.com\/channel\/(UC[\w-]{22})/)?.[1];
    if (id) return id;
  } catch {
    /* on essaie yt-dlp */
  }
  const info = await require('./ytdlp').ytdlpJson(['-J', '--flat-playlist', '--playlist-end', '1', '--no-warnings', `https://www.youtube.com/@${handle}`], { cookies: false });
  const id = info?.channel_id ?? info?.id;
  if (ID.test(String(id))) return id;
  throw new Error(`chaîne YouTube « @${handle} » introuvable`);
}

async function channelId() {
  const s = state();
  const src = source();
  if (!src) return null;
  if (s.channelId && s.source === src) return s.channelId;
  const n = normalize(src);
  if (!n) throw new Error('chaîne YouTube invalide (mets @pseudo, le lien de la chaîne ou son ID UC…)');
  s.channelId = n.id ?? (await resolveId(n.handle));
  s.source = src;
  s.initialized = false; // nouvelle chaîne : on ne réannonce pas ses anciennes vidéos
  save();
  return s.channelId;
}

async function fetchFeed(id) {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`flux YouTube : HTTP ${res.status}`);
  return parseFeed(await res.text());
}

async function check(guild) {
  const id = await channelId();
  if (!id) return [];
  const videos = await fetchFeed(id);
  const s = state();
  const firstRun = !s.initialized;
  s.initialized = true;
  // Seulement les vidéos jamais vues et récentes (une vieille vidéo remise en avant n'est pas annoncée)
  const fresh = videos.filter((v) => !s.seen.includes(v.id) && Date.now() - v.published < 2 * 86_400_000);
  s.seen = [...new Set([...videos.map((v) => v.id), ...s.seen])].slice(0, 200);
  s.lastCheck = Date.now();
  s.error = null;
  save();
  if (firstRun || !fresh.length) return [];

  const channel = findChannel(guild, 'youtube') ?? findChannel(guild, 'announcements');
  if (!channel) return fresh;
  const role = findRole(guild, 'notif_youtube');
  for (const v of fresh.reverse()) {
    await channel
      .send({
        content: `${role ?? ''} ▶️ **${v.short ? 'Nouveau Short' : 'Nouvelle vidéo'} YouTube${v.author ? ` de ${v.author}` : ''} !**`.trim(),
        embeds: [new EmbedBuilder().setColor(YT_COLOR).setTitle(v.title || 'Nouvelle vidéo').setURL(v.url).setImage(v.thumb).setTimestamp(v.published || Date.now())],
        components: [require('./streams').watchButton(v.url, v.short ? 'Voir le Short' : 'Regarder la vidéo')],
        allowedMentions: { roles: role ? [role.id] : [] },
      })
      .catch((err) => console.error('YouTube envoi :', err.message));
    require('./feed').push('▶️', `${v.short ? 'Nouveau Short' : 'Nouvelle vidéo'} YouTube : ${v.title.slice(0, 80)}`);
    console.log(`▶️ Nouvelle vidéo YouTube : ${v.url}`);
  }
  return fresh;
}

function start(guild) {
  let lastError = '';
  const run = () =>
    settings.get('notifications.youtube') !== false && source()
      ? check(guild).catch((err) => {
          state().error = err.message.slice(0, 200);
          if (err.message !== lastError) console.error('YouTube :', err.message);
          lastError = err.message;
        })
      : null;
  run();
  setInterval(run, POLL_MS);
}

module.exports = { start, check, parseFeed, normalize, channelId, source, state };
