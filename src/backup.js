/**
 * Sauvegarde / restauration du serveur : rôles, catégories, salons, permissions et réglages du bot.
 * Stockées dans la base SQLite. La restauration ne supprime JAMAIS rien :
 * elle recrée ce qui manque et remet les permissions / réglages sauvegardés.
 * Les messages ne sont pas sauvegardés (Discord ne le permet pas de façon fiable).
 */
const { AttachmentBuilder, ChannelType, EmbedBuilder, MessageFlags, OverwriteType, PermissionFlagsBits: P, SlashCommandBuilder } = require('discord.js');
const { BRAND_COLOR } = require('./shared');
const { db, sql, save } = require('./store');
const settings = require('./settings');
const { confirm, progress } = require('./confirm');

const AUTO_KEEP = 7; // sauvegardes automatiques conservées

/** Salons à ne pas sauvegarder (vocaux temporaires, tickets) */
const isEphemeral = (ch) => !!db.tempVoice?.[ch.id] || !!db.tickets?.open?.[ch.id];

function snapshot(guild) {
  const roles = guild.roles.cache
    .filter((r) => r.id !== guild.id && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable, permissions: r.permissions.bitfield.toString(), position: r.position }));
  const channels = guild.channels.cache
    .filter((c) => !c.isThread() && !isEphemeral(c))
    .sort((a, b) => (a.type === ChannelType.GuildCategory ? -1 : 0) - (b.type === ChannelType.GuildCategory ? -1 : 0) || a.rawPosition - b.rawPosition)
    .map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      parentId: c.parentId,
      position: c.rawPosition,
      topic: c.topic ?? null,
      nsfw: c.nsfw ?? false,
      userLimit: c.userLimit ?? 0,
      rateLimitPerUser: c.rateLimitPerUser ?? 0,
      overwrites: c.permissionOverwrites.cache.map((o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString() })),
    }));
  return {
    version: 1,
    guild: {
      id: guild.id,
      name: guild.name,
      verificationLevel: guild.verificationLevel,
      explicitContentFilter: guild.explicitContentFilter,
      defaultMessageNotifications: guild.defaultMessageNotifications,
      afkTimeout: guild.afkTimeout,
      afkChannelId: guild.afkChannelId,
      systemChannelId: guild.systemChannelId,
      everyonePermissions: guild.roles.everyone.permissions.bitfield.toString(),
    },
    roles,
    channels,
    settings: db.settings ?? {},
  };
}

function createBackup(guild, name, by = null) {
  const data = snapshot(guild);
  const res = sql
    .prepare('INSERT INTO backups (name, created_at, created_by, data) VALUES (?, ?, ?, ?)')
    .run(name, Date.now(), by, JSON.stringify(data));
  return { id: Number(res.lastInsertRowid), roles: data.roles.length, channels: data.channels.length };
}

const listBackups = () =>
  sql.prepare('SELECT id, name, created_at, created_by, length(data) AS size FROM backups ORDER BY id DESC').all();
const getBackup = (id) => {
  const row = sql.prepare('SELECT * FROM backups WHERE id = ?').get(id);
  return row ? { ...row, data: JSON.parse(row.data) } : null;
};
/** Vérifie qu'une sauvegarde (base ou fichier importé) a toutes les parties attendues. */
function isValidBackup(d) {
  const obj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  return !!(
    obj(d) &&
    d.version === 1 &&
    obj(d.guild) &&
    typeof d.guild.id === 'string' &&
    Array.isArray(d.roles) &&
    d.roles.every((r) => obj(r) && typeof r.name === 'string' && typeof r.permissions === 'string') &&
    Array.isArray(d.channels) &&
    d.channels.every((c) => obj(c) && typeof c.name === 'string' && Number.isInteger(c.type) && Array.isArray(c.overwrites)) &&
    (d.settings === undefined || obj(d.settings))
  );
}

const deleteBackup = (id) => sql.prepare('DELETE FROM backups WHERE id = ?').run(id).changes > 0;

/** Sauvegarde automatique quotidienne (garde les 7 dernières). */
function autoBackup(guild) {
  const last = sql.prepare("SELECT created_at FROM backups WHERE created_by = 'auto' ORDER BY id DESC LIMIT 1").get();
  if (last && Date.now() - last.created_at < 23 * 3600_000) return;
  createBackup(guild, `auto-${new Date().toISOString().slice(0, 10)}`, 'auto');
  const old = sql.prepare("SELECT id FROM backups WHERE created_by = 'auto' ORDER BY id DESC LIMIT -1 OFFSET ?").all(AUTO_KEEP);
  for (const { id } of old) deleteBackup(id);
  console.log('💾 Sauvegarde automatique du serveur effectuée');
}

/**
 * Copie de la base hors du serveur : chaque nuit, data/ronin.db (XP, ryō, tickets, réglages, sauvegardes)
 * est compressée et envoyée dans 💾┃sauvegardes (salon staff). Si le VPS disparaît, rien n'est perdu.
 */
async function offsiteBackup(guild, { force = false } = {}) {
  const fs = require('fs');
  const path = require('path');
  const zlib = require('zlib');
  const { AttachmentBuilder: Attachment } = require('discord.js');
  const { findChannel } = require('./shared');
  if (!force && db.lastOffsiteBackup && Date.now() - db.lastOffsiteBackup < 23 * 3600_000) return null;
  const channel = findChannel(guild, 'db_backups');
  if (!channel) return null;
  const tmp = path.join(require('./store').DIR, `copie-${Date.now()}.db`);
  try {
    // Copie cohérente de la base même pendant que le bot écrit
    sql.exec(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`);
    const gz = zlib.gzipSync(fs.readFileSync(tmp), { level: 9 });
    const name = `ronin-${new Date().toISOString().slice(0, 10)}.db.gz`;
    if (gz.length > 9.5 * 1024 * 1024) {
      await channel.send(`⚠️ La base fait ${(gz.length / 1024 / 1024).toFixed(1)} Mo compressée : trop lourde pour Discord. Copie-la depuis le VPS : \`scp root@IP:/root/bot/data/ronin.db .\``);
      return null;
    }
    await channel.send({
      content: `📦 Copie de la base du **${new Date().toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}** (${(gz.length / 1024).toFixed(0)} Ko).\n_Pour restaurer : décompresse le fichier (7-Zip) en \`ronin.db\` et remplace \`data/ronin.db\` bot arrêté._`,
      files: [new Attachment(gz, { name })],
    });
    db.lastOffsiteBackup = Date.now();
    save();
    console.log('📦 Copie de la base envoyée dans le salon des sauvegardes');
    return name;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Ce que la restauration va faire (pour la confirmation). */
function plan(guild, data) {
  const roleMissing = data.roles.filter((r) => !guild.roles.cache.has(r.id) && !guild.roles.cache.find((x) => x.name === r.name));
  const chMissing = data.channels.filter(
    (c) => !guild.channels.cache.has(c.id) && !guild.channels.cache.find((x) => x.name === c.name && x.type === c.type),
  );
  return { roleMissing, chMissing, roleUpdate: data.roles.length - roleMissing.length, chUpdate: data.channels.length - chMissing.length };
}

async function restore(guild, data, log = console.log) {
  if (!isValidBackup(data)) throw new Error('Sauvegarde invalide ou incomplète');
  await guild.roles.fetch();
  await guild.channels.fetch();
  const roleMap = new Map([[data.guild.id, guild.id]]); // ancien ID -> ID actuel (@everyone inclus)

  log('👥 Rôles');
  for (const r of [...data.roles].sort((a, b) => a.position - b.position)) {
    let role = guild.roles.cache.get(r.id) ?? guild.roles.cache.find((x) => x.name === r.name && !x.managed);
    const fields = { name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable, permissions: BigInt(r.permissions) };
    if (!role) {
      role = await guild.roles.create({ ...fields, reason: 'Restauration de sauvegarde' }).catch((e) => log(`  ⚠ ${r.name} : ${e.message}`));
      if (role) log(`  ＋ ${r.name}`);
    } else if (role.editable) {
      await role.edit(fields).catch(() => {});
    }
    if (role) roleMap.set(r.id, role.id);
  }
  await guild.roles.everyone.setPermissions(BigInt(data.guild.everyonePermissions)).catch(() => {});

  const mapOverwrites = (list) =>
    list
      .map((o) => ({ ...o, id: o.type === OverwriteType.Role ? roleMap.get(o.id) : o.id, allow: BigInt(o.allow), deny: BigInt(o.deny) }))
      .filter((o) => o.id && (o.type === OverwriteType.Member || guild.roles.cache.has(o.id)));

  log('📁 Salons');
  const chMap = new Map();
  for (const c of data.channels) {
    let ch = guild.channels.cache.get(c.id) ?? guild.channels.cache.find((x) => x.name === c.name && x.type === c.type);
    const parent = c.parentId ? chMap.get(c.parentId) ?? null : null;
    const permissionOverwrites = mapOverwrites(c.overwrites);
    if (!ch) {
      ch = await guild.channels
        .create({
          name: c.name,
          type: c.type,
          parent,
          topic: c.topic ?? undefined,
          nsfw: c.nsfw,
          userLimit: c.userLimit || undefined,
          rateLimitPerUser: c.rateLimitPerUser || undefined,
          permissionOverwrites,
          reason: 'Restauration de sauvegarde',
        })
        .catch((e) => log(`  ⚠ ${c.name} : ${e.message}`));
      if (ch) log(`  ＋ ${c.name}`);
    } else {
      if (c.type !== ChannelType.GuildCategory && ch.parentId !== parent) await ch.setParent(parent, { lockPermissions: false }).catch(() => {});
      await ch.permissionOverwrites.set(permissionOverwrites).catch(() => {});
    }
    if (ch) chMap.set(c.id, ch.id);
  }

  log('⚙️ Paramètres');
  await guild
    .edit({
      verificationLevel: data.guild.verificationLevel,
      explicitContentFilter: data.guild.explicitContentFilter,
      defaultMessageNotifications: data.guild.defaultMessageNotifications,
      afkTimeout: data.guild.afkTimeout,
      afkChannel: chMap.get(data.guild.afkChannelId) ?? null,
      systemChannel: chMap.get(data.guild.systemChannelId) ?? null,
    })
    .catch((e) => log(`  ⚠ ${e.message}`));
  if (data.settings && typeof data.settings === 'object') {
    settings.replaceAll(data.settings);
    log('  ✔ Réglages du bot restaurés');
  }
}

// ───────────────────────── Commandes ─────────────────────────

const fmtDate = (t) => `<t:${Math.floor(t / 1000)}:f>`;

const commands = [
  {
    category: '💾 Sauvegardes',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('backup')
      .setDescription('Sauvegarder le serveur (rôles, salons, permissions, réglages)')
      .setDefaultMemberPermissions(P.Administrator)
      .addSubcommand((s) => s.setName('creer').setDescription('Créer une sauvegarde').addStringOption((o) => o.setName('nom').setDescription('Nom de la sauvegarde').setMaxLength(50)))
      .addSubcommand((s) => s.setName('liste').setDescription('Voir les sauvegardes'))
      .addSubcommand((s) => s.setName('copie-base').setDescription('Envoyer maintenant une copie de la base dans 💾┃sauvegardes'))
      .addSubcommand((s) => s.setName('exporter').setDescription('Télécharger une sauvegarde (fichier .json)').addIntegerOption((o) => o.setName('id').setDescription('Numéro').setRequired(true)))
      .addSubcommand((s) => s.setName('supprimer').setDescription('Supprimer une sauvegarde').addIntegerOption((o) => o.setName('id').setDescription('Numéro').setRequired(true))),
    async run(i) {
      const sub = i.options.getSubcommand();
      if (sub === 'creer') {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        await i.guild.channels.fetch();
        await i.guild.roles.fetch();
        const name = i.options.getString('nom') || `manuel-${new Date().toISOString().slice(0, 16).replace('T', '-')}`;
        const b = createBackup(i.guild, name, i.user.id);
        return i.editReply(`💾 Sauvegarde **#${b.id}** « ${name} » créée : ${b.roles} rôles, ${b.channels} salons/catégories, réglages du bot.`);
      }
      if (sub === 'copie-base') {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const name = await offsiteBackup(i.guild, { force: true }).catch((e) => `❌ ${e.message}`);
        return i.editReply(name ? (name.startsWith('❌') ? name : `📦 Copie \`${name}\` envoyée.`) : 'Salon 💾┃sauvegardes introuvable (lance /setup) ou base trop lourde.');
      }
      if (sub === 'liste') {
        const list = listBackups().slice(0, 20);
        const embed = new EmbedBuilder()
          .setColor(BRAND_COLOR)
          .setTitle('💾 Sauvegardes')
          .setDescription(
            list.map((b) => `**#${b.id}** · ${b.name} · ${fmtDate(b.created_at)} · ${(b.size / 1024).toFixed(0)} Ko`).join('\n') || '_Aucune sauvegarde. Utilise `/backup creer`._',
          )
          .setFooter({ text: 'Restaurer : /restore id:<numéro>' });
        return i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }
      const id = i.options.getInteger('id');
      const b = getBackup(id);
      if (!b) return i.reply({ content: `Sauvegarde #${id} introuvable.`, flags: MessageFlags.Ephemeral });
      if (sub === 'exporter') {
        const file = new AttachmentBuilder(Buffer.from(JSON.stringify(b.data, null, 2)), { name: `backup-${id}-${b.name}.json` });
        return i.reply({ content: `💾 Sauvegarde #${id}`, files: [file], flags: MessageFlags.Ephemeral });
      }
      if (!(await confirm(i, `🗑️ Supprimer définitivement la sauvegarde **#${id}** « ${b.name} » ?`, { yes: 'Supprimer', danger: true }))) return;
      deleteBackup(id);
      return i.editReply(`🗑️ Sauvegarde #${id} supprimée.`);
    },
  },
  {
    category: '💾 Sauvegardes',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('restore')
      .setDescription('Restaurer une sauvegarde (recrée ce qui manque, ne supprime rien)')
      .setDefaultMemberPermissions(P.Administrator)
      .addIntegerOption((o) => o.setName('id').setDescription('Numéro de la sauvegarde (voir /backup liste)'))
      .addAttachmentOption((o) => o.setName('fichier').setDescription('Ou un fichier .json exporté avec /backup exporter')),
    async run(i) {
      let data;
      const file = i.options.getAttachment('fichier');
      const id = i.options.getInteger('id');
      if (!file && !id) return i.reply({ content: 'Indique `id` (voir `/backup liste`) ou un `fichier`.', flags: MessageFlags.Ephemeral });
      // Répondre tout de suite à Discord (3 s max), le téléchargement et l'analyse peuvent être longs
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      if (file) {
        try {
          if (file.size > 10 * 1024 * 1024) throw new Error();
          data = await (await fetch(file.url)).json();
        } catch {
          data = null;
        }
        if (!isValidBackup(data)) return i.editReply('❌ Fichier de sauvegarde invalide ou incomplet.');
      } else {
        data = getBackup(id)?.data;
        if (!data) return i.editReply(`Sauvegarde #${id} introuvable.`);
      }
      await i.guild.roles.fetch();
      await i.guild.channels.fetch();
      const p = plan(i.guild, data);
      const ok = await confirm(
        i,
        `♻️ **Restauration de « ${data.guild.name} »**\n` +
          `• ${p.roleMissing.length} rôle(s) à recréer${p.roleMissing.length ? ` : ${p.roleMissing.slice(0, 8).map((r) => r.name).join(', ')}${p.roleMissing.length > 8 ? '…' : ''}` : ''}\n` +
          `• ${p.chMissing.length} salon(s) à recréer${p.chMissing.length ? ` : ${p.chMissing.slice(0, 8).map((c) => c.name).join(', ')}${p.chMissing.length > 8 ? '…' : ''}` : ''}\n` +
          `• ${p.roleUpdate} rôle(s) et ${p.chUpdate} salon(s) existants : permissions remises comme dans la sauvegarde\n` +
          '• Réglages du bot remplacés\n\n' +
          '_Rien ne sera supprimé. Une sauvegarde de l\'état actuel est faite avant._',
        { yes: 'Restaurer', danger: true },
      );
      if (!ok) return;
      createBackup(i.guild, `avant-restauration-${new Date().toISOString().slice(0, 16)}`, i.user.id);
      const prog = progress(i, '♻️ Restauration en cours');
      await restore(i.guild, data, prog.log);
      await prog.done('✅ Restauration terminée.');
    },
  },
];

module.exports = { offsiteBackup, isValidBackup, snapshot, createBackup, listBackups, getBackup, deleteBackup, restore, plan, autoBackup, commands };
