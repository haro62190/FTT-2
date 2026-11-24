// Chaque fichier de test utilise sa propre base SQLite temporaire
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.RONIN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ronin-test-'));
process.env.TZ = 'Europe/Paris';
