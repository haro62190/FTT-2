/** Génère docs/GUIDE.md à partir des commandes du bot : npm run guide */
process.env.RONIN_DATA_DIR ??= require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'ronin-guide-'));
const fs = require('fs');
const path = require('path');
const out = path.join(__dirname, '..', 'docs', 'GUIDE.md');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, require('../src/guide').markdown());
console.log(`📖 ${path.relative(process.cwd(), out)} généré`);
process.exit(0);
