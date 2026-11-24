/**
 * Économie « ryō » (両) : gagnée en écrivant, en vocal et avec /daily,
 * dépensée dans la boutique (couleurs de pseudo, VIP temporaire…) et en mini-jeux (/duel, /chifoumi).
 */
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits: P,
  SlashCommandBuilder,
} = require('discord.js');
const { BRAND_COLOR, config, findRole } = require('./shared');
const { db, save } = require('./store');
const settings = require('./settings');
const temproles = require('./temproles');

const CUR = '両';
const fmt = (n) => `**${Math.round(n).toLocaleString('fr-FR')}** ${CUR}`;
const ephemeral = (content, extra = {}) => ({ content, flags: MessageFlags.Ephemeral, ...extra });
const wallet = (id) => ((db.economy ??= {})[id] ??= { bal: 0, lastDaily: 0, streak: 0, owned: [] });
const SHOP = () => config.shop ?? [];
const enabled = () => settings.get('economy.enabled') !== false;

function add(id, amount) {
  const w = wallet(id);
  w.bal = Math.max(0, w.bal + amount);
  save();
  return w.bal;
}

// ───────────────────────── Gains automatiques ─────────────────────────

const lastMsg = new Map();
/** Message écrit : 5 à 10 ryō, une fois par minute maximum. */
function onMessage(userId, member = null) {
  if (!enabled()) return;
  const now = Date.now();
  if (now - (lastMsg.get(userId) ?? 0) < 60_000) return;
  lastMsg.set(userId, now);
  earn(userId, (5 + Math.floor(Math.random() * 6)) * require('./boost').multiplier(member, 'ryo'));
}

/** Minute passée en vocal (appelé par src/voicexp.js). */
function onVoiceMinute(userId, member = null) {
  if (enabled()) earn(userId, (settings.get('economy.voicePerMinute') ?? 2) * require('./boost').multiplier(member, 'ryo'));
}

/** Gain « mérité » (compté dans les statistiques du membre), contrairement aux transferts. */
function earn(userId, amount) {
  amount = Math.round(amount);
  add(userId, amount);
  require('./memberstats').bump(userId, 'ryoEarned', amount);
}

// ───────────────────────── Commandes ─────────────────────────

const NARRATION = [
  ['{w} dégaine plus vite que son ombre. {l} n\'a rien vu venir.', '⚔️'],
  ['Sous la lune rouge, la lame de {w} tranche le silence. {l} s\'incline.', '🌕'],
  ['{l} glisse sur un pétale de sakura… {w} en profite.', '🌸'],
  ['Un seul coup. {w} rengaine. {l} tombe à genoux.', '🗡️'],
  ['{w} feinte à gauche, frappe à droite : {l} est désarmé.', '🏯'],
];

function balanceRank(id) {
  const sorted = Object.entries(db.economy ?? {}).sort((a, b) => b[1].bal - a[1].bal);
  const i = sorted.findIndex(([u]) => u === id);
  return i === -1 ? null : i + 1;
}

async function buy(i, item) {
  const member = i.member;
  const w = wallet(i.user.id);
  const role = findRole(i.guild, item.role);
  if (!role) return i.reply(ephemeral('⚠️ Ce rôle n\'existe pas encore : un admin doit lancer `/setup`.'));
  if (!role.editable) return i.reply(ephemeral('⚠️ Le rôle du bot doit être au-dessus de ce rôle.'));
  const owned = w.owned.includes(item.key);
  if (!owned || item.days) {
    if (w.bal < item.price) return i.reply(ephemeral(`💸 Il te manque ${fmt(item.price - w.bal)} pour **${item.name}**.`));
    w.bal -= item.price;
  }
  // Un seul objet équipé par groupe (ex : une seule couleur de pseudo)
  if (item.group) {
    for (const other of SHOP().filter((x) => x.group === item.group && x.key !== item.key)) {
      const r = findRole(i.guild, other.role);
      if (r && member.roles.cache.has(r.id)) await member.roles.remove(r, 'Boutique : changement').catch(() => {});
    }
  }
  if (item.days) {
    const until = await temproles.grant(member, role, item.days * 86_400_000, `Boutique : ${item.name}`);
    save();
    return i.reply(`🛒 ${i.user} achète **${item.name}** jusqu'au <t:${Math.floor(until / 1000)}:f> ! Solde : ${fmt(w.bal)}`);
  }
  await member.roles.add(role, `Boutique : ${item.name}`);
  if (!owned) w.owned.push(item.key);
  save();
  return i.reply(owned ? `🎨 ${i.user} équipe **${item.name}** (déjà acheté).` : `🛒 ${i.user} achète **${item.name}** ! Solde : ${fmt(w.bal)}`);
}

const shopChoices = () => SHOP().slice(0, 25).map((x) => ({ name: `${x.name} — ${x.price} ${CUR}${x.days ? ` (${x.days} j)` : ''}`.slice(0, 100), value: x.key }));

const commands = [
  {
    category: '💰 Ryō & jeux',
    data: new SlashCommandBuilder()
      .setName('bourse')
      .setDescription('Ton solde de ryō (両)')
      .addUserOption((o) => o.setName('membre').setDescription('Un autre membre')),
    run(i) {
      const user = i.options.getUser('membre') ?? i.user;
      const w = wallet(user.id);
      const rank = balanceRank(user.id);
      return i.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(BRAND_COLOR)
            .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
            .setDescription(`💰 ${fmt(w.bal)}${rank ? ` · rang #${rank}` : ''}\n🔥 Série /daily : ${w.streak} jour(s)`),
        ],
      });
    },
  },
  {
    category: '💰 Ryō & jeux',
    data: new SlashCommandBuilder().setName('daily').setDescription('Ta récompense quotidienne (bonus si tu reviens chaque jour)'),
    run(i) {
      if (!enabled()) return i.reply(ephemeral('L\'économie est désactivée.'));
      const w = wallet(i.user.id);
      const now = Date.now();
      const wait = w.lastDaily + 20 * 3600_000 - now;
      if (wait > 0) return i.reply(ephemeral(`⏳ Reviens <t:${Math.floor((now + wait) / 1000)}:R> pour ta prochaine récompense.`));
      w.streak = now - w.lastDaily < 48 * 3600_000 ? Math.min(w.streak + 1, 7) : 1;
      const base = settings.get('economy.daily') ?? 100;
      const grade = require('./levels').gradeDailyBonus(i.member);
      const gain = Math.round((base + (w.streak - 1) * Math.round(base * 0.25) + grade) * require('./boost').multiplier(i.member, 'ryo'));
      w.lastDaily = now;
      w.bal += gain;
      save();
      const stats = require('./memberstats');
      stats.bump(i.user.id, 'ryoEarned', gain);
      stats.max(i.user.id, 'bestStreak', w.streak);
      require('./quests').progress(i.user.id, 'daily');
      return i.reply(`🎁 ${i.user} reçoit ${fmt(gain)}${grade ? ` (dont +${grade} de bonus de grade)` : ''} ! 🔥 Série : ${w.streak}/7 · Solde : ${fmt(w.bal)}`);
    },
  },
  {
    category: '💰 Ryō & jeux',
    data: new SlashCommandBuilder()
      .setName('donner')
      .setDescription('Donner des ryō à un membre')
      .addUserOption((o) => o.setName('membre').setDescription('À qui').setRequired(true))
      .addIntegerOption((o) => o.setName('montant').setDescription('Combien').setRequired(true).setMinValue(1)),
    run(i) {
      const to = i.options.getUser('membre');
      const n = i.options.getInteger('montant');
      if (to.bot || to.id === i.user.id) return i.reply(ephemeral('Choisis un autre membre.'));
      const w = wallet(i.user.id);
      if (w.bal < n) return i.reply(ephemeral(`💸 Tu n'as que ${fmt(w.bal)}.`));
      add(i.user.id, -n);
      add(to.id, n);
      return i.reply({ content: `🤝 ${i.user} donne ${fmt(n)} à ${to}.`, allowedMentions: { users: [to.id] } });
    },
  },
  {
    category: '💰 Ryō & jeux',
    data: new SlashCommandBuilder().setName('richesse').setDescription('Les 10 ronins les plus riches'),
    run(i) {
      const top = Object.entries(db.economy ?? {}).sort((a, b) => b[1].bal - a[1].bal).slice(0, 10);
      const medals = ['🥇', '🥈', '🥉'];
      return i.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(BRAND_COLOR)
            .setTitle('💰 Les plus riches du dojo')
            .setDescription(top.map(([id, w], n) => `${medals[n] ?? `**${n + 1}.**`} <@${id}> — ${fmt(w.bal)}`).join('\n') || '_Personne n\'a encore de ryō._'),
        ],
        allowedMentions: { parse: [] },
      });
    },
  },
  {
    category: '💰 Ryō & jeux',
    data: new SlashCommandBuilder().setName('boutique').setDescription('Voir la boutique du dojo'),
    run(i) {
      const w = wallet(i.user.id);
      const embed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle('🏮 店 ・ Boutique du dojo')
        .setDescription(
          SHOP()
            .map((x) => `**${x.name}** — ${fmt(x.price)}${x.days ? ` · ${x.days} jours` : ''}${w.owned.includes(x.key) ? ' · ✅ possédé' : ''}\n　${x.description ?? ''}`)
            .join('\n\n') || '_La boutique est vide._',
        )
        .setFooter({ text: `Ton solde : ${w.bal} ${CUR} · Achète avec /acheter` });
      return i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
  },
  {
    category: '💰 Ryō & jeux',
    data: new SlashCommandBuilder()
      .setName('acheter')
      .setDescription('Acheter (ou rééquiper) un article de la boutique')
      .addStringOption((o) => o.setName('article').setDescription('L\'article').setRequired(true).addChoices(...shopChoices())),
    run(i) {
      const item = SHOP().find((x) => x.key === i.options.getString('article'));
      if (!item) return i.reply(ephemeral('Article introuvable.'));
      return buy(i, item);
    },
  },
  {
    category: '💰 Ryō & jeux',
    data: new SlashCommandBuilder()
      .setName('duel')
      .setDescription('Défier un membre en duel de samouraïs')
      .addUserOption((o) => o.setName('adversaire').setDescription('Ton adversaire').setRequired(true))
      .addIntegerOption((o) => o.setName('mise').setDescription('Ryō misés par chacun (0 = pour l\'honneur)').setMinValue(0)),
    async run(i) {
      const foe = i.options.getUser('adversaire');
      const bet = i.options.getInteger('mise') ?? 0;
      if (foe.bot || foe.id === i.user.id) return i.reply(ephemeral('Choisis un autre adversaire.'));
      if (bet && wallet(i.user.id).bal < bet) return i.reply(ephemeral(`💸 Tu n'as que ${fmt(wallet(i.user.id).bal)}.`));
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('duel:yes').setLabel('Accepter').setEmoji('⚔️').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('duel:no').setLabel('Refuser').setStyle(ButtonStyle.Secondary),
      );
      await i.reply({ content: `⚔️ ${foe}, ${i.user} te défie en duel${bet ? ` pour ${fmt(bet)}` : ' pour l\'honneur'} ! (60 s)`, components: [row], allowedMentions: { users: [foe.id] } });
      const msg = await i.fetchReply();
      let click;
      try {
        click = await msg.awaitMessageComponent({ filter: (c) => c.user.id === foe.id, time: 60_000 });
      } catch {
        return i.editReply({ content: `⌛ ${foe} n'a pas relevé le défi.`, components: [] });
      }
      if (click.customId === 'duel:no') return click.update({ content: `🙇 ${foe} décline le duel.`, components: [] });
      if (bet && (wallet(foe.id).bal < bet || wallet(i.user.id).bal < bet)) {
        return click.update({ content: '💸 L\'un des deux duellistes n\'a plus assez de ryō.', components: [] });
      }
      const [winner, loser] = Math.random() < 0.5 ? [i.user, foe] : [foe, i.user];
      const stats = require('./memberstats');
      const quests = require('./quests');
      for (const u of [i.user, foe]) {
        stats.bump(u.id, 'duels');
        quests.progress(u.id, 'duel');
      }
      stats.bump(winner.id, 'duelsWon');
      quests.progress(winner.id, 'duelWin');
      if (bet) {
        add(loser.id, -bet);
        add(winner.id, bet);
      }
      const [line, emoji] = NARRATION[Math.floor(Math.random() * NARRATION.length)];
      return click.update({
        content: `${emoji} ${line.replace('{w}', `**${winner.username}**`).replace('{l}', `**${loser.username}**`)}\n🏆 ${winner} remporte le duel${bet ? ` et ${fmt(bet)}` : ''} !`,
        components: [],
        allowedMentions: { users: [winner.id] },
      });
    },
  },
  {
    category: '💰 Ryō & jeux',
    data: new SlashCommandBuilder()
      .setName('chifoumi')
      .setDescription('Pierre-feuille-ciseaux contre le bot')
      .addStringOption((o) =>
        o.setName('choix').setDescription('Ton coup').setRequired(true).addChoices({ name: '🪨 Pierre', value: 'pierre' }, { name: '📄 Feuille', value: 'feuille' }, { name: '✂️ Ciseaux', value: 'ciseaux' }),
      )
      .addIntegerOption((o) => o.setName('mise').setDescription('Ryō misés (0 = pour le fun)').setMinValue(0).setMaxValue(10000)),
    run(i) {
      const me = i.options.getString('choix');
      const bet = i.options.getInteger('mise') ?? 0;
      if (bet && wallet(i.user.id).bal < bet) return i.reply(ephemeral(`💸 Tu n'as que ${fmt(wallet(i.user.id).bal)}.`));
      const moves = ['pierre', 'feuille', 'ciseaux'];
      const icons = { pierre: '🪨', feuille: '📄', ciseaux: '✂️' };
      const bot = moves[Math.floor(Math.random() * 3)];
      const beats = { pierre: 'ciseaux', feuille: 'pierre', ciseaux: 'feuille' };
      const result = me === bot ? 0 : beats[me] === bot ? 1 : -1;
      if (bet && result) add(i.user.id, result * bet);
      require('./quests').progress(i.user.id, 'chifoumi');
      const text = result === 0 ? '🤝 Égalité !' : result > 0 ? `🏆 Tu gagnes${bet ? ` ${fmt(bet)}` : ''} !` : `💀 Perdu${bet ? `, tu perds ${fmt(bet)}` : ''}…`;
      return i.reply(`${icons[me]} contre ${icons[bot]} — ${text}`);
    },
  },
  {
    category: '💰 Ryō & jeux',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('ryo')
      .setDescription('Ajouter ou retirer des ryō à un membre (staff)')
      .setDefaultMemberPermissions(P.ManageGuild)
      .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
      .addIntegerOption((o) => o.setName('montant').setDescription('Positif = ajouter, négatif = retirer').setRequired(true)),
    run(i) {
      const user = i.options.getUser('membre');
      const n = i.options.getInteger('montant');
      const bal = add(user.id, n);
      return i.reply(ephemeral(`${n >= 0 ? '➕' : '➖'} ${fmt(Math.abs(n))} pour ${user}. Nouveau solde : ${fmt(bal)}`));
    },
  },
];

module.exports = { onMessage, onVoiceMinute, add, earn, wallet, commands };
