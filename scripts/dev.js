/**
 * Mode développement (Windows, macOS, Linux) : npm run dev
 *  - lance le bot et le redémarre dès qu'un fichier de src/, config/ ou assets/ est modifié
 *  - vérifie GitHub toutes les 2 minutes : télécharge les nouveautés, réinstalle les dépendances
 *    et relance le setup si besoin, puis redémarre le bot
 * Ctrl+C pour tout arrêter.
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GIT_INTERVAL_MS = (Number(process.env.DEV_GIT_SECONDS) || 120) * 1000;
const WATCH = ['src', 'config', 'assets'];

const time = () => new Date().toLocaleTimeString('fr-FR');
const say = (msg) => console.log(`\x1b[31m[ronin-dev ${time()}]\x1b[0m ${msg}`);

/** Lance une commande et attend la fin (npm passe par le shell sous Windows). */
function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

// ───────────────────────── Bot ─────────────────────────

let bot = null;
let restarting = false;
let stopping = false;

/** Arrête UN processus précis : demande polie (enregistre les données), puis forcé après 5 s. */
function stopProcess(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return resolve();
    child.stopRequested = true;
    child.once('exit', resolve);
    try {
      child.send('shutdown');
    } catch {
      child.kill('SIGTERM');
    }
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 5000);
  });
}

function startBot() {
  say('▶️  Démarrage du bot…');
  // Canal 'ipc' : permet de demander au bot de s'arrêter proprement (aussi sous Windows)
  const child = spawn(process.execPath, ['src/bot.js'], { cwd: ROOT, stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
  bot = child;
  child.on('exit', (code, signal) => {
    if (bot === child) bot = null;
    if (!child.stopRequested && !stopping) say(`⛔ Le bot s'est arrêté (code ${code ?? signal}). Corrige l'erreur : il redémarrera à la prochaine modification.`);
  });
}

function restartBot(reason) {
  if (restarting) return;
  restarting = true;
  say(`🔄 Redémarrage (${reason})`);
  stopProcess(bot).then(() => {
    restarting = false;
    startBot();
  });
}

// ───────────────────────── Fichiers modifiés ─────────────────────────

let debounce = null;
for (const dir of WATCH) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) continue;
  fs.watch(full, { recursive: true }, (_event, file) => {
    if (!file || file.endsWith('~') || file.includes('.swp')) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => restartBot(`${dir}/${file.replaceAll('\\', '/')} modifié`), 800);
  });
}

// ───────────────────────── GitHub ─────────────────────────

let gitOk = run('git', ['--version']).ok && fs.existsSync(path.join(ROOT, '.git'));
if (!gitOk) say('ℹ️  Git ou le dossier .git est absent : pas de mise à jour automatique depuis GitHub (clone le dépôt avec Git).');

function checkGitHub() {
  if (!gitOk) return;
  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).out;
  const fetch = run('git', ['fetch', '--quiet', 'origin', branch]);
  if (!fetch.ok) return say(`⚠️  GitHub injoignable : ${fetch.out.split('\n')[0]}`);
  const local = run('git', ['rev-parse', 'HEAD']).out;
  const remote = run('git', ['rev-parse', 'FETCH_HEAD']).out;
  if (!remote || local === remote) return;

  const changed = run('git', ['diff', '--name-only', local, remote]).out.split('\n');
  say(`⬇️  Nouveautés sur GitHub (${local.slice(0, 7)} → ${remote.slice(0, 7)}), ${changed.length} fichier(s)`);
  const merge = run('git', ['merge', '--ff-only', 'FETCH_HEAD']);
  if (!merge.ok) {
    return say(
      '⚠️  Mise à jour impossible : tu as modifié des fichiers qui changent aussi sur GitHub.\n' +
        '    Dans VS Code : onglet Contrôle de code source → annule tes changements (↶) ou valide-les, puis attends le prochain passage.',
    );
  }
  if (changed.some((f) => /^package(-lock)?\.json$/.test(f))) {
    say('📦 npm install…');
    const r = run('npm', ['install', '--no-audit', '--no-fund']);
    if (!r.ok) say(`⚠️  npm install a échoué :\n${r.out}`);
  }
  if (changed.some((f) => /^(config\/server\.js|src\/(setup|builder|shared)\.js|assets\/)/.test(f))) {
    say('🏯 Structure du serveur modifiée : npm run setup…');
    const r = run('npm', ['run', 'setup']);
    console.log(r.out);
  }
  restartBot('mise à jour GitHub');
}

// ───────────────────────── C'est parti ─────────────────────────

if (!fs.existsSync(path.join(ROOT, '.env'))) {
  say('❌ Fichier .env introuvable : copie .env.example en .env et remplis-le.');
  process.exit(1);
}
say(`Surveillance de ${WATCH.join(', ')}${gitOk ? ` · GitHub toutes les ${GIT_INTERVAL_MS / 1000}s` : ''} · Ctrl+C pour arrêter`);
checkGitHub();
startBot();
if (gitOk) setInterval(checkGitHub, GIT_INTERVAL_MS);

process.on('SIGINT', () => {
  if (stopping) return;
  stopping = true;
  say('👋 Arrêt');
  stopProcess(bot).then(() => process.exit(0));
});
