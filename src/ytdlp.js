/**
 * Appels à yt-dlp (musique, TikTok).
 */
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// pm2 (ou systemd) peut lancer le bot avec un PATH incomplet : on ajoute les dossiers d'installation habituels
// de yt-dlp, ffmpeg et Deno (dont yt-dlp a besoin pour YouTube). Les processus lancés ensuite en héritent.
if (process.platform !== 'win32') {
  const extra = ['/usr/local/bin', '/usr/bin', '/bin', path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), '.deno', 'bin')];
  const current = (process.env.PATH ?? '').split(':').filter(Boolean);
  process.env.PATH = [...new Set([...current, ...extra])].join(':');
}

/** Chemin de yt-dlp : YTDLP_PATH, sinon le premier trouvé dans le PATH (sinon « yt-dlp » tel quel). */
function findBinary(name, override) {
  if (override) return override;
  if (process.platform === 'win32') return name;
  for (const dir of (process.env.PATH ?? '').split(':')) {
    const full = path.join(dir, name);
    try {
      fs.accessSync(full, fs.constants.X_OK);
      return full;
    } catch {}
  }
  return name;
}
const YTDLP = findBinary('yt-dlp', process.env.YTDLP_PATH);
const COOKIES = process.env.YTDLP_COOKIES; // fichier cookies.txt, utile si YouTube bloque le VPS
const cookieArgs = () => (COOKIES ? ['--cookies', COOKIES] : []);

function ytdlpJson(args, { cookies = true } = {}) {
  return new Promise((resolve, reject) => {
    execFile(YTDLP, [...args, ...(cookies ? cookieArgs() : [])], { maxBuffer: 50 * 1024 * 1024, timeout: 60_000 }, (err, stdout, stderr) => {
      if (err) {
        if (err.code === 'ENOENT') return reject(new Error('yt-dlp n\'est pas installé sur la machine du bot.'));
        return reject(new Error((stderr || err.message).split('\n').find((l) => l.includes('ERROR')) || 'Lecture impossible.'));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error('Réponse illisible de yt-dlp.'));
      }
    });
  });
}

module.exports = { YTDLP, cookieArgs, ytdlpJson, findBinary };
