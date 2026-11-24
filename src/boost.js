/**
 * Événements communautaires « boost » : pendant une durée donnée, l'XP et/ou les ryō gagnés sont multipliés
 * (ex. XP ×2 pendant le week-end, soirée ryō ×3 pendant un live). Commande /boost (staff) ou tableau de bord.
 * Multiplicateurs de rôles en plus (VIP, abonné Twitch, booster Nitro) : réglages `levels.roleMultipliers`.
 */
const { EmbedBuilder, PermissionFlagsBits: P, SlashCommandBuilder } = require('discord.js');
const { findChannel, findRole } = require('./shared');
const { db, save } = require('./store');
const settings = require('./settings');

const active = () => {
  const b = db.boost;
  return b && b.until > Date.now() ? b : null;
};

/** Multiplicateur d'un membre pour 'xp' ou 'ryo' : événement en cours × meilleur bonus de rôle. */
function multiplier(member, kind = 'xp') {
  let m = 1;
  const b = active();
  if (b) m *= b[kind] ?? 1;
  if (kind === 'xp' && member?.roles?.cache) {
    const bonus = settings.get('levels.roleMultipliers') ?? {};
    let best = 1;
    for (const [key, value] of Object.entries(bonus)) {
      const has = key === 'booster' ? Boolean(member.premiumSince) : member.roles.cache.has(findRole(member.guild, key)?.id);
      if (has && value > best) best = value;
    }
    m *= best;
  }
  return m;
}

async function startBoost(guild, { xp = 1, ryo = 1, hours = 2, reason = '', by = null }) {
  db.boost = { xp, ryo, until: Date.now() + hours * 3600_000, reason, by, started: Date.now() };
  save();
  const channel = findChannel(guild, 'announcements') ?? findChannel(guild, 'general');
  await channel
    ?.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xffc400)
          .setTitle('🔥 祭り ・ Événement boost !')
          .setDescription(
            [xp > 1 && `⚔️ **XP ×${xp}**`, ryo > 1 && `💰 **Ryō ×${ryo}**`].filter(Boolean).join(' · ') +
              `\n⏳ Jusqu'à <t:${Math.floor(db.boost.until / 1000)}:t> (<t:${Math.floor(db.boost.until / 1000)}:R>)` +
              (reason ? `\n\n${reason}` : '') +
              '\n\nÉcris, viens en vocal, fais tes /quetes : c\'est le moment !',
          ),
      ],
    })
    .catch(() => {});
  return db.boost;
}

function stopBoost() {
  const was = active();
  db.boost = null;
  save();
  return was;
}

const commands = [
  {
    category: '⭐ Niveaux',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('boost')
      .setDescription('Lancer un événement XP / ryō multipliés (staff)')
      .setDefaultMemberPermissions(P.ManageGuild)
      .addSubcommand((s) =>
        s
          .setName('lancer')
          .setDescription('Démarrer un boost')
          .addIntegerOption((o) => o.setName('heures').setDescription('Durée (1 à 72 h)').setRequired(true).setMinValue(1).setMaxValue(72))
          .addNumberOption((o) => o.setName('xp').setDescription('Multiplicateur d\'XP (×2 par défaut)').setMinValue(1).setMaxValue(5))
          .addNumberOption((o) => o.setName('ryo').setDescription('Multiplicateur de ryō (×1 par défaut)').setMinValue(1).setMaxValue(5))
          .addStringOption((o) => o.setName('raison').setDescription('Ex. « Week-end des 500 followers »').setMaxLength(200)),
      )
      .addSubcommand((s) => s.setName('arreter').setDescription('Arrêter le boost en cours'))
      .addSubcommand((s) => s.setName('voir').setDescription('Voir le boost en cours')),
    async run(i) {
      const sub = i.options.getSubcommand();
      if (sub === 'arreter') {
        const was = stopBoost();
        return i.reply({ content: was ? '🧯 Boost arrêté.' : 'Aucun boost en cours.', ephemeral: true });
      }
      if (sub === 'voir') {
        const b = active();
        return i.reply({
          content: b ? `🔥 XP ×${b.xp} · Ryō ×${b.ryo} — fin <t:${Math.floor(b.until / 1000)}:R>${b.reason ? `\n${b.reason}` : ''}` : 'Aucun boost en cours.',
          ephemeral: true,
        });
      }
      const b = await startBoost(i.guild, {
        hours: i.options.getInteger('heures'),
        xp: i.options.getNumber('xp') ?? 2,
        ryo: i.options.getNumber('ryo') ?? 1,
        reason: i.options.getString('raison') ?? '',
        by: i.user.id,
      });
      return i.reply({ content: `🔥 Boost lancé jusqu'à <t:${Math.floor(b.until / 1000)}:t>.`, ephemeral: true });
    },
  },
];

module.exports = { multiplier, active, startBoost, stopBoost, commands };
