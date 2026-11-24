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

/** Le message compte-t-il pour l'XP ? (longueur minimale, salons exclus comme 🤖┃commandes) */
function counts({ content = '', attachments = 0, channelId = null, guild = null } = {}) {
  const settings = require('./settings');
  if (content.trim().length < (settings.get('levels.minLength') ?? 3) && !attachments) return false;
  const excluded = settings.get('levels.noXpChannels') ?? [];
  if (channelId && excluded.includes(channelId)) return false;
  if (channelId && guild && settings.get('levels.ignoreBotChannel') !== false) {
    const bots = require('./shared').findChannel(guild, 'bot_commands');
    if (bots && bots.id === channelId) return false;
  }
  return true;
}

/** Donne de l'XP pour un message. Renvoie le nouveau niveau en cas de passage de niveau, sinon null.
 *  `member` (facultatif) : pour les multiplicateurs de rôles et d'événement boost. */
function onMessage(userId, member = null) {
  const now = Date.now();
  if (now - (lastGain.get(userId) ?? 0) < COOLDOWN_MS) return null;
  lastGain.set(userId, now);

  const before = levelInfo(db.levels[userId]?.xp ?? 0).level;
  const entry = (db.levels[userId] ??= { xp: 0, messages: 0 });
  const gain = Math.round((15 + Math.floor(Math.random() * 11)) * require('./boost').multiplier(member, 'xp'));
  entry.xp += gain;
  entry.messages++;
  require('./seasons').add(userId, gain);
  save();
  const after = levelInfo(entry.xp).level;
  return after > before ? after : null;
}

/** XP gagnée en vocal (une minute). Renvoie le nouveau niveau en cas de passage, sinon null. */
function addXp(userId, amount, member = null) {
  amount = Math.round(amount * require('./boost').multiplier(member, 'xp'));
  const before = levelInfo(db.levels[userId]?.xp ?? 0).level;
  const entry = (db.levels[userId] ??= { xp: 0, messages: 0 });
  entry.xp += amount;
  entry.voiceMinutes = (entry.voiceMinutes ?? 0) + 1;
  require('./seasons').add(userId, amount);
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

/** Récompenses : { niveau: rôle } depuis config/server.js (`levelReward`) et les réglages (/config). */
function rewardList(guild) {
  const { config, findRole } = require('./shared');
  const settings = require('./settings');
  const list = [];
  for (const def of config.roles.filter((r) => r.levelReward)) {
    const role = findRole(guild, def.key);
    if (role) list.push({ level: def.levelReward, role, key: def.key });
  }
  for (const [level, roleId] of Object.entries(settings.get('levels.rewards') ?? {})) {
    const role = guild.roles.cache.get(roleId);
    if (role) list.push({ level: Number(level), role });
  }
  return list.sort((a, b) => a.level - b.level);
}

/** Donne les rôles de récompense atteints, plus une prime en ryō la première fois qu'un grade est atteint.
 *  Renvoie les rôles nouvellement obtenus (chacun avec `bonus` = ryō offerts). */
async function applyRewards(member, level) {
  const settings = require('./settings');
  const bonuses = settings.get('levels.gradeBonus') ?? {};
  const granted = [];
  for (const { level: need, role, key } of rewardList(member.guild)) {
    if (level >= need && !member.roles.cache.has(role.id) && role.editable) {
      const ok = await member.roles.add(role, `Récompense niveau ${need}`).then(() => true).catch(() => false);
      if (!ok) continue;
      role.bonus = 0;
      const paid = (require('./memberstats').of(member.id).gradesPaid ??= []);
      if (key && bonuses[key] && !paid.includes(key)) {
        paid.push(key);
        require('./economy').add(member.id, bonuses[key]);
        require('./memberstats').bump(member.id, 'ryoEarned', bonuses[key]);
        role.bonus = bonuses[key];
      }
      granted.push(role);
    }
  }
  return granted;
}

/** Bonus de /daily selon le plus haut grade du membre. */
function gradeDailyBonus(member) {
  if (!member?.roles?.cache) return 0;
  const table = require('./settings').get('levels.gradeDaily') ?? {};
  let best = 0;
  for (const { role, key } of rewardList(member.guild)) if (key && member.roles.cache.has(role.id)) best = Math.max(best, table[key] ?? 0);
  return best;
}

module.exports = { addXp, onMessage, counts, leaderboard, rankOf, levelInfo, rewardList, applyRewards, gradeDailyBonus };
