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

const LOGIN_ = () => require('./shared').twitchLogin();
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
  if (user && user.login !== LOGIN_()) user = null; // chaîne changée depuis le tableau de bord
  user ??= await twitch.getUser(LOGIN_());
  if (!user) throw new Error(`chaîne Twitch « ${LOGIN_()} » introuvable`);
  return user;
}

// ───────────────────────── Live + récap ─────────────────────────

const EDIT_EVERY_MS = 3 * 60_000; // mise à jour de l'annonce pendant le live

/** Annonce du live (créée puis mise à jour : viewers, durée, jeux, titre). */
function liveEmbed(stream, u, state) {
  const url = `https://twitch.tv/${stream.user_login}`;
  const thumb = stream.thumbnail_url.replace('{width}', '1280').replace('{height}', '720') + `?t=${Math.floor(Date.now() / EDIT_EVERY_MS)}`;
  const started = new Date(stream.started_at).getTime();
  const avg = state?.samples ? Math.round(state.viewerSum / state.samples) : stream.viewer_count;
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setAuthor({ name: `${stream.user_name} est en live`, iconURL: u.profile_image_url, url })
    .setTitle(stream.title || 'Live en cours')
    .setURL(url)
    .addFields(
      { name: '🎮 Jeu', value: stream.game_name || 'Non défini', inline: true },
      { name: '👀 Viewers', value: `${stream.viewer_count ?? 0}${state?.peak ? ` (pic ${state.peak})` : ''}`, inline: true },
      { name: '⏱️ Depuis', value: `<t:${Math.floor(started / 1000)}:R>`, inline: true },
      ...(state?.games?.length > 1 ? [{ name: '🎮 Jeux du live', value: state.games.join(' → ').slice(0, 1024) }] : []),
    )
    .setImage(thumb)
    .setFooter({ text: `Moyenne ${avg ?? 0} viewers · Stream ID ${stream.id}` })
    .setTimestamp(new Date(stream.started_at));
}

async function followerCount(u) {
  return twitch.getFollowerCount(u.id).catch(() => null);
}

async function checkLive(guild) {
  const channel = findChannel(guild, 'live');
  if (!channel || !settings.get('notifications.twitch')) return;
  const stream = await twitch.getLiveStream(LOGIN_());
  const state = live();
  require('./twitchchat').sync(guild, LOGIN_(), Boolean(stream));
  const { watchButton } = require('./streams');

  if (stream && stream.id === state?.streamId) {
    // Live en cours : pic, moyenne de viewers, jeux joués, et annonce mise à jour toutes les 3 min
    const viewers = stream.viewer_count ?? 0;
    state.peak = Math.max(state.peak ?? 0, viewers);
    state.viewerSum = (state.viewerSum ?? 0) + viewers;
    state.samples = (state.samples ?? 0) + 1;
    if (stream.game_name && !state.games.includes(stream.game_name)) state.games.push(stream.game_name);
    const gameChanged = stream.game_name && stream.game_name !== state.game;
    state.game = stream.game_name;
    state.title = stream.title;
    save();
    if (gameChanged || Date.now() - (state.editedAt ?? 0) >= EDIT_EVERY_MS) {
      state.editedAt = Date.now();
      const u = await getUser();
      const msg = await guild.channels.cache.get(state.channelId)?.messages.fetch(state.messageId).catch(() => null);
      await msg?.edit({ embeds: [liveEmbed(stream, u, state)], components: [watchButton(`https://twitch.tv/${stream.user_login}`)] }).catch(() => {});
      save();
    }
    return;
  }

  if (stream) {
    const u = await getUser();
    const url = `https://twitch.tv/${stream.user_login}`;
    const role = findRole(guild, 'notif_live');
    const first = { peak: stream.viewer_count ?? 0, games: stream.game_name ? [stream.game_name] : [] };
    const msg = await channel.send({
      content: `${role ?? ''} 🔴 **${stream.user_name}** est en live sur **${stream.game_name || 'Twitch'}** ! ${url}`.trim(),
      allowedMentions: { roles: role ? [role.id] : [] },
      embeds: [liveEmbed(stream, u, first)],
      components: [watchButton(url)],
    });
    // Enregistré seulement après l'envoi : en cas d'échec on réessaie au prochain passage
    db.twitchLive = {
      streamId: stream.id,
      channelId: channel.id,
      messageId: msg.id,
      startedAt: stream.started_at,
      title: stream.title,
      game: stream.game_name,
      ...first,
      viewerSum: stream.viewer_count ?? 0,
      samples: 1,
      editedAt: Date.now(),
      followersStart: await followerCount(u),
    };
    save();
    require('./feed').push('🔴', `Live Twitch lancé : ${stream.title || stream.game_name || 'en direct'}`);
    console.log(`🔴 Live détecté : ${stream.title}`);
    return;
  }

  if (!stream && state) {
    // Fin du live : l'annonce devient un récap, et le live est ajouté à l'historique
    const u = await getUser().catch(() => null);
    const vod = u ? await twitch.getLatestVod(u.id).catch(() => null) : null;
    const followersEnd = u ? await followerCount(u) : null;
    const gained = followersEnd !== null && state.followersStart != null ? followersEnd - state.followersStart : null;
    const startedAt = new Date(state.startedAt).getTime();
    const avg = state.samples ? Math.round(state.viewerSum / state.samples) : null;
    const topChatters = Object.entries(state.chatters ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const entry = require('./streams').record({
      platform: 'twitch',
      id: state.streamId,
      title: state.title,
      games: state.games,
      startedAt,
      endedAt: Date.now(),
      peak: state.peak ?? 0,
      avg,
      followersStart: state.followersStart ?? null,
      followersGained: gained,
      vod: vod?.url ?? null,
      topChatters: topChatters.map(([id]) => id),
      highlights: state.highlights ?? [],
      discordMessages: state.discordMsgs ?? 0,
    });
    const moments = require('./twitchchat').recapLines(state.highlights, vod?.url);
    // Clips créés pendant le live (récupérés toutes les 5 min), les plus vus d'abord
    const liveClips = Object.values(db.clipsGallery ?? {})
      .filter((c) => c.createdAt >= startedAt - 60_000 && c.createdAt <= Date.now())
      .sort((a, b) => b.views - a.views)
      .slice(0, 3);
    const cmp = require('./streams').compare(entry);
    const pct = (x) => (x === null ? null : `${x > 0 ? '+' : ''}${x} %`);
    const cmpText = cmp && [pct(cmp.avg) && `viewers moy. ${pct(cmp.avg)}`, pct(cmp.peak) && `pic ${pct(cmp.peak)}`, pct(cmp.duration) && `durée ${pct(cmp.duration)}`].filter(Boolean).join(' · ');
    const ch = guild.channels.cache.get(state.channelId);
    const msg = ch && (await ch.messages.fetch(state.messageId).catch(() => null));
    if (msg) {
      const recap = new EmbedBuilder()
        .setColor(0x3a3a3a)
        .setAuthor({ name: `${u?.display_name ?? LOGIN_()} — live terminé`, iconURL: u?.profile_image_url })
        .setTitle(state.title || 'Live terminé')
        .addFields(
          { name: '⏱️ Durée', value: fmtDuration(entry.durationMin * 60_000), inline: true },
          { name: '👀 Viewers', value: `pic ${state.peak ?? 0} · moy. ${avg ?? '—'}`, inline: true },
          { name: '🟣 Followers', value: gained === null ? '—' : `${gained >= 0 ? '+' : ''}${gained}`, inline: true },
          { name: '🎮 Jeux', value: state.games.join(', ') || '—' },
          ...(cmpText ? [{ name: `📈 Par rapport aux ${cmp.count} lives précédents`, value: cmpText }] : []),
          ...(db.stats?.twitch ? [{ name: '🟣 Followers au total', value: db.stats.twitch.toLocaleString('fr-FR'), inline: true }] : []),
          ...(moments.length ? [{ name: '💥 Moments forts', value: moments.join('\n').slice(0, 1024) }] : []),
          ...(liveClips.length ? [{ name: '🎬 Clips du live', value: liveClips.map((c) => `[${c.title.slice(0, 60)}](${c.url}) — ${c.creator} · ${c.views} vues`).join('\n').slice(0, 1024) }] : []),
          ...(topChatters.length ? [{ name: '💬 Les plus actifs sur le Discord pendant le live', value: topChatters.map(([id, n]) => `<@${id}> (${n})`).join(' · ') }] : []),
        )
        .setFooter({ text: `Stream ID ${state.streamId} · historique : /streams` })
        .setTimestamp();
      if (vod) recap.setURL(vod.url);
      await msg
        .edit({
          content: '⚫ Le live est terminé, merci d\'être passé·e ! Voici le récap ⚔️',
          embeds: [recap],
          components: vod ? [watchButton(vod.url, 'Revoir le live')] : [],
          allowedMentions: { parse: [] },
        })
        .catch(() => {});
    }
    await require('./contentideas')
      .postAfterLive(guild, { title: state.title, highlights: state.highlights ?? [], clips: liveClips, vodUrl: vod?.url ?? null, startedAt })
      .catch((e) => console.error('Idées de contenu :', e.message));
    db.twitchLive = null;
    save();
    require('./feed').push('⚫', `Fin du live Twitch : ${fmtDuration(entry.durationMin * 60_000)}, pic ${state.peak ?? 0} viewers`);
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
  storeClips(clips);
  if (s.initialized) {
    for (const c of fresh) {
      await channel
        .send({
          content: `🎬 **Nouveau clip** par **${c.creator_name}** — ${c.title}\n${c.url}`,
          components: [require('./streams').watchButton(c.url, 'Voir le clip')],
          allowedMentions: { parse: [] },
        })
        .catch(() => {});
      require('./history').bump('clips');
    }
  }
  s.seen = [...new Set([...fresh.map((c) => c.id), ...s.seen])].slice(0, 300);
  s.initialized = true; // premier passage : on mémorise les clips existants sans les poster
  save();
}

/** Galerie : on garde les infos des clips (titre, auteur, vues, miniature) et on met les vues à jour. */
function storeClips(clips) {
  const g = (db.clipsGallery ??= {});
  for (const c of clips) {
    g[c.id] = { id: c.id, url: c.url, title: c.title, creator: c.creator_name, views: c.view_count ?? 0, thumb: c.thumbnail_url, duration: c.duration, game: c.game_id, createdAt: new Date(c.created_at).getTime() };
  }
  const keep = Object.values(g).sort((a, b) => b.createdAt - a.createdAt).slice(0, 400).map((c) => c.id);
  for (const id of Object.keys(g)) if (!keep.includes(id)) delete g[id];
  save();
}

/** Meilleurs clips : `days` derniers jours, classés par vues. */
function bestClips(days = 7, n = 10) {
  const since = Date.now() - days * 86_400_000;
  return Object.values(db.clipsGallery ?? {})
    .filter((c) => c.createdAt >= since)
    .sort((a, b) => b.views - a.views)
    .slice(0, n);
}

/** Chaque lundi : vues à jour des clips de la semaine, puis top 5 posté dans 🎬┃clips. */
async function weeklyClips(guild) {
  const week = require('./seasons').currentWeek();
  if (db.clipsWeekPosted === week || !settings.get('notifications.clips')) return;
  if (db.clipsWeekPosted === undefined) {
    // Premier lancement : on attend le lundi suivant pour le premier top
    db.clipsWeekPosted = week;
    return save();
  }
  const u = await getUser();
  storeClips(await twitch.getClips(u.id, new Date(Date.now() - 7 * 86_400_000).toISOString()));
  db.clipsWeekPosted = week;
  save();
  const top = bestClips(7, 5);
  const channel = findChannel(guild, 'clips');
  if (!top.length || !channel) return;
  const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
  await channel
    .send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xffc400)
          .setTitle('🎬 Les meilleurs clips de la semaine')
          .setDescription(top.map((c, k) => `${medals[k]} [${c.title}](${c.url}) — par **${c.creator}** · ${c.views.toLocaleString('fr-FR')} vues`).join('\n'))
          .setImage(top[0].thumb ?? null)
          .setFooter({ text: 'Toute la galerie sur le tableau de bord · /clips' }),
      ],
      allowedMentions: { parse: [] },
    })
    .catch(() => {});
  require('./feed').push('🎬', `Top clips de la semaine : ${top[0].title}`);
}

// ───────────────────────── Planning ─────────────────────────

async function checkSchedule(guild) {
  if (!twitch || !LOGIN_()) throw new Error('Twitch n\'est pas configuré (TWITCH_CHANNEL / TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET)');
  if (!settings.get('notifications.schedule')) return;
  const u = await getUser();
  const schedule = await twitch.getSchedule(u.id);
  const now = Date.now();
  const segments = (schedule?.segments ?? []).filter((s) => !s.canceled_until && new Date(s.start_time).getTime() > now - 3600_000);

  // Prochains lives, pour la page vitrine du site
  (db.twitchSchedule ??= { events: {} }).upcoming = segments
    .slice(0, 8)
    .map((s) => ({ start: new Date(s.start_time).getTime(), title: String(s.title || 'Stream').slice(0, 140), game: s.category?.name ?? null }));
  save();

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
  if (!twitch) {
    console.log('ℹ️  Twitch désactivé (TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET manquants dans .env).');
    return;
  }
  // La chaîne peut être réglée (ou changée) plus tard depuis le tableau de bord : on vérifie à chaque passage
  const every = (fn, ms, label) => {
    const run = () => (LOGIN_() ? fn(guild).catch((e) => console.error(`Twitch ${label} :`, e.message)) : null);
    run();
    require('./guardian').every(`twitch-${label}`, `Twitch : ${label}`, ms, run);
  };
  every(checkLive, POLL_MS, 'live');
  every(checkClips, CLIPS_MS, 'clips');
  every(weeklyClips, 3600_000, 'clips de la semaine');
  every(checkSchedule, SCHEDULE_MS, 'planning');
  console.log(`📺 Twitch ${LOGIN_() || '(chaîne à régler sur le tableau de bord)'} : live toutes les ${POLL_MS / 1000}s, clips toutes les 5 min, planning toutes les 30 min`);
}

module.exports = { bestClips, storeClips, weeklyClips, start, checkSchedule, checkLive, liveEmbed, _setClient: (c) => (twitch = c) };
