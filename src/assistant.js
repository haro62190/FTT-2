/**
 * 🤖 Assistant IA : répond aux questions des membres sur le serveur (règles, salons, commandes, fonctionnement),
 * avec Claude (API Anthropic). Activé seulement si ANTHROPIC_API_KEY est présent dans .env.
 *  - /demande question:  ou mentionner le bot dans 🤖┃commandes
 *  - Le contexte (règlement, salons publics, guide des commandes, FAQ du site) est mis en cache côté API :
 *    les questions suivantes coûtent beaucoup moins cher.
 *  - Limites : 5 questions / 10 min par membre, plafond quotidien réglable sur le site.
 */
const crypto = require('crypto');
const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { config, findChannel } = require('./shared');
const { db, save } = require('./store');
const settings = require('./settings');

const MODEL = 'claude-opus-5-5';
const PER_USER = 5;
const PER_USER_WINDOW_MS = 10 * 60_000;
const recent = new Map(); // userId -> [timestamps]

let client = null;
const enabled = () => Boolean(process.env.ANTHROPIC_API_KEY) && settings.on('assistant');

function getClient() {
  if (!client) {
    const Anthropic = require('@anthropic-ai/sdk');
    client = new Anthropic();
  }
  return client;
}

/** Contexte stable (aucune date ni valeur variable : sinon le cache de l'API ne servirait jamais). */
function systemPrompt(guild) {
  const publicAccess = new Set(['public-readonly', 'members', 'members-readonly', 'vip']);
  const channels = config.categories
    .flatMap((c) => c.channels.map((ch) => ({ ...ch, cat: c.name })))
    .filter((ch) => publicAccess.has(ch.access))
    .map((ch) => `- ${ch.name} (${ch.cat})${ch.topic ? ` : ${ch.topic}` : ''}${ch.access === 'vip' ? ' [réservé VIP / abonnés]' : ''}`)
    .join('\n');
  const guide = require('./guide')
    .sections('member')
    .map(([cat, lines]) => `${cat}\n${lines.map((l) => `- ${l.text} : ${l.desc}`).join('\n')}`)
    .join('\n\n');
  const faq = (settings.get('assistant.faq') ?? []).map((f) => `Q : ${f.q}\nR : ${f.a}`).join('\n\n');
  return `Tu es 剣聖 Kensei, le bot du serveur Discord « ${guild?.name ?? config.serverName} », la communauté de la chaîne Twitch de haro62190 (thème samouraï, les membres sont des « ronins », la monnaie est le ryō 両).

Ton rôle : répondre aux questions des membres sur le serveur : règles, salons, rôles, commandes du bot, fonctionnement des niveaux, quêtes, ryō, tournois, soirées gaming, lives.

Règles de réponse :
- Réponds en français, de façon courte et claire (5 phrases maximum), avec le ton chaleureux du dojo.
- Appuie-toi uniquement sur les informations ci-dessous. Si tu ne sais pas, dis-le et propose d'ouvrir un ticket dans 🎫┃ouvrir-un-ticket ou de demander au staff.
- Ne donne jamais d'informations sur le fonctionnement interne de la modération, les salons du staff, les réglages de sécurité ou le code du bot.
- Tu ne peux pas agir sur le serveur (donner des rôles, des ryō, sanctionner) : explique la commande ou la démarche à suivre.
- Si on te demande autre chose que le serveur, réponds brièvement si c'est anodin, sinon recentre gentiment sur le serveur.
- N'utilise pas de mention @everyone ou @here.

## Règlement
${config.rules.map((r, k) => `${k + 1}. ${r}`).join('\n')}

## Salons
${channels}

## Commandes du bot (membres)
${guide}
${faq ? `\n## Questions fréquentes\n${faq}` : ''}`;
}

/** Limite par membre et plafond quotidien. Renvoie un message d'erreur ou null. */
function checkLimits(userId) {
  const now = Date.now();
  const list = (recent.get(userId) ?? []).filter((t) => now - t < PER_USER_WINDOW_MS);
  if (list.length >= PER_USER) return `⏳ Doucement, ronin : ${PER_USER} questions toutes les 10 minutes. Réessaie <t:${Math.floor((list[0] + PER_USER_WINDOW_MS) / 1000)}:R>.`;
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  const usage = (db.assistantUsage ??= {});
  const cap = settings.get('assistant.dailyLimit') ?? 200;
  if ((usage[day]?.questions ?? 0) >= cap) return '😴 L\'assistant a atteint sa limite de questions pour aujourd\'hui. Reviens demain ou ouvre un ticket !';
  list.push(now);
  recent.set(userId, list);
  return null;
}

function recordUsage(u) {
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  const d = ((db.assistantUsage ??= {})[day] ??= { questions: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  d.questions++;
  d.input += u?.input_tokens ?? 0;
  d.output += u?.output_tokens ?? 0;
  d.cacheRead += u?.cache_read_input_tokens ?? 0;
  d.cacheWrite += u?.cache_creation_input_tokens ?? 0;
  for (const k of Object.keys(db.assistantUsage).sort().slice(0, -60)) delete db.assistantUsage[k];
  save();
}

/** Pose la question à Claude. Renvoie le texte de la réponse (déjà adapté à Discord). */
async function ask(guild, question, askerName = 'un membre') {
  const Anthropic = require('@anthropic-ai/sdk');
  try {
    const response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      // Questions simples : effort bas = réponses rapides et peu coûteuses
      output_config: { effort: 'low' },
      // Si un filtre de sécurité refuse la question, l'API la confie automatiquement à un autre modèle
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: systemPrompt(guild), cache_control: { type: 'ephemeral', ttl: '1h' } }],
      messages: [{ role: 'user', content: `Question de ${String(askerName).slice(0, 40)} :\n${String(question).slice(0, 1000)}` }],
    });
    recordUsage(response.usage);
    if (response.stop_reason === 'refusal') return '🙏 Je ne peux pas répondre à cette question. Pour toute aide, ouvre un ticket dans 🎫┃ouvrir-un-ticket.';
    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .replace(/@(everyone|here)/g, '@​$1')
      .trim();
    return (text || 'Je n\'ai pas de réponse à ça, désolé ! Demande au staff ou ouvre un ticket.').slice(0, 1900);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      console.error('Assistant IA : clé ANTHROPIC_API_KEY refusée.');
      return '⚠️ L\'assistant est mal configuré (clé API refusée) : préviens le staff.';
    }
    if (err instanceof Anthropic.RateLimitError) return '⏳ L\'assistant est très demandé, réessaie dans une minute.';
    if (err instanceof Anthropic.APIError) {
      console.error(`Assistant IA : erreur API ${err.status} :`, err.message);
      return '❌ L\'assistant ne répond pas pour le moment, réessaie plus tard.';
    }
    console.error('Assistant IA :', err.message);
    return '❌ L\'assistant ne répond pas pour le moment, réessaie plus tard.';
  }
}

/** Mention du bot dans 🤖┃commandes : réponse en fil de message. */
async function onMessage(message) {
  if (!enabled() || message.author.bot || !message.mentions.users.has(message.client.user.id)) return;
  const allowed = findChannel(message.guild, 'bot_commands');
  if (allowed && message.channelId !== allowed.id) return;
  const question = message.content.replace(/<@!?\d+>/g, '').trim();
  if (question.length < 3) return;
  const limited = checkLimits(message.author.id);
  if (limited) return message.reply({ content: limited, allowedMentions: { repliedUser: false } }).catch(() => {});
  await message.channel.sendTyping().catch(() => {});
  const answer = await ask(message.guild, question, message.member?.displayName ?? message.author.username);
  await message.reply({ content: answer, allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
}

const commands = [
  {
    category: '🎉 Général',
    data: new SlashCommandBuilder()
      .setName('demande')
      .setDescription('Pose une question sur le serveur à l\'assistant IA')
      .addStringOption((o) => o.setName('question').setDescription('Ta question').setRequired(true).setMaxLength(500)),
    async run(i) {
      if (!enabled()) return i.reply({ content: '🤖 L\'assistant IA n\'est pas activé sur ce serveur. Essaie `/guide` !', flags: MessageFlags.Ephemeral });
      const limited = checkLimits(i.user.id);
      if (limited) return i.reply({ content: limited, flags: MessageFlags.Ephemeral });
      await i.deferReply();
      const question = i.options.getString('question');
      const answer = await ask(i.guild, question, i.member?.displayName ?? i.user.username);
      return i.editReply({ content: `> ${question.slice(0, 200)}\n\n${answer}`.slice(0, 2000), allowedMentions: { parse: [] } });
    },
  },
];

const promptHash = (guild) => crypto.createHash('sha1').update(systemPrompt(guild)).digest('hex').slice(0, 10);

module.exports = { MODEL, enabled, systemPrompt, promptHash, checkLimits, recordUsage, ask, onMessage, commands, _setClient: (c) => (client = c) };
