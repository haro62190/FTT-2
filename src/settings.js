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
    whitelist: [],
    ...config.security,
  },
  economy: { enabled: true, daily: 100, voicePerMinute: 2 },
  seasons: { enabled: true, rewards: [3000, 2000, 1000] },
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

module.exports = { DEFAULTS, all, get, set, reset, replaceAll };
