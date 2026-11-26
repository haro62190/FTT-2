/**
 * Pages « site » du tableau de bord : 🌐 Page vitrine (textes, liens)
 */
const settings = require('./settings');
const { db } = require('./store');

module.exports = ({ esc, csrf, fetchMembers, memberName, fmtDate }) => {
  const hidden = (name, value) => `<input type="hidden" name="${name}" value="${esc(value)}">`;
  const httpsOrEmpty = (v) => {
    const s = String(v ?? '').trim();
    if (!s) return '';
    const u = new URL(s); // lève une erreur si invalide
    if (u.protocol !== 'https:') throw new Error('Les liens doivent commencer par https://');
    return u.href;
  };

  return {
    // ───────────────────────── Page vitrine ─────────────────────────
    '/page-vitrine'(guild, sess) {
      const v = require('./vitrine');
      const hosts = v.publicHosts();
      const l = settings.get('vitrine.links') ?? {};
      const val = (k) => esc(settings.get(`vitrine.${k}`) ?? v.DEFAULTS[k] ?? '');
      return {
        title: '🌐 Page vitrine',
        body: `<div class="card"><p>La page publique de la communauté : présentation, live Twitch en direct, prochains lives, meilleurs clips, compteurs et bouton pour rejoindre le Discord. Tout se met à jour seul.</p>
        <p>${hosts.length ? `🌐 En ligne sur <a href="https://${esc(hosts[0])}" target="_blank" rel="noopener">https://${esc(hosts[0])}</a>` : '⚠️ Pas encore de domaine : ajoute <code>PUBLIC_HOST=haro62190.tech</code> dans le fichier .env du VPS.'} · <a href="/vitrine" target="_blank" rel="noopener">Aperçu</a></p></div>
        <form method="post" class="card">${csrf(sess)}${hidden('action', 'texts')}<h3>Textes</h3>
          <label>Phrase d'accroche</label><input name="tagline" maxlength="160" value="${val('tagline')}">
          <label>Présentation</label><textarea name="about" rows="5" maxlength="1500">${val('about')}</textarea>
          <h3>Liens (facultatifs)</h3>
          <label>YouTube</label><input name="youtube" placeholder="https://youtube.com/@…" value="${esc(l.youtube ?? '')}">
          <label>Instagram</label><input name="instagram" placeholder="https://instagram.com/…" value="${esc(l.instagram ?? '')}">
          <label>X (Twitter)</label><input name="x" placeholder="https://x.com/…" value="${esc(l.x ?? '')}">
          <label>Lien d'invitation Discord (vide = créé automatiquement par le bot)</label><input name="invite" placeholder="https://discord.gg/…" value="${esc(settings.get('vitrine.invite') ?? '')}">
          <button>Enregistrer</button></form>`,
      };
    },
    async 'POST /page-vitrine'(guild, sess, body) {
      settings.set('vitrine.tagline', String(body.get('tagline') ?? '').trim().slice(0, 160) || null);
      settings.set('vitrine.about', String(body.get('about') ?? '').trim().slice(0, 1500) || null);
      settings.set('vitrine.links', { youtube: httpsOrEmpty(body.get('youtube')), instagram: httpsOrEmpty(body.get('instagram')), x: httpsOrEmpty(body.get('x')) });
      settings.set('vitrine.invite', httpsOrEmpty(body.get('invite')) || null);
      return '✅ Page vitrine mise à jour.';
    },

    // ───────────────────────── Salons inactifs ─────────────────────────
    '/salons-inactifs'(guild, sess) {
      const ins = require('./insights');
      const u = ins.unusedChannels(guild);
      const archived = Object.entries(db.archivedChannels ?? {}).map(([id, a]) => ({ id, ...a, ch: guild.channels.cache.get(id) })).filter((x) => x.ch);
      const btn = (id, action, label, cls = 'ghost') => `<form method="post" class="inline">${csrf(sess)}${hidden('action', action)}${hidden('id', id)}<button class="${cls}" style="margin:0 4px 0 0">${label}</button></form>`;
      return {
        title: '🕸️ Salons inactifs',
        body: `<div class="card"><p>Les salons sans message (ou sans passage en vocal) depuis 30 jours. <b>Rien n'est fait automatiquement</b> : tu choisis. L'archivage est réversible (le salon passe en lecture seule dans ${esc(ins.ARCHIVE_NAME)}, et « Remettre » lui rend sa place et ses permissions).</p></div>
        <div class="card"><h3>Inactifs</h3>${
          !u.ready
            ? '<p class="muted">Analyse disponible après 30 jours de suivi de l\'activité.</p>'
            : `<table>${u.list.map((c) => `<tr><td>${c.voice ? '🔊' : '#'} ${esc(c.name)}<br><span class="muted">${c.last ? `dernière activité ${fmtDate(c.last)}` : 'aucune activité'}</span></td><td>${btn(c.id, 'archive', '📦 Archiver')}${btn(c.id, 'keep', '✅ Garder')}${c.voice ? '' : btn(c.id, 'nudge', '📣 Relancer')}</td></tr>`).join('') || '<tr><td class="muted">Aucun, tout le serveur vit ✅</td></tr>'}</table>`
        }</div>
        <div class="card"><h3>Archivés</h3><table>${archived.map((x) => `<tr><td>#${esc(x.ch.name)}<br><span class="muted">archivé ${fmtDate(x.at)} par ${esc(x.by)}</span></td><td>${btn(x.id, 'restore', '↩️ Remettre', '')}</td></tr>`).join('') || '<tr><td class="muted">Aucun.</td></tr>'}</table></div>`,
      };
    },
    async 'POST /salons-inactifs'(guild, sess, body) {
      const action = String(body.get('action') ?? '');
      if (!['archive', 'keep', 'nudge', 'restore'].includes(action)) return '❌ Action inconnue.';
      return require('./insights').channelAction(guild, String(body.get('id') ?? ''), action, sess.username);
    },

    // ───────────────────────── Santé générale (vue d'ensemble) ─────────────────────────
    '/sante'(guild, sess) {
      const g = require('./guardian');
      const h = require('./health').status(guild.client);
      const checks = g.runChecks(guild.client, guild);
      const errors = checks.filter((c) => c.status === 'error');
      const warns = checks.filter((c) => c.status === 'warn');
      const open = g.incidents().filter((x) => !x.resolvedAt);
      const m = settings.maintenance();
      const drill = db.lastRestoreDrill;
      const up = (ms) => {
        const mn = Math.floor(ms / 60_000);
        return mn >= 1440 ? `${Math.floor(mn / 1440)} j ${Math.floor((mn % 1440) / 60)} h` : `${Math.floor(mn / 60)} h ${String(mn % 60).padStart(2, '0')}`;
      };
      const verdict = errors.length ? ['🔴', 'Problème à régler', 'bad'] : warns.length ? ['🟠', 'À surveiller', ''] : ['🟢', 'Tout va bien', 'ok'];
      const tile = (v, label) => `<div class="stat"><b>${v}</b><span>${esc(label)}</span></div>`;
      const row = (label, value, ok = true) => `<tr><td>${ok ? '🟢' : '🟠'} ${esc(label)}</td><td>${value}</td></tr>`;
      return {
        title: '❤️ Santé générale',
        refresh: 60,
        body: `<div class="card" style="text-align:center"><div style="font-size:44px">${verdict[0]}</div><h3 style="margin:6px 0">${verdict[1]}</h3>
        <p class="muted" style="margin:0">${errors.length} problème(s) · ${warns.length} point(s) à surveiller · ${open.length} incident(s) ouvert(s)${m ? ' · 🛠️ maintenance en cours' : ''}</p></div>
        <div class="grid">${tile(h.ok ? 'En ligne' : 'Hors ligne', 'Bot Discord')}${tile(`${h.ping} ms`, 'Latence')}${tile(up(h.uptime), 'Sans redémarrage')}${tile(`${h.memoryMb} Mo`, 'Mémoire')}${tile(esc(h.version.sha), 'Version')}</div>
        ${[...errors, ...warns].length ? `<div class="card"><h3>À regarder</h3><table>${[...errors, ...warns].map((c) => `<tr><td>${g.ICON[c.status]} <b>${esc(c.label)}</b><br><span class="muted">${esc(c.detail ?? '')}</span></td><td>💡 ${esc(c.fix ?? '')}</td></tr>`).join('')}</table></div>` : ''}
        <div class="card"><h3>💾 Sauvegardes</h3><table>
          ${row('Copie de la base', h.lastFileBackup ? `${fmtDate(h.lastFileBackup.at)} ${h.lastFileBackup.verified ? '· vérifiée' : '· <b>non vérifiée</b>'}` : 'jamais', !!h.lastFileBackup?.verified)}
          ${row('Exercice de restauration', drill ? `${fmtDate(drill.at)} · ${drill.ok ? 'réussi' : `<b>raté</b> : ${esc(drill.error ?? '')}`}` : 'pas encore (après la copie de nuit)', !drill || drill.ok)}
          ${row('Sauvegarde du serveur', h.lastBackup ? fmtDate(h.lastBackup) : 'jamais', !!h.lastBackup)}
          ${row('Copie dans 💾┃sauvegardes', h.lastOffsite ? fmtDate(h.lastOffsite) : 'jamais', !!h.lastOffsite)}
        </table></div>
        <div class="card"><h3>Détails</h3><a class="btn ghost" href="/guardian">🛡️ Tous les contrôles</a> <a class="btn ghost" href="/incidents">📜 Incidents</a> <a class="btn ghost" href="/statut">💓 État technique</a> <a class="btn ghost" href="/historique-config">🕓 Réglages modifiés</a> <a class="btn ghost" href="/maintenance">🛠️ Maintenance</a></div>`,
      };
    },

    // ───────────────────────── Kensei Guardian ─────────────────────────
    '/guardian'(guild, sess) {
      const g = require('./guardian');
      const checks = g.runChecks(guild.client, guild);
      const bad = checks.filter((c) => c.status === 'warn' || c.status === 'error');
      const st = db.guardian ?? {};
      const row = (c) => `<tr><td>${g.ICON[c.status]}</td><td><b>${esc(c.label)}</b>${c.detail ? `<br><span class="muted">${esc(c.detail)}</span>` : ''}</td><td>${(c.status === 'warn' || c.status === 'error') && c.fix ? `💡 ${esc(c.fix)}` : ''}</td></tr>`;
      return {
        title: '🛡️ Kensei Guardian',
        body: `<div class="card"><p>Le gardien contrôle le bot toutes les 5 minutes : connexion, permissions, salons, Twitch, TikTok, YouTube, compteurs, sauvegardes, serveur de secours, mémoire, disque et erreurs répétées. Il prévient le staff dans 🚨┃alertes-sécurité quand un problème apparaît puis quand il est résolu. <b>Il ne modifie jamais rien lui-même</b> : il propose la correction.</p>
        <p>${bad.length ? `<span class="badge bad">${bad.length} point(s) à regarder</span>` : '<span class="badge ok">Tout va bien</span>'} · dernier passage automatique : ${st.lastRun ? fmtDate(st.lastRun) : 'pas encore'}</p></div>
        <div class="card"><table><tr><th></th><th>Contrôle</th><th>Correction proposée</th></tr>${[...bad, ...checks.filter((c) => !bad.includes(c))].map(row).join('')}</table></div>
        <form method="post" class="card">${csrf(sess)}${hidden('action', 'run')}<button>Lancer les contrôles maintenant (et prévenir le staff)</button> <a class="btn ghost" href="/incidents">📜 Historique des incidents</a></form>
        <div class="card"><h3>⌨️ Commandes (24 h)</h3><table><tr><th>Commande</th><th>Réussies</th><th>Échecs</th><th>Dernière erreur</th></tr>
        ${g.commandStats().slice(0, 15).map((c) => `<tr><td><code>/${esc(c.name)}</code></td><td>${c.ok}</td><td>${c.fail ? `<b>${c.fail}</b> (${Math.round(c.rate * 100)} %)` : '0'}</td><td class="muted">${esc(c.lastError ?? '')}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Aucune commande utilisée depuis le dernier démarrage.</td></tr>'}</table></div>
        <div class="card"><h3>⏱️ Tâches automatiques</h3><table><tr><th>Tâche</th><th>Toutes les</th><th>Dernier passage</th><th>Passages</th></tr>
        ${[...g.tasks.entries()].map(([key, t]) => {
          const late = g.lateTasks().some((x) => x.key === key);
          const every = t.ms >= 3600_000 ? `${Math.round(t.ms / 3600_000)} h` : t.ms >= 60_000 ? `${Math.round(t.ms / 60_000)} min` : `${Math.round(t.ms / 1000)} s`;
          return `<tr><td>${late ? '🟠' : '🟢'} ${esc(t.label)}</td><td>${every}</td><td>${t.last ? fmtDate(t.last) : 'pas encore'}</td><td>${t.runs}</td></tr>`;
        }).join('') || '<tr><td colspan="4" class="muted">Aucune tâche suivie.</td></tr>'}</table></div>`,
      };
    },
    '/incidents'(guild, sess, q) {
      const g = require('./guardian');
      const filter = q?.get?.('f') ?? 'all';
      const list = g.incidents().filter((x) => (filter === 'open' ? !x.resolvedAt : filter === 'resolved' ? x.resolvedAt : true));
      const dur = (a, b) => {
        const m = Math.round(((b ?? Date.now()) - a) / 60_000);
        return m >= 1440 ? `${Math.floor(m / 1440)} j ${Math.floor((m % 1440) / 60)} h` : m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;
      };
      const statusCell = (x) => (x.resolvedAt ? '<span class="badge ok">résolu</span>' : x.ack ? `<span class="badge">vu par ${esc(x.ack.by)}</span>` : `<span class="badge bad">ouvert</span>`);
      const tab = (f, label) => `<a class="btn ${filter === f ? '' : 'ghost'}" href="/incidents?f=${f}" style="margin:0 6px 6px 0">${label}</a>`;
      const open = g.incidents().filter((x) => !x.resolvedAt).length;
      return {
        title: '📜 Historique des incidents',
        body: `<div class="card"><p>Chaque problème repéré par 🛡️ Kensei Guardian devient un incident : quand il est apparu, s'il a été vu par un admin, quand il a été résolu et combien de temps il a duré. <b>${open}</b> incident(s) ouvert(s).</p>
        <div>${tab('all', 'Tous')}${tab('open', 'Ouverts')}${tab('resolved', 'Résolus')}</div></div>
        <div class="card"><table><tr><th></th><th>Incident</th><th>Apparu</th><th>Durée</th><th>Statut</th><th></th></tr>
        ${list.slice(0, 100).map((x) => `<tr><td>${g.ICON[x.resolvedAt ? 'ok' : x.status]}</td><td><b>${esc(x.label)}</b><br><span class="muted">${esc(x.detail ?? '')}</span>${!x.resolvedAt && x.fix ? `<br>💡 ${esc(x.fix)}` : ''}</td><td style="white-space:nowrap">${fmtDate(x.openedAt)}</td><td>${dur(x.openedAt, x.resolvedAt)}</td><td>${statusCell(x)}</td><td>${!x.resolvedAt && !x.ack ? `<form method="post" class="inline">${csrf(sess)}${hidden('action', 'ack')}${hidden('id', x.id)}<button class="ghost" style="margin:0">J'ai vu</button></form>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Aucun incident 🎉</td></tr>'}</table></div>`,
      };
    },
    async 'POST /incidents'(guild, sess, body) {
      if (body.get('action') !== 'ack') return '❌ Action inconnue.';
      const inc = require('./guardian').acknowledge(String(body.get('id') ?? ''), sess.username);
      return `👁️ Incident « ${inc.label} » marqué comme vu (plus de rappel toutes les 12 h, il reste suivi jusqu'à sa résolution).`;
    },
    async 'POST /guardian'() {
      const checks = await require('./guardian').run();
      const bad = checks.filter((c) => c.status === 'warn' || c.status === 'error').length;
      return bad ? `🛡️ ${bad} point(s) à regarder.` : '🛡️ Tout va bien.';
    },

    // ───────────────────────── Mode maintenance ─────────────────────────
    '/maintenance'(guild, sess) {
      const m = settings.maintenance();
      const saved = settings.raw('maintenance') ?? {};
      const groups = new Map();
      for (const [key, label, , group] of settings.MODULES) {
        if (group === 'Sécurité') continue; // les protections restent toujours actives
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(`<label class="check" style="display:block"><input type="checkbox" name="mod" value="${esc(key)}" ${(saved.modules ?? []).includes(key) ? 'checked' : ''}> ${esc(label)}</label>`);
      }
      return {
        title: '🛠️ Mode maintenance',
        body: `<div class="card"><p>Coupe <b>temporairement</b> certaines fonctions (par exemple pendant une réorganisation du serveur), sans toucher à leurs réglages : à la fin de la maintenance, tout revient exactement comme avant. Les protections (anti-raid, anti-spam, anti-nuke, AutoMod) ne sont jamais coupées.</p>
        <p>${m ? `<span class="badge bad">Actif</span> depuis ${fmtDate(m.since)} par ${esc(m.by ?? '?')}${m.until ? ` · fin automatique ${fmtDate(m.until)}` : ' · <b>sans fin automatique</b> (le gardien te le rappellera après 2 h)'}` : '<span class="badge ok">Inactif</span>'}</p></div>
        <form method="post" class="card">${csrf(sess)}${hidden('action', 'on')}<h3>${m ? 'Modifier la maintenance' : 'Activer la maintenance'}</h3>
          <label>Raison (affichée aux membres si les commandes sont réservées au staff)</label><input name="reason" maxlength="150" value="${esc(saved.reason ?? '')}" placeholder="Réorganisation des salons">
          <label>Durée</label><select name="duration">${[['30', '30 min'], ['60', '1 h'], ['120', '2 h'], ['360', '6 h'], ['1440', '24 h'], ['0', 'Sans limite (je l\'arrêterai moi-même)']].map(([v, l]) => `<option value="${v}" ${v === '120' ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <label class="check" style="margin-top:10px"><input type="checkbox" name="staffOnly" ${saved.staffOnly ? 'checked' : ''}> Réserver toutes les commandes au staff</label>
          <h3 style="margin-top:14px">Fonctions à couper</h3>
          <div class="grid">${[...groups.entries()].map(([g, items]) => `<div><b>${esc(g)}</b>${items.join('')}</div>`).join('')}</div>
          <button>${m ? 'Mettre à jour' : 'Activer la maintenance'}</button></form>
        ${m ? `<form method="post" class="card">${csrf(sess)}${hidden('action', 'off')}<button>✅ Terminer la maintenance (tout revient comme avant)</button></form>` : ''}`,
      };
    },
    async 'POST /maintenance'(guild, sess, body) {
      if (body.get('action') === 'off') {
        settings.set('maintenance', { ...(settings.raw('maintenance') ?? {}), active: false, endedAt: Date.now() });
        require('./feed').push('🛠️', `Fin de la maintenance (${sess.username})`);
        return '✅ Maintenance terminée : toutes les fonctions sont revenues.';
      }
      const allowed = new Set(settings.MODULES.filter((x) => x[3] !== 'Sécurité').map((x) => x[0]));
      const modules = body.getAll('mod').filter((k) => allowed.has(k));
      const staffOnly = body.has('staffOnly');
      if (!modules.length && !staffOnly) return '❌ Choisis au moins une fonction à couper, ou réserve les commandes au staff.';
      const minutes = Math.max(0, Math.min(10_080, Number(body.get('duration')) || 0));
      const prev = settings.maintenance();
      settings.set('maintenance', { active: true, modules, staffOnly, reason: String(body.get('reason') ?? '').trim().slice(0, 150), since: prev?.since ?? Date.now(), until: minutes ? Date.now() + minutes * 60_000 : null, by: sess.username });
      require('./feed').push('🛠️', `Maintenance activée par ${sess.username} : ${modules.length} fonction(s)${staffOnly ? ', commandes staff seulement' : ''}`);
      return `🛠️ Maintenance active : ${modules.length} fonction(s) coupée(s)${staffOnly ? ', commandes réservées au staff' : ''}${minutes ? `, fin automatique dans ${minutes >= 60 ? `${minutes / 60} h` : `${minutes} min`}` : ''}.`;
    },

    // ───────────────────────── Historique de la configuration ─────────────────────────
    '/historique-config'(guild, sess, q) {
      const src = q?.get?.('s') ?? 'all';
      const list = (db.configHistory ?? []).filter((e) => src === 'all' || e.source === src);
      const tab = (f, label) => `<a class="btn ${src === f ? '' : 'ghost'}" href="/historique-config?s=${f}" style="margin:0 6px 6px 0">${label}</a>`;
      const where = (e) => (e.source === 'web' ? '🌐 site' : e.source === 'discord' ? '💬 Discord' : '🤖 automatique');
      return {
        title: '🕓 Historique de la configuration',
        body: `<div class="card"><p>Chaque réglage modifié, avec qui l'a changé, d'où, et la valeur <b>avant → après</b>. Les valeurs sensibles sont masquées. 500 dernières modifications gardées.</p>
        <div>${tab('all', 'Tout')}${tab('web', '🌐 Site')}${tab('discord', '💬 Discord')}${tab('bot', '🤖 Automatique')}</div></div>
        ${list
          .slice(0, 80)
          .map(
            (e) => `<div class="card"><p style="margin:0 0 8px"><b>${esc(e.user)}</b> · ${where(e)}${e.page ? ` · <code>${esc(e.page)}</code>` : ''} · <span class="muted">${fmtDate(e.at)}</span></p>
          <table>${e.changes
            .slice(0, 30)
            .map((c) => `<tr><td><code>${esc(c.path)}</code></td><td class="muted" style="text-decoration:line-through">${esc(c.before)}</td><td>→ <b>${esc(c.after)}</b></td></tr>`)
            .join('')}${e.changes.length > 30 ? `<tr><td colspan="3" class="muted">… et ${e.changes.length - 30} autre(s)</td></tr>` : ''}</table></div>`,
          )
          .join('') || '<div class="card"><p class="muted">Aucune modification enregistrée pour l\'instant.</p></div>'}`,
      };
    },

    // ───────────────────────── Émojis ─────────────────────────
    async '/emojis'(guild, sess) {
      const em = require('./emojis');
      await guild.emojis.fetch().catch(() => {});
      const u = em.usage(guild);
      const can = guild.members.me?.permissions.has('ManageGuildExpressions');
      const cell = (e) => `<div style="display:inline-flex;flex-direction:column;align-items:center;gap:4px;width:110px;margin:6px;padding:8px;border:1px solid var(--line);border-radius:10px">
        <img src="https://cdn.discordapp.com/emojis/${esc(e.id)}.${e.animated ? 'gif' : 'png'}?size=64" alt="" width="48" height="48" style="object-fit:contain">
        <code style="font-size:12px;max-width:100%;overflow:hidden;text-overflow:ellipsis">:${esc(e.name)}:</code>
        <form method="post" class="inline">${csrf(sess)}${hidden('action', 'delete')}${hidden('id', e.id)}<button class="ghost" style="margin:0;padding:4px 10px;font-size:12px">Supprimer</button></form></div>`;
      const list = (animated) => [...guild.emojis.cache.values()].filter((e) => e.animated === animated).sort((a, b) => a.name.localeCompare(b.name));
      return {
        title: '😀 Émojis personnalisés',
        body: `${can ? '' : '<div class="card"><p>⚠️ Le bot n\'a pas la permission <b>Gérer les expressions</b> : ouvre le nouveau lien d\'invitation (<code>npm run invite</code>) ou ajoute-la au rôle du bot.</p></div>'}
        <form method="post" class="card" id="up">${csrf(sess)}${hidden('action', 'add')}<input type="hidden" name="data" id="data">
          <h3>Ajouter un émoji</h3><p class="muted">PNG, JPEG ou WebP pour un émoji normal, <b>GIF pour un émoji animé</b>. 256 Ko maximum, idéalement carré (128×128).</p>
          <label>Image</label><input type="file" id="file" accept="image/png,image/jpeg,image/gif,image/webp">
          <label>Nom (lettres, chiffres, _)</label><input name="name" id="name" maxlength="32" pattern="[A-Za-z0-9_]{2,32}" required>
          <p id="info" class="muted"></p><button id="go" disabled>Ajouter</button></form>
        <div class="card"><h3>Statiques · ${u.statics}/${u.max}</h3>${list(false).map(cell).join('') || '<p class="muted">Aucun.</p>'}</div>
        <div class="card"><h3>Animés · ${u.animated}/${u.max}</h3>${list(true).map(cell).join('') || '<p class="muted">Aucun.</p>'}</div>
        <p class="muted">Aussi sur Discord : <code>/emoji ajouter</code>, <code>/emoji supprimer</code>, <code>/emoji liste</code>.</p>`,
        script: `const $=(i)=>document.getElementById(i);$('file').addEventListener('change',()=>{const f=$('file').files[0];$('go').disabled=true;if(!f)return;if(f.size>${em.MAX_BYTES}){$('info').textContent='❌ Trop lourd ('+Math.ceil(f.size/1024)+' Ko) : 256 Ko maximum.';return}if(!$('name').value)$('name').value=f.name.replace(/\\.[^.]+$/,'').replace(/[^A-Za-z0-9_]+/g,'_').replace(/^_+|_+$/g,'').slice(0,32);const r=new FileReader();r.onload=()=>{$('data').value=String(r.result).split(',')[1];$('info').textContent=(f.type==='image/gif'?'🎞️ Émoji animé':'🖼️ Émoji statique')+' · '+Math.ceil(f.size/1024)+' Ko';$('go').disabled=false};r.readAsDataURL(f)});`,
      };
    },
    async 'POST /emojis'(guild, sess, body) {
      const em = require('./emojis');
      if (body.get('action') === 'delete') {
        const name = await em.remove(guild, String(body.get('id') ?? ''), sess.username);
        return `🗑️ Émoji :${name}: supprimé.`;
      }
      const data = Buffer.from(String(body.get('data') ?? ''), 'base64');
      const emoji = await em.add(guild, { name: body.get('name'), data, by: sess.username });
      return `✅ Émoji :${emoji.name}: ajouté.`;
    },
  };
};
