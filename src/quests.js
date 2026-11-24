/**
 * Quêtes : 3 quêtes du jour et 3 quêtes de la semaine par membre (tirées au hasard, différentes pour chacun),
 * récompensées en ryō. Progression automatique : messages, vocal, réactions, /daily, mini-jeux, giveaways, suggestions.
 * Remise à zéro à minuit (jour) et le lundi (semaine), heure de Paris. Commande : /quetes
 */
const crypto = require('crypto');
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { BRAND_COLOR, findChannel } = require('./shared');
const { db, save } = require('./store');
const settings = require('./settings');

const DAILY = [
  { id: 'msg20', type: 'messages', goal: 20, reward: 60, label: 'Écrire 20 messages' },
  { id: 'msg50', type: 'messages', goal: 50, reward: 120, label: 'Écrire 50 messages' },
  { id: 'voice15', type: 'voice', goal: 15, reward: 80, label: 'Passer 15 min en vocal' },
  { id: 'voice45', type: 'voice', goal: 45, reward: 160, label: 'Passer 45 min en vocal' },
  { id: 'react5', type: 'reactions', goal: 5, reward: 40, label: 'Réagir à 5 messages' },
  { id: 'daily', type: 'daily', goal: 1, reward: 30, label: 'Récupérer ton /daily' },
  { id: 'chifoumi3', type: 'chifoumi', goal: 3, reward: 50, label: 'Jouer 3 parties de /chifoumi' },
  { id: 'duel1', type: 'duel', goal: 1, reward: 70, label: 'Faire un /duel' },
];
const WEEKLY = [
  { id: 'wmsg', type: 'messages', goal: 300, reward: 600, label: 'Écrire 300 messages' },
  { id: 'wvoice', type: 'voice', goal: 240, reward: 800, label: 'Passer 4 h en vocal' },
  { id: 'wdaily', type: 'daily', goal: 5, reward: 500, label: 'Récupérer 5 /daily' },
  { id: 'wduel', type: 'duelWin', goal: 3, reward: 450, label: 'Gagner 3 duels' },
  { id: 'wsugg', type: 'suggestion', goal: 1, reward: 250, label: 'Proposer une suggestion' },
  { id: 'wgw', type: 'giveaway', goal: 1, reward: 200, label: 'Participer à un giveaway' },
  { id: 'wreact', type: 'reactions', goal: 40, reward: 300, label: 'Réagir à 40 messages' },
];
const PER_PERIOD = 3;

let guildRef = null;

const parisDate = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }); // AAAA-MM-JJ
function parisWeek() {
  const [y, m, d] = parisDate().split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); // lundi
  return t.toISOString().slice(0, 10);
}

/** Tirage reproductible : chaque membre a ses propres quêtes, stables pendant la période. */
function draw(pool, seed) {
  return [...pool]
    .map((q) => ({ q, k: crypto.createHash('sha1').update(seed + q.id).digest('hex') }))
    .sort((a, b) => a.k.localeCompare(b.k))
    .slice(0, PER_PERIOD)
    .map(({ q }) => ({ id: q.id, n: 0, done: false }));
}

function userState(userId) {
  const all = (db.quests ??= {});
  const s = (all[userId] ??= { completed: 0 });
  const day = parisDate();
  const week = parisWeek();
  if (s.day !== day) Object.assign(s, { day, daily: draw(DAILY, `${userId}:${day}`) });
  if (s.week !== week) Object.assign(s, { week, weekly: draw(WEEKLY, `${userId}:${week}`) });
  return s;
}

const def = (id) => DAILY.find((q) => q.id === id) ?? WEEKLY.find((q) => q.id === id);

/** Fait avancer les quêtes d'un membre. type : messages | voice | reactions | daily | chifoumi | duel | duelWin | suggestion | giveaway */
function progress(userId, type, amount = 1) {
  if (!settings.on('quests') || !userId) return;
  const s = userState(userId);
  const finished = [];
  for (const q of [...s.daily, ...s.weekly]) {
    const d = def(q.id);
    if (!d || q.done || d.type !== type) continue;
    q.n = Math.min(d.goal, q.n + amount);
    if (q.n >= d.goal) {
      q.done = true;
      s.completed++;
      finished.push(d);
    }
  }
  if (!finished.length) return save();
  const economy = require('./economy');
  const total = finished.reduce((n, d) => n + d.reward, 0);
  economy.add(userId, total);
  const stats = require('./memberstats');
  stats.bump(userId, 'questsDone', finished.length);
  require('./social').track(userId, 'quests', finished.length);
  require('./challenges').progress('quests', userId, finished.length);
  stats.bump(userId, 'ryoEarned', total);
  save();
  announce(userId, finished).catch(() => {});
  const who = guildRef?.members.cache.get(userId)?.displayName ?? 'Un ronin';
  require('./feed').push('📜', `${who} a terminé ${finished.length > 1 ? `${finished.length} quêtes` : `la quête « ${finished[0].label} »`} (+${total} 両)`);
}

async function announce(userId, finished) {
  const channel = guildRef && (findChannel(guildRef, 'bot_commands') ?? findChannel(guildRef, 'general'));
  await channel?.send({
    content: `📜 <@${userId}> termine ${finished.map((d) => `**${d.label}**`).join(' et ')} : **+${finished.reduce((n, d) => n + d.reward, 0)} 両** !`,
    allowedMentions: { users: [userId] },
  });
}

function init(guild) {
  guildRef = guild;
}

function bar(n, goal) {
  const filled = Math.round((n / goal) * 10);
  return `${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)}`;
}

const commands = [
  {
    category: '💰 Ryō & jeux',
    data: new SlashCommandBuilder().setName('quetes').setDescription('Tes quêtes du jour et de la semaine (récompenses en ryō)'),
    run(i) {
      if (!settings.on('quests')) return i.reply({ content: '📜 Les quêtes sont désactivées pour le moment.', ephemeral: true });
      const s = userState(i.user.id);
      save();
      const line = (q) => {
        const d = def(q.id);
        return `${q.done ? '✅' : '⬜'} **${d.label}** — ${d.reward} 両\n　${bar(q.n, d.goal)} ${q.n}/${d.goal}`;
      };
      const [y, m, d] = parisDate().split('-').map(Number);
      const tomorrow = Math.floor(Date.UTC(y, m - 1, d + 1) / 1000) - 3600; // ≈ minuit à Paris
      return i.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(BRAND_COLOR)
            .setTitle('📜 任務 ・ Tes quêtes')
            .addFields(
              { name: `☀️ Du jour — nouvelles <t:${tomorrow}:R>`, value: s.daily.map(line).join('\n') },
              { name: '🗓️ De la semaine — nouvelles lundi', value: s.weekly.map(line).join('\n') },
            )
            .setFooter({ text: `Quêtes terminées au total : ${s.completed}` }),
        ],
        ephemeral: true,
      });
    },
  },
];

module.exports = { progress, init, commands, userState, DAILY, WEEKLY };
