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
  };
};
