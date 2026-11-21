/**
 * Appels à yt-dlp (musique, TikTok).
 */
const { execFile } = require('child_process');

const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
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

module.exports = { YTDLP, cookieArgs, ytdlpJson };
