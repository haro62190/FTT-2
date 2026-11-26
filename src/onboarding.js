/**
 * 🧭 Accueil personnalisé : après le règlement (ou avec /accueil), le membre choisit ses centres d'intérêt
 * et ses jeux. Le bot lui présente alors seulement les salons et fonctionnalités qui le concernent,
 * lui donne les rôles adaptés (🕹️ Joueur, 🎨 Artiste, 🔴 Notif Live…) et remplit son profil joueur.
 * Rien n'est envoyé publiquement : tout se passe en message éphémère (visible par lui seul).
 */
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, SlashCommandBuilder, StringSelectMenuBuilder } = require('discord.js');
const { BRAND_COLOR, findChannel, findRole } = require('./shared');
const { db, save } = require('./store');

/** Centres d'intérêt → rôle donné, salons et commandes présentés */
const INTERESTS = [
  { key: 'lives', label: 'Les lives Twitch', emoji: '🔴', role: 'notif_live', channels: ['live', 'schedule'], tips: ['Tu seras mentionné au début de chaque live.', '`/streams` : l\'historique des lives.'] },
  { key: 'play', label: 'Jouer avec la commu', emoji: '🎮', role: 'gamer', channels: ['lfg', 'gaming'], tips: ['`/joueur profil` : ton profil joueur (plateformes, pseudos).', '`/recherche jeu:` : trouve des coéquipiers maintenant.', 'Rejoins « ➕ Créer ton vocal » pour avoir ton propre salon.'] },
  { key: 'events', label: 'Tournois & soirées gaming', emoji: '🏆', role: 'notif_news', channels: ['tournaments', 'nights'], tips: ['`/calendrier` : tout ce qui arrive.', 'Réserve ta place avec le bouton de chaque soirée.'] },
  { key: 'games', label: 'Quiz, pronostics & ryō', emoji: '🎲', role: null, channels: ['live_games', 'bot_commands'], tips: ['Gagne des 両 ryō en jouant pendant les lives.', '`/daily` chaque jour, `/boutique` pour les dépenser, `/quetes` pour tes quêtes.'] },
  { key: 'clips', label: 'Clips, TikTok & YouTube', emoji: '🎬', role: null, channels: ['clips', 'tiktok', 'youtube'], tips: ['Prends 📱 Notif TikTok ou ▶️ Notif YouTube dans le salon des rôles pour être prévenu.'] },
  { key: 'music', label: 'Musique en vocal', emoji: '🎵', role: null, channels: ['music', 'voice_general'], tips: ['`/play musique:` dans un vocal pour lancer un morceau.'] },
  { key: 'art', label: 'Création & fan-art', emoji: '🎨', role: 'artist', channels: ['fanart', 'media'], tips: ['Les plus belles créations peuvent finir dans le 🏯 Hall of Fame (⚔️ ×5).'] },
  { key: 'chat', label: 'Discuter & se faire des potes', emoji: '💬', role: null, channels: ['general', 'memes'], tips: ['`/rang` : ton niveau, tu gagnes de l\'XP en discutant et en vocal.'] },
];

/** Jeux proposés (réglables sur le site) */
const DEFAULT_GAMES = ['Call of Duty / Warzone', 'Fortnite', 'Minecraft', 'Valorant', 'League of Legends', 'Rocket League', 'EA FC', 'Apex Legends', 'GTA V / RP', 'Rainbow Six Siege', 'Overwatch 2', 'Counter-Strike 2'];
const gameList = () => {
  const custom = require('./settings').get('onboarding.games');
  return (Array.isArray(custom) && custom.length ? custom : DEFAULT_GAMES).slice(0, 25);
};

const store = () => (db.onboarding ??= {});
const choices = (id) => (store()[id] ??= { interests: [], games: [] });
const ephemeral = (content, extra = {}) => ({ content, flags: MessageFlags.Ephemeral, ...extra });

function picker(userId) {
  const c = choices(userId);
  const games = gameList();
  return {
    content: '🧭 **Personnalise ton arrivée** — dis-moi ce qui t\'intéresse et à quoi tu joues, je te montre seulement ce qui te concerne.',
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('ob:interests')
          .setPlaceholder('Ce qui t\'intéresse (plusieurs choix)')
          .setMinValues(0)
          .setMaxValues(INTERESTS.length)
          .addOptions(INTERESTS.map((x) => ({ label: x.label, value: x.key, emoji: x.emoji, default: c.interests.includes(x.key) }))),
      ),
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('ob:games')
          .setPlaceholder('Tes jeux (plusieurs choix, facultatif)')
          .setMinValues(0)
          .setMaxValues(games.length)
          .addOptions(games.map((g, k) => ({ label: g.slice(0, 100), value: String(k), default: c.games.includes(g) }))),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ob:done').setLabel('Voir mon guide').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('ob:skip').setLabel('Plus tard').setStyle(ButtonStyle.Secondary),
      ),
    ],
    flags: MessageFlags.Ephemeral,
  };
}

/** Le guide sur mesure (embeds) pour ces choix. */
function guide(guild, c) {
  const ch = (key) => findChannel(guild, key);
  const picked = INTERESTS.filter((x) => c.interests.includes(x.key));
  const list = picked.length ? picked : INTERESTS.filter((x) => ['chat', 'lives', 'games'].includes(x.key)); // par défaut : l'essentiel
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🧭 Ton guide du dojo')
    .setDescription(picked.length ? 'Voici ce qui est fait pour toi :' : 'Tu n\'as rien choisi, voici l\'essentiel pour bien commencer :');
  for (const x of list) {
    const chans = x.channels.map(ch).filter(Boolean).join(' · ');
    embed.addFields({ name: `${x.emoji} ${x.label}`, value: [chans, ...x.tips].filter(Boolean).join('\n').slice(0, 1024) });
  }
  if (c.games.length) {
    const gaming = require('./gaming');
    const lines = c.games.map((g) => {
      const n = gaming.findPlayers({ game: g }).length;
      return `• **${g}** — ${n > 1 ? `${n - 1} autre(s) ronin(s) y jouent` : 'sois le premier à lancer une partie !'} → \`/recherche jeu:${g.split(' / ')[0]}\``;
    });
    embed.addFields({ name: '🕹️ Tes jeux', value: lines.join('\n').slice(0, 1024) });
  }
  const roles = findChannel(guild, 'roles');
  embed.setFooter({ text: 'Tu peux tout changer quand tu veux avec /accueil' });
  return { embeds: [embed], content: roles ? `Notifications et autres rôles : ${roles}` : '', components: [] };
}

/** Applique les choix : rôles d'intérêt + jeux dans le profil joueur. Renvoie les rôles ajoutés. */
async function apply(member, c) {
  const added = [];
  const wanted = new Set(INTERESTS.filter((x) => c.interests.includes(x.key) && x.role).map((x) => x.role));
  if (c.games.length) wanted.add('gamer');
  for (const key of wanted) {
    const role = findRole(member.guild, key);
    if (role && role.editable && !member.roles.cache.has(role.id)) {
      await member.roles.add(role, 'Accueil personnalisé').then(() => added.push(role.name)).catch(() => {});
    }
  }
  if (c.games.length) {
    const p = ((db.players ??= {})[member.id] ??= { platforms: [], availability: [], games: [], tags: {} });
    for (const g of c.games) if (!p.games.some((x) => x.toLowerCase() === g.toLowerCase())) p.games.push(g);
    p.games = p.games.slice(0, 15);
  }
  c.doneAt = Date.now();
  save();
  require('./feed').member(member.id, '🧭', `Accueil personnalisé : ${c.interests.length} intérêt(s), ${c.games.length} jeu(x)`);
  return added;
}

/** Bouton à ajouter au message « Bienvenue parmi les Ronins ». */
const startButton = () => new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ob:start').setLabel('Personnaliser mon arrivée').setEmoji('🧭').setStyle(ButtonStyle.Primary));

async function handleInteraction(i) {
  const id = i.customId ?? '';
  if (!id.startsWith('ob:')) return false;
  const c = choices(i.user.id);
  if (id === 'ob:start') {
    await i.reply(picker(i.user.id));
    return true;
  }
  if (id === 'ob:interests' && i.isStringSelectMenu()) {
    c.interests = i.values.filter((v) => INTERESTS.some((x) => x.key === v));
    save();
    await i.deferUpdate();
    return true;
  }
  if (id === 'ob:games' && i.isStringSelectMenu()) {
    const games = gameList();
    c.games = i.values.map((v) => games[Number(v)]).filter(Boolean);
    save();
    await i.deferUpdate();
    return true;
  }
  if (id === 'ob:skip') {
    await i.update({ content: '👍 Pas de souci : tape `/accueil` quand tu veux pour personnaliser ton arrivée.', components: [] });
    return true;
  }
  if (id === 'ob:done') {
    const member = await i.guild.members.fetch(i.user.id);
    const added = await apply(member, c);
    const g = guide(i.guild, c);
    if (added.length) g.content = `🎖️ Rôles ajoutés : **${added.join('**, **')}**\n${g.content}`.trim();
    await i.update(g);
    return true;
  }
  return false;
}

const commands = [
  {
    category: '🎉 Général',
    data: new SlashCommandBuilder().setName('accueil').setDescription('Personnaliser ton arrivée : tes intérêts et tes jeux, et le guide qui va avec'),
    run: (i) => i.reply(picker(i.user.id)),
  },
];

module.exports = { INTERESTS, DEFAULT_GAMES, gameList, picker, guide, apply, startButton, handleInteraction, commands, ephemeral };
