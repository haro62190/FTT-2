/**
 * 🌙 Soirées gaming avec réservation de places (liste d'attente automatique), rappels en message privé,
 * événement Discord créé automatiquement, et /calendrier : soirées, tournois, événements, anniversaires, défis.
 * Rappels aussi pour les événements Discord : les membres « intéressés » reçoivent un MP 30 min avant.
 */
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventStatus,
  MessageFlags,
  PermissionFlagsBits: P,
  SlashCommandBuilder,
} = require('discord.js');
const { BRAND_COLOR, findChannel } = require('./shared');
const { db, save } = require('./store');

const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });
const all = () => (db.nights ??= {});
const ts = (ms, f = 'F') => `<t:${Math.floor(ms / 1000)}:${f}>`;

function create({ title, game, startsAt, seats, voiceId = null, by = null }) {
  const id = `n${Date.now().toString(36)}`;
  const n = { id, title: String(title).slice(0, 80), game: String(game ?? '').slice(0, 40), startsAt, seats: Math.max(1, seats), voiceId, by, booked: [], waitlist: [], reminded: {}, createdAt: Date.now() };
  all()[id] = n;
  save();
  return n;
}

/** Réserver / annuler. Renvoie 'booked' | 'waitlist' | 'cancelled' | 'promoted:<id>' */
function book(n, userId) {
  if (n.booked.includes(userId) || n.waitlist.includes(userId)) throw new Error('Tu es déjà inscrit.');
  if (Date.now() > n.startsAt + 3 * 3600_000) throw new Error('Cette soirée est terminée.');
  if (n.booked.length < n.seats) {
    n.booked.push(userId);
    save();
    return 'booked';
  }
  n.waitlist.push(userId);
  save();
  return 'waitlist';
}

function cancel(n, userId) {
  const was = n.booked.includes(userId);
  n.booked = n.booked.filter((x) => x !== userId);
  n.waitlist = n.waitlist.filter((x) => x !== userId);
  let promoted = null;
  if (was && n.waitlist.length && n.booked.length < n.seats) {
    promoted = n.waitlist.shift();
    n.booked.push(promoted);
  }
  save();
  return promoted;
}

function payload(n) {
  const left = Math.max(0, n.seats - n.booked.length);
  const over = Date.now() > n.startsAt + 3 * 3600_000;
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(over ? 0x3a3a3a : BRAND_COLOR)
        .setTitle(`🌙 ${n.title}`)
        .setDescription(
          `${n.game ? `🎮 **${n.game}**\n` : ''}🗓️ ${ts(n.startsAt)} (${ts(n.startsAt, 'R')})${n.voiceId ? `\n🔊 <#${n.voiceId}>` : ''}\n\n` +
            `🎟️ **${n.booked.length}/${n.seats}** places réservées${left ? ` · ${left} libre(s)` : ' · complet'}\n` +
            (n.booked.length ? n.booked.map((id) => `<@${id}>`).join(' ') : '_Personne pour l\'instant._') +
            (n.waitlist.length ? `\n\n⏳ Liste d'attente : ${n.waitlist.map((id) => `<@${id}>`).join(' ')}` : ''),
        )
        .setFooter({ text: 'Rappel en message privé 1 h avant · /calendrier pour tout voir' }),
    ],
    components: over
      ? []
      : [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`nt:book:${n.id}`).setLabel(left ? 'Réserver ma place' : 'Liste d\'attente').setEmoji('🎟️').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`nt:cancel:${n.id}`).setLabel('Annuler').setStyle(ButtonStyle.Secondary),
          ),
        ],
    allowedMentions: { parse: [] },
  };
}

async function publish(guild, n) {
  const channel = findChannel(guild, 'nights') ?? findChannel(guild, 'announcements');
  if (!channel) return null;
  const msg = n.messageId && (await channel.messages.fetch(n.messageId).catch(() => null));
  if (msg) return msg.edit(payload(n));
  const sent = await channel.send(payload(n));
  n.messageId = sent.id;
  n.channelId = channel.id;
  save();
  // Événement Discord (apparaît dans le calendrier natif du serveur)
  if (!n.eventId && guild.members.me?.permissions.has(P.ManageEvents)) {
    const ev = await guild.scheduledEvents
      .create({
        name: `🌙 ${n.title}`.slice(0, 100),
        scheduledStartTime: new Date(n.startsAt),
        scheduledEndTime: new Date(n.startsAt + 3 * 3600_000),
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType: GuildScheduledEventEntityType.External,
        entityMetadata: { location: n.voiceId ? `Vocal : ${guild.channels.cache.get(n.voiceId)?.name ?? 'serveur'}` : 'Sur le serveur Discord' },
        description: `${n.game ? `🎮 ${n.game} · ` : ''}${n.seats} places — réserve dans ${channel.name}`,
        reason: 'Soirée gaming',
      })
      .catch(() => null);
    if (ev) {
      n.eventId = ev.id;
      save();
    }
  }
  return sent;
}

async function handleInteraction(i) {
  const id = i.customId ?? '';
  if (!id.startsWith('nt:')) return false;
  const [, action, nid] = id.split(':');
  const n = require('./shared').own(all(), nid);
  if (!n) {
    await i.reply(ephemeral('Soirée introuvable.'));
    return true;
  }
  let note = '';
  try {
    if (action === 'book') note = book(n, i.user.id) === 'booked' ? '🎟️ Place réservée ! Rappel en MP 1 h avant.' : '⏳ Complet : tu es sur liste d\'attente, tu seras prévenu si une place se libère.';
    else {
      const promoted = cancel(n, i.user.id);
      note = '👋 Réservation annulée.';
      if (promoted) i.client.users.send(promoted, `🎟️ Une place s'est libérée : tu participes à **${n.title}** ${ts(n.startsAt, 'R')} !`).catch(() => {});
    }
  } catch (err) {
    note = `❌ ${err.message}`;
  }
  await i.update(payload(n));
  await i.followUp(ephemeral(note));
  return true;
}

// ───────────────────────── Rappels ─────────────────────────

async function tick(client, guild) {
  const now = Date.now();
  for (const n of Object.values(all())) {
    if (n.startsAt < now - 3 * 3600_000) {
      if (n.startsAt < now - 30 * 86_400_000) delete all()[n.id];
      continue;
    }
    for (const [key, before, text] of [
      ['h1', 3600_000, `⏰ Rappel : **${n.title}** commence ${ts(n.startsAt, 'R')} !`],
      ['start', 0, `🎮 **${n.title}** commence maintenant !${n.voiceId ? ` Rejoins <#${n.voiceId}>.` : ''}`],
    ]) {
      if (!n.reminded[key] && now >= n.startsAt - before && now < n.startsAt + 30 * 60_000) {
        n.reminded[key] = true;
        save();
        for (const id of n.booked) await client.users.send(id, text).catch(() => {});
      }
    }
  }
  // Événements Discord : MP aux membres intéressés 30 min avant
  if (!require('./settings').on('reminders')) return;
  const sent = (db.eventReminders ??= {});
  const events = await guild.scheduledEvents.fetch().catch(() => null);
  for (const ev of events?.values() ?? []) {
    const start = ev.scheduledStartTimestamp;
    if (sent[ev.id] || ev.status !== GuildScheduledEventStatus.Scheduled || start - now > 30 * 60_000 || start < now) continue;
    sent[ev.id] = Date.now();
    save();
    const subs = await ev.fetchSubscribers({ limit: 100 }).catch(() => null);
    for (const s of subs?.values() ?? []) {
      await s.user.send(`⏰ **${ev.name}** commence ${ts(start, 'R')} sur ${guild.name} ! ${ev.url}`).catch(() => {});
    }
  }
  for (const [k, at] of Object.entries(sent)) if (now - at > 14 * 86_400_000) delete sent[k];
}

function start(client, guild) {
  const run = () => tick(client, guild).catch((e) => console.error('Soirées / rappels :', e.message));
  setTimeout(run, 20_000);
  require('./guardian').every('nights', 'Soirées et rappels', 60_000, run);
}

// ───────────────────────── Calendrier ─────────────────────────

/** Tout ce qui arrive dans les `days` prochains jours : [{ at, icon, text }] */
async function upcoming(guild, days = 14) {
  const now = Date.now();
  const until = now + days * 86_400_000;
  const items = [];
  for (const n of Object.values(all())) if (n.startsAt > now - 3600_000 && n.startsAt < until) items.push({ at: n.startsAt, icon: '🌙', text: `${n.title} — ${n.booked.length}/${n.seats} places`, url: n.messageId && n.channelId ? `https://discord.com/channels/${guild.id}/${n.channelId}/${n.messageId}` : null });
  for (const t of Object.values(db.tournaments ?? {})) if (t.startsAt && t.status === 'open' && t.startsAt < until) items.push({ at: t.startsAt, icon: '🏆', text: `Tournoi ${t.name} (${t.game}) — ${t.entrants.length}/${t.max} inscrits` });
  const nightEvents = new Set(Object.values(all()).map((n) => n.eventId));
  const events = await guild.scheduledEvents?.fetch().catch(() => null);
  for (const ev of events?.values() ?? []) {
    if (nightEvents.has(ev.id) || ev.scheduledStartTimestamp > until) continue;
    items.push({ at: ev.scheduledStartTimestamp, icon: ev.entityMetadata?.location?.includes('twitch.tv') ? '🔴' : '🎌', text: ev.name, url: ev.url });
  }
  for (const c of Object.values(db.challenges ?? {})) if (!c.done && c.endsAt < until) items.push({ at: c.endsAt, icon: '🎯', text: `Fin du défi : ${c.title}` });
  // Anniversaires
  const today = new Date(now);
  for (const [userId, b] of Object.entries(db.birthdays ?? {})) {
    for (let d = 0; d <= days; d++) {
      const day = new Date(today.getTime() + d * 86_400_000);
      const [, m, dd] = day.toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }).split('-').map(Number);
      if (b.m === m && b.d === dd) {
        items.push({ at: require('./admin').parisDate(`${dd}/${m}/${day.getFullYear()} 00:00`)?.getTime() ?? day.getTime(), icon: '🎂', text: `Anniversaire de <@${userId}>`, allDay: true });
        break;
      }
    }
  }
  return items.sort((a, b) => a.at - b.at);
}

const commands = [
  {
    category: '🎮 Gaming',
    data: new SlashCommandBuilder().setName('calendrier').setDescription('Ce qui arrive sur le serveur : soirées, tournois, lives, événements, anniversaires'),
    async run(i) {
      await i.deferReply();
      const items = await upcoming(i.guild, 14);
      return i.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(BRAND_COLOR)
            .setTitle('🗓️ Calendrier des 14 prochains jours')
            .setDescription(
              items
                .slice(0, 25)
                .map((x) => `${x.icon} ${x.allDay ? `<t:${Math.floor(x.at / 1000)}:D>` : `${ts(x.at, 'f')} (${ts(x.at, 'R')})`} — ${x.url ? `[${x.text}](${x.url})` : x.text}`)
                .join('\n') || '_Rien de prévu pour l\'instant._',
            )
            .setFooter({ text: '🌙 soirée · 🏆 tournoi · 🔴 live · 🎌 événement · 🎯 défi · 🎂 anniversaire' }),
        ],
        allowedMentions: { parse: [] },
      });
    },
  },
  {
    category: '🎮 Gaming',
    module: 'nights',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('soiree')
      .setDescription('Organiser une soirée gaming avec réservation de places (staff)')
      .setDefaultMemberPermissions(P.ManageEvents)
      .addStringOption((o) => o.setName('titre').setDescription('Ex. « Soirée Warzone entre ronins »').setRequired(true).setMaxLength(80))
      .addStringOption((o) => o.setName('date').setDescription('JJ/MM/AAAA HH:MM').setRequired(true))
      .addIntegerOption((o) => o.setName('places').setDescription('Nombre de places').setRequired(true).setMinValue(1).setMaxValue(100))
      .addStringOption((o) => o.setName('jeu').setDescription('Le jeu').setMaxLength(40).setAutocomplete(true))
      .addChannelOption((o) => o.setName('vocal').setDescription('Le salon vocal de la soirée').addChannelTypes(2)),
    autocomplete: (i) => require('./gaming').autocompleteGames(i),
    async run(i) {
      const date = require('./admin').parisDate(i.options.getString('date'));
      if (!date || date.getTime() < Date.now()) return i.reply(ephemeral('❌ Date invalide ou passée. Format : `25/12/2026 21:00`'));
      const n = create({ title: i.options.getString('titre'), game: i.options.getString('jeu') ?? '', startsAt: date.getTime(), seats: i.options.getInteger('places'), voiceId: i.options.getChannel('vocal')?.id ?? null, by: i.user.id });
      const msg = await publish(i.guild, n);
      require('./feed').push('🌙', `Soirée gaming prévue : ${n.title}`);
      return i.reply(ephemeral(`✅ Soirée publiée${msg ? ` : ${msg.url}` : ''}`));
    },
  },
];

module.exports = { all, create, book, cancel, payload, publish, upcoming, start, tick, handleInteraction, commands };
