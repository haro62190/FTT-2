/**
 * Système de niveaux façon MEE6 : 15 à 25 XP par message, au plus une fois par minute.
 */
const { db, save } = require('./store');

const COOLDOWN_MS = 60_000;
const lastGain = new Map();

/** XP nécessaire pour passer du niveau `level` au suivant. */
const xpForLevel = (level) => 5 * level ** 2 + 50 * level + 100;

function levelInfo(totalXp) {
  let level = 0;
  let xp = totalXp;
  while (xp >= xpForLevel(level)) {
    xp -= xpForLevel(level);
    level++;
  }
  return { level, xp, needed: xpForLevel(level), totalXp };
}

/** Donne de l'XP pour un message. Renvoie le nouveau niveau en cas de passage de niveau, sinon null. */
function onMessage(userId) {
  const now = Date.now();
  if (now - (lastGain.get(userId) ?? 0) < COOLDOWN_MS) return null;
  lastGain.set(userId, now);

  const before = levelInfo(db.levels[userId]?.xp ?? 0).level;
  const entry = (db.levels[userId] ??= { xp: 0, messages: 0 });
  entry.xp += 15 + Math.floor(Math.random() * 11);
  entry.messages++;
  save();
  const after = levelInfo(entry.xp).level;
  return after > before ? after : null;
}

function leaderboard() {
  return Object.entries(db.levels)
    .map(([userId, e]) => ({ userId, ...levelInfo(e.xp), messages: e.messages }))
    .sort((a, b) => b.totalXp - a.totalXp);
}

function rankOf(userId) {
  const board = leaderboard();
  const index = board.findIndex((e) => e.userId === userId);
  return {
    ...levelInfo(db.levels[userId]?.xp ?? 0),
    messages: db.levels[userId]?.messages ?? 0,
    rank: index === -1 ? null : index + 1,
  };
}

module.exports = { onMessage, leaderboard, rankOf, levelInfo };
