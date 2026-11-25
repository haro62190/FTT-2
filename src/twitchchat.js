/**
 * 💥 Moments forts : pendant un live Twitch, le bot lit le chat (connexion anonyme en lecture seule,
 * aucun compte ni jeton nécessaire) et repère les pics d'activité. Chaque moment fort est :
 *  - signalé au staff (🛡️┃staff) pour penser à clipper,
 *  - ajouté au récap de fin de live avec un lien direct vers ce moment dans la rediffusion.
 * Le bot ne stocke pas les messages : seulement leur nombre et les mots les plus répétés lors d'un pic.
 */
const { findChannel } = require('./shared');
const { db, save } = require('./store');
const settings = require('./settings');

const IRC = 'wss://irc-ws.chat.twitch.tv:443';
const BUCKET_MS = 5_000;
const WINDOW_BUCKETS = 6; // fenêtre de 30 s
const BASELINE_BUCKETS = 60; // 5 min de référence
const COOLDOWN_MS = 3 * 60_000;

/** Détecteur de pics (testable sans réseau). */
function createDetector({ factor = 3, min = 15 } = {}) {
  const buckets = []; // { t, n, words: Map }
  let lastSpike = 0;
  const bucketAt = (t) => {
    const key = Math.floor(t / BUCKET_MS) * BUCKET_MS;
    let b = buckets.at(-1);
    if (!b || b.t !== key) {
      b = { t: key, n: 0, words: new Map() };
      buckets.push(b);
      while (buckets.length > BASELINE_BUCKETS + WINDOW_BUCKETS) buckets.shift();
    }
    return b;
  };
  return {
    push(t, text = '') {
      const b = bucketAt(t);
      b.n++;
      // Seulement des mots simples (lettres, chiffres) : pas de liens, mentions ni balisage venant du chat
      const words = String(text)
        .split(/\s+/)
        .filter((x) => x.length >= 2 && x.length <= 25 && /^[\p{L}\p{N}_'!?.-]+$/u.test(x) && !/https?|www\.|discord\.gg/i.test(x))
        .slice(0, 8);
      for (const w of new Set(words)) b.words.set(w, (b.words.get(w) ?? 0) + 1);
    },
    /** Renvoie { rate, words } si un pic commence maintenant, sinon null. */
    check(t) {
      if (t - lastSpike < COOLDOWN_MS) return null;
      const recent = buckets.filter((b) => b.t > t - WINDOW_BUCKETS * BUCKET_MS);
      const older = buckets.filter((b) => b.t <= t - WINDOW_BUCKETS * BUCKET_MS);
      const count = recent.reduce((n, b) => n + b.n, 0);
      if (older.length < 6) return null; // pas encore assez d'historique
      const baseline = (older.reduce((n, b) => n + b.n, 0) / older.length) * WINDOW_BUCKETS;
      if (count < min || count < baseline * factor) return null;
      lastSpike = t;
      const words = new Map();
      for (const b of recent) for (const [w, n] of b.words) words.set(w, (words.get(w) ?? 0) + n);
      return {
        rate: count,
        baseline: Math.round(baseline),
        words: [...words.entries()]
          .filter(([, n]) => n >= 3)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([w]) => w),
      };
    },
  };
}

const hms = (sec) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return { text: `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`, vod: `${h}h${m}m${s}s` };
};

let ws = null;
let joined = null;
let detector = null;
let guildRef = null;
let tickTimer = null;
let reconnectTimer = null;

async function onSpike(spike) {
  const live = db.twitchLive;
  if (!live) return;
  const offset = Math.max(0, (Date.now() - new Date(live.startedAt).getTime()) / 1000 - 20); // un peu avant le pic
  const h = hms(offset);
  (live.highlights ??= []).push({ at: Date.now(), offset: Math.round(offset), rate: spike.rate, words: spike.words });
  live.highlights = live.highlights.slice(-20);
  save();
  if (settings.get('notifications.highlights') === false) return;
  const staff = guildRef && findChannel(guildRef, 'mod_chat');
  await staff
    ?.send({
      content: `💥 **Moment fort** à **${h.text}** du live : le chat s'emballe (${spike.rate} messages en 30 s, d'habitude ~${spike.baseline})${spike.words.length ? ` · « ${spike.words.join(' ')} »` : ''}. Pensez à clipper ! https://twitch.tv/${joined}`,
      allowedMentions: { parse: [] },
    })
    .catch(() => {});
}

function connect(login) {
  stop();
  joined = login.toLowerCase();
  detector = createDetector({ factor: settings.get('notifications.highlightFactor') ?? 3, min: settings.get('notifications.highlightMin') ?? 15 });
  if (typeof WebSocket === 'undefined') return console.warn('💥 Moments forts : WebSocket indisponible (Node 22 requis).');
  ws = new WebSocket(IRC);
  ws.onopen = () => {
    ws.send('CAP REQ :twitch.tv/tags');
    ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`);
    ws.send(`JOIN #${joined}`);
  };
  ws.onmessage = (ev) => {
    for (const line of String(ev.data).split('\r\n')) {
      if (!line) continue;
      if (line.startsWith('PING')) ws.send('PONG :tmi.twitch.tv');
      const m = line.match(/ PRIVMSG #\S+ :(.*)$/);
      if (m) detector.push(Date.now(), m[1]);
    }
  };
  ws.onclose = () => {
    ws = null;
    // Coupure pendant le live : on se reconnecte
    if (joined && db.twitchLive) reconnectTimer = setTimeout(() => joined && connect(joined), 15_000);
  };
  ws.onerror = () => {};
  tickTimer = setInterval(() => {
    const spike = detector?.check(Date.now());
    if (spike) onSpike(spike).catch((e) => console.error('Moments forts :', e.message));
  }, BUCKET_MS);
  console.log(`💥 Lecture du chat Twitch de ${joined} (moments forts)`);
}

function stop() {
  clearInterval(tickTimer);
  clearTimeout(reconnectTimer);
  tickTimer = null;
  const old = ws;
  ws = null;
  joined = null;
  try {
    old?.close();
  } catch {}
}

/** Appelé à chaque vérification du live. */
function sync(guild, login, isLive) {
  guildRef = guild;
  const wanted = isLive && settings.on('highlights') ? String(login).toLowerCase() : null;
  if (wanted && joined !== wanted) connect(wanted);
  else if (!wanted && joined) stop();
}

/** Champ du récap : liens vers chaque moment fort dans la rediffusion. */
function recapLines(highlights = [], vodUrl = null) {
  return highlights.slice(0, 8).map((x) => {
    const h = hms(x.offset);
    const label = `${h.text}${x.words?.length ? ` — « ${x.words.slice(0, 3).join(' ')} »` : ''}`;
    return vodUrl ? `💥 [${label}](${vodUrl}?t=${h.vod})` : `💥 ${label}`;
  });
}

module.exports = { createDetector, sync, stop, recapLines, hms };
