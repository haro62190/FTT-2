/**
 * Copies de la base SQLite dans data/sauvegardes/, en plusieurs générations :
 *   7 dernières journalières · 4 hebdomadaires · 6 mensuelles · 5 manuelles
 * Chaque copie est VÉRIFIÉE juste après sa création (ouverte à part, contrôle d'intégrité, lecture des données) :
 * c'est un test de restauration automatique. Si la base principale est abîmée au démarrage, store.js repart
 * de la dernière copie vérifiée. Restauration manuelle : tableau de bord → Sauvegardes (appliquée au redémarrage).
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { sql, DIR, BACKUP_DIR, db, save } = require('./store');

const INDEX = path.join(BACKUP_DIR, 'index.json');
const KEEP = { daily: 7, weekly: 4, monthly: 6, manual: 5 };

const readIndex = () => {
  try {
    return JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  } catch {
    return [];
  }
};
const writeIndex = (list) => fs.writeFileSync(INDEX, JSON.stringify(list, null, 2));

/** Test de restauration : la copie s'ouvre, passe le contrôle d'intégrité et toutes ses données se relisent. */
function verify(file) {
  let conn;
  try {
    conn = new DatabaseSync(file, { readOnly: true });
    const integrity = Object.values(conn.prepare('PRAGMA integrity_check').get() ?? {})[0];
    if (integrity !== 'ok') return { ok: false, error: `intégrité : ${integrity}` };
    const rows = conn.prepare('SELECT key, value FROM kv').all();
    for (const r of rows) JSON.parse(r.value); // chaque section doit se relire
    const backups = conn.prepare('SELECT count(*) AS n FROM backups').get().n;
    return { ok: true, sections: rows.length, backups };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    conn?.close();
  }
}

/** Crée une copie (type 'auto' ou 'manual'), la vérifie, puis applique la rotation. */
function create(kind = 'auto') {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  require('./store').flush();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const file = `ronin-${stamp}${kind === 'manual' ? '-manuel' : ''}.db`;
  const full = path.join(BACKUP_DIR, file);
  if (fs.existsSync(full)) fs.rmSync(full);
  sql.exec(`VACUUM INTO '${full.replaceAll("'", "''")}'`);
  const check = verify(full);
  const entry = { file, at: Date.now(), size: fs.statSync(full).size, kind, verified: check.ok, check };
  const list = readIndex().filter((e) => e.file !== file);
  list.push(entry);
  writeIndex(rotate(list));
  db.lastFileBackup = { at: entry.at, file, verified: check.ok };
  save();
  if (!check.ok) console.error(`❌ Copie de la base ${file} invalide : ${check.error}`);
  return entry;
}

/** Garde les générations voulues, supprime le reste (fichiers compris). */
function rotate(list) {
  const keep = new Set();
  const byNewest = [...list].sort((a, b) => b.at - a.at);
  const pick = (entries, keyOf, n) => {
    const seen = new Set();
    for (const e of entries) {
      const k = keyOf(new Date(e.at));
      if (seen.has(k)) continue;
      seen.add(k);
      keep.add(e.file);
      if (seen.size >= n) break;
    }
  };
  const auto = byNewest.filter((e) => e.kind !== 'manual' && e.verified);
  pick(auto, (d) => d.toISOString().slice(0, 10), KEEP.daily);
  pick(auto, (d) => {
    const t = new Date(d);
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); // lundi de la semaine
    return t.toISOString().slice(0, 10);
  }, KEEP.weekly);
  pick(auto, (d) => d.toISOString().slice(0, 7), KEEP.monthly);
  byNewest.filter((e) => e.kind === 'manual').slice(0, KEEP.manual).forEach((e) => keep.add(e.file));
  // Les copies non vérifiées ne sont jamais gardées à la place d'une bonne, mais la dernière reste pour diagnostic
  if (byNewest[0] && !byNewest[0].verified) keep.add(byNewest[0].file);
  for (const e of list) if (!keep.has(e.file)) fs.rmSync(path.join(BACKUP_DIR, e.file), { force: true });
  return list.filter((e) => keep.has(e.file)).sort((a, b) => b.at - a.at);
}

const list = () => readIndex().filter((e) => fs.existsSync(path.join(BACKUP_DIR, e.file))).sort((a, b) => b.at - a.at);

/** Revérifie une copie existante (bouton du tableau de bord). */
function recheck(file) {
  const entries = readIndex();
  const e = entries.find((x) => x.file === path.basename(file));
  if (!e) return null;
  e.check = verify(path.join(BACKUP_DIR, e.file));
  e.verified = e.check.ok;
  writeIndex(entries);
  return e;
}

/** Demande la restauration d'une copie : appliquée au prochain démarrage (bot arrêté, base actuelle gardée de côté). */
function requestRestore(file) {
  const e = list().find((x) => x.file === path.basename(file));
  if (!e?.verified) throw new Error('Copie introuvable ou non vérifiée');
  create('manual'); // filet de sécurité : l'état actuel est copié avant
  fs.writeFileSync(path.join(DIR, 'restauration.json'), JSON.stringify({ file: e.file, at: Date.now() }));
  return e;
}

/** Copie automatique quotidienne. */
function daily() {
  const last = db.lastFileBackup?.at ?? 0;
  if (Date.now() - last < 23 * 3600_000) return null;
  const e = create('auto');
  console.log(`💾 Copie de la base ${e.file} ${e.verified ? 'vérifiée ✅' : 'INVALIDE ❌'}`);
  return e;
}

module.exports = { create, verify, rotate, list, recheck, requestRestore, daily, KEEP };
