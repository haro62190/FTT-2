/**
 * 👥 Vie de la communauté :
 *  - 🙏 Réputation : /merci @membre (3 par jour, pas deux fois la même personne dans la journée), /rep
 *  - 🤝 Parrainage : lien d'invitation perso (/parrainage lien), filleuls suivis, récompense quand le filleul s'installe
 *  - 🌟 Membre du mois : score sur plusieurs critères (XP, vocal, réputation, quêtes, entraide, lives),
 *    rôle 🌟 Membre du mois + ryō, annoncé le 1er du mois avec le détail
 */
const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { BRAND_COLOR, findChannel, findRole } = require('./shared');
const { db, save } = require('./store');
const settings = require('./settings');

const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });
const parisDay = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });

// ───────────────────────── Statistiques du mois (membre du mois) ─────────────────────────

const CRITERIA = [
  ['xp', '⚔️ XP gagnée', 1],
  ['voice', '🎙️ Minutes de vocal', 1],
  ['rep', '🙏 Remerciements reçus', 1.5],
  ['quests', '📜 Quêtes terminées', 1],
  ['helps', '💡 Suggestions & entraide', 0.75],
  ['live', '📺 Présence pendant les lives', 0.75],
];
const month = () => (db.monthStats ??= {});

/** +n sur un critère du mois pour un membre (appelé par les autres modules). */
function track(userId, key, n = 1) {
  if (!userId || !n) return;
  const m = (month()[userId] ??= {});
  m[key] = (m[key] ?? 0) + n;
  save();
}

/** Classement du mois : chaque critère est ramené entre 0 et 1 (par rapport au meilleur), puis pondéré. */
function motmRanking() {
  const weights = settings.get('community.motmWeights') ?? {};
  const entries = Object.entries(month());
  const max = Object.fromEntries(CRITERIA.map(([k]) => [k, Math.max(0, ...entries.map(([, m]) => m[k] ?? 0))]));
  return entries
    .map(([userId, m]) => {
      const detail = CRITERIA.map(([k, , w]) => [k, max[k] ? ((m[k] ?? 0) / max[k]) * (weights[k] ?? w) : 0]);
      return { userId, score: Math.round(detail.reduce((n, [, v]) => n + v, 0) * 100) / 100, raw: m };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}

async function closeMonth(guild, label) {
  const ranking = motmRanking();
  const winner = ranking[0];
  const reward = settings.get('community.motmReward') ?? 2000;
  const role = findRole(guild, 'motm');
  if (role?.editable) for (const m of role.members.values()) await m.roles.remove(role, 'Nouveau mois').catch(() => {});
  if (winner) {
    require('./economy').add(winner.userId, reward);
    const member = await guild.members.fetch(winner.userId).catch(() => null);
    if (member && role?.editable) await member.roles.add(role, `Membre du mois de ${label}`).catch(() => {});
    const channel = findChannel(guild, 'announcements') ?? findChannel(guild, 'general');
    const medals = ['🥇', '🥈', '🥉'];
    await channel
      ?.send({
        content: `<@${winner.userId}>`,
        allowedMentions: { users: [winner.userId] },
        embeds: [
          new EmbedBuilder()
            .setColor(0xf5b942)
            .setTitle(`🌟 Membre du mois de ${label}`)
            .setDescription(
              `Bravo <@${winner.userId}> : **${reward} 両** et le rôle ${role ?? '🌟 Membre du mois'} pour tout le mois !\n\n` +
                CRITERIA.map(([k, l]) => `${l} : **${Math.round(winner.raw[k] ?? 0).toLocaleString('fr-FR')}**`).join('\n') +
                `\n\n${ranking
                  .slice(0, 3)
                  .map((r, n) => `${medals[n]} <@${r.userId}> — ${r.score} pts`)
                  .join('\n')}`,
            )
            .setFooter({ text: 'Score : XP, vocal, remerciements, quêtes, entraide et présence en live' }),
        ],
      })
      .catch(() => {});
    require('./feed').push('🌟', `${member?.displayName ?? 'Un ronin'} est le Membre du mois`);
  }
  (db.motmHistory ??= []).unshift({ month: label, winner: winner?.userId ?? null, top: ranking.slice(0, 5).map((r) => ({ userId: r.userId, score: r.score })) });
  db.motmHistory = db.motmHistory.slice(0, 24);
  db.monthStats = {};
  save();
}

// ───────────────────────── Réputation ─────────────────────────

const rep = () => (db.reputation ??= {});
const DAILY_THANKS = 3;

function thank(fromId, toId) {
  if (fromId === toId) throw new Error('Tu ne peux pas te remercier toi-même 😄');
  const day = parisDay();
  const giver = (db.thanksGiven ??= {})[fromId] ?? { day, to: [] };
  if (giver.day !== day) Object.assign(giver, { day, to: [] });
  if (giver.to.includes(toId)) throw new Error('Tu as déjà remercié ce membre aujourd\'hui.');
  if (giver.to.length >= DAILY_THANKS) throw new Error(`Tu as déjà donné tes ${DAILY_THANKS} remerciements du jour.`);
  giver.to.push(toId);
  db.thanksGiven[fromId] = giver;
  const r = (rep()[toId] ??= { points: 0, from: {} });
  r.points++;
  r.from[fromId] = (r.from[fromId] ?? 0) + 1;
  track(toId, 'rep');
  save();
  return r.points;
}

const repBoard = (n = 10) =>
  Object.entries(rep())
    .map(([userId, r]) => ({ userId, points: r.points }))
    .sort((a, b) => b.points - a.points)
    .slice(0, n);

// ───────────────────────── Parrainage ─────────────────────────

const ref = () => (db.referrals ??= { codes: {}, members: {}, uses: {} });

/** À appeler au démarrage et après chaque arrivée : mémorise le nombre d'utilisations de chaque invitation. */
async function snapshotInvites(guild) {
  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) return null;
  const uses = Object.fromEntries(invites.map((inv) => [inv.code, inv.uses ?? 0]));
  const before = ref().uses;
  ref().uses = uses;
  save();
  return before;
}

/** Nouvel arrivant : quelle invitation a servi ? Si c'est un lien de parrainage, le filleul est rattaché. */
async function onJoin(member) {
  if (!settings.on('referrals')) return null;
  const before = await snapshotInvites(member.guild);
  if (!before) return null;
  const used = Object.entries(ref().uses).find(([code, n]) => n > (before[code] ?? 0));
  const sponsor = used && ref().codes[used[0]];
  if (!sponsor || sponsor === member.id || ref().members[member.id]) return null;
  ref().members[member.id] = { sponsor, joinedAt: Date.now(), rewarded: false };
  save();
  member.guild.client.users.send(sponsor, `🤝 **${member.user.username}** vient d'arriver sur ${member.guild.name} grâce à toi ! Tu recevras ta récompense quand il se sera installé (niveau 3).`).catch(() => {});
  return sponsor;
}

/** Récompense du parrain et du filleul quand le filleul atteint le niveau 3 (et est toujours là). */
async function checkReferrals(guild) {
  const reward = settings.get('community.referralReward') ?? 500;
  for (const [userId, r] of Object.entries(ref().members)) {
    if (r.rewarded || require('./levels').rankOf(userId).level < 3) continue;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) continue;
    r.rewarded = Date.now();
    require('./economy').add(r.sponsor, reward);
    require('./economy').add(userId, Math.round(reward / 2));
    save();
    guild.client.users.send(r.sponsor, `🤝 Ton filleul **${member.displayName}** s'est bien installé : **+${reward} 両** pour toi !`).catch(() => {});
    require('./feed').push('🤝', `Parrainage réussi : ${member.displayName}`);
  }
}

const sponsorStats = (userId) => {
  const list = Object.entries(ref().members).filter(([, r]) => r.sponsor === userId);
  return { total: list.length, rewarded: list.filter(([, r]) => r.rewarded).length, list };
};

const currentMonth = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }).slice(0, 7);
/** Le 1er du mois : clôture du Membre du mois précédent. */
async function checkMonth(guild) {
  const now = currentMonth();
  if (db.motmMonth === now) return;
  const previous = db.motmMonth;
  db.motmMonth = now;
  save();
  if (previous && settings.on('motm')) await closeMonth(guild, require('./seasons').monthName(previous));
}

function start(guild) {
  snapshotInvites(guild).catch(() => {});
  checkMonth(guild).catch(() => {});
  setInterval(() => checkMonth(guild).catch((e) => console.error('Membre du mois :', e.message)), 15 * 60_000);
  setInterval(() => checkReferrals(guild).catch((e) => console.error('Parrainage :', e.message)), 10 * 60_000);
}

// ───────────────────────── Commandes ─────────────────────────

const commands = [
  {
    category: '🎉 Général',
    module: 'reputation',
    data: new SlashCommandBuilder()
      .setName('merci')
      .setDescription('Remercier un membre qui t\'a aidé (+1 réputation)')
      .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
      .addStringOption((o) => o.setName('raison').setDescription('Pourquoi ?').setMaxLength(150)),
    run(i) {
      const user = i.options.getUser('membre');
      if (user.bot) return i.reply(ephemeral('Les bots n\'ont pas besoin de réputation 🤖'));
      let points;
      try {
        points = thank(i.user.id, user.id);
      } catch (err) {
        return i.reply(ephemeral(`❌ ${err.message}`));
      }
      const why = i.options.getString('raison');
      return i.reply({ content: `🙏 ${i.user} remercie ${user}${why ? ` : *${why}*` : ''} — réputation : **${points}**`, allowedMentions: { users: [user.id] } });
    },
  },
  {
    category: '🎉 Général',
    module: 'reputation',
    data: new SlashCommandBuilder()
      .setName('rep')
      .setDescription('La réputation d\'un membre et le classement')
      .addUserOption((o) => o.setName('membre').setDescription('Le membre (classement si vide)')),
    run(i) {
      const user = i.options.getUser('membre');
      if (user) {
        const r = rep()[user.id];
        const top = Object.entries(r?.from ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
        return i.reply({ content: `🙏 ${user} a **${r?.points ?? 0}** point(s) de réputation${top.length ? `\nLe plus souvent remercié par : ${top.map(([id, n]) => `<@${id}> (${n})`).join(', ')}` : ''}`, allowedMentions: { parse: [] } });
      }
      const board = repBoard();
      return i.reply({
        embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('🙏 Les ronins les plus remerciés').setDescription(board.map((b, k) => `**${k + 1}.** <@${b.userId}> — ${b.points}`).join('\n') || '_Personne pour l\'instant : /merci @membre_')],
        allowedMentions: { parse: [] },
      });
    },
  },
  {
    category: '🎉 Général',
    module: 'referrals',
    data: new SlashCommandBuilder()
      .setName('parrainage')
      .setDescription('Invite tes amis et gagne des ryō')
      .addSubcommand((s) => s.setName('lien').setDescription('Ton lien d\'invitation personnel'))
      .addSubcommand((s) => s.setName('stats').setDescription('Tes filleuls')),
    async run(i) {
      const reward = settings.get('community.referralReward') ?? 500;
      if (i.options.getSubcommand() === 'stats') {
        const s = sponsorStats(i.user.id);
        return i.reply(ephemeral(`🤝 Filleuls : **${s.total}** (dont ${s.rewarded} installés et récompensés)\n${s.list.slice(0, 15).map(([id, r]) => `${r.rewarded ? '✅' : '⏳'} <@${id}>`).join('\n')}`));
      }
      const existing = Object.entries(ref().codes).find(([, u]) => u === i.user.id)?.[0];
      let code = existing;
      if (existing) {
        const still = await i.guild.invites.fetch(existing).catch(() => null);
        if (!still) code = null;
      }
      if (!code) {
        const channel = findChannel(i.guild, 'welcome') ?? findChannel(i.guild, 'rules') ?? i.channel;
        const inv = await channel.createInvite({ maxAge: 0, maxUses: 0, unique: true, reason: `Parrainage de ${i.user.username}` }).catch(() => null);
        if (!inv) return i.reply(ephemeral('❌ Impossible de créer le lien (permission « Créer une invitation » manquante au bot).'));
        code = inv.code;
        ref().codes[code] = i.user.id;
        ref().uses[code] = 0;
        save();
      }
      return i.reply(ephemeral(`🤝 Ton lien de parrainage : https://discord.gg/${code}\nQuand un ami arrive avec ce lien et atteint le niveau 3 : **${reward} 両** pour toi et **${Math.round(reward / 2)} 両** pour lui !`));
    },
  },
  {
    category: '⭐ Niveaux',
    data: new SlashCommandBuilder().setName('membre-du-mois').setDescription('Le classement provisoire du Membre du mois'),
    run(i) {
      const ranking = motmRanking().slice(0, 10);
      const last = db.motmHistory?.[0];
      return i.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xf5b942)
            .setTitle('🌟 Membre du mois — classement provisoire')
            .setDescription(
              (ranking.map((r, k) => `**${k + 1}.** <@${r.userId}> — ${r.score} pts`).join('\n') || '_Rien pour l\'instant ce mois-ci._') +
                `\n\nCritères : ${CRITERIA.map(([, l]) => l).join(' · ')}` +
                (last?.winner ? `\n👑 Dernier Membre du mois (${last.month}) : <@${last.winner}>` : ''),
            ),
        ],
        allowedMentions: { parse: [] },
      });
    },
  },
];

module.exports = { checkMonth, CRITERIA, track, motmRanking, closeMonth, thank, repBoard, onJoin, snapshotInvites, checkReferrals, sponsorStats, start, commands };
