/**
 * 📝 Candidatures : devenir modérateur (🔰 Sentinelle) ou streamer partenaire (🎥 Streamer).
 * /candidature → formulaire → carte dans 📝┃candidatures (staff senior) avec boutons Accepter / Refuser.
 * Le candidat est prévenu en MP ; accepté = rôle donné automatiquement. 14 jours d'attente après un refus.
 */
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { BRAND_COLOR, findChannel, findRole, isStaffMember } = require('./shared');
const { db, save } = require('./store');

const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });
const all = () => (db.applications ??= {});
const COOLDOWN_MS = 14 * 86_400_000;

const KINDS = {
  mod: {
    label: '🛡️ Modérateur',
    role: 'helper',
    questions: [
      ['age', 'Ton âge', TextInputStyle.Short, 3],
      ['why', 'Pourquoi veux-tu rejoindre le staff ?', TextInputStyle.Paragraph, 800],
      ['exp', 'Ton expérience de modération', TextInputStyle.Paragraph, 800],
      ['dispo', 'Tes disponibilités (jours / heures)', TextInputStyle.Short, 150],
      ['case', 'Deux membres s\'insultent : que fais-tu ?', TextInputStyle.Paragraph, 800],
    ],
  },
  streamer: {
    label: '🎥 Streamer partenaire',
    role: 'streamer_role',
    questions: [
      ['channel', 'Lien de ta chaîne (Twitch / TikTok / YouTube)', TextInputStyle.Short, 200],
      ['content', 'Ce que tu streames', TextInputStyle.Paragraph, 600],
      ['stats', 'Tes moyennes (viewers, abonnés)', TextInputStyle.Short, 150],
      ['planning', 'Ton planning de stream', TextInputStyle.Short, 200],
      ['why', 'Pourquoi rejoindre les Ronins ?', TextInputStyle.Paragraph, 800],
    ],
  },
};

function canApply(userId, kind) {
  const mine = Object.values(all()).filter((a) => a.userId === userId && a.kind === kind);
  if (mine.some((a) => a.status === 'pending')) return 'Tu as déjà une candidature en attente.';
  const refused = mine.filter((a) => a.status === 'refused').sort((a, b) => b.decidedAt - a.decidedAt)[0];
  if (refused && Date.now() - refused.decidedAt < COOLDOWN_MS) return `Tu pourras recandidater <t:${Math.floor((refused.decidedAt + COOLDOWN_MS) / 1000)}:R>.`;
  return null;
}

function card(a, user = null) {
  const k = KINDS[a.kind];
  const color = a.status === 'accepted' ? 0x54c987 : a.status === 'refused' ? 0x8a1b1b : BRAND_COLOR;
  const status = a.status === 'pending' ? '⏳ En attente' : a.status === 'accepted' ? `✅ Acceptée par <@${a.decidedBy}>` : `❌ Refusée par <@${a.decidedBy}>`;
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(color)
        .setAuthor({ name: `Candidature ${k.label}`, iconURL: user?.displayAvatarURL?.() })
        .setDescription(`👤 <@${a.userId}> · compte créé <t:${Math.floor((a.accountCreated ?? 0) / 1000)}:R> · arrivé <t:${Math.floor((a.joinedAt ?? 0) / 1000)}:R>\nNiveau ${require('./levels').rankOf(a.userId).level} · ${require('./memberstats').full(a.userId).messages} messages\n\n${status}`)
        .addFields(k.questions.map(([id, label]) => ({ name: label, value: (a.answers[id] || '—').slice(0, 1024) }))),
    ],
    components:
      a.status === 'pending'
        ? [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`app:ok:${a.id}`).setLabel('Accepter').setEmoji('✅').setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId(`app:no:${a.id}`).setLabel('Refuser').setEmoji('❌').setStyle(ButtonStyle.Danger),
            ),
          ]
        : [],
    allowedMentions: { parse: [] },
  };
}

/** Décision (bouton ou tableau de bord). */
async function decide(guild, a, accept, byId) {
  if (a.status !== 'pending') throw new Error('Cette candidature a déjà été traitée.');
  a.status = accept ? 'accepted' : 'refused';
  a.decidedBy = byId;
  a.decidedAt = Date.now();
  save();
  const member = await guild.members.fetch(a.userId).catch(() => null);
  const kind = KINDS[a.kind];
  if (accept && member) {
    const role = findRole(guild, kind.role);
    if (role?.editable) await member.roles.add(role, `Candidature acceptée (${kind.label})`).catch(() => {});
  }
  await member
    ?.send(accept ? `🎉 Ta candidature **${kind.label}** sur **${guild.name}** est **acceptée** ! Bienvenue dans l'équipe ⚔️` : `Ta candidature **${kind.label}** sur **${guild.name}** n'a pas été retenue cette fois. Tu pourras retenter dans 14 jours. Merci pour ta motivation 🙏`)
    .catch(() => {});
  const channel = findChannel(guild, 'applications');
  const msg = a.messageId && channel && (await channel.messages.fetch(a.messageId).catch(() => null));
  await msg?.edit(card(a, member?.user)).catch(() => {});
  require('./feed').push('📝', `Candidature ${kind.label} ${accept ? 'acceptée' : 'refusée'}`);
}

async function handleInteraction(i) {
  const id = i.customId ?? '';
  if (!id.startsWith('app:')) return false;
  const [, action, arg] = id.split(':');
  if (action === 'form') {
    const kind = KINDS[arg];
    const a = { id: `a${Date.now().toString(36)}`, userId: i.user.id, kind: arg, answers: Object.fromEntries(kind.questions.map(([q]) => [q, i.fields.getTextInputValue(q).trim()])), status: 'pending', at: Date.now(), accountCreated: i.user.createdTimestamp, joinedAt: i.member?.joinedTimestamp };
    all()[a.id] = a;
    save();
    const channel = findChannel(i.guild, 'applications') ?? findChannel(i.guild, 'mod_chat');
    if (channel) {
      const msg = await channel.send(card(a, i.user));
      a.messageId = msg.id;
      save();
    }
    require('./feed').push('📝', `Nouvelle candidature ${kind.label}`);
    await i.reply(ephemeral('📝 Candidature envoyée ! Le staff te répondra en message privé.'));
    return true;
  }
  const a = all()[arg];
  if (!a) {
    await i.reply(ephemeral('Candidature introuvable.'));
    return true;
  }
  if (!isStaffMember(i.member, 'senior')) {
    await i.reply(ephemeral('Seul le staff senior peut traiter les candidatures.'));
    return true;
  }
  try {
    await decide(i.guild, a, action === 'ok', i.user.id);
  } catch (err) {
    await i.reply(ephemeral(`❌ ${err.message}`));
    return true;
  }
  await i.reply(ephemeral(action === 'ok' ? '✅ Acceptée, rôle donné et candidat prévenu.' : '❌ Refusée, candidat prévenu.'));
  return true;
}

const commands = [
  {
    category: '🎉 Général',
    module: 'applications',
    data: new SlashCommandBuilder()
      .setName('candidature')
      .setDescription('Postuler pour devenir modérateur ou streamer partenaire')
      .addStringOption((o) =>
        o
          .setName('poste')
          .setDescription('Le poste')
          .setRequired(true)
          .addChoices(...Object.entries(KINDS).map(([value, k]) => ({ name: k.label, value }))),
      ),
    async run(i) {
      const kind = i.options.getString('poste');
      const blocked = canApply(i.user.id, kind);
      if (blocked) return i.reply(ephemeral(`⏳ ${blocked}`));
      const k = KINDS[kind];
      const modal = new ModalBuilder().setCustomId(`app:form:${kind}`).setTitle(`Candidature ${k.label}`.slice(0, 45));
      modal.addComponents(
        k.questions.map(([id, label, style, max]) => new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label.slice(0, 45)).setStyle(style).setRequired(true).setMaxLength(max))),
      );
      return i.showModal(modal);
    },
  },
];

module.exports = { KINDS, all, canApply, card, decide, handleInteraction, commands };
