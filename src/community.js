/**
 * Communauté :
 *  - 💡 Suggestions : tout message posté dans 💡┃suggestions devient une carte avec votes 👍/👎,
 *    un fil de discussion et des boutons staff (acceptée / en cours / refusée)
 *  - 🏯 Hall of Fame : un message qui reçoit assez de ⚔️ est mis à l'honneur dans 🏯┃hall-of-fame
 *  - ✅ Vérification anti-bot : petit test avant d'obtenir le rôle ⚔️ Ronin
 */
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Events, MessageFlags, PermissionFlagsBits: P } = require('discord.js');
const { BRAND_COLOR, findChannel, findRole } = require('./shared');
const { db, save } = require('./store');
const settings = require('./settings');

const ephemeral = (content, extra = {}) => ({ content, flags: MessageFlags.Ephemeral, ...extra });
const isStaff = (member) => member.permissions.has(P.ManageMessages) || require('./shared').isStaffMember(member);

// ───────────────────────── Suggestions ─────────────────────────

const suggestions = () => (db.suggestions ??= {});
const STATUS = {
  pending: { label: '🕓 En attente', color: 0x808080 },
  progress: { label: '🔧 En cours', color: 0xf1c40f },
  accepted: { label: '✅ Acceptée', color: 0x2ecc71 },
  denied: { label: '❌ Refusée', color: 0x8b0000 },
};

function renderSuggestion(s, author) {
  const st = STATUS[s.status];
  const embed = new EmbedBuilder()
    .setColor(st.color)
    .setAuthor({ name: author?.username ?? 'Membre', iconURL: author?.displayAvatarURL?.() })
    .setTitle(`💡 Suggestion #${s.number}`)
    .setDescription(s.text.slice(0, 4000))
    .addFields({ name: 'Statut', value: st.label + (s.by ? ` par <@${s.by}>` : ''), inline: true }, { name: 'Votes', value: `👍 ${s.up.length} · 👎 ${s.down.length}`, inline: true })
    .setTimestamp(s.at);
  const votes = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sugg:up').setEmoji('👍').setLabel(String(s.up.length)).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('sugg:down').setEmoji('👎').setLabel(String(s.down.length)).setStyle(ButtonStyle.Danger),
  );
  const staff = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sugg:accepted').setLabel('Accepter').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('sugg:progress').setLabel('En cours').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('sugg:denied').setLabel('Refuser').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [votes, staff] };
}

async function onSuggestionMessage(message) {
  const channel = findChannel(message.guild, 'suggestions');
  if (!channel || message.channelId !== channel.id || message.author.bot || !message.content?.trim()) return;
  if (!settings.on('suggestions')) return;
  if (isStaff(message.member)) return; // le staff peut discuter normalement
  const meta = (db.suggestionsMeta ??= { counter: 0 });
  const s = { number: ++meta.counter, authorId: message.author.id, text: message.content.trim(), up: [], down: [], status: 'pending', at: Date.now() };
  const card = await channel.send(renderSuggestion(s, message.author));
  suggestions()[card.id] = s;
  save();
  require('./quests').progress(message.author.id, 'suggestion');
  require('./social').track(message.author.id, 'helps');
  await message.delete().catch(() => {});
  await card.startThread({ name: `💬 Suggestion #${s.number}`, autoArchiveDuration: 10080 }).catch(() => {});
}

async function onSuggestionButton(i) {
  const s = suggestions()[i.message.id];
  if (!s) return i.reply(ephemeral('Suggestion introuvable.'));
  const action = i.customId.slice(5);
  if (action === 'up' || action === 'down') {
    const [mine, other] = action === 'up' ? [s.up, s.down] : [s.down, s.up];
    const o = other.indexOf(i.user.id);
    if (o !== -1) other.splice(o, 1);
    const m = mine.indexOf(i.user.id);
    if (m === -1) mine.push(i.user.id);
    else mine.splice(m, 1);
  } else {
    if (!isStaff(i.member)) return i.reply(ephemeral('Seul le staff peut changer le statut.'));
    s.status = action;
    s.by = i.user.id;
    const author = await i.client.users.fetch(s.authorId).catch(() => null);
    if (author) await require('./notify').dm(i.client, author.id, `💡 Ta suggestion #${s.number} sur **${i.guild.name}** est maintenant : **${STATUS[action].label}**`, 'suggestion');
  }
  save();
  const author = await i.client.users.fetch(s.authorId).catch(() => null);
  return i.update(renderSuggestion(s, author));
}

// ───────────────────────── Hall of Fame ─────────────────────────

async function onReaction(reaction) {
  if (!settings.on('hallOfFame')) return;
  if (reaction.partial) reaction = await reaction.fetch().catch(() => null);
  if (!reaction) return;
  const message = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
  if (!message?.guild) return;
  const emoji = settings.get('hallOfFame.emoji') ?? '⚔️';
  const threshold = settings.get('hallOfFame.threshold') ?? 5;
  if (reaction.emoji.name !== emoji) return;
  const hall = findChannel(message.guild, 'hall_of_fame');
  if (!hall || message.channelId === hall.id) return;
  // Seulement les salons publics de la communauté (pas le staff, pas les tickets)
  const member = findRole(message.guild, 'member');
  if (!member || !message.channel.permissionsFor(member)?.has(P.ViewChannel)) return;

  const count = reaction.count ?? 0;
  const posted = (db.hallOfFame ??= {});
  const header = `${emoji} **${count}** · ${message.channel}`;
  if (posted[message.id]) {
    const hm = await hall.messages.fetch(posted[message.id]).catch(() => null);
    if (hm) await hm.edit({ content: header }).catch(() => {});
    return;
  }
  if (count < threshold) return;
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
    .setDescription(`${message.content || '_(image)_'}\n\n[➡️ Voir le message](${message.url})`.slice(0, 4000))
    .setTimestamp(message.createdAt);
  const image = message.attachments.find((a) => a.contentType?.startsWith('image/'));
  if (image) embed.setImage(image.url);
  const hm = await hall.send({ content: header, embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
  if (hm) {
    posted[message.id] = hm.id;
    save();
  }
}

// ───────────────────────── Vérification anti-bot ─────────────────────────

const CHOICES = [
  ['⚔️', 'le katana'],
  ['🏮', 'la lanterne'],
  ['🌸', 'la fleur de cerisier'],
  ['🍜', 'les ramens'],
  ['🐉', 'le dragon'],
  ['⛩️', 'le torii'],
  ['🎎', 'les poupées'],
  ['🗻', 'le mont Fuji'],
];
const challenges = new Map(); // userId -> { answer, fails, blockedUntil }

function challengePayload(userId) {
  const options = [...CHOICES].sort(() => Math.random() - 0.5).slice(0, 5);
  const [answer, label] = options[Math.floor(Math.random() * options.length)];
  const c = challenges.get(userId) ?? { fails: 0, blockedUntil: 0 };
  c.answer = answer;
  challenges.set(userId, c);
  const row = new ActionRowBuilder().addComponents(
    options.map(([e], n) => new ButtonBuilder().setCustomId(`verify:${n}:${e}`).setEmoji(e).setStyle(ButtonStyle.Secondary)),
  );
  return { content: `🛡️ Dernière étape : prouve que tu n'es pas un robot.\nClique sur **${label}**.`, components: [row] };
}

/** Appelé quand on clique sur « Je prête serment ». Renvoie true si le test a été affiché. */
async function startVerification(i) {
  if (settings.get('verification.captcha') === false) return false;
  const c = challenges.get(i.user.id);
  if (c?.blockedUntil > Date.now()) {
    await i.reply(ephemeral(`⏳ Trop d'erreurs. Réessaie <t:${Math.floor(c.blockedUntil / 1000)}:R>.`));
    return true;
  }
  await i.reply({ ...challengePayload(i.user.id), flags: MessageFlags.Ephemeral });
  return true;
}

async function onVerifyButton(i, grant) {
  const c = challenges.get(i.user.id);
  const emoji = i.customId.split(':')[2];
  if (!c?.answer) return i.update({ content: 'Test expiré : reclique sur le bouton du règlement.', components: [] });
  if (emoji === c.answer) {
    challenges.delete(i.user.id);
    return grant(i);
  }
  c.fails++;
  if (c.fails >= 3) {
    c.blockedUntil = Date.now() + 5 * 60_000;
    c.fails = 0;
    c.answer = null;
    return i.update({ content: `❌ Raté 3 fois. Réessaie <t:${Math.floor(c.blockedUntil / 1000)}:R>.`, components: [] });
  }
  const next = challengePayload(i.user.id);
  return i.update({ ...next, content: `❌ Mauvaise réponse (${c.fails}/3).\n${next.content}` });
}

// ───────────────────────── Branchement ─────────────────────────

/** Boutons sugg:* — les boutons verify:* sont gérés par bot.js (il donne le rôle). */
async function handleInteraction(i) {
  if (i.customId?.startsWith('sugg:')) {
    await onSuggestionButton(i);
    return true;
  }
  return false;
}

function register(client, guildId) {
  client.on(Events.MessageCreate, (m) => m.guild?.id === guildId && onSuggestionMessage(m).catch((e) => console.error('Suggestions :', e.message)));
  const react = (r) => (r.message.guildId === guildId ? onReaction(r).catch((e) => console.error('Hall of Fame :', e.message)) : null);
  client.on(Events.MessageReactionAdd, react);
  // Quêtes « réagir à N messages » : une seule fois par message (pas de farm en retirant / remettant)
  const seen = new Map();
  client.on(Events.MessageReactionAdd, (r, user) => {
    if (user.bot || r.message.guildId !== guildId || r.message.author?.id === user.id) return;
    const key = `${user.id}:${r.message.id}`;
    if (seen.has(key)) return;
    seen.set(key, Date.now());
    if (seen.size > 20_000) for (const k of [...seen.keys()].slice(0, 5_000)) seen.delete(k);
    require('./memberstats').bump(user.id, 'reactions');
    require('./quests').progress(user.id, 'reactions');
    require('./challenges').progress('reactions', user.id);
  });
  client.on(Events.MessageReactionRemove, react);
}

/** Changer le statut d'une suggestion depuis le tableau de bord. */
async function setSuggestionStatus(guild, msgId, status, byId) {
  const s = suggestions()[msgId];
  if (!s || !STATUS[status]) return false;
  s.status = status;
  s.by = byId;
  save();
  const channel = findChannel(guild, 'suggestions');
  const msg = channel && (await channel.messages.fetch(msgId).catch(() => null));
  const author = await guild.client.users.fetch(s.authorId).catch(() => null);
  if (msg) await msg.edit(renderSuggestion(s, author)).catch(() => {});
  if (author) await require('./notify').dm(guild.client, author.id, `💡 Ta suggestion #${s.number} sur **${guild.name}** est maintenant : **${STATUS[status].label}**`, 'suggestion');
  return true;
}

module.exports = { register, handleInteraction, startVerification, onVerifyButton, setSuggestionStatus, STATUS };
