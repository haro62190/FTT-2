/**
 * Guide des commandes, généré à partir des commandes du bot (toujours à jour) :
 *  - 📖┃guide        : guide des membres (publié par /setup)
 *  - 📘┃guide-staff  : guide du staff
 *  - /guide          : le guide en message privé éphémère
 *  - docs/GUIDE.md   : version écrite (npm run guide)
 */
const { EmbedBuilder, MessageFlags, PermissionFlagsBits: P, SlashCommandBuilder, ApplicationCommandOptionType: T } = require('discord.js');
const { BRAND_COLOR, findChannel } = require('./shared');

// Ordre et présentation des catégories
const MEMBER_CATEGORIES = ['🎉 Général', '⭐ Niveaux', '💰 Ryō & jeux', '🎉 Animation', '🎵 Musique', '🎮 Gaming', '📺 Stream', '📊 Statistiques', '🎫 Tickets'];

/** « /play musique: [source:] » ou une ligne par sous-commande */
function usage(cmd) {
  const j = cmd.data.toJSON();
  const opts = (list = []) => list.map((o) => (o.required ? `${o.name}:` : `[${o.name}:]`)).join(' ');
  const subs = (j.options ?? []).filter((o) => o.type === T.Subcommand);
  if (!subs.length) return [{ text: `/${j.name}${j.options?.length ? ` ${opts(j.options)}` : ''}`, desc: j.description }];
  return subs.map((s) => ({ text: `/${j.name} ${s.name}${s.options?.length ? ` ${opts(s.options)}` : ''}`, desc: s.description }));
}

function sections(audience) {
  const { commands } = require('./commands');
  const isMember = (c) => !c.staff;
  const pick = commands.filter((c) => (audience === 'staff' ? c.staff : isMember(c)) && c.data.name !== 'aide');
  const groups = new Map();
  for (const c of pick) {
    if (!groups.has(c.category)) groups.set(c.category, []);
    groups.get(c.category).push(...usage(c));
  }
  const order = (cat) => {
    const i = MEMBER_CATEGORIES.indexOf(cat);
    return i === -1 ? 99 : i;
  };
  return [...groups.entries()].sort((a, b) => order(a[0]) - order(b[0]));
}

const prefix = () => require('./custom').PREFIX();
const customList = () => Object.keys(require('./store').db.customCommands ?? {}).sort();

// ───────────────────────── Textes écrits à la main ─────────────────────────

function intro(guild) {
  const ch = (key, fallback) => (guild && findChannel(guild, key)) ?? fallback;
  return [
    `**Bienvenue chez ${guild?.name ?? 'Les Ronins de haro62190'} !** Voici tout ce que tu peux faire ici. ⚔️`,
    '',
    '**🚪 Pour commencer**',
    `1. Lis le ${ch('rules', '#règlement')} et clique sur **Je prête serment**, puis réussis le petit test (clique sur le bon emoji).`,
    `2. Choisis tes notifications et tes rôles dans ${ch('roles', '#rôles')} (🔴 lives, 📱 TikTok, 📢 annonces…).`,
    `3. Viens dire bonjour dans ${ch('general', '#discussion')} !`,
    '',
    '**⚔️ XP et niveaux** — tu gagnes de l\'XP en écrivant (1 fois par minute) et en vocal. Les grades arrivent tout seuls : 🗡️ Ashigaru (niv. 5), ⚔️ Samouraï (niv. 15), 🏯 Daimyō (niv. 30).',
    '**🏆 Saisons** — chaque mois, le top 3 de l\'XP gagne des ryō et le premier devient 🏆 Champion du mois.',
    '**💰 Ryō (両)** — la monnaie du dojo : gagnée en écrivant, en vocal, avec `/daily` et les `/quetes`, à dépenser dans la `/boutique` (couleurs de pseudo, VIP…), en duel ou en pronostic pendant les lives.',
    '**📜 Quêtes** — `/quetes` : 3 quêtes par jour et 3 par semaine, payées en ryō.',
    '**🌟 Distinctions** — 🔥 Pilier de la semaine (le plus actif de la semaine) et 🌟 Membre du mois (XP, vocal, remerciements, quêtes, entraide, présence en live) : `/membre-du-mois`.',
    '**📊 Ton profil** — `/profil` et `/rang` pour tes stats, `/top` pour les classements.',
    '',
    'Tape `/` dans n\'importe quel salon pour voir toutes les commandes, ou `/guide` pour relire ce guide.',
  ].join('\n');
}

function features(guild) {
  const ch = (key, fallback) => (guild && findChannel(guild, key)) ?? fallback;
  const cmds = customList();
  return [
    `**🔊 Ton propre vocal** — rejoins **➕ Créer ton vocal** : un salon perso est créé. Dans son chat, choisis 🔓 libre ou 🔒 fermé, renomme-le, limite les places, autorise ou expulse quelqu'un. Il disparaît quand il est vide.`,
    `**🎫 Besoin d'aide ?** — clique sur **Ouvrir un ticket** dans ${ch('tickets', '#ouvrir-un-ticket')} : un salon privé s'ouvre avec le staff.`,
    `**💡 Une idée ?** — écris-la dans ${ch('suggestions', '#suggestions')} : elle devient une carte où tout le monde vote 👍 / 👎.`,
    `**🏯 Hall of Fame** — réagis ⚔️ aux meilleurs messages : à 5 réactions, ils entrent dans ${ch('hall_of_fame', '#hall-of-fame')}.`,
    `**🎁 Giveaways** — clique sur **Participer** sous un giveaway. Reclique pour te retirer.`,
    `**🎂 Anniversaire** — \`/anniversaire definir\` : le jour J, le dojo te le souhaite et tu reçois un cadeau.`,
    `**🔴 Lives & TikTok** — les alertes arrivent dans ${ch('live', '#en-live')} et ${ch('tiktok', '#tiktok')}, les clips dans ${ch('clips', '#clips')} (\`/clips\` pour les meilleurs), le planning dans ${ch('schedule', '#planning')}, l'historique avec \`/streams\`.`,
    `**🎲 Pendant les lives** — quiz, pronostics en ryō et votes dans ${ch('live_games', '#jeux-du-live')} : clique sur les boutons !`,
    `**🎮 Trouver des joueurs** — remplis ton profil avec \`/joueur profil\`, puis \`/recherche\` (posté dans ${ch('lfg', '#recherche-joueurs')}) ou \`/joueurs\` pour trouver qui joue à ton jeu. \`/equipes\` fait des équipes équilibrées avec ton vocal.`,
    `**🏆 Tournois & soirées** — inscris-toi dans ${ch('tournaments', '#tournois')} (\`/tournoi equipe\` pour une équipe) et réserve ta place aux soirées de ${ch('nights', '#soirées-gaming')}. \`/calendrier\` montre tout ce qui arrive, \`/classement-jeu\` le classement de chaque jeu.`,
    `**🎯 Défis collectifs** — \`/defis\` : toute la commu avance vers un même objectif, chaque participant gagne des ryō.`,
    `**🙏 Entraide** — \`/merci @membre\` pour remercier quelqu'un qui t'a aidé, \`/rep\` pour la réputation. \`/parrainage lien\` pour inviter tes amis et gagner des ryō.`,
    `**🚩 Un problème ?** — \`/signaler\` prévient discrètement le staff, \`/mes-signalements\` pour le suivi. Envie d'aider ? \`/candidature\` (modérateur ou streamer partenaire).`,
    cmds.length ? `**⌨️ Raccourcis** — ${cmds.map((c) => `\`${prefix()}${c}\``).join(' ')}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');
}

const STAFF_TIPS = [
  '**🎖️ Les grades du staff**',
  '🏯 **Gardien** — responsable de la modération : bannir, expulser, mute, `/lockdown`, événements, copie de la base.',
  '🛡️ **Modérateur** — expulser, mute sans limite, avertissements (et les effacer), annonces, pseudos. Pas de ban.',
  '🔰 **Sentinelle** — supprimer des messages, avertir, mute 1 h maximum, déplacer en vocal. Ni kick ni ban : appelle un Modérateur.',
  '',
  '**🧭 Rappels pour le staff**',
  '• Les commandes de modération respectent la hiérarchie : impossible d\'agir sur un grade égal ou supérieur au sien.',
  '• Toutes les actions (kick, ban, mute, rôles, messages supprimés…) sont notées dans 📋┃logs, avec leur auteur.',
  '• En cas de raid : `/lockdown action:Activer`. L\'anti-raid et l\'anti-nuke se déclenchent aussi tout seuls (alertes dans 🚨┃alertes-sécurité).',
  '• Les commandes qui modifient le serveur (`/setup`, `/restore`…) montrent d\'abord ce qu\'elles vont faire et demandent une confirmation.',
  '• Les signalements arrivent dans 🚩┃signalements : « Je m\'en occupe » puis « Résolu » ou « Sans suite » (le membre est prévenu en MP).',
  '• Préfère la **quarantaine** (`/quarantaine`) à l\'expulsion quand tu as un doute : c\'est réversible avec `/liberer`.',
  '• Les candidatures (📝┃candidatures) sont traitées par le staff senior avec les boutons Accepter / Refuser.',
  '',
  '**🎉 Animer le serveur**',
  '• Pendant les lives : `/quiz`, `/prono` (paris en ryō, résultat avec `/prono resultat`), `/vote`. Les moments forts du chat Twitch sont signalés dans 🛡️┃staff : pensez à clipper !',
  '• Gaming : `/soiree` (réservations), `/tournoi-admin` (créer, lancer, résultats), `/match` pour le classement Elo.',
  '• Communauté : `/defi` (objectif commun), `/boost` (XP ou ryō multipliés), `/giveaway`.',
  '• Chaque lundi, un rapport arrive dans 🛡️┃staff : salons inutilisés, meilleurs créneaux, idées d\'événements.',
  '• Presque tout se règle aussi sur le **tableau de bord web** (administrateurs) : centre d\'alertes 🔔, éditeur de messages, tournois, soirées…',
].join('\n');

// ───────────────────────── Embeds ─────────────────────────

/** Découpe une liste de lignes en champs d'embed (1024 caractères max par champ). */
function fieldsFor(title, lines) {
  const out = [];
  let buf = '';
  for (const l of lines) {
    const line = `\`${l.text}\`\n${l.desc}`;
    if (buf.length + line.length + 1 > 1000) {
      out.push({ name: out.length ? `${title} (suite)` : title, value: buf });
      buf = '';
    }
    buf += (buf ? '\n' : '') + line;
  }
  if (buf) out.push({ name: out.length ? `${title} (suite)` : title, value: buf });
  return out;
}

/** Messages du guide : chaque élément = 1 embed (taille Discord respectée). */
function embeds(guild, audience = 'member') {
  const list = [];
  if (audience === 'member') {
    list.push(new EmbedBuilder().setColor(BRAND_COLOR).setTitle('📖 道 ・ Guide du dojo').setDescription(intro(guild)));
    list.push(new EmbedBuilder().setColor(BRAND_COLOR).setTitle('🏮 Ce que tu peux faire sans commande').setDescription(features(guild)));
  } else {
    list.push(new EmbedBuilder().setColor(0x8b0000).setTitle('📘 Guide du staff').setDescription(STAFF_TIPS));
  }
  // Un embed par groupe de catégories, en restant sous 25 champs et ~5500 caractères
  let current = new EmbedBuilder().setColor(audience === 'member' ? BRAND_COLOR : 0x8b0000).setTitle(audience === 'member' ? '⌨️ Les commandes' : '🛡️ Commandes du staff');
  let size = 0;
  for (const [cat, lines] of sections(audience)) {
    for (const f of fieldsFor(cat, lines)) {
      if ((current.data.fields?.length ?? 0) >= 24 || size + f.value.length + f.name.length > 5200) {
        list.push(current);
        current = new EmbedBuilder().setColor(current.data.color).setTitle(`${current.data.title.replace(/ \(suite\)$/, '')} (suite)`);
        size = 0;
      }
      current.addFields(f);
      size += f.value.length + f.name.length;
    }
  }
  if (current.data.fields?.length) list.push(current);
  list.at(-1).setFooter({ text: '剣聖 Kensei · ce guide se met à jour tout seul avec le bot' });
  return list;
}

/** Regroupe des embeds en messages de 10 embeds / 5800 caractères maximum. */
function pack(list) {
  const out = [[]];
  let size = 0;
  for (const e of list) {
    const len = JSON.stringify(e.toJSON()).length;
    if (out.at(-1).length >= 10 || (out.at(-1).length && size + len > 5800)) {
      out.push([]);
      size = 0;
    }
    out.at(-1).push(e);
    size += len;
  }
  return out;
}

/** Publie / met à jour les guides (appelé par /setup). */
async function post(guild, log = console.log) {
  const { upsertBotMessage } = require('./builder');
  for (const [key, audience] of [['guide', 'member'], ['guide_staff', 'staff']]) {
    const channel = findChannel(guild, key);
    if (!channel) continue;
    const list = embeds(guild, audience);
    for (const [n, embed] of list.entries()) {
      await upsertBotMessage(channel, { embeds: [embed] }, n ? () => {} : log, `${key}-${n}`);
    }
  }
}

/** Version Markdown (docs/GUIDE.md) */
function markdown() {
  const strip = (s) => s.replace(/<#[^>]+>/g, '');
  const block = (audience) =>
    sections(audience)
      .map(([cat, lines]) => `### ${cat}\n\n| Commande | Ce qu'elle fait |\n|---|---|\n${lines.map((l) => `| \`${l.text}\` | ${l.desc} |`).join('\n')}`)
      .join('\n\n');
  return `# 📖 Guide des commandes — 剣聖 Kensei

> Généré automatiquement à partir du bot (\`npm run guide\`). Dans Discord : salon 📖┃guide ou \`/guide\`.

## Pour tout le monde

${strip(intro(null))}

## Sans commande

${strip(features(null))}

## Commandes des membres

${block('member')}

## Commandes du staff

${STAFF_TIPS}

${block('staff')}
`;
}

const commands = [
  {
    category: '🎉 Général',
    data: new SlashCommandBuilder()
      .setName('guide')
      .setDescription('Le guide du serveur et de toutes les commandes')
      .addBooleanOption((o) => o.setName('staff').setDescription('Afficher le guide du staff (réservé au staff)')),
    run(i) {
      const staff = i.options.getBoolean('staff');
      if (staff && !i.memberPermissions.has(P.ManageMessages)) return i.reply({ content: 'Le guide du staff est réservé au staff.', flags: MessageFlags.Ephemeral });
      // Discord limite un message à 6000 caractères d'embeds : on répartit sur plusieurs messages
      const batches = pack(embeds(i.guild, staff ? 'staff' : 'member'));
      return (async () => {
        await i.reply({ embeds: batches[0], flags: MessageFlags.Ephemeral });
        for (const b of batches.slice(1)) await i.followUp({ embeds: b, flags: MessageFlags.Ephemeral });
      })();
    },
  },
];

module.exports = { post, embeds, markdown, pack, sections, commands };
