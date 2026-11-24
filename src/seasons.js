/**
 * Saisons mensuelles : classement de l'XP gagnée pendant le mois (heure de Paris).
 * Le 1er du mois : annonce du podium, ryō pour le top 3, rôle 🏆 Champion du mois au premier,
 * puis remise à zéro du classement de la saison (l'XP et les niveaux, eux, ne bougent pas).
 */
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { BRAND_COLOR, findChannel, findRole } = require('./shared');
const { db, save } = require('./store');
const settings = require('./settings');

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const currentMonth = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }).slice(0, 7); // AAAA-MM
const monthName = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const season = () => (db.season ??= { month: currentMonth(), xp: {} });

// Semaine en cours (lundi, heure de Paris) pour le 🔥 Pilier de la semaine
function currentWeek() {
  const [y, m, d] = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}
const week = () => (db.week ??= { week: currentWeek(), xp: {} });

/** XP gagnée (message ou vocal) : comptée aussi pour la saison et la semaine en cours. */
function add(userId, amount) {
  if (settings.get('seasons.weekly') !== false) {
    const w = week();
    if (w.week === currentWeek()) w.xp[userId] = (w.xp[userId] ?? 0) + amount;
  }
  if (settings.get('seasons.enabled') === false) return save();
  const s = season();
  if (s.month !== currentMonth()) return; // la clôture se fait dans check()
  s.xp[userId] = (s.xp[userId] ?? 0) + amount;
  save();
}

const top = (n = 10, s = season()) =>
  Object.entries(s.xp)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([userId, xp]) => ({ userId, xp }));

function rankOf(userId) {
  const i = top(Infinity).findIndex((e) => e.userId === userId);
  return i === -1 ? null : i + 1;
}

const weekTop = (n = 10, w = week()) =>
  Object.entries(w.xp)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([userId, xp]) => ({ userId, xp }));

function weekRankOf(userId) {
  const i = weekTop(Infinity).findIndex((e) => e.userId === userId);
  return i === -1 ? null : i + 1;
}

/** Lundi : le plus actif de la semaine passée reçoit 🔥 Pilier de la semaine + des ryō. */
async function closeWeek(guild) {
  const w = week();
  const best = weekTop(3, w);
  const reward = settings.get('seasons.weeklyReward') ?? 750;
  const role = findRole(guild, 'pillar');
  if (role?.editable) for (const m of role.members.values()) await m.roles.remove(role, 'Nouvelle semaine').catch(() => {});
  if (best[0]) {
    require('./economy').add(best[0].userId, reward);
    require('./memberstats').bump(best[0].userId, 'ryoEarned', reward);
    require('./memberstats').bump(best[0].userId, 'pillarWins');
    const winner = await guild.members.fetch(best[0].userId).catch(() => null);
    if (winner && role?.editable) await winner.roles.add(role, 'Pilier de la semaine').catch(() => {});
    const medals = ['🥇', '🥈', '🥉'];
    const channel = findChannel(guild, 'announcements') ?? findChannel(guild, 'general');
    await channel
      ?.send({
        content: `<@${best[0].userId}>`,
        allowedMentions: { users: [best[0].userId] },
        embeds: [
          new EmbedBuilder()
            .setColor(0xff7a1a)
            .setTitle('🔥 柱 ・ Pilier de la semaine')
            .setDescription(
              best.map((p, i) => `${medals[i]} <@${p.userId}> — **${p.xp.toLocaleString('fr-FR')} XP**`).join('\n') +
                `\n\n<@${best[0].userId}> reçoit ${role ? `${role} et ` : ''}**${reward} 両** ! Nouvelle semaine, tout le monde repart de zéro.`,
            ),
        ],
      })
      .catch(() => {});
  }
  (db.weeksHistory ??= []).unshift({ week: w.week, top: weekTop(10, w) });
  db.weeksHistory = db.weeksHistory.slice(0, 26);
  db.week = { week: currentWeek(), xp: {} };
  save();
  console.log(`🔥 Semaine ${w.week} clôturée`);
}

async function close(guild) {
  const s = season();
  const podium = top(3, s);
  const rewards = settings.get('seasons.rewards') ?? [3000, 2000, 1000];
  const economy = require('./economy');
  podium.forEach((p, i) => rewards[i] && economy.add(p.userId, rewards[i]));

  // Rôle de champion : retiré à l'ancien, donné au nouveau
  const role = findRole(guild, 'champion');
  if (role?.editable) {
    for (const m of role.members.values()) await m.roles.remove(role, 'Fin de saison').catch(() => {});
    const winner = podium[0] && (await guild.members.fetch(podium[0].userId).catch(() => null));
    if (winner) await winner.roles.add(role, `Champion de ${monthName(s.month)}`).catch(() => {});
  }

  const medals = ['🥇', '🥈', '🥉'];
  const channel = findChannel(guild, 'announcements') ?? findChannel(guild, 'general');
  if (podium.length) {
    await channel
      ?.send({
        content: podium.map((p) => `<@${p.userId}>`).join(' '),
        allowedMentions: { users: podium.map((p) => p.userId) },
        embeds: [
          new EmbedBuilder()
            .setColor(0xffc400)
            .setTitle(`🏆 季節 ・ Fin de la saison de ${monthName(s.month)}`)
            .setDescription(
              podium.map((p, i) => `${medals[i]} <@${p.userId}> — **${p.xp.toLocaleString('fr-FR')} XP**${rewards[i] ? ` · +${rewards[i]} 両` : ''}`).join('\n') +
                `\n\n${role ? `${role} pour <@${podium[0].userId}> tout le mois !` : ''}\nUne nouvelle saison commence : tout le monde repart de zéro ⚔️`,
            ),
        ],
      })
      .catch(() => {});
  }
  (db.seasonsHistory ??= []).unshift({ month: s.month, top: top(10, s) });
  db.seasonsHistory = db.seasonsHistory.slice(0, 24);
  db.season = { month: currentMonth(), xp: {} };
  save();
  console.log(`🏆 Saison ${s.month} clôturée`);
}

async function check(guild) {
  if (settings.get('seasons.weekly') !== false && week().week !== currentWeek()) await closeWeek(guild);
  if (settings.get('seasons.enabled') === false) return;
  if (season().month !== currentMonth()) await close(guild);
}

function start(guild) {
  const run = () => check(guild).catch((e) => console.error('Saisons :', e.message));
  setTimeout(run, 30_000);
  setInterval(run, 15 * 60_000);
}

const commands = [
  {
    category: '⭐ Niveaux',
    data: new SlashCommandBuilder().setName('saison').setDescription('Le classement du mois (le 1er : podium, ryō et rôle 🏆 Champion)'),
    run(i) {
      const s = season();
      const list = top(10);
      const medals = ['🥇', '🥈', '🥉'];
      const [y, m] = s.month.split('-').map(Number);
      const end = Math.floor(new Date(Date.UTC(m === 12 ? y + 1 : y, m % 12, 1)).getTime() / 1000);
      const last = db.seasonsHistory?.[0];
      const mine = rankOf(i.user.id);
      return i.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(BRAND_COLOR)
            .setTitle(`🏆 Saison de ${monthName(s.month)}`)
            .setDescription(
              (list.map((p, n) => `${medals[n] ?? `**${n + 1}.**`} <@${p.userId}> — ${p.xp.toLocaleString('fr-FR')} XP`).join('\n') || '_Personne n\'a encore gagné d\'XP ce mois-ci._') +
                `\n\n⏳ Fin <t:${end}:R>${mine ? ` · toi : **#${mine}**` : ''}` +
                (last?.top?.[0] ? `\n👑 Champion de ${monthName(last.month)} : <@${last.top[0].userId}>` : ''),
            )
            .setFooter({ text: 'Top 3 : 3000 / 2000 / 1000 両 · 1er : rôle 🏆 Champion du mois' }),
        ],
        allowedMentions: { parse: [] },
      });
    },
  },
];

module.exports = { add, top, rankOf, weekTop, weekRankOf, closeWeek, currentWeek, start, check, close, commands, monthName };
