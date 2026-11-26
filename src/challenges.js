/**
 * 🎯 Défis collectifs : toute la communauté avance vers un objectif commun
 * (ex. « 5 000 messages cette semaine », « 100 h de vocal », « 50 quêtes », « 20 nouveaux membres »).
 * Barre de progression mise à jour dans 📡┃annonces ; objectif atteint = ryō pour chaque participant.
 */
const { EmbedBuilder, MessageFlags, PermissionFlagsBits: P, SlashCommandBuilder } = require('discord.js');
const { findChannel } = require('./shared');
const { db, save } = require('./store');

const TYPES = {
  messages: ['💬', 'messages'],
  voice: ['🎙️', 'minutes de vocal'],
  quests: ['📜', 'quêtes terminées'],
  reactions: ['👍', 'réactions'],
  members: ['👥', 'nouveaux membres'],
  live: ['📺', 'messages pendant les lives'],
};
const all = () => (db.challenges ??= {});
const active = () => Object.values(all()).filter((c) => !c.done && !c.failed && Date.now() < c.endsAt);
let clientRef = null;
const dirty = new Set();

function create({ title, type, target, days, reward, by = null }) {
  if (!TYPES[type]) throw new Error('Type de défi inconnu.');
  const id = `c${Date.now().toString(36)}`;
  const c = { id, title: String(title).slice(0, 100), type, target: Math.max(1, target), progress: 0, contributors: {}, reward: Math.min(2000, Math.max(0, reward)), startedAt: Date.now(), endsAt: Date.now() + days * 86_400_000, by };
  all()[id] = c;
  save();
  return c;
}

/** Fait avancer les défis du bon type. Renvoie les défis qui viennent d'être réussis. */
function progress(type, userId = null, n = 1) {
  const finished = [];
  for (const c of active()) {
    if (c.type !== type) continue;
    c.progress += n;
    if (userId) c.contributors[userId] = (c.contributors[userId] ?? 0) + n;
    dirty.add(c.id);
    if (c.progress >= c.target) {
      c.done = Date.now();
      finished.push(c);
    }
  }
  if (finished.length || dirty.size) save();
  for (const c of finished) complete(c).catch((e) => console.error('Défis :', e.message));
  return finished;
}

function render(c) {
  const [emoji, label] = TYPES[c.type];
  const pct = Math.min(100, Math.floor((c.progress / c.target) * 100));
  const filled = Math.round(pct / 5);
  const status = c.done ? '✅ **Objectif atteint !**' : c.failed ? '❌ Temps écoulé…' : `⏳ Fin <t:${Math.floor(c.endsAt / 1000)}:R>`;
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(c.done ? 0x54c987 : c.failed ? 0x3a3a3a : 0xf5b942)
        .setTitle(`🎯 Défi collectif : ${c.title}`)
        .setDescription(
          `${emoji} **${Math.min(c.progress, c.target).toLocaleString('fr-FR')} / ${c.target.toLocaleString('fr-FR')}** ${label}\n` +
            `\`${'█'.repeat(filled)}${'░'.repeat(20 - filled)}\` ${pct} %\n\n${status}\n` +
            `💰 Récompense : **${c.reward} 両** pour chaque participant · ${Object.keys(c.contributors).length} participant(s)`,
        ),
    ],
    allowedMentions: { parse: [] },
  };
}

async function publish(guild, c) {
  const channel = findChannel(guild, 'announcements') ?? findChannel(guild, 'general');
  if (!channel) return null;
  const msg = c.messageId && (await channel.messages.fetch(c.messageId).catch(() => null));
  if (msg) return msg.edit(render(c));
  const sent = await channel.send(render(c));
  c.messageId = sent.id;
  c.channelId = channel.id;
  save();
  return sent;
}

async function complete(c) {
  const ids = Object.keys(c.contributors);
  for (const id of ids) require('./economy').add(id, c.reward);
  require('./feed').push('🎯', `Défi collectif réussi : ${c.title}`);
  const guild = clientRef?.guilds.cache.find((g) => g.channels.cache.has(c.channelId));
  if (!guild) return;
  await publish(guild, c).catch(() => {});
  await guild.channels.cache
    .get(c.channelId)
    ?.send({ content: `🎉 **Défi réussi : ${c.title}** ! ${ids.length} participant(s) reçoivent **${c.reward} 両** chacun. Merci les ronins ⚔️`, allowedMentions: { parse: [] } })
    .catch(() => {});
}

/** Toutes les minutes : barres mises à jour, défis expirés clôturés. */
async function tick(guild) {
  for (const c of Object.values(all())) {
    if (!c.done && !c.failed && Date.now() >= c.endsAt) {
      c.failed = Date.now();
      dirty.add(c.id);
      save();
    }
  }
  for (const id of [...dirty]) {
    dirty.delete(id);
    const c = require('./shared').own(all(), id);
    if (c) await publish(guild, c).catch(() => {});
  }
}

function start(client, guild) {
  clientRef = client;
  require('./guardian').every('challenges', 'Défis collectifs', 60_000, () => tick(guild).catch((e) => console.error('Défis :', e.message)));
}

const commands = [
  {
    category: '🎉 Animation',
    data: new SlashCommandBuilder().setName('defis').setDescription('Les défis collectifs en cours'),
    run(i) {
      const list = active();
      if (!list.length) return i.reply({ content: '🎯 Aucun défi collectif en cours pour l\'instant.', flags: MessageFlags.Ephemeral });
      return i.reply({ embeds: list.slice(0, 5).map((c) => render(c).embeds[0]), allowedMentions: { parse: [] } });
    },
  },
  {
    category: '🎉 Animation',
    module: 'challenges',
    staff: true,
    data: new SlashCommandBuilder()
      .setName('defi')
      .setDescription('Lancer un défi collectif (staff)')
      .setDefaultMemberPermissions(P.ManageEvents)
      .addStringOption((o) => o.setName('titre').setDescription('Ex. « La semaine des bavards »').setRequired(true).setMaxLength(100))
      .addStringOption((o) =>
        o
          .setName('type')
          .setDescription('Ce qui compte')
          .setRequired(true)
          .addChoices(...Object.entries(TYPES).map(([value, [e, l]]) => ({ name: `${e} ${l}`, value }))),
      )
      .addIntegerOption((o) => o.setName('objectif').setDescription('Nombre à atteindre').setRequired(true).setMinValue(1).setMaxValue(10_000_000))
      .addIntegerOption((o) => o.setName('jours').setDescription('Durée en jours (7 par défaut)').setMinValue(1).setMaxValue(60))
      .addIntegerOption((o) => o.setName('recompense').setDescription('Ryō pour chaque participant (200 par défaut, 2000 max)').setMinValue(0).setMaxValue(2000)),
    async run(i) {
      const c = create({
        title: i.options.getString('titre'),
        type: i.options.getString('type'),
        target: i.options.getInteger('objectif'),
        days: i.options.getInteger('jours') ?? 7,
        reward: i.options.getInteger('recompense') ?? 200,
        by: i.user.id,
      });
      const msg = await publish(i.guild, c);
      require('./feed').push('🎯', `Nouveau défi collectif : ${c.title}`);
      return i.reply({ content: `✅ Défi lancé${msg ? ` : ${msg.url}` : ''}`, flags: MessageFlags.Ephemeral });
    },
  },
];

module.exports = { TYPES, all, active, create, progress, render, publish, tick, start, commands };
