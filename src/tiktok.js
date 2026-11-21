/**
 * Alertes TikTok : nouvelles vidéos et lives, via yt-dlp.
 * TikTok n'a pas d'API publique pour ça : on consulte le profil régulièrement.
 */
const { EmbedBuilder } = require('discord.js');
const { ytdlpJson } = require('./ytdlp');
const { findChannel, findRole } = require('./shared');
const { db, save } = require('./store');

const USERNAME = (process.env.TIKTOK_USERNAME || '').replace(/^@/, '').trim();
const POLL_MS = Math.max(60, Number(process.env.TIKTOK_POLL_SECONDS) || 120) * 1000;
const TIKTOK_COLOR = 0xfe2c55;

const state = () => (db.tiktok ??= { seen: [], liveId: null, liveMessageId: null });
const profileUrl = () => `https://www.tiktok.com/@${USERNAME}`;

let lastError = '';
function logError(scope, err) {
  const msg = `${scope} : ${err.message}`;
  if (msg !== lastError) console.error(`TikTok ${msg}`); // évite de remplir les logs avec la même erreur
  lastError = msg;
}

// ───────────────────────── Nouvelles vidéos ─────────────────────────

async function checkVideos(guild) {
  const info = await ytdlpJson(['-J', '--flat-playlist', '--no-warnings', '--playlist-end', '10', profileUrl()], { cookies: false });
  const videos = (info.entries ?? []).filter((e) => e?.id);
  if (!videos.length) return;

  const s = state();
  const firstRun = !s.initialized;
  s.initialized = true;
  const fresh = videos.filter((v) => !s.seen.includes(String(v.id)));
  s.seen = [...new Set([...videos.map((v) => String(v.id)), ...s.seen])].slice(0, 200);
  save();
  // Premier lancement : on mémorise les vidéos existantes sans les annoncer
  if (firstRun || !fresh.length) return;

  const channel = findChannel(guild, 'tiktok') ?? findChannel(guild, 'live');
  if (!channel) return;
  const role = findRole(guild, 'notif_tiktok');

  for (const v of fresh.reverse()) {
    const url = v.webpage_url || v.url || `${profileUrl()}/video/${v.id}`;
    await channel
      .send({
        // Le lien seul suffit : Discord affiche l'aperçu de la vidéo TikTok
        content: `${role ?? ''} 📱 **Nouveau TikTok !** ${v.title ? `— ${v.title.slice(0, 200)}` : ''}\n${url}`.trim(),
        allowedMentions: { roles: role ? [role.id] : [] },
      })
      .catch((err) => console.error('TikTok envoi :', err.message));
    console.log(`📱 Nouveau TikTok : ${url}`);
  }
}

// ───────────────────────── Lives ─────────────────────────

async function getLive() {
  try {
    const info = await ytdlpJson(['-J', '--skip-download', '--no-warnings', `${profileUrl()}/live`], { cookies: false });
    return info?.id ? info : null;
  } catch (err) {
    // yt-dlp renvoie une erreur quand la personne n'est pas en live
    if (/not (currently )?live|offline|ended|does not exist/i.test(err.message)) return null;
    throw err;
  }
}

async function checkLive(guild) {
  const live = await getLive();
  const s = state();
  const channel = findChannel(guild, 'live');
  if (!channel) return;

  if (live && String(live.id) !== s.liveId) {
    s.liveId = String(live.id);
    const role = findRole(guild, 'notif_live');
    const url = `${profileUrl()}/live`;
    const msg = await channel.send({
      content: `${role ?? ''} 🔴 **${USERNAME}** est en live sur **TikTok** ! ${url}`.trim(),
      allowedMentions: { roles: role ? [role.id] : [] },
      embeds: [
        new EmbedBuilder()
          .setColor(TIKTOK_COLOR)
          .setAuthor({ name: `@${USERNAME} sur TikTok`, url: profileUrl() })
          .setTitle((live.title || live.description || 'Live TikTok').slice(0, 256))
          .setURL(url)
          .setThumbnail(live.thumbnail ?? null)
          .setFooter({ text: `TikTok Live ${live.id}` })
          .setTimestamp(),
      ],
    });
    s.liveMessageId = msg.id;
    save();
    console.log('🔴 Live TikTok détecté');
  } else if (!live && s.liveId) {
    const msg = s.liveMessageId && (await channel.messages.fetch(s.liveMessageId).catch(() => null));
    if (msg) {
      await msg
        .edit({
          content: '⚫ Le live TikTok est terminé, merci d\'être passé·e ! 💜',
          embeds: msg.embeds.map((e) => EmbedBuilder.from(e).setColor(0x2c2f33)),
          allowedMentions: { parse: [] },
        })
        .catch(() => {});
    }
    s.liveId = null;
    s.liveMessageId = null;
    save();
    console.log('⚫ Fin du live TikTok');
  }
}

function startTikTokWatcher(guild) {
  if (!USERNAME) {
    console.log('ℹ️  Alertes TikTok désactivées (TIKTOK_USERNAME manquant).');
    return;
  }
  let tick = 0;
  const run = async () => {
    if (!require('./settings').get('notifications.tiktok')) return;
    await checkLive(guild).catch((err) => logError('live', err));
    // Les vidéos : une vérification sur deux suffit
    if (tick++ % 2 === 0) await checkVideos(guild).catch((err) => logError('vidéos', err));
  };
  run();
  setInterval(run, POLL_MS);
  console.log(`📱 Surveillance de tiktok.com/@${USERNAME} toutes les ${POLL_MS / 1000}s`);
}

module.exports = { startTikTokWatcher };
