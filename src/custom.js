/**
 * Créé depuis le tableau de bord (ou /commande) :
 *  - commandes personnalisées : « !discord », « !planning »… → réponse définie par le staff
 *  - menus de rôles : un message avec des boutons pour prendre / enlever des rôles choisis par le staff
 */
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  MessageFlags,
  PermissionFlagsBits: P,
  SlashCommandBuilder,
} = require('discord.js');
const { BRAND_COLOR } = require('./shared');
const { db, save } = require('./store');

const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });
const commandsDb = () => (db.customCommands ??= {});
const menus = () => (db.roleMenus ??= {});
const PREFIX = () => db.customPrefix ?? '!';
const RESERVED = new Set(['__proto__', 'constructor', 'prototype', 'hasownproperty', 'tostring', 'valueof']);
const cleanName = (n) => {
  const c = String(n ?? '').trim().toLowerCase().replace(/^!/, '').replace(/[^a-z0-9àâäéèêëîïôöùûüç_-]/g, '').slice(0, 32);
  return RESERVED.has(c) ? '' : c;
};

/** Un rôle peut-il être distribué en libre-service ? (jamais de rôle avec des permissions dangereuses) */
function safeRole(role) {
  if (!role || role.managed || role.id === role.guild.id || !role.editable) return false;
  const danger = [P.Administrator, P.ManageGuild, P.ManageRoles, P.ManageChannels, P.BanMembers, P.KickMembers, P.ModerateMembers, P.ManageMessages, P.MentionEveryone, P.ManageWebhooks];
  return !danger.some((p) => role.permissions.has(p));
}

// ───────────────────────── Commandes personnalisées ─────────────────────────

const cooldown = new Map();

async function onMessage(message) {
  if (!message.guild || message.author.bot || !message.content.startsWith(PREFIX())) return;
  if (!require('./settings').on('customCommands')) return;
  const name = cleanName(message.content.slice(PREFIX().length).split(/\s+/)[0]);
  const cmd = require('./shared').own(commandsDb(), name);
  if (!cmd) return;
  const key = `${message.channelId}:${name}`;
  if (Date.now() - (cooldown.get(key) ?? 0) < 5000) return; // anti-spam : 5 s par salon
  cooldown.set(key, Date.now());
  const text = cmd.response.replaceAll('{user}', `${message.author}`).replaceAll('{server}', message.guild.name);
  cmd.uses = (cmd.uses ?? 0) + 1;
  save();
  await message.channel
    .send(
      cmd.embed
        ? { embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setDescription(text.slice(0, 4000))], allowedMentions: { parse: [] } }
        : { content: text.slice(0, 2000), allowedMentions: { users: [message.author.id] } },
    )
    .catch(() => {});
}

function setCommand(name, response, embed = false) {
  const n = cleanName(name);
  if (!n || !response?.trim()) return null;
  commandsDb()[n] = { response: response.trim().slice(0, 4000), embed: !!embed, uses: commandsDb()[n]?.uses ?? 0 };
  save();
  return n;
}
function deleteCommand(name) {
  const n = cleanName(name);
  const had = !!commandsDb()[n];
  delete commandsDb()[n];
  save();
  return had;
}

// ───────────────────────── Menus de rôles ─────────────────────────

function renderMenu(id, m, guild) {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(m.title)
    .setDescription(
      `${m.description ? `${m.description}\n\n` : ''}${m.roles.map((r) => `${r.emoji ? `${r.emoji} ` : ''}**${guild.roles.cache.get(r.roleId)?.name ?? '?'}**`).join('\n')}\n\n_${m.exclusive ? 'Un seul choix possible.' : 'Clique pour prendre un rôle, reclique pour l\'enlever.'}_`,
    );
  const rows = [];
  m.roles.slice(0, 25).forEach((r, n) => {
    if (n % 5 === 0) rows.push(new ActionRowBuilder());
    const btn = new ButtonBuilder()
      .setCustomId(`rm:${id}:${r.roleId}`)
      .setLabel((guild.roles.cache.get(r.roleId)?.name ?? 'Rôle').replace(/^\p{Extended_Pictographic}️?\s*/u, '').slice(0, 80) || 'Rôle')
      .setStyle(ButtonStyle.Secondary);
    if (r.emoji) btn.setEmoji(r.emoji);
    rows.at(-1).addComponents(btn);
  });
  return { embeds: [embed], components: rows };
}

/** Publie (ou met à jour) un menu de rôles. roles = [{ roleId, emoji }] */
async function publishMenu(guild, { id, channelId, title, description, roles, exclusive }) {
  const channel = guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) throw new Error('Salon introuvable');
  const valid = roles.filter((r) => safeRole(guild.roles.cache.get(r.roleId))).slice(0, 25);
  if (!valid.length) throw new Error('Aucun rôle valide (rôles sans permission de modération, sous le rôle du bot)');
  const menuId = id ?? Date.now().toString(36);
  const data = { channelId, title: String(title).slice(0, 200), description: String(description ?? '').slice(0, 2000), roles: valid, exclusive: !!exclusive, messageId: menus()[menuId]?.messageId };
  let msg = data.messageId && (await channel.messages.fetch(data.messageId).catch(() => null));
  if (msg) await msg.edit(renderMenu(menuId, data, guild));
  else msg = await channel.send(renderMenu(menuId, data, guild));
  data.messageId = msg.id;
  menus()[menuId] = data;
  save();
  return menuId;
}

async function deleteMenu(guild, id) {
  const m = require('./shared').own(menus(), id);
  if (!m) return false;
  const msg = await guild.channels.cache.get(m.channelId)?.messages.fetch(m.messageId).catch(() => null);
  await msg?.delete().catch(() => {});
  delete menus()[id];
  save();
  return true;
}

async function handleInteraction(i) {
  if (!i.customId?.startsWith('rm:')) return false;
  const [, id, roleId] = i.customId.split(':');
  const m = menus()[id];
  const role = i.guild.roles.cache.get(roleId);
  if (!m || !m.roles.some((r) => r.roleId === roleId) || !safeRole(role)) {
    await i.reply(ephemeral('⚠️ Ce rôle n\'est plus disponible.'));
    return true;
  }
  const member = await i.guild.members.fetch(i.user.id);
  if (member.roles.cache.has(roleId)) {
    await member.roles.remove(role, 'Menu de rôles');
    await i.reply(ephemeral(`➖ **${role.name}** retiré.`));
    return true;
  }
  if (m.exclusive) {
    const others = m.roles.map((r) => r.roleId).filter((r) => r !== roleId && member.roles.cache.has(r));
    if (others.length) await member.roles.remove(others, 'Menu de rôles (choix unique)').catch(() => {});
  }
  await member.roles.add(role, 'Menu de rôles');
  await i.reply(ephemeral(`➕ **${role.name}** ajouté !`));
  return true;
}

// ───────────────────────── Commande /commande ─────────────────────────

const commands = [
  {
    category: '🏯 Kensei',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('commande')
      .setDescription('Commandes personnalisées (!discord, !planning…)')
      .setDefaultMemberPermissions(P.ManageGuild)
      .addSubcommand((s) =>
        s
          .setName('ajouter')
          .setDescription('Créer ou modifier une commande')
          .addStringOption((o) => o.setName('nom').setDescription('Sans le !, ex : discord').setRequired(true).setMaxLength(32))
          .addStringOption((o) => o.setName('reponse').setDescription('Réponse ({user} = la personne, \\n = retour à la ligne)').setRequired(true).setMaxLength(2000))
          .addBooleanOption((o) => o.setName('encadre').setDescription('Réponse dans un encadré (embed)')),
      )
      .addSubcommand((s) => s.setName('retirer').setDescription('Supprimer une commande').addStringOption((o) => o.setName('nom').setDescription('Le nom').setRequired(true)))
      .addSubcommand((s) => s.setName('liste').setDescription('Voir les commandes')),
    run(i) {
      const sub = i.options.getSubcommand();
      if (sub === 'ajouter') {
        const n = setCommand(i.options.getString('nom'), i.options.getString('reponse').replaceAll('\\n', '\n'), i.options.getBoolean('encadre'));
        return i.reply(ephemeral(n ? `✅ \`${PREFIX()}${n}\` est prête.` : '❌ Nom ou réponse invalide.'));
      }
      if (sub === 'retirer') return i.reply(ephemeral(deleteCommand(i.options.getString('nom')) ? '🗑️ Commande supprimée.' : 'Commande introuvable.'));
      const list = Object.entries(commandsDb());
      return i.reply(ephemeral(list.map(([n, c]) => `\`${PREFIX()}${n}\` — ${c.response.slice(0, 60).replace(/\n/g, ' ')}${c.response.length > 60 ? '…' : ''} (${c.uses ?? 0} utilisations)`).join('\n') || 'Aucune commande. Crée-en avec `/commande ajouter` ou sur le site.'));
    },
  },
];

function register(client, guildId) {
  client.on(Events.MessageCreate, (m) => m.guild?.id === guildId && onMessage(m).catch(() => {}));
}

module.exports = { register, onMessage, handleInteraction, commands, setCommand, deleteCommand, publishMenu, deleteMenu, safeRole, PREFIX, cleanName };
