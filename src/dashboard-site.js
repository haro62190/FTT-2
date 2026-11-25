/**
 * Pages « site » du tableau de bord : 🌐 Page vitrine (textes, liens) · ⛏️ Serveur Minecraft (état, liste blanche)
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
        body: `<div class="card"><p>La page publique de la communauté : présentation, live Twitch en direct, prochains lives, meilleurs clips, compteurs, serveur Minecraft et bouton pour rejoindre le Discord. Tout se met à jour seul.</p>
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

    // ───────────────────────── Serveur Minecraft ─────────────────────────
    async '/minecraft'(guild, sess) {
      const gs = require('./gameserver');
      const s = gs.state();
      const wl = Object.entries(db.mcWhitelist ?? {});
      await fetchMembers(guild, wl.map(([id]) => id).slice(0, 200));
      return {
        title: '⛏️ Serveur Minecraft',
        body: gs.configured()
          ? `<div class="grid"><div class="stat"><b>${s.online ? '🟢' : '🔴'}</b><span>${s.online ? 'en ligne' : 'hors ligne'}</span></div>
            <div class="stat"><b>${s.players ?? 0} / ${s.max ?? 0}</b><span>joueurs</span></div>
            <div class="stat"><b>${esc(s.version ?? '—')}</b><span>version</span></div>
            <div class="stat"><b>${wl.length}</b><span>inscrits</span></div></div>
            <div class="card"><p>🌐 Adresse : <code>${esc(gs.address() || '(MINECRAFT_ADDRESS non réglée)')}</code> · vérifié ${s.checkedAt ? fmtDate(s.checkedAt) : 'jamais'}</p>
            ${s.names?.length ? `<p>Connectés : ${s.names.map((n) => `<code>${esc(n)}</code>`).join(' ')}</p>` : ''}
            <p class="muted">Les membres s'inscrivent eux-mêmes avec <code>/minecraft inscrire</code>. Ils sont retirés automatiquement s'ils quittent le Discord.</p>
            ${process.env.MINECRAFT_RCON_PASSWORD ? '' : '<p>⚠️ RCON non configuré : la liste blanche depuis Discord ne marche pas (MINECRAFT_RCON_PASSWORD dans .env).</p>'}</div>
            <div class="card"><h3>Liste blanche</h3><table><tr><th>Membre</th><th>Pseudo Minecraft</th><th></th></tr>
            ${wl.map(([id, p]) => `<tr><td>${esc(memberName(guild, id))}</td><td><code>${esc(p)}</code></td><td><form method="post" class="inline">${csrf(sess)}${hidden('action', 'remove')}${hidden('user', id)}<button class="ghost" style="margin:0">Retirer</button></form></td></tr>`).join('') || '<tr><td colspan="3" class="muted">Personne pour l\'instant.</td></tr>'}</table></div>
            <form method="post" class="card">${csrf(sess)}${hidden('action', 'say')}<h3>Message dans le jeu</h3><input name="text" maxlength="200" placeholder="Ex. Redémarrage dans 5 minutes !"><button>Envoyer</button></form>`
          : `<div class="card"><p>Le serveur Minecraft n'est pas encore installé. Sur le VPS :</p><pre>bash /root/bot/scripts/minecraft-install.sh</pre><p class="muted">Le script installe le serveur, puis te dit quoi ajouter dans le fichier .env.</p></div>`,
      };
    },
    async 'POST /minecraft'(guild, sess, body) {
      const gs = require('./gameserver');
      const action = body.get('action');
      if (action === 'remove') {
        const p = await gs.unwhitelist(String(body.get('user') ?? ''));
        return p ? `✅ ${p} retiré de la liste blanche.` : '❌ Introuvable.';
      }
      if (action === 'say') {
        const text = String(body.get('text') ?? '').replace(/[\r\n§]/g, ' ').trim().slice(0, 200);
        if (!text) return '❌ Message vide.';
        await gs.rcon(`say ${text}`);
        return '✅ Message envoyé dans le jeu.';
      }
      return '❌ Action inconnue.';
    },
  };
};
