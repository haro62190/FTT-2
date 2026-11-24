/**
 * 🎯 Classes méta (Warzone, MW, Black Ops…) : les accessoires conseillés pour chaque arme.
 * Les classes sont saisies par le staff (commande /classe ou page « Classes méta » du site),
 * affichées avec /meta (image aux couleurs Kensei + code de partage) et publiées dans 🎯┃classes-méta.
 * Pas de source automatique : il n'existe pas d'API officielle de la méta, ce sont les classes de la chaîne.
 */
const { AttachmentBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits: P, SlashCommandBuilder } = require('discord.js');
const { BRAND_COLOR, findChannel } = require('./shared');
const { db, save } = require('./store');
const settings = require('./settings');

const SLOTS = ['Bouche', 'Canon', 'Laser', 'Optique', 'Crosse', 'Poignée', 'Arrière-poignée', 'Chargeur', 'Munitions', 'Mod de tir', 'Sous-canon', 'Kit de conversion'];
const CATEGORIES = ['Fusil d\'assaut', 'Mitraillette', 'Fusil tactique', 'Mitrailleuse', 'Fusil de précision', 'Fusil de sniper', 'Fusil à pompe', 'Pistolet', 'Lanceur', 'Corps à corps'];
const MODES = ['Warzone', 'Multijoueur', 'Zombies', 'Ranked'];
const TIERS = ['S', 'A', 'B', 'C'];
const MAX_ATTACHMENTS = 8;

const all = () => (db.loadouts ??= {});
const games = () => settings.get('meta.games') ?? ['Warzone', 'MW4', 'Black Ops 7'];
const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const idOf = (game, mode, weapon) => `${slug(game)}:${slug(mode)}:${slug(weapon)}`;
const clean = (s, max) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);

/** Liste triée : jeu, palier (S d'abord), arme. */
function list({ game = null, mode = null } = {}) {
  return Object.values(all())
    .filter((l) => (!game || l.game === game) && (!mode || l.mode === mode))
    .sort((a, b) => a.game.localeCompare(b.game) || TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) || a.weapon.localeCompare(b.weapon));
}

/** Recherche souple par nom d'arme (« mcw », « MCW 6.8 »…). */
function find(query, game = null) {
  const q = slug(query);
  const pool = list({ game });
  return pool.find((l) => l.id === query) ?? pool.find((l) => slug(l.weapon) === q) ?? pool.find((l) => slug(l.weapon).includes(q)) ?? null;
}

/** « Bouche: Compensateur; Canon: Long 20" » → [{ slot, name }] */
function parseAttachments(text) {
  return String(text ?? '')
    .split(/[;\n|]+/)
    .map((part) => {
      const m = part.match(/^\s*([^:=]+?)\s*[:=]\s*(.+?)\s*$/);
      if (!m) return null;
      const slot = SLOTS.find((s) => slug(s) === slug(m[1])) ?? clean(m[1], 30);
      return { slot, name: clean(m[2], 60) };
    })
    .filter((a) => a?.name)
    .slice(0, MAX_ATTACHMENTS);
}

/** Crée ou met à jour une classe. Renvoie la classe enregistrée. */
function upsert(input, byName = null) {
  const game = clean(input.game, 40);
  const mode = clean(input.mode || 'Warzone', 30);
  const weapon = clean(input.weapon, 50);
  if (!game || !weapon) throw new Error('Il faut au moins un jeu et une arme.');
  const attachments = (input.attachments ?? []).filter((a) => a?.name).slice(0, MAX_ATTACHMENTS);
  if (!attachments.length) throw new Error('Ajoute au moins un accessoire.');
  const id = idOf(game, mode, weapon);
  const prev = all()[id] ?? (input.previousId ? all()[input.previousId] : null);
  if (input.previousId && input.previousId !== id) delete all()[input.previousId];
  const l = {
    id,
    game,
    mode,
    weapon,
    category: clean(input.category, 40),
    tier: TIERS.includes(input.tier) ? input.tier : 'A',
    attachments,
    code: clean(input.code, 40),
    notes: clean(input.notes, 300),
    by: clean(byName, 40) || prev?.by || null,
    createdAt: prev?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    messageId: prev?.messageId ?? null,
  };
  all()[id] = l;
  save();
  return l;
}

function remove(id) {
  const l = all()[id];
  if (!l) return null;
  delete all()[id];
  save();
  return l;
}

// ───────────────────────── Affichage ─────────────────────────

function embed(l) {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`🎯 ${l.weapon} — ${l.game} · ${l.mode}`)
    .setDescription(
      `${l.category ? `**${l.category}** · ` : ''}Palier **${l.tier}**\n\n` +
        l.attachments.map((a) => `▸ **${a.slot}** : ${a.name}`).join('\n') +
        (l.code ? `\n\n📋 Code de la classe : \`${l.code}\`` : '') +
        (l.notes ? `\n\n💬 ${l.notes}` : ''),
    )
    .setImage(`attachment://${slug(l.weapon) || 'classe'}.png`)
    .setFooter({ text: `Mise à jour${l.by ? ` par ${l.by}` : ''} · /meta pour toutes les classes` })
    .setTimestamp(l.updatedAt);
}

/** Message complet : image + embed (texte seul si l'image ne peut pas être générée). */
function payload(l) {
  try {
    const png = require('./loadoutcard').renderLoadout(l);
    return { embeds: [embed(l)], files: [new AttachmentBuilder(png, { name: `${slug(l.weapon) || 'classe'}.png` })] };
  } catch (err) {
    console.error('Image de classe :', err.message);
    return { embeds: [embed(l).setImage(null)], files: [] };
  }
}

/** Publie (ou met à jour) la classe dans 🎯┃classes-méta. */
async function publish(guild, l) {
  const channel = findChannel(guild, 'meta');
  if (!channel) return false;
  const p = payload(l);
  const old = l.messageId && (await channel.messages.fetch(l.messageId).catch(() => null));
  if (old) {
    await old.edit({ ...p, attachments: [] });
  } else {
    const msg = await channel.send(p);
    l.messageId = msg.id;
    save();
  }
  return true;
}

async function unpublish(guild, l) {
  const channel = findChannel(guild, 'meta');
  const msg = l?.messageId && channel && (await channel.messages.fetch(l.messageId).catch(() => null));
  await msg?.delete().catch(() => {});
}

/** Tableau des paliers pour un jeu (embed). */
function tierList(game) {
  const items = list({ game });
  const e = new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`🎯 Classes méta — ${game}`);
  if (!items.length) return e.setDescription('_Aucune classe pour ce jeu pour l\'instant._');
  for (const mode of [...new Set(items.map((l) => l.mode))]) {
    const lines = TIERS.map((t) => {
      const w = items.filter((l) => l.mode === mode && l.tier === t).map((l) => l.weapon);
      return w.length ? `**${t}** — ${w.join(' · ')}` : null;
    }).filter(Boolean);
    e.addFields({ name: `🎮 ${mode}`, value: lines.join('\n').slice(0, 1024) });
  }
  return e.setFooter({ text: 'Détail d\'une arme : /meta arme:<nom>' });
}

// ───────────────────────── Commandes ─────────────────────────

function autocompleteWeapons(i) {
  const focused = i.options.getFocused(true);
  const q = slug(focused.value);
  if (focused.name === 'jeu') {
    return i.respond(games().filter((g) => slug(g).includes(q)).slice(0, 25).map((g) => ({ name: g, value: g })));
  }
  const game = i.options.getString('jeu');
  return i.respond(
    list({ game })
      .filter((l) => !q || slug(l.weapon).includes(q))
      .slice(0, 25)
      .map((l) => ({ name: `${l.weapon} — ${l.game} · ${l.mode} (${l.tier})`.slice(0, 100), value: l.id })),
  );
}

const commands = [
  {
    category: '🎯 Gaming',
    data: new SlashCommandBuilder()
      .setName('meta')
      .setDescription('Les classes méta : accessoires conseillés par arme (Warzone, MW, BO…)')
      .addStringOption((o) => o.setName('arme').setDescription('L\'arme (laisse vide pour voir le classement)').setAutocomplete(true))
      .addStringOption((o) => o.setName('jeu').setDescription('Le jeu').setAutocomplete(true)),
    autocomplete: autocompleteWeapons,
    async run(i) {
      if (!settings.on('meta')) return i.reply({ content: '🎯 Les classes méta sont désactivées.', flags: MessageFlags.Ephemeral });
      const weapon = i.options.getString('arme');
      const game = i.options.getString('jeu');
      if (!weapon) {
        const g = game ?? list()[0]?.game ?? games()[0];
        return i.reply({ embeds: [tierList(g)] });
      }
      const l = find(weapon, game);
      if (!l) return i.reply({ content: `🔎 Aucune classe pour « ${weapon} ». Essaie \`/meta\` sans arme pour voir la liste.`, flags: MessageFlags.Ephemeral });
      await i.deferReply();
      return i.editReply(payload(l));
    },
  },
  {
    category: '🎯 Gaming',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('classe')
      .setDescription('Gérer les classes méta (staff)')
      .setDefaultMemberPermissions(P.ManageMessages)
      .addSubcommand((s) =>
        s
          .setName('ajouter')
          .setDescription('Ajouter ou mettre à jour une classe')
          .addStringOption((o) => o.setName('jeu').setDescription('Warzone, MW4…').setRequired(true).setAutocomplete(true))
          .addStringOption((o) => o.setName('arme').setDescription('Nom de l\'arme').setRequired(true).setMaxLength(50))
          .addStringOption((o) =>
            o.setName('accessoires').setDescription('Ex. : Bouche: Compensateur; Canon: Long; Optique: Viseur 2x').setRequired(true).setMaxLength(1000),
          )
          .addStringOption((o) => o.setName('mode').setDescription('Mode de jeu').addChoices(...MODES.map((m) => ({ name: m, value: m }))))
          .addStringOption((o) => o.setName('categorie').setDescription('Type d\'arme').addChoices(...CATEGORIES.map((c) => ({ name: c, value: c }))))
          .addStringOption((o) => o.setName('palier').setDescription('Palier méta').addChoices(...TIERS.map((t) => ({ name: `Palier ${t}`, value: t }))))
          .addStringOption((o) => o.setName('code').setDescription('Code de partage de la classe').setMaxLength(40))
          .addStringOption((o) => o.setName('notes').setDescription('Conseil, atouts…').setMaxLength(300)),
      )
      .addSubcommand((s) =>
        s
          .setName('retirer')
          .setDescription('Supprimer une classe')
          .addStringOption((o) => o.setName('arme').setDescription('La classe').setRequired(true).setAutocomplete(true)),
      ),
    autocomplete: autocompleteWeapons,
    async run(i) {
      if (i.options.getSubcommand() === 'retirer') {
        const l = find(i.options.getString('arme'));
        if (!l) return i.reply({ content: 'Classe introuvable.', flags: MessageFlags.Ephemeral });
        remove(l.id);
        await unpublish(i.guild, l);
        return i.reply({ content: `🗑️ Classe **${l.weapon}** (${l.game}) supprimée.`, flags: MessageFlags.Ephemeral });
      }
      const attachments = parseAttachments(i.options.getString('accessoires'));
      if (!attachments.length) {
        return i.reply({ content: '❌ Écris les accessoires comme ceci : `Bouche: Compensateur; Canon: Long; Optique: Viseur 2x`', flags: MessageFlags.Ephemeral });
      }
      const l = upsert(
        {
          game: i.options.getString('jeu'),
          weapon: i.options.getString('arme'),
          mode: i.options.getString('mode') ?? 'Warzone',
          category: i.options.getString('categorie') ?? '',
          tier: i.options.getString('palier') ?? 'A',
          attachments,
          code: i.options.getString('code') ?? '',
          notes: i.options.getString('notes') ?? '',
        },
        i.member?.displayName ?? i.user.username,
      );
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const posted = await publish(i.guild, l).catch(() => false);
      require('./feed').push('🎯', `Classe méta mise à jour : ${l.weapon} (${l.game})`);
      return i.editReply(`✅ Classe **${l.weapon}** enregistrée (${attachments.length} accessoires)${posted ? ' et publiée dans 🎯┃classes-méta' : ''}.`);
    },
  },
];

module.exports = { SLOTS, CATEGORIES, MODES, TIERS, MAX_ATTACHMENTS, games, list, find, upsert, remove, publish, unpublish, parseAttachments, payload, tierList, commands };
