/**
 * Journal des erreurs : tout ce qui passe par console.error / console.warn est aussi écrit (secrets masqués)
 * dans data/logs/erreurs.log, avec rotation (3 fichiers de 1 Mo).
 * Vérifie aussi que le fichier .env n'est lisible que par son propriétaire (Linux).
 */
const fs = require('fs');
const path = require('path');
const util = require('util');
const { redact } = require('./redact');

const MAX = 1024 * 1024;
let file = null;
const listeners = new Set();
/** Être prévenu de chaque erreur / avertissement (utilisé par 🛡️ Kensei Guardian). */
const onLog = (fn) => listeners.add(fn);

function write(level, args) {
  if (!file) return;
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > MAX) {
      for (let n = 2; n >= 1; n--) if (fs.existsSync(`${file}.${n}`)) fs.renameSync(`${file}.${n}`, `${file}.${n + 1}`);
      fs.renameSync(file, `${file}.1`);
    }
    const line = `[${new Date().toISOString()}] ${level} ${redact(util.format(...args))}\n`;
    fs.appendFileSync(file, line);
  } catch {}
}

function install() {
  const dir = path.join(require('./store').DIR, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  file = path.join(dir, 'erreurs.log');
  for (const [name, level] of [['error', 'ERREUR'], ['warn', 'ATTENTION']]) {
    const original = console[name].bind(console);
    console[name] = (...args) => {
      original(...args.map((a) => (typeof a === 'string' ? redact(a) : a)));
      write(level, args);
      for (const fn of listeners) {
        try {
          fn(level, redact(util.format(...args)));
        } catch {}
      }
    };
  }
  checkEnvFile();
}

/** .env lisible par d'autres utilisateurs du serveur : on corrige (chmod 600) et on prévient. */
function checkEnvFile() {
  const env = path.join(__dirname, '..', '.env');
  if (process.platform === 'win32' || !fs.existsSync(env)) return;
  try {
    const mode = fs.statSync(env).mode & 0o777;
    if (mode & 0o077) {
      fs.chmodSync(env, 0o600);
      console.warn(`🔐 .env était lisible par d'autres utilisateurs (droits ${mode.toString(8)}) : corrigé en 600.`);
    }
  } catch {}
}

/** Dernières lignes du journal (pour le tableau de bord), sans celles d'avant le dernier « Effacer ». */
function tail(lines = 100) {
  const since = clearedAt();
  try {
    return fs
      .readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .filter((l) => {
        if (!since) return true;
        const t = Date.parse(l.match(/^\[([^\]]+)\]/)?.[1] ?? '');
        return Number.isNaN(t) || t > since;
      })
      .slice(-lines);
  } catch {
    return [];
  }
}

/**
 * « Effacer » les erreurs affichées : elles sont seulement masquées sur le site (le fichier data/logs/erreurs.log
 * est gardé pour un diagnostic). Les nouvelles erreurs s'affichent normalement.
 */
const clearedAt = () => require('./store').db.errorsClearedAt ?? 0;
function clear() {
  const { db, save } = require('./store');
  db.errorsClearedAt = Date.now();
  save();
  for (const fn of clearListeners) fn();
}
const clearListeners = new Set();
const onClear = (fn) => clearListeners.add(fn);

module.exports = { install, tail, onLog, clear, onClear, clearedAt };
