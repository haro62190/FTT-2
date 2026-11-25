/**
 * 😀 Émojis personnalisés du serveur (statiques et animés) : ajout / suppression par le staff,
 * depuis Discord (/emoji) ou le site (page 😀 Émojis).
 * Règles Discord : nom de 2 à 32 caractères (lettres, chiffres, _), image PNG/JPEG/GIF/WebP de 256 Ko max,
 * nombre d'emplacements selon le niveau de boost (50 / 100 / 150 / 250 de chaque type).
 */
const { EmbedBuilder, MessageFlags, PermissionFlagsBits: P, SlashCommandBuilder } = require('discord.js');
const { BRAND_COLOR } = require('./shared');

const MAX_BYTES = 256 * 1024;
const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const SLOTS = [50, 100, 150, 250];
const NAME = /^[A-Za-z0-9_]{2,32}$/;

/** Type réel d'après les premiers octets (on ne se fie pas à l'extension). */
function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Nom proposé à partir d'un nom de fichier (« Mon Logo!.gif » → « Mon_Logo »). */
const nameFrom = (file) => String(file ?? '').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);

function usage(guild) {
  const max = SLOTS[guild.premiumTier] ?? 50;
  const all = [...guild.emojis.cache.values()];
  return { max, statics: all.filter((e) => !e.animated).length, animated: all.filter((e) => e.animated).length };
}

/** Vérifie puis ajoute un émoji. Renvoie l'émoji créé. */
async function add(guild, { name, data, by = null }) {
  name = String(name ?? '').trim();
  if (!NAME.test(name)) throw new Error('Nom invalide : 2 à 32 caractères, lettres, chiffres ou _ (sans espace ni accent).');
  if (!Buffer.isBuffer(data) || !data.length) throw new Error('Image manquante.');
  if (data.length > MAX_BYTES) throw new Error(`Image trop lourde (${Math.ceil(data.length / 1024)} Ko) : 256 Ko maximum.`);
  const type = sniff(data);
  if (!type) throw new Error('Format refusé : PNG, JPEG, GIF ou WebP seulement.');
  await guild.emojis.fetch();
  if (guild.emojis.cache.some((e) => e.name === name)) throw new Error(`Un émoji :${name}: existe déjà.`);
  const u = usage(guild);
  const animated = type === 'image/gif';
  if ((animated ? u.animated : u.statics) >= u.max) throw new Error(`Plus de place pour les émojis ${animated ? 'animés' : 'statiques'} (${u.max} max à ce niveau de boost).`);
  const emoji = await guild.emojis.create({ attachment: data, name, reason: by ? `Ajouté par ${by}` : 'Émoji personnalisé' });
  require('./feed').push('😀', `Nouvel émoji :${name}:`);
  return emoji;
}

async function remove(guild, id, by = null) {
  const emoji = guild.emojis.cache.get(id) ?? (await guild.emojis.fetch(id).catch(() => null));
  if (!emoji) throw new Error('Émoji introuvable.');
  const name = emoji.name;
  await emoji.delete(by ? `Supprimé par ${by}` : 'Émoji supprimé');
  return name;
}

const commands = [
  {
    category: '🏯 Kensei',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('emoji')
      .setDescription('Émojis personnalisés du serveur (staff)')
      .setDefaultMemberPermissions(P.ManageGuildExpressions)
      .addSubcommand((c) =>
        c
          .setName('ajouter')
          .setDescription('Ajouter un émoji (PNG, JPEG, WebP ou GIF animé, 256 Ko max)')
          .addAttachmentOption((o) => o.setName('image').setDescription('L\'image de l\'émoji').setRequired(true))
          .addStringOption((o) => o.setName('nom').setDescription('Nom (lettres, chiffres, _) — par défaut, le nom du fichier').setMinLength(2).setMaxLength(32)),
      )
      .addSubcommand((c) =>
        c
          .setName('supprimer')
          .setDescription('Supprimer un émoji')
          .addStringOption((o) => o.setName('nom').setDescription('Nom de l\'émoji').setRequired(true).setAutocomplete(true)),
      )
      .addSubcommand((c) => c.setName('liste').setDescription('Voir les émojis et les places restantes')),
    async autocomplete(i) {
      const q = i.options.getFocused().toLowerCase();
      return i.respond(
        [...i.guild.emojis.cache.values()]
          .filter((e) => e.name.toLowerCase().includes(q))
          .slice(0, 25)
          .map((e) => ({ name: `${e.animated ? '🎞️ ' : ''}${e.name}`, value: e.id })),
      );
    },
    async run(i) {
      const sub = i.options.getSubcommand();
      if (sub === 'liste') {
        await i.guild.emojis.fetch();
        const u = usage(i.guild);
        const list = (animated) => [...i.guild.emojis.cache.values()].filter((e) => e.animated === animated).map((e) => `${e}`).join(' ').slice(0, 1024) || '—';
        return i.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(BRAND_COLOR)
              .setTitle('😀 Émojis du serveur')
              .addFields({ name: `Statiques · ${u.statics}/${u.max}`, value: list(false) }, { name: `Animés · ${u.animated}/${u.max}`, value: list(true) }),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        if (sub === 'supprimer') {
          const id = i.options.getString('nom');
          const emoji = i.guild.emojis.cache.get(id) ?? i.guild.emojis.cache.find((e) => e.name === id);
          const name = await remove(i.guild, emoji?.id ?? id, i.user.username);
          return i.editReply(`🗑️ Émoji :${name}: supprimé.`);
        }
        const file = i.options.getAttachment('image');
        if (file.size > MAX_BYTES) throw new Error(`Image trop lourde (${Math.ceil(file.size / 1024)} Ko) : 256 Ko maximum.`);
        const res = await fetch(file.url, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error('Impossible de lire l\'image.');
        const data = Buffer.from(await res.arrayBuffer());
        const emoji = await add(i.guild, { name: i.options.getString('nom') ?? nameFrom(file.name), data, by: i.user.username });
        return i.editReply(`✅ Émoji ajouté : ${emoji} \`:${emoji.name}:\``);
      } catch (e) {
        return i.editReply(`❌ ${e.message}`);
      }
    },
  },
];

module.exports = { add, remove, usage, sniff, nameFrom, MAX_BYTES, TYPES, commands };
