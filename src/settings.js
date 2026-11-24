/**
 * Réglages modifiables à chaud (commandes /welcome, /moderation, /config et tableau de bord web).
 * Valeurs par défaut = config/server.js ; les modifications sont enregistrées dans la base SQLite.
 */
const { config } = require('./shared');
const { db, save } = require('./store');

const DEFAULTS = {
  welcome: {
    enabled: true,
    message: config.welcomeMessage,
  },
  goodbye: {
    enabled: true,
    message: config.goodbyeMessage ?? '🌑 **{username}** a quitté le dojo. Que ta lame reste affûtée, ronin.',
  },
  levels: {
    enabled: true,
    announce: true,
    // niveau -> ID de rôle (en plus des rôles `levelReward` de config/server.js)
    rewards: {},
    minLength: 3, // messages plus courts (« ok », « mdr ») : pas d'XP
    ignoreBotChannel: true, // pas d'XP dans 🤖┃commandes
    noXpChannels: [],
    // Bonus d'XP par rôle (le meilleur s'applique) ; « booster » = boost Nitro du serveur
    roleMultipliers: { vip: 1.25, sub: 1.25, booster: 1.25 },
    // Prime en ryō la première fois qu'un grade est atteint, et bonus de /daily par grade
    gradeBonus: { rank_ashigaru: 500, rank_samurai: 1500, rank_daimyo: 5000 },
    gradeDaily: { rank_ashigaru: 10, rank_samurai: 30, rank_daimyo: 75 },
  },
  security: {
    raidJoins: 8,
    raidWindowSec: 20,
    lockdownMinutes: 10,
    minAccountAgeDays: 0,
    spamMessages: 6,
    spamWindowSec: 5,
    spamMuteMinutes: 10,
    maxMentions: 5,
    blockInvites: true,
    antiNuke: true,
    antiRaid: true,
    antiSpam: true,
    raidAction: 'quarantine', // 'quarantine' (réversible) ou 'kick'
    raidQuarantineHours: 24,
    youngAccountDays: 7,
    youngRaidJoins: 5,
    blockUnknownBots: true,
    whitelist: [],
    ...config.security,
  },
  economy: { enabled: true, daily: 100, voicePerMinute: 2 },
  seasons: { enabled: true, rewards: [3000, 2000, 1000], weekly: true, weeklyReward: 750 },
  voiceXp: { enabled: true, xpPerMinute: 10 },
  hallOfFame: { emoji: '⚔️', threshold: 5 },
  verification: { captcha: true },
  birthdays: { enabled: true, gift: 500 },
  automod: { enabled: true, extraWords: [] },
  notifications: {
    twitch: true,
    tiktok: true,
    clips: true,
    schedule: true,
  },
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = merge(base[k], v);
  return out;
}

// Fusion mise en cache : recalculée seulement quand les réglages changent
let cache = null;
let cachedFrom = null;

/** Tous les réglages (défauts + modifications). */
function all() {
  if (!cache || cachedFrom !== db.settings) {
    cachedFrom = db.settings;
    cache = merge(DEFAULTS, db.settings ?? {});
  }
  return cache;
}
const invalidate = () => {
  cache = null;
};

/** Lire un réglage : get('security.raidJoins') */
function get(path) {
  return path.split('.').reduce((o, k) => o?.[k], all());
}

/** Modifier un réglage : set('welcome.enabled', false) */
function set(path, value) {
  const keys = path.split('.');
  db.settings ??= {};
  let o = db.settings;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys.at(-1)] = value;
  invalidate();
  save();
}

/** Remettre des sections par défaut : reset(['security']) ; reset() = tout */
function reset(sections) {
  if (!sections) db.settings = {};
  else for (const k of sections) delete db.settings?.[k];
  invalidate();
  save();
}

/** Remplacer tous les réglages (restauration d'une sauvegarde). */
function replaceAll(settings) {
  db.settings = settings ?? {};
  invalidate();
  save();
}

/** Interrupteurs de chaque module (page « Modules » du tableau de bord) : [clé, libellé, réglage, groupe] */
const MODULES = [
  ['welcome', '🏮 Message de bienvenue', 'welcome.enabled', 'Communauté'],
  ['goodbye', '🌑 Message de départ', 'goodbye.enabled', 'Communauté'],
  ['verification', '✅ Vérification anti-bot (règlement)', 'verification.captcha', 'Communauté'],
  ['levels', '⚔️ Niveaux et XP des messages', 'levels.enabled', 'Communauté'],
  ['voiceXp', '🎙️ XP et ryō en vocal', 'voiceXp.enabled', 'Communauté'],
  ['seasons', '🏆 Saisons du mois', 'seasons.enabled', 'Communauté'],
  ['weekly', '🔥 Pilier de la semaine', 'seasons.weekly', 'Communauté'],
  ['economy', '💰 Économie ryō', 'economy.enabled', 'Communauté'],
  ['quests', '📜 Quêtes quotidiennes et hebdomadaires', 'modules.quests', 'Communauté'],
  ['birthdays', '🎂 Anniversaires', 'birthdays.enabled', 'Communauté'],
  ['giveaways', '🎁 Giveaways', 'modules.giveaways', 'Communauté'],
  ['suggestions', '💡 Suggestions avec votes', 'modules.suggestions', 'Communauté'],
  ['hallOfFame', '🏯 Hall of Fame', 'modules.hallOfFame', 'Communauté'],
  ['customCommands', '⌨️ Commandes personnalisées', 'modules.customCommands', 'Communauté'],
  ['tickets', '🎫 Tickets', 'modules.tickets', 'Serveur'],
  ['tempvoice', '🔊 Vocaux temporaires', 'modules.tempvoice', 'Serveur'],
  ['music', '🎵 Musique', 'modules.music', 'Serveur'],
  ['stats', '📊 Salons compteurs', 'modules.stats', 'Serveur'],
  ['logs', '📋 Logs (journal d\'audit, vocal, messages)', 'modules.logs', 'Serveur'],
  ['twitch', '🔴 Alertes de live Twitch', 'notifications.twitch', 'Stream'],
  ['clips', '🎬 Clips Twitch', 'notifications.clips', 'Stream'],
  ['schedule', '🗓️ Planning Twitch → événements', 'notifications.schedule', 'Stream'],
  ['tiktok', '📱 Alertes TikTok', 'notifications.tiktok', 'Stream'],
  ['milestones', '🎉 Paliers d\'abonnés', 'modules.milestones', 'Stream'],
  ['antiRaid', '🛡️ Anti-raid', 'security.antiRaid', 'Sécurité'],
  ['antiSpam', '🤖 Anti-spam', 'security.antiSpam', 'Sécurité'],
  ['antiNuke', '💣 Anti-nuke', 'security.antiNuke', 'Sécurité'],
  ['automod', '🤖 AutoMod Discord', 'automod.enabled', 'Sécurité'],
];

/** Un module est actif sauf s'il a été coupé (valeur false). */
const on = (key) => {
  const m = MODULES.find((x) => x[0] === key);
  return get(m ? m[2] : `modules.${key}`) !== false;
};

module.exports = { DEFAULTS, all, get, set, reset, replaceAll, MODULES, on };
