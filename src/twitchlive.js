/**
 * Tout ce qui vient de Twitch :
 *  - alerte de live (🔴┃en-live) + récap de fin de live (durée, pic de viewers, jeux, rediffusion)
 *  - nouveaux clips postés automatiquement (🎬┃clips)
 *  - planning Twitch affiché dans 🗓️┃planning + événements Discord créés automatiquement
 * Utilise uniquement le jeton d'application (TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET).
 */
const { EmbedBuilder, GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel, GuildScheduledEventStatus } = require('discord.js');
const { BRAND_COLOR, findChannel, findRole } = require('./shared');
const { db, save } = require('./store');
const settings = require('./settings');

const LOGIN = process.env.TWITCH_CHANNEL;
const POLL_MS = Math.max(30, Number(process.env.TWITCH_POLL_SECONDS) || 60) * 1000;
const CLIPS_MS = 5 * 60_000;
const SCHEDULE_MS = 30 * 60_000;

let twitch = null;
let user = null; // { id, login, display_name, profile_image_url }

const live = () => db.twitchLive ?? null;
const fmtDuration = (ms) => {
  const m = Math.round(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;
};

async function getUser() {
  user ??= await twitch.getUser(LOGIN);
  if (!user) throw new Error(`chaîne Twitch « ${LOGIN} » introuvable`);
  return user;
}

// ───────────────────────── Live + récap ─────────────────────────

async function checkLive(guild) {
  const channel = findChannel(guild, 'live');
  if (!channel || !settings.get('notifications.twitch')) return;
  const stream = await twitch.getLiveStream(LOGIN);
  const state = live();

  if (stream && stream.id === state?.streamId) {
    // Live en cours : on suit le pic de viewers et les jeux joués
    state.peak = Math.max(state.peak ?? 0, stream.viewer_count ?? 0);
    if (stream.game_name && !state.games.includes(stream.game_name)) state.games.push(stream.game_name);
    state.title = stream.title;
    save();
    return;
  }

  if (stream) {
    const u = await getUser();
    const url = `https://twitch.tv/${stream.user_login}`;
    const thumb = stream.thumbnail_url.replace('{width}', '1280').replace('{height}', '720') + `?t=${Date.now()}`;
    const role = findRole(guild, 'notif_live');
    const msg = await channel.send({
      content: `${role ?? ''} 🔴 **${stream.user_name}** est en live ! ${url}`.trim(),
      allowedMentions: { roles: role ? [role.id] : [] },
      embeds: [
        new EmbedBuilder()
          .setColor(BRAND_COLOR)
          .setAuthor({ name: stream.user_name, iconURL: u.profile_image_url, url })
          .setTitle(stream.title || 'Live en cours')
          .setURL(url)
          .addFields({ name: '🎮 Jeu', value: stream.game_name || 'Non défini', inline: true })
          .setImage(thumb)
          .setFooter({ text: `Stream ID ${stream.id}` })
          .setTimestamp(new Date(stream.started_at)),
      ],
    });
    // Enregistré seulement après l'envoi : en cas d'échec on réessaie au prochain passage
    db.twitchLive = {
      streamId: stream.id,
      channelId: channel.id,
      messageId: msg.id,
      startedAt: stream.started_at,
      title: stream.title,
      peak: stream.viewer_count ?? 0,
      games: stream.game_name ? [stream.game_name] : [],
    };
    save();
    console.log(`🔴 Live détecté : ${stream.title}`);
    return;
  }

  if (!stream && state) {
    // Fin du live : l'annonce devient un récap
    const u = await getUser().catch(() => null);
    const vod = u ? await twitch.getLatestVod(u.id).catch(() => null) : null;
    const duration = Date.now() - new Date(state.startedAt).getTime();
    const ch = guild.channels.cache.get(state.channelId);
    const msg = ch && (await ch.messages.fetch(state.messageId).catch(() => null));
    if (msg) {
      const recap = new EmbedBuilder()
        .setColor(0x3a3a3a)
        .setAuthor({ name: `${u?.display_name ?? LOGIN} — live terminé`, iconURL: u?.profile_image_url })
        .setTitle(state.title || 'Live terminé')
        .addFields(
          { name: '⏱️ Durée', value: fmtDuration(duration), inline: true },
          { name: '👀 Pic de viewers', value: String(state.peak ?? 0), inline: true },
          { name: '🎮 Jeux', value: state.games.join(', ') || '—', inline: true },
        )
        .setFooter({ text: `Stream ID ${state.streamId}` })
        .setTimestamp();
      if (vod) recap.addFields({ name: '📼 Rediffusion', value: `[Revoir le live](${vod.url})` }).setURL(vod.url);
      await msg
        .edit({ content: '⚫ Le live est terminé, merci d\'être passé·e ! Voici le récap ⚔️', embeds: [recap], allowedMentions: { parse: [] } })
        .catch(() => {});
    }
    db.twitchLive = null;
    save();
    console.log('⚫ Fin du live (récap publié)');
  }
}

// ───────────────────────── Clips ─────────────────────────

async function checkClips(guild) {
  const channel = findChannel(guild, 'clips');
  if (!channel || !settings.get('notifications.clips')) return;
  const u = await getUser();
  const s = (db.twitchClips ??= { seen: [], initialized: false });
  const since = new Date(Date.now() - 24 * 3600_000).toISOString(); // les clips mettent parfois du temps à apparaître
  const clips = await twitch.getClips(u.id, since);
  const fresh = clips.filter((c) => !s.seen.includes(c.id)).sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (s.initialized) {
    for (const c of fresh) {
      await channel
        .send({ content: `🎬 **Nouveau clip** par **${c.creator_name}** — ${c.title}\n${c.url}`, allowedMentions: { parse: [] } })
        .catch(() => {});
    }
  }
  s.seen = [...new Set([...fresh.map((c) => c.id), ...s.seen])].slice(0, 300);
  s.initialized = true; // premier passage : on mémorise les clips existants sans les poster
  save();
}

// ───────────────────────── Planning ─────────────────────────

async function checkSchedule(guild) {
  if (!twitch || !LOGIN) throw new Error('Twitch n\'est pas configuré (TWITCH_CHANNEL / TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET)');
  if (!settings.get('notifications.schedule')) return;
  const u = await getUser();
  const schedule = await twitch.getSchedule(u.id);
  const now = Date.now();
  const segments = (schedule?.segments ?? []).filter((s) => !s.canceled_until && new Date(s.start_time).getTime() > now - 3600_000);

  // 1) Message de planning dans 🗓️┃planning
  const channel = findChannel(guild, 'schedule');
  if (channel) {
    const lines = segments.slice(0, 12).map((s) => {
      const t = Math.floor(new Date(s.start_time).getTime() / 1000);
      return `🗓️ <t:${t}:F> · <t:${t}:R>\n　**${s.title || 'Stream'}**${s.category?.name ? ` — 🎮 ${s.category.name}` : ''}`;
    });
    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle('🗓️ 予定 ・ Planning des streams')
      .setDescription(lines.join('\n\n') || '_Aucun stream planifié pour le moment sur Twitch._')
      .setURL(`https://twitch.tv/${u.login}/schedule`)
      .setFooter({ text: 'Synchronisé automatiquement avec le planning Twitch' })
      .setTimestamp();
    await require('./builder').upsertBotMessage(channel, { embeds: [embed] }, () => {}, 'twitch-schedule');
  }

  // 2) Événements Discord pour les 7 prochains jours
  const st = (db.twitchSchedule ??= { events: {} });
  const soon = segments.filter((s) => new Date(s.start_time).getTime() < now + 7 * 86_400_000 && new Date(s.start_time).getTime() > now + 60_000);
  for (const seg of soon) {
    if (st.events[seg.id]) continue;
    const start = new Date(seg.start_time);
    const end = seg.end_time ? new Date(seg.end_time) : new Date(start.getTime() + 3 * 3600_000);
    const event = await guild.scheduledEvents
      .create({
        name: (seg.title || `Live de ${u.display_name}`).slice(0, 100),
        scheduledStartTime: start,
        scheduledEndTime: end,
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType: GuildScheduledEventEntityType.External,
        entityMetadata: { location: `https://twitch.tv/${u.login}` },
        description: seg.category?.name ? `🎮 ${seg.category.name}` : 'Live Twitch',
        reason: 'Planning Twitch',
      })
      .catch((e) => console.error('Planning → événement :', e.message));
    if (event) st.events[seg.id] = event.id;
  }
  // Créneaux retirés du planning Twitch : on supprime l'événement Discord à venir correspondant
  const ids = new Set(segments.map((s) => s.id));
  for (const [segId, eventId] of Object.entries(st.events)) {
    if (ids.has(segId)) continue;
    const ev = await guild.scheduledEvents.fetch(eventId).catch(() => null);
    if (ev?.status === GuildScheduledEventStatus.Scheduled) await ev.delete().catch(() => {});
    delete st.events[segId];
  }
  save();
}

// ───────────────────────── Démarrage ─────────────────────────

function start(guild, client) {
  twitch = client;
  if (!twitch || !LOGIN) {
    console.log('ℹ️  Twitch désactivé (TWITCH_CHANNEL / TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET manquants).');
    return;
  }
  const every = (fn, ms, label) => {
    const run = () => fn(guild).catch((e) => console.error(`Twitch ${label} :`, e.message));
    run();
    setInterval(run, ms);
  };
  every(checkLive, POLL_MS, 'live');
  every(checkClips, CLIPS_MS, 'clips');
  every(checkSchedule, SCHEDULE_MS, 'planning');
  console.log(`📺 Twitch ${LOGIN} : live toutes les ${POLL_MS / 1000}s, clips toutes les 5 min, planning toutes les 30 min`);
}

module.exports = { start, checkSchedule };
