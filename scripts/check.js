/** Vérifie la syntaxe de TOUS les fichiers du bot (src/, scripts/, config/) : npm run check */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const files = ['src', 'scripts', 'config'].flatMap((d) =>
  fs
    .readdirSync(path.join(root, d))
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(d, f)),
);
let bad = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', path.join(root, f)], { stdio: 'pipe' });
  } catch (err) {
    bad++;
    console.error(`❌ ${f}\n${String(err.stderr || err.message).trim()}`);
  }
}
require('../config/server'); // la configuration doit se charger
if (bad) process.exit(1);
console.log(`✅ ${files.length} fichiers vérifiés`);
