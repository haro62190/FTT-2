/**
 * 📊 Automatisation intelligente :
 *  - Récap hebdomadaire (lundi matin, 📡┃annonces) : messages, vocal, arrivées, lives, top de la semaine, clips…
 *  - Rapport staff (🛡️┃staff) : salons inutilisés depuis 30 jours + suggestions d'événements
 *    (meilleurs créneaux selon l'activité réelle, jeux les plus joués par la commu)
 *  - Suivi d'activité : dernier message / dernière connexion de chaque salon, activité par jour et par heure
 */
const { ActionRowBuilder, ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits: P, StringSelectMenuBuilder } = require('discord.js');
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
    .filter((c) => !(db.channelKeep?.[c.id] > Date.now()) && !db.archivedChannels?.[c.id] && c.parent?.name !== ARCHIVE_NAME)
    .map((c) => ({ id: c.id, name: c.name, voice: c.type === ChannelType.GuildVoice, last: db.channelActivity?.[c.id] ?? null }));
  return { ready: true, list };
}

// ───────── Actions proposées sur les salons inactifs (toujours déclenchées par un admin) ─────────
const ARCHIVE_NAME = '🗄️ ARCHIVES';
const NUDGES = [
  '🍜 C\'est bien calme par ici… Quelqu\'un a quelque chose à partager aujourd\'hui ?',
  '⚔️ Ce salon attend vos messages, ronins ! Quoi de neuf de votre côté ?',
  '🏮 Petit rappel : ce salon est fait pour vous. Lancez la discussion !',
];

/**
 * Applique une action choisie par un admin : 'archive' (lecture seule + rangé dans 🗄️ ARCHIVES, réversible),
 * 'restore' (annule l'archivage), 'keep' (ne plus le signaler pendant 60 jours), 'nudge' (message de relance).
 */
async function channelAction(guild, channelId, action, by = '?') {
  const ch = guild.channels.cache.get(channelId);
  if (!ch) throw new Error('Salon introuvable.');
  const arch = (db.archivedChannels ??= {});
  if (action === 'keep') {
    (db.channelKeep ??= {})[ch.id] = Date.now() + 60 * 86_400_000;
    save();
    return `✅ #${ch.name} est gardé : il ne sera plus signalé pendant 60 jours.`;
  }
  if (action === 'nudge') {
    if (!ch.isTextBased?.() || ch.isVoiceBased?.()) throw new Error('La relance ne marche que dans un salon textuel.');
    await ch.send({ content: NUDGES[Math.floor(Math.random() * NUDGES.length)], allowedMentions: { parse: [] } });
    (db.channelKeep ??= {})[ch.id] = Date.now() + 14 * 86_400_000; // on laisse 2 semaines pour voir
    save();
    return `📣 Message de relance posté dans #${ch.name}.`;
  }
  if (action === 'archive') {
    if (arch[ch.id]) throw new Error('Ce salon est déjà archivé.');
    let cat = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === ARCHIVE_NAME);
    cat ??= await guild.channels.create({ name: ARCHIVE_NAME, type: ChannelType.GuildCategory, reason: `Archivage demandé par ${by}` });
    arch[ch.id] = { parentId: ch.parentId, position: ch.rawPosition, overwrites: ch.permissionOverwrites.cache.map((o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString() })), by, at: Date.now() };
    save();
    await ch.setParent(cat.id, { lockPermissions: false, reason: `Archivage demandé par ${by}` });
    await ch.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false, Connect: false, AddReactions: false }, { reason: 'Salon archivé (lecture seule)' });
    return `📦 #${ch.name} archivé : en lecture seule dans ${ARCHIVE_NAME}. Annulable depuis le site (🕸️ Salons inactifs).`;
  }
  if (action === 'restore') {
    const a = arch[ch.id];
    if (!a) throw new Error('Ce salon n\'est pas archivé.');
    await ch.setParent(a.parentId ?? null, { lockPermissions: false, reason: `Désarchivage par ${by}` });
    await ch.permissionOverwrites.set(a.overwrites.map((o) => ({ ...o, allow: BigInt(o.allow), deny: BigInt(o.deny) })), `Désarchivage par ${by}`);
    delete arch[ch.id];
    save();
    return `↩️ #${ch.name} est revenu à sa place, avec ses permissions d'origine.`;
  }
  throw new Error('Action inconnue.');
}

/** Menu pour le rapport staff : choisir un salon inactif et l'action à faire. */
function actionMenu(list) {
  if (!list.length) return [];
  const options = list.slice(0, 8).flatMap((c) => [
    { label: `📦 Archiver ${c.voice ? '🔊' : '#'}${c.name}`.slice(0, 100), value: `archive:${c.id}` },
    { label: `✅ Garder ${c.voice ? '🔊' : '#'}${c.name}`.slice(0, 100), value: `keep:${c.id}` },
    ...(c.voice ? [] : [{ label: `📣 Relancer #${c.name}`.slice(0, 100), value: `nudge:${c.id}` }]),
  ]);
  return [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ia:act').setPlaceholder('Que faire de ces salons ? (rien n\'est fait sans ton choix)').addOptions(options.slice(0, 25)))];
}

async function handleInteraction(i) {
  if (i.customId !== 'ia:act' || !i.isStringSelectMenu()) return false;
  if (!i.memberPermissions?.has(P.ManageChannels)) {
    await i.reply({ content: 'Réservé aux admins (permission « Gérer les salons »).', flags: MessageFlags.Ephemeral });
    return true;
  }
  const [action, id] = i.values[0].split(':');
  try {
    const msg = await channelAction(i.guild, id, action, i.user.username);
    require('./audit').record({ userId: i.user.id, user: i.user.username, source: 'discord', action: 'salon inactif', details: msg });
    await i.reply({ content: msg, flags: MessageFlags.Ephemeral });
  } catch (e) {
    await i.reply({ content: `❌ ${e.message}`, flags: MessageFlags.Ephemeral });
  }
  return true;
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
      components: unused.ready ? actionMenu(unused.list) : [],
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

module.exports = { DAYS, track, unusedChannels, channelAction, actionMenu, handleInteraction, ARCHIVE_NAME, bestSlots, topGames, suggestions, weeklyStats, postWeekly, check, start, parisParts };
