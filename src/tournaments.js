/**
 * 🏆 Tournois : inscriptions (solo ou par équipe), tableau à élimination directe, résultats, prix en ryō,
 * classement Elo du jeu mis à jour à chaque match. Publiés dans 🏆┃tournois, gérés aussi depuis le site.
 */
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionFlagsBits: P, SlashCommandBuilder } = require('discord.js');
const { BRAND_COLOR, findChannel } = require('./shared');
const { db, save } = require('./store');

const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });
const all = () => (db.tournaments ??= {});
const STATUS = { open: '🟢 Inscriptions ouvertes', running: '⚔️ En cours', done: '🏁 Terminé', cancelled: '⛔ Annulé' };

function create({ name, game, teamSize = 1, max = 16, startsAt = null, prize = 0, by = null }) {
  const id = `t${Date.now().toString(36)}`;
  const t = {
    id,
    name: String(name).slice(0, 80),
    game: String(game).slice(0, 40),
    teamSize: Math.min(5, Math.max(1, teamSize)),
    max: Math.min(64, Math.max(2, max)),
    startsAt,
    prize: Math.max(0, prize),
    by,
    status: 'open',
    entrants: [],
    rounds: [],
    createdAt: Date.now(),
  };
  all()[id] = t;
  save();
  return t;
}

const entrantName = (t, eid) => t.entrants.find((e) => e.id === eid)?.name ?? '—';
const isIn = (t, userId) => t.entrants.find((e) => e.members.includes(userId));

/** Inscription : `members` = IDs (le premier est le capitaine). */
function register(t, { name, members }) {
  if (t.status !== 'open') throw new Error('Les inscriptions sont fermées.');
  if (t.entrants.length >= t.max) throw new Error('Le tournoi est complet.');
  const uniq = [...new Set(members)];
  if (uniq.length !== t.teamSize) throw new Error(`Il faut exactement ${t.teamSize} joueur(s) par équipe.`);
  for (const id of uniq) if (isIn(t, id)) throw new Error(`<@${id}> est déjà inscrit.`);
  const e = { id: `e${t.entrants.length + 1}${Math.random().toString(36).slice(2, 5)}`, name: String(name).slice(0, 40), members: uniq };
  t.entrants.push(e);
  save();
  return e;
}

function unregister(t, userId) {
  if (t.status !== 'open') throw new Error('Le tournoi a déjà commencé.');
  const e = isIn(t, userId);
  if (!e) throw new Error('Tu n\'es pas inscrit.');
  t.entrants = t.entrants.filter((x) => x !== e);
  save();
  return e;
}

/** Tableau à élimination directe : places complétées par des exemptions (byes) au 1er tour. */
function start(t) {
  if (t.status !== 'open') throw new Error('Le tournoi n\'est pas en phase d\'inscription.');
  if (t.entrants.length < 2) throw new Error('Il faut au moins 2 inscrits.');
  const seeded = t.entrants
    .map((e) => ({ e, elo: e.members.reduce((n, id) => n + require('./gaming').ratingOf(t.game, id).elo, 0) / e.members.length, r: Math.random() }))
    .sort((a, b) => b.elo - a.elo || a.r - b.r)
    .map((x) => x.e.id);
  let size = 2;
  while (size < seeded.length) size *= 2;
  // Placement classique : 1 contre le dernier, etc. ; les meilleurs têtes de série profitent des byes
  const slots = Array(size).fill(null);
  const order = bracketOrder(size);
  seeded.forEach((id, k) => (slots[order[k]] = id));
  const first = [];
  for (let k = 0; k < size; k += 2) first.push({ id: `r1m${k / 2 + 1}`, a: slots[k], b: slots[k + 1], winner: null });
  t.rounds = [first];
  for (let r = 2, n = size / 4; n >= 1; r++, n /= 2) t.rounds.push(Array.from({ length: n }, (_, k) => ({ id: `r${r}m${k + 1}`, a: null, b: null, winner: null })));
  t.status = 'running';
  // Byes : qualifiés d'office
  for (const m of first) if (!m.a || !m.b) advance(t, m, m.a ?? m.b, { silent: true });
  save();
  return t;
}

/** Ordre des têtes de série dans le tableau (1 et 2 ne se croisent qu'en finale). */
function bracketOrder(size) {
  let order = [0];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((x) => [x, n - 1 - x]);
  }
  // order[k] = position du seed k
  const pos = Array(size);
  order.forEach((seed, p) => (pos[seed] = p));
  return pos;
}

function findMatch(t, matchId) {
  for (const [r, round] of t.rounds.entries()) {
    const k = round.findIndex((m) => m.id === matchId);
    if (k !== -1) return { r, k, m: round[k] };
  }
  return null;
}

/** Valide le gagnant d'un match et le qualifie pour le suivant. Renvoie le champion si c'était la finale. */
function advance(t, m, winnerId, { silent = false } = {}) {
  const loc = findMatch(t, m.id);
  if (!loc) throw new Error('Match introuvable.');
  if (winnerId && winnerId !== m.a && winnerId !== m.b) throw new Error('Ce gagnant ne joue pas ce match.');
  m.winner = winnerId;
  if (!silent && m.a && m.b && winnerId) {
    const loser = winnerId === m.a ? m.b : m.a;
    const members = (eid) => t.entrants.find((e) => e.id === eid)?.members ?? [];
    require('./gaming').recordMatch(t.game, members(winnerId), members(loser));
  }
  const next = t.rounds[loc.r + 1];
  if (!next) {
    t.status = 'done';
    t.champion = winnerId;
    t.endedAt = Date.now();
    save();
    return winnerId;
  }
  const nm = next[Math.floor(loc.k / 2)];
  nm[loc.k % 2 === 0 ? 'a' : 'b'] = winnerId;
  // L'adversaire est un bye : qualification directe
  const sibling = t.rounds[loc.r][loc.k % 2 === 0 ? loc.k + 1 : loc.k - 1];
  if (sibling && sibling.winner === null && !sibling.a && !sibling.b) advance(t, nm, winnerId, { silent: true });
  save();
  return null;
}

const pending = (t) => t.rounds.flat().filter((m) => m.a && m.b && !m.winner);
const roundName = (t, r) => {
  const left = t.rounds.length - r;
  return left === 1 ? 'Finale' : left === 2 ? 'Demi-finales' : left === 3 ? 'Quarts de finale' : `Tour ${r + 1}`;
};

function payload(t) {
  const e = new EmbedBuilder()
    .setColor(t.status === 'done' ? 0xffc400 : BRAND_COLOR)
    .setTitle(`🏆 ${t.name}`)
    .setDescription(
      `🎮 **${t.game}** · ${t.teamSize === 1 ? 'solo' : `équipes de ${t.teamSize}`} · ${t.entrants.length}/${t.max} inscrits\n` +
        `${STATUS[t.status]}${t.startsAt ? ` · début <t:${Math.floor(t.startsAt / 1000)}:F>` : ''}${t.prize ? `\n💰 Prix : **${t.prize} 両** pour le vainqueur` : ''}` +
        (t.champion ? `\n\n👑 **Vainqueur : ${entrantName(t, t.champion)}** ${t.entrants.find((x) => x.id === t.champion)?.members.map((id) => `<@${id}>`).join(' ')}` : ''),
    );
  if (t.status === 'open') {
    e.addFields({ name: 'Inscrits', value: t.entrants.map((x) => (t.teamSize === 1 ? `<@${x.members[0]}>` : `**${x.name}** (${x.members.map((id) => `<@${id}>`).join(' ')})`)).join('\n').slice(0, 1024) || '_Personne pour l\'instant._' });
  } else {
    for (const [r, round] of t.rounds.entries()) {
      const lines = round
        .filter((m) => m.a || m.b)
        .map((m) => {
          const name = (x) => (x ? (m.winner === x ? `**${entrantName(t, x)}** ✅` : entrantName(t, x)) : r ? '_à déterminer_' : '_exempt_');
          return `\`${m.id}\` ${name(m.a)} vs ${name(m.b)}`;
        });
      if (lines.length) e.addFields({ name: roundName(t, r), value: lines.join('\n').slice(0, 1024) });
    }
  }
  const components =
    t.status === 'open'
      ? [
          new ActionRowBuilder().addComponents(
            ...(t.teamSize === 1 ? [new ButtonBuilder().setCustomId(`tn:join:${t.id}`).setLabel('S\'inscrire').setEmoji('⚔️').setStyle(ButtonStyle.Success)] : []),
            new ButtonBuilder().setCustomId(`tn:leave:${t.id}`).setLabel('Se désinscrire').setStyle(ButtonStyle.Secondary),
          ),
        ]
      : [];
  if (t.status === 'open' && t.teamSize > 1) e.setFooter({ text: `Inscription d'équipe : /tournoi equipe tournoi:${t.name}` });
  return { embeds: [e], components, allowedMentions: { parse: [] } };
}

async function publish(guild, t) {
  const channel = findChannel(guild, 'tournaments');
  if (!channel) return null;
  const msg = t.messageId && (await channel.messages.fetch(t.messageId).catch(() => null));
  if (msg) return msg.edit(payload(t));
  const sent = await channel.send(payload(t));
  t.messageId = sent.id;
  save();
  return sent;
}

/** Fin de tournoi : prix en ryō, annonce, fil d'événements. */
async function finish(guild, t) {
  const champ = t.entrants.find((e) => e.id === t.champion);
  if (champ && t.prize) {
    const share = Math.floor(t.prize / champ.members.length);
    for (const id of champ.members) require('./economy').add(id, share);
  }
  require('./feed').push('🏆', `${champ?.name ?? '?'} remporte le tournoi ${t.name}`);
  for (const id of champ?.members ?? []) require('./feed').member(id, '🏆', `Vainqueur du tournoi ${t.name}`);
  const channel = findChannel(guild, 'tournaments');
  await channel
    ?.send({ content: `👑 **${champ?.name}** remporte **${t.name}** ! ${champ?.members.map((id) => `<@${id}>`).join(' ')}${t.prize ? ` (+${t.prize} 両)` : ''}`, allowedMentions: { users: champ?.members ?? [] } })
    .catch(() => {});
}

/** Résultat d'un match (commande ou site). */
async function report(guild, t, matchId, winnerId) {
  const loc = findMatch(t, matchId);
  if (!loc || !loc.m.a || !loc.m.b) throw new Error('Match introuvable ou pas encore prêt.');
  if (loc.m.winner) throw new Error('Ce match a déjà un résultat.');
  const champion = advance(t, loc.m, winnerId);
  await publish(guild, t).catch(() => {});
  if (champion) await finish(guild, t);
  return champion;
}

const find = (q) => all()[q] ?? Object.values(all()).find((t) => t.name.toLowerCase() === String(q).toLowerCase()) ?? null;

async function handleInteraction(i) {
  const id = i.customId ?? '';
  if (!id.startsWith('tn:')) return false;
  const [, action, tid] = id.split(':');
  const t = all()[tid];
  if (!t) {
    await i.reply(ephemeral('Tournoi introuvable.'));
    return true;
  }
  try {
    if (action === 'join') register(t, { name: i.member?.displayName ?? i.user.username, members: [i.user.id] });
    else unregister(t, i.user.id);
  } catch (err) {
    await i.reply(ephemeral(`❌ ${err.message}`));
    return true;
  }
  await i.update(payload(t));
  return true;
}

function autocomplete(i) {
  const focused = i.options.getFocused(true);
  if (focused.name === 'match') {
    const t = find(i.options.getString('tournoi'));
    return i.respond(
      t ? pending(t).slice(0, 25).map((m) => ({ name: `${m.id} : ${entrantName(t, m.a)} vs ${entrantName(t, m.b)}`.slice(0, 100), value: m.id })) : [],
    );
  }
  if (focused.name === 'gagnant') {
    const t = find(i.options.getString('tournoi'));
    const m = t && findMatch(t, i.options.getString('match'))?.m;
    return i.respond(m ? [m.a, m.b].filter(Boolean).map((x) => ({ name: entrantName(t, x).slice(0, 100), value: x })) : []);
  }
  if (focused.name === 'jeu') return require('./gaming').autocompleteGames(i);
  const q = String(focused.value).toLowerCase();
  return i.respond(
    Object.values(all())
      .filter((t) => t.status !== 'done' && t.status !== 'cancelled' && t.name.toLowerCase().includes(q))
      .slice(0, 25)
      .map((t) => ({ name: `${t.name} (${t.game}) — ${STATUS[t.status]}`.slice(0, 100), value: t.id })),
  );
}

const commands = [
  {
    category: '🎮 Gaming',
    module: 'tournaments',
    data: new SlashCommandBuilder()
      .setName('tournoi')
      .setDescription('Les tournois de la commu')
      .addSubcommand((s) =>
        s
          .setName('voir')
          .setDescription('Voir un tournoi (tableau et résultats)')
          .addStringOption((o) => o.setName('tournoi').setDescription('Le tournoi').setRequired(true).setAutocomplete(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('equipe')
          .setDescription('Inscrire ton équipe (tu es le capitaine)')
          .addStringOption((o) => o.setName('tournoi').setDescription('Le tournoi').setRequired(true).setAutocomplete(true))
          .addStringOption((o) => o.setName('nom').setDescription('Nom de l\'équipe').setRequired(true).setMaxLength(40))
          .addUserOption((o) => o.setName('joueur2').setDescription('Coéquipier'))
          .addUserOption((o) => o.setName('joueur3').setDescription('Coéquipier'))
          .addUserOption((o) => o.setName('joueur4').setDescription('Coéquipier'))
          .addUserOption((o) => o.setName('joueur5').setDescription('Coéquipier')),
      ),
    autocomplete,
    async run(i) {
      const t = find(i.options.getString('tournoi'));
      if (!t) return i.reply(ephemeral('Tournoi introuvable.'));
      if (i.options.getSubcommand() === 'voir') return i.reply(payload(t));
      const mates = ['joueur2', 'joueur3', 'joueur4', 'joueur5'].map((k) => i.options.getUser(k)).filter((u) => u && !u.bot);
      try {
        register(t, { name: i.options.getString('nom'), members: [i.user.id, ...mates.map((u) => u.id)] });
      } catch (err) {
        return i.reply(ephemeral(`❌ ${err.message}`));
      }
      await publish(i.guild, t).catch(() => {});
      return i.reply(ephemeral(`✅ Équipe **${i.options.getString('nom')}** inscrite à ${t.name} !`));
    },
  },
  {
    category: '🎮 Gaming',
    module: 'tournaments',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('tournoi-admin')
      .setDescription('Organiser un tournoi (staff)')
      .setDefaultMemberPermissions(P.ManageEvents)
      .addSubcommand((s) =>
        s
          .setName('creer')
          .setDescription('Créer un tournoi et ouvrir les inscriptions')
          .addStringOption((o) => o.setName('nom').setDescription('Nom du tournoi').setRequired(true).setMaxLength(80))
          .addStringOption((o) => o.setName('jeu').setDescription('Le jeu').setRequired(true).setMaxLength(40).setAutocomplete(true))
          .addIntegerOption((o) => o.setName('taille').setDescription('Joueurs par équipe (1 = solo)').setMinValue(1).setMaxValue(5))
          .addIntegerOption((o) => o.setName('places').setDescription('Nombre d\'équipes max (16 par défaut)').setMinValue(2).setMaxValue(64))
          .addStringOption((o) => o.setName('date').setDescription('Début : JJ/MM/AAAA HH:MM'))
          .addIntegerOption((o) => o.setName('prix').setDescription('Ryō pour le vainqueur').setMinValue(0).setMaxValue(1_000_000)),
      )
      .addSubcommand((s) =>
        s
          .setName('lancer')
          .setDescription('Fermer les inscriptions et générer le tableau')
          .addStringOption((o) => o.setName('tournoi').setDescription('Le tournoi').setRequired(true).setAutocomplete(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('resultat')
          .setDescription('Valider le gagnant d\'un match')
          .addStringOption((o) => o.setName('tournoi').setDescription('Le tournoi').setRequired(true).setAutocomplete(true))
          .addStringOption((o) => o.setName('match').setDescription('Le match').setRequired(true).setAutocomplete(true))
          .addStringOption((o) => o.setName('gagnant').setDescription('Le gagnant').setRequired(true).setAutocomplete(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('annuler')
          .setDescription('Annuler un tournoi')
          .addStringOption((o) => o.setName('tournoi').setDescription('Le tournoi').setRequired(true).setAutocomplete(true)),
      ),
    autocomplete,
    async run(i) {
      const sub = i.options.getSubcommand();
      if (sub === 'creer') {
        const dateStr = i.options.getString('date');
        const date = dateStr ? require('./admin').parisDate(dateStr) : null;
        if (dateStr && !date) return i.reply(ephemeral('❌ Date invalide. Format : `25/12/2026 20:30`'));
        const t = create({
          name: i.options.getString('nom'),
          game: i.options.getString('jeu'),
          teamSize: i.options.getInteger('taille') ?? 1,
          max: i.options.getInteger('places') ?? 16,
          startsAt: date?.getTime() ?? null,
          prize: i.options.getInteger('prix') ?? 0,
          by: i.user.id,
        });
        const msg = await publish(i.guild, t);
        require('./feed').push('🏆', `Tournoi créé : ${t.name} (${t.game})`);
        return i.reply(ephemeral(`✅ Tournoi créé${msg ? ` : ${msg.url}` : ' (salon 🏆┃tournois absent : lance /setup)'}`));
      }
      const t = find(i.options.getString('tournoi'));
      if (!t) return i.reply(ephemeral('Tournoi introuvable.'));
      try {
        if (sub === 'lancer') {
          start(t);
          await publish(i.guild, t);
          const ids = t.entrants.flatMap((e) => e.members);
          await findChannel(i.guild, 'tournaments')
            ?.send({ content: `⚔️ **${t.name}** commence ! ${ids.map((id) => `<@${id}>`).join(' ')}\nRegardez le tableau ci-dessus pour vos matchs.`.slice(0, 2000), allowedMentions: { users: ids.slice(0, 100) } })
            .catch(() => {});
          return i.reply(ephemeral('✅ Tableau généré et publié.'));
        }
        if (sub === 'resultat') {
          const champion = await report(i.guild, t, i.options.getString('match'), i.options.getString('gagnant'));
          return i.reply(ephemeral(champion ? `👑 Finale validée : **${entrantName(t, champion)}** remporte le tournoi !` : '✅ Résultat enregistré, tableau mis à jour.'));
        }
        if (sub === 'annuler') {
          t.status = 'cancelled';
          save();
          await publish(i.guild, t).catch(() => {});
          return i.reply(ephemeral('⛔ Tournoi annulé.'));
        }
      } catch (err) {
        return i.reply(ephemeral(`❌ ${err.message}`));
      }
      return null;
    },
  },
];

module.exports = { all, create, register, unregister, start, advance, report, findMatch, pending, payload, publish, find, entrantName, roundName, STATUS, handleInteraction, commands };
