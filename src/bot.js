/**
 * Bot du serveur : accueil, règlement, rôles en libre-service, alertes de live Twitch,
 * commandes /, niveaux (XP) et logs de modération.
 * Usage : npm start
 */
require('dotenv').config();
require('./logger').install();
const { AttachmentBuilder, Client, GatewayIntentBits, Partials, EmbedBuilder, Events, MessageFlags } = require('discord.js');
const { TwitchClient } = require('./twitch');
const commands = require('./commands');
const levels = require('./levels');
const tempVoice = require('./tempvoice');
const music = require('./music');
const { startTikTokWatcher } = require('./tiktok');
const logs = require('./logs');
const security = require('./security');
const settings = require('./settings');
const tickets = require('./tickets');
const economy = require('./economy');
const quests = require('./quests');
const giveaway = require('./giveaway');
const community = require('./community');
const health = require('./health');
const custom = require('./custom');
const {
  config,
  BRAND_COLOR,
  ACCEPT_RULES_ID,
  ROLE_BUTTON_PREFIX,
  roleDef,
  findRole,
  findChannel,
} = require('./shared');

const { DISCORD_TOKEN, GUILD_ID, TWITCH_CHANNEL, TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET } = process.env;

if (!DISCORD_TOKEN || !GUILD_ID) {
  console.error('❌ DISCORD_TOKEN et GUILD_ID doivent être définis dans .env');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // intent privilégié : arrivées / départs
    GatewayIntentBits.GuildVoiceStates, // salons vocaux temporaires
    GatewayIntentBits.GuildModeration, // journal d'audit (logs, anti-nuke)
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // intent privilégié : contenu des messages supprimés dans les logs
    GatewayIntentBits.GuildMessageReactions, // Hall of Fame
  ],
  partials: [Partials.Message, Partials.GuildMember, Partials.Reaction, Partials.User],
  // Sécurité : par défaut, aucun @everyone / @here / rôle n'est mentionné (seulement les membres).
  // Les messages qui doivent notifier un rôle (lives, annonces) le précisent eux-mêmes.
  allowedMentions: { parse: ['users'], repliedUser: false },
});

health.installErrorHandlers(client);

const twitch =
  TWITCH_CLIENT_ID && TWITCH_CLIENT_SECRET ? new TwitchClient(TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET) : null;

/** Contexte passé aux commandes / */
const ctx = {
  twitch,
  modLog: (interaction, title, description) =>
    sendLog(
      interaction.guild,
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(title)
        .setDescription(description)
        .setFooter({ text: `Par ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
        .setTimestamp(),
    ),
};

async function sendLog(guild, embed) {
  const channel = findChannel(guild, 'mod_logs');
  if (channel) await channel.send({ embeds: [embed] }).catch(console.error);
}

// ───────────────────────── Accueil & logs ─────────────────────────

/** Variables utilisables dans les messages : {user} {username} {server} {count} {rules} */
function fillTemplate(text, member, rules) {
  return String(text ?? '')
    .replaceAll('{user}', `${member}`)
    .replaceAll('{username}', member.user?.username ?? member.displayName ?? 'Quelqu\'un')
    .replaceAll('{server}', member.guild.name)
    .replaceAll('{count}', String(member.guild.memberCount))
    .replaceAll('{rules}', rules ? `${rules}` : 'règlement');
}

client.on(Events.GuildMemberAdd, async (member) => {
  if (isRescue(member.guild.id)) return require('./rescue').onMemberJoin(member).catch(() => {});
  if (member.guild.id === GUILD_ID) {
    require('./history').bump('joins');
    require('./challenges').progress('members', member.id);
    require('./feed').member(member.id, '🚪', 'Arrivée sur le serveur');
    require('./social').onJoin(member).catch(() => {});
  }
  if (security.lockdown.active) return; // pas de bienvenue pendant un raid
  if (member.guild.id !== GUILD_ID) return;
  const welcome = findChannel(member.guild, 'welcome');
  const rules = findChannel(member.guild, 'rules');
  if (welcome && settings.get('welcome.enabled')) {
    const text = fillTemplate(settings.get('welcome.message'), member, rules);
    const embed = new EmbedBuilder().setColor(BRAND_COLOR).setDescription(text).setFooter({ text: `Membre n°${member.guild.memberCount}` });
    let files = [];
    const card = require('./welcomecard');
    if (settings.get('welcome.banner') !== false && card.available()) {
      try {
        const png = await card.renderWelcome({ username: member.displayName ?? member.user.username, avatarUrl: member.user.displayAvatarURL({ extension: 'png', size: 256 }), count: member.guild.memberCount });
        files = [new AttachmentBuilder(png, { name: 'bienvenue.png' })];
        embed.setImage('attachment://bienvenue.png');
      } catch (err) {
        console.error('Bannière de bienvenue :', err.message);
      }
    }
    if (!files.length) embed.setThumbnail(member.user.displayAvatarURL());
    await welcome.send({ embeds: [embed], files, allowedMentions: { users: [member.id] } }).catch(console.error);
  }
  await sendLog(
    member.guild,
    new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('📥 Arrivée')
      .setDescription(`${member} (${member.user.tag})\nCompte créé <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`)
      .setTimestamp(),
  );
});

client.on(Events.GuildMemberRemove, async (member) => {
  if (member.guild.id === GUILD_ID) require('./history').bump('leaves');
  if (member.guild.id !== GUILD_ID) return;
  const channel = findChannel(member.guild, 'welcome');
  if (channel && settings.get('goodbye.enabled') && !security.lockdown.active) {
    await channel
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x3a3a3a)
            .setDescription(fillTemplate(settings.get('goodbye.message'), member))
            .setThumbnail(member.user?.displayAvatarURL() ?? null)
            .setFooter({ text: `Nous sommes maintenant ${member.guild.memberCount}` }),
        ],
        allowedMentions: { parse: [] },
      })
      .catch(() => {});
  }
  await sendLog(
    member.guild,
    new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('📤 Départ')
      .setDescription(`${member.user?.tag ?? member.id}`)
      .setTimestamp(),
  );
});

client.on(Events.MessageDelete, async (message) => {
  if (!message.guild || message.guild.id !== GUILD_ID || message.author?.bot) return;
  const logs = findChannel(message.guild, 'mod_logs');
  if (!logs || message.channelId === logs.id) return;
  await sendLog(
    message.guild,
    new EmbedBuilder()
      .setColor(0xe67e22)
      .setTitle('🗑️ Message supprimé')
      .setDescription(
        `**Auteur :** ${message.author ?? 'inconnu'}\n**Salon :** <#${message.channelId}>\n\n` +
          (message.partial ? '_Contenu indisponible (message trop ancien)_' : (message.content || '_(pas de texte)_').slice(0, 3500)),
      )
      .setTimestamp(),
  );
});

// ───────────────────────── Niveaux (XP) ─────────────────────────

client.on(Events.MessageCreate, async (message) => {
  if (!message.guild || message.guild.id !== GUILD_ID || message.author.bot) return;
  require('./history').bump('messages');
  require('./insights').track(message.channelId);
  const counted = levels.counts({ content: message.content, attachments: message.attachments.size, channelId: message.channelId, guild: message.guild });
  if (!counted) return; // message trop court ou salon sans XP : ni XP, ni ryō, ni quête
  economy.onMessage(message.author.id, message.member);
  quests.progress(message.author.id, 'messages');
  require('./challenges').progress('messages', message.author.id);
  require('./streams').onMessage(message.author.id);
  if (!settings.get('levels.enabled')) return;
  const newLevel = levels.onMessage(message.author.id, message.member);
  if (newLevel !== null && message.member) {
    const rewards = await levels.applyRewards(message.member, newLevel);
    if (settings.get('levels.announce') || rewards.length) await require('./levelcard').announce(message.channel, message.member, newLevel, rewards);
  }
});

// ───────────────────────── Vocaux temporaires ─────────────────────────

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  if (newState.guild.id !== GUILD_ID) return;
  tempVoice.onVoiceStateUpdate(oldState, newState).catch((err) => console.error('Vocal temporaire :', err.message));
  music.onVoiceStateUpdate(oldState, newState);
  require('./gaming').onVoiceStateUpdate(oldState).catch(() => {});
  if (newState.channelId && newState.channelId !== oldState.channelId) require('./insights').track(newState.channelId, false);
});

// ───────────────────────── Boutons ─────────────────────────

// Modules avec boutons / menus / formulaires (chacun reconnaît ses propres identifiants)
const INTERACTIVE = ['./gaming', './tournaments', './nights', './livegames', './applications', './reports', './polls', './onboarding'];

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.inGuild()) return;
  // Sur le serveur de secours, seule /secours est disponible
  if (interaction.guildId !== GUILD_ID) {
    if (isRescue(interaction.guildId) && interaction.isChatInputCommand() && interaction.commandName === 'secours') return commands.handle(interaction, ctx);
    return;
  }
  if (interaction.isAutocomplete()) return commands.autocomplete(interaction);
  if (interaction.isChatInputCommand()) return commands.handle(interaction, ctx);
  if (interaction.isButton() || interaction.isUserSelectMenu() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
    const id = interaction.customId ?? '';
    try {
      if (await tempVoice.handleInteraction(interaction)) return;
      if (await tickets.handleInteraction(interaction)) return;
      if (await giveaway.handleInteraction(interaction)) return;
      if (await community.handleInteraction(interaction)) return;
      if (await custom.handleInteraction(interaction)) return;
      for (const mod of INTERACTIVE) if (await require(mod).handleInteraction(interaction)) return;
    } catch (err) {
      const module = id.startsWith('ticket:') ? 'Ticket' : id.startsWith('tv:') ? 'Vocal temporaire' : 'Interaction';
      console.error(`${module} :`, err);
      const msg = { content: '❌ Action impossible.', flags: MessageFlags.Ephemeral };
      if (interaction.replied || interaction.deferred) await interaction.followUp(msg).catch(() => {});
      else await interaction.reply(msg).catch(() => {});
      return;
    }
  }
  if (!interaction.isButton()) return;
  const reply = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

  try {
    const member = await interaction.guild.members.fetch(interaction.user.id);

    // Donne le rôle ⚔️ Ronin (après le test anti-bot s'il est activé)
    const grantMember = async (i) => {
      const role = findRole(i.guild, 'member');
      if (!role) return i.reply({ content: '⚠️ Le rôle Membre est introuvable, préviens un modérateur.', flags: MessageFlags.Ephemeral });
      await member.roles.add(role, 'Règlement accepté');
      const rolesChannel = findChannel(i.guild, 'roles');
      const text = `✅ Bienvenue parmi les Ronins ! Tu as maintenant accès au serveur.${rolesChannel ? ` Choisis tes notifications dans ${rolesChannel}.` : ''}`;
      const components = [require('./onboarding').startButton()]; // 🧭 accueil personnalisé
      const full = `${text}\n🧭 Dis-moi ce que tu aimes et je te montre ce qui est fait pour toi :`;
      return i.isButton() && i.customId.startsWith('verify:') ? i.update({ content: full, components }) : i.reply({ content: full, components, flags: MessageFlags.Ephemeral });
    };

    if (interaction.customId.startsWith('verify:')) return community.onVerifyButton(interaction, grantMember);

    if (interaction.customId === ACCEPT_RULES_ID) {
      if (require('./quarantine').isQuarantined(interaction.user.id)) return reply('⛓️ Tu es en quarantaine : un membre du staff va te répondre dans 🏚️┃cachot.');
      const role = findRole(interaction.guild, 'member');
      if (role && member.roles.cache.has(role.id)) return reply('Tu as déjà accepté le règlement, bon séjour ! ⚔️');
      if (await community.startVerification(interaction)) return;
      return grantMember(interaction);
    }

    if (interaction.customId.startsWith(ROLE_BUTTON_PREFIX)) {
      const key = interaction.customId.slice(ROLE_BUTTON_PREFIX.length);
      const def = roleDef(key);
      const role = findRole(interaction.guild, key);
      if (!def?.selfAssign || !role) return reply('⚠️ Ce rôle n\'est plus disponible.');
      if (member.roles.cache.has(role.id)) {
        await member.roles.remove(role, 'Rôle retiré en libre-service');
        return reply(`➖ Rôle **${role.name}** retiré.`);
      }
      await member.roles.add(role, 'Rôle ajouté en libre-service');
      return reply(`➕ Rôle **${role.name}** ajouté !`);
    }
  } catch (err) {
    console.error('Erreur bouton :', err);
    if (!interaction.replied) await reply('❌ Impossible de modifier tes rôles (le rôle du bot doit être au-dessus des autres).').catch(() => {});
  }
});

// Alertes de live, récap, clips et planning Twitch : src/twitchlive.js

logs.register(client, GUILD_ID);
security.register(client, GUILD_ID);
community.register(client, GUILD_ID);
custom.register(client, GUILD_ID);

/** Kensei est réservé aux Ronins : il quitte tout autre serveur et prévient le staff. */
async function leaveForeignGuild(other) {
  console.warn(`🚫 Ajouté sur un autre serveur « ${other.name} » (${other.id}) : je le quitte.`);
  await other.leave().catch(() => {});
  const home = client.guilds.cache.get(GUILD_ID);
  const channel = home && (findChannel(home, 'security_alerts') ?? findChannel(home, 'mod_logs'));
  await channel
    ?.send(`🚫 Quelqu'un a ajouté le bot sur un autre serveur (**${other.name}**, ${other.memberCount} membres, propriétaire <@${other.ownerId}>). Je l'ai quitté automatiquement. Pense à décocher « Public Bot » dans le portail développeur.`)
    .catch(() => {});
}
const isRescue = (id) => id === require('./rescue').rescueGuildId();
client.on(Events.GuildCreate, (g) => {
  if (g.id === GUILD_ID) return;
  if (isRescue(g.id)) return require('./rescue').command && g.commands.set([require('./rescue').command.data.toJSON()]).catch(() => {});
  leaveForeignGuild(g);
});

// ───────────────────────── Démarrage ─────────────────────────

client.once(Events.ClientReady, async () => {
  const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
  if (!guild) {
    console.error('❌ Le bot n\'est pas sur le serveur GUILD_ID. Invite-le d\'abord (voir README).');
    process.exit(1);
  }
  await guild.channels.fetch();
  await guild.roles.fetch();
  console.log(`✅ Connecté en tant que ${client.user.tag} sur "${guild.name}"`);
  // Bot privé : il quitte tout autre serveur où il aurait été ajouté
  for (const other of client.guilds.cache.values()) {
    if (other.id === GUILD_ID) continue;
    // Serveur de secours : le bot y reste, avec seulement la commande /secours
    if (isRescue(other.id)) await other.commands.set([require('./rescue').command.data.toJSON()]).catch(() => {});
    else await leaveForeignGuild(other);
  }
  client.user.setActivity('Les Ronins de haro62190 ⚔️', { type: 3 /* Watching */ });
  await tempVoice.cleanup(guild).catch((err) => console.error('Nettoyage des vocaux temporaires :', err.message));
  await commands.register(guild).catch((err) => console.error('❌ Enregistrement des commandes / :', err.message));
  // Guide 📖┃guide / 📘┃guide-staff : remis à jour à chaque démarrage (nouvelles commandes après une mise à jour)
  require('./guide').post(guild, () => {}).catch((err) => console.error('Guide :', err.message));
  require('./twitchlive').start(guild, twitch);
  require('./temproles').start(guild);
  require('./quarantine').start(guild);
  // Permissions du bot : il n'a plus besoin d'être Administrateur, mais il lui faut celles-ci
  const missingPerms = require('./permissions').missing(guild);
  if (missingPerms.length) {
    console.warn(`⚠️ Permissions manquantes au bot : ${missingPerms.join(', ')} (lance « npm run invite » pour le bon lien)`);
    health.alert('Permissions manquantes', `Le bot n'a pas : ${missingPerms.join(', ')}.\nCertaines fonctions ne marcheront pas. Réinvite-le avec le lien de « npm run invite » ou ajoute ces permissions à son rôle.`).catch(() => {});
  }
  await health.start(client, guild);
  require('./guardian').start(client, guild);
  require('./voicexp').start(guild);
  require('./birthdays').start(guild);
  require('./seasons').start(guild);
  require('./quests').init(guild);
  require('./nights').start(client, guild);
  require('./livegames').start(client);
  require('./polls').start(client);
  require('./social').start(guild);
  require('./challenges').start(client, guild);
  require('./insights').start(guild);
  giveaway.start(client);
  startTikTokWatcher(guild);
  require('./youtube').start(guild);
  require('./stats').start(guild, twitch).catch((e) => console.error('Stats :', e.message));

  require('./dashboard').start(client, GUILD_ID);
  await require('./admin').brandBot(client, console.log).catch(() => {});
  await security.resumeLockdown(guild).catch((e) => console.error('Verrouillage :', e.message));

  // Sauvegarde automatique quotidienne du serveur
  const backup = require('./backup');
  const auto = () => guild.channels.fetch().then(() => { backup.autoBackup(guild); require('./dbbackup').daily(); require('./rescue').daily(guild).catch((e) => console.error('Copie de secours :', e.message)); return backup.offsiteBackup(guild); }).catch((e) => console.error('Sauvegarde auto :', e.message));
  auto();
  setInterval(auto, 6 * 3600_000);
});

client.login(DISCORD_TOKEN);
