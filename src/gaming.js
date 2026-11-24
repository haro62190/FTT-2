/**
 * 🎮 Gaming : profils joueurs (plateformes, disponibilités, jeux, pseudos), recherche de coéquipiers,
 * équipes automatiques équilibrées (avec vocaux d'équipe), classements compétitifs Elo par jeu.
 */
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits: P,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { BRAND_COLOR, findChannel } = require('./shared');
const { db, save } = require('./store');

const PLATFORMS = [
  ['pc', '🖥️ PC'],
  ['ps', '🎮 PlayStation'],
  ['xbox', '🟩 Xbox'],
  ['switch', '🔴 Switch'],
  ['mobile', '📱 Mobile'],
];
const AVAIL = [
  ['matin', '🌅 Matin'],
  ['aprem', '☀️ Après-midi'],
  ['soir', '🌆 Soir'],
  ['nuit', '🌙 Nuit'],
  ['semaine', '📅 En semaine'],
  ['weekend', '🎉 Le week-end'],
];
const TAGS = [
  ['psn', 'PSN'],
  ['xbox', 'Xbox'],
  ['steam', 'Steam / PC'],
  ['activision', 'Activision'],
  ['epic', 'Epic / Riot / autre'],
];
const LFG_HOURS = 3;
const ELO_START = 1000;
const K = 32;

const ephemeral = (content, extra = {}) => ({ content, flags: MessageFlags.Ephemeral, ...extra });
const label = (list, key) => list.find(([k]) => k === key)?.[1] ?? key;
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const players = () => (db.players ??= {});
const profile = (id) => (players()[id] ??= { platforms: [], availability: [], games: [], tags: {} });

/** Joueurs qui ont ce jeu (et cette plateforme / dispo si précisées) dans leur profil. */
function findPlayers({ game = null, platform = null, availability = null } = {}) {
  const g = norm(game);
  return Object.entries(players())
    .filter(([, p]) => (!g || p.games.some((x) => norm(x).includes(g) || g.includes(norm(x)))) && (!platform || p.platforms.includes(platform)) && (!availability || p.availability.includes(availability)))
    .map(([userId, p]) => ({ userId, ...p }));
}

function profileEmbed(user, p) {
  const tags = TAGS.filter(([k]) => p.tags?.[k]).map(([k, l]) => `**${l}** : \`${p.tags[k]}\``);
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setAuthor({ name: `Profil joueur de ${user.displayName ?? user.username}`, iconURL: user.displayAvatarURL?.() })
    .addFields(
      { name: '🎮 Plateformes', value: p.platforms.map((k) => label(PLATFORMS, k)).join(' · ') || '—', inline: true },
      { name: '🕒 Disponibilités', value: p.availability.map((k) => label(AVAIL, k)).join(' · ') || '—', inline: true },
      { name: '🕹️ Jeux', value: p.games.join(' · ').slice(0, 1024) || '—' },
      { name: '🏷️ Pseudos', value: tags.join('\n') || '—' },
      ...ratingsOf(user.id).map((r) => ({ name: `🏆 ${r.game}`, value: `${r.elo} Elo · ${r.w} V / ${r.l} D`, inline: true })).slice(0, 6),
    );
}

function profileEditor(userId) {
  const p = profile(userId);
  return {
    content: '🎮 **Ton profil joueur** — choisis tes plateformes et tes disponibilités, puis ajoute tes jeux et pseudos.',
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('gp:platforms')
          .setPlaceholder('Tes plateformes')
          .setMinValues(0)
          .setMaxValues(PLATFORMS.length)
          .addOptions(PLATFORMS.map(([value, l]) => ({ label: l, value, default: p.platforms.includes(value) }))),
      ),
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('gp:avail')
          .setPlaceholder('Quand tu joues')
          .setMinValues(0)
          .setMaxValues(AVAIL.length)
          .addOptions(AVAIL.map(([value, l]) => ({ label: l, value, default: p.availability.includes(value) }))),
      ),
      new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('gp:games').setLabel('Jeux & pseudos').setEmoji('🕹️').setStyle(ButtonStyle.Primary)),
    ],
    flags: MessageFlags.Ephemeral,
  };
}

// ───────────────────────── Recherche de joueurs ─────────────────────────

const lfgs = () => (db.lfg ??= {});

function lfgPayload(l) {
  const full = l.joined.length >= l.slots;
  const open = !l.closed && Date.now() < l.expiresAt;
  const matches = findPlayers({ game: l.game, platform: l.platform })
    .filter((p) => p.userId !== l.author && !l.joined.includes(p.userId))
    .slice(0, 8);
  return {
    content: open && !full ? `🎮 <@${l.author}> cherche ${l.slots - l.joined.length} joueur(s) !` : null,
    allowedMentions: { parse: [] },
    embeds: [
      new EmbedBuilder()
        .setColor(open ? BRAND_COLOR : 0x3a3a3a)
        .setTitle(`🎮 ${l.game}${l.platform ? ` · ${label(PLATFORMS, l.platform)}` : ''}${open ? '' : ' — terminé'}`)
        .setDescription(
          `${l.note ? `> ${l.note}\n\n` : ''}👥 **Équipe** (${l.joined.length + 1}/${l.slots + 1}) : <@${l.author}>${l.joined.map((id) => ` · <@${id}>`).join('')}\n` +
            (open ? `⏳ Fin de la recherche <t:${Math.floor(l.expiresAt / 1000)}:R>` : '') +
            (open && matches.length ? `\n\n💡 Ont ce jeu dans leur profil : ${matches.map((m) => `<@${m.userId}>`).join(' ')}` : ''),
        ),
    ],
    components: open
      ? [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('lfg:join').setLabel(full ? 'Complet' : 'Je viens').setEmoji('✋').setStyle(ButtonStyle.Success).setDisabled(full),
            new ButtonBuilder().setCustomId('lfg:leave').setLabel('Me retirer').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('lfg:close').setLabel('Fermer').setStyle(ButtonStyle.Danger),
          ),
        ]
      : [],
  };
}

// ───────────────────────── Classements Elo ─────────────────────────

const ratings = () => (db.ratings ??= {});
const gameKey = (game) => norm(game) || 'autre';
const ratingOf = (game, userId) => {
  const g = (ratings()[gameKey(game)] ??= { name: game, players: {} });
  return (g.players[userId] ??= { elo: ELO_START, w: 0, l: 0 });
};

/** Résultat d'un match (équipes = listes d'IDs). Met à jour l'Elo de chaque joueur. */
function recordMatch(game, winners, losers) {
  const avg = (ids) => ids.reduce((n, id) => n + ratingOf(game, id).elo, 0) / Math.max(1, ids.length);
  const ew = 1 / (1 + 10 ** ((avg(losers) - avg(winners)) / 400));
  const delta = Math.max(1, Math.round(K * (1 - ew)));
  for (const id of winners) Object.assign(ratingOf(game, id), { elo: ratingOf(game, id).elo + delta, w: ratingOf(game, id).w + 1 });
  for (const id of losers) Object.assign(ratingOf(game, id), { elo: Math.max(100, ratingOf(game, id).elo - delta), l: ratingOf(game, id).l + 1 });
  save();
  return delta;
}

function leaderboard(game, n = 10) {
  const g = ratings()[gameKey(game)];
  if (!g) return [];
  return Object.entries(g.players)
    .map(([userId, r]) => ({ userId, ...r }))
    .sort((a, b) => b.elo - a.elo)
    .slice(0, n);
}

function ratingsOf(userId) {
  return Object.values(ratings())
    .filter((g) => g.players[userId])
    .map((g) => ({ game: g.name, ...g.players[userId] }))
    .sort((a, b) => b.elo - a.elo);
}

const gamesWithRatings = () => Object.values(ratings()).map((g) => g.name);

// ───────────────────────── Équipes automatiques ─────────────────────────

/** Répartit les joueurs en équipes équilibrées (draft en serpentin sur l'Elo du jeu, sinon au hasard). */
function makeTeams(ids, size, game = null) {
  const pool = [...new Set(ids)];
  const count = Math.max(2, Math.ceil(pool.length / size));
  const sorted = game
    ? pool.map((id) => ({ id, elo: ratingOf(game, id).elo, r: Math.random() })).sort((a, b) => b.elo - a.elo || a.r - b.r).map((x) => x.id)
    : pool.map((id) => ({ id, r: Math.random() })).sort((a, b) => a.r - b.r).map((x) => x.id);
  const teams = Array.from({ length: count }, () => []);
  sorted.forEach((id, k) => {
    const round = Math.floor(k / count);
    const pos = k % count;
    teams[round % 2 === 0 ? pos : count - 1 - pos].push(id);
  });
  return teams.filter((t) => t.length);
}

const teamVoices = () => (db.teamVoices ??= []);

async function createTeamVoices(guild, teams, parentId) {
  const created = [];
  for (const [k, team] of teams.entries()) {
    const ch = await guild.channels.create({ name: `⚔️ Équipe ${k + 1}`, type: ChannelType.GuildVoice, parent: parentId ?? undefined, reason: 'Équipes automatiques' });
    teamVoices().push(ch.id);
    created.push(ch);
    for (const id of team) {
      const m = guild.members.cache.get(id) ?? (await guild.members.fetch(id).catch(() => null));
      if (m?.voice?.channelId) await m.voice.setChannel(ch, 'Équipes automatiques').catch(() => {});
    }
  }
  save();
  return created;
}

/** Supprime les vocaux d'équipe vides. */
async function onVoiceStateUpdate(oldState) {
  const id = oldState.channelId;
  if (!id || !teamVoices().includes(id)) return;
  const ch = oldState.guild.channels.cache.get(id);
  if (ch && ch.members.size) return;
  db.teamVoices = teamVoices().filter((x) => x !== id);
  save();
  await ch?.delete('Vocal d\'équipe vide').catch(() => {});
}

// ───────────────────────── Interactions ─────────────────────────

async function handleInteraction(i) {
  const id = i.customId ?? '';
  if (id === 'gp:platforms' || id === 'gp:avail') {
    const p = profile(i.user.id);
    p[id === 'gp:platforms' ? 'platforms' : 'availability'] = i.values;
    p.updatedAt = Date.now();
    save();
    await i.update(profileEditor(i.user.id));
    return true;
  }
  if (id === 'gp:games') {
    const p = profile(i.user.id);
    const modal = new ModalBuilder().setCustomId('gp:gamesModal').setTitle('Tes jeux et pseudos');
    const input = (cid, l, value, style = TextInputStyle.Short, max = 60) =>
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(cid).setLabel(l).setStyle(style).setRequired(false).setMaxLength(max).setValue(String(value ?? '')));
    modal.addComponents(
      input('games', 'Tes jeux (séparés par des virgules)', p.games.join(', '), TextInputStyle.Paragraph, 400),
      input('psn', 'Pseudo PSN', p.tags.psn),
      input('xbox', 'Gamertag Xbox', p.tags.xbox),
      input('steam', 'Steam / PC', p.tags.steam),
      input('activision', 'Activision / Epic / Riot', p.tags.activision ?? p.tags.epic),
    );
    await i.showModal(modal);
    return true;
  }
  if (id === 'gp:gamesModal') {
    const p = profile(i.user.id);
    const v = (k) => i.fields.getTextInputValue(k).trim().slice(0, 60);
    p.games = [...new Set(i.fields.getTextInputValue('games').split(/[,\n]+/).map((g) => g.trim().slice(0, 40)).filter(Boolean))].slice(0, 20);
    p.tags = { psn: v('psn'), xbox: v('xbox'), steam: v('steam'), activision: v('activision') };
    p.updatedAt = Date.now();
    save();
    await i.reply(ephemeral('✅ Profil enregistré ! Les autres te trouveront avec `/joueurs`.', { embeds: [profileEmbed(i.member ?? i.user, p)] }));
    return true;
  }
  if (id.startsWith('lfg:')) {
    const l = lfgs()[i.message.id];
    if (!l || l.closed || Date.now() > l.expiresAt) {
      if (l) {
        l.closed = true;
        save();
        await i.update(lfgPayload(l));
      } else await i.reply(ephemeral('Cette recherche est terminée.'));
      return true;
    }
    const action = id.slice(4);
    if (action === 'close') {
      const isStaff = require('./shared').isStaffMember(i.member);
      if (i.user.id !== l.author && !isStaff) {
        await i.reply(ephemeral('Seul l\'auteur de la recherche peut la fermer.'));
        return true;
      }
      l.closed = true;
    } else if (action === 'join') {
      if (i.user.id === l.author || l.joined.includes(i.user.id)) {
        await i.reply(ephemeral('Tu fais déjà partie de cette équipe.'));
        return true;
      }
      if (l.joined.length >= l.slots) {
        await i.reply(ephemeral('C\'est complet !'));
        return true;
      }
      l.joined.push(i.user.id);
      i.client.users
        .send(l.author, `🎮 <@${i.user.id}> rejoint ta recherche **${l.game}** sur ${i.guild.name} !`)
        .catch(() => {});
    } else if (action === 'leave') {
      l.joined = l.joined.filter((x) => x !== i.user.id);
    }
    save();
    await i.update(lfgPayload(l));
    return true;
  }
  if (id === 'teams:voice') {
    const t = db.lastTeams?.[i.message.id];
    if (!t) {
      await i.reply(ephemeral('Ces équipes ont expiré, relance /equipes.'));
      return true;
    }
    if (i.user.id !== t.by && !require('./shared').isStaffMember(i.member)) {
      await i.reply(ephemeral('Seule la personne qui a lancé /equipes peut créer les vocaux.'));
      return true;
    }
    await i.deferUpdate();
    const parent = findChannel(i.guild, 'voice_create')?.parentId ?? null;
    const created = await createTeamVoices(i.guild, t.teams, parent);
    delete db.lastTeams[i.message.id];
    save();
    await i.editReply({ components: [] });
    await i.followUp({ content: `🔊 Vocaux créés : ${created.map((c) => `${c}`).join(' · ')} (supprimés quand ils sont vides).` });
    return true;
  }
  return false;
}

// ───────────────────────── Commandes ─────────────────────────

const platformChoices = PLATFORMS.map(([value, name]) => ({ name, value }));
const availChoices = AVAIL.map(([value, name]) => ({ name, value }));

function autocompleteGames(i) {
  const q = norm(i.options.getFocused());
  const all = new Map();
  for (const p of Object.values(players())) for (const g of p.games) all.set(norm(g), g);
  for (const g of gamesWithRatings()) all.set(norm(g), g);
  return i.respond(
    [...all.entries()]
      .filter(([k]) => !q || k.includes(q))
      .slice(0, 25)
      .map(([, g]) => ({ name: g.slice(0, 100), value: g.slice(0, 100) })),
  );
}

const commands = [
  {
    category: '🎮 Gaming',
    module: 'gaming',
    data: new SlashCommandBuilder()
      .setName('joueur')
      .setDescription('Ton profil joueur (plateformes, disponibilités, jeux, pseudos)')
      .addSubcommand((s) => s.setName('profil').setDescription('Créer ou modifier ton profil joueur'))
      .addSubcommand((s) =>
        s
          .setName('voir')
          .setDescription('Voir le profil joueur d\'un membre')
          .addUserOption((o) => o.setName('membre').setDescription('Le membre (toi par défaut)')),
      ),
    run(i) {
      if (i.options.getSubcommand() === 'profil') return i.reply(profileEditor(i.user.id));
      const user = i.options.getUser('membre') ?? i.user;
      const p = players()[user.id];
      if (!p) return i.reply(ephemeral(user.id === i.user.id ? 'Tu n\'as pas encore de profil : `/joueur profil`.' : 'Ce membre n\'a pas encore de profil joueur.'));
      return i.reply({ embeds: [profileEmbed(i.options.getMember('membre') ?? user, p)] });
    },
  },
  {
    category: '🎮 Gaming',
    module: 'gaming',
    data: new SlashCommandBuilder()
      .setName('recherche')
      .setDescription('Chercher des coéquipiers (posté dans 🎮┃recherche-joueurs)')
      .addStringOption((o) => o.setName('jeu').setDescription('Le jeu').setRequired(true).setMaxLength(40).setAutocomplete(true))
      .addIntegerOption((o) => o.setName('places').setDescription('Combien de joueurs tu cherches').setRequired(true).setMinValue(1).setMaxValue(15))
      .addStringOption((o) => o.setName('plateforme').setDescription('Plateforme').addChoices(...platformChoices))
      .addStringOption((o) => o.setName('message').setDescription('Ex. « ranked, micro obligatoire »').setMaxLength(150)),
    autocomplete: autocompleteGames,
    async run(i) {
      const channel = findChannel(i.guild, 'lfg') ?? i.channel;
      const l = {
        author: i.user.id,
        game: i.options.getString('jeu').trim(),
        platform: i.options.getString('plateforme'),
        slots: i.options.getInteger('places'),
        note: i.options.getString('message') ?? '',
        joined: [],
        expiresAt: Date.now() + LFG_HOURS * 3600_000,
      };
      const msg = await channel.send(lfgPayload(l));
      lfgs()[msg.id] = { ...l, channelId: channel.id };
      // Nettoyage des anciennes recherches
      for (const [k, v] of Object.entries(lfgs())) if (Date.now() - v.expiresAt > 86_400_000) delete lfgs()[k];
      save();
      return i.reply(ephemeral(`✅ Recherche publiée : ${msg.url}`));
    },
  },
  {
    category: '🎮 Gaming',
    module: 'gaming',
    data: new SlashCommandBuilder()
      .setName('joueurs')
      .setDescription('Trouver des membres qui jouent à un jeu')
      .addStringOption((o) => o.setName('jeu').setDescription('Le jeu').setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName('plateforme').setDescription('Plateforme').addChoices(...platformChoices))
      .addStringOption((o) => o.setName('dispo').setDescription('Disponibilité').addChoices(...availChoices)),
    autocomplete: autocompleteGames,
    run(i) {
      const list = findPlayers({ game: i.options.getString('jeu'), platform: i.options.getString('plateforme'), availability: i.options.getString('dispo') });
      return i.reply(
        ephemeral(null, {
          embeds: [
            new EmbedBuilder()
              .setColor(BRAND_COLOR)
              .setTitle(`🎮 Joueurs : ${i.options.getString('jeu')}`)
              .setDescription(
                list
                  .slice(0, 25)
                  .map((p) => `<@${p.userId}> — ${p.platforms.map((k) => label(PLATFORMS, k)).join(', ') || '?'}${p.availability.length ? ` · ${p.availability.map((k) => label(AVAIL, k)).join(', ')}` : ''}`)
                  .join('\n') || '_Personne pour l\'instant. Remplis ton profil avec `/joueur profil` !_',
              ),
          ],
        }),
      );
    },
  },
  {
    category: '🎮 Gaming',
    module: 'gaming',
    data: new SlashCommandBuilder()
      .setName('equipes')
      .setDescription('Faire des équipes équilibrées avec les joueurs de ton vocal')
      .addIntegerOption((o) => o.setName('taille').setDescription('Joueurs par équipe').setRequired(true).setMinValue(1).setMaxValue(10))
      .addStringOption((o) => o.setName('jeu').setDescription('Pour équilibrer avec le classement Elo de ce jeu').setAutocomplete(true))
      .addStringOption((o) => o.setName('joueurs').setDescription('Ou mentionne les joueurs (@a @b @c…)').setMaxLength(1000)),
    autocomplete: autocompleteGames,
    async run(i) {
      const game = i.options.getString('jeu');
      const mentioned = [...(i.options.getString('joueurs') ?? '').matchAll(/<@!?(\d{17,20})>/g)].map((m) => m[1]);
      const voice = i.member?.voice?.channel;
      const ids = mentioned.length ? mentioned : voice ? [...voice.members.filter((m) => !m.user.bot).keys()] : [];
      if (ids.length < 2) return i.reply(ephemeral('Rejoins un vocal avec tes potes, ou mentionne au moins 2 joueurs avec l\'option `joueurs`.'));
      const teams = makeTeams(ids, i.options.getInteger('taille'), game);
      const embed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle(`⚔️ Équipes${game ? ` — ${game}` : ''}`)
        .addFields(
          teams.map((t, k) => ({
            name: `Équipe ${k + 1}${game ? ` · ${Math.round(t.reduce((n, id) => n + ratingOf(game, id).elo, 0) / t.length)} Elo moy.` : ''}`,
            value: t.map((id) => `<@${id}>`).join('\n'),
            inline: true,
          })),
        )
        .setFooter({ text: game ? 'Équilibrées avec le classement Elo du jeu' : 'Tirées au hasard' });
      const canVoice = voice && i.guild.members.me.permissions.has(P.ManageChannels) && i.guild.members.me.permissions.has(P.MoveMembers);
      await i.reply({
        embeds: [embed],
        allowedMentions: { parse: [] },
        components: canVoice ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('teams:voice').setLabel('Créer un vocal par équipe').setEmoji('🔊').setStyle(ButtonStyle.Primary))] : [],
      });
      if (canVoice) {
        const msg = await i.fetchReply();
        (db.lastTeams ??= {})[msg.id] = { teams, by: i.user.id, at: Date.now() };
        for (const [k, v] of Object.entries(db.lastTeams)) if (Date.now() - v.at > 3600_000) delete db.lastTeams[k];
        save();
      }
    },
  },
  {
    category: '🎮 Gaming',
    module: 'gaming',
    data: new SlashCommandBuilder()
      .setName('classement-jeu')
      .setDescription('Le classement compétitif (Elo) d\'un jeu')
      .addStringOption((o) => o.setName('jeu').setDescription('Le jeu').setRequired(true).setAutocomplete(true)),
    autocomplete: autocompleteGames,
    run(i) {
      const game = i.options.getString('jeu');
      const list = leaderboard(game);
      const medals = ['🥇', '🥈', '🥉'];
      return i.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(BRAND_COLOR)
            .setTitle(`🏆 Classement ${ratings()[gameKey(game)]?.name ?? game}`)
            .setDescription(list.map((r, k) => `${medals[k] ?? `**${k + 1}.**`} <@${r.userId}> — **${r.elo}** Elo · ${r.w} V / ${r.l} D`).join('\n') || '_Aucun match enregistré pour ce jeu._')
            .setFooter({ text: 'Les matchs de tournoi et /match comptent pour l\'Elo' }),
        ],
        allowedMentions: { parse: [] },
      });
    },
  },
  {
    category: '🎮 Gaming',
    module: 'gaming',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('match')
      .setDescription('Enregistrer le résultat d\'un match pour le classement (staff)')
      .setDefaultMemberPermissions(P.ManageMessages)
      .addStringOption((o) => o.setName('jeu').setDescription('Le jeu').setRequired(true).setMaxLength(40).setAutocomplete(true))
      .addStringOption((o) => o.setName('gagnants').setDescription('@joueurs gagnants').setRequired(true))
      .addStringOption((o) => o.setName('perdants').setDescription('@joueurs perdants').setRequired(true)),
    autocomplete: autocompleteGames,
    run(i) {
      const ids = (k) => [...new Set([...i.options.getString(k).matchAll(/<@!?(\d{17,20})>/g)].map((m) => m[1]))];
      const w = ids('gagnants');
      const l = ids('perdants').filter((x) => !w.includes(x));
      if (!w.length || !l.length) return i.reply(ephemeral('Mentionne au moins un gagnant et un perdant.'));
      const game = i.options.getString('jeu').trim();
      const delta = recordMatch(game, w, l);
      require('./feed').push('🏆', `Match ${game} : ${w.length > 1 ? 'équipe' : 'victoire'} (+${delta} Elo)`);
      return i.reply({ content: `🏆 **${game}** : ${w.map((x) => `<@${x}>`).join(' ')} +${delta} Elo · ${l.map((x) => `<@${x}>`).join(' ')} −${delta} Elo`, allowedMentions: { parse: [] } });
    },
  },
];

module.exports = {
  PLATFORMS,
  AVAIL,
  profile,
  findPlayers,
  makeTeams,
  recordMatch,
  ratingOf,
  leaderboard,
  ratingsOf,
  lfgPayload,
  onVoiceStateUpdate,
  handleInteraction,
  autocompleteGames,
  commands,
};
