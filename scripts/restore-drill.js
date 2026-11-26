/**
 * 🧪 Exercice de restauration, SANS toucher aux vraies données :
 * la copie choisie est recopiée dans un dossier temporaire, puis le VRAI code de chargement du bot
 * (src/store.js) l'ouvre comme s'il redémarrait dessus. On vérifie que les données essentielles se relisent.
 *   node scripts/restore-drill.js <copie.db>     → affiche un JSON { ok, … } et sort avec le code 0 ou 1
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const src = process.argv[2];
const out = (r) => {
  process.stdout.write(JSON.stringify(r));
  process.exit(r.ok ? 0 : 1);
};
if (!src || !fs.existsSync(src)) out({ ok: false, error: 'copie introuvable' });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kensei-drill-'));
try {
  fs.copyFileSync(src, path.join(tmp, 'ronin.db'));
  process.env.RONIN_DATA_DIR = tmp; // le bot « redémarre » dans ce dossier temporaire
  const store = require('../src/store');
  if (store.recovery?.happened) throw new Error(`la copie a dû être réparée au chargement : ${store.recovery.reason}`);
  const { db, sql } = store;
  const sections = Object.keys(db);
  const checks = {
    sections: sections.length,
    levels: Object.keys(db.levels ?? {}).length,
    wallets: Object.keys(db.economy ?? {}).length,
    settings: typeof (db.settings ?? {}) === 'object',
    serverBackups: sql.prepare('SELECT count(*) AS n FROM backups').get().n,
  };
  // La dernière sauvegarde de structure du serveur doit être restaurable (format valide)
  const last = sql.prepare('SELECT data FROM backups ORDER BY id DESC LIMIT 1').get();
  if (last) {
    const { isValidBackup } = require('../src/backup');
    if (!isValidBackup(JSON.parse(last.data))) throw new Error('la dernière sauvegarde du serveur est illisible');
    checks.serverBackupValid = true;
  }
  out({ ok: true, ...checks });
} catch (err) {
  out({ ok: false, error: err.message });
} finally {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {}
}
