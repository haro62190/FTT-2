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
  notifications: {
    twitch: true,
    tiktok: true,
  },
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = merge(base[k], v);
  return out;
}

/** Tous les réglages (défauts + modifications). */
function all() {
  return merge(DEFAULTS, db.settings ?? {});
}

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
  save();
}

/** Remplacer tous les réglages (restauration d'une sauvegarde). */
function replaceAll(settings) {
  db.settings = settings ?? {};
  save();
}

module.exports = { DEFAULTS, all, get, set, replaceAll };
