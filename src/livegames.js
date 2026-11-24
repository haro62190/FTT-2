/**
 * 🎲 Jeux du live (dans 🎲┃jeux-du-live) :
 *  - Quiz : boutons de réponse, ryō pour les bonnes réponses (bonus pour les 3 plus rapides), banque de questions
 *  - Pronostics : les membres misent leurs ryō sur une issue ; le pot est partagé entre les gagnants
 *  - Votes : barres de résultats mises à jour en direct, chacun peut changer d'avis
 * Tout reprend après un redémarrage du bot (fin programmée enregistrée).
 */
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits: P,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { BRAND_COLOR, findChannel } = require('./shared');
const { db, save } = require('./store');

const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });
const games = () => (db.liveGames ??= {});
const bank = () => (db.quizBank ??= []);
const LETTERS = ['🇦', '🇧', '🇨', '🇩', '🇪'];
const timers = new Map();
let clientRef = null;

const bar = (n, total, width = 16) => {
  const f = total ? Math.round((n / total) * width) : 0;
  return `${'█'.repeat(f)}${'░'.repeat(width - f)}`;
};
const shuffle = (list) => list.map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
const wallet = (id) => require('./economy').wallet(id);

// ───────────────────────── Rendu ─────────────────────────

function render(g) {
  const open = !g.ended && !g.locked;
  const end = `<t:${Math.floor(g.endsAt / 1000)}:R>`;
  const e = new EmbedBuilder().setColor(g.ended ? 0x3a3a3a : BRAND_COLOR);
  let buttons = [];
  if (g.type === 'quiz') {
    const counts = g.options.map((_, k) => Object.values(g.answers).filter((a) => a.choice === k).length);
    const total = counts.reduce((n, c) => n + c, 0);
    e.setTitle(`🧠 Quiz${g.ended ? ' — terminé' : ''}`).setDescription(
      `**${g.question}**\n\n` +
        g.options
          .map((o, k) => {
            const ok = g.ended && k === g.correct;
            return `${LETTERS[k]} ${ok ? `**${o}** ✅` : o}${g.ended ? `\n\`${bar(counts[k], total)}\` ${counts[k]}` : ''}`;
          })
          .join('\n') +
        (g.ended
          ? `\n\n🏆 ${g.winners?.length ? `${g.winners.length} bonne(s) réponse(s) : ${g.winners.slice(0, 15).map((id) => `<@${id}>`).join(' ')}` : 'Personne n\'a trouvé !'}`
          : `\n\n💰 ${g.reward} 両 par bonne réponse (+50 % pour les 3 plus rapides) · fin ${end} · ${total} réponse(s)`),
    );
    if (open) buttons = g.options.map((o, k) => new ButtonBuilder().setCustomId(`lg:q:${k}`).setLabel(o.slice(0, 80)).setEmoji(LETTERS[k]).setStyle(ButtonStyle.Secondary));
  } else if (g.type === 'vote') {
    const counts = g.options.map((_, k) => Object.values(g.votes).filter((v) => v === k).length);
    const total = counts.reduce((n, c) => n + c, 0);
    const best = Math.max(...counts);
    e.setTitle(`🗳️ Vote${g.ended ? ' — résultat' : ''}`).setDescription(
      `**${g.question}**\n\n` +
        g.options
          .map((o, k) => `${LETTERS[k]} ${g.ended && counts[k] === best && best ? `**${o}** 👑` : o}\n\`${bar(counts[k], total)}\` ${counts[k]} (${total ? Math.round((counts[k] / total) * 100) : 0} %)`)
          .join('\n') +
        `\n\n${g.ended ? `${total} votant(s)` : `${total} votant(s) · fin ${end} · tu peux changer d'avis`}`,
    );
    if (open) buttons = g.options.map((o, k) => new ButtonBuilder().setCustomId(`lg:v:${k}`).setLabel(o.slice(0, 80)).setEmoji(LETTERS[k]).setStyle(ButtonStyle.Primary));
  } else if (g.type === 'prono') {
    const pools = g.options.map((_, k) => Object.values(g.bets).filter((b) => b.choice === k).reduce((n, b) => n + b.amount, 0));
    const total = pools.reduce((n, c) => n + c, 0);
    e.setTitle(`🔮 Pronostic${g.ended ? ' — résultat' : g.locked ? ' — paris fermés' : ''}`).setDescription(
      `**${g.question}**\n\n` +
        g.options
          .map((o, k) => {
            const ratio = pools[k] ? (total / pools[k]).toFixed(2).replace('.', ',') : '—';
            const win = g.ended && g.result === k;
            return `${LETTERS[k]} ${win ? `**${o}** ✅` : o}\n\`${bar(pools[k], total)}\` ${pools[k].toLocaleString('fr-FR')} 両 · cote ${ratio}`;
          })
          .join('\n') +
        `\n\n💰 Pot : **${total.toLocaleString('fr-FR')} 両** · ${Object.keys(g.bets).length} parieur(s)` +
        (g.ended ? (g.result === null ? '\n↩️ Annulé : tout le monde a été remboursé.' : `\n🏆 ${g.payoutText ?? ''}`) : g.locked ? '\n🔒 En attente du résultat…' : `\n⏳ Paris ouverts jusqu'à ${end}`),
    );
    if (open) buttons = g.options.map((o, k) => new ButtonBuilder().setCustomId(`lg:p:${k}`).setLabel(`Miser : ${o}`.slice(0, 80)).setEmoji(LETTERS[k]).setStyle(ButtonStyle.Success));
  }
  return { embeds: [e], components: buttons.length ? [new ActionRowBuilder().addComponents(buttons)] : [], allowedMentions: { parse: [] } };
}

async function refresh(g) {
  const ch = clientRef?.channels.cache.get(g.channelId);
  const msg = ch && (await ch.messages.fetch(g.messageId).catch(() => null));
  await msg?.edit(render(g)).catch(() => {});
}

// Mises à jour groupées (évite d'éditer le message à chaque clic)
const pendingRefresh = new Map();
function scheduleRefresh(g) {
  if (pendingRefresh.has(g.messageId)) return;
  pendingRefresh.set(
    g.messageId,
    setTimeout(() => {
      pendingRefresh.delete(g.messageId);
      refresh(g);
    }, 2500),
  );
}

// ───────────────────────── Fin des jeux ─────────────────────────

/** Quiz : récompense les bonnes réponses. Renvoie la liste des gagnants (dans l'ordre de réponse). */
function finishQuiz(g) {
  const right = Object.entries(g.answers)
    .filter(([, a]) => a.choice === g.correct)
    .sort((a, b) => a[1].at - b[1].at)
    .map(([id]) => id);
  right.forEach((id, k) => {
    const amount = Math.round(g.reward * (k < 3 ? 1.5 : 1));
    require('./economy').add(id, amount);
    require('./memberstats').bump(id, 'ryoEarned', amount);
    require('./memberstats').bump(id, 'quizWins');
  });
  g.winners = right;
  return right;
}

/** Pronostic : partage du pot entre les gagnants au prorata de leur mise (pari mutuel). */
function settleProno(g, result) {
  const bets = Object.entries(g.bets);
  if (result === null) {
    for (const [id, b] of bets) require('./economy').add(id, b.amount);
    g.result = null;
    return [];
  }
  const total = bets.reduce((n, [, b]) => n + b.amount, 0);
  const winners = bets.filter(([, b]) => b.choice === result);
  const winPool = winners.reduce((n, [, b]) => n + b.amount, 0);
  g.result = result;
  if (!winPool) {
    // Personne n'a misé sur la bonne issue : tout le monde est remboursé
    for (const [id, b] of bets) require('./economy').add(id, b.amount);
    g.payoutText = 'Personne n\'avait misé sur cette issue : tout le monde est remboursé.';
    return [];
  }
  const payouts = winners.map(([id, b]) => [id, Math.floor((total * b.amount) / winPool)]);
  for (const [id, amount] of payouts) {
    require('./economy').add(id, amount);
    require('./memberstats').bump(id, 'ryoEarned', Math.max(0, amount - g.bets[id].amount));
  }
  const best = payouts.sort((a, b) => b[1] - a[1])[0];
  g.payoutText = `${payouts.length} gagnant(s) se partagent ${total.toLocaleString('fr-FR')} 両${best ? ` · meilleur gain : <@${best[0]}> +${best[1].toLocaleString('fr-FR')} 両` : ''}`;
  return payouts;
}

async function expire(id) {
  timers.delete(id);
  const g = games()[id];
  if (!g || g.ended) return;
  if (g.type === 'prono') {
    if (!g.locked) {
      g.locked = true;
      save();
      await refresh(g);
    }
    return; // le résultat est donné par le staff
  }
  if (g.type === 'quiz') finishQuiz(g);
  g.ended = true;
  save();
  await refresh(g);
}

function arm(id) {
  const g = games()[id];
  if (!g || g.ended || (g.type === 'prono' && g.locked)) return;
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => expire(id).catch((e) => console.error('Jeux du live :', e.message)), Math.max(0, g.endsAt - Date.now())));
}

function start(client) {
  clientRef = client;
  for (const id of Object.keys(games())) arm(id);
  // Ménage : jeux terminés depuis plus de 7 jours
  for (const [id, g] of Object.entries(games())) if (g.ended && Date.now() - g.endsAt > 7 * 86_400_000) delete games()[id];
  save();
}

async function launch(i, g) {
  const channel = findChannel(i.guild, 'live_games') ?? i.channel;
  const msg = await channel.send(render(g));
  g.messageId = msg.id;
  g.channelId = channel.id;
  games()[msg.id] = g;
  save();
  arm(msg.id);
  return msg;
}

// ───────────────────────── Interactions ─────────────────────────

async function handleInteraction(i) {
  const id = i.customId ?? '';
  if (!id.startsWith('lg:')) return false;
  const [, kind, raw] = id.split(':');
  if (kind === 'bet') {
    // Formulaire de mise
    const g = games()[raw];
    const choice = Number(i.customId.split(':')[3]);
    if (!g || g.ended || g.locked || Date.now() > g.endsAt) {
      await i.reply(ephemeral('🔒 Les paris sont fermés.'));
      return true;
    }
    const amount = Math.floor(Number(i.fields.getTextInputValue('amount').replace(/\s/g, '')));
    if (!Number.isFinite(amount) || amount < 10) {
      await i.reply(ephemeral('❌ Mise minimum : 10 両.'));
      return true;
    }
    const prev = g.bets[i.user.id];
    if (prev && prev.choice !== choice) {
      await i.reply(ephemeral(`Tu as déjà misé sur **${g.options[prev.choice]}** : tu peux seulement ajouter des ryō sur ce choix.`));
      return true;
    }
    if (wallet(i.user.id).bal < amount) {
      await i.reply(ephemeral(`💸 Tu n'as que ${wallet(i.user.id).bal} 両.`));
      return true;
    }
    require('./economy').add(i.user.id, -amount);
    g.bets[i.user.id] = { choice, amount: (prev?.amount ?? 0) + amount, at: Date.now() };
    save();
    scheduleRefresh(g);
    await i.reply(ephemeral(`🔮 Mise enregistrée : **${g.bets[i.user.id].amount} 両** sur **${g.options[choice]}**.`));
    return true;
  }
  const g = games()[i.message.id];
  const choice = Number(raw);
  if (!g || g.ended || g.locked || Date.now() > g.endsAt) {
    await i.reply(ephemeral('⌛ C\'est terminé !'));
    return true;
  }
  if (kind === 'q') {
    if (g.answers[i.user.id]) {
      await i.reply(ephemeral('Tu as déjà répondu à ce quiz.'));
      return true;
    }
    g.answers[i.user.id] = { choice, at: Date.now() };
    save();
    scheduleRefresh(g);
    await i.reply(ephemeral(`📝 Réponse **${g.options[choice]}** enregistrée. Résultat ${`<t:${Math.floor(g.endsAt / 1000)}:R>`} !`));
    return true;
  }
  if (kind === 'v') {
    g.votes[i.user.id] = choice;
    save();
    scheduleRefresh(g);
    await i.reply(ephemeral(`🗳️ Vote pour **${g.options[choice]}** enregistré.`));
    return true;
  }
  if (kind === 'p') {
    const modal = new ModalBuilder()
      .setCustomId(`lg:bet:${i.message.id}:${choice}`)
      .setTitle(`Miser sur : ${g.options[choice]}`.slice(0, 45))
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('amount').setLabel(`Combien de ryō ? (tu as ${wallet(i.user.id).bal})`.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(9).setPlaceholder('100'),
        ),
      );
    await i.showModal(modal);
    return true;
  }
  return false;
}

// ───────────────────────── Commandes ─────────────────────────

const pronoAutocomplete = (i) => {
  const q = String(i.options.getFocused()).toLowerCase();
  return i.respond(
    Object.values(games())
      .filter((g) => g.type === 'prono' && !g.ended && g.question.toLowerCase().includes(q))
      .slice(0, 25)
      .map((g) => ({ name: `${g.locked ? '🔒' : '⏳'} ${g.question}`.slice(0, 100), value: g.messageId })),
  );
};

const commands = [
  {
    category: '📺 Stream',
    module: 'liveGames',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('quiz')
      .setDescription('Lancer un quiz pendant le live (staff)')
      .setDefaultMemberPermissions(P.ManageMessages)
      .addSubcommand((s) =>
        s
          .setName('lancer')
          .setDescription('Poser une question')
          .addStringOption((o) => o.setName('question').setDescription('La question').setRequired(true).setMaxLength(250))
          .addStringOption((o) => o.setName('bonne').setDescription('La bonne réponse').setRequired(true).setMaxLength(80))
          .addStringOption((o) => o.setName('mauvaise1').setDescription('Mauvaise réponse').setRequired(true).setMaxLength(80))
          .addStringOption((o) => o.setName('mauvaise2').setDescription('Mauvaise réponse').setMaxLength(80))
          .addStringOption((o) => o.setName('mauvaise3').setDescription('Mauvaise réponse').setMaxLength(80))
          .addIntegerOption((o) => o.setName('secondes').setDescription('Temps pour répondre (30 par défaut)').setMinValue(10).setMaxValue(600))
          .addIntegerOption((o) => o.setName('recompense').setDescription('Ryō par bonne réponse (50 par défaut)').setMinValue(0).setMaxValue(10000))
          .addBooleanOption((o) => o.setName('garder').setDescription('Ajouter aussi cette question à la banque')),
      )
      .addSubcommand((s) =>
        s
          .setName('hasard')
          .setDescription('Poser une question au hasard de la banque')
          .addIntegerOption((o) => o.setName('secondes').setDescription('Temps pour répondre').setMinValue(10).setMaxValue(600))
          .addIntegerOption((o) => o.setName('recompense').setDescription('Ryō par bonne réponse').setMinValue(0).setMaxValue(10000)),
      ),
    async run(i) {
      let q;
      if (i.options.getSubcommand() === 'hasard') {
        if (!bank().length) return i.reply(ephemeral('La banque de questions est vide : ajoute-en avec `/quiz lancer … garder:True` ou sur le site.'));
        q = bank()[Math.floor(Math.random() * bank().length)];
      } else {
        q = {
          question: i.options.getString('question'),
          correct: i.options.getString('bonne'),
          wrong: ['mauvaise1', 'mauvaise2', 'mauvaise3'].map((k) => i.options.getString(k)).filter(Boolean),
        };
        if (i.options.getBoolean('garder')) {
          bank().push(q);
          save();
        }
      }
      const options = shuffle([q.correct, ...q.wrong]).slice(0, 5);
      const g = { type: 'quiz', question: q.question, options, correct: options.indexOf(q.correct), reward: i.options.getInteger('recompense') ?? 50, answers: {}, endsAt: Date.now() + (i.options.getInteger('secondes') ?? 30) * 1000, by: i.user.id };
      const msg = await launch(i, g);
      return i.reply(ephemeral(`🧠 Quiz lancé : ${msg.url}`));
    },
  },
  {
    category: '📺 Stream',
    module: 'liveGames',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('vote')
      .setDescription('Lancer un vote pendant le live (staff)')
      .setDefaultMemberPermissions(P.ManageMessages)
      .addStringOption((o) => o.setName('question').setDescription('La question').setRequired(true).setMaxLength(250))
      .addStringOption((o) => o.setName('choix1').setDescription('Choix 1').setRequired(true).setMaxLength(80))
      .addStringOption((o) => o.setName('choix2').setDescription('Choix 2').setRequired(true).setMaxLength(80))
      .addStringOption((o) => o.setName('choix3').setDescription('Choix 3').setMaxLength(80))
      .addStringOption((o) => o.setName('choix4').setDescription('Choix 4').setMaxLength(80))
      .addStringOption((o) => o.setName('choix5').setDescription('Choix 5').setMaxLength(80))
      .addIntegerOption((o) => o.setName('minutes').setDescription('Durée (2 par défaut)').setMinValue(1).setMaxValue(1440)),
    async run(i) {
      const options = ['choix1', 'choix2', 'choix3', 'choix4', 'choix5'].map((k) => i.options.getString(k)).filter(Boolean);
      const g = { type: 'vote', question: i.options.getString('question'), options, votes: {}, endsAt: Date.now() + (i.options.getInteger('minutes') ?? 2) * 60_000, by: i.user.id };
      const msg = await launch(i, g);
      return i.reply(ephemeral(`🗳️ Vote lancé : ${msg.url}`));
    },
  },
  {
    category: '📺 Stream',
    module: 'liveGames',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('prono')
      .setDescription('Pronostics en ryō pendant le live (staff)')
      .setDefaultMemberPermissions(P.ManageMessages)
      .addSubcommand((s) =>
        s
          .setName('creer')
          .setDescription('Ouvrir les paris')
          .addStringOption((o) => o.setName('question').setDescription('Ex. « Top 1 sur cette game ? »').setRequired(true).setMaxLength(250))
          .addStringOption((o) => o.setName('choix1').setDescription('Issue 1').setRequired(true).setMaxLength(60))
          .addStringOption((o) => o.setName('choix2').setDescription('Issue 2').setRequired(true).setMaxLength(60))
          .addStringOption((o) => o.setName('choix3').setDescription('Issue 3').setMaxLength(60))
          .addStringOption((o) => o.setName('choix4').setDescription('Issue 4').setMaxLength(60))
          .addIntegerOption((o) => o.setName('minutes').setDescription('Temps pour parier (3 par défaut)').setMinValue(1).setMaxValue(120)),
      )
      .addSubcommand((s) =>
        s
          .setName('resultat')
          .setDescription('Donner la bonne issue et payer les gagnants')
          .addStringOption((o) => o.setName('prono').setDescription('Le pronostic').setRequired(true).setAutocomplete(true))
          .addIntegerOption((o) => o.setName('gagnant').setDescription('Numéro de l\'issue gagnante (1, 2, 3 ou 4)').setRequired(true).setMinValue(1).setMaxValue(4)),
      )
      .addSubcommand((s) =>
        s
          .setName('annuler')
          .setDescription('Annuler et rembourser tout le monde')
          .addStringOption((o) => o.setName('prono').setDescription('Le pronostic').setRequired(true).setAutocomplete(true)),
      ),
    autocomplete: pronoAutocomplete,
    async run(i) {
      const sub = i.options.getSubcommand();
      if (sub === 'creer') {
        const options = ['choix1', 'choix2', 'choix3', 'choix4'].map((k) => i.options.getString(k)).filter(Boolean);
        const g = { type: 'prono', question: i.options.getString('question'), options, bets: {}, locked: false, endsAt: Date.now() + (i.options.getInteger('minutes') ?? 3) * 60_000, by: i.user.id };
        const msg = await launch(i, g);
        return i.reply(ephemeral(`🔮 Paris ouverts : ${msg.url}`));
      }
      const g = games()[i.options.getString('prono')];
      if (!g || g.type !== 'prono' || g.ended) return i.reply(ephemeral('Pronostic introuvable ou déjà terminé.'));
      clearTimeout(timers.get(g.messageId));
      if (sub === 'annuler') settleProno(g, null);
      else {
        const k = i.options.getInteger('gagnant') - 1;
        if (!g.options[k]) return i.reply(ephemeral(`Il n'y a que ${g.options.length} issues.`));
        settleProno(g, k);
      }
      g.locked = true;
      g.ended = true;
      save();
      await refresh(g);
      require('./feed').push('🔮', `Pronostic terminé : ${g.question}`);
      return i.reply(ephemeral('✅ Pronostic terminé, gains versés.'));
    },
  },
];

module.exports = { render, finishQuiz, settleProno, start, handleInteraction, bank, games, commands };
