/**
 * Statistiques individuelles des membres (affichées par /profil, /top et le tableau de bord) :
 * ryō gagnés, quêtes terminées, duels joués / gagnés, meilleure série /daily, réactions données.
 * Messages, XP et minutes de vocal viennent de levels.js ; le solde de ryō d'economy.js.
 */
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { db, save } = require('./store');

const of = (userId) => ((db.memberStats ??= {})[userId] ??= {});

function bump(userId, field, n = 1) {
  if (!userId) return;
  const s = of(userId);
  s[field] = (s[field] ?? 0) + n;
  save();
}

function max(userId, field, value) {
  const s = of(userId);
  if ((s[field] ?? 0) < value) {
    s[field] = value;
    save();
  }
}

/** Tout ce qu'on sait d'un membre, pour /profil et le site. */
function full(userId) {
  const levels = require('./levels');
  const r = levels.rankOf(userId);
  const lv = db.levels?.[userId] ?? {};
  const w = db.economy?.[userId] ?? {};
  const s = db.memberStats?.[userId] ?? {};
  return {
    level: r.level,
    totalXp: r.totalXp,
    rank: r.rank,
    messages: lv.messages ?? 0,
    voiceMinutes: lv.voiceMinutes ?? 0,
    ryo: w.bal ?? 0,
    ryoEarned: s.ryoEarned ?? 0,
    streak: w.streak ?? 0,
    bestStreak: Math.max(s.bestStreak ?? 0, w.streak ?? 0),
    questsDone: db.quests?.[userId]?.completed ?? s.questsDone ?? 0,
    duels: s.duels ?? 0,
    duelsWon: s.duelsWon ?? 0,
    reactions: s.reactions ?? 0,
    liveMessages: s.liveMessages ?? 0,
    seasonRank: require('./seasons').rankOf(userId),
    weekRank: require('./seasons').weekRankOf(userId),
    pillarWins: s.pillarWins ?? 0,
  };
}

const n = (x) => Math.round(x).toLocaleString('fr-FR');

/** Classements par catégorie : [clé, libellé, fonction qui renvoie [{ userId, value }], format]. */
const BOARDS = {
  xp: ['⚔️ XP totale', () => Object.entries(db.levels ?? {}).map(([u, e]) => [u, e.xp]), (v) => `${n(v)} XP`],
  semaine: ['🔥 XP de la semaine', () => Object.entries(db.week?.xp ?? {}), (v) => `${n(v)} XP`],
  saison: ['🏆 XP du mois', () => Object.entries(db.season?.xp ?? {}), (v) => `${n(v)} XP`],
  messages: ['💬 Messages', () => Object.entries(db.levels ?? {}).map(([u, e]) => [u, e.messages ?? 0]), (v) => `${n(v)} messages`],
  vocal: ['🎙️ Temps en vocal', () => Object.entries(db.levels ?? {}).map(([u, e]) => [u, e.voiceMinutes ?? 0]), (v) => `${Math.floor(v / 60)} h ${v % 60} min`],
  ryo: ['💰 Ryō', () => Object.entries(db.economy ?? {}).map(([u, w]) => [u, w.bal]), (v) => `${n(v)} 両`],
  quetes: ['📜 Quêtes terminées', () => Object.entries(db.quests ?? {}).map(([u, q]) => [u, q.completed ?? 0]), (v) => `${n(v)} quêtes`],
  lives: ['📺 Actifs pendant les lives', () => Object.entries(db.memberStats ?? {}).map(([u, x]) => [u, x.liveMessages ?? 0]), (v) => `${n(v)} messages`],
  duels: ['⚔️ Duels gagnés', () => Object.entries(db.memberStats ?? {}).map(([u, x]) => [u, x.duelsWon ?? 0]), (v) => `${n(v)} victoires`],
};

function board(key, limit = 10) {
  const def = require('./shared').own(BOARDS, key);
  if (!def) return [];
  return def[1]()
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([userId, value]) => ({ userId, value, label: def[2](value) }));
}

const commands = [
  {
    category: '⭐ Niveaux',
    data: new SlashCommandBuilder()
      .setName('top')
      .setDescription('Les membres les plus actifs, par catégorie')
      .addStringOption((o) =>
        o
          .setName('categorie')
          .setDescription('Quel classement (XP par défaut)')
          .addChoices(...Object.entries(BOARDS).map(([value, [name]]) => ({ name, value }))),
      ),
    run(i) {
      const key = i.options.getString('categorie') ?? 'xp';
      const list = board(key);
      const medals = ['🥇', '🥈', '🥉'];
      const mine = def(key).findIndex(([u]) => u === i.user.id);
      return i.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe10600)
            .setTitle(`🏆 Top ・ ${BOARDS[key][0]}`)
            .setDescription(
              (list.map((e, k) => `${medals[k] ?? `**${k + 1}.**`} <@${e.userId}> — ${e.label}`).join('\n') || '_Personne pour l\'instant._') +
                (mine >= 0 ? `\n\nToi : **#${mine + 1}**` : ''),
            )
            .setFooter({ text: 'Autres classements : /top categorie:…' }),
        ],
        allowedMentions: { parse: [] },
      });
    },
  },
];

/** Liste triée complète (pour connaître sa propre place). */
function def(key) {
  return BOARDS[key][1]().filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
}

module.exports = { bump, max, full, of, board, BOARDS, commands };
