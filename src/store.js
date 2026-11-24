/**
 * Base de données SQLite (data/ronin.db) via le module SQLite intégré à Node.js (aucune dépendance).
 *  - table `kv`      : données du bot (XP, avertissements, tickets, réglages…), une ligne par section
 *  - table `backups` : sauvegardes du serveur (/backup)
 * Les sections sont gardées en mémoire (`db`) et écrites en base par `save()`.
 */
const fs = require('fs');
const path = require('path');

// Le module node:sqlite affiche un avertissement « expérimental » : on le masque
const emitWarning = process.emitWarning;
process.emitWarning = (w, ...rest) => (String(w).includes('SQLite') ? undefined : emitWarning.call(process, w, ...rest));
let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  console.error(`❌ Node.js ${process.version} est trop ancien : Kensei a besoin de Node.js 22.5 ou plus (https://nodejs.org).`);
  process.exit(1);
}
process.emitWarning = emitWarning;

// RONIN_DATA_DIR : dossier de données différent (utilisé par les tests automatiques)
const DIR = process.env.RONIN_DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DIR, { recursive: true });
const DB_FILE = path.join(DIR, 'ronin.db');
const BACKUP_DIR = path.join(DIR, 'sauvegardes');

/** Infos de récupération (base abîmée remplacée, restauration demandée) : lues par health.js pour prévenir le staff */
const recovery = { happened: false, from: null, reason: null };

const moveAside = (suffix) => {
  for (const ext of ['', '-wal', '-shm']) if (fs.existsSync(DB_FILE + ext)) fs.renameSync(DB_FILE + ext, `${DB_FILE}${ext}.${suffix}`);
};

/** Dernière copie vérifiée de data/sauvegardes (la plus récente d'abord). */
function latestVerifiedBackup() {
  try {
    const index = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, 'index.json'), 'utf8'));
    return index.filter((e) => e.verified && fs.existsSync(path.join(BACKUP_DIR, e.file))).sort((a, b) => b.at - a.at)[0] ?? null;
  } catch {
    return null;
  }
}

/** Ouvre la base ; si elle est corrompue, la met de côté et repart de la dernière copie vérifiée. */
function openDatabase() {
  // Restauration demandée depuis le tableau de bord : appliquée au démarrage, bot arrêté
  const pending = path.join(DIR, 'restauration.json');
  if (fs.existsSync(pending)) {
    try {
      const { file } = JSON.parse(fs.readFileSync(pending, 'utf8'));
      const src = path.join(BACKUP_DIR, path.basename(file));
      if (fs.existsSync(src)) {
        moveAside(`avant-restauration-${Date.now()}`);
        fs.copyFileSync(src, DB_FILE);
        Object.assign(recovery, { happened: true, from: path.basename(file), reason: 'restauration demandée depuis le tableau de bord' });
      }
    } catch {}
    fs.rmSync(pending, { force: true });
  }
  try {
    const conn = new DatabaseSync(DB_FILE);
    const check = conn.prepare('PRAGMA quick_check').get();
    if (Object.values(check ?? {})[0] !== 'ok') throw new Error(`contrôle d'intégrité : ${JSON.stringify(check)}`);
    return conn;
  } catch (err) {
    const backup = latestVerifiedBackup();
    console.error(`❌ Base de données abîmée (${err.message}). ${backup ? `Restauration automatique depuis ${backup.file}` : 'Aucune copie vérifiée : nouvelle base vide'}.`);
    moveAside(`corrompue-${Date.now()}`);
    if (backup) fs.copyFileSync(path.join(BACKUP_DIR, backup.file), DB_FILE);
    Object.assign(recovery, { happened: true, from: backup?.file ?? null, reason: err.message });
    return new DatabaseSync(DB_FILE);
  }
}

const sql = openDatabase();
sql.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    created_by TEXT,
    data TEXT NOT NULL
  );
`);

const db = { warns: {}, levels: {} };
// Dernière valeur écrite de chaque section : on n'écrit que ce qui a changé, pour ne pas écraser
// les données d'un autre processus (ex : `npm run setup` lancé pendant que le bot tourne)
const written = new Map();
for (const row of sql.prepare('SELECT key, value FROM kv').all()) {
  try {
    db[row.key] = JSON.parse(row.value);
    written.set(row.key, row.value);
  } catch {}
}

// Migration automatique depuis l'ancien fichier data/db.json
const legacy = path.join(DIR, 'db.json');
if (fs.existsSync(legacy) && !sql.prepare('SELECT 1 FROM kv LIMIT 1').get()) {
  try {
    Object.assign(db, JSON.parse(fs.readFileSync(legacy, 'utf8')));
    flush();
    fs.renameSync(legacy, legacy + '.migre');
    console.log('📦 data/db.json importé dans la base SQLite data/ronin.db');
  } catch (err) {
    console.error('⚠️ Migration de data/db.json impossible :', err.message);
  }
}

function flush() {
  const upsert = sql.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  sql.exec('BEGIN');
  try {
    const changed = [];
    for (const [key, value] of Object.entries(db)) {
      const json = JSON.stringify(value ?? null);
      if (written.get(key) !== json) {
        upsert.run(key, json);
        changed.push([key, json]);
      }
    }
    sql.exec('COMMIT');
    for (const [key, json] of changed) written.set(key, json);
  } catch (err) {
    sql.exec('ROLLBACK');
    throw err;
  }
}

let timer = null;
/** Sauvegarde groupée (au plus une écriture toutes les 2 s). */
function save() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try {
      flush();
    } catch (err) {
      console.error('Sauvegarde impossible :', err.message);
    }
  }, 2000);
}

// Arrêt demandé par `npm run dev` (fonctionne aussi sous Windows, où SIGTERM coupe net)
process.on('message', (m) => {
  if (m !== 'shutdown') return;
  try {
    flush();
  } catch {}
  process.exit(0);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    try {
      flush();
    } catch {}
    process.exit(0);
  });
}

module.exports = { db, save, flush, sql, DIR, DB_FILE, BACKUP_DIR, recovery };
