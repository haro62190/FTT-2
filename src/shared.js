const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const config = require('../config/server');

const BRAND_COLOR = 0xe10600; // rouge néon — Les Ronins de haro62190
const ACCEPT_RULES_ID = 'accept_rules';
const ROLE_BUTTON_PREFIX = 'role:';

/** Logo utilisé (icône du serveur + avatar du bot) : celui envoyé avec /logo, sinon assets/icon.png */
function iconPath() {
  const fs = require('fs');
  const path = require('path');
  const custom = path.join(__dirname, '..', 'data', 'custom-icon.img');
  if (fs.existsSync(custom)) return custom;
  const def = path.join(__dirname, '..', config.serverIcon || 'assets/icon.png');
  return fs.existsSync(def) ? def : null;
}

function roleDef(key) {
  return config.roles.find((r) => r.key === key);
}

function channelDef(key) {
  for (const cat of config.categories) {
    const ch = cat.channels.find((c) => c.key === key);
    if (ch) return ch;
  }
  return undefined;
}

function findRole(guild, key) {
  const def = roleDef(key);
  if (!def) return undefined;
  const names = [def.name, ...(def.formerNames ?? [])];
  return guild.roles.cache.find((r) => r.name === def.name) ?? guild.roles.cache.find((r) => names.includes(r.name));
}

function findChannel(guild, key) {
  const def = channelDef(key);
  if (!def) return undefined;
  // Salons compteurs : leur nom change, on les retrouve par leur ID enregistré
  if (def.stat) return guild.channels.cache.get(require('./store').db.statChannels?.[key]);
  const names = [def.name, ...(def.formerNames ?? [])];
  return guild.channels.cache.find((c) => c.name === def.name) ?? guild.channels.cache.find((c) => names.includes(c.name));
}

// ───────── Grades du staff ─────────
const STAFF_LEVELS = { helper: 1, mod: 2, senior: 3 };

/** Rôles du staff d'au moins ce grade (helper < mod < senior), du plus haut au plus bas. */
function staffRoles(guild, min = 'helper') {
  return config.roles
    .filter((d) => d.staff && STAFF_LEVELS[d.staff] >= STAFF_LEVELS[min])
    .map((d) => findRole(guild, d.key))
    .filter(Boolean);
}

/** Ce membre fait-il partie du staff (au moins ce grade) ? Le propriétaire et les admins aussi. */
function isStaffMember(member, min = 'helper') {
  if (!member?.guild) return false;
  if (member.id === member.guild.ownerId || member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  return staffRoles(member.guild, min).some((r) => member.roles.cache.has(r.id));
}

function rulesPayload(guild) {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`⛩️ 掟 ・ Règlement de ${guild.name}`)
    .setDescription(
      config.rules.map((rule, i) => `**${i + 1}.** ${rule}`).join('\n\n') +
        '\n\nEn cliquant sur le bouton ci-dessous, tu acceptes ce règlement et les portes du dojo s\'ouvrent ⛩️',
    )
    .setFooter({ text: 'Le non-respect du règlement peut entraîner un avertissement, un mute ou un ban.' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(ACCEPT_RULES_ID)
      .setLabel('Je prête serment — j\'accepte le règlement')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
  );

  return { embeds: [embed], components: [row] };
}

function rolesPayload() {
  const selfRoles = config.roles.filter((r) => r.selfAssign);
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🎴 役割 ・ Choisis tes rôles')
    .setDescription(
      'Clique sur un bouton pour ajouter le rôle, reclique pour le retirer.\n\n' +
        selfRoles.map((r) => `${r.emoji} **${r.name.replace(/^\S+\s/, '')}** — ${r.description}`).join('\n'),
    );

  // 5 boutons max par ligne
  const rows = [];
  for (let i = 0; i < selfRoles.length; i += 5) {
    rows.push(
      new ActionRowBuilder().addComponents(
        selfRoles.slice(i, i + 5).map((r) =>
          new ButtonBuilder()
            .setCustomId(ROLE_BUTTON_PREFIX + r.key)
            .setLabel(r.name.replace(/^\S+\s/, ''))
            .setEmoji(r.emoji)
            .setStyle(ButtonStyle.Secondary),
        ),
      ),
    );
  }
  return { embeds: [embed], components: rows };
}

module.exports = {
  config,
  staffRoles,
  isStaffMember,
  STAFF_LEVELS,
  iconPath,
  BRAND_COLOR,
  ACCEPT_RULES_ID,
  ROLE_BUTTON_PREFIX,
  roleDef,
  channelDef,
  findRole,
  findChannel,
  rulesPayload,
  rolesPayload,
};
