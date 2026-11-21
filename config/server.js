/**
 * Structure du serveur Discord communautaire.
 *
 * Modifie librement ce fichier puis relance `npm run setup` :
 * le script est idempotent (il ne recrée pas ce qui existe déjà, il met à jour
 * les permissions et les messages du bot).
 *
 * Niveaux d'accès des salons (`access`) :
 *   - "public-readonly"  : visible par tous (même avant d'accepter le règlement), personne n'écrit sauf le staff
 *   - "members"          : visible et ouvert aux membres (règlement accepté)
 *   - "members-readonly" : visible par les membres, seul le staff écrit
 *   - "vip"              : réservé aux VIP, abonnés Twitch, Streamers et staff
 *   - "staff"            : réservé aux modérateurs
 */

module.exports = {
  serverName: null, // ex : "La commu de MaChaine" — null = ne pas renommer le serveur

  // Rôles, du plus haut au plus bas dans la hiérarchie.
  // `key` sert de référence dans le code, `name` est ce qui s'affiche sur Discord.
  roles: [
    // `formerNames` : anciens noms du rôle, pour le renommer au lieu d'en créer un nouveau
    { key: 'streamer', name: '👑 Chef', formerNames: ['👑 Streamer'], color: 0x9146ff, hoist: true, admin: true },
    { key: 'mod', name: '🛡️ Modérateur', color: 0x2ecc71, hoist: true, mod: true },
    // `allVoice` : peut voir et rejoindre TOUS les salons vocaux (y compris le vocal VIP)
    { key: 'friend', name: '🤝 Amis', color: 0x00bcd4, hoist: true, allVoice: true },
    // Pour les streamers de la commu : accès aux salons VIP
    { key: 'streamer_role', name: '🎥 Streamer', color: 0xa970ff, hoist: true },
    { key: 'vip', name: '💎 VIP', color: 0xe91e63, hoist: true },
    { key: 'sub', name: '⭐ Abonné Twitch', color: 0xf1c40f, hoist: true },
    { key: 'member', name: '🎮 Membre', color: 0x3498db, hoist: false },
    // Rôles que les membres peuvent s'attribuer eux-mêmes dans #rôles
    { key: 'notif_live', name: '🔴 Notif Live', color: 0xe74c3c, selfAssign: true, emoji: '🔴', description: 'Être notifié quand le live commence' },
    { key: 'notif_news', name: '📢 Notif Annonces', color: 0x95a5a6, selfAssign: true, emoji: '📢', description: 'Être notifié des annonces' },
    { key: 'gamer', name: '🕹️ Joueur', color: 0x1abc9c, selfAssign: true, emoji: '🕹️', description: 'Jouer avec la commu' },
    { key: 'artist', name: '🎨 Artiste', color: 0xe67e22, selfAssign: true, emoji: '🎨', description: 'Partager tes créations' },
  ],

  // Catégories et salons, dans l'ordre d'affichage.
  categories: [
    {
      name: '📌 ACCUEIL',
      channels: [
        { key: 'welcome', name: '👋・bienvenue', type: 'text', access: 'public-readonly', topic: 'Les nouveaux arrivants sont accueillis ici !' },
        { key: 'rules', name: '📜・règlement', type: 'text', access: 'public-readonly', topic: 'Lis le règlement et clique sur le bouton pour accéder au serveur.' },
        { key: 'announcements', name: '📢・annonces', type: 'announcement', access: 'members-readonly', topic: 'Les annonces importantes de la chaîne.' },
        { key: 'live', name: '🔴・en-live', type: 'text', access: 'members-readonly', topic: 'Alerte automatique quand le stream démarre.' },
        { key: 'roles', name: '🎭・rôles', type: 'text', access: 'members-readonly', topic: 'Choisis tes rôles et tes notifications.' },
      ],
    },
    {
      name: '💬 COMMUNAUTÉ',
      channels: [
        { key: 'general', name: '💬・discussion', type: 'text', access: 'members', topic: 'Discussion générale, sois cool 😎' },
        { key: 'media', name: '🖼️・médias', type: 'text', access: 'members', topic: 'Images, vidéos, liens sympas.' },
        { key: 'memes', name: '😂・memes', type: 'text', access: 'members' },
        { key: 'gaming', name: '🎮・gaming', type: 'text', access: 'members', topic: 'Parle de tes jeux du moment.' },
        { key: 'music', name: '🎵・musique', type: 'text', access: 'members' },
        { key: 'bot_commands', name: '🤖・commandes-bot', type: 'text', access: 'members' },
      ],
    },
    {
      name: '📺 STREAM',
      channels: [
        { key: 'schedule', name: '📅・planning', type: 'text', access: 'members-readonly', topic: 'Le planning des streams de la semaine.' },
        { key: 'clips', name: '✂️・clips', type: 'text', access: 'members', topic: 'Partage tes meilleurs clips du stream !' },
        { key: 'fanart', name: '🎨・fan-art', type: 'text', access: 'members' },
        { key: 'suggestions', name: '💡・suggestions', type: 'text', access: 'members', topic: 'Idées de jeux, de défis ou d\'améliorations pour la chaîne.' },
      ],
    },
    {
      name: '⭐ VIP & ABONNÉS',
      channels: [
        { key: 'vip_chat', name: '⭐・salon-vip', type: 'text', access: 'vip', topic: 'Merci pour votre soutien ❤️' },
        { key: 'vip_voice', name: '⭐ Vocal VIP', type: 'voice', access: 'vip' },
      ],
    },
    {
      name: '🔊 VOCAUX',
      channels: [
        { key: 'voice_create', name: '➕ Créer ton vocal', type: 'voice', access: 'members' },
        { key: 'voice_general', name: '🔊 Général', type: 'voice', access: 'members' },
        { key: 'voice_gaming1', name: '🎮 Gaming #1', type: 'voice', access: 'members', userLimit: 5 },
        { key: 'voice_gaming2', name: '🎮 Gaming #2', type: 'voice', access: 'members', userLimit: 5 },
        { key: 'voice_watch', name: '📺 Watch party', type: 'voice', access: 'members' },
        { key: 'voice_afk', name: '💤 AFK', type: 'voice', access: 'members' },
      ],
    },
    {
      name: '🛡️ MODÉRATION',
      channels: [
        { key: 'mod_chat', name: '🛡️・mod-chat', type: 'text', access: 'staff' },
        { key: 'mod_logs', name: '📋・logs', type: 'text', access: 'staff', topic: 'Journal automatique (arrivées, départs, messages supprimés).' },
      ],
    },
  ],

  // Vocaux temporaires : rejoindre ce salon crée un vocal perso (supprimé quand il est vide)
  tempVoice: {
    triggerChannel: 'voice_create',
    nameTemplate: '🔊 Salon de {user}',
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

  welcomeMessage: 'Bienvenue {user} sur le serveur ! 🎉\nLis le {rules} et clique sur le bouton pour débloquer le reste du serveur.',
};
