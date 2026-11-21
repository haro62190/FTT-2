/**
 * Bot du serveur : accueil, règlement, rôles en libre-service, alertes de live Twitch,
 * commandes /, niveaux (XP) et logs de modération.
 * Usage : npm start
 */
require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, Events, MessageFlags } = require('discord.js');
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
const POLL_MS = Math.max(30, Number(process.env.TWITCH_POLL_SECONDS) || 60) * 1000;

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
  ],
  partials: [Partials.Message, Partials.GuildMember],
});

const twitch =
  TWITCH_CHANNEL && TWITCH_CLIENT_ID && TWITCH_CLIENT_SECRET ? new TwitchClient(TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET) : null;

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
  if (security.lockdown.active) return; // pas de bienvenue pendant un raid
  if (member.guild.id !== GUILD_ID) return;
  const welcome = findChannel(member.guild, 'welcome');
  const rules = findChannel(member.guild, 'rules');
  if (welcome && settings.get('welcome.enabled')) {
    const text = fillTemplate(settings.get('welcome.message'), member, rules);
    await welcome
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(BRAND_COLOR)
            .setDescription(text)
            .setThumbnail(member.user.displayAvatarURL())
            .setFooter({ text: `Membre n°${member.guild.memberCount}` }),
        ],
        allowedMentions: { users: [member.id] },
      })
      .catch(console.error);
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
  if (!settings.get('levels.enabled')) return;
  const newLevel = levels.onMessage(message.author.id);
  if (newLevel !== null) {
    const rewards = message.member ? await levels.applyRewards(message.member, newLevel) : [];
    if (settings.get('levels.announce') || rewards.length) {
      await message.channel
        .send({
          content:
            `⚔️ GG ${message.author}, tu passes au **niveau ${newLevel}** !` +
            (rewards.length ? `\n🎖️ Nouveau grade : ${rewards.map((r) => `**${r.name}**`).join(', ')}` : ''),
          allowedMentions: { users: [message.author.id] },
        })
        .catch(() => {});
    }
  }
});

// ───────────────────────── Vocaux temporaires ─────────────────────────

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  if (newState.guild.id !== GUILD_ID) return;
  tempVoice.onVoiceStateUpdate(oldState, newState).catch((err) => console.error('Vocal temporaire :', err.message));
  music.onVoiceStateUpdate(oldState, newState);
});

// ───────────────────────── Boutons ─────────────────────────

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.inGuild() || interaction.guildId !== GUILD_ID) return;
  if (interaction.isChatInputCommand()) return commands.handle(interaction, ctx);
  if (interaction.isButton() || interaction.isUserSelectMenu() || interaction.isModalSubmit()) {
    const id = interaction.customId ?? '';
    try {
      if (await tempVoice.handleInteraction(interaction)) return;
      if (await tickets.handleInteraction(interaction)) return;
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

    if (interaction.customId === ACCEPT_RULES_ID) {
      const role = findRole(interaction.guild, 'member');
      if (!role) return reply('⚠️ Le rôle Membre est introuvable, préviens un modérateur.');
      if (member.roles.cache.has(role.id)) return reply('Tu as déjà accepté le règlement, bon séjour ! 💜');
      await member.roles.add(role, 'Règlement accepté');
      const rolesChannel = findChannel(interaction.guild, 'roles');
      return reply(`✅ Merci ! Tu as maintenant accès au serveur.${rolesChannel ? ` Choisis tes notifications dans ${rolesChannel}.` : ''}`);
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

// ───────────────────────── Alertes de live Twitch ─────────────────────────

const liveState = { streamId: null, message: null };

async function findExistingLiveMessage(channel, streamId) {
  const messages = await channel.messages.fetch({ limit: 20 });
  return messages.find((m) => m.author.id === client.user.id && m.embeds[0]?.footer?.text?.includes(streamId)) ?? null;
}

async function checkTwitch(twitch, guild) {
  const channel = findChannel(guild, 'live');
  if (!channel || !settings.get('notifications.twitch')) return;

  const stream = await twitch.getLiveStream(TWITCH_CHANNEL);

  if (stream && stream.id !== liveState.streamId) {
    // Nouveau live (ou redémarrage du bot pendant un live déjà annoncé)
    const existing = await findExistingLiveMessage(channel, stream.id);
    if (existing) {
      liveState.streamId = stream.id;
      liveState.message = existing;
      return;
    }

    const user = await twitch.getUser(TWITCH_CHANNEL);
    const url = `https://twitch.tv/${stream.user_login}`;
    const thumb = stream.thumbnail_url.replace('{width}', '1280').replace('{height}', '720') + `?t=${Date.now()}`;
    const notifRole = findRole(guild, 'notif_live');

    liveState.message = await channel.send({
      content: `${notifRole ?? ''} 🔴 **${stream.user_name}** est en live ! ${url}`.trim(),
      allowedMentions: { roles: notifRole ? [notifRole.id] : [] },
      embeds: [
        new EmbedBuilder()
          .setColor(BRAND_COLOR)
          .setAuthor({ name: stream.user_name, iconURL: user?.profile_image_url, url })
          .setTitle(stream.title || 'Live en cours')
          .setURL(url)
          .addFields({ name: '🎮 Jeu', value: stream.game_name || 'Non défini', inline: true })
          .setImage(thumb)
          .setFooter({ text: `Stream ID ${stream.id}` })
          .setTimestamp(new Date(stream.started_at)),
      ],
    });
    liveState.streamId = stream.id; // seulement une fois l'annonce envoyée : sinon on réessaie au prochain passage
    console.log(`🔴 Live détecté : ${stream.title}`);
  } else if (!stream && liveState.streamId) {
    // Fin du live : on met à jour l'annonce
    if (liveState.message) {
      const old = liveState.message.embeds[0];
      await liveState.message
        .edit({
          content: '⚫ Le live est terminé, merci d\'être passé·e ! À la prochaine 💜',
          embeds: [EmbedBuilder.from(old).setColor(0x2c2f33).setImage(null)],
          allowedMentions: { parse: [] },
        })
        .catch(console.error);
    }
    console.log('⚫ Fin du live');
    liveState.streamId = null;
    liveState.message = null;
  }
}

function startTwitchWatcher(guild) {
  if (!twitch) {
    console.log('ℹ️  Alertes Twitch désactivées (TWITCH_CHANNEL / TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET manquants).');
    return;
  }
  const tick = () => checkTwitch(twitch, guild).catch((err) => console.error('Twitch :', err.message));
  tick();
  setInterval(tick, POLL_MS);
  console.log(`📺 Surveillance de twitch.tv/${TWITCH_CHANNEL} toutes les ${POLL_MS / 1000}s`);
}

logs.register(client, GUILD_ID);
security.register(client, GUILD_ID);

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
  client.user.setActivity('Les Ronins de haro62190 ⚔️', { type: 3 /* Watching */ });
  await tempVoice.cleanup(guild).catch((err) => console.error('Nettoyage des vocaux temporaires :', err.message));
  await commands.register(guild).catch((err) => console.error('❌ Enregistrement des commandes / :', err.message));
  startTwitchWatcher(guild);
  startTikTokWatcher(guild);
  require('./stats').start(guild, twitch).catch((e) => console.error('Stats :', e.message));

  require('./dashboard').start(client, GUILD_ID);
  await security.resumeLockdown(guild).catch((e) => console.error('Verrouillage :', e.message));

  // Sauvegarde automatique quotidienne du serveur
  const backup = require('./backup');
  const auto = () => guild.channels.fetch().then(() => backup.autoBackup(guild)).catch((e) => console.error('Sauvegarde auto :', e.message));
  auto();
  setInterval(auto, 6 * 3600_000);
});

client.login(DISCORD_TOKEN);
