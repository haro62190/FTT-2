/**
 * Structure du serveur Discord communautaire.
 *
 * Modifie librement ce fichier puis relance `npm run setup` :
 * le script est idempotent (il ne recrée pas ce qui existe déjà, il met à jour
 * les permissions et les messages du bot).
 *
 * `formerNames` : anciens noms d'un salon / d'une catégorie -> le setup le renomme au lieu d'en créer un nouveau.
 *
 * Niveaux d'accès des salons (`access`) :
 *   - "public-readonly"  : visible par tous (même avant d'accepter le règlement), personne n'écrit sauf le staff
 *   - "members"          : visible et ouvert aux membres (règlement accepté)
 *   - "members-readonly" : visible par les membres, seul le staff écrit
 *   - "vip"              : réservé aux VIP, abonnés Twitch, Streamers et staff
 *   - "staff"            : réservé au staff (Gardiens, Modérateurs, Sentinelles)
 *   - "staff-senior"     : réservé aux Gardiens (et administrateurs)
 *   - "quarantine"       : visible seulement par les membres en quarantaine et le staff
 *   - "stats"            : salon vocal compteur, visible par tous, personne ne peut y entrer
 */

module.exports = {
  serverName: 'Les Ronins de haro62190', // null = ne pas renommer le serveur

  // Identité du bot : nom du compte (lettres latines) et surnom affiché sur le serveur
  bot: {
    name: 'Kensei',
    nickname: '剣聖 ・ Kensei',
  },

  // Rôles, du plus haut au plus bas dans la hiérarchie.
  // `key` sert de référence dans le code, `name` est ce qui s'affiche sur Discord.
  roles: [
    // `formerNames` : anciens noms du rôle, pour le renommer au lieu d'en créer un nouveau
    // Palette Les Ronins : rouge sang, rouge néon, gris acier, noir
    { key: 'streamer', name: '👑 Chef', formerNames: ['👑 Streamer'], color: 0xff1a1a, hoist: true, admin: true },
    // Grades de modération (`staff` : senior > mod > helper). Chacun ne peut sanctionner que les grades en dessous.
    {
      key: 'senior_mod', name: '🏯 Gardien', color: 0xd10000, hoist: true, staff: 'senior',
      permissions: ['KickMembers', 'BanMembers', 'ModerateMembers', 'ManageMessages', 'ManageNicknames', 'ManageThreads', 'MuteMembers', 'MoveMembers', 'DeafenMembers', 'ViewAuditLog', 'ManageEvents'],
    },
    {
      key: 'mod', name: '🛡️ Modérateur', color: 0xb30000, hoist: true, staff: 'mod',
      permissions: ['KickMembers', 'ModerateMembers', 'ManageMessages', 'ManageNicknames', 'ManageThreads', 'MuteMembers', 'MoveMembers', 'DeafenMembers', 'ViewAuditLog'],
    },
    {
      key: 'helper', name: '🔰 Sentinelle', color: 0x8c2a2a, hoist: true, staff: 'helper',
      permissions: ['ModerateMembers', 'ManageMessages', 'MuteMembers', 'MoveMembers'],
    },
    // `allVoice` : peut voir et rejoindre TOUS les salons vocaux (y compris le vocal VIP)
    { key: 'friend', name: '🤝 Amis', color: 0xa6a6a6, hoist: true, allVoice: true },
    // Pour les streamers de la commu : accès aux salons VIP
    { key: 'streamer_role', name: '🎥 Streamer', color: 0xff4d4d, hoist: true },
    { key: 'vip', name: '🩸 VIP', formerNames: ['💎 VIP'], color: 0xe60000, hoist: true },
    { key: 'sub', name: '⭐ Abonné Twitch', color: 0xd92b2b, hoist: true },
    // Donné chaque mois au premier de la saison (/saison)
    { key: 'champion', name: '🏆 Champion du mois', color: 0xffc400, hoist: true },
    // Couleurs de pseudo achetables dans la boutique (au-dessus des grades pour que la couleur s'affiche)
    { key: 'color_sakura', name: '🌸 Sakura', color: 0xff8fb3 },
    { key: 'color_blood', name: '🩸 Sang', color: 0xb00000 },
    { key: 'color_steel', name: '⚙️ Acier', color: 0x9ea7b0 },
    { key: 'color_lantern', name: '🏮 Lanterne', color: 0xffb300 },
    { key: 'color_shadow', name: '🌑 Ombre', color: 0x2b2b2b },
    // Donné automatiquement pendant 24 h le jour de l'anniversaire
    { key: 'birthday', name: '🎂 Anniversaire', color: 0xff6fa8, hoist: true },
    // Grades gagnés avec les niveaux (`levelReward` = niveau à atteindre)
    { key: 'rank_daimyo', name: '🏯 Daimyō', color: 0xcc1414, hoist: true, levelReward: 30 },
    { key: 'rank_samurai', name: '⚔️ Samouraï', color: 0x991f1f, hoist: true, levelReward: 15 },
    { key: 'rank_ashigaru', name: '🗡️ Ashigaru', color: 0x808080, hoist: true, levelReward: 5 },
    // Rôle donné en acceptant le règlement
    { key: 'member', name: '⚔️ Ronin', formerNames: ['🎮 Membre'], color: 0x5c5c5c, hoist: false },
    // Rôles que les membres peuvent s'attribuer eux-mêmes dans #rôles
    // Donné par /quarantaine et l'anti-raid : ne voit plus que 🏚️┃cachot (rôles rendus à la sortie)
    { key: 'quarantine', name: '⛓️ Quarantaine', color: 0x3b3b3b },
    { key: 'notif_live', name: '🔴 Notif Live', color: 0x8c1a1a, selfAssign: true, emoji: '🔴', description: 'Être notifié quand le live commence' },
    { key: 'notif_tiktok', name: '📱 Notif TikTok', color: 0x8c1a1a, selfAssign: true, emoji: '📱', description: 'Être notifié de mes nouveaux TikTok' },
    { key: 'notif_news', name: '📢 Notif Annonces', color: 0x737373, selfAssign: true, emoji: '📢', description: 'Être notifié des annonces et événements' },
    { key: 'gamer', name: '🕹️ Joueur', color: 0x737373, selfAssign: true, emoji: '🕹️', description: 'Jouer avec la commu' },
    { key: 'artist', name: '🎨 Artiste', color: 0x737373, selfAssign: true, emoji: '🎨', description: 'Partager tes créations' },
  ],

  // Catégories et salons, dans l'ordre d'affichage.
  categories: [
    {
      // Compteurs mis à jour automatiquement (src/stats.js). Le nom affiché change : le bot retrouve ces salons par leur ID.
      name: '📊 統計 ・ STATS',
      channels: [
        { key: 'stat_discord', name: '👥 Membres : …', type: 'voice', access: 'stats', stat: 'discord' },
        { key: 'stat_twitch', name: '🟣 Twitch : …', type: 'voice', access: 'stats', stat: 'twitch' },
        { key: 'stat_tiktok', name: '📱 TikTok : …', type: 'voice', access: 'stats', stat: 'tiktok' },
      ],
    },
    {
      name: '⛩️ 入口 ・ ENTRÉE',
      formerNames: ['📌 ACCUEIL'],
      channels: [
        { key: 'welcome', name: '🏮┃bienvenue', formerNames: ['👋・bienvenue'], type: 'text', access: 'public-readonly', topic: 'Les nouveaux arrivants sont accueillis ici !' },
        { key: 'rules', name: '⛩️┃règlement', formerNames: ['📜・règlement'], type: 'text', access: 'public-readonly', topic: 'Lis le règlement et clique sur le bouton pour accéder au serveur.' },
        { key: 'guide', name: '📖┃guide', type: 'text', access: 'public-readonly', topic: 'Le guide du serveur et de toutes les commandes (/guide pour le relire).' },
        { key: 'announcements', name: '📡┃annonces', formerNames: ['📢・annonces'], type: 'announcement', access: 'members-readonly', topic: 'Les annonces importantes de la chaîne.' },
        { key: 'live', name: '🔴┃en-live', formerNames: ['🔴・en-live'], type: 'text', access: 'members-readonly', topic: 'Alerte automatique quand je suis en live (Twitch / TikTok).' },
        { key: 'tiktok', name: '📱┃tiktok', formerNames: ['📱・tiktok'], type: 'text', access: 'members-readonly', topic: 'Mes nouvelles vidéos TikTok, postées automatiquement.' },
        { key: 'roles', name: '🎴┃rôles', formerNames: ['🎭・rôles'], type: 'text', access: 'members-readonly', topic: 'Choisis tes rôles et tes notifications.' },
      ],
    },
    {
      name: '🏯 道場 ・ LE DOJO',
      formerNames: ['🏙️ 街 ・ LA VILLE', '💬 COMMUNAUTÉ'],
      channels: [
        { key: 'general', name: '🍜┃discussion', formerNames: ['💬・discussion'], type: 'text', access: 'members', topic: 'Discussion générale, sois cool 😎' },
        { key: 'media', name: '📸┃médias', formerNames: ['🖼️・médias'], type: 'text', access: 'members', topic: 'Images, vidéos, liens sympas.' },
        { key: 'memes', name: '👾┃memes', formerNames: ['😂・memes'], type: 'text', access: 'members' },
        { key: 'gaming', name: '🕹️┃gaming', formerNames: ['🎮・gaming'], type: 'text', access: 'members', topic: 'Parle de tes jeux du moment.' },
        { key: 'music', name: '🎧┃musique', formerNames: ['🎵・musique'], type: 'text', access: 'members' },
        { key: 'hall_of_fame', name: '🏯┃hall-of-fame', type: 'text', access: 'members-readonly', topic: 'Les meilleurs messages du dojo (⚔️ x5 pour y entrer).' },
        { key: 'bot_commands', name: '🤖┃commandes', formerNames: ['🤖・commandes-bot'], type: 'text', access: 'members' },
      ],
    },
    {
      name: '📡 配信 ・ STREAM',
      formerNames: ['📺 STREAM'],
      channels: [
        { key: 'schedule', name: '🗓️┃planning', formerNames: ['📅・planning'], type: 'text', access: 'members-readonly', topic: 'Le planning des streams de la semaine.' },
        { key: 'clips', name: '🎬┃clips', formerNames: ['✂️・clips'], type: 'text', access: 'members', topic: 'Partage tes meilleurs clips du stream !' },
        { key: 'fanart', name: '🖌️┃fan-art', formerNames: ['🎨・fan-art'], type: 'text', access: 'members' },
        { key: 'suggestions', name: '💡┃suggestions', formerNames: ['💡・suggestions'], type: 'text', access: 'members', topic: 'Idées de jeux, de défis ou d\'améliorations pour la chaîne.' },
      ],
    },
    {
      name: '🩸 特別 ・ VIP & ABONNÉS',
      formerNames: ['💠 特別 ・ VIP & ABONNÉS', '⭐ VIP & ABONNÉS'],
      channels: [
        { key: 'vip_chat', name: '🩸┃salon-vip', formerNames: ['💠┃salon-vip', '⭐・salon-vip'], type: 'text', access: 'vip', topic: 'Merci pour votre soutien ❤️' },
        { key: 'vip_voice', name: '🩸 Lounge VIP', formerNames: ['💠 Lounge VIP', '⭐ Vocal VIP'], type: 'voice', access: 'vip' },
      ],
    },
    {
      name: '🎧 音 ・ VOCAUX',
      formerNames: ['🔊 VOCAUX'],
      channels: [
        { key: 'voice_create', name: '➕ Créer ton vocal', type: 'voice', access: 'members' },
        { key: 'voice_general', name: '🌃 Shibuya', formerNames: ['🔊 Général'], type: 'voice', access: 'members' },
        { key: 'voice_gaming1', name: '🎮 Akihabara #1', formerNames: ['🎮 Gaming #1'], type: 'voice', access: 'members', userLimit: 5 },
        { key: 'voice_gaming2', name: '🎮 Akihabara #2', formerNames: ['🎮 Gaming #2'], type: 'voice', access: 'members', userLimit: 5 },
        { key: 'voice_watch', name: '📺 Shinjuku ・ Watch party', formerNames: ['📺 Watch party'], type: 'voice', access: 'members' },
        { key: 'voice_afk', name: '💤 Ryokan ・ AFK', formerNames: ['💤 AFK'], type: 'voice', access: 'members' },
      ],
    },
    {
      name: '🎫 支援 ・ SUPPORT',
      channels: [
        { key: 'tickets', name: '🎫┃ouvrir-un-ticket', type: 'text', access: 'members-readonly', topic: 'Besoin d\'aide ? Clique sur le bouton pour ouvrir un ticket privé avec le staff.' },
        { key: 'jail', name: '🏚️┃cachot', type: 'text', access: 'quarantine', topic: 'Membres en quarantaine : le staff vous répond ici.' },
      ],
    },
    {
      name: '🛡️ 守 ・ STAFF',
      formerNames: ['🛡️ MODÉRATION'],
      channels: [
        { key: 'mod_chat', name: '🛡️┃staff', formerNames: ['🛡️・mod-chat'], type: 'text', access: 'staff' },
        { key: 'guide_staff', name: '📘┃guide-staff', type: 'text', access: 'staff', topic: 'Les commandes et réflexes du staff.' },
        { key: 'security_alerts', name: '🚨┃alertes-sécurité', formerNames: ['🚨・alertes-sécurité'], type: 'text', access: 'staff', topic: 'Anti-raid / anti-nuke : alertes importantes.' },
        { key: 'mod_logs', name: '📋┃logs', formerNames: ['📋・logs'], type: 'text', access: 'staff', topic: 'Kicks, bans, mutes, rôles, pseudos, salons, messages supprimés/modifiés…' },
        { key: 'db_backups', name: '💾┃sauvegardes', type: 'text', access: 'staff-senior', topic: 'Copie quotidienne de la base du bot (à garder !).' },
        { key: 'voice_logs', name: '🔊┃logs-vocal', formerNames: ['🔊・logs-vocal'], type: 'text', access: 'staff', topic: 'Arrivées, départs et déconnexions des vocaux.' },
      ],
    },
  ],

  // Vocaux temporaires : rejoindre ce salon crée un vocal perso (supprimé quand il est vide)
  tempVoice: {
    triggerChannel: 'voice_create',
    nameTemplate: '🏮 Salon de {user}',
  },

  // Sécurité (anti-raid, anti-spam, anti-nuke) — valeurs par défaut dans src/security.js
  security: {
    raidJoins: 8, // 8 arrivées…
    raidWindowSec: 20, // …en 20 secondes = raid -> verrouillage
    lockdownMinutes: 10,
    minAccountAgeDays: 0, // ex : 3 = refuser les comptes Discord de moins de 3 jours (0 = désactivé)
    spamMessages: 6, // 6 messages en 5 s = flood -> mute 10 min
    maxMentions: 5,
    blockInvites: true, // supprimer les invitations vers d'autres serveurs
    whitelist: [], // IDs de personnes / bots de confiance ignorés par l'anti-nuke
  },

  // Icône du serveur (appliquée par `npm run setup`), null pour ne pas y toucher
  serverIcon: 'assets/icon.png',

  // Boutique (/boutique, /acheter) — `role` = clé d'un rôle ci-dessus, `group` = un seul équipé à la fois, `days` = temporaire
  shop: [
    { key: 'color_sakura', name: '🌸 Pseudo Sakura', price: 1500, role: 'color_sakura', group: 'couleur', description: 'Ton pseudo en rose fleur de cerisier.' },
    { key: 'color_blood', name: '🩸 Pseudo Sang', price: 1500, role: 'color_blood', group: 'couleur', description: 'Ton pseudo en rouge sang.' },
    { key: 'color_steel', name: '⚙️ Pseudo Acier', price: 1500, role: 'color_steel', group: 'couleur', description: 'Ton pseudo gris acier.' },
    { key: 'color_shadow', name: '🌑 Pseudo Ombre', price: 2500, role: 'color_shadow', group: 'couleur', description: 'Ton pseudo noir comme la nuit.' },
    { key: 'color_lantern', name: '🏮 Pseudo Lanterne', price: 4000, role: 'color_lantern', group: 'couleur', description: 'Ton pseudo doré de lanterne.' },
    { key: 'vip_week', name: '🩸 VIP 7 jours', price: 12000, role: 'vip', days: 7, description: 'Accès au salon et au vocal VIP pendant une semaine.' },
  ],

  // AutoMod Discord (/automod) : mots interdits (* = joker). Les modos ne sont pas concernés.
  automod: {
    blockedWords: ['fdp', 'ntm', 'nique ta mere', 'nique ta mère', '*enculé*', '*encule*', 'salope', 'pute', 'tg', 'connasse', 'batard', 'bâtard'],
  },

  // Salon AFK du serveur (clé d'un salon vocal ci-dessus)
  afkChannel: 'voice_afk',

  rules: [
    'Respecte tout le monde : pas d\'insultes, de harcèlement, de racisme, de sexisme ni d\'homophobie.',
    'Pas de spam, de flood ni de pub (serveurs, chaînes, liens) sans l\'accord du staff.',
    'Pas de contenu NSFW, choquant ou illégal.',
    'Pas de spoil sans balise ||spoiler||.',
    'Utilise les bons salons pour chaque sujet.',
    'Les décisions des modérateurs doivent être respectées. Un souci ? Contacte un modo en privé.',
    'Respecte les conditions d\'utilisation de Discord (https://discord.com/terms) et de Twitch.',
  ],

  // Variables : {user} {username} {server} {count} {rules} — modifiables aussi avec /welcome ou le tableau de bord
  welcomeMessage: '🏮 **いらっしゃいませ** {user} ! Bienvenue chez **Les Ronins de haro62190** ⚔️\nLis le {rules} et prête serment pour rejoindre le dojo ⛩️',
  goodbyeMessage: '🌑 **{username}** a quitté le dojo. Que ta lame reste affûtée, ronin.',
};
