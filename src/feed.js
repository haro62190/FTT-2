/**
 * Fil des derniers événements du serveur (accueil du tableau de bord) :
 * passages de niveau, quêtes, /daily, lives, paliers, boosts, piliers de la semaine, quarantaines…
 */
const { db, save } = require('./store');

const KEEP = 60;

/** Ajoute un événement. icon : emoji · text : texte court (pas de mention Discord) */
function push(icon, text) {
  (db.feed ??= []).unshift({ icon, text: String(text).slice(0, 160), at: Date.now() });
  db.feed = db.feed.slice(0, KEEP);
  save();
}

const recent = (n = 8) => (db.feed ?? []).slice(0, n);

module.exports = { push, recent };
