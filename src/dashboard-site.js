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
