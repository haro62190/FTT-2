/**
 * Sécurité du serveur :
 *  - Anti-raid  : trop d'arrivées d'un coup -> verrouillage (invitations en pause + nouveaux arrivants expulsés)
 *  - Anti-spam  : flood, mentions de masse, invitations Discord -> messages supprimés + mute
 *  - Anti-nuke  : quelqu'un supprime / bannit en masse -> ses rôles sont retirés, les salons et rôles supprimés
 *                 sont recréés, le staff est alerté
 *  - /lockdown  : verrouillage manuel
 */
const {
  AuditLogEvent: A,
  ChannelType,
  EmbedBuilder,
  Events,
  MessageFlags,
  OverwriteType,
  PermissionFlagsBits: P,
  SlashCommandBuilder,
} = require('discord.js');
const { findChannel, findRole } = require('./shared');

const settings = require('./settings');

const NUKE = { windowSec: 60, channelDelete: 3, roleDelete: 3, ban: 4, kick: 5, channelCreate: 8, webhookCreate: 3 };
/** Réglages lus à chaque utilisation : modifiables à chaud avec /moderation ou le tableau de bord */
const S = new Proxy({}, { get: (_, key) => (key === 'nuke' ? { ...NUKE, ...settings.get('security.nuke') } : settings.get(`security.${String(key)}`)) });
const WHITELIST = {
  has: (id) =>
    (S.whitelist ?? []).includes(id) ||
    (process.env.SECURITY_WHITELIST ?? '').split(',').map((s) => s.trim()).includes(id),
};

// ───────────────────────── Alertes ─────────────────────────

function alert(guild, title, description) {
  const channel = findChannel(guild, 'security_alerts') ?? findChannel(guild, 'mod_chat') ?? findChannel(guild, 'mod_logs');
  const pings = ['streamer', 'mod'].map((k) => findRole(guild, k)).filter(Boolean);
  return channel
    ?.send({
      content: pings.join(' ') || undefined,
      embeds: [new EmbedBuilder().setColor(0xff0000).setTitle(`🚨 ${title}`).setDescription(description).setTimestamp()],
      allowedMentions: { roles: pings.map((r) => r.id) },
    })
    .catch(() => {});
}

const isStaff = (member) =>
  member && (member.permissions.has(P.ManageMessages) || member.id === member.guild.ownerId || WHITELIST.has(member.id));

// ───────────────────────── Verrouillage ─────────────────────────

const lockdown = { active: false, until: 0, timer: null, kicked: 0 };

async function startLockdown(guild, why, minutes = S.lockdownMinutes) {
  clearTimeout(lockdown.timer);
  const wasActive = lockdown.active;
  lockdown.active = true;
  lockdown.until = Date.now() + minutes * 60_000;
  lockdown.timer = setTimeout(() => endLockdown(guild, 'fin du délai'), minutes * 60_000);
  await guild.disableInvites(true).catch(() => {});
  if (!wasActive) {
    lockdown.kicked = 0;
    await alert(
      guild,
      'Serveur verrouillé',
      `**Raison :** ${why}\n\n• Invitations mises en pause\n• Les nouveaux arrivants sont expulsés automatiquement\n• Fin automatique <t:${Math.floor(lockdown.until / 1000)}:R> — ou \`/lockdown action:Désactiver\``,
    );
  }
}

async function endLockdown(guild, why) {
  if (!lockdown.active) return;
  clearTimeout(lockdown.timer);
  lockdown.active = false;
  await guild.disableInvites(false).catch(() => {});
  const channel = findChannel(guild, 'security_alerts') ?? findChannel(guild, 'mod_logs');
  await channel
    ?.send(`✅ Verrouillage levé (${why}). ${lockdown.kicked} compte(s) expulsé(s) pendant le verrouillage.`)
    .catch(() => {});
}

// ───────────────────────── Anti-raid ─────────────────────────

const recentJoins = [];

async function onMemberJoin(member) {
  const now = Date.now();
  if (member.user.bot) return; // les bots ajoutés sont surveillés par l'anti-nuke (BotAdd)

  if (lockdown.active) {
    lockdown.kicked++;
    await member.send(`🔒 **${member.guild.name}** est temporairement verrouillé (protection anti-raid). Réessaie dans quelques minutes !`).catch(() => {});
    return member.kick('Anti-raid : serveur verrouillé').catch(() => {});
  }

  const ageDays = (now - member.user.createdTimestamp) / 86_400_000;
  if (S.minAccountAgeDays > 0 && ageDays < S.minAccountAgeDays) {
    await member.send(`⛔ Ton compte Discord est trop récent pour rejoindre **${member.guild.name}**. Reviens dans quelques jours !`).catch(() => {});
    await member.kick(`Anti-raid : compte créé il y a ${ageDays.toFixed(1)} jour(s)`).catch(() => {});
    return;
  }

  recentJoins.push({ id: member.id, at: now });
  while (recentJoins.length && now - recentJoins[0].at > S.raidWindowSec * 1000) recentJoins.shift();
  if (recentJoins.length >= S.raidJoins) {
    const suspects = [...recentJoins];
    recentJoins.length = 0;
    await startLockdown(member.guild, `${suspects.length} arrivées en moins de ${S.raidWindowSec} secondes`);
    // On expulse aussi la vague qui vient d'arriver
    for (const { id } of suspects) {
      const m = member.guild.members.cache.get(id);
      // seulement ceux qui n'ont encore aucun rôle (pas un membre établi)
      if (m && m.roles.cache.size <= 1 && !isStaff(m)) {
        lockdown.kicked++;
        await m.kick('Anti-raid : vague d\'arrivées').catch(() => {});
      }
    }
  }
}

// ───────────────────────── Anti-spam ─────────────────────────

const msgHistory = new Map(); // userId -> [{at, id, channelId}]

async function onMessage(message) {
  if (!message.guild || message.author.bot || !message.member || isStaff(message.member)) return;
  const member = message.member;
  const now = Date.now();

  // Invitations Discord
  if (S.blockInvites && /(discord\.gg|discord(app)?\.com\/invite)\/\w+/i.test(message.content)) {
    await message.delete().catch(() => {});
    const warn = await message.channel.send(`🚫 ${member}, les invitations vers d'autres serveurs sont interdites.`).catch(() => null);
    setTimeout(() => warn?.delete().catch(() => {}), 8000);
    return;
  }

  // Mentions de masse
  const mentions = message.mentions.users.size + message.mentions.roles.size + (message.mentions.everyone ? 10 : 0);
  if (mentions >= S.maxMentions) {
    await message.delete().catch(() => {});
    await punishSpam(member, message.channel, `mentions de masse (${mentions})`);
    return;
  }

  // Flood
  const list = (msgHistory.get(member.id) ?? []).filter((m) => now - m.at < S.spamWindowSec * 1000);
  list.push({ at: now, id: message.id, channelId: message.channelId });
  msgHistory.set(member.id, list);
  if (list.length >= S.spamMessages) {
    msgHistory.delete(member.id);
    const byChannel = new Map();
    for (const m of list) byChannel.set(m.channelId, [...(byChannel.get(m.channelId) ?? []), m.id]);
    for (const [channelId, ids] of byChannel) {
      await message.guild.channels.cache.get(channelId)?.bulkDelete(ids, true).catch(() => {});
    }
    await punishSpam(member, message.channel, `flood (${list.length} messages en ${S.spamWindowSec}s)`);
  }
}

async function punishSpam(member, channel, why) {
  if (!member.moderatable) return;
  await member.timeout(S.spamMuteMinutes * 60_000, `Anti-spam : ${why}`).catch(() => {});
  const warn = await channel.send(`🔇 ${member} a été rendu muet ${S.spamMuteMinutes} min (anti-spam : ${why}).`).catch(() => null);
  setTimeout(() => warn?.delete().catch(() => {}), 15_000);
  const logs = findChannel(member.guild, 'mod_logs');
  await logs
    ?.send({
      embeds: [new EmbedBuilder().setColor(0xe67e22).setTitle('🤖 Anti-spam').setDescription(`${member} muet ${S.spamMuteMinutes} min — ${why} dans ${channel}`).setTimestamp()],
    })
    .catch(() => {});
}

// ───────────────────────── Anti-nuke ─────────────────────────

const actions = new Map(); // `${executorId}:${type}` -> [timestamps]
const deletedChannels = new Map(); // channelId -> snapshot
const deletedRoles = new Map(); // roleId -> snapshot
const punished = new Set();

const NUKE_TYPES = {
  [A.ChannelDelete]: 'channelDelete',
  [A.RoleDelete]: 'roleDelete',
  [A.MemberBanAdd]: 'ban',
  [A.MemberKick]: 'kick',
  [A.ChannelCreate]: 'channelCreate',
  [A.WebhookCreate]: 'webhookCreate',
};
const LABELS = {
  channelDelete: 'salons supprimés',
  roleDelete: 'rôles supprimés',
  ban: 'bannissements',
  kick: 'expulsions',
  channelCreate: 'salons créés',
  webhookCreate: 'webhooks créés',
};

function snapshotChannel(channel) {
  if (!channel.guild) return;
  deletedChannels.set(channel.id, {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    parentId: channel.parentId,
    position: channel.rawPosition,
    topic: channel.topic,
    nsfw: channel.nsfw,
    userLimit: channel.userLimit,
    rateLimitPerUser: channel.rateLimitPerUser,
    overwrites: channel.permissionOverwrites?.cache.map((o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield })) ?? [],
    at: Date.now(),
  });
  setTimeout(() => deletedChannels.delete(channel.id), 10 * 60_000);
}

function snapshotRole(role) {
  deletedRoles.set(role.id, {
    name: role.name,
    color: role.color,
    hoist: role.hoist,
    mentionable: role.mentionable,
    permissions: role.permissions.bitfield,
    position: role.position,
  });
  setTimeout(() => deletedRoles.delete(role.id), 10 * 60_000);
}

async function onAuditEntry(entry, guild) {
  const type = NUKE_TYPES[entry.action];
  if (entry.action === A.BotAdd) {
    // Un bot ajouté par quelqu'un d'autre que le propriétaire : on prévient
    if (entry.executorId !== guild.ownerId && !WHITELIST.has(entry.executorId)) {
      await alert(guild, 'Nouveau bot ajouté', `<@${entry.targetId}> ajouté par <@${entry.executorId}>. Vérifie qu'il est de confiance !`);
    }
    return;
  }
  if (!type || !S.antiNuke) return;
  const id = entry.executorId;
  if (!id || id === guild.client.user.id || id === guild.ownerId || WHITELIST.has(id)) return;

  const key = `${id}:${type}`;
  const now = Date.now();
  const list = (actions.get(key) ?? []).filter((t) => now - t.at < S.nuke.windowSec * 1000);
  list.push({ at: now, targetId: entry.targetId });
  actions.set(key, list);

  if (list.length >= S.nuke[type] && !punished.has(id)) {
    punished.add(id);
    setTimeout(() => punished.delete(id), 5 * 60_000);
    await neutralize(guild, id, `${list.length} ${LABELS[type]} en moins de ${S.nuke.windowSec}s`, list);
  }
}

async function neutralize(guild, executorId, why, list) {
  const member = await guild.members.fetch(executorId).catch(() => null);
  let action = 'aucune (introuvable)';
  if (member) {
    if (member.user.bot) {
      action = (await member.kick('Anti-nuke').then(() => true).catch(() => false)) ? 'bot expulsé' : '⚠️ impossible d\'expulser le bot (rôle trop haut)';
    } else {
      const removable = member.roles.cache.filter((r) => r.id !== guild.id && r.editable);
      const ok = await member.roles.remove(removable, `Anti-nuke : ${why}`).then(() => true).catch(() => false);
      const left = member.roles.cache.filter((r) => r.id !== guild.id && !r.editable);
      action = ok ? `tous ses rôles retirés (${removable.size})` : '⚠️ impossible de retirer ses rôles';
      if (left.size) action += `\n⚠️ Rôles au-dessus du bot non retirés : ${left.map((r) => r.name).join(', ')} — place le rôle du bot tout en haut !`;
    }
  }

  // Restauration des salons / rôles supprimés (petite pause : les derniers événements arrivent)
  await new Promise((r) => setTimeout(r, 3000));
  const restored = [];
  const ids = new Set(list.map((l) => l.targetId));
  for (const t of ['channelDelete', 'roleDelete']) for (const l of actions.get(`${executorId}:${t}`) ?? []) ids.add(l.targetId);
  for (const [roleId, snap] of deletedRoles) {
    if (!ids.has(roleId)) continue;
    const role = await guild.roles.create({ ...snap, reason: 'Anti-nuke : restauration' }).catch(() => null);
    if (role) restored.push(`🎭 ${role.name}`);
    deletedRoles.delete(roleId);
  }
  const snaps = [...deletedChannels.values()]
    .filter((s) => ids.has(s.id))
    .sort((a, b) => (b.type === ChannelType.GuildCategory) - (a.type === ChannelType.GuildCategory) || a.position - b.position);
  const newIds = new Map();
  for (const s of snaps) {
    const overwrites = s.overwrites.filter((o) => o.type === OverwriteType.Member || guild.roles.cache.has(o.id));
    const parent = newIds.get(s.parentId) ?? (guild.channels.cache.has(s.parentId) ? s.parentId : null);
    const ch = await guild.channels
      .create({
        name: s.name,
        type: s.type,
        parent,
        topic: s.topic ?? undefined,
        nsfw: s.nsfw,
        userLimit: s.userLimit || undefined,
        rateLimitPerUser: s.rateLimitPerUser || undefined,
        permissionOverwrites: overwrites,
        reason: 'Anti-nuke : restauration',
      })
      .catch(() => null);
    if (ch) {
      newIds.set(s.id, ch.id);
      restored.push(`📁 ${ch.name}`);
    }
    deletedChannels.delete(s.id);
  }

  await alert(
    guild,
    'Tentative de destruction du serveur bloquée',
    `**Auteur :** <@${executorId}>\n**Détecté :** ${why}\n**Action :** ${action}` +
      (restored.length ? `\n**Restauré :** ${restored.join(', ')}\n_(les messages des salons supprimés sont perdus)_` : '') +
      '\n\n➡️ Vérifie le journal d\'audit et change les mots de passe / tokens si un compte a été piraté.',
  );
  if (!lockdown.active) await startLockdown(guild, `anti-nuke (${why})`);
}

// ───────────────────────── Commande /lockdown ─────────────────────────

const commands = [
  {
    category: '🛡️ Modération',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('lockdown')
      .setDescription('Verrouiller le serveur (raid) : invitations en pause, nouveaux arrivants expulsés')
      .setDefaultMemberPermissions(P.ManageGuild)
      .addStringOption((o) =>
        o.setName('action').setDescription('Activer ou désactiver').setRequired(true).addChoices({ name: 'Activer', value: 'on' }, { name: 'Désactiver', value: 'off' }),
      )
      .addIntegerOption((o) => o.setName('minutes').setDescription('Durée (10 par défaut)').setMinValue(1).setMaxValue(1440)),
    async run(i) {
      if (i.options.getString('action') === 'on') {
        await startLockdown(i.guild, `activé manuellement par ${i.user.tag}`, i.options.getInteger('minutes') ?? S.lockdownMinutes);
        return i.reply({ content: '🔒 Serveur verrouillé.', flags: MessageFlags.Ephemeral });
      }
      if (!lockdown.active) return i.reply({ content: 'Le serveur n\'est pas verrouillé.', flags: MessageFlags.Ephemeral });
      await endLockdown(i.guild, `désactivé par ${i.user.tag}`);
      return i.reply({ content: '🔓 Verrouillage levé.', flags: MessageFlags.Ephemeral });
    },
  },
];

function register(client, guildId) {
  const mine = (g) => g?.id === guildId;
  client.on(Events.GuildMemberAdd, (m) => mine(m.guild) && onMemberJoin(m).catch((e) => console.error('Anti-raid :', e.message)));
  client.on(Events.MessageCreate, (m) => mine(m.guild) && onMessage(m).catch((e) => console.error('Anti-spam :', e.message)));
  client.on(Events.ChannelDelete, (c) => mine(c.guild) && snapshotChannel(c));
  client.on(Events.GuildRoleDelete, (r) => mine(r.guild) && snapshotRole(r));
  client.on(Events.GuildAuditLogEntryCreate, (e, g) => mine(g) && onAuditEntry(e, g).catch((err) => console.error('Anti-nuke :', err.message)));
}

module.exports = { register, commands, lockdown };
