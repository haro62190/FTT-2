/**
 * Tickets d'assistance : bouton dans 🎫┃ouvrir-un-ticket -> salon privé membre + staff.
 * Fermeture avec confirmation, transcription envoyée dans les logs (et en MP au membre).
 */
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  OverwriteType,
  PermissionFlagsBits: P,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { BRAND_COLOR, findChannel, findRole } = require('./shared');
const { db, save } = require('./store');

const PREFIX = 'ticket:';
const state = () => (db.tickets ??= { counter: 0, open: {} });
const done = async (p) => {
  await p;
  return true;
};
const ephemeral = (content, extra = {}) => ({ content, flags: MessageFlags.Ephemeral, ...extra });

const ACCESS = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks, P.AddReactions];

const isStaff = (member) => member.permissions.has(P.ManageMessages) || require('./shared').isStaffMember(member);

/** Message avec le bouton « Ouvrir un ticket » (publié par /setup dans le salon tickets). */
function panelPayload() {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle('🎫 支援 ・ Assistance')
        .setDescription(
          'Une question, un problème, un signalement ou une demande de partenariat ?\n\n' +
            'Clique sur le bouton ci-dessous : un **salon privé** s\'ouvre entre toi et le staff.\n' +
            '_Un seul ticket ouvert à la fois. Merci de rester respectueux._',
        ),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(PREFIX + 'open').setLabel('Ouvrir un ticket').setEmoji('🎫').setStyle(ButtonStyle.Danger),
      ),
    ],
  };
}

function controls(claimedBy) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(PREFIX + 'claim')
      .setLabel(claimedBy ? 'Pris en charge' : 'Prendre en charge')
      .setEmoji('🙋')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!!claimedBy),
    new ButtonBuilder().setCustomId(PREFIX + 'close').setLabel('Fermer le ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger),
  );
}

async function openTicket(i, subject, details) {
  const s = state();
  // Nettoyage des tickets dont le salon a disparu
  for (const [chId, t] of Object.entries(s.open)) if (!i.guild.channels.cache.has(chId)) delete s.open[chId];
  const existing = Object.entries(s.open).find(([, t]) => t.ownerId === i.user.id);
  if (existing) return i.reply(ephemeral(`Tu as déjà un ticket ouvert : <#${existing[0]}>`));

  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const panel = findChannel(i.guild, 'tickets');
  const staff = require('./shared').staffRoles(i.guild);
  const number = ++s.counter;
  const slug = i.user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'membre';

  const channel = await i.guild.channels.create({
    name: `🎫┃ticket-${String(number).padStart(4, '0')}-${slug}`,
    type: ChannelType.GuildText,
    parent: panel?.parentId ?? null,
    topic: `Ticket de ${i.user.tag} — ${subject}`,
    permissionOverwrites: [
      { id: i.guild.roles.everyone.id, type: OverwriteType.Role, deny: [P.ViewChannel] },
      { id: i.client.user.id, type: OverwriteType.Member, allow: [...ACCESS, P.ManageChannels, P.ManageMessages] },
      { id: i.user.id, type: OverwriteType.Member, allow: ACCESS },
      ...staff.map((r) => ({ id: r.id, type: OverwriteType.Role, allow: [...ACCESS, P.ManageMessages] })),
    ],
    reason: `Ticket #${number} ouvert par ${i.user.tag}`,
  });
  s.open[channel.id] = { number, ownerId: i.user.id, subject, createdAt: Date.now(), claimedBy: null };
  save();

  await channel.send({
    content: `${i.user} ${staff.join(' ')}`.trim(),
    allowedMentions: { users: [i.user.id], roles: staff.map((r) => r.id) },
    embeds: [
      new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle(`🎫 Ticket #${String(number).padStart(4, '0')} — ${subject}`.slice(0, 256))
        .setDescription(`${details || '_Pas de détails._'}\n\nUn membre du staff va te répondre au plus vite. Tu peux ajouter des captures d'écran ici.`)
        .setFooter({ text: `Ouvert par ${i.user.tag}`, iconURL: i.user.displayAvatarURL() })
        .setTimestamp(),
    ],
    components: [controls(null)],
  });
  return i.editReply(`✅ Ton ticket est ouvert : ${channel}`);
}

async function transcript(channel) {
  const all = [];
  let before;
  while (all.length < 1000) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    all.push(...batch.values());
    before = batch.last().id;
  }
  return all
    .reverse()
    .map((m) => {
      const when = new Date(m.createdTimestamp).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
      const text = [m.content, ...m.embeds.map((e) => `[embed] ${e.title ?? ''} ${e.description ?? ''}`), ...m.attachments.map((a) => `[fichier] ${a.url}`)]
        .filter(Boolean)
        .join('\n    ');
      return `[${when}] ${m.author.tag} : ${text}`;
    })
    .join('\n');
}

async function closeTicket(i, ticket) {
  await i.update({ content: '🔒 Fermeture du ticket dans 5 secondes…', components: [] });
  await finalizeClose(i.guild, i.channel, ticket, i.user.tag, `${i.user}`);
}

/** Fermeture commune (Discord ou tableau de bord) : transcription dans les logs + MP, puis suppression du salon. */
async function finalizeClose(guild, channel, ticket, closerTag, closerMention = closerTag) {
  const text = await transcript(channel).catch(() => '(transcription impossible)');
  const name = `ticket-${String(ticket.number).padStart(4, '0')}.txt`;
  const header = `Ticket #${ticket.number} — ${ticket.subject}\nOuvert par ${ticket.ownerId} le ${new Date(ticket.createdAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}\nFermé par ${closerTag}\n\n`;
  const file = () => new AttachmentBuilder(Buffer.from(header + text, 'utf8'), { name });
  await findChannel(guild, 'mod_logs')
    ?.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x808080)
          .setTitle(`🎫 Ticket #${String(ticket.number).padStart(4, '0')} fermé`)
          .setDescription(`**Sujet :** ${ticket.subject}\n**Membre :** <@${ticket.ownerId}>\n**Pris en charge par :** ${ticket.claimedBy ? `<@${ticket.claimedBy}>` : '—'}\n**Fermé par :** ${closerMention}`)
          .setTimestamp(),
      ],
      files: [file()],
    })
    .catch(() => {});
  const owner = await guild.client.users.fetch(ticket.ownerId).catch(() => null);
  await owner?.send({ content: `🎫 Ton ticket **${ticket.subject}** sur **${guild.name}** a été fermé. Voici la transcription :`, files: [file()] }).catch(() => {});
  delete state().open[channel.id];
  module.exports.closedRecently.add(channel.id);
  setTimeout(() => module.exports.closedRecently.delete(channel.id), 10 * 60_000);
  save();
  setTimeout(() => channel.delete(`Ticket fermé par ${closerTag}`).catch(() => {}), 5000);
}

/** Fermer un ticket depuis le tableau de bord. */
async function closeById(guild, channelId, closerTag) {
  const ticket = state().open[channelId];
  const channel = guild.channels.cache.get(channelId);
  if (!ticket) return false;
  if (!channel) {
    delete state().open[channelId];
    save();
    return true;
  }
  await channel.send(`🔒 Ticket fermé depuis le tableau de bord par **${closerTag}**. Suppression dans 5 secondes…`).catch(() => {});
  await finalizeClose(guild, channel, ticket, `${closerTag} (tableau de bord)`);
  return true;
}

/** Boutons / formulaires des tickets. Renvoie true si l'interaction a été traitée. */
async function handleInteraction(i) {
  if (!i.customId?.startsWith(PREFIX)) return false;
  const action = i.customId.slice(PREFIX.length);
  const ticket = state().open[i.channelId];

  switch (action) {
    case 'open':
      if (!require('./settings').on('tickets')) {
        await i.reply(ephemeral('🎫 Les tickets sont désactivés pour le moment. Contacte un membre du staff.'));
        return true;
      }
      await i.showModal(
        new ModalBuilder()
          .setCustomId(PREFIX + 'modal')
          .setTitle('Ouvrir un ticket')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('subject').setLabel('Sujet').setStyle(TextInputStyle.Short).setMaxLength(80).setRequired(true).setPlaceholder('Ex : problème de rôle, signalement…'),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('details').setLabel('Explique-nous (facultatif)').setStyle(TextInputStyle.Paragraph).setMaxLength(1500).setRequired(false),
            ),
          ),
      );
      return true;
    case 'modal':
      await openTicket(i, i.fields.getTextInputValue('subject'), i.fields.getTextInputValue('details'));
      return true;
    case 'claim':
      if (!ticket) return done(i.reply(ephemeral('Ce ticket n\'existe plus.')));
      if (!isStaff(i.member)) return done(i.reply(ephemeral('Seul le staff peut prendre un ticket en charge.')));
      ticket.claimedBy = i.user.id;
      save();
      await i.update({ components: [controls(i.user.id)] });
      await i.channel.send(`🙋 ${i.user} prend en charge ce ticket.`);
      return true;
    case 'close':
      if (!ticket) return done(i.reply(ephemeral('Ce ticket n\'existe plus.')));
      if (i.user.id !== ticket.ownerId && !isStaff(i.member)) return done(i.reply(ephemeral('Tu ne peux pas fermer ce ticket.')));
      await i.reply(
        ephemeral('Fermer ce ticket ? Le salon sera supprimé (une transcription est gardée dans les logs).', {
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(PREFIX + 'close_yes').setLabel('Oui, fermer').setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId(PREFIX + 'close_no').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
            ),
          ],
        }),
      );
      return true;
    case 'close_yes':
      if (!ticket) return done(i.update({ content: 'Ce ticket n\'existe plus.', components: [] }));
      await closeTicket(i, ticket);
      return true;
    case 'close_no':
      await i.update({ content: 'Fermeture annulée.', components: [] });
      return true;
    default:
      return false;
  }
}

const commands = [
  {
    category: '🎫 Tickets',
    data: new SlashCommandBuilder()
      .setName('ticket')
      .setDescription('Gérer le ticket de ce salon')
      .addSubcommand((s) =>
        s
          .setName('ajouter')
          .setDescription('Ajouter quelqu\'un au ticket')
          .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('retirer')
          .setDescription('Retirer quelqu\'un du ticket')
          .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true)),
      )
      .addSubcommand((s) => s.setName('fermer').setDescription('Fermer ce ticket')),
    async run(i) {
      const ticket = state().open[i.channelId];
      if (!ticket) return i.reply(ephemeral('Cette commande s\'utilise dans un salon de ticket.'));
      if (i.user.id !== ticket.ownerId && !isStaff(i.member)) return i.reply(ephemeral('Tu n\'as pas accès à ce ticket.'));
      const sub = i.options.getSubcommand();
      if (sub === 'fermer') {
        i.customId = PREFIX + 'close';
        return handleInteraction(i);
      }
      const user = i.options.getUser('membre');
      if (sub === 'ajouter') {
        await i.channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true });
        return i.reply(`➕ ${user} a été ajouté au ticket.`);
      }
      if (user.id === ticket.ownerId) return i.reply(ephemeral('Impossible de retirer l\'auteur du ticket.'));
      await i.channel.permissionOverwrites.delete(user.id);
      return i.reply(`➖ ${user} a été retiré du ticket.`);
    },
  },
];

/** Salons de tickets (ouverts ou fermés récemment) : ignorés par l'anti-nuke */
const closedRecently = new Set();
const isTicketChannel = (id) => !!state().open[id] || closedRecently.has(id);

module.exports = { panelPayload, handleInteraction, commands, isTicketChannel, closedRecently, closeById };
