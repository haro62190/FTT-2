/**
 * Tableau de bord web de Kensei (sans dépendance : module http de Node.js).
 *
 * Sécurité :
 *  - connexion avec Discord (OAuth2) ; accès réservé au propriétaire du serveur et aux Administrateurs
 *  - écoute sur 127.0.0.1 par défaut : on y accède par un tunnel SSH (voir README), rien n'est exposé sur Internet
 *  - sessions aléatoires (cookie HttpOnly, SameSite), jeton CSRF sur chaque formulaire, en-têtes de sécurité
 *
 * Variables .env : DASHBOARD_PORT (3000), DASHBOARD_HOST (127.0.0.1), DASHBOARD_URL (http://localhost:3000),
 *                  DISCORD_CLIENT_SECRET (portail développeur > OAuth2)
 */
const http = require('http');
const crypto = require('crypto');
const { PermissionFlagsBits: P, EmbedBuilder, ChannelType } = require('discord.js');
const settings = require('./settings');
const levels = require('./levels');
const backup = require('./backup');
const { db, save } = require('./store');
const { BRAND_COLOR, findChannel } = require('./shared');

const PORT = Number(process.env.DASHBOARD_PORT) || 3000;
const HOST = process.env.DASHBOARD_HOST || '127.0.0.1';
const BASE = (process.env.DASHBOARD_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SECURE = BASE.startsWith('https://');
const SESSION_MS = 12 * 3600_000;
const IDLE_MS = 2 * 3600_000; // déconnexion après 2 h sans activité
// En HTTPS, cookie « __Host- » : envoyé seulement à ce site, jamais à un sous-domaine
const COOKIE = (process.env.DASHBOARD_URL || '').startsWith('https://') ? '__Host-ronin_sid' : 'ronin_sid';
const TRUST_PROXY = process.env.DASHBOARD_TRUST_PROXY === '1'; // derrière Caddy / nginx : lire X-Forwarded-For

// Limitation des requêtes par adresse IP (anti force brute / abus)
const hits = new Map(); // `${ip}:${kind}` -> { n, reset }
const LIMITS = { login: [15, 10 * 60_000], post: [60, 60_000], get: [300, 60_000] };
function limited(ip, kind) {
  const [max, windowMs] = LIMITS[kind];
  const key = `${ip}:${kind}`;
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return false;
  }
  h.n++;
  return h.n > max;
}
const clientIp = (req) => (TRUST_PROXY && String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()) || req.socket.remoteAddress || '?';

const sessions = new Map(); // sid -> { userId, username, avatar, csrf, expires }
const oauthStates = new Map(); // state -> expires

// ───────────────────────── Utilitaires ─────────────────────────

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const rand = () => crypto.randomBytes(32).toString('hex');
const fmtDate = (t) => new Date(t).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' });

/** Lit uniquement notre cookie de session (les autres cookies, même mal formés, sont ignorés). */
function sessionCookie(req) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return null;
}

function send(res, status, body, headers = {}, nonce = null) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    ...(SECURE ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
    // Aucun script, sauf celui de la page avec son jeton unique (nonce) pour le temps réel
    'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https://cdn.discordapp.com data:; font-src 'self'; form-action 'self' https://discord.com; base-uri 'none'; frame-ancestors 'none'${nonce ? `; script-src 'nonce-${nonce}'; connect-src 'self'` : ''}`,
    ...headers,
  });
  res.end(body);
}
const redirect = (res, to, headers = {}) => send(res, 302, '', { Location: to, ...headers });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 200_000) {
        reject(new Error('Requête trop grande'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(new URLSearchParams(data)));
  });
}

// ───────────────────────── Mise en page ─────────────────────────

// Menu : ['#', 'Section'] = titre de section
const NAV = [
  ['#', 'Serveur'],
  ['/', '🏯 Accueil'],
  ['/graphiques', '📈 Graphiques'],
  ['/serveur', '🏗️ Construction'],
  ['/logo', '🖼️ Logo & identité'],
  ['/modules', '🧩 Modules'],
  ['/roles-permissions', '🎭 Rôles & permissions'],
  ['#', 'Communauté'],
  ['/bienvenue', '🏮 Bienvenue & départ'],
  ['/niveaux', '⚔️ Niveaux & grades'],
  ['/saisons', '🏆 Saisons du mois'],
  ['/membres', '👤 Membres & classements'],
  ['/quetes-boost', '📜 Quêtes, boosts & grades'],
  ['/meta', '🎯 Classes méta'],
  ['/economie', '💰 Économie & boutique'],
  ['/giveaways', '🎁 Giveaways'],
  ['/evenements', '🎌 Événements'],
  ['/anniversaires', '🎂 Anniversaires'],
  ['/suggestions', '💡 Suggestions'],
  ['/commandes', '⌨️ Commandes perso'],
  ['/menus-roles', '🎭 Menus de rôles'],
  ['/communaute', '🏯 Hall of Fame & vocal'],
  ['#', 'Stream'],
  ['/notifications', '📡 Twitch & TikTok'],
  ['/lives', '📺 Lives & statistiques'],
  ['/stats', '📊 Compteurs'],
  ['/annonce', '📢 Annonce & embed'],
  ['/musique', '🎵 Musique'],
  ['/vocaux', '🔊 Vocaux temporaires'],
  ['#', 'Sécurité'],
  ['/moderation', '🛡️ Modération & raid'],
  ['/statut', '💓 État du bot'],
  ['/automod', '🤖 AutoMod'],
  ['/avertissements', '⚠️ Avertissements'],
  ['/tickets', '🎫 Tickets'],
  ['/sauvegardes', '💾 Sauvegardes du serveur'],
  ['/copies-base', '🗄️ Copies de la base'],
  ['/journal', '📜 Journal d\'admin'],
  ['/diagnostic', '🩺 Diagnostic'],
];

// Serveur affiché dans l'en-tête (renseigné au démarrage du tableau de bord)
let BADGE = null;
const SUBTITLES = { '/': 'Vue d\'ensemble de votre serveur' };

function page(sess, path, title, body, flash = '', refresh = 0, nonce = null, script = '') {
  const avatar = sess?.avatar ? `<img class="av" src="https://cdn.discordapp.com/avatars/${esc(sess.userId)}/${esc(sess.avatar)}.png?size=64" alt="">` : '';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Kensei</title>${refresh ? `<meta http-equiv="refresh" content="${Number(refresh)}">` : ''}<link rel="icon" href="/logo.png">
<style>
@font-face{font-family:Brush;src:url(/assets/brush.ttf) format('truetype');font-display:swap}
@font-face{font-family:Cinzel;src:url(/assets/cinzel.ttf) format('truetype');font-display:swap}
@font-face{font-family:Kanji;src:url(/assets/kanji.ttf) format('truetype');font-display:swap}
:root{color-scheme:dark;--bg:#08080b;--bg2:#101015;--panel:#14141a;--panel2:#1c1c24;--line:#303039;--text:#f4f1f1;--muted:#aaa4aa;--red:#e10600;--red2:#ff4038;--red-deep:#65070b;--gold:#f5b942;--gold-light:#ffe39a;--glow:rgba(225,6,0,.32);--gold-glow:rgba(245,185,66,.22);--ok:#54c987;--warn:#e8b84c;--radius:16px}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:radial-gradient(900px 520px at 92% -8%,rgba(225,6,0,.18),transparent 62%),radial-gradient(700px 500px at 0% 100%,rgba(101,7,11,.12),transparent 60%),var(--bg);color:var(--text);font:15px/1.55 Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;min-height:100vh}
a{color:var(--red2)}
header{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:12px;padding:12px 22px;border-bottom:1px solid rgba(225,6,0,.24);background:rgba(8,8,11,.88);backdrop-filter:blur(14px)}header:after{content:"";position:absolute;bottom:-1px;left:0;width:180px;height:1px;background:linear-gradient(90deg,var(--red),transparent)}
header .logo{width:38px;height:38px;border-radius:50%;box-shadow:0 0 0 2px var(--red),0 0 18px var(--glow)}
header h1{font-size:18px;margin:0;letter-spacing:.08em;font-weight:800}header h1 span{color:var(--red);text-shadow:0 0 14px var(--glow)}
header .who{margin-left:auto;display:flex;align-items:center;gap:10px;color:var(--muted);font-size:14px}.av{width:30px;height:30px;border-radius:50%}
header .live{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:3px 10px}
header .live i{width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 8px var(--ok)}
.wrap{display:flex;min-height:calc(100vh - 63px)}
nav{width:236px;flex-shrink:0;border-right:1px solid var(--line);padding:14px 10px;position:sticky;top:63px;height:calc(100vh - 63px);overflow-y:auto;background:linear-gradient(180deg,var(--bg2),transparent)}
nav a{display:block;padding:7px 12px;border-radius:9px;color:var(--muted);text-decoration:none;margin-bottom:1px;font-size:14px;transition:background .15s,color .15s}
nav a:hover{background:var(--panel2);color:var(--text)}nav a.on{background:linear-gradient(100deg,rgba(225,6,0,.24),rgba(225,6,0,.035));color:#fff;box-shadow:inset 3px 0 0 var(--red),0 0 22px rgba(225,6,0,.06)}
nav .sec{color:var(--red);font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;margin:16px 12px 6px}nav .sec:first-child{margin-top:4px}
main{flex:1;padding:28px 32px;max-width:1120px}
h2{position:relative;margin:0 0 22px;padding:0 0 12px;font-size:25px;font-weight:850;letter-spacing:.01em}h2:after{content:"";position:absolute;left:0;bottom:0;width:74px;height:3px;border-radius:3px;background:linear-gradient(90deg,var(--red),var(--gold))}h3{margin:0 0 12px;font-size:16px;color:#fff}
.card{background:linear-gradient(180deg,var(--panel),var(--bg2));border:1px solid rgba(255,255,255,.075);border-radius:var(--radius);padding:20px;margin-bottom:18px;box-shadow:0 1px 0 rgba(255,255,255,.035) inset,0 14px 38px rgba(0,0,0,.28)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:18px}
.stat{position:relative;overflow:hidden;background:linear-gradient(145deg,rgba(28,28,36,.96),rgba(13,13,18,.98));border:1px solid rgba(255,255,255,.075);border-radius:var(--radius);padding:16px 18px;transition:border-color .2s,transform .2s,box-shadow .2s}
.stat:hover{border-color:rgba(225,6,0,.58);box-shadow:0 8px 26px rgba(225,6,0,.09);transform:translateY(-2px)}.stat:before{content:"";position:absolute;inset:0 0 auto 0;height:2px;background:linear-gradient(90deg,var(--red),transparent)}
.stat b{display:block;font-size:28px;font-weight:800;color:#fff;font-variant-numeric:tabular-nums;text-shadow:0 0 18px rgba(225,6,0,.12)}.stat span{color:var(--muted);font-size:13px}
label{display:block;margin:12px 0 5px;color:var(--muted);font-size:13px}
input[type=text],input[type=number],input[type=url],textarea,select{width:100%;background:#0b0b0e;border:1px solid var(--line);color:var(--text);border-radius:10px;padding:10px 12px;font:inherit;transition:border-color .15s,box-shadow .15s}
textarea{min-height:96px;resize:vertical}input:focus,textarea:focus,select:focus{outline:0;border-color:var(--red);box-shadow:0 0 0 3px var(--glow)}
.check{display:flex;align-items:center;gap:10px;margin:10px 0;color:var(--text);cursor:pointer}
.check input{appearance:none;-webkit-appearance:none;flex-shrink:0;width:40px;height:22px;border-radius:999px;background:#2a2a31;position:relative;cursor:pointer;transition:background .2s;margin:0}
.check input:before{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#c9c9d1;transition:transform .2s,background .2s}
.check input:checked{background:var(--red);box-shadow:0 0 10px var(--glow)}.check input:checked:before{transform:translateX(18px);background:#fff}
td .check{margin:0}
button,.btn{display:inline-block;background:linear-gradient(135deg,var(--red2),var(--red) 58%,var(--red-deep));color:#fff;border:0;border-radius:10px;padding:10px 18px;font:inherit;font-weight:700;cursor:pointer;text-decoration:none;margin-top:14px;box-shadow:0 7px 22px rgba(225,6,0,.24),inset 0 1px 0 rgba(255,255,255,.14);transition:filter .15s,transform .1s}
button:hover,.btn:hover{filter:brightness(1.1)}button:active{transform:translateY(1px)}button[disabled]{opacity:.4;cursor:not-allowed}
button.ghost,.btn.ghost{background:var(--panel2);box-shadow:none;border:1px solid var(--line);font-weight:600}button.ghost:hover{border-color:#444}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{padding:10px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{color:var(--gold);font-weight:700;font-size:11px;letter-spacing:.1em;text-transform:uppercase}tr:hover td{background:rgba(255,255,255,.015)}
.badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;background:var(--panel2);border:1px solid var(--line)}.badge.ok{color:var(--ok);border-color:rgba(62,207,110,.35)}.badge.bad{color:#ff6a5f;border-color:rgba(255,59,48,.4)}.badge.warn{color:var(--warn);border-color:rgba(241,196,15,.35)}
.flash{background:#0f2a17;border:1px solid #1f5a33;color:#bff3cf;padding:11px 15px;border-radius:10px;margin-bottom:18px}
.flash.err{background:#2a0f0f;border-color:#5a1f1f;color:#f3bfbf}.muted{color:var(--muted)}.row{display:flex;gap:14px;flex-wrap:wrap}.row>*{flex:1;min-width:150px}
code{background:#1c1c22;padding:1px 6px;border-radius:5px;font-size:.92em}pre{background:#0b0b0e;border:1px solid var(--line);border-radius:10px;padding:12px;overflow:auto;font-size:12.5px}
.legend{display:flex;gap:16px;margin:0 0 6px;font-size:13px;color:#c3c2b7}.legend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-1px}details{margin-top:8px}details table{font-size:13px}form.inline{display:inline}
@media(max-width:820px){nav .sec{display:none}.wrap{flex-direction:column}nav{position:static;height:auto;width:auto;border-right:0;border-bottom:1px solid var(--line);display:flex;overflow-x:auto;gap:4px;padding:8px}nav a{white-space:nowrap}main{padding:18px 16px}header .live{display:none}}
body:before{content:"";position:fixed;right:0;bottom:0;width:min(46vw,620px);height:min(62vh,640px);background:url(/assets/pagoda.jpg) right bottom/cover no-repeat;opacity:.22;pointer-events:none;z-index:0;-webkit-mask-image:radial-gradient(circle at 100% 100%,#000 25%,transparent 72%);mask-image:radial-gradient(circle at 100% 100%,#000 25%,transparent 72%)}
body:after{content:"剣聖";position:fixed;right:26px;top:96px;writing-mode:vertical-rl;font:72px/1 Kanji,serif;color:var(--gold);opacity:.16;pointer-events:none;z-index:0}
.wrap,header{position:relative;z-index:1}
nav a.brand:hover{background:none}@media(max-width:820px){nav a.brand,body:before,body:after{display:none}}
nav .brand{display:block;text-align:center;margin:2px 0 12px;padding:0 0 12px;border-bottom:1px solid var(--line)}nav .brand img{width:150px;max-width:100%;border-radius:12px;filter:drop-shadow(0 0 14px rgba(225,6,0,.35))}
header .server{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(225,6,0,.35);background:linear-gradient(90deg,rgba(225,6,0,.14),rgba(20,20,26,.8));border-radius:10px;padding:5px 12px 5px 6px;font-size:13px;font-weight:600}header .server img{width:24px;height:24px;border-radius:6px}
header .live .pulse{width:26px;height:12px;stroke:var(--ok);fill:none;stroke-width:1.6}
h2.brush{font:400 40px/1.15 Brush,'Segoe Script',cursive;letter-spacing:.01em;padding-bottom:6px;margin-bottom:4px}h2.brush:after{display:none}.subtitle{color:var(--muted);margin:0 0 22px;font-size:15px}
.kpi{position:relative;overflow:hidden;min-height:118px;border-radius:var(--radius);padding:16px 18px;border:1px solid rgba(225,6,0,.35);background:linear-gradient(100deg,rgba(12,8,10,.96) 35%,rgba(12,8,10,.55)),url(/assets/hero.jpg) var(--pos,50%) 40%/auto 180% no-repeat;box-shadow:0 10px 30px rgba(0,0,0,.35);transition:transform .2s,border-color .2s}
.kpi:hover{transform:translateY(-2px);border-color:var(--red)}.kpi .h{display:flex;align-items:center;gap:8px;color:#eee;font-size:14px;font-weight:600}.kpi b{display:block;font:700 34px/1.2 Cinzel,Georgia,serif;color:#fff;margin-top:6px;font-variant-numeric:tabular-nums}
.kpi .t{font-size:13px;font-weight:700}.kpi .t.up{color:var(--ok)}.kpi .t.down{color:#ff6a5f}.kpi .t.flat{color:var(--muted)}.kpi.ok{border-color:rgba(84,201,135,.45)}.kpi.ok b{color:var(--ok);font-family:Brush,cursive;font-weight:400}
.grid.mini{grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.grid.mini .stat{padding:12px 14px}.grid.mini .stat b{font-size:19px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.split{display:grid;grid-template-columns:1.6fr 1fr;gap:18px}@media(max-width:900px){.split{grid-template-columns:1fr}}
.feed{list-style:none;margin:0;padding:0}.feed li{display:flex;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line);font-size:14px}.feed li .i{width:26px;text-align:center}.feed li .w{margin-left:auto;color:var(--muted);font-size:12px;white-space:nowrap}
</style></head><body>
<header><img class="logo" src="/logo.png" alt=""><h1>剣聖 <span>KENSEI</span></h1>${sess ? '<span class="live" title="Mis à jour en direct"><i></i>Bot en ligne <svg class="pulse" viewBox="0 0 26 12"><path d="M0 6h7l2-5 3 10 3-8 2 3h9"/></svg></span>' : ''}${sess && BADGE ? `<span class="server">${BADGE.icon ? `<img src="${esc(BADGE.icon)}" alt="">` : ''}${esc(BADGE.name)}</span>` : ''}<div class="who">${avatar}${esc(sess?.username ?? '')}${sess ? ' · <a class="muted" href="/logout">Déconnexion</a>' : ''}</div></header>
<div class="wrap">${sess ? `<nav><a class="brand" href="/" title="Accueil"><img src="/assets/logo-kensei.jpg" alt="Kensei · Les Ronins"></a>${NAV.map(([href, label]) => (href === '#' ? `<div class="sec">${label}</div>` : `<a href="${href}" class="${href === path ? 'on' : ''}">${label}</a>`)).join('')}</nav>` : ''}
<main>${flash ? `<div class="flash${flash.startsWith('❌') ? ' err' : ''}">${esc(flash)}</div>` : ''}${SUBTITLES[path] ? `<h2 class="brush">${esc(title)}</h2><p class="subtitle">${esc(SUBTITLES[path])}</p>` : `<h2>${esc(title)}</h2>`}${body}</main></div>${nonce && script ? `<script nonce="${nonce}">${script}</script>` : ''}</body></html>`;
}

const csrf = (sess) => `<input type="hidden" name="csrf" value="${esc(sess.csrf)}">`;
const checkbox = (name, on, label) => `<label class="check"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}> ${esc(label)}</label>`;

// ───────────────────────── Pages ─────────────────────────

/** Seuls le propriétaire et les Administrateurs (mêmes droits que /moderation, /backup, /restore) */
const isAdmin = (guild, member) => !!member && (member.id === guild.ownerId || member.permissions.has(P.Administrator));

/** Charge les membres manquants du cache, par paquets de 100 (limite Discord), sans requête vide. */
async function fetchMembers(guild, ids) {
  const missing = [...new Set(ids)].filter((id) => id && !guild.members.cache.has(id));
  for (let n = 0; n < missing.length; n += 100) {
    await guild.members.fetch({ user: missing.slice(n, n + 100), time: 10_000 }).catch(() => {});
  }
}

/** Chiffres de l'accueil (aussi servis en JSON par /api/live). */
function liveStats(guild) {
  const security = require('./security');
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  return {
    members: guild.memberCount,
    inVoice: guild.channels.cache.filter((c) => c.isVoiceBased?.()).reduce((n, c) => n + c.members.filter((m) => !m.user.bot).size, 0),
    messagesToday: db.history?.[today]?.messages ?? 0,
    live: db.twitchLive ? `🔴 ${db.twitchLive.peak ?? 0} viewers` : '⚫ hors ligne',
    tickets: Object.keys(db.tickets?.open ?? {}).length,
    quarantined: Object.keys(db.quarantine ?? {}).length,
    security: security.lockdown.active ? '🔒 verrouillé' : '✅ normal',
    ping: guild.client.ws.ping,
    updated: new Date().toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris' }),
  };
}

function lockdownCard(sess) {
  const lk = require('./security').lockdown;
  return `<form method="post" class="card">${csrf(sess)}<h3>🔒 Verrouillage anti-raid</h3>
    ${lk.active ? `<p>🔴 <b>Serveur verrouillé</b> jusqu'à ${fmtDate(lk.until)} : invitations en pause, nouveaux arrivants expulsés.</p><input type="hidden" name="action" value="lockdown_off"><button>Lever le verrouillage</button>`
      : `<p class="muted">À utiliser en cas de raid : met les invitations en pause et expulse les nouveaux arrivants.</p><div class="row"><div><label>Durée (minutes)</label><input type="number" name="minutes" value="10" min="1" max="1440"></div></div><input type="hidden" name="action" value="lockdown_on"><button>Verrouiller maintenant</button>`}
  </form>`;
}

function memberName(guild, id) {
  const m = guild.members.cache.get(id);
  return m ? `${esc(m.displayName)} <span class="muted">@${esc(m.user.username)}</span>` : `<span class="muted">${esc(id)}</span>`;
}

const pages = {
  async '/'(guild) {
    const top = levels.leaderboard().slice(0, 10);
    await fetchMembers(guild, top.map((t) => t.userId));
    const v = liveStats(guild);
    const { lineChart } = require('./charts');
    const pts = require('./history').series(14);
    const week = pts.slice(7);
    const prev = pts.slice(0, 7);
    const sum = (list, k) => list.reduce((n, p) => n + (p[k] ?? 0), 0);
    // Tendance en % entre deux valeurs (null si pas assez de données)
    const trend = (now, before) => {
      if (!before) return '<span class="t flat">— sur 7 j</span>';
      const pct = Math.round(((now - before) / before) * 100);
      return `<span class="t ${pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat'}">${pct > 0 ? '↑ +' : pct < 0 ? '↓ ' : ''}${pct} % sur 7 j</span>`;
    };
    const membersBefore = prev.find((p) => typeof p.discord === 'number')?.discord;
    const msgs = sum(week, 'messages');
    const voiceH = Math.round(sum(week, 'voice') / 60);
    const up = process.uptime();
    const since = up >= 86400 ? `${Math.floor(up / 86400)} j ${Math.floor((up % 86400) / 3600)} h` : `${Math.floor(up / 3600)} h ${Math.floor((up % 3600) / 60)} min`;
    const kpi = (icon, label, value, extra, pos, live = '') =>
      `<div class="kpi" style="--pos:${pos}"><div class="h">${icon} ${esc(label)}</div><b${live ? ` data-live="${live}"` : ''}>${esc(value)}</b>${extra}</div>`;
    const tile = (key, value, label) => `<div class="stat"><b data-live="${key}">${esc(value)}</b><span>${esc(label)}</span></div>`;
    const ago = (t) => {
      const m = Math.round((Date.now() - t) / 60000);
      return m < 1 ? 'à l\'instant' : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.floor(m / 60)} h` : `il y a ${Math.floor(m / 1440)} j`;
    };
    const feed = require('./feed').recent(8);
    return {
      title: 'Tableau de bord',
      body: `<div class="grid">
        ${kpi('👥', 'Membres', v.members.toLocaleString('fr-FR'), trend(v.members, membersBefore), '38%', 'members')}
        ${kpi('💬', 'Messages (7 j)', msgs.toLocaleString('fr-FR'), trend(msgs, sum(prev, 'messages')), '20%')}
        ${kpi('🎙️', 'En vocal', v.inVoice, `<span class="t flat">${voiceH} h de vocal sur 7 j</span>`, '62%', 'inVoice')}
        <div class="kpi ok" style="--pos:90%"><div class="h">✅ État du bot</div><b>En ligne</b><span class="t flat">Depuis ${esc(since)} · <span data-live="ping">${v.ping} ms</span></span></div></div>
      <div class="grid mini">${tile('messagesToday', v.messagesToday, 'messages aujourd\'hui')}${tile('live', v.live, 'stream')}${tile('tickets', v.tickets, 'tickets ouverts')}${tile('quarantined', v.quarantined, 'en quarantaine')}${tile('security', v.security, 'sécurité')}</div>
      <p class="muted" style="margin-top:-6px">Mis à jour en direct toutes les 5 secondes · <span data-live="updated">${esc(v.updated)}</span></p>
      <div class="split">
        <div class="card"><h3>Activité des 7 derniers jours</h3>${lineChart({ points: week, series: [{ key: 'messages', label: 'Messages' }], colors: ['#ff4038'], dots: true })}</div>
        <div class="card"><h3 style="display:flex;justify-content:space-between;align-items:center">Derniers événements <a class="badge" href="/journal" style="text-decoration:none">Journal →</a></h3>
        <ul class="feed">${feed.map((e) => `<li><span class="i">${esc(e.icon)}</span><span>${esc(e.text)}</span><span class="w">${ago(e.at)}</span></li>`).join('') || '<li class="muted">Les événements du serveur apparaîtront ici.</li>'}</ul></div>
      </div>
      <div class="card"><h3>🏆 Top 10 des ronins</h3><table><tr><th>#</th><th>Membre</th><th>Niveau</th><th>XP</th><th>Messages</th></tr>
      ${top.map((t, n) => `<tr><td>${n + 1}</td><td>${memberName(guild, t.userId)}</td><td>${t.level}</td><td>${t.totalXp}</td><td>${t.messages}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Personne n\'a encore d\'XP.</td></tr>'}
      </table></div>`,
      // Petit script autorisé (CSP avec nonce) : rafraîchit les compteurs sans recharger la page
      script: `setInterval(async()=>{try{const r=await fetch('/api/live',{credentials:'same-origin'});if(!r.ok)return;const d=await r.json();for(const el of document.querySelectorAll('[data-live]')){const k=el.dataset.live;if(k in d)el.textContent=k==='ping'?d[k]+' ms':k==='members'?Number(d[k]).toLocaleString('fr-FR'):d[k];}}catch(e){}},5000);`,
    };
  },

  '/bienvenue'(guild, sess) {
    const w = settings.get('welcome');
    const g = settings.get('goodbye');
    return {
      title: '🏮 Bienvenue & départ',
      body: `<form method="post" class="card">${csrf(sess)}
      <h3>Message de bienvenue</h3>${checkbox('welcome_enabled', w.enabled, 'Activé')}
      <label>Message — variables : <code>{user}</code> <code>{username}</code> <code>{server}</code> <code>{count}</code> <code>{rules}</code></label>
      <textarea name="welcome_message" maxlength="1500">${esc(w.message)}</textarea>
      <h3 style="margin-top:18px">Message de départ</h3>${checkbox('goodbye_enabled', g.enabled, 'Activé')}
      <label>Message — variables : <code>{username}</code> <code>{server}</code> <code>{count}</code></label>
      <textarea name="goodbye_message" maxlength="1500">${esc(g.message)}</textarea>
      <button>Enregistrer</button></form>`,
    };
  },
  async 'POST /bienvenue'(guild, sess, body) {
    settings.set('welcome.enabled', body.has('welcome_enabled'));
    settings.set('goodbye.enabled', body.has('goodbye_enabled'));
    for (const k of ['welcome', 'goodbye']) {
      const msg = (body.get(`${k}_message`) ?? '').trim().slice(0, 1500);
      if (msg) settings.set(`${k}.message`, msg);
    }
    return '✅ Messages enregistrés.';
  },

  '/moderation'(guild, sess) {
    const s = settings.get('security');
    const num = (k, label, min, max) =>
      `<div><label>${esc(label)}</label><input type="number" name="${k}" value="${esc(s[k])}" min="${min}" max="${max}" required></div>`;
    return {
      title: '🛡️ Modération automatique',
      body: `<form method="post" class="card">${csrf(sess)}
      <h3>Anti-raid</h3><div class="row">${num('raidJoins', 'Arrivées', 2, 100)}${num('raidWindowSec', 'En (secondes)', 5, 600)}${num('lockdownMinutes', 'Verrouillage (min)', 1, 1440)}${num('minAccountAgeDays', 'Âge min. du compte (jours, 0 = off)', 0, 365)}</div>
      <h3 style="margin-top:18px">Anti-spam</h3><div class="row">${num('spamMessages', 'Messages', 3, 50)}${num('spamWindowSec', 'En (secondes)', 2, 60)}${num('spamMuteMinutes', 'Mute (min)', 1, 10080)}${num('maxMentions', 'Mentions max', 2, 50)}</div>
      <h3 style="margin-top:18px">Protections</h3>${checkbox('blockInvites', s.blockInvites, 'Bloquer les invitations vers d\'autres serveurs')}${checkbox('antiNuke', s.antiNuke, 'Anti-nuke (suppression / bans de masse)')}
      <label>Liste de confiance (IDs ignorés par l'anti-nuke, un par ligne)</label><textarea name="whitelist">${esc((s.whitelist ?? []).join('\n'))}</textarea>
      <button>Enregistrer</button></form>
      ${lockdownCard(sess)}`,
    };
  },
  async 'POST /moderation'(guild, sess, body) {
    const security = require('./security');
    if (body.get('action') === 'lockdown_on') {
      const minutes = Math.min(1440, Math.max(1, Number.parseInt(body.get('minutes'), 10) || 10));
      await security.startLockdown(guild, `activé depuis le tableau de bord par ${sess.username}`, minutes);
      return `🔒 Serveur verrouillé pour ${minutes} min.`;
    }
    if (body.get('action') === 'lockdown_off') {
      await security.endLockdown(guild, `désactivé depuis le tableau de bord par ${sess.username}`, true);
      return '🔓 Verrouillage levé, invitations réactivées.';
    }
    const limits = { raidJoins: [2, 100], raidWindowSec: [5, 600], lockdownMinutes: [1, 1440], minAccountAgeDays: [0, 365], spamMessages: [3, 50], spamWindowSec: [2, 60], spamMuteMinutes: [1, 10080], maxMentions: [2, 50] };
    for (const [k, [min, max]] of Object.entries(limits)) {
      const v = Number.parseInt(body.get(k), 10);
      if (Number.isInteger(v) && v >= min && v <= max) settings.set(`security.${k}`, v);
    }
    settings.set('security.blockInvites', body.has('blockInvites'));
    settings.set('security.antiNuke', body.has('antiNuke'));
    const ids = (body.get('whitelist') ?? '').split(/\s+/).filter((x) => /^\d{17,20}$/.test(x));
    settings.set('security.whitelist', [...new Set(ids)]);
    return '✅ Modération enregistrée.';
  },

  async '/niveaux'(guild, sess) {
    const l = settings.get('levels');
    const rewards = levels.rewardList(guild);
    const roles = guild.roles.cache
      .filter((r) => r.id !== guild.id && !r.managed && r.editable && !r.permissions.has(P.Administrator) && !r.permissions.has(P.ManageGuild))
      .sort((a, b) => b.position - a.position);
    const custom = settings.get('levels.rewards') ?? {};
    const top = levels.leaderboard().slice(0, 25);
    await fetchMembers(guild, top.map((t) => t.userId));
    return {
      title: '⚔️ Niveaux & récompenses',
      body: `<form method="post" class="card">${csrf(sess)}<input type="hidden" name="action" value="toggles">
      ${checkbox('enabled', l.enabled, 'Gagner de l\'XP en écrivant (15-25 XP par message, 1 fois par minute)')}${checkbox('announce', l.announce, 'Annoncer chaque passage de niveau')}${checkbox('banner', l.banner !== false, 'Avec la bannière en image « Passage de niveau »')}
      <button>Enregistrer</button></form>
      <div class="card"><h3>🎖️ Récompenses</h3><table><tr><th>Niveau</th><th>Rôle</th><th></th></tr>
      ${rewards.map((r) => `<tr><td>${r.level}</td><td>${esc(r.role.name)}</td><td>${custom[r.level] === r.role.id ? `<form method="post" class="inline">${csrf(sess)}<input type="hidden" name="action" value="remove"><input type="hidden" name="level" value="${r.level}"><button class="ghost" style="margin:0">Retirer</button></form>` : '<span class="muted">config/server.js</span>'}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Aucune</td></tr>'}
      </table>
      <form method="post">${csrf(sess)}<input type="hidden" name="action" value="add"><div class="row">
      <div><label>Niveau</label><input type="number" name="level" min="1" max="500" required></div>
      <div><label>Rôle</label><select name="role">${roles.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></div></div>
      <button>Ajouter la récompense</button></form></div>
      <div class="card"><h3>🏆 Classement</h3><table><tr><th>#</th><th>Membre</th><th>Niveau</th><th>XP</th></tr>
      ${top.map((t, n) => `<tr><td>${n + 1}</td><td>${memberName(guild, t.userId)}</td><td>${t.level}</td><td>${t.totalXp}</td></tr>`).join('')}</table></div>`,
    };
  },
  async 'POST /niveaux'(guild, sess, body) {
    const action = body.get('action');
    if (action === 'toggles') {
      settings.set('levels.enabled', body.has('enabled'));
      settings.set('levels.announce', body.has('announce'));
      settings.set('levels.banner', body.has('banner'));
      return '✅ Enregistré.';
    }
    const lvl = Number.parseInt(body.get('level'), 10);
    if (!Number.isInteger(lvl) || lvl < 1 || lvl > 500) return '❌ Niveau invalide.';
    const rewards = { ...(settings.get('levels.rewards') ?? {}) };
    if (action === 'remove') delete rewards[lvl];
    if (action === 'add') {
      const role = guild.roles.cache.get(body.get('role'));
      if (!role || role.managed || !role.editable || role.permissions.has(P.Administrator) || role.permissions.has(P.ManageGuild)) return '❌ Rôle non autorisé.';
      rewards[lvl] = role.id;
    }
    settings.set('levels.rewards', rewards);
    return '✅ Récompenses mises à jour.';
  },

  '/notifications'(guild, sess) {
    const n = settings.get('notifications');
    return {
      title: '📡 Notifications',
      body: `<form method="post" class="card">${csrf(sess)}
      ${checkbox('twitch', n.twitch, `Lives Twitch — ${process.env.TWITCH_CHANNEL ? `twitch.tv/${process.env.TWITCH_CHANNEL}` : 'TWITCH_CHANNEL non configuré'}`)}
      ${checkbox('clips', n.clips, 'Nouveaux clips Twitch postés dans 🎬┃clips')}
      ${checkbox('schedule', n.schedule, 'Planning Twitch affiché dans 🗓️┃planning + événements Discord automatiques')}
      ${checkbox('tiktok', n.tiktok, `TikTok (vidéos + lives) — ${process.env.TIKTOK_USERNAME ? `@${process.env.TIKTOK_USERNAME}` : 'TIKTOK_USERNAME non configuré'}`)}
      <p class="muted">Les comptes se règlent dans le fichier <code>.env</code> du bot.</p><button>Enregistrer</button></form>
      <form method="post" class="card">${csrf(sess)}<input type="hidden" name="action" value="sync"><h3>🗓️ Planning Twitch</h3>
      <p class="muted">Le planning est synchronisé toutes les 30 minutes. Tu viens de le modifier sur Twitch ?</p><button class="ghost">Synchroniser maintenant</button></form>
      ${db.twitchLive ? `<div class="card"><h3>🔴 En live</h3><p><b>${esc(db.twitchLive.title)}</b><br>Pic : ${db.twitchLive.peak} viewers · ${esc(db.twitchLive.games.join(', '))}</p></div>` : ''}`,
    };
  },
  async 'POST /notifications'(guild, sess, body) {
    if (body.get('action') === 'sync') {
      await require('./twitchlive').checkSchedule(guild);
      return '🗓️ Planning synchronisé.';
    }
    settings.set('notifications.clips', body.has('clips'));
    settings.set('notifications.schedule', body.has('schedule'));
    settings.set('notifications.twitch', body.has('twitch'));
    settings.set('notifications.tiktok', body.has('tiktok'));
    return '✅ Notifications enregistrées.';
  },

  '/annonce'(guild, sess) {
    const channels = guild.channels.cache.filter((c) => [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(c.type)).sort((a, b) => a.rawPosition - b.rawPosition);
    const def = findChannel(guild, 'announcements')?.id;
    const roles = guild.roles.cache.filter((r) => r.id !== guild.id && !r.managed).sort((a, b) => b.position - a.position);
    return {
      title: '📢 Publier une annonce',
      body: `<form method="post" class="card">${csrf(sess)}
      <label>Salon</label><select name="channel">${channels.map((c) => `<option value="${c.id}" ${c.id === def ? 'selected' : ''}>#${esc(c.name)}</option>`).join('')}</select>
      <label>Titre</label><input type="text" name="title" maxlength="256">
      <label>Message</label><textarea name="message" maxlength="4000" required></textarea>
      <label>Mentionner un rôle</label><select name="role"><option value="">— aucun —</option>${roles.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select>
      <button>Publier</button></form>`,
    };
  },
  async 'POST /annonce'(guild, sess, body) {
    const channel = guild.channels.cache.get(body.get('channel'));
    const message = (body.get('message') ?? '').trim();
    if (!channel?.isTextBased() || !message) return '❌ Salon ou message invalide.';
    const role = guild.roles.cache.get(body.get('role'));
    const embed = new EmbedBuilder().setColor(BRAND_COLOR).setDescription(message.slice(0, 4000)).setFooter({ text: `Par ${sess.username}` }).setTimestamp();
    const title = (body.get('title') ?? '').trim();
    if (title) embed.setTitle(title.slice(0, 256));
    await channel.send({ content: role ? `${role}` : undefined, embeds: [embed], allowedMentions: { roles: role ? [role.id] : [] } });
    return `✅ Annonce publiée dans #${channel.name}.`;
  },

  '/sauvegardes'(guild, sess) {
    const list = backup.listBackups();
    return {
      title: '💾 Sauvegardes',
      body: `<div class="card"><p class="muted">Une sauvegarde automatique est faite chaque jour (7 conservées). La restauration recrée ce qui manque et remet les permissions — elle ne supprime jamais rien.</p>
      <form method="post">${csrf(sess)}<input type="hidden" name="action" value="create"><div class="row"><div><label>Nom</label><input type="text" name="name" maxlength="50" placeholder="ex : avant-gros-changement"></div></div><button>Créer une sauvegarde maintenant</button></form></div>
      <div class="card"><table><tr><th>#</th><th>Nom</th><th>Date</th><th>Taille</th><th></th></tr>
      ${list.map((b) => `<tr><td>${b.id}</td><td>${esc(b.name)}</td><td>${fmtDate(b.created_at)}</td><td>${(b.size / 1024).toFixed(0)} Ko</td><td><a class="btn ghost" style="margin:0" href="/sauvegardes/restaurer?id=${b.id}">Restaurer…</a></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Aucune sauvegarde.</td></tr>'}
      </table></div>`,
    };
  },
  async 'POST /sauvegardes'(guild, sess, body) {
    if (body.get('action') === 'create') {
      await guild.channels.fetch();
      await guild.roles.fetch();
      const name = (body.get('name') ?? '').trim().slice(0, 50) || `web-${new Date().toISOString().slice(0, 16)}`;
      const b = backup.createBackup(guild, name, sess.userId);
      return `✅ Sauvegarde #${b.id} créée (${b.roles} rôles, ${b.channels} salons).`;
    }
    if (body.get('action') === 'restore') {
      const b = backup.getBackup(Number(body.get('id')));
      if (!b) return '❌ Sauvegarde introuvable.';
      backup.createBackup(guild, `avant-restauration-${new Date().toISOString().slice(0, 16)}`, sess.userId);
      const lines = [];
      await backup.restore(guild, b.data, (l) => lines.push(l));
      const created = lines.filter((l) => l.includes('＋')).length;
      return `✅ Sauvegarde #${b.id} restaurée (${created} élément(s) recréé(s)).`;
    }
    return '❌ Action inconnue.';
  },
  async '/sauvegardes/restaurer'(guild, sess, query) {
    const b = backup.getBackup(Number(query.get('id')));
    if (!b) return { title: 'Introuvable', body: '<p>Sauvegarde introuvable.</p>' };
    await guild.roles.fetch();
    await guild.channels.fetch();
    const p = backup.plan(guild, b.data);
    return {
      title: `♻️ Restaurer « ${b.name} » ?`,
      body: `<div class="card"><ul>
      <li><b>${p.roleMissing.length}</b> rôle(s) à recréer ${p.roleMissing.length ? `: ${p.roleMissing.map((r) => esc(r.name)).join(', ')}` : ''}</li>
      <li><b>${p.chMissing.length}</b> salon(s) à recréer ${p.chMissing.length ? `: ${p.chMissing.map((c) => esc(c.name)).join(', ')}` : ''}</li>
      <li>${p.roleUpdate} rôle(s) et ${p.chUpdate} salon(s) existants : permissions remises comme dans la sauvegarde</li>
      <li>Réglages du bot remplacés</li></ul>
      <p class="muted">Rien ne sera supprimé. Une sauvegarde de l'état actuel est faite juste avant.</p>
      <form method="post" action="/sauvegardes">${csrf(sess)}<input type="hidden" name="action" value="restore"><input type="hidden" name="id" value="${b.id}">
      <button>Oui, restaurer</button> <a class="btn ghost" href="/sauvegardes">Annuler</a></form></div>`,
    };
  },

  async '/avertissements'(guild, sess) {
    const entries = Object.entries(db.warns ?? {}).filter(([, l]) => l.length);
    await fetchMembers(guild, entries.map(([id]) => id));
    return {
      title: '⚠️ Avertissements',
      body: `<div class="card"><table><tr><th>Membre</th><th>Avertissements</th><th></th></tr>
      ${entries.map(([id, list]) => `<tr><td>${memberName(guild, id)}</td><td>${list.map((w) => `${fmtDate(w.at)} — ${esc(w.reason)}`).join('<br>')}</td>
      <td><form method="post">${csrf(sess)}<input type="hidden" name="user" value="${esc(id)}"><button class="ghost" style="margin:0">Effacer</button></form></td></tr>`).join('') || '<tr><td colspan="3" class="muted">Aucun avertissement 🎉</td></tr>'}
      </table></div>`,
    };
  },
  async 'POST /avertissements'(guild, sess, body) {
    delete db.warns?.[body.get('user')];
    save();
    return '✅ Avertissements effacés.';
  },

  async '/tickets'(guild) {
    const open = Object.entries(db.tickets?.open ?? {});
    await fetchMembers(guild, open.map(([, t]) => t.ownerId));
    return {
      title: '🎫 Tickets ouverts',
      body: `<div class="card"><table><tr><th>#</th><th>Sujet</th><th>Membre</th><th>Ouvert</th><th>Pris en charge</th></tr>
      ${open.map(([, t]) => `<tr><td>${t.number}</td><td>${esc(t.subject)}</td><td>${memberName(guild, t.ownerId)}</td><td>${fmtDate(t.createdAt)}</td><td>${t.claimedBy ? memberName(guild, t.claimedBy) : '—'}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Aucun ticket ouvert.</td></tr>'}
      </table></div>`,
    };
  },
};

Object.assign(pages, require('./dashboard-pages')({ esc, csrf, checkbox, fetchMembers, memberName, fmtDate }));
// Pages d'administration (remplacent aussi les anciennes versions de Twitch & TikTok et Tickets)
Object.assign(pages, require('./dashboard-admin')({ esc, csrf, checkbox, fetchMembers, memberName, fmtDate }));
Object.assign(pages, require('./dashboard-community')({ esc, csrf, checkbox, fetchMembers, memberName, fmtDate }));

// ───────────────────────── Connexion Discord ─────────────────────────

async function exchangeCode(code, clientId) {
  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${BASE}/callback`,
    }),
  });
  if (!res.ok) throw new Error(`OAuth ${res.status}`);
  const { access_token } = await res.json();
  const me = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${access_token}` } });
  if (!me.ok) throw new Error(`users/@me ${me.status}`);
  return me.json();
}

// ───────────────────────── Serveur ─────────────────────────

function start(client, guildId) {
  if (process.env.DASHBOARD_ENABLED === 'false') return;
  if (!process.env.DISCORD_CLIENT_SECRET) {
    console.log('ℹ️  Tableau de bord désactivé (DISCORD_CLIENT_SECRET manquant dans .env).');
    return;
  }
  const clientId = client.user.id;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, BASE);
      const sid = sessionCookie(req);
      let sess = sid && sessions.get(sid);
      // Limites par IP
      const ip = clientIp(req);
      const kind = ['/login', '/callback'].includes(url.pathname) ? 'login' : req.method === 'POST' ? 'post' : 'get';
      if (limited(ip, kind)) return send(res, 429, page(null, '', 'Trop de requêtes', '<p>Trop de tentatives depuis ton adresse. Réessaie dans quelques minutes.</p>'), { 'Retry-After': '120' });
      if (sess && (sess.expires < Date.now() || Date.now() - (sess.lastSeen ?? 0) > IDLE_MS)) {
        sessions.delete(sid);
        sess = null;
      }
      if (sess) sess.lastSeen = Date.now();
      const guild = client.guilds.cache.get(guildId);
      if (guild) BADGE = { name: guild.name, icon: guild.iconURL?.({ size: 64 }) ?? null };

      if (url.pathname === '/health') {
        // Pour un service de surveillance (UptimeRobot…) : aucune donnée sensible
        const s = require('./health').status(client);
        res.writeHead(s.ok ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ ok: s.ok, uptime: Math.round(s.uptime / 1000), ping: s.ping, version: s.version.sha }));
      }
      // Images et polices de l'identité Kensei (liste fermée : aucun autre fichier n'est servi)
      const ASSETS = {
        '/assets/logo-kensei.jpg': ['logo-kensei.jpg', 'image/jpeg'],
        '/assets/pagoda.jpg': ['dashboard-pagoda.jpg', 'image/jpeg'],
        '/assets/hero.jpg': ['dashboard-hero.jpg', 'image/jpeg'],
        '/assets/brush.ttf': ['fonts/KaushanScript-Regular.ttf', 'font/ttf'],
        '/assets/cinzel.ttf': ['fonts/Cinzel-SemiBold.ttf', 'font/ttf'],
        '/assets/kanji.ttf': ['fonts/YujiSyuku-Kensei.ttf', 'font/ttf'],
      };
      if (ASSETS[url.pathname]) {
        const [name, type] = ASSETS[url.pathname];
        return require('fs').readFile(require('path').join(__dirname, '..', 'assets', name), (err, data) =>
          err ? send(res, 404, '') : res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=604800', 'X-Content-Type-Options': 'nosniff' }).end(data),
        );
      }
      if (url.pathname === '/logo.png') {
        const file = require('./shared').iconPath();
        if (!file) return send(res, 404, '');
        return require('fs').readFile(file, (err, data) =>
          err ? send(res, 404, '') : res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }).end(data),
        );
      }
      if (url.pathname === '/login') {
        const state = rand();
        oauthStates.set(state, Date.now() + 600_000);
        const q = new URLSearchParams({ client_id: clientId, response_type: 'code', scope: 'identify', redirect_uri: `${BASE}/callback`, state });
        return redirect(res, `https://discord.com/oauth2/authorize?${q}`);
      }
      if (url.pathname === '/callback') {
        const state = url.searchParams.get('state');
        if (!state || !(oauthStates.get(state) > Date.now())) return send(res, 400, page(null, '', 'Lien expiré', '<a class="btn" href="/login">Réessayer</a>'));
        oauthStates.delete(state);
        const user = await exchangeCode(url.searchParams.get('code'), clientId);
        const member = await guild?.members.fetch(user.id).catch(() => null);
        const allowed = isAdmin(guild, member);
        if (!allowed) return send(res, 403, page(null, '', 'Accès refusé', '<p>Seuls les administrateurs du serveur peuvent utiliser le tableau de bord.</p>'));
        const newSid = rand();
        sessions.set(newSid, { userId: user.id, username: user.global_name || user.username, avatar: user.avatar, csrf: rand(), expires: Date.now() + SESSION_MS, lastSeen: Date.now(), ip });
        require('./audit').record({ userId: user.id, user: user.username, source: 'web', action: 'connexion', details: `IP ${ip}` });
        console.log(`🌐 Connexion au tableau de bord : ${user.username}`);
        return redirect(res, '/', { 'Set-Cookie': `${COOKIE}=${newSid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${SECURE ? '; Secure' : ''}` });
      }
      if (url.pathname === '/logout') {
        if (sid) sessions.delete(sid);
        return redirect(res, '/', { 'Set-Cookie': `${COOKIE}=; HttpOnly; Path=/; Max-Age=0${SECURE ? '; Secure' : ''}` });
      }

      if (!sess) {
        return send(res, 200, page(null, '', 'Tableau de bord', `<div class="card"><p>Gère <b>Les Ronins de haro62190</b> depuis ton navigateur.</p><a class="btn" href="/login">Se connecter avec Discord</a></div>`));
      }
      if (!guild) return send(res, 503, page(sess, '', 'Serveur indisponible', '<p>Le bot n\'est pas connecté au serveur.</p>'));

      // Les droits sont revérifiés à chaque requête (un admin rétrogradé perd l'accès)
      const member = await guild.members.fetch(sess.userId).catch(() => null);
      if (!isAdmin(guild, member)) {
        sessions.delete(sid);
        return send(res, 403, page(null, '', 'Accès refusé', '<p>Tu n\'as plus les droits d\'administration.</p>'));
      }

      if (url.pathname === '/api/live') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        return res.end(JSON.stringify(liveStats(guild)));
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        if (body.get('csrf') !== sess.csrf) return send(res, 403, page(sess, '', 'Requête refusée', '<p>Jeton de sécurité invalide, recharge la page.</p>'));
        const handler = pages[`POST ${url.pathname}`];
        if (!handler) return send(res, 404, page(sess, '', 'Introuvable', ''));
        const flash = await handler(guild, sess, body).catch((e) => `❌ ${e.message}`);
        sess.flash = flash;
        console.log(`🌐 ${sess.username} : ${url.pathname} — ${flash}`);
        require('./audit').record({ userId: sess.userId, user: sess.username, source: 'web', action: url.pathname, details: `${body.get('action') ?? ''} → ${flash}` });
        return redirect(res, url.pathname === '/sauvegardes' ? '/sauvegardes' : url.pathname);
      }

      const handler = pages[url.pathname];
      if (!handler) return send(res, 404, page(sess, '', 'Page introuvable', '<a class="btn" href="/">Accueil</a>'));
      const { title, body, refresh, script } = await handler(guild, sess, url.searchParams);
      const flash = sess.flash;
      sess.flash = null;
      const nonce = script ? crypto.randomBytes(16).toString('base64') : null;
      return send(res, 200, page(sess, url.pathname, title, body, flash, refresh, nonce, script), {}, nonce);
    } catch (err) {
      console.error('Tableau de bord :', err);
      send(res, 500, page(null, '', 'Erreur', `<p>${esc(err.message)}</p><a class="btn" href="/">Accueil</a>`));
    }
  });

  server.on('error', (err) => console.error(`❌ Tableau de bord (port ${PORT}) :`, err.message));
  server.listen(PORT, HOST, () => console.log(`🌐 Tableau de bord : ${BASE} (écoute sur ${HOST}:${PORT})`));
  setInterval(() => {
    const now = Date.now();
    for (const [k, s] of sessions) if (s.expires < now) sessions.delete(k);
    for (const [k, e] of oauthStates) if (e < now) oauthStates.delete(k);
  }, 3600_000).unref();
}

module.exports = { start };
