/**
 * Quarantaine : à la place d'une expulsion, le membre perd temporairement ses rôles et ne voit plus que 🏚️┃cachot,
 * où le staff peut lui parler. Ses rôles sont mémorisés et rendus à la libération (manuelle ou automatique).
 * Utilisée par /quarantaine, l'anti-raid (au lieu d'expulser) et l'anti-nuke. Survit aux redémarrages et aux départs/retours.
 */
const { EmbedBuilder, MessageFlags, PermissionFlagsBits: P, SlashCommandBuilder } = require('discord.js');
const { findChannel, findRole } = require('./shared');
const { db, save } = require('./store');

const state = () => (db.quarantine ??= {});
const isQuarantined = (userId) => !!state()[userId];
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });

async function log(guild, color, title, text) {
  await findChannel(guild, 'mod_logs')
    ?.send({ embeds: [new EmbedBuilder().setColor(color).setTitle(title).setDescription(text).setTimestamp()], allowedMentions: { parse: [] } })
    .catch(() => {});
}

/**
 * Met un membre en quarantaine.
 * @param {GuildMember} member
 * @param {{ ms?: number|null, reason?: string, by?: string|null }} opts  ms = durée (null = jusqu'à libération)
 */
async function quarantine(member, { ms = null, reason = 'Aucune raison', by = null } = {}) {
  const guild = member.guild;
  const role = findRole(guild, 'quarantine');
  if (!role?.editable) throw new Error('Rôle ⛓️ Quarantaine absent ou au-dessus du bot (lance /setup)');
  const existing = state()[member.id];
  // Rôles retirés (seulement ceux que le bot peut gérer ; les rôles d'intégration restent)
  const removable = member.roles.cache.filter((r) => r.id !== guild.id && r.id !== role.id && r.editable && !r.managed);
  const kept = member.roles.cache.filter((r) => r.id !== guild.id && (!r.editable || r.managed)).map((r) => r.id);
  state()[member.id] = {
    roles: [...new Set([...(existing?.roles ?? []), ...removable.map((r) => r.id)])],
    until: ms ? Date.now() + ms : null,
    reason: String(reason).slice(0, 300),
    by,
    at: existing?.at ?? Date.now(),
  };
  save();
  require('./feed').push('⛓️', `${member.displayName} mis en quarantaine`);
  require('./feed').member(member.id, '⛓️', `Quarantaine : ${String(reason).slice(0, 100)}`);
  await member.roles.set([...kept, role.id], `Quarantaine : ${reason}`);
  await member.voice?.disconnect('Quarantaine').catch(() => {});
  const until = state()[member.id].until;
  const jail = findChannel(guild, 'jail');
  await jail
    ?.send({
      content: `${member}`,
      allowedMentions: { users: [member.id] },
      embeds: [
        new EmbedBuilder()
          .setColor(0x3b3b3b)
          .setTitle('⛓️ Tu es en quarantaine')
          .setDescription(`**Raison :** ${reason}\n${until ? `**Fin automatique :** <t:${Math.floor(until / 1000)}:R>` : '**Durée :** jusqu\'à ce qu\'un membre du staff te libère'}\n\nTu peux écrire ici : un membre du staff va te répondre. Tes rôles te seront rendus à la sortie.`),
      ],
    })
    .catch(() => {});
  await log(guild, 0x3b3b3b, '⛓️ Quarantaine', `${member} (${member.user.tag})\n**Raison :** ${reason}\n**Par :** ${by ? `<@${by}>` : 'protection automatique'}\n**Fin :** ${until ? `<t:${Math.floor(until / 1000)}:R>` : 'manuelle'}`);
}

/** Libère un membre : rend ses rôles mémorisés et retire la quarantaine. */
async function release(guild, userId, { by = null, reason = '' } = {}) {
  const q = state()[userId];
  if (!q) return false;
  delete state()[userId];
  save();
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return true; // parti entre-temps : on oublie
  const role = findRole(guild, 'quarantine');
  const back = q.roles.filter((id) => guild.roles.cache.get(id)?.editable);
  const keep = member.roles.cache.filter((r) => r.id !== guild.id && r.id !== role?.id).map((r) => r.id);
  await member.roles.set([...new Set([...keep, ...back])], `Fin de quarantaine${reason ? ` : ${reason}` : ''}`).catch(() => {});
  await log(guild, 0x2ecc71, '🔓 Fin de quarantaine', `${member}${by ? ` — libéré par <@${by}>` : ' — fin automatique'}${reason ? `\n${reason}` : ''}`);
  return true;
}

/** Libérations automatiques (vérifiées chaque minute). */
async function sweep(guild) {
  const now = Date.now();
  for (const [id, q] of Object.entries(state())) if (q.until && q.until <= now) await release(guild, id, { reason: 'durée écoulée' });
}

/** Revenir sur le serveur ne fait pas sortir de quarantaine. */
async function onJoin(member) {
  if (!isQuarantined(member.id)) return false;
  const role = findRole(member.guild, 'quarantine');
  if (role?.editable) await member.roles.add(role, 'Quarantaine toujours en cours').catch(() => {});
  return true;
}

function start(guild) {
  setInterval(() => sweep(guild).catch((e) => console.error('Quarantaine :', e.message)), 60_000);
}

function hierarchyError(i, target) {
  if (!target) return '❌ Membre introuvable sur le serveur.';
  if (target.id === i.user.id) return '❌ Tu ne peux pas faire ça sur toi-même.';
  if (target.id === i.guild.ownerId || target.user.bot) return '❌ Impossible sur ce membre.';
  if (i.user.id !== i.guild.ownerId && target.roles.highest.position >= i.member.roles.highest.position) return '❌ Ce membre a un grade égal ou supérieur au tien.';
  return null;
}

const commands = [
  {
    category: '🛡️ Modération',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('quarantaine')
      .setDescription('Isoler un membre dans 🏚️┃cachot (ses rôles lui seront rendus)')
      .setDefaultMemberPermissions(P.KickMembers)
      .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
      .addStringOption((o) => o.setName('raison').setDescription('La raison').setMaxLength(300))
      .addStringOption((o) => o.setName('duree').setDescription('Ex : 30m, 2h, 1j (vide = jusqu\'à /liberer)')),
    async run(i) {
      const member = i.options.getMember('membre');
      const denied = hierarchyError(i, member);
      if (denied) return i.reply(ephemeral(denied));
      const text = i.options.getString('duree');
      const ms = text ? require('./giveaway').parseDuration(text) : null;
      if (text && (!ms || ms < 60_000 || ms > 30 * 86_400_000)) return i.reply(ephemeral('Durée entre 1 minute et 30 jours, ex : `2h`, `1j`.'));
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      await quarantine(member, { ms, reason: i.options.getString('raison') ?? 'Décision du staff', by: i.user.id });
      return i.editReply(`⛓️ ${member} est en quarantaine${ms ? ` pour ${text}` : ''}. Parle-lui dans ${findChannel(i.guild, 'jail') ?? '🏚️┃cachot'}.`);
    },
  },
  {
    category: '🛡️ Modération',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('liberer')
      .setDescription('Sortir un membre de quarantaine (rend ses rôles)')
      .setDefaultMemberPermissions(P.KickMembers)
      .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true)),
    async run(i) {
      const user = i.options.getUser('membre');
      if (!isQuarantined(user.id)) return i.reply(ephemeral('Ce membre n\'est pas en quarantaine.'));
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      await release(i.guild, user.id, { by: i.user.id });
      return i.editReply(`🔓 ${user} est libéré, ses rôles lui ont été rendus.`);
    },
  },
];

module.exports = { quarantine, release, isQuarantined, onJoin, start, commands, state };
