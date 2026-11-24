/**
 * 🚩 Signalements avec suivi : /signaler membre raison [message] → carte dans 🚩┃signalements avec boutons
 * (Je m'en occupe / Résolu / Sans suite). Le membre qui signale est prévenu en MP à chaque étape et suit
 * ses signalements avec /mes-signalements. Le nom de la personne qui signale n'est visible que du staff.
 */
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { findChannel, isStaffMember } = require('./shared');
const { db, save } = require('./store');

const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });
const all = () => (db.reports ??= {});
const STATUS = {
  open: ['🟠', 'Nouveau'],
  claimed: ['🔵', 'Pris en charge'],
  resolved: ['✅', 'Résolu'],
  dismissed: ['⚪', 'Classé sans suite'],
};
const pendingCount = () => Object.values(all()).filter((r) => r.status === 'open' || r.status === 'claimed').length;

function create({ reporter, target, reason, link = null }) {
  const meta = (db.reportsMeta ??= { counter: 0 });
  const id = ++meta.counter;
  const r = { id, reporter, target, reason: String(reason).slice(0, 1000), link, status: 'open', at: Date.now(), history: [{ at: Date.now(), status: 'open' }] };
  all()[id] = r;
  save();
  return r;
}

function setStatus(r, status, byId, note = '') {
  if (!STATUS[status]) throw new Error('Statut inconnu.');
  r.status = status;
  r.handler = byId;
  r.history.push({ at: Date.now(), status, by: byId, note: String(note).slice(0, 300) });
  save();
  return r;
}

function card(r) {
  const [emoji, label] = STATUS[r.status];
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(r.status === 'open' ? 0xe67e22 : r.status === 'claimed' ? 0x3987e5 : r.status === 'resolved' ? 0x54c987 : 0x666666)
        .setTitle(`🚩 Signalement #${r.id} — ${emoji} ${label}`)
        .setDescription(`**Membre signalé :** <@${r.target}>\n**Signalé par :** <@${r.reporter}>\n\n${r.reason}${r.link ? `\n\n🔗 [Message concerné](${r.link})` : ''}`)
        .addFields({ name: 'Suivi', value: r.history.map((h) => `<t:${Math.floor(h.at / 1000)}:f> ${STATUS[h.status][0]} ${STATUS[h.status][1]}${h.by ? ` par <@${h.by}>` : ''}${h.note ? ` — ${h.note}` : ''}`).join('\n').slice(0, 1024) })
        .setTimestamp(r.at),
    ],
    components:
      r.status === 'resolved' || r.status === 'dismissed'
        ? []
        : [
            new ActionRowBuilder().addComponents(
              ...(r.status === 'open' ? [new ButtonBuilder().setCustomId(`rp:claimed:${r.id}`).setLabel('Je m\'en occupe').setEmoji('🔵').setStyle(ButtonStyle.Primary)] : []),
              new ButtonBuilder().setCustomId(`rp:resolved:${r.id}`).setLabel('Résolu').setEmoji('✅').setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId(`rp:dismissed:${r.id}`).setLabel('Sans suite').setStyle(ButtonStyle.Secondary),
            ),
          ],
    allowedMentions: { parse: [] },
  };
}

const DM = {
  claimed: (r) => `🔵 Ton signalement #${r.id} a été pris en charge par le staff.`,
  resolved: (r) => `✅ Ton signalement #${r.id} est traité. Merci d'aider à garder le dojo sain 🙏`,
  dismissed: (r) => `⚪ Ton signalement #${r.id} a été examiné et classé sans suite. Merci quand même !`,
};

/** Changement de statut (bouton ou site) : carte mise à jour + MP à la personne qui a signalé. */
async function update(guild, r, status, byId, note = '') {
  setStatus(r, status, byId, note);
  const channel = findChannel(guild, 'reports') ?? findChannel(guild, 'mod_chat');
  const msg = r.messageId && channel && (await channel.messages.fetch(r.messageId).catch(() => null));
  await msg?.edit(card(r)).catch(() => {});
  await guild.client.users.send(r.reporter, DM[status](r)).catch(() => {});
}

async function handleInteraction(i) {
  const id = i.customId ?? '';
  if (!id.startsWith('rp:')) return false;
  const [, status, rid] = id.split(':');
  const r = all()[rid];
  if (!r) {
    await i.reply(ephemeral('Signalement introuvable.'));
    return true;
  }
  if (!isStaffMember(i.member)) {
    await i.reply(ephemeral('Réservé au staff.'));
    return true;
  }
  await i.deferUpdate();
  await update(i.guild, r, status, i.user.id);
  return true;
}

const commands = [
  {
    category: '🎉 Général',
    module: 'reports',
    data: new SlashCommandBuilder()
      .setName('signaler')
      .setDescription('Signaler discrètement un problème au staff')
      .addUserOption((o) => o.setName('membre').setDescription('Le membre concerné').setRequired(true))
      .addStringOption((o) => o.setName('raison').setDescription('Ce qui s\'est passé').setRequired(true).setMaxLength(1000))
      .addStringOption((o) => o.setName('message').setDescription('Lien du message concerné (clic droit → Copier le lien)').setMaxLength(200)),
    async run(i) {
      const target = i.options.getUser('membre');
      if (target.id === i.user.id) return i.reply(ephemeral('Tu ne peux pas te signaler toi-même.'));
      const recentByMe = Object.values(all()).filter((r) => r.reporter === i.user.id && Date.now() - r.at < 3600_000).length;
      if (recentByMe >= 5) return i.reply(ephemeral('⏳ Tu as fait beaucoup de signalements récemment : le staff les traite, merci de patienter.'));
      const link = i.options.getString('message');
      const r = create({ reporter: i.user.id, target: target.id, reason: i.options.getString('raison'), link: link && /^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/channels\/\d+\/\d+\/\d+$/.test(link) ? link : null });
      const channel = findChannel(i.guild, 'reports') ?? findChannel(i.guild, 'mod_chat');
      if (channel) {
        const msg = await channel.send(card(r));
        r.messageId = msg.id;
        save();
      }
      require('./feed').push('🚩', `Nouveau signalement #${r.id}`);
      return i.reply(ephemeral(`🚩 Signalement **#${r.id}** envoyé au staff, en toute discrétion. Tu seras prévenu en MP de son suivi (\`/mes-signalements\`).`));
    },
  },
  {
    category: '🎉 Général',
    module: 'reports',
    data: new SlashCommandBuilder().setName('mes-signalements').setDescription('Le suivi de tes signalements'),
    run(i) {
      const mine = Object.values(all()).filter((r) => r.reporter === i.user.id).sort((a, b) => b.at - a.at).slice(0, 10);
      return i.reply(ephemeral(mine.map((r) => `**#${r.id}** · ${STATUS[r.status][0]} ${STATUS[r.status][1]} · <@${r.target}> · <t:${Math.floor(r.at / 1000)}:R>`).join('\n') || 'Tu n\'as fait aucun signalement.'));
    },
  },
];

module.exports = { STATUS, all, create, setStatus, update, card, pendingCount, handleInteraction, commands };
