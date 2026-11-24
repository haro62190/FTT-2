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

const NUKE = { windowSec: 60, channelDelete: 3, roleDelete: 3, ban: 4, kick: 5, channelCreate: 8, webhookCreate: 3, privilege: 2 };
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
  const pings = [findRole(guild, 'streamer'), ...require('./shared').staffRoles(guild, 'mod')].filter(Boolean);
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
const { db, save } = require('./store');

async function startLockdown(guild, why, minutes = S.lockdownMinutes) {
  clearTimeout(lockdown.timer);
  const wasActive = lockdown.active;
  lockdown.active = true;
  lockdown.until = Date.now() + minutes * 60_000;
  lockdown.timer = setTimeout(() => endLockdown(guild, 'fin du délai'), minutes * 60_000);
  db.lockdown = { until: lockdown.until }; // survit à un redémarrage du bot
  save();
  await guild.disableInvites(true).catch(() => {});
  if (!wasActive) {
    lockdown.kicked = 0;
    await alert(
      guild,
      'Serveur verrouillé',
      `**Raison :** ${why}\n\n• Invitations mises en pause\n• Les nouveaux arrivants sont ${S.raidAction === 'kick' ? 'expulsés' : 'mis en quarantaine (vérifie-les dans 🏚️┃cachot, `/liberer` pour les laisser entrer)'}\n• Fin automatique <t:${Math.floor(lockdown.until / 1000)}:R> — ou \`/lockdown action:Désactiver\``,
    );
  }
}

async function endLockdown(guild, why, force = false) {
  if (!lockdown.active && !force) return;
  clearTimeout(lockdown.timer);
  lockdown.active = false;
  delete db.lockdown;
  save();
  await guild.disableInvites(false).catch(() => {});
  const channel = findChannel(guild, 'security_alerts') ?? findChannel(guild, 'mod_logs');
  await channel
    ?.send(`✅ Verrouillage levé (${why}). ${lockdown.kicked} compte(s) ${S.raidAction === 'kick' ? 'expulsé(s)' : 'mis en quarantaine'} pendant le verrouillage.`)
    .catch(() => {});
}

// ───────────────────────── Anti-raid ─────────────────────────

const recentJoins = [];
const DAY = 86_400_000;

/**
 * Sanction anti-raid. Par défaut : QUARANTAINE (réversible, aucun vrai membre perdu par erreur).
 * Réglage security.raidAction = 'kick' pour expulser à la place.
 */
async function raidAction(member, reason, hours = S.raidQuarantineHours) {
  if (S.raidAction === 'kick') {
    await member.send(`🔒 **${member.guild.name}** est temporairement protégé contre un raid. Réessaie un peu plus tard !`).catch(() => {});
    return member.kick(`Anti-raid : ${reason}`).catch(() => {});
  }
  return require('./quarantine').quarantine(member, { ms: hours ? hours * 3_600_000 : null, reason: `Anti-raid : ${reason}` }).catch((e) => console.error('Anti-raid :', e.message));
}

/** Compte « suspect » : récent ou sans photo de profil. Les comptes anciens ne sont jamais visés par une vague. */
const suspicious = (m) => Date.now() - m.user.createdTimestamp < (S.youngAccountDays ?? 7) * DAY || !m.user.avatar;

async function onMemberJoin(member) {
  const now = Date.now();
  if (member.user.bot) return; // les bots ajoutés sont surveillés par l'anti-nuke (BotAdd)
  if (await require('./quarantine').onJoin(member)) return; // revenu pendant une quarantaine
  if (S.antiRaid === false) return;

  if (lockdown.active) {
    lockdown.kicked++;
    return raidAction(member, 'serveur verrouillé');
  }

  const ageDays = (now - member.user.createdTimestamp) / DAY;
  if (S.minAccountAgeDays > 0 && ageDays < S.minAccountAgeDays) {
    // Quarantaine jusqu'à ce que le compte ait l'âge minimum (puis libération automatique)
    const hours = Math.ceil((S.minAccountAgeDays - ageDays) * 24);
    return raidAction(member, `compte créé il y a ${ageDays.toFixed(1)} jour(s)`, hours);
  }

  recentJoins.push({ id: member.id, at: now, young: suspicious(member) });
  while (recentJoins.length && now - recentJoins[0].at > S.raidWindowSec * 1000) recentJoins.shift();
  const young = recentJoins.filter((j) => j.young).length;
  // Raid : beaucoup d'arrivées, OU plusieurs comptes suspects d'un coup (seuil plus bas)
  if (recentJoins.length >= S.raidJoins || young >= (S.youngRaidJoins ?? 5)) {
    const wave = [...recentJoins];
    recentJoins.length = 0;
    await startLockdown(member.guild, `${wave.length} arrivées en ${S.raidWindowSec} s dont ${young} compte(s) suspect(s)`);
    // Dans la vague, seuls les comptes suspects sans rôle sont isolés (évite les faux positifs)
    for (const { id, young: isYoung } of wave) {
      const m = member.guild.members.cache.get(id);
      if (m && isYoung && m.roles.cache.size <= 1 && !isStaff(m)) {
        lockdown.kicked++;
        await raidAction(m, 'vague d\'arrivées');
      }
    }
  }
}

// ───────────────────────── Anti-spam ─────────────────────────

const msgHistory = new Map(); // userId -> [{at, id, channelId, content}]
const strikes = new Map(); // userId -> [timestamps] : 1re infraction = avertissement, ensuite mute

// Invitations vers NOTRE serveur : autorisées (rafraîchies toutes les 30 min)
const ownInvites = { codes: new Set(), at: 0 };
async function refreshOwnInvites(guild) {
  if (Date.now() - ownInvites.at < 30 * 60_000) return;
  ownInvites.at = Date.now();
  const codes = new Set();
  const invites = await guild.invites.fetch().catch(() => null);
  invites?.forEach((inv) => codes.add(inv.code.toLowerCase()));
  if (guild.vanityURLCode) codes.add(guild.vanityURLCode.toLowerCase());
  ownInvites.codes = codes;
}

async function onMessage(message) {
  if (!message.guild || message.author.bot || !message.member || isStaff(message.member)) return;
  if (S.antiSpam === false) return;
  const member = message.member;
  const now = Date.now();

  // Invitations Discord (sauf vers ce serveur)
  const invites = [...message.content.matchAll(/(?:discord\.gg|discord(?:app)?\.com\/invite)\/([\w-]+)/gi)].map((m) => m[1].toLowerCase());
  if (S.blockInvites && invites.length) {
    await refreshOwnInvites(message.guild);
    if (invites.some((c) => !ownInvites.codes.has(c))) {
      await message.delete().catch(() => {});
      return punishSpam(member, message.channel, 'invitation vers un autre serveur');
    }
  }

  // Mentions de masse (les réponses n'en comptent pas)
  const mentions = message.mentions.users.filter((u) => u.id !== message.mentions.repliedUser?.id).size + message.mentions.roles.size + (message.mentions.everyone ? 10 : 0);
  if (mentions >= S.maxMentions) {
    await message.delete().catch(() => {});
    return punishSpam(member, message.channel, `mentions de masse (${mentions})`);
  }

  // Flood : trop de messages, ou le même message répété
  const list = (msgHistory.get(member.id) ?? []).filter((m) => now - m.at < S.spamWindowSec * 1000);
  list.push({ at: now, id: message.id, channelId: message.channelId, content: message.content.trim().toLowerCase() });
  msgHistory.set(member.id, list);
  const repeats = message.content.trim().length >= 4 ? list.filter((m) => m.content === list.at(-1).content).length : 0;
  if (list.length >= S.spamMessages || repeats >= 4) {
    msgHistory.delete(member.id);
    const byChannel = new Map();
    for (const m of list) byChannel.set(m.channelId, [...(byChannel.get(m.channelId) ?? []), m.id]);
    for (const [channelId, ids] of byChannel) {
      await message.guild.channels.cache.get(channelId)?.bulkDelete(ids, true).catch(() => {});
    }
    await punishSpam(member, message.channel, repeats >= 4 ? 'même message répété' : `flood (${list.length} messages en ${S.spamWindowSec}s)`);
  }
}

/** 1re infraction (sur 15 min) : avertissement. Ensuite : mute. Évite de punir une simple maladresse. */
async function punishSpam(member, channel, why) {
  const now = Date.now();
  const recent = (strikes.get(member.id) ?? []).filter((t) => now - t < 15 * 60_000);
  recent.push(now);
  strikes.set(member.id, recent);
  const logs = findChannel(member.guild, 'mod_logs');
  if (recent.length === 1) {
    const warn = await channel.send({ content: `⚠️ ${member}, attention : ${why}. La prochaine fois, ce sera un mute.`, allowedMentions: { users: [member.id] } }).catch(() => null);
    setTimeout(() => warn?.delete().catch(() => {}), 15_000);
    await logs?.send({ embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle('🤖 Anti-spam : avertissement').setDescription(`${member} — ${why} dans ${channel}`).setTimestamp()] }).catch(() => {});
    return;
  }
  if (!member.moderatable) return;
  const minutes = S.spamMuteMinutes * Math.min(recent.length - 1, 3); // de plus en plus long en cas de récidive
  await member.timeout(minutes * 60_000, `Anti-spam : ${why}`).catch(() => {});
  const warn = await channel.send({ content: `🔇 ${member} a été rendu muet ${minutes} min (anti-spam : ${why}).`, allowedMentions: { parse: [] } }).catch(() => null);
  setTimeout(() => warn?.delete().catch(() => {}), 15_000);
  await logs?.send({ embeds: [new EmbedBuilder().setColor(0xe67e22).setTitle('🤖 Anti-spam : mute').setDescription(`${member} muet ${minutes} min — ${why} dans ${channel} (${recent.length}e infraction en 15 min)`).setTimestamp()] }).catch(() => {});
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
  privilege: 'escalades de privilèges',
};

/** Salons « jetables » gérés par le bot : vocaux temporaires et tickets */
const ignoredChannels = new Set();
const isDisposable = (id) => require('./tempvoice').isTempChannel(id) || require('./tickets').isTicketChannel(id);

function snapshotChannel(channel) {
  if (isDisposable(channel.id)) {
    ignoredChannels.add(channel.id);
    setTimeout(() => ignoredChannels.delete(channel.id), 10 * 60_000);
    return;
  }
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

// Permissions qu'aucun membre non autorisé ne doit pouvoir s'attribuer / donner
const DANGEROUS = [P.Administrator, P.ManageGuild, P.ManageRoles, P.ManageChannels, P.BanMembers, P.KickMembers, P.ManageWebhooks];
const isDangerous = (bits) => DANGEROUS.some((p) => (BigInt(bits ?? 0) & p) === p);
const trusted = (guild, id) => !id || id === guild.client.user.id || id === guild.ownerId || WHITELIST.has(id);

/** Escalade de privilèges : rôle dangereux donné, ou permissions dangereuses ajoutées à un rôle. Annulée tout de suite. */
async function onPrivilegeChange(entry, guild) {
  if (S.antiNuke === false || trusted(guild, entry.executorId)) return;
  if (entry.action === A.MemberRoleUpdate) {
    const added = entry.changes.find((c) => c.key === '$add')?.new ?? [];
    const target = await guild.members.fetch(entry.targetId).catch(() => null);
    for (const r of added) {
      const role = guild.roles.cache.get(r.id);
      if (!role || !isDangerous(role.permissions.bitfield) || !target) continue;
      await target.roles.remove(role, 'Anti-nuke : rôle dangereux donné par un membre non autorisé').catch(() => {});
      await alert(guild, 'Rôle dangereux retiré', `<@${entry.executorId}> a donné **${role.name}** à ${target}. Rôle retiré automatiquement.\nSi c'était voulu : ajoute la personne à la liste de confiance (\`/moderation confiance\`).`);
      await countNuke(guild, entry.executorId, 'privilege', entry.targetId);
    }
  }
  if (entry.action === A.RoleUpdate) {
    const change = entry.changes.find((c) => c.key === 'permissions');
    if (!change) return;
    const before = BigInt(change.old ?? 0);
    const after = BigInt(change.new ?? 0);
    const gained = after & ~before;
    if (!isDangerous(gained)) return;
    const role = guild.roles.cache.get(entry.targetId);
    if (role?.editable) await role.setPermissions(before, 'Anti-nuke : permissions dangereuses annulées').catch(() => {});
    await alert(guild, 'Permissions dangereuses annulées', `<@${entry.executorId}> a donné des droits d'administration au rôle **${role?.name ?? entry.targetId}**. Modification annulée.`);
    await countNuke(guild, entry.executorId, 'privilege', entry.targetId);
  }
}

async function countNuke(guild, id, type, targetId) {
  const key = `${id}:${type}`;
  const now = Date.now();
  const list = (actions.get(key) ?? []).filter((t) => now - t.at < S.nuke.windowSec * 1000);
  list.push({ at: now, targetId });
  actions.set(key, list);
  if (list.length >= (S.nuke[type] ?? 2) && !punished.has(id)) {
    punished.add(id);
    setTimeout(() => punished.delete(id), 5 * 60_000);
    await neutralize(guild, id, `${list.length} ${LABELS[type] ?? type} en moins de ${S.nuke.windowSec}s`, list);
  }
}

async function onAuditEntry(entry, guild) {
  const type = NUKE_TYPES[entry.action];
  if (entry.action === A.MemberRoleUpdate || entry.action === A.RoleUpdate) return onPrivilegeChange(entry, guild);
  if (entry.action === A.BotAdd) {
    if (trusted(guild, entry.executorId)) return;
    // Bot ajouté par quelqu'un de non autorisé : expulsé par défaut (security.blockUnknownBots)
    const bot = await guild.members.fetch(entry.targetId).catch(() => null);
    const kicked = S.blockUnknownBots !== false && bot ? await bot.kick('Anti-nuke : bot ajouté par un membre non autorisé').then(() => true).catch(() => false) : false;
    await alert(guild, 'Bot inconnu ajouté', `<@${entry.targetId}> ajouté par <@${entry.executorId}>.${kicked ? ' **Expulsé automatiquement.** Seuls le propriétaire et la liste de confiance peuvent ajouter des bots.' : ' Vérifie qu\'il est de confiance !'}`);
    return;
  }
  if (!type || !S.antiNuke) return;
  // Supprimer un vocal temporaire ou un ticket n'est pas une attaque
  if (entry.action === A.ChannelDelete && (ignoredChannels.has(entry.targetId) || isDisposable(entry.targetId))) return;
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
      // Quarantaine plutôt que retrait définitif : en cas de fausse alerte, /liberer rend tout
      const left = member.roles.cache.filter((r) => r.id !== guild.id && !r.editable && !r.managed);
      const ok = await require('./quarantine')
        .quarantine(member, { reason: `Anti-nuke : ${why}` })
        .then(() => true)
        .catch(() => false);
      action = ok ? 'mis en quarantaine (rôles mémorisés — `/liberer` pour annuler)' : '⚠️ impossible de le mettre en quarantaine';
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
      .setDefaultMemberPermissions(P.BanMembers)
      .addStringOption((o) =>
        o.setName('action').setDescription('Activer ou désactiver').setRequired(true).addChoices({ name: 'Activer', value: 'on' }, { name: 'Désactiver', value: 'off' }),
      )
      .addIntegerOption((o) => o.setName('minutes').setDescription('Durée (10 par défaut)').setMinValue(1).setMaxValue(1440)),
    async run(i) {
      if (i.options.getString('action') === 'on') {
        await startLockdown(i.guild, `activé manuellement par ${i.user.tag}`, i.options.getInteger('minutes') ?? S.lockdownMinutes);
        return i.reply({ content: '🔒 Serveur verrouillé.', flags: MessageFlags.Ephemeral });
      }
      // Toujours réactiver les invitations, même si le bot a redémarré entre-temps
      await endLockdown(i.guild, `désactivé par ${i.user.tag}`, true);
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

/** Au démarrage : reprendre un verrouillage en cours, ou rouvrir les invitations s'il a expiré pendant l'arrêt. */
async function resumeLockdown(guild) {
  const saved = db.lockdown;
  if (!saved) return;
  const left = saved.until - Date.now();
  if (left > 0) {
    lockdown.active = true;
    lockdown.until = saved.until;
    lockdown.timer = setTimeout(() => endLockdown(guild, 'fin du délai'), left);
    console.log(`🔒 Verrouillage repris jusqu'à ${new Date(saved.until).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris' })}`);
  } else {
    await endLockdown(guild, 'expiré pendant le redémarrage du bot', true);
  }
}

module.exports = { register, commands, lockdown, resumeLockdown, startLockdown, endLockdown };
