/**
 * Historique quotidien pour les graphiques du tableau de bord (120 jours conservés).
 * Compteurs du jour (messages, minutes de vocal, arrivées, départs) + relevés (membres, followers…).
 */
const { db, save } = require('./store');

const KEEP_DAYS = 120;
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }); // AAAA-MM-JJ

function day() {
  const h = (db.history ??= {});
  const d = today();
  if (!h[d]) {
    h[d] = {};
    const days = Object.keys(h).sort();
    for (const old of days.slice(0, Math.max(0, days.length - KEEP_DAYS))) delete h[old];
  }
  return h[d];
}

/** Ajoute n au compteur du jour (messages, voice, joins, leaves) */
function bump(field, n = 1) {
  const d = day();
  d[field] = (d[field] ?? 0) + n;
  save();
}

/** Note la valeur du jour (members, twitch, tiktok) */
function gauge(field, value) {
  if (value === null || value === undefined) return;
  day()[field] = value;
  save();
}

/** [{ date, ...valeurs }] des `days` derniers jours (jours sans données inclus) */
function series(days = 30) {
  const out = [];
  const now = new Date();
  for (let k = days - 1; k >= 0; k--) {
    const d = new Date(now.getTime() - k * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
    out.push({ date: d, ...(db.history?.[d] ?? {}) });
  }
  return out;
}

module.exports = { bump, gauge, series };
