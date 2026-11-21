/**
 * Logs complets du serveur.
 *  - 📋・logs        : kicks, bans, mutes, rôles, pseudos, salons, rôles créés/supprimés, messages modifiés…
 *  - 🔊・logs-vocal  : arrivées / départs / changements de vocal, déconnexions forcées
 * L'auteur de chaque action vient du journal d'audit Discord.
 */
const { AuditLogEvent: A, EmbedBuilder, Events } = require('discord.js');
const { findChannel } = require('./shared');

const COLORS = { red: 0xe74c3c, orange: 0xe67e22, yellow: 0xf1c40f, green: 0x2ecc71, blue: 0x3498db, grey: 0x95a5a6, purple: 0x9b59b6 };

function send(guild, key, embed) {
  const channel = findChannel(guild, key) ?? findChannel(guild, 'mod_logs');
  return channel?.send({ embeds: [embed.setTimestamp()], allowedMentions: { parse: [] } }).catch(() => {});
}
const log = (guild, color, title, description) => send(guild, 'mod_logs', new EmbedBuilder().setColor(color).setTitle(title).setDescription(description));
const vlog = (guild, color, description) => send(guild, 'voice_logs', new EmbedBuilder().setColor(color).setDescription(description));

const user = (id) => (id ? `<@${id}>` : '_inconnu_');
const reason = (r) => (r ? `\n**Raison :** ${r}` : '');
const roleList = (arr) => (arr ?? []).map((r) => `<@&${r.id}>`).join(' ');

function onAuditEntry(entry, guild) {
  // Les actions du bot lui-même sont déjà loguées par ses commandes
  if (entry.executorId === guild.client.user.id) return;
  const by = `\n**Par :** ${user(entry.executorId)}`;
  const target = user(entry.targetId);

  switch (entry.action) {
    case A.MemberKick:
      return log(guild, COLORS.orange, '👢 Expulsion', `${target}${by}${reason(entry.reason)}`);
    case A.MemberBanAdd:
      return log(guild, COLORS.red, '🔨 Bannissement', `${target}${by}${reason(entry.reason)}`);
    case A.MemberBanRemove:
      return log(guild, COLORS.green, '♻️ Débannissement', `${target}${by}`);

    case A.MemberRoleUpdate: {
      const added = entry.changes.find((c) => c.key === '$add')?.new;
      const removed = entry.changes.find((c) => c.key === '$remove')?.new;
      const lines = [];
      if (added?.length) lines.push(`➕ ${roleList(added)}`);
      if (removed?.length) lines.push(`➖ ${roleList(removed)}`);
      return log(guild, COLORS.purple, '🎭 Rôles modifiés', `${target}\n${lines.join('\n')}${by}`);
    }

    case A.MemberUpdate: {
      const lines = [];
      for (const c of entry.changes) {
        if (c.key === 'nick') lines.push(`📝 Pseudo : **${c.old ?? '—'}** → **${c.new ?? '—'}**`);
        if (c.key === 'communication_disabled_until') {
          lines.push(c.new ? `🔇 Muet jusqu'à <t:${Math.floor(new Date(c.new).getTime() / 1000)}:f>` : '🔊 Mute retiré');
        }
        if (c.key === 'mute') lines.push(c.new ? '🎙️ Rendu muet en vocal (serveur)' : '🎙️ Mute vocal retiré');
        if (c.key === 'deaf') lines.push(c.new ? '🔇 Rendu sourd en vocal (serveur)' : '🔈 Sourdine retirée');
      }
      if (!lines.length) return;
      return log(guild, COLORS.yellow, '👤 Membre modifié', `${target}\n${lines.join('\n')}${by}${reason(entry.reason)}`);
    }

    case A.MemberDisconnect:
      return vlog(guild, COLORS.red, `⛔ ${user(entry.executorId)} a **déconnecté** ${entry.extra?.count ?? 1} membre(s) d'un vocal`);
    case A.MemberMove:
      return vlog(guild, COLORS.orange, `↪️ ${user(entry.executorId)} a **déplacé** ${entry.extra?.count ?? 1} membre(s) vers <#${entry.extra?.channel?.id}>`);

    case A.ChannelCreate:
      return log(guild, COLORS.green, '📁 Salon créé', `<#${entry.targetId}> (${entry.changes.find((c) => c.key === 'name')?.new ?? ''})${by}`);
    case A.ChannelDelete:
      return log(guild, COLORS.red, '🗑️ Salon supprimé', `**${entry.changes.find((c) => c.key === 'name')?.old ?? entry.targetId}**${by}`);
    case A.RoleCreate:
      return log(guild, COLORS.green, '🎭 Rôle créé', `<@&${entry.targetId}>${by}`);
    case A.RoleDelete:
      return log(guild, COLORS.red, '🗑️ Rôle supprimé', `**${entry.changes.find((c) => c.key === 'name')?.old ?? entry.targetId}**${by}`);
    case A.RoleUpdate:
      return log(guild, COLORS.purple, '🎭 Rôle modifié', `<@&${entry.targetId}> (${entry.changes.map((c) => c.key).join(', ')})${by}`);
    case A.MessageBulkDelete:
      return log(guild, COLORS.orange, '🧹 Suppression de masse', `${entry.extra?.count ?? '?'} messages dans <#${entry.targetId}>${by}`);
    case A.BotAdd:
      return log(guild, COLORS.red, '🤖 Bot ajouté', `${target}${by}`);
    case A.WebhookCreate:
      return log(guild, COLORS.orange, '🪝 Webhook créé', `${entry.changes.find((c) => c.key === 'name')?.new ?? ''}${by}`);
    default:
  }
}

function onVoiceState(oldState, newState) {
  const member = newState.member ?? oldState.member;
  if (!member || member.user.bot) return;
  const g = newState.guild;
  if (!oldState.channelId && newState.channelId) return vlog(g, COLORS.green, `🔊 ${member} a rejoint <#${newState.channelId}>`);
  if (oldState.channelId && !newState.channelId) return vlog(g, COLORS.grey, `🔇 ${member} a quitté <#${oldState.channelId}>`);
  if (oldState.channelId !== newState.channelId) return vlog(g, COLORS.blue, `🔀 ${member} : <#${oldState.channelId}> → <#${newState.channelId}>`);
}

function onMessageUpdate(oldMsg, newMsg) {
  if (!newMsg.guild || newMsg.author?.bot || oldMsg.partial || oldMsg.content === newMsg.content) return;
  const logs = findChannel(newMsg.guild, 'mod_logs');
  if (!logs || newMsg.channelId === logs.id) return;
  return log(
    newMsg.guild,
    COLORS.blue,
    '✏️ Message modifié',
    `**Auteur :** ${newMsg.author}\n**Salon :** ${newMsg.channel} · [voir](${newMsg.url})\n\n**Avant :** ${(oldMsg.content || '_vide_').slice(0, 1500)}\n**Après :** ${(newMsg.content || '_vide_').slice(0, 1500)}`,
  );
}

function register(client, guildId) {
  const mine = (g) => g?.id === guildId;
  client.on(Events.GuildAuditLogEntryCreate, (entry, guild) => mine(guild) && onAuditEntry(entry, guild));
  client.on(Events.VoiceStateUpdate, (o, n) => mine(n.guild) && onVoiceState(o, n));
  client.on(Events.MessageUpdate, (o, n) => mine(n.guild) && onMessageUpdate(o, n));
}

module.exports = { register };
