/**
 * Petite base de données dans un fichier JSON (data/db.json) : avertissements et niveaux.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'db.json');
const db = { warns: {}, levels: {} };

try {
  Object.assign(db, JSON.parse(fs.readFileSync(FILE, 'utf8')));
} catch (err) {
  if (err.code !== 'ENOENT') console.error('⚠️ data/db.json illisible, on repart de zéro :', err.message);
}

function flush() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(db, null, 2));
  fs.renameSync(FILE + '.tmp', FILE);
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

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    try {
      flush();
    } catch {}
    process.exit(0);
  });
}

module.exports = { db, save };
