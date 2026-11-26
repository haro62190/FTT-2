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
