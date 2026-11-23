/**
 * Construction du serveur via l'API Discord : rôles, catégories, salons, permissions, messages.
 * Utilisé par `npm run setup` (terminal) et par les commandes /setup, /roles, /channels.
 * Ne supprime jamais rien : crée ce qui manque, renomme (formerNames) et met à jour le reste.
 */
const fs = require('fs');
const path = require('path');
const {
  ChannelType,
  PermissionFlagsBits: P,
  OverwriteType,
  GuildVerificationLevel,
  GuildExplicitContentFilter,
  GuildDefaultMessageNotifications,
  GuildSystemChannelFlags,
} = require('discord.js');
const { config, findRole, findChannel, rulesPayload, rolesPayload, BRAND_COLOR, staffRoles } = require('./shared');

const TEXT_READ = [P.ViewChannel, P.ReadMessageHistory];
const TEXT_WRITE = [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads, P.AddReactions, P.AttachFiles, P.EmbedLinks];
const VOICE_READ = [P.ViewChannel];
const VOICE_WRITE = [P.Connect, P.Speak, P.Stream, P.UseVAD];


/** Construit les permissions d'un salon selon son niveau d'accès. */
function buildOverwrites(guild, botId, def) {
  const isVoice = def.type === 'voice';
  const READ = isVoice ? VOICE_READ : TEXT_READ;
  const WRITE = isVoice ? VOICE_WRITE : TEXT_WRITE;
  const staffExtra = isVoice ? [P.MuteMembers, P.MoveMembers] : [P.ManageMessages];

  const everyone = guild.roles.everyone.id;
  const role = (key) => findRole(guild, key)?.id;
  const ow = [];
  const add = (id, allow = [], deny = [], type = OverwriteType.Role) => id && ow.push({ id, type, allow, deny });

  // Le bot voit et écrit partout (utile s'il n'a pas la permission Administrateur)
  add(botId, [...READ, ...WRITE, P.ManageMessages], [], OverwriteType.Member);
  // Le staff (tous grades) voit et écrit partout, sauf les salons réservés aux Gardiens
  const staff = staffRoles(guild).map((r) => r.id);
  const senior = staffRoles(guild, 'senior').map((r) => r.id);
  for (const id of def.access === 'staff-senior' ? senior : staff) add(id, [...READ, ...WRITE, ...staffExtra]);
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
    case 'staff-senior':
      add(everyone, [], [P.ViewChannel]);
      break;
    case 'stats':
      // Visible par tous, personne ne peut s'y connecter (le bot change juste le nom)
      add(everyone, [P.ViewChannel], [P.Connect]);
      for (const id of staff) add(id, [P.ViewChannel], [P.Connect]);
      break;
    default:
      throw new Error(`Niveau d'accès inconnu "${def.access}" pour ${def.name}`);
  }
  return ow;
}

async function ensureRoles(guild, log = console.log) {
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
        : (def.permissions ?? []).map((n) => {
            if (!(n in P)) throw new Error(`Permission inconnue « ${n} » pour le rôle ${def.name}`);
            return P[n];
          }),
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

  // Hiérarchie : on remet NOS rôles dans l'ordre de la config en échangeant leurs places entre eux.
  // Les autres rôles (intégrations, autres bots, rôles créés à la main) ne bougent jamais.
  await guild.roles.fetch();
  const ours = config.roles.map((d) => findRole(guild, d.key)).filter((r) => r?.editable);
  const slots = ours.map((r) => r.position).sort((a, b) => b - a); // places occupées, de la plus haute à la plus basse
  const moves = ours.map((r, i) => ({ role: r, position: slots[i] })).filter((m) => m.role.position !== m.position);
  if (moves.length) {
    try {
      await guild.roles.setPositions(moves.map((m) => ({ role: m.role.id, position: m.position })));
      log(`  ✔ Hiérarchie des rôles rangée (${moves.length} rôle(s) déplacé(s))`);
    } catch {
      // Plan B : un rôle à la fois, en notant ceux que Discord refuse
      const refused = [];
      for (const m of moves) await m.role.setPosition(m.position).catch(() => refused.push(m.role.name));
      if (refused.length) log(`  ⚠ Hiérarchie : Discord refuse de déplacer ${refused.join(', ')} — vérifie que le rôle du bot est tout en haut et qu'il a la permission Administrateur`);
      else log('  ✔ Hiérarchie des rôles rangée');
    }
  }
  const above = config.roles.map((d) => findRole(guild, d.key)).filter((r) => r && !r.editable);
  if (above.length) log(`  ⚠ Au-dessus du rôle du bot (non modifiables) : ${above.map((r) => r.name).join(', ')} — glisse le rôle du bot tout en haut`);
}

async function ensureChannels(guild, log = console.log) {
  const botId = guild.client.user.id;
  log('\n📁 Salons');
  let catPos = 0;
  for (const catDef of config.categories) {
    const catNames = [catDef.name, ...(catDef.formerNames ?? [])];
    let category =
      guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === catDef.name) ??
      guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && catNames.includes(c.name));
    if (category && category.name !== catDef.name) {
      log(`  ✎ ${category.name} → ${catDef.name}`);
      await category.setName(catDef.name);
    }
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
      const names = [def.name, ...(def.formerNames ?? [])];
      let channel = def.stat
        ? findChannel(guild, def.key)
        : guild.channels.cache.find((c) => c.name === def.name && c.type !== ChannelType.GuildCategory) ??
          guild.channels.cache.find((c) => names.includes(c.name) && c.type !== ChannelType.GuildCategory);
      if (channel && !def.stat && channel.name !== def.name) {
        log(`     ✎ ${channel.name} → ${def.name}`);
        await channel.setName(def.name);
      }

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
        if (def.stat) {
          const { db, save } = require('./store');
          (db.statChannels ??= {})[def.key] = channel.id;
          save();
        }
        log(`     ＋ ${def.name}`);
      } else {
        if (channel.parentId !== category.id) await channel.setParent(category.id, { lockPermissions: false });
        await channel.permissionOverwrites.set(permissionOverwrites);
        if (def.topic && 'setTopic' in channel && channel.topic !== def.topic) await channel.setTopic(def.topic);
        log(`     ✔ ${def.stat ? channel.name : def.name} (permissions mises à jour)`);
      }
      await channel.setPosition(chPos++).catch(() => {});
    }
  }
}

/** Publie un message du bot, ou modifie celui déjà publié (même titre d'embed). */
/**
 * Publie un message « fixe » du bot (règlement, rôles, tickets, accueil) ou modifie celui déjà publié.
 * L'ID est mémorisé en base : le message est retrouvé même s'il est enfoui sous des centaines d'autres.
 */
async function upsertBotMessage(channel, payload, log = console.log, key = channel.id) {
  const { db, save } = require('./store');
  const ids = (db.fixedMessages ??= {});
  let existing = ids[key] ? await channel.messages.fetch(ids[key]).catch(() => null) : null;
  if (!existing) {
    // Ancienne version sans ID mémorisé : chercher dans les messages récents
    const title = payload.embeds[0].data?.title ?? payload.embeds[0].title;
    const messages = await channel.messages.fetch({ limit: 100 });
    const mine = messages.filter((m) => m.author.id === channel.client.user.id && m.embeds[0]?.title);
    existing = mine.find((m) => m.embeds[0].title === title) ?? mine.last() ?? null;
  }
  if (existing) {
    await existing.edit(payload);
    log(`  ✎ Message mis à jour dans #${channel.name}`);
  } else {
    existing = await channel.send(payload);
    log(`  ＋ Message publié dans #${channel.name}`);
  }
  ids[key] = existing.id;
  save();
}

async function postMessages(guild, log = console.log) {
  log('\n💬 Messages du bot');
  const byKey = (key) => findChannel(guild, key);

  const rules = byKey('rules');
  if (rules) await upsertBotMessage(rules, rulesPayload(guild), log);

  const roles = byKey('roles');
  if (roles) await upsertBotMessage(roles, rolesPayload(), log);

  await require('./guide').post(guild, log);

  const tickets = byKey('tickets');
  if (tickets) await upsertBotMessage(tickets, require('./tickets').panelPayload(), log);

  const welcome = byKey('welcome');
  if (welcome) {
    await upsertBotMessage(welcome, {
      embeds: [
        {
          color: BRAND_COLOR,
          title: `🏮 ようこそ ・ Bienvenue sur ${guild.name}`,
          description: [
            'Les lanternes rouges s\'allument, le dojo t\'attend 🏮',
            '',
            `⛩️ **一** ・ Lis et accepte le règlement dans ${rules ?? '#règlement'}`,
            `🎴 **二** ・ Choisis tes rôles et notifications dans ${roles ?? '#rôles'}`,
            `🍜 **三** ・ Viens dire こんにちは dans ${byKey('general') ?? '#discussion'} !`,
            '',
            process.env.TWITCH_CHANNEL ? `📡 Le stream : https://twitch.tv/${process.env.TWITCH_CHANNEL}` : '',
          ].join('\n'),
        },
      ],
    }, log);
  }
}

async function configureGuild(guild, log = console.log) {
  log('\n⚙️  Paramètres du serveur');
  const afk = config.afkChannel && findChannel(guild, config.afkChannel);
  const welcome = findChannel(guild, 'welcome');

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

  const icon = config.serverIcon !== null && require('./shared').iconPath();
  if (icon) {
    await guild.setIcon(icon).then(() => log('  ✔ Icône du serveur')).catch((e) => log(`  ⚠ Icône : ${e.message}`));
  }
  const banner = path.join(__dirname, '..', 'assets', 'banner.png');
  if (fs.existsSync(banner) && guild.features.includes('BANNER')) {
    await guild.setBanner(banner).then(() => log('  ✔ Bannière du serveur')).catch((e) => log(`  ⚠ Bannière : ${e.message}`));
  }
}


/** Aperçu de ce que /setup va faire (pour la confirmation). */
function plan(guild) {
  const out = { rolesCreate: [], rolesRename: [], rolesUpdate: 0, chCreate: [], chRename: [], chUpdate: 0 };
  for (const def of config.roles) {
    const r = findRole(guild, def.key);
    if (!r) out.rolesCreate.push(def.name);
    else if (r.name !== def.name) out.rolesRename.push(`${r.name} → ${def.name}`);
    else out.rolesUpdate++;
  }
  const find = (def, isCat) => {
    if (def.stat) return findChannel(guild, def.key);
    const names = [def.name, ...(def.formerNames ?? [])];
    const ok = (c) => (isCat ? c.type === ChannelType.GuildCategory : c.type !== ChannelType.GuildCategory);
    return guild.channels.cache.find((c) => ok(c) && c.name === def.name) ?? guild.channels.cache.find((c) => ok(c) && names.includes(c.name));
  };
  for (const cat of config.categories) {
    for (const [def, isCat] of [[cat, true], ...cat.channels.map((d) => [d, false])]) {
      const c = find(def, isCat);
      if (!c) out.chCreate.push(def.name);
      else if (!def.stat && c.name !== def.name) out.chRename.push(`${c.name} → ${def.name}`);
      else out.chUpdate++;
    }
  }
  return out;
}

/** Tout construire, dans l'ordre. `log` reçoit chaque étape (console ou message Discord). */
async function buildAll(guild, log = console.log) {
  await guild.roles.fetch();
  await guild.channels.fetch();
  await ensureRoles(guild, log);
  await guild.roles.fetch();
  await ensureChannels(guild, log);
  await guild.channels.fetch();
  await postMessages(guild, log);
  await configureGuild(guild, log);
  await require('./automod').ensureAutoMod(guild, log);
}

module.exports = { upsertBotMessage, buildAll, plan, ensureRoles, ensureChannels, postMessages, configureGuild, buildOverwrites };
