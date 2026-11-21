/**
 * Crée (ou met à jour) toute la structure du serveur à partir de config/server.js.
 * Usage : npm run setup
 */
require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionFlagsBits: P,
  GuildVerificationLevel,
  GuildExplicitContentFilter,
  GuildDefaultMessageNotifications,
  GuildSystemChannelFlags,
} = require('discord.js');
const { config, findRole, rulesPayload, rolesPayload, BRAND_COLOR } = require('./shared');

const { DISCORD_TOKEN, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !GUILD_ID) {
  console.error('❌ DISCORD_TOKEN et GUILD_ID doivent être définis dans .env');
  process.exit(1);
}

const TEXT_READ = [P.ViewChannel, P.ReadMessageHistory];
const TEXT_WRITE = [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads, P.AddReactions, P.AttachFiles, P.EmbedLinks];
const VOICE_READ = [P.ViewChannel];
const VOICE_WRITE = [P.Connect, P.Speak, P.Stream, P.UseVAD];

const log = (...a) => console.log(...a);

/** Construit les permissions d'un salon selon son niveau d'accès. */
function buildOverwrites(guild, botId, def) {
  const isVoice = def.type === 'voice';
  const READ = isVoice ? VOICE_READ : TEXT_READ;
  const WRITE = isVoice ? VOICE_WRITE : TEXT_WRITE;
  const staffExtra = isVoice ? [P.MuteMembers, P.MoveMembers] : [P.ManageMessages];

  const everyone = guild.roles.everyone.id;
  const role = (key) => findRole(guild, key)?.id;
  const ow = [];
  const add = (id, allow = [], deny = []) => id && ow.push({ id, allow, deny });

  // Le bot voit et écrit partout (utile s'il n'a pas la permission Administrateur)
  add(botId, [...READ, ...WRITE, P.ManageMessages]);
  // Les modérateurs voient et écrivent partout
  add(role('mod'), [...READ, ...WRITE, ...staffExtra]);
  // Les rôles `allVoice` (ex : Amis) rejoignent tous les vocaux
  if (isVoice) for (const r of config.roles.filter((d) => d.allVoice)) add(role(r.key), [...READ, ...WRITE]);

  switch (def.access) {
    case 'public-readonly':
      add(everyone, READ, WRITE.filter((p) => p !== P.AddReactions));
      break;
    case 'members':
      add(everyone, [], [P.ViewChannel]);
      add(role('member'), [...READ, ...WRITE]);
      break;
    case 'members-readonly':
      add(everyone, [], [P.ViewChannel]);
      add(role('member'), [...READ, P.AddReactions], WRITE.filter((p) => p !== P.AddReactions));
      break;
    case 'vip':
      add(everyone, [], [P.ViewChannel]);
      add(role('vip'), [...READ, ...WRITE]);
      add(role('sub'), [...READ, ...WRITE]);
      add(role('streamer_role'), [...READ, ...WRITE]);
      break;
    case 'staff':
      add(everyone, [], [P.ViewChannel]);
      break;
    default:
      throw new Error(`Niveau d'accès inconnu "${def.access}" pour ${def.name}`);
  }
  return ow;
}

async function ensureRoles(guild) {
  log('\n👥 Rôles');
  // Créés dans l'ordre de la config : chaque nouveau rôle arrive en bas de la liste,
  // ce qui donne la bonne hiérarchie (le premier de la liste reste le plus haut).
  for (const def of config.roles) {
    const data = {
      name: def.name,
      color: def.color,
      hoist: !!def.hoist,
      mentionable: false, // seuls le staff et le bot peuvent mentionner les rôles
      permissions: def.admin
        ? [P.Administrator]
        : def.mod
          ? [P.KickMembers, P.BanMembers, P.ModerateMembers, P.ManageMessages, P.ManageNicknames, P.MuteMembers, P.MoveMembers, P.DeafenMembers, P.ViewAuditLog]
          : [],
    };
    const existing = findRole(guild, def.key);
    if (existing) {
      const renamed = existing.name !== def.name ? ` (renommé depuis ${existing.name})` : ' (existe déjà)';
      if (existing.editable) {
        await existing.edit({ name: def.name, color: data.color, hoist: data.hoist, permissions: data.permissions });
      } else {
        log(`  ⚠ ${existing.name} est au-dessus du rôle du bot : impossible de le modifier`);
      }
      log(`  ✔ ${def.name}${renamed}`);
    } else {
      await guild.roles.create({ ...data, reason: 'Setup serveur communautaire' });
      log(`  ＋ ${def.name}`);
    }
  }
}

async function ensureChannels(guild, botId) {
  log('\n📁 Salons');
  let catPos = 0;
  for (const catDef of config.categories) {
    let category = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === catDef.name);
    if (!category) {
      category = await guild.channels.create({ name: catDef.name, type: ChannelType.GuildCategory });
      log(`  ＋ ${catDef.name}`);
    } else {
      log(`  ✔ ${catDef.name}`);
    }
    await category.setPosition(catPos++).catch(() => {});

    let chPos = 0;
    for (const def of catDef.channels) {
      const permissionOverwrites = buildOverwrites(guild, botId, def);
      let channel = guild.channels.cache.find((c) => c.name === def.name && c.type !== ChannelType.GuildCategory);

      if (!channel) {
        const base = { name: def.name, parent: category.id, permissionOverwrites, topic: def.topic, userLimit: def.userLimit };
        if (def.type === 'voice') {
          channel = await guild.channels.create({ ...base, type: ChannelType.GuildVoice, topic: undefined });
        } else if (def.type === 'announcement') {
          // Les salons d'annonces exigent que la "Communauté" soit activée sur le serveur.
          channel = await guild.channels
            .create({ ...base, type: ChannelType.GuildAnnouncement })
            .catch(() => guild.channels.create({ ...base, type: ChannelType.GuildText }));
        } else {
          channel = await guild.channels.create({ ...base, type: ChannelType.GuildText });
        }
        log(`     ＋ ${def.name}`);
      } else {
        if (channel.parentId !== category.id) await channel.setParent(category.id, { lockPermissions: false });
        await channel.permissionOverwrites.set(permissionOverwrites);
        if (def.topic && 'setTopic' in channel && channel.topic !== def.topic) await channel.setTopic(def.topic);
        log(`     ✔ ${def.name} (permissions mises à jour)`);
      }
      await channel.setPosition(chPos++).catch(() => {});
    }
  }
}

/** Publie un message du bot, ou modifie celui déjà publié (même titre d'embed). */
async function upsertBotMessage(channel, payload) {
  const title = payload.embeds[0].data?.title ?? payload.embeds[0].title;
  const messages = await channel.messages.fetch({ limit: 50 });
  const existing = messages.find((m) => m.author.id === channel.client.user.id && m.embeds[0]?.title === title);
  if (existing) {
    await existing.edit(payload);
    log(`  ✎ Message mis à jour dans #${channel.name}`);
  } else {
    await channel.send(payload);
    log(`  ＋ Message publié dans #${channel.name}`);
  }
}

async function postMessages(guild) {
  log('\n💬 Messages du bot');
  const byKey = (key) => {
    for (const cat of config.categories) {
      const def = cat.channels.find((c) => c.key === key);
      if (def) return guild.channels.cache.find((c) => c.name === def.name);
    }
  };

  const rules = byKey('rules');
  if (rules) await upsertBotMessage(rules, rulesPayload(guild));

  const roles = byKey('roles');
  if (roles) await upsertBotMessage(roles, rolesPayload());

  const welcome = byKey('welcome');
  if (welcome) {
    await upsertBotMessage(welcome, {
      embeds: [
        {
          color: BRAND_COLOR,
          title: `👋 Bienvenue sur ${guild.name} !`,
          description: [
            'Ici, c\'est le QG de la communauté du stream 💜',
            '',
            `1️⃣ Lis et accepte le règlement dans ${rules ?? '#règlement'}`,
            `2️⃣ Choisis tes rôles et notifications dans ${roles ?? '#rôles'}`,
            `3️⃣ Viens dire bonjour dans ${byKey('general') ?? '#discussion'} !`,
            '',
            process.env.TWITCH_CHANNEL ? `📺 La chaîne : https://twitch.tv/${process.env.TWITCH_CHANNEL}` : '',
          ].join('\n'),
        },
      ],
    });
  }
}

async function configureGuild(guild) {
  log('\n⚙️  Paramètres du serveur');
  const afkDef = config.categories.flatMap((c) => c.channels).find((c) => c.key === config.afkChannel);
  const afk = afkDef && guild.channels.cache.find((c) => c.name === afkDef.name);
  const welcomeDef = config.categories.flatMap((c) => c.channels).find((c) => c.key === 'welcome');
  const welcome = welcomeDef && guild.channels.cache.find((c) => c.name === welcomeDef.name);

  await guild.edit({
    ...(config.serverName ? { name: config.serverName } : {}),
    verificationLevel: GuildVerificationLevel.Low, // e-mail vérifié obligatoire
    explicitContentFilter: GuildExplicitContentFilter.AllMembers,
    defaultMessageNotifications: GuildDefaultMessageNotifications.OnlyMentions,
    ...(afk ? { afkChannel: afk.id, afkTimeout: 900 } : {}),
    ...(welcome ? { systemChannel: welcome.id } : {}),
    // Le bot envoie son propre message de bienvenue : on coupe celui de Discord
    systemChannelFlags: [GuildSystemChannelFlags.SuppressJoinNotifications],
  });
  log('  ✔ Vérification e-mail, filtre de contenu, notifications @mentions uniquement, salon AFK');
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.roles.fetch();
    await guild.channels.fetch();
    log(`🚀 Configuration de "${guild.name}" avec ${client.user.tag}`);

    await ensureRoles(guild);
    await guild.roles.fetch();
    await ensureChannels(guild, client.user.id);
    await guild.channels.fetch();
    await postMessages(guild);
    await configureGuild(guild);

    log('\n✅ Serveur prêt ! Lance maintenant le bot avec `npm start`.');
    log('ℹ️  Pense à placer le rôle du bot tout en haut de la liste des rôles (Paramètres du serveur > Rôles).');
  } catch (err) {
    console.error('\n❌ Erreur pendant la configuration :', err.message);
    if (err.code === 50013) console.error('   → Le bot manque de permissions. Invite-le avec la permission Administrateur (voir README).');
    process.exitCode = 1;
  } finally {
    client.destroy();
  }
});

client.login(DISCORD_TOKEN);
