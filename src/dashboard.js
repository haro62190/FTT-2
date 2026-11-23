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
    if (i > 0 && part.slice(0, i).trim() === 'ronin_sid') return part.slice(i + 1).trim();
  }
  return null;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https://cdn.discordapp.com data:; form-action 'self' https://discord.com; base-uri 'none'",
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
  ['#', 'Communauté'],
  ['/bienvenue', '🏮 Bienvenue & départ'],
  ['/niveaux', '⚔️ Niveaux & grades'],
  ['/saisons', '🏆 Saisons du mois'],
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
  ['/stats', '📊 Compteurs'],
  ['/annonce', '📢 Annonce & embed'],
  ['/musique', '🎵 Musique'],
  ['/vocaux', '🔊 Vocaux temporaires'],
  ['#', 'Sécurité'],
  ['/moderation', '🛡️ Modération & raid'],
  ['/statut', '🩺 État du bot'],
  ['/automod', '🤖 AutoMod'],
  ['/avertissements', '⚠️ Avertissements'],
  ['/tickets', '🎫 Tickets'],
  ['/sauvegardes', '💾 Sauvegardes'],
];

function page(sess, path, title, body, flash = '', refresh = 0) {
  const avatar = sess?.avatar ? `<img class="av" src="https://cdn.discordapp.com/avatars/${esc(sess.userId)}/${esc(sess.avatar)}.png?size=64" alt="">` : '';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Kensei</title>${refresh ? `<meta http-equiv="refresh" content="${Number(refresh)}">` : ''}
<style>
:root{--bg:#0a0a0b;--panel:#141416;--line:#2a2a2e;--text:#e8e8ea;--muted:#9a9aa2;--red:#e10600;--red2:#ff3b30;--ok:#3ecf6e}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--line);background:linear-gradient(90deg,#1a0000,#0a0a0b 60%)}
header h1{font-size:18px;margin:0;letter-spacing:.06em}header h1 span{color:var(--red);text-shadow:0 0 12px rgba(225,6,0,.7)}
header .who{margin-left:auto;display:flex;align-items:center;gap:8px;color:var(--muted)}.av{width:28px;height:28px;border-radius:50%}
.wrap{display:flex;min-height:calc(100vh - 58px)}nav{width:220px;flex-shrink:0;border-right:1px solid var(--line);padding:12px}
nav a{display:block;padding:9px 12px;border-radius:8px;color:var(--muted);text-decoration:none;margin-bottom:2px}
nav a:hover{background:#1c1c1f;color:var(--text)}nav .sec{color:#e10600;font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin:14px 12px 4px}nav .sec:first-child{margin-top:2px}nav a{padding:7px 12px!important}nav a.on{background:#2a0000;color:#fff;box-shadow:inset 3px 0 0 var(--red)}
main{flex:1;padding:24px;max-width:1000px}h2{margin:0 0 16px;font-size:22px}h3{margin:0 0 10px;font-size:16px;color:#fff}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px}.stat b{display:block;font-size:26px;color:#fff}.stat span{color:var(--muted);font-size:13px}
label{display:block;margin:10px 0 4px;color:var(--muted);font-size:13px}
input[type=text],input[type=number],textarea,select{width:100%;background:#0d0d0f;border:1px solid var(--line);color:var(--text);border-radius:8px;padding:9px 10px;font:inherit}
textarea{min-height:90px;resize:vertical}input:focus,textarea:focus,select:focus{outline:2px solid var(--red);border-color:transparent}
.check{display:flex;align-items:center;gap:8px;margin:8px 0;color:var(--text)}
button,.btn{display:inline-block;background:var(--red);color:#fff;border:0;border-radius:8px;padding:9px 16px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none;margin-top:12px}
button:hover,.btn:hover{background:var(--red2)}button[disabled]{opacity:.4;cursor:not-allowed}button.ghost,.btn.ghost{background:#26262a}button.ghost:hover{background:#333}
table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{color:var(--muted);font-weight:500;font-size:13px}
.flash{background:#0f2a17;border:1px solid #1f5a33;color:#bff3cf;padding:10px 14px;border-radius:8px;margin-bottom:16px}
.flash.err{background:#2a0f0f;border-color:#5a1f1f;color:#f3bfbf}.muted{color:var(--muted)}.row{display:flex;gap:12px;flex-wrap:wrap}.row>*{flex:1;min-width:140px}
code{background:#1c1c1f;padding:1px 5px;border-radius:4px}.legend{display:flex;gap:16px;margin:0 0 6px;font-size:13px;color:#c3c2b7}.legend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-1px}details{margin-top:8px}details table{font-size:13px}form.inline{display:inline}
@media(max-width:760px){nav .sec{display:none}.wrap{flex-direction:column}nav{width:auto;border-right:0;border-bottom:1px solid var(--line);display:flex;overflow-x:auto;gap:4px}nav a{white-space:nowrap}main{padding:16px}}
</style></head><body>
<header><img src="/logo.png" alt="" style="width:36px;height:36px;border-radius:50%"><h1>剣聖 <span>KENSEI</span></h1><div class="who">${avatar}${esc(sess?.username ?? '')}${sess ? ' · <a class="muted" href="/logout">Déconnexion</a>' : ''}</div></header>
<div class="wrap">${sess ? `<nav>${NAV.map(([href, label]) => (href === '#' ? `<div class="sec">${label}</div>` : `<a href="${href}" class="${href === path ? 'on' : ''}">${label}</a>`)).join('')}</nav>` : ''}
<main>${flash ? `<div class="flash${flash.startsWith('❌') ? ' err' : ''}">${esc(flash)}</div>` : ''}<h2>${esc(title)}</h2>${body}</main></div></body></html>`;
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
    const security = require('./security');
    const stats = [
      [guild.memberCount, 'membres'],
      [guild.channels.cache.filter((c) => c.type !== ChannelType.GuildCategory).size, 'salons'],
      [guild.roles.cache.size - 1, 'rôles'],
      [Object.keys(db.tickets?.open ?? {}).length, 'tickets ouverts'],
      [Object.values(db.warns ?? {}).reduce((n, l) => n + l.length, 0), 'avertissements'],
      [security.lockdown.active ? '🔒' : '✅', security.lockdown.active ? 'serveur verrouillé' : 'serveur ouvert'],
    ];
    return {
      title: guild.name,
      body: `<div class="grid">${stats.map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>
      <div class="card" style="margin-top:16px"><h3>🏆 Top 10 des ronins</h3><table><tr><th>#</th><th>Membre</th><th>Niveau</th><th>XP</th><th>Messages</th></tr>
      ${top.map((t, n) => `<tr><td>${n + 1}</td><td>${memberName(guild, t.userId)}</td><td>${t.level}</td><td>${t.totalXp}</td><td>${t.messages}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Personne n\'a encore d\'XP.</td></tr>'}
      </table></div>`,
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
      ${checkbox('enabled', l.enabled, 'Gagner de l\'XP en écrivant (15-25 XP par message, 1 fois par minute)')}${checkbox('announce', l.announce, 'Annoncer chaque passage de niveau')}
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
      if (sess && sess.expires < Date.now()) {
        sessions.delete(sid);
        sess = null;
      }
      const guild = client.guilds.cache.get(guildId);

      if (url.pathname === '/health') {
        // Pour un service de surveillance (UptimeRobot…) : aucune donnée sensible
        const s = require('./health').status(client);
        res.writeHead(s.ok ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ ok: s.ok, uptime: Math.round(s.uptime / 1000), ping: s.ping, version: s.version.sha }));
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
        sessions.set(newSid, { userId: user.id, username: user.global_name || user.username, avatar: user.avatar, csrf: rand(), expires: Date.now() + SESSION_MS });
        console.log(`🌐 Connexion au tableau de bord : ${user.username}`);
        return redirect(res, '/', { 'Set-Cookie': `ronin_sid=${newSid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${SECURE ? '; Secure' : ''}` });
      }
      if (url.pathname === '/logout') {
        if (sid) sessions.delete(sid);
        return redirect(res, '/', { 'Set-Cookie': 'ronin_sid=; HttpOnly; Path=/; Max-Age=0' });
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

      if (req.method === 'POST') {
        const body = await readBody(req);
        if (body.get('csrf') !== sess.csrf) return send(res, 403, page(sess, '', 'Requête refusée', '<p>Jeton de sécurité invalide, recharge la page.</p>'));
        const handler = pages[`POST ${url.pathname}`];
        if (!handler) return send(res, 404, page(sess, '', 'Introuvable', ''));
        const flash = await handler(guild, sess, body).catch((e) => `❌ ${e.message}`);
        sess.flash = flash;
        console.log(`🌐 ${sess.username} : ${url.pathname} — ${flash}`);
        return redirect(res, url.pathname === '/sauvegardes' ? '/sauvegardes' : url.pathname);
      }

      const handler = pages[url.pathname];
      if (!handler) return send(res, 404, page(sess, '', 'Page introuvable', '<a class="btn" href="/">Accueil</a>'));
      const { title, body, refresh } = await handler(guild, sess, url.searchParams);
      const flash = sess.flash;
      sess.flash = null;
      return send(res, 200, page(sess, url.pathname, title, body, flash, refresh));
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
