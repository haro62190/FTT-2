/**
 * Pages d'administration du tableau de bord :
 * Modules · Rôles & permissions · Journal · Diagnostic · Twitch & TikTok · Tickets · Copies de la base
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PermissionFlagsBits: P } = require('discord.js');
const settings = require('./settings');
const { db } = require('./store');
const { config, findChannel, findRole, twitchLogin, tiktokUser } = require('./shared');

// Permissions proposées pour les rôles gérés par le bot (les plus sensibles sont signalées)
const ROLE_PERMS = [
  ['ModerateMembers', 'Exclure temporairement (mute)'],
  ['ManageMessages', 'Gérer les messages'],
  ['KickMembers', 'Expulser', true],
  ['BanMembers', 'Bannir', true],
  ['ManageNicknames', 'Gérer les pseudos'],
  ['ManageThreads', 'Gérer les fils'],
  ['MuteMembers', 'Rendre muet en vocal'],
  ['DeafenMembers', 'Mettre en sourdine en vocal'],
  ['MoveMembers', 'Déplacer en vocal'],
  ['ViewAuditLog', 'Voir le journal d\'audit'],
  ['ManageEvents', 'Gérer les événements'],
  ['MentionEveryone', 'Mentionner @everyone', true],
  ['ManageChannels', 'Gérer les salons', true],
  ['ManageRoles', 'Gérer les rôles', true],
];

module.exports = ({ esc, csrf, checkbox, fetchMembers, memberName, fmtDate }) => {
  const hidden = (name, value) => `<input type="hidden" name="${name}" value="${esc(value)}">`;
  const badge = (ok, yes = 'OK', no = 'manquant', warn = false) => `<span class="badge ${ok ? 'ok' : warn ? 'warn' : 'bad'}">${ok ? yes : no}</span>`;

  return {
    // ───────────────────────── Modules ─────────────────────────
    '/modules'(guild, sess) {
      const groups = new Map();
      for (const [key, label, path, group] of settings.MODULES) {
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(`<tr><td>${esc(label)}</td><td style="width:70px">${checkbox(`m_${key}`, settings.raw(path) !== false, '')}</td></tr>`);
      }
      return {
        title: '🧩 Modules',
        body: `<form method="post">${csrf(sess)}<p class="muted">Active ou coupe chaque fonctionnalité. Un module coupé ne fait plus rien, mais ses données sont conservées.</p>
        <div class="row">${[...groups].map(([g, rows]) => `<div class="card"><h3>${esc(g)}</h3><table>${rows.join('')}</table></div>`).join('')}</div>
        <button>Enregistrer</button></form>`,
      };
    },
    async 'POST /modules'(guild, sess, body) {
      const changed = [];
      for (const [key, label, settingPath] of settings.MODULES) {
        const want = body.has(`m_${key}`);
        if ((settings.raw(settingPath) !== false) !== want) changed.push(`${want ? '✅' : '⛔'} ${label}`);
        settings.set(settingPath, want);
      }
      // AutoMod : appliquer tout de suite chez Discord
      if (changed.some((c) => c.includes('AutoMod'))) {
        const am = require('./automod');
        if (settings.on('automod')) await am.ensureAutoMod(guild, () => {});
        else await am.disableAutoMod(guild);
      }
      return changed.length ? `✅ ${changed.join(' · ')}` : 'Aucun changement.';
    },

    // ───────────────────────── Rôles & permissions ─────────────────────────
    '/roles-permissions'(guild, sess) {
      const editable = config.roles.filter((d) => !d.admin && !d.selfAssign && d.key !== 'quarantine');
      const rows = editable
        .map((d) => {
          const current = new Set(settings.get(`rolePermissions.${d.key}`) ?? d.permissions ?? []);
          const role = findRole(guild, d.key);
          return `<tr><td><b>${esc(d.name)}</b>${role ? '' : ' <span class="badge warn">pas encore créé</span>'}${d.staff ? `<br><span class="muted">grade staff : ${esc(d.staff)}</span>` : ''}</td>
            <td>${ROLE_PERMS.map(([p, label, danger]) => `<label class="check" style="margin:4px 0"><input type="checkbox" name="${esc(d.key)}:${p}" ${current.has(p) ? 'checked' : ''}> ${esc(label)}${danger ? ' ⚠️' : ''}</label>`).join('')}</td></tr>`;
        })
        .join('');
      const assignable = guild.roles.cache.filter((r) => r.id !== guild.id && !r.managed && r.editable && !r.permissions.has(P.Administrator)).sort((a, b) => b.position - a.position);
      return {
        title: '🎭 Rôles & permissions',
        body: `<form method="post" class="card">${csrf(sess)}${hidden('action', 'perms')}
        <p class="muted">Permissions de chaque rôle géré par le bot. ⚠️ = permission sensible. Enregistre, puis clique sur « Appliquer » (ou lance la construction des rôles). 👑 Chef garde l'Administrateur.</p>
        <table><tr><th style="width:240px">Rôle</th><th>Permissions</th></tr>${rows}</table>
        <button>Enregistrer</button> <button class="ghost" name="apply" value="1">Enregistrer et appliquer</button></form>
        <form method="post" class="card">${csrf(sess)}${hidden('action', 'member')}<h3>Donner / retirer un rôle à un membre</h3>
        <div class="row"><div><label>Membre (pseudo ou ID)</label><input type="text" name="member" required></div>
        <div><label>Rôle</label><select name="role">${assignable.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></div>
        <div><label>Action</label><select name="op"><option value="add">Donner</option><option value="remove">Retirer</option></select></div></div>
        <button>Appliquer</button></form>`,
      };
    },
    async 'POST /roles-permissions'(guild, sess, body) {
      if (body.get('action') === 'member') {
        const q = String(body.get('member') ?? '').trim().replace(/^<@!?(\d+)>$/, '$1').replace(/^@/, '');
        const member = /^\d{17,20}$/.test(q) ? await guild.members.fetch(q).catch(() => null) : (await guild.members.fetch({ query: q, limit: 1 }).catch(() => null))?.first();
        const role = guild.roles.cache.get(body.get('role'));
        if (!member || !role?.editable || role.permissions.has(P.Administrator)) return '❌ Membre ou rôle invalide.';
        if (body.get('op') === 'remove') await member.roles.remove(role, `Tableau de bord : ${sess.username}`);
        else await member.roles.add(role, `Tableau de bord : ${sess.username}`);
        return `✅ ${role.name} ${body.get('op') === 'remove' ? 'retiré à' : 'donné à'} ${member.displayName}.`;
      }
      const valid = new Set(ROLE_PERMS.map(([p]) => p));
      for (const d of config.roles.filter((x) => !x.admin && !x.selfAssign && x.key !== 'quarantine')) {
        const chosen = [...body.keys()].filter((k) => k.startsWith(`${d.key}:`)).map((k) => k.split(':')[1]).filter((p) => valid.has(p));
        settings.set(`rolePermissions.${d.key}`, chosen);
      }
      if (body.get('apply')) {
        const lines = [];
        await require('./builder').ensureRoles(guild, (l) => lines.push(l.trim()));
        const warn = lines.filter((l) => l.startsWith('⚠'));
        return warn.length ? `⚠️ Enregistré et appliqué avec des remarques : ${warn.join(' · ')}` : '✅ Permissions enregistrées et appliquées sur Discord.';
      }
      return '✅ Permissions enregistrées (pas encore appliquées sur Discord).';
    },

    // ───────────────────────── Journal ─────────────────────────
    async '/journal'(guild, sess, query) {
      const source = query.get('source');
      const list = (db.adminLog ?? []).filter((e) => !source || e.source === source).slice(0, 250);
      const tab = (s, label) => `<a class="btn ${source === s || (!s && !source) ? '' : 'ghost'}" style="margin:0 6px 0 0" href="/journal${s ? `?source=${s}` : ''}">${label}</a>`;
      return {
        title: '📜 Journal d\'administration',
        body: `<div style="margin-bottom:14px">${tab(null, 'Tout')}${tab('discord', 'Commandes Discord')}${tab('web', 'Tableau de bord')}</div>
        <div class="card"><table><tr><th>Quand</th><th>Qui</th><th>Où</th><th>Action</th><th>Détails</th></tr>
        ${list.map((e) => `<tr><td style="white-space:nowrap">${fmtDate(e.at)}</td><td>${esc(e.user)}</td><td>${e.source === 'web' ? '🌐 site' : '💬 Discord'}</td><td><code>${esc(e.action)}</code></td><td class="muted">${esc(e.details)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Rien pour l\'instant.</td></tr>'}
        </table><p class="muted">Les 1000 dernières actions sont conservées. Les sanctions détaillées sont aussi dans 📋┃logs sur Discord.</p></div>`,
      };
    },

    // ───────────────────────── Diagnostic ─────────────────────────
    async '/diagnostic'(guild) {
      const tool = (cmd, args) => {
        try {
          return execFileSync(cmd, args, { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }).split('\n')[0].slice(0, 80);
        } catch {
          return null;
        }
      };
      const missingPerms = require('./permissions').missing(guild);
      const me = guild.members.me;
      const aboveBot = config.roles.map((d) => findRole(guild, d.key)).filter((r) => r && !r.editable);
      const missingRoles = config.roles.filter((d) => !findRole(guild, d.key)).map((d) => d.name);
      const missingChannels = config.categories.flatMap((c) => c.channels).filter((d) => !findChannel(guild, d.key)).map((d) => d.name);
      const s = require('./health').status(guild.client);
      let integrity = '?';
      try {
        integrity = Object.values(require('./store').sql.prepare('PRAGMA quick_check').get())[0];
      } catch (e) {
        integrity = e.message;
      }
      const env = (k) => !!process.env[k];
      const copies = require('./dbbackup').list();
      const errors = require('./logger').tail(25);
      const row = (label, value) => `<tr><td style="width:300px">${label}</td><td>${value}</td></tr>`;
      const ytdlp = tool(process.env.YTDLP_PATH || 'yt-dlp', ['--version']);
      const ffmpeg = tool(process.env.FFMPEG_PATH || 'ffmpeg', ['-version']);
      const deno = tool('deno', ['--version']);
      return {
        title: '🩺 Diagnostic',
        body: `<div class="card"><h3>Bot</h3><table>
          ${row('Connexion à Discord', badge(s.ok, 'connecté', 'déconnecté'))}
          ${row('Latence / mémoire', `${s.ping} ms · ${s.memoryMb} Mo`)}
          ${row('Version', `<code>${esc(s.version.sha)}</code> ${esc(s.version.subject.slice(0, 90))}`)}
          ${row('Node.js', esc(s.node))}
          ${row('Rôle du bot', `${esc(me?.roles.highest.name ?? '?')} ${me?.permissions.has(P.Administrator) ? '<span class="badge warn">Administrateur (pas nécessaire, voir npm run invite)</span>' : '<span class="badge ok">permissions minimales</span>'}`)}
          ${row('Permissions manquantes', missingPerms.length ? `<span class="badge bad">${missingPerms.length}</span> ${esc(missingPerms.join(', '))}` : badge(true, 'aucune'))}
          ${row('Rôles au-dessus du bot', aboveBot.length ? `<span class="badge bad">${aboveBot.length}</span> ${esc(aboveBot.map((r) => r.name).join(', '))} — glisse le rôle du bot tout en haut` : badge(true, 'aucun'))}
          ${row('Rôles manquants', missingRoles.length ? `<span class="badge warn">${missingRoles.length}</span> ${esc(missingRoles.join(', '))} — lance la construction` : badge(true, 'aucun'))}
          ${row('Salons manquants', missingChannels.length ? `<span class="badge warn">${missingChannels.length}</span> ${esc(missingChannels.join(', '))}` : badge(true, 'aucun'))}
        </table></div>
        <div class="card"><h3>Configuration (.env) — les valeurs ne sont jamais affichées</h3><table>
          ${row('DISCORD_TOKEN / GUILD_ID', badge(env('DISCORD_TOKEN') && env('GUILD_ID'), 'présents'))}
          ${row('Twitch (identifiants)', badge(env('TWITCH_CLIENT_ID') && env('TWITCH_CLIENT_SECRET'), 'présents', 'absents', true))}
          ${row('Chaîne Twitch', twitchLogin() ? esc(twitchLogin()) : badge(false, '', 'non réglée', true))}
          ${row('Compte TikTok', tiktokUser() ? `@${esc(tiktokUser())}` : badge(false, '', 'non réglé', true))}
          ${row('Tableau de bord (DISCORD_CLIENT_SECRET)', badge(env('DISCORD_CLIENT_SECRET'), 'présent'))}
        </table></div>
        <div class="card"><h3>Outils</h3><table>
          ${row('yt-dlp (musique, TikTok)', ytdlp ? esc(ytdlp) : badge(false, '', 'absent', true))}
          ${row('ffmpeg (musique)', ffmpeg ? esc(ffmpeg) : badge(false, '', 'absent', true))}
          ${row('Deno (YouTube via yt-dlp)', deno ? esc(deno) : badge(false, '', 'absent', true))}
        </table></div>
        <div class="card"><h3>Données</h3><table>
          ${row('Intégrité de la base', badge(integrity === 'ok', 'ok', esc(integrity)))}
          ${row('Taille de la base', `${s.dbKb} Ko`)}
          ${row('Copies locales vérifiées', `${copies.filter((c) => c.verified).length} / ${copies.length}${copies[0] ? ` · dernière : ${fmtDate(copies[0].at)}` : ''}`)}
          ${row('Copie dans 💾┃sauvegardes', s.lastOffsite ? fmtDate(s.lastOffsite) : 'jamais')}
          ${row('Membres en quarantaine', Object.keys(db.quarantine ?? {}).length)}
        </table></div>
        <div class="card"><h3>Dernières erreurs (data/logs/erreurs.log)</h3>${errors.length ? `<pre>${esc(errors.join('\n'))}</pre>` : '<p class="muted">Aucune erreur enregistrée 🎉</p>'}</div>`,
      };
    },

    // ───────────────────────── Twitch & TikTok ─────────────────────────
    '/notifications'(guild, sess) {
      const n = settings.get('notifications');
      const twitchOk = !!(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET);
      return {
        title: '📡 Twitch, TikTok & YouTube',
        body: `<form method="post" class="card">${csrf(sess)}${hidden('action', 'accounts')}<h3>Comptes</h3>
        <div class="row"><div><label>Chaîne Twitch (sans https://twitch.tv/)</label><input type="text" name="twitch" value="${esc(twitchLogin())}" maxlength="40" placeholder="haro62190"></div>
        <div><label>Compte TikTok (sans @)</label><input type="text" name="tiktok" value="${esc(tiktokUser())}" maxlength="40" placeholder="haro621900"></div></div>
        <label>Chaîne YouTube (@pseudo, lien de la chaîne ou ID UC…)</label><input type="text" name="youtube" value="${esc(require('./youtube').source())}" maxlength="120" placeholder="@haro62190">
        ${(() => {
          const y = db.youtube ?? {};
          return y.error ? `<p class="muted">▶️ YouTube : <span class="badge bad">${esc(y.error)}</span></p>` : y.channelId ? `<p class="muted">▶️ YouTube : chaîne <code>${esc(y.channelId)}</code>${y.lastCheck ? ` · vérifiée ${fmtDate(y.lastCheck)}` : ''}</p>` : '';
        })()}
        <p class="muted">Identifiants de l'API Twitch : ${twitchOk ? '<span class="badge ok">présents dans .env</span>' : '<span class="badge bad">absents — TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET dans .env</span>'} (secrets : jamais modifiables ni affichés ici).</p>
        <button>Enregistrer</button> <button class="ghost" name="test" value="1">Enregistrer et tester</button></form>
        <form method="post" class="card">${csrf(sess)}${hidden('action', 'toggles')}<h3>Alertes</h3>
        ${checkbox('twitch', n.twitch, 'Lives Twitch (alerte, mise à jour en direct, récap de fin)')}
        ${checkbox('clips', n.clips, 'Nouveaux clips Twitch dans 🎬┃clips')}
        ${checkbox('schedule', n.schedule, 'Planning Twitch dans 🗓️┃planning + événements Discord')}
        ${checkbox('tiktok', n.tiktok, 'TikTok : nouvelles vidéos et lives')}
        ${checkbox('youtube', n.youtube !== false, 'YouTube : nouvelles vidéos et Shorts dans ▶️┃youtube')}
        ${checkbox('milestones', settings.on('milestones'), 'Paliers d\'abonnés annoncés (100, 500, 1000…)')}
        <button>Enregistrer</button></form>
        <form method="post" class="card">${csrf(sess)}${hidden('action', 'sync')}<h3>🗓️ Planning</h3><p class="muted">Synchronisé toutes les 30 minutes.</p><button class="ghost">Synchroniser maintenant</button></form>
        ${db.twitchLive ? `<div class="card"><h3>🔴 En live</h3><p><b>${esc(db.twitchLive.title)}</b><br>Pic : ${db.twitchLive.peak} viewers · ${esc((db.twitchLive.games ?? []).join(', '))}</p></div>` : ''}`,
      };
    },
    async 'POST /notifications'(guild, sess, body) {
      const action = body.get('action');
      if (action === 'sync') {
        await require('./twitchlive').checkSchedule(guild);
        return '🗓️ Planning synchronisé.';
      }
      if (action === 'toggles') {
        for (const k of ['twitch', 'clips', 'schedule', 'tiktok', 'youtube']) settings.set(`notifications.${k}`, body.has(k));
        settings.set('modules.milestones', body.has('milestones'));
        return '✅ Alertes enregistrées.';
      }
      const clean = (v) => String(v ?? '').trim().replace(/^https?:\/\/(www\.)?(twitch\.tv|tiktok\.com)\/@?/i, '').replace(/^@/, '').replace(/[^\w.]/g, '').slice(0, 40);
      settings.set('stream.twitchChannel', clean(body.get('twitch')).toLowerCase());
      settings.set('stream.tiktokUsername', clean(body.get('tiktok')));
      const yt = String(body.get('youtube') ?? '').trim().slice(0, 120);
      if (yt && !require('./youtube').normalize(yt)) return '❌ Chaîne YouTube invalide : mets @pseudo, le lien de la chaîne ou son ID UC….';
      if (yt !== require('./youtube').source() && db.youtube) db.youtube.error = null; // ancienne erreur = ancienne chaîne
      settings.set('stream.youtubeChannel', yt);
      if (!body.get('test')) return '✅ Comptes enregistrés.';
      const out = [];
      if (yt) {
        try {
          const id = await require('./youtube').channelId();
          out.push(`▶️ YouTube : chaîne ${id} trouvée ✅`);
        } catch (e) {
          out.push(`▶️ YouTube : ${e.message.slice(0, 120)} ❌`);
        }
      }
      if (twitchLogin() && process.env.TWITCH_CLIENT_ID) {
        try {
          const { TwitchClient } = require('./twitch');
          const t = new TwitchClient(process.env.TWITCH_CLIENT_ID, process.env.TWITCH_CLIENT_SECRET);
          const u = await t.getUser(twitchLogin());
          out.push(u ? `🟣 Twitch : ${u.display_name} trouvé ✅` : '🟣 Twitch : chaîne introuvable ❌');
        } catch (e) {
          out.push(`🟣 Twitch : ${e.message.slice(0, 120)} ❌`);
        }
      }
      if (tiktokUser()) {
        const res = await fetch(`https://www.tiktok.com/@${encodeURIComponent(tiktokUser())}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) }).catch(() => null);
        out.push(res?.ok ? `📱 TikTok : profil joignable ✅` : `📱 TikTok : profil injoignable (${res?.status ?? 'réseau'}) — les alertes passeront par yt-dlp`);
      }
      return out.join(' · ') || '✅ Enregistré (rien à tester).';
    },

    // ───────────────────────── Tickets ─────────────────────────
    async '/tickets'(guild, sess) {
      const open = Object.entries(db.tickets?.open ?? {});
      await fetchMembers(guild, open.flatMap(([, t]) => [t.ownerId, t.claimedBy]));
      return {
        title: '🎫 Tickets',
        body: `<div class="card"><table><tr><th>#</th><th>Sujet</th><th>Membre</th><th>Ouvert</th><th>Pris en charge</th><th></th></tr>
        ${open.map(([chId, t]) => `<tr><td>${t.number}</td><td>${esc(t.subject)}<br><span class="muted">#${esc(guild.channels.cache.get(chId)?.name ?? 'salon supprimé')}</span></td><td>${memberName(guild, t.ownerId)}</td><td>${fmtDate(t.createdAt)}</td><td>${t.claimedBy ? memberName(guild, t.claimedBy) : '—'}</td>
          <td><form method="post">${csrf(sess)}${hidden('channel', chId)}<button class="ghost" style="margin:0">Fermer</button></form></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Aucun ticket ouvert 🎉</td></tr>'}
        </table><p class="muted">Fermer depuis ici envoie aussi la transcription dans 📋┃logs et au membre. Tickets ouverts au total : ${db.tickets?.counter ?? 0}.</p></div>`,
      };
    },
    async 'POST /tickets'(guild, sess, body) {
      return (await require('./tickets').closeById(guild, body.get('channel'), sess.username)) ? '🔒 Ticket fermé (transcription envoyée).' : '❌ Ticket introuvable.';
    },

    // ───────────────────────── Copies de la base ─────────────────────────
    '/copies-base'(guild, sess) {
      const copies = require('./dbbackup').list();
      const { KEEP } = require('./dbbackup');
      return {
        title: '🗄️ Copies de la base',
        body: `<div class="card"><p class="muted">Une copie par jour, gardée en générations : ${KEEP.daily} jours · ${KEEP.weekly} semaines · ${KEEP.monthly} mois · ${KEEP.manual} manuelles. Chaque copie est <b>testée</b> (ouverte à part, intégrité, relecture). Si la base est abîmée au démarrage, le bot repart tout seul de la dernière copie vérifiée.</p>
        <form method="post" class="inline">${csrf(sess)}${hidden('action', 'create')}<button>Faire une copie maintenant</button></form></div>
        <div class="card"><table><tr><th>Copie</th><th>Date</th><th>Taille</th><th>Test</th><th></th></tr>
        ${copies.map((c) => `<tr><td><code>${esc(c.file)}</code> <span class="badge">${c.kind === 'manual' ? 'manuelle' : 'auto'}</span></td><td>${fmtDate(c.at)}</td><td>${(c.size / 1024).toFixed(0)} Ko</td>
          <td>${c.verified ? `<span class="badge ok">✔ ${c.check?.sections ?? '?'} sections</span>` : `<span class="badge bad">✖ ${esc(c.check?.error ?? '')}</span>`}</td>
          <td style="white-space:nowrap"><form method="post" class="inline">${csrf(sess)}${hidden('action', 'recheck')}${hidden('file', c.file)}<button class="ghost" style="margin:0">Retester</button></form>
          ${c.verified ? `<form method="post" class="inline">${csrf(sess)}${hidden('action', 'restore')}${hidden('file', c.file)}<button class="ghost" style="margin:0 0 0 6px">Restaurer…</button></form>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Aucune copie pour l\'instant.</td></tr>'}
        </table></div>
        ${fs.existsSync(path.join(require('./store').DIR, 'restauration.json')) ? `<form method="post" class="card">${csrf(sess)}${hidden('action', 'restart')}<h3>♻️ Restauration en attente</h3><p>Elle sera appliquée au prochain démarrage du bot.</p><button>Redémarrer le bot maintenant</button><p class="muted">Le bot s'arrête puis est relancé par pm2 (VPS) ou npm run dev (PC). Lancé avec « npm start » seul, il faudra le relancer à la main.</p></form>` : ''}`,
      };
    },
    async 'POST /copies-base'(guild, sess, body) {
      const b = require('./dbbackup');
      const action = body.get('action');
      if (action === 'create') {
        const e = b.create('manual');
        return e.verified ? `✅ Copie ${e.file} créée et testée.` : `❌ Copie créée mais le test a échoué : ${e.check.error}`;
      }
      if (action === 'recheck') {
        const e = b.recheck(body.get('file'));
        return e ? (e.verified ? `✅ ${e.file} : test réussi.` : `❌ ${e.file} : ${e.check.error}`) : '❌ Copie introuvable.';
      }
      if (action === 'restore') {
        const e = b.requestRestore(body.get('file'));
        return `♻️ Restauration de ${e.file} programmée (l'état actuel a été copié avant). Redémarre le bot pour l'appliquer.`;
      }
      if (action === 'restart') {
        setTimeout(() => process.kill(process.pid, 'SIGTERM'), 1500);
        return '♻️ Redémarrage du bot…';
      }
      return '❌ Action inconnue.';
    },
  };
};
