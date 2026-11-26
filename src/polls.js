/**
 * 📊 Sondages avancés : jusqu'à 10 choix, vote anonyme (par défaut) ou public, choix multiple,
 * date limite, résultats cachés ou visibles pendant le vote, résultats publiés automatiquement à la fin.
 * Les votes sont gardés en base : un redémarrage du bot ne perd rien et la clôture se fait quand même.
 */
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { BRAND_COLOR, isStaffMember, own } = require('./shared');
const { db, save } = require('./store');

const LETTERS = ['🇦', '🇧', '🇨', '🇩', '🇪', '🇫', '🇬', '🇭', '🇮', '🇯'];
const MAX_DAYS = 30;
const all = () => (db.polls ??= {});
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });
let clientRef = null;
const dirty = new Set();

/** « 30m », « 2h », « 3j », « 1j12h », « 90 » (minutes) → millisecondes */
function parseDuration(text) {
  const s = String(text ?? '').toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s) * 60_000;
  let ms = 0;
  let rest = s;
  for (const [re, unit] of [
    [/(\d+)(j|d|jours?)/, 86_400_000],
    [/(\d+)(h|heures?)/, 3_600_000],
    [/(\d+)(m|min|minutes?)/, 60_000],
  ]) {
    const m = rest.match(re);
    if (m) {
      ms += Number(m[1]) * unit;
      rest = rest.replace(m[0], '');
    }
  }
  return ms && !rest ? ms : null;
}

function counts(p) {
  const c = p.options.map(() => 0);
  for (const picks of Object.values(p.votes)) for (const k of picks) if (k < c.length) c[k]++;
  return c;
}

const bar = (n, total) => {
  const pct = total ? Math.round((n / total) * 100) : 0;
  const filled = Math.round(pct / 10);
  return `\`${'█'.repeat(filled)}${'░'.repeat(10 - filled)}\` ${pct} % (${n})`;
};

function render(p) {
  const voters = Object.keys(p.votes).length;
  const c = counts(p);
  const total = c.reduce((a, b) => a + b, 0);
  const showResults = p.closed || p.live;
  const best = Math.max(...c);
  const lines = p.options.map((o, k) => {
    const win = p.closed && best > 0 && c[k] === best ? ' 🏆' : '';
    return `${LETTERS[k]} **${o}**${win}${showResults ? `\n${bar(c[k], total)}` : ''}`;
  });
  const mode = [p.anonymous ? '🕶️ vote anonyme' : '👁️ vote public', p.multi ? '☑️ plusieurs choix possibles' : '1️⃣ un seul choix', p.live ? '📈 résultats en direct' : '🙈 résultats à la fin'].join(' · ');
  const embed = new EmbedBuilder()
    .setColor(p.closed ? 0x3a3a3a : BRAND_COLOR)
    .setTitle(`📊 ${p.question}`)
    .setDescription(`${lines.join('\n\n')}\n\n${mode}`)
    .setFooter({ text: `${voters} votant${voters > 1 ? 's' : ''}${p.closed ? ' · sondage terminé' : ''}` });
  embed.addFields({ name: p.closed ? '🔒 Terminé' : '⏳ Fin du vote', value: `<t:${Math.floor((p.closed || p.endsAt) / 1000)}:${p.closed ? 'f' : 'R'}>`, inline: true });
  if (p.closed && !p.anonymous && voters) {
    const who = p.options
      .map((o, k) => {
        const ids = Object.entries(p.votes)
          .filter(([, picks]) => picks.includes(k))
          .map(([id]) => `<@${id}>`);
        return ids.length ? `${LETTERS[k]} ${ids.slice(0, 15).join(' ')}${ids.length > 15 ? ` +${ids.length - 15}` : ''}` : null;
      })
      .filter(Boolean)
      .join('\n');
    if (who) embed.addFields({ name: '👥 Qui a voté quoi', value: who.slice(0, 1024) });
  }
  const rows = [];
  if (!p.closed) {
    for (let r = 0; r < p.options.length; r += 5) {
      rows.push(
        new ActionRowBuilder().addComponents(
          p.options.slice(r, r + 5).map((o, j) =>
            new ButtonBuilder()
              .setCustomId(`poll:v:${p.id}:${r + j}`)
              .setEmoji(LETTERS[r + j])
              .setLabel(o.slice(0, 40))
              .setStyle(ButtonStyle.Secondary),
          ),
        ),
      );
    }
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`poll:me:${p.id}`).setLabel('Mon vote').setEmoji('🔎').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`poll:end:${p.id}`).setLabel('Clore').setEmoji('🔒').setStyle(ButtonStyle.Danger),
      ),
    );
  }
  return { embeds: [embed], components: rows, allowedMentions: { parse: [] } };
}

function create({ question, options, ms, anonymous = true, multi = false, live = false, by = null }) {
  const opts = [...new Set(options.map((o) => String(o).trim()).filter(Boolean))].slice(0, 10);
  if (opts.length < 2) throw new Error('Il faut au moins 2 choix différents.');
  if (!ms || ms < 60_000 || ms > MAX_DAYS * 86_400_000) throw new Error(`Durée invalide : entre 1 minute et ${MAX_DAYS} jours (ex. 30m, 2h, 3j).`);
  const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const p = { id, question: String(question).slice(0, 250), options: opts.map((o) => o.slice(0, 80)), anonymous, multi, live, votes: {}, by, createdAt: Date.now(), endsAt: Date.now() + ms, closed: null };
  all()[id] = p;
  save();
  return p;
}

/** Vote (ou retire son vote en recliquant). Renvoie le choix actuel du membre. */
function vote(p, userId, k) {
  if (p.closed) throw new Error('Ce sondage est terminé.');
  if (k < 0 || k >= p.options.length) throw new Error('Choix invalide.');
  const cur = p.votes[userId] ?? [];
  let next;
  if (cur.includes(k)) next = cur.filter((x) => x !== k);
  else next = p.multi ? [...cur, k].sort() : [k];
  if (next.length) p.votes[userId] = next;
  else delete p.votes[userId];
  dirty.add(p.id);
  save();
  return next;
}

async function close(p) {
  if (p.closed) return;
  p.closed = Date.now();
  save();
  const channel = clientRef?.channels.cache.get(p.channelId);
  if (!channel) return;
  const msg = await channel.messages.fetch(p.messageId).catch(() => null);
  if (msg) await msg.edit(render(p)).catch(() => {});
  const c = counts(p);
  const best = Math.max(...c);
  const voters = Object.keys(p.votes).length;
  const winners = best > 0 ? p.options.filter((_, k) => c[k] === best) : [];
  await channel
    .send({
      content: `📊 **Résultats du sondage « ${p.question} »** — ${voters} votant${voters > 1 ? 's' : ''}\n${winners.length ? `🏆 ${winners.length > 1 ? 'Égalité' : 'Gagnant'} : **${winners.join('** / **')}**` : 'Personne n\'a voté.'}${msg ? `\n${msg.url}` : ''}`,
      allowedMentions: { parse: [] },
    })
    .catch(() => {});
  require('./feed').push('📊', `Sondage terminé : ${p.question.slice(0, 80)}`);
}

/** Toutes les 20 s : clôtures + mise à jour (groupée) des messages dont les résultats sont visibles. */
async function tick() {
  for (const p of Object.values(all())) {
    if (!p.closed && Date.now() >= p.endsAt) await close(p).catch((e) => console.error('Sondage :', e.message));
  }
  for (const id of [...dirty]) {
    dirty.delete(id);
    const p = own(all(), id);
    if (!p || p.closed) continue;
    const msg = await clientRef?.channels.cache.get(p.channelId)?.messages.fetch(p.messageId).catch(() => null);
    if (msg) await msg.edit(render(p)).catch(() => {});
  }
  // Ménage : sondages terminés depuis plus de 90 jours
  for (const [id, p] of Object.entries(all())) if (p.closed && Date.now() - p.closed > 90 * 86_400_000) delete all()[id];
}

function start(client) {
  clientRef = client;
  setInterval(() => tick().catch((e) => console.error('Sondages :', e.message)), 20_000).unref();
}

async function handleInteraction(i) {
  const id = i.customId ?? '';
  if (!id.startsWith('poll:')) return false;
  const [, action, pid, k] = id.split(':');
  const p = own(all(), pid);
  if (!p) {
    await i.reply(ephemeral('Sondage introuvable.'));
    return true;
  }
  const mine = () => (p.votes[i.user.id] ?? []).map((x) => `${LETTERS[x]} ${p.options[x]}`).join(', ');
  if (action === 'v') {
    try {
      const picks = vote(p, i.user.id, Number(k));
      await i.reply(ephemeral(picks.length ? `✅ Ton vote : **${mine()}**${p.anonymous ? '\n🕶️ Personne d\'autre ne le voit.' : ''}${p.multi ? '\nReclique sur un choix pour le retirer.' : ''}` : '↩️ Vote retiré.'));
    } catch (e) {
      await i.reply(ephemeral(`❌ ${e.message}`));
    }
    return true;
  }
  if (action === 'me') {
    await i.reply(ephemeral(p.votes[i.user.id] ? `🔎 Ton vote : **${mine()}**` : 'Tu n\'as pas encore voté.'));
    return true;
  }
  if (action === 'end') {
    if (i.user.id !== p.by && !isStaffMember(i.member)) {
      await i.reply(ephemeral('Seul l\'auteur du sondage ou le staff peut le clore.'));
      return true;
    }
    await i.reply(ephemeral('🔒 Sondage clos, les résultats sont publiés.'));
    await close(p);
    return true;
  }
  return false;
}

const commands = [
  {
    category: '🎉 Général',
    data: new SlashCommandBuilder()
      .setName('sondage')
      .setDescription('Créer un sondage (anonyme, avec date limite et résultats automatiques)')
      .addStringOption((o) => o.setName('question').setDescription('La question').setRequired(true).setMaxLength(250))
      .addStringOption((o) => o.setName('choix').setDescription('Les choix séparés par ; (2 à 10) — ex. Warzone ; Fortnite ; Minecraft').setRequired(true).setMaxLength(900))
      .addStringOption((o) => o.setName('duree').setDescription('Durée : 30m, 2h, 3j… (24h par défaut, 30j max)').setMaxLength(12))
      .addBooleanOption((o) => o.setName('anonyme').setDescription('Vote anonyme (oui par défaut). Non = les votants sont affichés à la fin'))
      .addBooleanOption((o) => o.setName('multiple').setDescription('Autoriser plusieurs choix (non par défaut)'))
      .addBooleanOption((o) => o.setName('resultats_en_direct').setDescription('Montrer les résultats pendant le vote (non par défaut)')),
    async run(i) {
      const durText = i.options.getString('duree');
      const ms = durText ? parseDuration(durText) : 86_400_000;
      try {
        const p = create({
          question: i.options.getString('question'),
          options: i.options.getString('choix').split(/[;|\n]/),
          ms,
          anonymous: i.options.getBoolean('anonyme') ?? true,
          multi: i.options.getBoolean('multiple') ?? false,
          live: i.options.getBoolean('resultats_en_direct') ?? false,
          by: i.user.id,
        });
        const msg = await i.reply({ ...render(p), withResponse: true });
        const sent = msg.resource?.message ?? (await i.fetchReply());
        p.messageId = sent.id;
        p.channelId = i.channelId;
        save();
      } catch (e) {
        return i.reply(ephemeral(`❌ ${e.message}`));
      }
    },
  },
];

module.exports = { parseDuration, counts, render, create, vote, close, tick, start, handleInteraction, commands, LETTERS };
