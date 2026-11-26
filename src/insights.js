/**
 * 📊 Automatisation intelligente :
 *  - Récap hebdomadaire (lundi matin, 📡┃annonces) : messages, vocal, arrivées, lives, top de la semaine, clips…
 *  - Rapport staff (🛡️┃staff) : salons inutilisés depuis 30 jours + suggestions d'événements
 *    (meilleurs créneaux selon l'activité réelle, jeux les plus joués par la commu)
 *  - Suivi d'activité : dernier message / dernière connexion de chaque salon, activité par jour et par heure
 */
const { ChannelType, EmbedBuilder } = require('discord.js');
const { BRAND_COLOR, config, findChannel } = require('./shared');
const { db, save } = require('./store');
const settings = require('./settings');

const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const UNUSED_DAYS = 30;

function parisParts(t = Date.now()) {
  const d = new Date(t);
  const dow = DAYS.indexOf(d.toLocaleDateString('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' }));
  const hour = Number(d.toLocaleString('fr-FR', { hour: '2-digit', hour12: false, timeZone: 'Europe/Paris' }).slice(0, 2)) % 24;
  return { dow, hour };
}

/** Appelé pour chaque message (et chaque arrivée en vocal) : dernière activité du salon + carte jour/heure. */
function track(channelId, isMessage = true) {
  (db.channelActivity ??= {})[channelId] = Date.now();
  if (isMessage) {
    const { dow, hour } = parisParts();
    const heat = (db.activityHeat ??= Array(7 * 24).fill(0));
    heat[dow * 24 + hour]++;
  }
  // Pas de save() à chaque message : la sauvegarde groupée de store.js s'en charge au prochain save()
}

/** Salons sans activité depuis UNUSED_DAYS jours (hors salons en lecture seule, du staff et du bot). */
function unusedChannels(guild) {
  const skip = new Set(['public-readonly', 'members-readonly', 'staff', 'staff-senior', 'stats', 'quarantine']);
  const byName = new Map(config.categories.flatMap((c) => c.channels).map((ch) => [ch.name, ch]));
  const since = Date.now() - UNUSED_DAYS * 86_400_000;
  const tracked = db.trackingSince ?? Date.now();
  if (Date.now() - tracked < UNUSED_DAYS * 86_400_000) return { ready: false, list: [] };
  const list = guild.channels.cache
    .filter((c) => (c.type === ChannelType.GuildText || c.type === ChannelType.GuildVoice) && !skip.has(byName.get(c.name)?.access))
    .filter((c) => !(db.tempVoice?.[c.id]) && (db.channelActivity?.[c.id] ?? 0) < since)
    .map((c) => ({ id: c.id, name: c.name, voice: c.type === ChannelType.GuildVoice, last: db.channelActivity?.[c.id] ?? null }));
  return { ready: true, list };
}

/** Les meilleurs créneaux (jour + heure) selon les messages, en ignorant la nuit. */
function bestSlots(n = 3) {
  const heat = db.activityHeat ?? [];
  return heat
    .map((v, k) => ({ dow: Math.floor(k / 24), hour: k % 24, v }))
    .filter((s) => s.v > 0 && s.hour >= 14 && s.hour <= 23)
    .sort((a, b) => b.v - a.v)
    .slice(0, n);
}

/** Jeux les plus présents dans les profils joueurs et les recherches. */
function topGames(n = 3) {
  const counts = new Map();
  const add = (g, w = 1) => {
    const key = String(g).trim().toLowerCase();
    if (!key) return;
    const cur = counts.get(key) ?? { name: String(g).trim(), n: 0 };
    cur.n += w;
    counts.set(key, cur);
  };
  for (const p of Object.values(db.players ?? {})) for (const g of p.games ?? []) add(g);
  for (const l of Object.values(db.lfg ?? {})) add(l.game, 2);
  return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, n);
}

function suggestions() {
  const slots = bestSlots(3);
  const games = topGames(3);
  const out = [];
  if (slots[0] && games[0]) out.push(`🌙 Soirée **${games[0].name}** le **${DAYS[slots[0].dow]} à ${slots[0].hour} h** (créneau le plus actif du serveur) → \`/soiree\``);
  if (games[1]) out.push(`🏆 Petit tournoi **${games[1].name}** (${games[1].n} joueurs intéressés) → \`/tournoi-admin creer\``);
  if (slots[1]) out.push(`🧠 Quiz ou soirée défis le **${DAYS[slots[1].dow]} à ${slots[1].hour} h** → \`/quiz\``);
  const week = require('./history').series(7);
  const msgs = week.reduce((n, p) => n + (p.messages ?? 0), 0);
  const prev = require('./history').series(14).slice(0, 7).reduce((n, p) => n + (p.messages ?? 0), 0);
  if (prev && msgs < prev * 0.8) out.push('🔥 L\'activité baisse cette semaine : un **boost XP ×2** le week-end peut relancer la commu → `/boost lancer`');
  if (!Object.values(db.challenges ?? {}).some((c) => !c.done && !c.failed && Date.now() < c.endsAt)) out.push(`🎯 Aucun défi collectif en cours : par exemple **${Math.max(500, Math.round(msgs * 1.2 / 100) * 100)} messages** cette semaine → \`/defi\``);
  return out;
}

// ───────────────────────── Récap hebdomadaire ─────────────────────────

function weeklyStats() {
  const series = require('./history').series(14);
  const cur = series.slice(7);
  const prev = series.slice(0, 7);
  const sum = (list, k) => list.reduce((n, p) => n + (p[k] ?? 0), 0);
  const delta = (a, b) => (b ? `${a >= b ? '↑' : '↓'} ${Math.abs(Math.round(((a - b) / b) * 100))} %` : '');
  const lives = require('./streams').summary(7);
  return {
    messages: sum(cur, 'messages'),
    messagesDelta: delta(sum(cur, 'messages'), sum(prev, 'messages')),
    voiceHours: Math.round(sum(cur, 'voice') / 60),
    voiceDelta: delta(sum(cur, 'voice'), sum(prev, 'voice')),
    joins: sum(cur, 'joins'),
    leaves: sum(cur, 'leaves'),
    lives,
    clip: require('./twitchlive').bestClips(7, 1)[0] ?? null,
    lastWeek: db.weeksHistory?.[0] ?? null,
  };
}

async function postWeekly(guild) {
  const s = weeklyStats();
  const channel = findChannel(guild, 'announcements') ?? findChannel(guild, 'general');
  const medals = ['🥇', '🥈', '🥉'];
  const top = s.lastWeek?.top?.slice(0, 3) ?? [];
  await channel
    ?.send({
      embeds: [
        new EmbedBuilder()
          .setColor(BRAND_COLOR)
          .setTitle('📜 週報 ・ La semaine du dojo')
          .addFields(
            { name: '💬 Messages', value: `**${s.messages.toLocaleString('fr-FR')}** ${s.messagesDelta}`, inline: true },
            { name: '🎙️ Vocal', value: `**${s.voiceHours} h** ${s.voiceDelta}`, inline: true },
            { name: '👥 Arrivées', value: `**+${s.joins}** · ${s.leaves} départ(s)`, inline: true },
            ...(s.lives.count ? [{ name: '📺 Lives', value: `${s.lives.count} live(s) · ${s.lives.hours.toFixed(1).replace('.', ',')} h${s.lives.peak ? ` · pic ${s.lives.peak} viewers` : ''}`, inline: true }] : []),
            ...(top.length ? [{ name: '🔥 Les plus actifs', value: top.map((t, k) => `${medals[k]} <@${t.userId}> — ${t.xp.toLocaleString('fr-FR')} XP`).join('\n') }] : []),
            ...(s.clip ? [{ name: '🎬 Clip de la semaine', value: `[${s.clip.title}](${s.clip.url}) par ${s.clip.creator}` }] : []),
          )
          .setFooter({ text: 'Bonne semaine les ronins ⚔️ · /calendrier pour la suite' }),
      ],
      allowedMentions: { parse: [] },
    })
    .catch(() => {});

  // Rapport réservé au staff
  const staff = findChannel(guild, 'mod_chat');
  const unused = unusedChannels(guild);
  const ideas = suggestions();
  await staff
    ?.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x8b0000)
          .setTitle('🧭 Rapport hebdo du staff')
          .addFields(
            {
              name: `🕸️ Salons inutilisés (${UNUSED_DAYS} j)`,
              value: !unused.ready
                ? `_Analyse disponible après ${UNUSED_DAYS} jours de suivi._`
                : unused.list.map((c) => `${c.voice ? '🔊' : '#'} ${c.name}${c.last ? ` — dernière activité <t:${Math.floor(c.last / 1000)}:R>` : ' — aucune activité'}`).join('\n').slice(0, 1024) || 'Aucun, tout le serveur vit ✅',
            },
            { name: '💡 Idées d\'événements', value: ideas.join('\n').slice(0, 1024) || '_Pas encore assez de données._' },
            ...(require('./reports').pendingCount() ? [{ name: '🚩 Signalements en attente', value: `${require('./reports').pendingCount()} → 🚩┃signalements` }] : []),
          ),
      ],
    })
    .catch(() => {});
  require('./feed').push('📜', 'Récap hebdomadaire publié');
}

async function check(guild) {
  if (!settings.on('weeklyRecap')) return;
  const week = require('./seasons').currentWeek();
  const { hour } = parisParts();
  if (db.weeklyRecapPosted === week || hour < 10) return;
  if (db.weeklyRecapPosted === undefined) {
    db.weeklyRecapPosted = week; // premier lancement : premier récap lundi prochain
    return save();
  }
  db.weeklyRecapPosted = week;
  save();
  await postWeekly(guild);
}

function start(guild) {
  db.trackingSince ??= Date.now();
  save();
  require('./guardian').every('insights', 'Récap hebdo', 15 * 60_000, () => check(guild).catch((e) => console.error('Récap hebdo :', e.message)));
}

module.exports = { DAYS, track, unusedChannels, bestSlots, topGames, suggestions, weeklyStats, postWeekly, check, start, parisParts };
