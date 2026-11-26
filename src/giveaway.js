/**
 * Giveaways : /giveaway lancer → bouton « Participer », tirage automatique à la fin (survit aux redémarrages).
 */
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits: P,
  SlashCommandBuilder,
} = require('discord.js');
const { BRAND_COLOR } = require('./shared');
const { db, save } = require('./store');

const all = () => (db.giveaways ??= {});
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });

/** « 30m », « 2h », « 1j », « 1h30 », « 3d » -> millisecondes */
function parseDuration(text) {
  const re = /(\d+)\s*(j|d|h|m|min)?/gi;
  let ms = 0;
  let m;
  let matched = false;
  while ((m = re.exec(text))) {
    matched = true;
    const n = Number(m[1]);
    const unit = (m[2] || 'm').toLowerCase();
    ms += n * (unit === 'j' || unit === 'd' ? 86_400_000 : unit === 'h' ? 3_600_000 : 60_000);
  }
  return matched ? ms : null;
}

function pick(list, n) {
  const pool = [...list];
  const out = [];
  while (pool.length && out.length < n) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return out;
}

function render(g) {
  const ended = g.ended;
  const embed = new EmbedBuilder()
    .setColor(ended ? 0x3a3a3a : BRAND_COLOR)
    .setTitle(`🎁 ${g.prize}`)
    .setDescription(
      ended
        ? `🏁 Terminé <t:${Math.floor(g.endsAt / 1000)}:R>\n🏆 Gagnant(s) : ${g.winnerIds.length ? g.winnerIds.map((id) => `<@${id}>`).join(', ') : '_personne n\'a participé_'}`
        : `Clique sur **Participer** pour tenter ta chance !\n\n⏳ Fin <t:${Math.floor(g.endsAt / 1000)}:R> (<t:${Math.floor(g.endsAt / 1000)}:f>)\n🏆 ${g.winners} gagnant(s)`,
    )
    .addFields({ name: '👥 Participants', value: String(g.entrants.length), inline: true }, { name: '🎌 Organisé par', value: `<@${g.hostId}>`, inline: true });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('gw:join').setLabel(ended ? 'Terminé' : 'Participer').setEmoji('🎉').setStyle(ButtonStyle.Danger).setDisabled(ended),
  );
  return { embeds: [embed], components: [row] };
}

async function refreshMessage(client, msgId) {
  const g = all()[msgId];
  const channel = client.channels.cache.get(g.channelId);
  const msg = channel && (await channel.messages.fetch(msgId).catch(() => null));
  if (msg) await msg.edit(render(g)).catch(() => {});
  return { channel, msg };
}

async function end(client, msgId, reroll = false) {
  const g = all()[msgId];
  if (!g) return null;
  const guild = client.channels.cache.get(g.channelId)?.guild;
  // Seuls les participants toujours présents sur le serveur peuvent gagner
  const present = [];
  for (const id of g.entrants) if (await guild?.members.fetch(id).catch(() => null)) present.push(id);
  const pool = reroll ? present.filter((id) => !g.winnerIds.includes(id)) : present;
  const winners = pick(pool, reroll ? 1 : g.winners);
  g.winnerIds = reroll ? [...g.winnerIds, ...winners] : winners;
  g.ended = true;
  save();
  const { channel, msg } = await refreshMessage(client, msgId);
  await channel
    ?.send({
      content: winners.length
        ? `🎉 Félicitations ${winners.map((id) => `<@${id}>`).join(', ')} ! Tu remportes **${g.prize}**${reroll ? ' (nouveau tirage)' : ''} ! Contacte <@${g.hostId}>.`
        : `😶 Personne n'a gagné **${g.prize}** (pas assez de participants).`,
      allowedMentions: { users: winners },
      reply: msg ? { messageReference: msg.id, failIfNotExists: false } : undefined,
    })
    .catch(() => {});
  return winners;
}

/** Publie un giveaway (commande ou tableau de bord). */
async function create(channel, { prize, ms, winners = 1, hostId, role = null }) {
  const g = { channelId: channel.id, prize, winners, endsAt: Date.now() + ms, hostId, entrants: [], ended: false, winnerIds: [] };
  const msg = await channel.send({ content: role ? `${role} 🎉 **GIVEAWAY**` : '🎉 **GIVEAWAY**', ...render(g), allowedMentions: { roles: role ? [role.id] : [] } });
  all()[msg.id] = g;
  save();
  return msg;
}

function start(client) {
  require('./guardian').every('giveaways', 'Giveaways', 15_000, () => {
    const now = Date.now();
    for (const [id, g] of Object.entries(all())) {
      if (!g.ended && g.endsAt <= now) end(client, id).catch((e) => console.error('Giveaway :', e.message));
      // Ménage : on oublie les giveaways terminés depuis plus de 30 jours
      if (g.ended && now - g.endsAt > 30 * 86_400_000) delete all()[id];
    }
  }, 15_000);
}

async function handleInteraction(i) {
  if (i.customId !== 'gw:join') return false;
  const g = require('./shared').own(all(), i.message.id);
  if (!g || g.ended) {
    await i.reply(ephemeral('Ce giveaway est terminé.'));
    return true;
  }
  const idx = g.entrants.indexOf(i.user.id);
  if (idx === -1) {
    g.entrants.push(i.user.id);
    require('./quests').progress(i.user.id, 'giveaway');
  }
  else g.entrants.splice(idx, 1);
  save();
  await i.update(render(g));
  await i.followUp(ephemeral(idx === -1 ? '🎉 Tu participes ! Reclique pour te retirer.' : '👋 Tu ne participes plus.'));
  return true;
}

const commands = [
  {
    category: '🎉 Animation',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('giveaway')
      .setDescription('Organiser un giveaway')
      .setDefaultMemberPermissions(P.ManageGuild)
      .addSubcommand((s) =>
        s
          .setName('lancer')
          .setDescription('Lancer un giveaway')
          .addStringOption((o) => o.setName('prix').setDescription('Ce qu\'on gagne').setRequired(true).setMaxLength(200))
          .addStringOption((o) => o.setName('duree').setDescription('Ex : 30m, 2h, 1j, 1h30').setRequired(true))
          .addIntegerOption((o) => o.setName('gagnants').setDescription('Nombre de gagnants (1 par défaut)').setMinValue(1).setMaxValue(20))
          .addChannelOption((o) => o.setName('salon').setDescription('Où le publier (ici par défaut)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
          .addRoleOption((o) => o.setName('mention').setDescription('Rôle à mentionner')),
      )
      .addSubcommand((s) => s.setName('terminer').setDescription('Terminer maintenant').addStringOption((o) => o.setName('message').setDescription('ID du message du giveaway').setRequired(true)))
      .addSubcommand((s) => s.setName('relancer').setDescription('Tirer un nouveau gagnant').addStringOption((o) => o.setName('message').setDescription('ID du message du giveaway').setRequired(true))),
    async run(i) {
      const sub = i.options.getSubcommand();
      if (sub === 'lancer') {
        if (!require('./settings').on('giveaways')) return i.reply(ephemeral('🎁 Les giveaways sont désactivés (tableau de bord → Modules).'));
        const ms = parseDuration(i.options.getString('duree'));
        if (!ms || ms < 60_000 || ms > 60 * 86_400_000) return i.reply(ephemeral('Durée entre 1 minute et 60 jours, ex : `30m`, `2h`, `1j`.'));
        const channel = i.options.getChannel('salon') ?? i.channel;
        const msg = await create(channel, { prize: i.options.getString('prix'), ms, winners: i.options.getInteger('gagnants') ?? 1, hostId: i.user.id, role: i.options.getRole('mention') });
        return i.reply(ephemeral(`✅ Giveaway lancé dans ${channel}. ID : \`${msg.id}\``));
      }
      const id = i.options.getString('message').trim();
      const g = require('./shared').own(all(), id);
      if (!g) return i.reply(ephemeral('Giveaway introuvable (clic droit sur le message → Copier l\'identifiant).'));
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      if (sub === 'terminer' && g.ended) return i.editReply('Ce giveaway est déjà terminé (utilise `relancer`).');
      if (sub === 'relancer' && !g.ended) return i.editReply('Ce giveaway n\'est pas encore terminé.');
      const winners = await end(i.client, id, sub === 'relancer');
      return i.editReply(winners?.length ? `✅ Gagnant(s) : ${winners.map((w) => `<@${w}>`).join(', ')}` : 'Aucun participant éligible.');
    },
  },
];

module.exports = { start, handleInteraction, commands, parseDuration, create, end };
