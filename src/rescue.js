/**
 * 🛟 Serveur de secours : si le serveur principal est piraté, détruit ou corrompu, le bot recopie tout
 * sur un serveur de secours (vide, créé à l'avance) :
 *  - structure : rôles (couleurs, permissions, ordre), catégories, salons, permissions, réglages du serveur
 *  - identité : nom, icône, bannière ; émojis personnalisés
 *  - messages du bot : règlement, rôles, guide, tickets, bienvenue
 *  - archive des derniers messages de chaque salon (50 par salon), republiés avec auteur, avatar et date
 *  - rôles de chaque membre : rendus automatiquement quand il rejoint le serveur de secours
 *    (sauf les rôles Administrateur, à redonner à la main par sécurité)
 * Les niveaux, ryō, quêtes… sont liés aux comptes Discord : ils suivent les membres sans rien faire.
 *
 * La copie est prise chaque jour, stockée sur le VPS (pas sur Discord), et JAMAIS écrasée par un serveur
 * qui vient d'être vidé : si plus de 30 % des salons ou des rôles ont disparu, l'ancienne copie est gardée.
 */
const { ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits: P, SlashCommandBuilder } = require('discord.js');
const { BRAND_COLOR, findChannel } = require('./shared');
const { db, save } = require('./store');
const settings = require('./settings');

const MESSAGES_PER_CHANNEL = 50;
const SKIP_ARCHIVE = new Set(['mod_logs', 'voice_logs', 'db_backups', 'security_alerts', 'guide', 'guide_staff', 'rules', 'roles', 'tickets']);
const MAX_EMOJI_BYTES = 256 * 1024;
let restoring = false;

const rescueGuildId = () => String(settings.get('rescue.guildId') || process.env.SECOURS_GUILD_ID || '').trim() || null;
const state = () => (db.rescue ??= {});

// ───────────────────────── Copie ─────────────────────────

/** Le serveur semble-t-il avoir été vidé (raid / nuke) depuis la dernière copie ? */
function looksNuked(guild, prev) {
  if (!prev?.counts) return false;
  const channels = guild.channels.cache.filter((c) => !c.isThread()).size;
  const roles = guild.roles.cache.size;
  return channels < prev.counts.channels * 0.7 || roles < prev.counts.roles * 0.7;
}

async function archiveMessages(guild) {
  const out = {};
  const skip = new Set([...SKIP_ARCHIVE].map((k) => findChannel(guild, k)?.id).filter(Boolean));
  const textChannels = guild.channels.cache.filter(
    (c) => [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(c.type) && !skip.has(c.id) && !db.tickets?.open?.[c.id] && c.viewable,
  );
  for (const ch of textChannels.values()) {
    const msgs = await ch.messages.fetch({ limit: MESSAGES_PER_CHANNEL }).catch(() => null);
    if (!msgs?.size) continue;
    out[ch.name] = [...msgs.values()]
      .filter((m) => m.author.id !== guild.client.user.id && (m.content || m.attachments.size || m.embeds.length))
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map((m) => ({
        author: m.member?.displayName ?? m.author.username,
        avatar: m.author.displayAvatarURL({ extension: 'png', size: 64 }),
        content: String(m.content ?? '').slice(0, 3500),
        at: m.createdTimestamp,
        files: [...m.attachments.values()].slice(0, 4).map((a) => ({ name: a.name, url: a.url })),
        pinned: m.pinned,
      }));
  }
  return out;
}

async function archiveEmojis(guild, previous = []) {
  const known = new Map(previous.map((e) => [e.id, e]));
  const list = [];
  for (const e of guild.emojis.cache.values()) {
    if (list.length >= 100) break;
    if (known.has(e.id)) {
      list.push(known.get(e.id));
      continue;
    }
    try {
      const res = await fetch(e.imageURL({ size: 128 }), { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_EMOJI_BYTES) continue;
      list.push({ id: e.id, name: e.name, animated: e.animated, data: buf.toString('base64') });
    } catch {
      // émoji indisponible : on passe
    }
  }
  return list;
}

/** Prend la copie de secours complète. Renvoie un résumé, ou { skipped } si le serveur semble vidé. */
async function capture(guild, { force = false } = {}) {
  await guild.channels.fetch();
  await guild.roles.fetch();
  const prev = state();
  if (!force && looksNuked(guild, prev)) {
    const msg = 'Le serveur a perdu plus de 30 % de ses salons ou rôles depuis la dernière copie : copie de secours NON écrasée (possible piratage).';
    console.warn(`🛟 ${msg}`);
    await require('./health').alert('Copie de secours protégée', msg).catch(() => {});
    return { skipped: true, reason: msg };
  }
  const backup = require('./backup');
  const snap = backup.createBackup(guild, `secours-${new Date().toISOString().slice(0, 10)}`, 'secours');
  // Rôles de chaque membre (par nom : les identifiants changent sur le serveur de secours)
  const members = {};
  const all = await guild.members.fetch().catch(() => guild.members.cache);
  for (const m of all.values()) {
    if (m.user.bot) continue;
    const roles = m.roles.cache.filter((r) => r.id !== guild.id && !r.managed).map((r) => r.name);
    members[m.id] = roles;
  }
  const messages = await archiveMessages(guild);
  const emojis = await archiveEmojis(guild, prev.emojis ?? []);
  // On ne garde qu'une copie « secours » dans les sauvegardes (les autres restent dans /backup)
  if (prev.snapshotId && prev.snapshotId !== snap.id) backup.deleteBackup(prev.snapshotId);
  db.rescue = {
    ...prev,
    at: Date.now(),
    snapshotId: snap.id,
    ownerId: guild.ownerId,
    guildName: guild.name,
    counts: { channels: guild.channels.cache.filter((c) => !c.isThread()).size, roles: guild.roles.cache.size, members: Object.keys(members).length },
    members,
    messages,
    emojis,
  };
  save();
  const summary = { roles: snap.roles, channels: snap.channels, members: Object.keys(members).length, emojis: emojis.length, messages: Object.values(messages).reduce((n, l) => n + l.length, 0) };
  console.log(`🛟 Copie de secours : ${summary.roles} rôles, ${summary.channels} salons, ${summary.members} membres, ${summary.emojis} émojis, ${summary.messages} messages`);
  return summary;
}

/** Copie quotidienne automatique (appelée avec les sauvegardes). */
async function daily(guild) {
  if (!settings.on('rescue')) return;
  if (state().at && Date.now() - state().at < 23 * 3600_000) return;
  await capture(guild);
}

// ───────────────────────── Restauration ─────────────────────────

/** Ce qu'il manque au bot sur le serveur de secours pour tout recopier. */
function missingPerms(target) {
  const me = target.members.me;
  if (!me) return ['le bot n\'est pas sur ce serveur'];
  if (me.permissions.has(P.Administrator)) return [];
  const need = [P.ManageRoles, P.ManageChannels, P.ManageGuild, P.ManageGuildExpressions, P.SendMessages, P.EmbedLinks, P.CreateInstantInvite];
  const names = { [P.ManageRoles]: 'Gérer les rôles', [P.ManageChannels]: 'Gérer les salons', [P.ManageGuild]: 'Gérer le serveur', [P.ManageGuildExpressions]: 'Gérer les expressions (émojis)', [P.SendMessages]: 'Envoyer des messages', [P.EmbedLinks]: 'Intégrer des liens', [P.CreateInstantInvite]: 'Créer une invitation' };
  return need.filter((p) => !me.permissions.has(p)).map((p) => names[p]);
}

const archiveEmbed = (m) => {
  const e = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setAuthor({ name: m.author.slice(0, 256), iconURL: /^https:\/\//.test(m.avatar) ? m.avatar : undefined })
    .setTimestamp(m.at);
  if (m.content) e.setDescription(m.content.slice(0, 4000));
  if (m.files?.length) e.addFields({ name: '📎 Pièces jointes (lien d\'origine, peut avoir expiré)', value: m.files.map((f) => `[${f.name}](${f.url})`).join('\n').slice(0, 1024) });
  if (!m.content && !m.files?.length) e.setDescription('_(contenu intégré non copié)_');
  return e;
};

/**
 * Recopie tout sur le serveur de secours. `log` reçoit la progression.
 * Options : messages (archive des messages), emojis.
 */
async function restoreTo(target, { messages = true, emojis = true, log = console.log } = {}) {
  if (restoring) throw new Error('Une restauration est déjà en cours.');
  const s = state();
  if (!s.snapshotId) throw new Error('Aucune copie de secours : lance d\'abord « Faire une copie maintenant ».');
  const backup = require('./backup');
  const snap = backup.getBackup(s.snapshotId);
  if (!snap) throw new Error('Copie de secours introuvable dans la base.');
  if (target.id === process.env.GUILD_ID) throw new Error('Le serveur de secours ne peut pas être le serveur principal.');
  const missing = missingPerms(target);
  if (missing.length) throw new Error(`Permissions manquantes au bot sur le serveur de secours : ${missing.join(', ')}`);
  restoring = true;
  try {
    log(`🛟 Restauration de « ${s.guildName} » (copie du ${new Date(s.at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })})`);
    await backup.restore(target, snap.data, log);
    // Discord place chaque nouveau rôle tout en bas : on remet l'ordre d'origine (sous le rôle du bot)
    await target.roles.fetch();
    const ordered = [...snap.data.roles]
      .sort((a, b) => a.position - b.position)
      .map((r) => target.roles.cache.find((x) => x.name === r.name && x.editable && !x.managed))
      .filter((r, k, arr) => r && arr.indexOf(r) === k);
    if (ordered.length) await target.roles.setPositions(ordered.map((role, k) => ({ role, position: k + 1 }))).catch((e) => log(`  ⚠ Ordre des rôles : ${e.message}`));
    const builder = require('./builder');
    await target.channels.fetch();
    await builder.configureGuild(target, log).catch((e) => log(`  ⚠ Paramètres : ${e.message}`));
    await target.edit({ name: s.guildName }).catch(() => {});
    if (emojis && s.emojis?.length) {
      log('😀 Émojis');
      await target.emojis.fetch();
      for (const e of s.emojis) {
        if (target.emojis.cache.some((x) => x.name === e.name)) continue;
        await target.emojis
          .create({ attachment: Buffer.from(e.data, 'base64'), name: e.name, reason: 'Serveur de secours' })
          .then(() => log(`  ＋ :${e.name}:`))
          .catch((err) => log(`  ⚠ :${e.name}: ${err.message}`));
      }
    }
    await builder.postMessages(target, log).catch((e) => log(`  ⚠ Messages du bot : ${e.message}`));
    if (messages && s.messages) {
      log('📜 Archive des messages');
      for (const [name, list] of Object.entries(s.messages)) {
        const ch = target.channels.cache.find((c) => c.name === name && c.isTextBased?.() && !c.isVoiceBased?.());
        if (!ch || !list.length) continue;
        await ch.send({ content: `📜 **Archive** : les ${list.length} derniers messages de ce salon, recopiés depuis le serveur d'origine.`, allowedMentions: { parse: [] } }).catch(() => {});
        for (let k = 0; k < list.length; k += 10) {
          await ch.send({ embeds: list.slice(k, k + 10).map(archiveEmbed), allowedMentions: { parse: [] } }).catch((e) => log(`  ⚠ #${name} : ${e.message}`));
        }
        log(`  ＋ #${name} : ${list.length} messages`);
      }
    }
    const inviteChannel = findChannel(target, 'welcome') ?? findChannel(target, 'rules') ?? target.channels.cache.find((c) => c.type === ChannelType.GuildText);
    const invite = inviteChannel && (await inviteChannel.createInvite({ maxAge: 0, maxUses: 0, unique: false, reason: 'Serveur de secours' }).catch(() => null));
    s.restoredTo = target.id;
    s.restoredAt = Date.now();
    s.invite = invite?.url ?? s.invite ?? null;
    save();
    log(`✅ Terminé.${s.invite ? ` Lien d'invitation : ${s.invite}` : ''}`);
    require('./feed').push('🛟', `Serveur de secours restauré : ${target.name}`);
    return { invite: s.invite };
  } finally {
    restoring = false;
  }
}

/** Un membre rejoint le serveur de secours : on lui rend ses rôles (sauf ceux qui ont Administrateur). */
async function onMemberJoin(member) {
  const s = state();
  if (!s.restoredTo || member.guild.id !== s.restoredTo) return [];
  const names = s.members?.[member.id] ?? [];
  const roles = member.guild.roles.cache.filter((r) => names.includes(r.name) && r.editable && !r.managed && !r.permissions.has(P.Administrator));
  if (!roles.size) return [];
  await member.roles.add([...roles.keys()], 'Serveur de secours : rôles d\'origine').catch(() => {});
  return [...roles.values()].map((r) => r.name);
}

/** Prévenir les membres en MP (fonctionne tant que le bot partage encore un serveur avec eux). */
async function notifyMembers(client, { limit = 1000 } = {}) {
  const s = state();
  if (!s.invite) throw new Error('Restaure d\'abord le serveur de secours (le lien d\'invitation est créé à ce moment-là).');
  let ok = 0;
  let fail = 0;
  for (const id of Object.keys(s.members ?? {}).slice(0, limit)) {
    const sent = await client.users
      .send(id, `🛟 **${s.guildName}** a déménagé sur un serveur de secours. Rejoins-nous ici, tes rôles te seront rendus automatiquement : ${s.invite}`)
      .then(() => true)
      .catch(() => false);
    sent ? ok++ : fail++;
    await new Promise((r) => setTimeout(r, 1200)); // pas de rafale (anti-spam Discord)
  }
  return { ok, fail };
}

function status(client) {
  const s = state();
  const id = rescueGuildId();
  const target = id ? client?.guilds.cache.get(id) : null;
  return {
    guildId: id,
    connected: Boolean(target),
    targetName: target?.name ?? null,
    missing: target ? missingPerms(target) : [],
    at: s.at ?? null,
    counts: s.counts ?? null,
    messages: Object.values(s.messages ?? {}).reduce((n, l) => n + l.length, 0),
    emojis: s.emojis?.length ?? 0,
    restoredTo: s.restoredTo ?? null,
    restoredAt: s.restoredAt ?? null,
    invite: s.invite ?? null,
  };
}

// ───────────────────────── Commande ─────────────────────────

/** Seul le propriétaire du serveur principal (au moment de la copie) peut restaurer. */
const isOwner = (userId, mainGuild) => userId === state().ownerId || (mainGuild && userId === mainGuild.ownerId);

const command = {
  category: '💾 Sauvegardes',
  staff: true,
  data: new SlashCommandBuilder()
    .setName('secours')
    .setDescription('Serveur de secours : copie complète et restauration (propriétaire)')
    .setDefaultMemberPermissions(P.Administrator)
    .addSubcommand((s) => s.setName('etat').setDescription('Voir l\'état de la copie de secours'))
    .addSubcommand((s) => s.setName('copier').setDescription('Faire une copie de secours maintenant (serveur principal)'))
    .addSubcommand((s) =>
      s
        .setName('restaurer')
        .setDescription('Tout recopier sur CE serveur (à lancer sur le serveur de secours)')
        .addBooleanOption((o) => o.setName('messages').setDescription('Recopier l\'archive des messages (oui par défaut)')),
    )
    .addSubcommand((s) => s.setName('prevenir').setDescription('Envoyer le lien du serveur de secours aux membres en MP')),
  async run(i) {
    const sub = i.options.getSubcommand();
    const main = i.client.guilds.cache.get(process.env.GUILD_ID);
    if (!isOwner(i.user.id, main)) return i.reply({ content: '⛔ Réservé au propriétaire du serveur principal.', flags: MessageFlags.Ephemeral });
    if (sub === 'etat') {
      const st = status(i.client);
      return i.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [
          new EmbedBuilder()
            .setColor(BRAND_COLOR)
            .setTitle('🛟 Serveur de secours')
            .setDescription(
              `**Serveur de secours** : ${st.connected ? `✅ ${st.targetName}` : st.guildId ? '⚠️ le bot n\'y est pas' : '❌ non configuré (tableau de bord → Serveur de secours)'}\n` +
                `**Dernière copie** : ${st.at ? `<t:${Math.floor(st.at / 1000)}:R> · ${st.counts.roles} rôles, ${st.counts.channels} salons, ${st.counts.members} membres, ${st.emojis} émojis, ${st.messages} messages` : 'aucune'}` +
                (st.missing.length ? `\n⚠️ Permissions manquantes : ${st.missing.join(', ')}` : '') +
                (st.invite ? `\n🔗 ${st.invite}` : ''),
            ),
        ],
      });
    }
    if (sub === 'copier') {
      if (i.guildId !== process.env.GUILD_ID) return i.reply({ content: 'À lancer sur le serveur principal.', flags: MessageFlags.Ephemeral });
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const r = await capture(i.guild, { force: true });
      return i.editReply(`🛟 Copie de secours faite : ${r.roles} rôles, ${r.channels} salons, ${r.members} membres, ${r.emojis} émojis, ${r.messages} messages.`);
    }
    if (sub === 'restaurer') {
      if (i.guildId === process.env.GUILD_ID) return i.reply({ content: '⛔ Lance cette commande sur le **serveur de secours**, pas sur le serveur principal.', flags: MessageFlags.Ephemeral });
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const lines = [];
      try {
        const r = await restoreTo(i.guild, { messages: i.options.getBoolean('messages') ?? true, log: (l) => lines.push(l) });
        return i.editReply(`✅ Serveur de secours prêt !${r.invite ? `\n🔗 Lien à partager : ${r.invite}` : ''}\nLes membres retrouvent leurs rôles en rejoignant. Pour en faire le nouveau serveur principal : mets son identifiant dans \`GUILD_ID\` du fichier .env puis redémarre le bot.`.slice(0, 2000));
      } catch (err) {
        return i.editReply(`❌ ${err.message}`.slice(0, 2000));
      }
    }
    if (sub === 'prevenir') {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const r = await notifyMembers(i.client);
        return i.editReply(`📨 Lien envoyé à ${r.ok} membre(s) (${r.fail} injoignable(s) : MP fermés ou plus de serveur en commun).`);
      } catch (err) {
        return i.editReply(`❌ ${err.message}`);
      }
    }
    return null;
  },
};

module.exports = { rescueGuildId, looksNuked, capture, daily, restoreTo, onMemberJoin, notifyMembers, missingPerms, status, isOwner, archiveEmbed, commands: [command], command };
