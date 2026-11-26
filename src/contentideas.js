/**
 * 🎬 Idées de contenu après un live : à partir des moments forts du chat (pics de messages) et des clips
 * les plus vus pendant le live, une liste « à monter en Short / TikTok » est envoyée au staff, avec les liens
 * horodatés vers la rediffusion. Ce sont des suggestions : rien n'est publié automatiquement.
 */
const { EmbedBuilder } = require('discord.js');
const { findChannel } = require('./shared');

/** Classe les meilleures idées : clips les plus vus d'abord, puis les plus gros pics du chat (sans doublon proche). */
function ideas({ highlights = [], clips = [], vodUrl = null, startedAt = null }, max = 5) {
  const { hms } = require('./twitchchat');
  const out = [];
  for (const c of [...clips].sort((a, b) => b.views - a.views)) {
    out.push({ kind: 'clip', score: 1000 + c.views, title: c.title, url: c.url, why: `clip de ${c.creator} · ${c.views} vues`, offset: startedAt ? Math.round((c.createdAt - startedAt) / 1000) : null });
  }
  for (const h of [...highlights].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))) {
    if (out.some((x) => x.offset !== null && Math.abs(x.offset - h.offset) < 90)) continue; // déjà couvert par un clip
    const t = hms(h.offset);
    out.push({ kind: 'moment', score: h.rate ?? 0, title: h.words?.length ? `« ${h.words.slice(0, 3).join(' ')} »` : 'Gros pic du chat', url: vodUrl ? `${vodUrl}?t=${t.vod}` : null, why: `pic du chat à ${t.text}${h.rate ? ` (${Math.round(h.rate)} msg/min)` : ''}`, offset: h.offset });
  }
  return out.slice(0, max);
}

function embed(list, title) {
  return new EmbedBuilder()
    .setColor(0xe10600)
    .setTitle('🎬 Idées de contenu à publier')
    .setDescription(
      `${title ? `Live « ${title} »\n` : ''}Les meilleurs moments à monter en **Short / TikTok** :\n\n` +
        list.map((x, k) => `**${k + 1}.** ${x.kind === 'clip' ? '🎞️' : '💥'} ${x.url ? `[${x.title}](${x.url})` : x.title}\n　${x.why}`).join('\n').slice(0, 3900),
    )
    .setFooter({ text: 'Suggestions seulement : rien n\'est publié automatiquement · module « Moments forts »' });
}

/** Envoyé au staff à la fin du live (si au moins une idée). */
async function postAfterLive(guild, { title, highlights, clips, vodUrl, startedAt }) {
  if (!require('./settings').on('highlights')) return null;
  const list = ideas({ highlights, clips, vodUrl, startedAt });
  if (!list.length) return null;
  const staff = findChannel(guild, 'mod_chat');
  await staff?.send({ embeds: [embed(list, title)], allowedMentions: { parse: [] } }).catch(() => {});
  return list;
}

module.exports = { ideas, embed, postAfterLive };
