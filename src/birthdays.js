/**
 * Anniversaires : chacun enregistre sa date ; le jour J (à partir de 9 h, heure de Paris),
 * le bot le souhaite dans 🍜┃discussion, donne le rôle 🎂 Anniversaire pendant 24 h et un cadeau en ryō.
 */
const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { BRAND_COLOR, findChannel, findRole } = require('./shared');
const { db, save } = require('./store');
const settings = require('./settings');
const temproles = require('./temproles');

const all = () => (db.birthdays ??= {});
const done = () => (db.birthdaysDone ??= {});
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });

/** Date et heure à Paris : { y, m, d, h } */
function parisNow() {
  const [date, time] = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Paris' }).split(' ');
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d, h: Number(time.split(':')[0]) };
}
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

async function check(guild) {
  if (settings.get('birthdays.enabled') === false) return;
  const now = parisNow();
  if (now.h < 9) return;
  for (const [userId, b] of Object.entries(all())) {
    // 29 février fêté le 28 les années non bissextiles
    const day = b.m === 2 && b.d === 29 && !isLeap(now.y) ? 28 : b.d;
    if (b.m !== now.m || day !== now.d || done()[userId] === now.y) continue;
    done()[userId] = now.y;
    save();
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) continue;
    const role = findRole(guild, 'birthday');
    if (role?.editable) await temproles.grant(member, role, 24 * 3600_000, 'Anniversaire').catch(() => {});
    const gift = settings.get('birthdays.gift') ?? 500;
    if (gift) require('./economy').add(userId, gift);
    const channel = findChannel(guild, 'general');
    await channel
      ?.send({
        content: `${member}`,
        embeds: [
          new EmbedBuilder()
            .setColor(BRAND_COLOR)
            .setTitle('🎂 お誕生日おめでとう ・ Joyeux anniversaire !')
            .setDescription(`Tout le dojo souhaite un joyeux anniversaire à ${member} ! 🏮🎉${gift ? `\n🎁 Cadeau : **${gift} 両**` : ''}`)
            .setThumbnail(member.user.displayAvatarURL()),
        ],
        allowedMentions: { users: [userId] },
      })
      .catch(() => {});
  }
}

function start(guild) {
  const run = () => check(guild).catch((e) => console.error('Anniversaires :', e.message));
  setTimeout(run, 20_000);
  setInterval(run, 15 * 60_000);
}

const commands = [
  {
    category: '🎉 Animation',
    data: new SlashCommandBuilder()
      .setName('anniversaire')
      .setDescription('Ton anniversaire')
      .addSubcommand((s) =>
        s
          .setName('definir')
          .setDescription('Enregistrer ta date d\'anniversaire')
          .addIntegerOption((o) => o.setName('jour').setDescription('Jour').setRequired(true).setMinValue(1).setMaxValue(31))
          .addIntegerOption((o) => o.setName('mois').setDescription('Mois').setRequired(true).addChoices(...MONTHS.map((name, n) => ({ name, value: n + 1 })))),
      )
      .addSubcommand((s) => s.setName('retirer').setDescription('Effacer ta date'))
      .addSubcommand((s) => s.setName('prochains').setDescription('Les prochains anniversaires du serveur')),
    run(i) {
      const sub = i.options.getSubcommand();
      if (sub === 'definir') {
        const d = i.options.getInteger('jour');
        const m = i.options.getInteger('mois');
        const max = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
        if (d > max) return i.reply(ephemeral(`Il n'y a que ${max} jours en ${MONTHS[m - 1]}.`));
        all()[i.user.id] = { d, m };
        save();
        return i.reply(ephemeral(`🎂 Noté : le **${d} ${MONTHS[m - 1]}**. Le dojo te le souhaitera !`));
      }
      if (sub === 'retirer') {
        delete all()[i.user.id];
        save();
        return i.reply(ephemeral('🗑️ Date effacée.'));
      }
      const now = parisNow();
      const today = now.m * 100 + now.d;
      const upcoming = Object.entries(all())
        .map(([id, b]) => ({ id, ...b, key: b.m * 100 + b.d }))
        .sort((a, b) => ((a.key - today + 1300) % 1300) - ((b.key - today + 1300) % 1300))
        .slice(0, 10);
      return i.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(BRAND_COLOR)
            .setTitle('🎂 Prochains anniversaires')
            .setDescription(upcoming.map((b) => `**${b.d} ${MONTHS[b.m - 1]}** — <@${b.id}>`).join('\n') || '_Personne n\'a encore enregistré sa date : `/anniversaire definir`._'),
        ],
        allowedMentions: { parse: [] },
      });
    },
  },
];

module.exports = { start, commands };
