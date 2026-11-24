/**
 * Commandes slash (/) du bot, façon MEE6.
 */
const {
  SlashCommandBuilder,
  PermissionFlagsBits: P,
  EmbedBuilder,
  MessageFlags,
  ChannelType,
  AttachmentBuilder,
} = require('discord.js');
const { BRAND_COLOR, findChannel, findRole } = require('./shared');
const { db, save } = require('./store');
const levels = require('./levels');

const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });
const memberOpt = (o, desc = 'Le membre') => o.setName('membre').setDescription(desc).setRequired(true);
const reasonOpt = (o) => o.setName('raison').setDescription('La raison').setRequired(false);

/** Le modérateur peut-il agir sur cette cible ? (comme dans Discord : rôle le plus haut strictement supérieur) */
function hierarchyError(i, target) {
  if (!target) return null;
  if (target.id === i.user.id) return '❌ Tu ne peux pas faire ça sur toi-même.';
  if (target.id === i.guild.ownerId) return '❌ Impossible d\'agir sur le propriétaire du serveur.';
  if (i.user.id === i.guild.ownerId) return null;
  if (target.roles.highest.position >= i.member.roles.highest.position) return '❌ Ce membre a un rôle égal ou supérieur au tien.';
  return null;
}

const MUTE_DURATIONS = [
  ['1 minute', 1], ['5 minutes', 5], ['10 minutes', 10], ['30 minutes', 30],
  ['1 heure', 60], ['6 heures', 360], ['1 jour', 1440], ['1 semaine', 10080],
];

const commands = [
  // ───────── Tout le monde ─────────
  {
    category: '🎉 Général',
    data: new SlashCommandBuilder().setName('aide').setDescription('Liste des commandes du bot'),
    async run(i) {
      const isStaff = i.memberPermissions.has(P.ManageMessages);
      const byCat = {};
      for (const c of commands) {
        if (c.staff && !isStaff) continue;
        (byCat[c.category] ??= []).push(`\`/${c.data.name}\` — ${c.data.description}`);
      }
      const embed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle('📖 Commandes')
        .addFields(Object.entries(byCat).map(([name, lines]) => ({ name, value: lines.join('\n') })));
      return i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
  },
  {
    category: '🎉 Général',
    data: new SlashCommandBuilder().setName('ping').setDescription('Vérifie que le bot répond'),
    run: (i) => i.reply(ephemeral(`🏓 Pong ! ${Math.round(i.client.ws.ping)} ms`)),
  },
  {
    category: '🎉 Général',
    data: new SlashCommandBuilder().setName('live').setDescription('Le stream est-il en ligne ?'),
    async run(i, ctx) {
      const login = require('./shared').twitchLogin();
      if (!login) return i.reply(ephemeral('La chaîne Twitch n\'est pas configurée.'));
      if (!ctx.twitch) return i.reply(`📺 La chaîne : https://twitch.tv/${login}`);
      const stream = await ctx.twitch.getLiveStream(login);
      if (!stream) return i.reply(`⚫ Pas de live pour le moment. Passe sur https://twitch.tv/${login} et active la cloche 🔔 !`);
      const since = Math.floor(new Date(stream.started_at).getTime() / 1000);
      return i.reply(
        `🔴 **En live** depuis <t:${since}:R> sur **${stream.game_name || '?'}** devant ${stream.viewer_count} viewers !\n` +
          `> ${stream.title}\nhttps://twitch.tv/${login}`,
      );
    },
  },
  {
    category: '🎉 Général',
    data: new SlashCommandBuilder()
      .setName('profil')
      .setDescription('Infos sur un membre')
      .addUserOption((o) => o.setName('membre').setDescription('Le membre (toi par défaut)')),
    async run(i) {
      const member = i.options.getUser('membre') ? i.options.getMember('membre') : i.member;
      if (!member) return i.reply(ephemeral('Ce membre n\'est pas (ou plus) sur le serveur.'));
      const roles = member.roles.cache.filter((r) => r.id !== i.guild.id).sort((a, b) => b.position - a.position);
      const embed = new EmbedBuilder()
        .setColor(member.displayColor || BRAND_COLOR)
        .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
        .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: 'Compte créé', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:D>`, inline: true },
          { name: 'Arrivé sur le serveur', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
          { name: `Rôles (${roles.size})`, value: roles.map((r) => `${r}`).join(' ').slice(0, 1024) || 'Aucun' },
        );
      const st = require('./memberstats').full(member.id);
      const h = Math.floor(st.voiceMinutes / 60);
      embed.addFields(
        { name: '⚔️ Niveau', value: `**${st.level}** · ${st.totalXp.toLocaleString('fr-FR')} XP${st.rank ? ` · #${st.rank}` : ''}`, inline: true },
        { name: '🏆 Classements', value: `Mois : ${st.seasonRank ? `#${st.seasonRank}` : '—'} · Semaine : ${st.weekRank ? `#${st.weekRank}` : '—'}`, inline: true },
        { name: '💬 Activité', value: `${st.messages.toLocaleString('fr-FR')} messages · ${h} h ${st.voiceMinutes % 60} min de vocal · ${st.reactions} réactions`, inline: false },
        { name: '💰 Ryō', value: `${st.ryo.toLocaleString('fr-FR')} 両 (gagnés : ${st.ryoEarned.toLocaleString('fr-FR')}) · série /daily ${st.streak} (record ${st.bestStreak})`, inline: false },
        { name: '📜 Quêtes', value: `${st.questsDone} terminées`, inline: true },
        { name: '⚔️ Duels', value: `${st.duelsWon} / ${st.duels} gagnés`, inline: true },
        ...(st.pillarWins ? [{ name: '🔥 Pilier de la semaine', value: `${st.pillarWins} fois`, inline: true }] : []),
      );
      return i.reply({ embeds: [embed] });
    },
  },
  {
    category: '🎉 Général',
    data: new SlashCommandBuilder().setName('serveur').setDescription('Infos sur le serveur'),
    async run(i) {
      const g = i.guild;
      const embed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle(g.name)
        .setThumbnail(g.iconURL())
        .addFields(
          { name: '👥 Membres', value: `${g.memberCount}`, inline: true },
          { name: '💬 Salons', value: `${g.channels.cache.filter((c) => c.type !== ChannelType.GuildCategory).size}`, inline: true },
          { name: '🎭 Rôles', value: `${g.roles.cache.size - 1}`, inline: true },
          { name: '🚀 Boosts', value: `${g.premiumSubscriptionCount ?? 0}`, inline: true },
          { name: '📅 Créé', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:D>`, inline: true },
        );
      return i.reply({ embeds: [embed] });
    },
  },
  {
    category: '🎉 Général',
    data: new SlashCommandBuilder()
      .setName('sondage')
      .setDescription('Créer un sondage')
      .addStringOption((o) => o.setName('question').setDescription('La question').setRequired(true).setMaxLength(300))
      .addStringOption((o) => o.setName('choix1').setDescription('Choix 1').setRequired(true).setMaxLength(55))
      .addStringOption((o) => o.setName('choix2').setDescription('Choix 2').setRequired(true).setMaxLength(55))
      .addStringOption((o) => o.setName('choix3').setDescription('Choix 3').setMaxLength(55))
      .addStringOption((o) => o.setName('choix4').setDescription('Choix 4').setMaxLength(55))
      .addIntegerOption((o) => o.setName('duree').setDescription('Durée en heures (24 par défaut)').setMinValue(1).setMaxValue(168)),
    async run(i) {
      const answers = ['choix1', 'choix2', 'choix3', 'choix4']
        .map((k) => i.options.getString(k))
        .filter(Boolean)
        .map((text) => ({ text }));
      return i.reply({
        poll: {
          question: { text: i.options.getString('question') },
          answers,
          duration: i.options.getInteger('duree') ?? 24,
          allowMultiselect: false,
        },
      });
    },
  },

  // ───────── Niveaux ─────────
  {
    category: '⭐ Niveaux',
    data: new SlashCommandBuilder()
      .setName('rang')
      .setDescription('Ton niveau et ton XP')
      .addUserOption((o) => o.setName('membre').setDescription('Le membre (toi par défaut)')),
    async run(i) {
      const user = i.options.getUser('membre') ?? i.user;
      const r = levels.rankOf(user.id);
      // Carte en image ; si le rendu échoue (polices…), on retombe sur le message texte
      try {
        await i.deferReply();
        const member = await i.guild.members.fetch(user.id).catch(() => null);
        const grade = member && levels.rewardList(i.guild).filter((x) => member.roles.cache.has(x.role.id)).at(-1)?.role.name;
        const png = await require('./rankcard').renderRankCard({
          username: member?.displayName ?? user.username,
          avatarUrl: user.displayAvatarURL({ extension: 'png', size: 256 }),
          level: r.level,
          xp: r.xp,
          needed: r.needed,
          rank: r.rank,
          totalXp: r.totalXp,
          messages: r.messages,
          voiceMinutes: db.levels[user.id]?.voiceMinutes ?? 0,
          ryo: db.economy?.[user.id]?.bal ?? 0,
          grade: grade ?? (member ? '⚔️ Ronin' : 'Ronin'),
          seasonRank: require('./seasons').rankOf(user.id),
        });
        return i.editReply({ files: [new AttachmentBuilder(png, { name: 'rang.png' })] });
      } catch (err) {
        console.error('Carte de rang :', err.message);
      }
      const filled = Math.round((r.xp / r.needed) * 20);
      const embed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
        .setDescription(
          `**Niveau ${r.level}** · Rang ${r.rank ? `#${r.rank}` : '—'} · ${r.messages} messages\n` +
            `\`${'█'.repeat(filled)}${'░'.repeat(20 - filled)}\` ${r.xp} / ${r.needed} XP`,
        );
      return i.deferred ? i.editReply({ embeds: [embed] }) : i.reply({ embeds: [embed] });
    },
  },
  {
    category: '⭐ Niveaux',
    data: new SlashCommandBuilder().setName('classement').setDescription('Le top 10 des membres les plus actifs'),
    async run(i) {
      const top = levels.leaderboard().slice(0, 10);
      if (!top.length) return i.reply(ephemeral('Personne n\'a encore d\'XP. À vos claviers ! ⌨️'));
      const medals = ['🥇', '🥈', '🥉'];
      const embed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle(`🏆 Classement de ${i.guild.name}`)
        .setDescription(
          top.map((e, n) => `${medals[n] ?? `**${n + 1}.**`} <@${e.userId}> — niveau **${e.level}** (${e.totalXp} XP)`).join('\n'),
        );
      return i.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    },
  },

  // ───────── Staff ─────────
  {
    category: '📢 Staff',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('annonce')
      .setDescription('Publier une annonce dans le salon annonces')
      .setDefaultMemberPermissions(P.KickMembers)
      .addStringOption((o) => o.setName('message').setDescription('Le texte (\\n pour un retour à la ligne)').setRequired(true))
      .addStringOption((o) => o.setName('titre').setDescription('Titre de l\'annonce'))
      .addBooleanOption((o) => o.setName('mention').setDescription('Mentionner le rôle 📢 Notif Annonces ?')),
    async run(i) {
      const channel = findChannel(i.guild, 'announcements');
      if (!channel) return i.reply(ephemeral('Salon annonces introuvable (lance `npm run setup`).'));
      const notif = findRole(i.guild, 'notif_news');
      const ping = i.options.getBoolean('mention') && notif;
      const embed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle(i.options.getString('titre') ?? '📢 Annonce')
        .setDescription(i.options.getString('message').replaceAll('\\n', '\n'))
        .setFooter({ text: `Par ${i.user.username}`, iconURL: i.user.displayAvatarURL() })
        .setTimestamp();
      await channel.send({ content: ping ? `${notif}` : undefined, embeds: [embed], allowedMentions: { roles: ping ? [notif.id] : [] } });
      return i.reply(ephemeral(`✅ Annonce publiée dans ${channel}.`));
    },
  },
  {
    category: '🛡️ Modération',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('clear')
      .setDescription('Supprimer des messages dans ce salon')
      .setDefaultMemberPermissions(P.ManageMessages)
      .addIntegerOption((o) => o.setName('nombre').setDescription('Nombre de messages (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
      .addUserOption((o) => o.setName('membre').setDescription('Seulement les messages de ce membre')),
    async run(i, ctx) {
      const n = i.options.getInteger('nombre');
      const user = i.options.getUser('membre');
      let messages = await i.channel.messages.fetch({ limit: 100 });
      if (user) messages = messages.filter((m) => m.author.id === user.id);
      const deleted = await i.channel.bulkDelete([...messages.values()].slice(0, n), true);
      await ctx.modLog(i, '🧹 Clear', `${deleted.size} messages supprimés dans ${i.channel}${user ? ` (de ${user})` : ''}`);
      return i.reply(ephemeral(`🧹 ${deleted.size} message(s) supprimé(s). (Les messages de plus de 14 jours ne peuvent pas être supprimés en masse.)`));
    },
  },
  {
    category: '🛡️ Modération',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('warn')
      .setDescription('Avertir un membre')
      .setDefaultMemberPermissions(P.ModerateMembers)
      .addUserOption((o) => memberOpt(o))
      .addStringOption((o) => o.setName('raison').setDescription('La raison').setRequired(true)),
    async run(i, ctx) {
      const user = i.options.getUser('membre');
      const denied = hierarchyError(i, i.options.getMember('membre'));
      if (denied) return i.reply(ephemeral(denied));
      const reason = i.options.getString('raison');
      (db.warns[user.id] ??= []).push({ reason, by: i.user.id, at: Date.now() });
      save();
      const count = db.warns[user.id].length;
      await user.send(`⚠️ Tu as reçu un avertissement sur **${i.guild.name}** : ${reason}`).catch(() => {});
      await ctx.modLog(i, '⚠️ Avertissement', `${user} — ${reason} (total : ${count})`);
      return i.reply(`⚠️ ${user} a reçu un avertissement (${count} au total). Raison : ${reason}`);
    },
  },
  {
    category: '🛡️ Modération',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('warns')
      .setDescription('Voir les avertissements d\'un membre')
      .setDefaultMemberPermissions(P.ModerateMembers)
      .addUserOption((o) => memberOpt(o)),
    async run(i) {
      const user = i.options.getUser('membre');
      const list = db.warns[user.id] ?? [];
      if (!list.length) return i.reply(ephemeral(`✅ ${user} n'a aucun avertissement.`));
      const shown = list.slice(-15); // les 15 plus récents
      const lines = shown.map((w, n) => `${list.length - shown.length + n + 1}. <t:${Math.floor(w.at / 1000)}:d> par <@${w.by}> — ${w.reason.slice(0, 200)}`);
      const embed = new EmbedBuilder()
        .setColor(0xe67e22)
        .setTitle(`⚠️ Avertissements (${list.length})`)
        .setDescription(`${user}\n\n${lines.join('\n')}`.slice(0, 4000));
      if (list.length > shown.length) embed.setFooter({ text: `${list.length - shown.length} plus ancien(s) non affiché(s) — voir le tableau de bord` });
      return i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
  },
  {
    category: '🛡️ Modération',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('clearwarns')
      .setDescription('Effacer les avertissements d\'un membre')
      .setDefaultMemberPermissions(P.KickMembers)
      .addUserOption((o) => memberOpt(o)),
    async run(i, ctx) {
      const user = i.options.getUser('membre');
      delete db.warns[user.id];
      save();
      await ctx.modLog(i, '🧽 Avertissements effacés', `${user}`);
      return i.reply(ephemeral(`✅ Avertissements de ${user} effacés.`));
    },
  },
  {
    category: '🛡️ Modération',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('mute')
      .setDescription('Rendre un membre muet temporairement (timeout)')
      .setDefaultMemberPermissions(P.ModerateMembers)
      .addUserOption((o) => memberOpt(o))
      .addIntegerOption((o) =>
        o.setName('duree').setDescription('Durée').setRequired(true).addChoices(...MUTE_DURATIONS.map(([name, value]) => ({ name, value }))),
      )
      .addStringOption(reasonOpt),
    async run(i, ctx) {
      const member = i.options.getMember('membre');
      const denied = hierarchyError(i, member);
      if (denied) return i.reply(ephemeral(denied));
      if (!member?.moderatable) return i.reply(ephemeral('❌ Impossible de rendre ce membre muet (rôle trop haut ou membre introuvable).'));
      const minutes = i.options.getInteger('duree');
      // Les Sentinelles (sans le droit d'expulser) sont limitées à 1 heure de mute
      if (minutes > 60 && !i.memberPermissions.has(P.KickMembers)) {
        return i.reply(ephemeral('🔰 En tant que Sentinelle, tu peux rendre muet 1 heure maximum. Demande à un Modérateur pour plus long.'));
      }
      const reason = i.options.getString('raison') ?? 'Aucune raison';
      await member.timeout(minutes * 60_000, `${reason} — par ${i.user.tag}`);
      const label = MUTE_DURATIONS.find(([, v]) => v === minutes)?.[0] ?? `${minutes} min`;
      await ctx.modLog(i, '🔇 Mute', `${member} pour ${label} — ${reason}`);
      return i.reply(`🔇 ${member} est muet pour **${label}**. Raison : ${reason}`);
    },
  },
  {
    category: '🛡️ Modération',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('unmute')
      .setDescription('Rendre la parole à un membre')
      .setDefaultMemberPermissions(P.ModerateMembers)
      .addUserOption((o) => memberOpt(o)),
    async run(i, ctx) {
      const member = i.options.getMember('membre');
      const denied = hierarchyError(i, member);
      if (denied) return i.reply(ephemeral(denied));
      if (!member?.moderatable) return i.reply(ephemeral('❌ Impossible de modifier ce membre.'));
      await member.timeout(null, `Unmute par ${i.user.tag}`);
      await ctx.modLog(i, '🔊 Unmute', `${member}`);
      return i.reply(`🔊 ${member} peut de nouveau parler.`);
    },
  },
  {
    category: '🛡️ Modération',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('kick')
      .setDescription('Expulser un membre')
      .setDefaultMemberPermissions(P.KickMembers)
      .addUserOption((o) => memberOpt(o))
      .addStringOption(reasonOpt),
    async run(i, ctx) {
      const member = i.options.getMember('membre');
      const denied = hierarchyError(i, member);
      if (denied) return i.reply(ephemeral(denied));
      if (!member?.kickable) return i.reply(ephemeral('❌ Impossible d\'expulser ce membre (rôle trop haut ou membre introuvable).'));
      const reason = i.options.getString('raison') ?? 'Aucune raison';
      await member.send(`👢 Tu as été expulsé de **${i.guild.name}** : ${reason}`).catch(() => {});
      await member.kick(`${reason} — par ${i.user.tag}`);
      await ctx.modLog(i, '👢 Kick', `${member.user.tag} — ${reason}`);
      return i.reply(`👢 **${member.user.tag}** a été expulsé. Raison : ${reason}`);
    },
  },
  {
    category: '🛡️ Modération',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('ban')
      .setDescription('Bannir un membre')
      .setDefaultMemberPermissions(P.BanMembers)
      .addUserOption((o) => memberOpt(o))
      .addStringOption(reasonOpt)
      .addBooleanOption((o) => o.setName('supprimer_messages').setDescription('Supprimer ses messages des 7 derniers jours ?')),
    async run(i, ctx) {
      const user = i.options.getUser('membre');
      const member = i.options.getMember('membre');
      const denied = hierarchyError(i, member);
      if (denied) return i.reply(ephemeral(denied));
      if (member && !member.bannable) return i.reply(ephemeral('❌ Impossible de bannir ce membre (rôle trop haut).'));
      const reason = i.options.getString('raison') ?? 'Aucune raison';
      await user.send(`🔨 Tu as été banni de **${i.guild.name}** : ${reason}`).catch(() => {});
      await i.guild.members.ban(user, {
        reason: `${reason} — par ${i.user.tag}`,
        deleteMessageSeconds: i.options.getBoolean('supprimer_messages') ? 7 * 86400 : 0,
      });
      await ctx.modLog(i, '🔨 Ban', `${user.tag} — ${reason}`);
      return i.reply(`🔨 **${user.tag}** a été banni. Raison : ${reason}`);
    },
  },
];

commands.push(
  ...require('./music').commands,
  ...require('./security').commands,
  ...require('./tickets').commands,
  ...require('./admin').commands,
  ...require('./backup').commands,
  ...require('./stats').commands,
  ...require('./economy').commands,
  ...require('./giveaway').commands,
  ...require('./birthdays').commands,
  ...require('./automod').commands,
  ...require('./health').commands,
  ...require('./seasons').commands,
  ...require('./custom').commands,
  ...require('./guide').commands,
  ...require('./quarantine').commands,
  ...require('./quests').commands,
  ...require('./boost').commands,
  ...require('./memberstats').commands,
);

// /help = /aide
const aide = commands.find((c) => c.data.name === 'aide');
commands.splice(commands.indexOf(aide) + 1, 0, {
  ...aide,
  data: new SlashCommandBuilder().setName('help').setDescription('Liste des commandes de Kensei'),
});

const byName = new Map(commands.map((c) => [c.data.name, c]));

/** Enregistre les commandes sur le serveur (instantané, contrairement aux commandes globales). */
async function register(guild) {
  await guild.commands.set(commands.map((c) => c.data.toJSON()));
  console.log(`⌨️  ${commands.length} commandes / enregistrées`);
}

async function handle(interaction, ctx) {
  const cmd = byName.get(interaction.commandName);
  if (!cmd) return;
  // Double vérification des permissions : les réglages Discord « Intégrations » peuvent être modifiés à la main
  const required = cmd.data.default_member_permissions;
  if (required && interaction.user.id !== interaction.guild?.ownerId && !interaction.memberPermissions?.has(BigInt(required))) {
    return interaction.reply({ content: '⛔ Tu n\'as pas la permission d\'utiliser cette commande.', flags: MessageFlags.Ephemeral });
  }
  if (cmd.staff) {
    const audit = require('./audit');
    audit.record({ userId: interaction.user.id, user: interaction.user.username, source: 'discord', action: `/${interaction.commandName}`, details: audit.describeOptions(interaction) });
  }
  try {
    await cmd.run(interaction, ctx);
  } catch (err) {
    console.error(`Erreur /${interaction.commandName} :`, err);
    const msg = ephemeral('❌ Une erreur est survenue (le bot a-t-il les bonnes permissions ?).');
    if (interaction.replied || interaction.deferred) await interaction.followUp(msg).catch(() => {});
    else await interaction.reply(msg).catch(() => {});
  }
}

module.exports = { commands, register, handle };
