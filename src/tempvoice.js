/**
 * Salons vocaux temporaires : rejoindre « ➕ Créer ton vocal » crée un salon perso.
 * Le créateur choisit s'il est libre d'accès ou fermé, et a tous les droits dessus
 * (muet, déplacer, déconnecter, renommer, limite…). Les modos aussi.
 * Le salon est supprimé dès qu'il est vide.
 */
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  OverwriteType,
  PermissionFlagsBits: P,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} = require('discord.js');
const { config, BRAND_COLOR, findRole, findChannel } = require('./shared');
const { db, save } = require('./store');

const settings = { triggerChannel: 'voice_create', nameTemplate: '🏮 Salon de {user}', ...config.tempVoice };
const PREFIX = 'tv:';

const VOICE_USE = [P.ViewChannel, P.Connect, P.Speak, P.Stream, P.UseVAD, P.SendMessages, P.ReadMessageHistory, P.AddReactions, P.EmbedLinks, P.AttachFiles];
const OWNER_EXTRA = [P.MuteMembers, P.DeafenMembers, P.MoveMembers, P.ManageChannels, P.PrioritySpeaker, P.ManageMessages];

const state = () => (db.tempVoice ??= {});
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });

/** Rôles qui peuvent rejoindre tous les vocaux, même fermés (ex : 🤝 Amis). */
const allVoiceRoles = (guild) => config.roles.filter((r) => r.allVoice).map((r) => findRole(guild, r.key)).filter(Boolean);

function buildOverwrites(guild, ownerId, data) {
  const member = findRole(guild, 'member');
  const mod = findRole(guild, 'mod');
  const R = OverwriteType.Role;
  const M = OverwriteType.Member;
  const ow = [
    { id: guild.roles.everyone.id, type: R, deny: [P.ViewChannel, P.Connect] },
    { id: guild.client.user.id, type: M, allow: [...VOICE_USE, ...OWNER_EXTRA, P.ManageRoles] },
    { id: ownerId, type: M, allow: [...VOICE_USE, ...OWNER_EXTRA] },
  ];
  if (mod) ow.push({ id: mod.id, type: R, allow: [...VOICE_USE, ...OWNER_EXTRA] });
  for (const role of allVoiceRoles(guild)) ow.push({ id: role.id, type: R, allow: VOICE_USE });
  if (member) {
    ow.push(
      data.locked
        ? { id: member.id, type: R, allow: [P.ViewChannel], deny: [P.Connect] } // visible mais fermé
        : { id: member.id, type: R, allow: VOICE_USE },
    );
  }
  for (const id of data.allowed ?? []) if (id !== ownerId) ow.push({ id, type: M, allow: VOICE_USE });
  for (const id of data.banned ?? []) if (id !== ownerId) ow.push({ id, type: M, deny: [P.Connect] });
  return ow;
}

function panelPayload(channel, data) {
  const embed = new EmbedBuilder()
    .setColor(data.locked ? 0xe74c3c : 0x2ecc71)
    .setTitle('🎛️ Ton salon vocal')
    .setDescription(
      [
        `👑 Propriétaire : <@${data.ownerId}>`,
        `État : ${data.locked ? '🔒 **Fermé** — seuls les membres autorisés peuvent entrer' : '🔓 **Libre d\'accès** — tout le monde peut entrer'}`,
        '',
        'Tu veux qu\'il soit **libre d\'accès** ou **fermé** ? Choisis ci-dessous 👇',
        '',
        '_Tu as aussi tous les droits : clic droit sur un membre du vocal pour le rendre muet, le déplacer ou le déconnecter._',
      ].join('\n'),
    );
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(PREFIX + 'open').setLabel('Libre d\'accès').setEmoji('🔓').setStyle(ButtonStyle.Success).setDisabled(!data.locked),
    new ButtonBuilder().setCustomId(PREFIX + 'lock').setLabel('Fermé').setEmoji('🔒').setStyle(ButtonStyle.Danger).setDisabled(!!data.locked),
    new ButtonBuilder().setCustomId(PREFIX + 'rename').setLabel('Renommer').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(PREFIX + 'limit').setLabel('Limite').setEmoji('👥').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(PREFIX + 'allow').setLabel('Autoriser').setEmoji('✅').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(PREFIX + 'kick').setLabel('Expulser').setEmoji('👢').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(PREFIX + 'claim').setLabel('Récupérer le salon').setEmoji('👑').setStyle(ButtonStyle.Secondary),
  );
  return { content: `<@${data.ownerId}>`, embeds: [embed], components: [row1, row2], allowedMentions: { users: [data.ownerId] } };
}

async function refresh(channel, data) {
  await channel.permissionOverwrites.set(buildOverwrites(channel.guild, data.ownerId, data));
  if (data.panelId) {
    const msg = await channel.messages.fetch(data.panelId).catch(() => null);
    if (msg) await msg.edit(panelPayload(channel, data)).catch(() => {});
  }
  save();
}

async function createFor(member, trigger) {
  const existingId = Object.keys(state()).find((id) => state()[id].ownerId === member.id);
  const existing = existingId && member.guild.channels.cache.get(existingId);
  if (existing) return member.voice.setChannel(existing).catch(() => {});

  const data = { ownerId: member.id, locked: false, allowed: [], banned: [] };
  const channel = await member.guild.channels.create({
    name: settings.nameTemplate.replace('{user}', member.displayName).slice(0, 100),
    type: ChannelType.GuildVoice,
    parent: trigger.parentId,
    permissionOverwrites: buildOverwrites(member.guild, member.id, data),
    reason: `Salon temporaire de ${member.user.tag}`,
  });
  state()[channel.id] = data;
  save();

  try {
    await member.voice.setChannel(channel);
  } catch {
    // La personne a quitté le vocal entre-temps
    return remove(channel);
  }
  const panel = await channel.send(panelPayload(channel, data)).catch(() => null);
  if (panel) {
    data.panelId = panel.id;
    save();
  }
}

async function remove(channel) {
  delete state()[channel.id];
  save();
  await channel.delete('Salon temporaire vide').catch(() => {});
}

/** Le propriétaire est parti mais d'autres restent : on transmet la couronne. */
async function transferIfOwnerLeft(channel) {
  const data = state()[channel.id];
  if (!data || channel.members.has(data.ownerId)) return;
  const next = channel.members.find((m) => !m.user.bot);
  if (!next) return;
  data.ownerId = next.id;
  await refresh(channel, data);
  await channel.send({ content: `👑 ${next} est maintenant propriétaire du salon.`, allowedMentions: { users: [next.id] } }).catch(() => {});
}

async function onVoiceStateUpdate(oldState, newState) {
  const guild = newState.guild;
  const trigger = findChannel(guild, settings.triggerChannel);

  if (trigger && newState.channelId === trigger.id && newState.member && !newState.member.user.bot) {
    await createFor(newState.member, trigger).catch((err) => console.error('Vocal temporaire :', err.message));
  }

  if (oldState.channelId && oldState.channelId !== newState.channelId && state()[oldState.channelId]) {
    const channel = oldState.channel ?? guild.channels.cache.get(oldState.channelId);
    if (!channel) {
      delete state()[oldState.channelId];
      save();
    } else if (channel.members.filter((m) => !m.user.bot).size === 0) {
      await remove(channel);
    } else {
      await transferIfOwnerLeft(channel).catch(() => {});
    }
  }
}

/** Au démarrage : supprime les salons temporaires vidés pendant que le bot était éteint. */
async function cleanup(guild) {
  for (const id of Object.keys(state())) {
    const channel = await guild.channels.fetch(id).catch(() => null);
    if (!channel) {
      delete state()[id];
    } else if (channel.members.filter((m) => !m.user.bot).size === 0) {
      await remove(channel);
    } else {
      await transferIfOwnerLeft(channel).catch(() => {});
    }
  }
  save();
}

function isModerator(member) {
  const mod = findRole(member.guild, 'mod');
  return member.permissions.has(P.Administrator) || (mod && member.roles.cache.has(mod.id));
}

/** Gère les boutons / menus / formulaires du panneau. Renvoie true si l'interaction a été traitée. */
async function handleInteraction(i) {
  if (!i.customId?.startsWith(PREFIX)) return false;
  const data = state()[i.channelId];
  const channel = i.channel;
  if (!data || !channel) {
    await i.reply(ephemeral('Ce salon temporaire n\'existe plus.'));
    return true;
  }
  const action = i.customId.slice(PREFIX.length);
  const isOwner = i.user.id === data.ownerId;

  if (action === 'claim') {
    if (isOwner) {
      await i.reply(ephemeral('C\'est déjà ton salon 😉'));
      return true;
    }
    if (channel.members.has(data.ownerId) && !isModerator(i.member)) {
      await i.reply(ephemeral('Le propriétaire est toujours là, tu ne peux pas récupérer le salon.'));
      return true;
    }
    data.ownerId = i.user.id;
    await refresh(channel, data);
    await i.reply({ content: `👑 ${i.user} est maintenant propriétaire du salon.`, allowedMentions: { users: [i.user.id] } });
    return true;
  }

  if (!isOwner && !isModerator(i.member)) {
    await i.reply(ephemeral('Seul le propriétaire du salon (ou un modo) peut faire ça.'));
    return true;
  }

  switch (action) {
    case 'open':
    case 'lock':
      data.locked = action === 'lock';
      await refresh(channel, data);
      await i.reply(ephemeral(data.locked ? '🔒 Salon fermé. Utilise « Autoriser » pour laisser entrer quelqu\'un.' : '🔓 Salon libre d\'accès.'));
      break;

    case 'rename':
      await i.showModal(
        new ModalBuilder()
          .setCustomId(PREFIX + 'rename_modal')
          .setTitle('Renommer le salon')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('name').setLabel('Nouveau nom').setStyle(TextInputStyle.Short).setMaxLength(90).setValue(channel.name).setRequired(true),
            ),
          ),
      );
      break;
    case 'rename_modal':
      await channel.setName(i.fields.getTextInputValue('name'));
      await i.reply(ephemeral('✏️ Salon renommé. (Discord limite à 2 renommages toutes les 10 minutes.)'));
      break;

    case 'limit':
      await i.showModal(
        new ModalBuilder()
          .setCustomId(PREFIX + 'limit_modal')
          .setTitle('Limite de places')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('limit').setLabel('Nombre de places (0 = illimité, max 99)').setStyle(TextInputStyle.Short).setMaxLength(2).setValue(String(channel.userLimit)).setRequired(true),
            ),
          ),
      );
      break;
    case 'limit_modal': {
      const n = Number.parseInt(i.fields.getTextInputValue('limit'), 10);
      if (!Number.isInteger(n) || n < 0 || n > 99) {
        await i.reply(ephemeral('Entre un nombre entre 0 et 99.'));
        break;
      }
      await channel.setUserLimit(n);
      await i.reply(ephemeral(n ? `👥 Limite fixée à ${n} places.` : '👥 Plus de limite de places.'));
      break;
    }

    case 'allow':
    case 'kick':
      await i.reply({
        ...ephemeral(action === 'allow' ? 'Qui veux-tu autoriser à entrer, même si le salon est fermé ?' : 'Qui veux-tu expulser du salon ? (il ne pourra plus revenir)'),
        components: [
          new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder().setCustomId(PREFIX + action + '_select').setPlaceholder('Choisis des membres').setMinValues(1).setMaxValues(10),
          ),
        ],
      });
      break;
    case 'allow_select':
      for (const id of i.values) {
        if (!data.allowed.includes(id)) data.allowed.push(id);
        data.banned = data.banned.filter((b) => b !== id);
      }
      await refresh(channel, data);
      await i.update({ content: `✅ Autorisé(s) : ${i.values.map((id) => `<@${id}>`).join(', ')}`, components: [] });
      break;
    case 'kick_select': {
      const kicked = [];
      for (const id of i.values) {
        if (id === data.ownerId || id === i.client.user.id) continue;
        data.allowed = data.allowed.filter((a) => a !== id);
        if (!data.banned.includes(id)) data.banned.push(id);
        const target = channel.members.get(id);
        if (target) await target.voice.disconnect('Expulsé du salon temporaire').catch(() => {});
        kicked.push(`<@${id}>`);
      }
      await refresh(channel, data);
      await i.update({ content: kicked.length ? `👢 Expulsé(s) : ${kicked.join(', ')}` : 'Personne à expulser.', components: [] });
      break;
    }
    default:
      return false;
  }
  return true;
}

module.exports = { onVoiceStateUpdate, handleInteraction, cleanup };
