/**
 * Pages supplémentaires du tableau de bord : toutes les fonctionnalités de Kensei.
 * Chaque page GET renvoie { title, body, refresh? } ; chaque POST renvoie un message (flash).
 */
const fs = require('fs');
const path = require('path');
const {
  ChannelType,
  EmbedBuilder,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventStatus,
  PermissionFlagsBits: P,
} = require('discord.js');
const settings = require('./settings');
const { db, save } = require('./store');
const { BRAND_COLOR, config, findChannel, iconPath } = require('./shared');

// Construction en cours (/setup depuis le site) : journal affiché en direct
const job = { running: false, kind: '', lines: [], startedAt: 0, endedAt: 0 };

module.exports = ({ esc, csrf, checkbox, fetchMembers, memberName, fmtDate }) => {
  const textChannels = (guild) =>
    guild.channels.cache.filter((c) => [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(c.type)).sort((a, b) => a.rawPosition - b.rawPosition);
  const channelSelect = (guild, name, selected) =>
    `<select name="${name}">${textChannels(guild).map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>#${esc(c.name)}</option>`).join('')}</select>`;
  const roleSelect = (guild, name, { none = true } = {}) =>
    `<select name="${name}">${none ? '<option value="">— aucun —</option>' : ''}${guild.roles.cache
      .filter((r) => r.id !== guild.id && !r.managed)
      .sort((a, b) => b.position - a.position)
      .map((r) => `<option value="${r.id}">${esc(r.name)}</option>`)
      .join('')}</select>`;
  const hidden = (name, value) => `<input type="hidden" name="${name}" value="${esc(value)}">`;
  const int = (v, min, max) => {
    const n = Number.parseInt(v, 10);
    return Number.isInteger(n) && n >= min && n <= max ? n : null;
  };
  /** Retrouve un membre par ID, @pseudo ou nom affiché */
  async function findMember(guild, text) {
    const q = String(text ?? '').trim().replace(/^<@!?(\d+)>$/, '$1').replace(/^@/, '');
    if (!q) return null;
    if (/^\d{17,20}$/.test(q)) return guild.members.fetch(q).catch(() => null);
    const found = await guild.members.fetch({ query: q, limit: 5 }).catch(() => null);
    return found?.find((m) => m.user.username.toLowerCase() === q.toLowerCase() || m.displayName.toLowerCase() === q.toLowerCase()) ?? found?.first() ?? null;
  }

  return {
    // ───────────────────────── Construction (/setup) ─────────────────────────
    '/serveur'(guild, sess) {
      const p = require('./builder').plan(guild);
      const list = (arr) => (arr.length ? `<ul>${arr.slice(0, 40).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">Rien.</p>');
      const log = job.lines.length
        ? `<div class="card"><h3>${job.running ? '⏳ En cours…' : '📜 Dernière construction'} — ${esc(job.kind)}</h3><pre style="white-space:pre-wrap;max-height:420px;overflow:auto;background:#0d0d0f;padding:12px;border-radius:8px">${esc(job.lines.join('\n'))}</pre>${job.running ? '' : `<p class="muted">Terminée ${fmtDate(job.endedAt)}</p>`}</div>`
        : '';
      const btn = (kind, label, ghost = false) => `<form method="post" class="inline">${csrf(sess)}${hidden('kind', kind)}<button ${ghost ? 'class="ghost"' : ''} ${job.running ? 'disabled' : ''}>${label}</button></form> `;
      return {
        title: '🏗️ Construction du serveur',
        refresh: job.running ? 3 : 0,
        body: `${log}<div class="card"><h3>Ce que /setup va faire</h3>
        <div class="row"><div><b>👥 Rôles</b> — ${p.rolesCreate.length} à créer, ${p.rolesRename.length} à renommer, ${p.rolesUpdate} à mettre à jour${list([...p.rolesCreate.map((r) => `＋ ${r}`), ...p.rolesRename.map((r) => `✎ ${r}`)])}</div>
        <div><b>📁 Salons</b> — ${p.chCreate.length} à créer, ${p.chRename.length} à renommer, ${p.chUpdate} à mettre à jour${list([...p.chCreate.map((r) => `＋ ${r}`), ...p.chRename.map((r) => `✎ ${r}`)])}</div></div>
        <p class="muted">Rien n'est jamais supprimé. Une sauvegarde est faite juste avant.</p>
        ${btn('setup', '🏯 Tout construire (/setup)')}${btn('roles', '👥 Rôles seulement', true)}${btn('channels', '📁 Salons seulement', true)}${btn('automod', '🤖 AutoMod seulement', true)}</div>`,
      };
    },
    async 'POST /serveur'(guild, sess, body) {
      if (job.running) return '⏳ Une construction est déjà en cours.';
      const kind = body.get('kind');
      const builder = require('./builder');
      const steps = {
        setup: async (log) => {
          await require('./admin').brandBot(guild.client, log);
          await builder.buildAll(guild, log);
          await require('./commands').register(guild);
          log('  ✔ Commandes / à jour');
        },
        roles: (log) => builder.ensureRoles(guild, log),
        channels: async (log) => {
          await builder.ensureChannels(guild, log);
          await guild.channels.fetch();
          await builder.postMessages(guild, log);
        },
        automod: (log) => require('./automod').ensureAutoMod(guild, log),
      };
      if (!steps[kind]) return '❌ Action inconnue.';
      Object.assign(job, { running: true, kind, lines: [], startedAt: Date.now() });
      require('./backup').createBackup(guild, `avant-${kind}-web-${new Date().toISOString().slice(0, 16)}`, sess.userId);
      const log = (...a) => job.lines.push(a.join(' ').replace(/^\n+/, ''));
      // En arrière-plan : la page se rafraîchit toute seule et affiche la progression
      (async () => {
        try {
          await guild.roles.fetch();
          await guild.channels.fetch();
          await steps[kind](log);
          log('', '✅ Terminé ! Pense à placer le rôle du bot tout en haut de la liste des rôles.');
        } catch (err) {
          log('', `❌ Erreur : ${err.message}`);
        } finally {
          job.running = false;
          job.endedAt = Date.now();
        }
      })();
      return '⏳ Construction lancée, suis la progression ci-dessous.';
    },

    // ───────────────────────── Logo & identité ─────────────────────────
    '/logo'(guild, sess) {
      const custom = fs.existsSync(path.join(__dirname, '..', 'data', 'custom-icon.img'));
      return {
        title: '🖼️ Logo & identité',
        body: `<div class="card"><div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">
        <img src="/logo.png?v=${Date.now()}" alt="" style="width:140px;height:140px;border-radius:50%;border:2px solid #e10600">
        <div><p><b>Bot :</b> ${esc(guild.client.user.username)} · surnom <b>${esc(guild.members.me?.nickname ?? '—')}</b></p>
        <p><b>Serveur :</b> ${esc(guild.name)}</p><p class="muted">${custom ? 'Logo personnalisé (envoyé depuis le site ou /logo).' : 'Logo officiel (assets/icon.png).'}</p></div></div></div>
        <form method="post" class="card">${csrf(sess)}${hidden('action', 'set')}<h3>Changer le logo</h3>
        <label>Lien d'une image (PNG, JPG, GIF ou WEBP, 8 Mo max) — par ex. clic droit sur une image dans Discord → « Copier le lien »</label>
        <input type="text" name="url" placeholder="https://…" required>
        <label>Appliquer à</label><select name="where"><option value="both">Serveur + bot</option><option value="guild">Serveur seulement</option><option value="bot">Bot seulement</option></select>
        <button>Appliquer</button></form>
        <form method="post" class="card">${csrf(sess)}${hidden('action', 'reset')}<h3>Revenir au logo officiel</h3><button class="ghost">Réinitialiser</button></form>
        <form method="post" class="card">${csrf(sess)}${hidden('action', 'brand')}<h3>Nom et surnom du bot</h3>
        <p class="muted">Remet le nom « ${esc(config.bot?.name ?? 'Kensei')} » et le surnom « ${esc(config.bot?.nickname ?? '')} » (modifiables dans config/server.js). Discord limite les changements de nom à 2 par heure.</p><button class="ghost">Appliquer</button></form>`,
      };
    },
    async 'POST /logo'(guild, sess, body) {
      const custom = path.join(__dirname, '..', 'data', 'custom-icon.img');
      const action = body.get('action');
      if (action === 'brand') {
        const lines = [];
        await require('./admin').brandBot(guild.client, (l) => lines.push(l.trim()));
        return lines.join(' · ') || '✅ Rien à changer.';
      }
      let image;
      if (action === 'reset') {
        fs.rmSync(custom, { force: true });
        image = iconPath();
      } else {
        const url = String(body.get('url') ?? '').trim();
        if (!/^https:\/\//.test(url)) return '❌ Le lien doit commencer par https://';
        const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        const type = res.headers.get('content-type') ?? '';
        if (!res.ok || !/^image\/(png|jpe?g|gif|webp)/.test(type)) return '❌ Ce lien n\'est pas une image PNG, JPG, GIF ou WEBP.';
        image = Buffer.from(await res.arrayBuffer());
        if (image.length > 8 * 1024 * 1024) return '❌ Image trop lourde (8 Mo max).';
        fs.mkdirSync(path.dirname(custom), { recursive: true });
        fs.writeFileSync(custom, image);
      }
      const where = body.get('where') ?? 'both';
      const done = [];
      if (where !== 'bot') await guild.setIcon(image).then(() => done.push('✅ Icône du serveur')).catch((e) => done.push(`⚠️ Serveur : ${e.message}`));
      if (where !== 'guild') {
        await guild.client.user
          .setAvatar(image)
          .then(() => {
            db.botAvatarHash = require('crypto').createHash('sha1').update(fs.readFileSync(iconPath())).digest('hex');
            save();
            done.push('✅ Avatar du bot');
          })
          .catch((e) => done.push(`⚠️ Bot : ${e.status === 429 ? 'Discord limite les changements d\'avatar, réessaie dans une heure' : e.message}`));
      }
      return done.join(' · ');
    },

    // ───────────────────────── Économie ─────────────────────────
    async '/economie'(guild, sess) {
      const e = settings.get('economy');
      const top = Object.entries(db.economy ?? {}).sort((a, b) => b[1].bal - a[1].bal).slice(0, 25);
      await fetchMembers(guild, top.map(([id]) => id));
      const total = Object.values(db.economy ?? {}).reduce((n, w) => n + w.bal, 0);
      return {
        title: '💰 Économie & boutique',
        body: `<form method="post" class="card">${csrf(sess)}${hidden('action', 'settings')}<h3>Réglages</h3>
        ${checkbox('enabled', e.enabled, 'Économie activée (gains en écrivant, en vocal, /daily)')}
        <div class="row"><div><label>/daily de base (両)</label><input type="number" name="daily" value="${esc(e.daily)}" min="0" max="100000"></div>
        <div><label>Gain par minute de vocal (両)</label><input type="number" name="voicePerMinute" value="${esc(e.voicePerMinute)}" min="0" max="1000"></div></div>
        <button>Enregistrer</button></form>
        <form method="post" class="card">${csrf(sess)}${hidden('action', 'adjust')}<h3>Donner / retirer des ryō</h3>
        <div class="row"><div><label>Membre (pseudo ou ID)</label><input type="text" name="member" required></div><div><label>Montant (négatif = retirer)</label><input type="number" name="amount" required></div></div>
        <button>Appliquer</button></form>
        <div class="card"><h3>🏮 Boutique <span class="muted">(articles dans config/server.js → shop)</span></h3><table><tr><th>Article</th><th>Prix</th><th>Durée</th><th>Acheteurs</th></tr>
        ${(config.shop ?? []).map((x) => `<tr><td>${esc(x.name)}<br><span class="muted">${esc(x.description ?? '')}</span></td><td>${x.price} 両</td><td>${x.days ? `${x.days} j` : 'permanent'}</td><td>${Object.values(db.economy ?? {}).filter((w) => w.owned?.includes(x.key)).length}</td></tr>`).join('')}</table></div>
        <div class="card"><h3>💰 Les plus riches</h3><p class="muted">${total.toLocaleString('fr-FR')} 両 en circulation</p><table><tr><th>#</th><th>Membre</th><th>Solde</th><th>Série /daily</th></tr>
        ${top.map(([id, w], n) => `<tr><td>${n + 1}</td><td>${memberName(guild, id)}</td><td>${w.bal.toLocaleString('fr-FR')} 両</td><td>${w.streak}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Personne n\'a encore de ryō.</td></tr>'}</table></div>`,
      };
    },
    async 'POST /economie'(guild, sess, body) {
      if (body.get('action') === 'settings') {
        settings.set('economy.enabled', body.has('enabled'));
        const d = int(body.get('daily'), 0, 100000);
        const v = int(body.get('voicePerMinute'), 0, 1000);
        if (d !== null) settings.set('economy.daily', d);
        if (v !== null) settings.set('economy.voicePerMinute', v);
        return '✅ Économie enregistrée.';
      }
      const member = await findMember(guild, body.get('member'));
      const amount = int(body.get('amount'), -10_000_000, 10_000_000);
      if (!member || amount === null) return '❌ Membre introuvable ou montant invalide.';
      const bal = require('./economy').add(member.id, amount);
      return `✅ ${member.displayName ?? member.user?.username ?? member.id} : ${amount >= 0 ? '+' : ''}${amount} 両 → solde ${bal} 両`;
    },

    // ───────────────────────── Giveaways ─────────────────────────
    async '/giveaways'(guild, sess) {
      const list = Object.entries(db.giveaways ?? {}).sort((a, b) => b[1].endsAt - a[1].endsAt);
      await fetchMembers(guild, list.flatMap(([, g]) => [g.hostId, ...g.winnerIds]));
      return {
        title: '🎁 Giveaways',
        body: `<form method="post" class="card">${csrf(sess)}${hidden('action', 'create')}<h3>Lancer un giveaway</h3>
        <label>Prix</label><input type="text" name="prize" maxlength="200" required placeholder="ex : Nitro 1 mois">
        <div class="row"><div><label>Durée (ex : 30m, 2h, 1j, 1h30)</label><input type="text" name="duration" value="1j" required></div>
        <div><label>Gagnants</label><input type="number" name="winners" value="1" min="1" max="20"></div></div>
        <div class="row"><div><label>Salon</label>${channelSelect(guild, 'channel', findChannel(guild, 'announcements')?.id)}</div><div><label>Mentionner</label>${roleSelect(guild, 'role')}</div></div>
        <button>Lancer</button></form>
        <div class="card"><table><tr><th>Prix</th><th>Fin</th><th>Participants</th><th>Gagnants</th><th></th></tr>
        ${list.map(([id, g]) => `<tr><td>${esc(g.prize)}</td><td>${fmtDate(g.endsAt)}${g.ended ? ' (terminé)' : ''}</td><td>${g.entrants.length}</td>
          <td>${g.winnerIds.map((w) => memberName(guild, w)).join('<br>') || '—'}</td>
          <td><form method="post">${csrf(sess)}${hidden('id', id)}${hidden('action', g.ended ? 'reroll' : 'end')}<button class="ghost" style="margin:0">${g.ended ? 'Nouveau gagnant' : 'Terminer'}</button></form></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Aucun giveaway.</td></tr>'}</table></div>`,
      };
    },
    async 'POST /giveaways'(guild, sess, body) {
      const gw = require('./giveaway');
      const action = body.get('action');
      if (action === 'create') {
        const ms = gw.parseDuration(body.get('duration') ?? '');
        if (!ms || ms < 60_000 || ms > 60 * 86_400_000) return '❌ Durée entre 1 minute et 60 jours (ex : 30m, 2h, 1j).';
        const channel = guild.channels.cache.get(body.get('channel'));
        const prize = String(body.get('prize') ?? '').trim().slice(0, 200);
        if (!channel?.isTextBased() || !prize) return '❌ Salon ou prix invalide.';
        await gw.create(channel, { prize, ms, winners: int(body.get('winners'), 1, 20) ?? 1, hostId: sess.userId, role: guild.roles.cache.get(body.get('role')) ?? null });
        return `🎁 Giveaway « ${prize} » lancé dans #${channel.name}.`;
      }
      const winners = await gw.end(guild.client, body.get('id'), action === 'reroll');
      return winners ? `🏆 Gagnant(s) : ${winners.length}` : '❌ Giveaway introuvable.';
    },

    // ───────────────────────── Événements ─────────────────────────
    async '/evenements'(guild, sess) {
      const events = await guild.scheduledEvents.fetch().catch(() => new Map());
      return {
        title: '🎌 Événements Discord',
        body: `<form method="post" class="card">${csrf(sess)}${hidden('action', 'create')}<h3>Créer un événement</h3>
        <label>Titre</label><input type="text" name="name" maxlength="100" required>
        <div class="row"><div><label>Date (JJ/MM/AAAA HH:MM, heure de Paris)</label><input type="text" name="date" placeholder="25/12/2026 20:30" required></div>
        <div><label>Durée (heures)</label><input type="number" name="hours" value="2" min="1" max="72"></div></div>
        <label>Lieu ou lien (ta chaîne Twitch par défaut)</label><input type="text" name="location" maxlength="100">
        <label>Description</label><textarea name="description" maxlength="1000"></textarea>
        ${checkbox('announce', true, 'Annoncer dans 📡┃annonces')}${checkbox('mention', false, 'Mentionner 📢 Notif Annonces')}
        <button>Créer</button></form>
        <div class="card"><h3>À venir</h3><table><tr><th>Événement</th><th>Date</th><th>Intéressés</th><th></th></tr>
        ${[...events.values()].sort((a, b) => a.scheduledStartTimestamp - b.scheduledStartTimestamp).map((e) => `<tr><td>${esc(e.name)}<br><span class="muted">${esc(e.entityMetadata?.location ?? '')}</span></td><td>${fmtDate(e.scheduledStartTimestamp)}</td><td>${e.userCount ?? '—'}</td>
          <td><form method="post">${csrf(sess)}${hidden('action', 'delete')}${hidden('id', e.id)}<button class="ghost" style="margin:0">Supprimer</button></form></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Aucun événement prévu.</td></tr>'}</table></div>`,
      };
    },
    async 'POST /evenements'(guild, sess, body) {
      if (body.get('action') === 'delete') {
        const ev = await guild.scheduledEvents.fetch(body.get('id')).catch(() => null);
        if (!ev) return '❌ Événement introuvable.';
        await ev.delete();
        return '🗑️ Événement supprimé.';
      }
      const start = require('./admin').parisDate(String(body.get('date') ?? ''));
      if (!start || start.getTime() < Date.now() + 60_000) return '❌ Date invalide ou passée (format JJ/MM/AAAA HH:MM).';
      const name = String(body.get('name') ?? '').trim().slice(0, 100);
      if (!name) return '❌ Titre manquant.';
      const location = String(body.get('location') ?? '').trim() || (process.env.TWITCH_CHANNEL ? `https://twitch.tv/${process.env.TWITCH_CHANNEL}` : 'Discord');
      const description = String(body.get('description') ?? '').slice(0, 1000);
      const event = await guild.scheduledEvents.create({
        name,
        scheduledStartTime: start,
        scheduledEndTime: new Date(start.getTime() + (int(body.get('hours'), 1, 72) ?? 2) * 3600_000),
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType: GuildScheduledEventEntityType.External,
        entityMetadata: { location },
        description,
        reason: `Tableau de bord : ${sess.username}`,
      });
      if (body.has('announce')) {
        const channel = findChannel(guild, 'announcements');
        const role = body.has('mention') ? require('./shared').findRole(guild, 'notif_news') : null;
        await channel
          ?.send({
            content: [role ? `${role}` : null, event.url].filter(Boolean).join(' '),
            allowedMentions: { roles: role ? [role.id] : [] },
            embeds: [
              new EmbedBuilder()
                .setColor(BRAND_COLOR)
                .setTitle(`🎌 ${name}`)
                .setURL(event.url)
                .setDescription(`${description}\n\n🗓️ <t:${Math.floor(start / 1000)}:F> (<t:${Math.floor(start / 1000)}:R>)\n📍 ${location}\n\nClique sur **Intéressé** dans l'événement pour être prévenu !`),
            ],
          })
          .catch(() => {});
      }
      return `🎌 Événement « ${name} » créé.`;
    },

    // ───────────────────────── Anniversaires ─────────────────────────
    async '/anniversaires'(guild, sess) {
      const b = settings.get('birthdays');
      const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
      const list = Object.entries(db.birthdays ?? {}).sort((x, y) => x[1].m - y[1].m || x[1].d - y[1].d);
      await fetchMembers(guild, list.map(([id]) => id));
      return {
        title: '🎂 Anniversaires',
        body: `<form method="post" class="card">${csrf(sess)}${hidden('action', 'settings')}
        ${checkbox('enabled', b.enabled, 'Souhaiter les anniversaires (à 9 h, dans 🍜┃discussion, rôle 🎂 pendant 24 h)')}
        <label>Cadeau (両)</label><input type="number" name="gift" value="${esc(b.gift)}" min="0" max="100000"><button>Enregistrer</button></form>
        <form method="post" class="card">${csrf(sess)}${hidden('action', 'add')}<h3>Ajouter / modifier</h3>
        <div class="row"><div><label>Membre (pseudo ou ID)</label><input type="text" name="member" required></div>
        <div><label>Jour</label><input type="number" name="d" min="1" max="31" required></div>
        <div><label>Mois</label><select name="m">${MONTHS.map((n, i) => `<option value="${i + 1}">${n}</option>`).join('')}</select></div></div><button>Enregistrer</button></form>
        <div class="card"><table><tr><th>Date</th><th>Membre</th><th></th></tr>
        ${list.map(([id, x]) => `<tr><td>${x.d} ${MONTHS[x.m - 1]}</td><td>${memberName(guild, id)}</td><td><form method="post">${csrf(sess)}${hidden('action', 'remove')}${hidden('id', id)}<button class="ghost" style="margin:0">Retirer</button></form></td></tr>`).join('') || '<tr><td colspan="3" class="muted">Aucun anniversaire enregistré.</td></tr>'}</table></div>`,
      };
    },
    async 'POST /anniversaires'(guild, sess, body) {
      const action = body.get('action');
      if (action === 'settings') {
        settings.set('birthdays.enabled', body.has('enabled'));
        const g = int(body.get('gift'), 0, 100000);
        if (g !== null) settings.set('birthdays.gift', g);
        return '✅ Enregistré.';
      }
      db.birthdays ??= {};
      if (action === 'remove') {
        delete db.birthdays[body.get('id')];
        save();
        return '🗑️ Anniversaire retiré.';
      }
      const member = await findMember(guild, body.get('member'));
      const m = int(body.get('m'), 1, 12);
      const d = int(body.get('d'), 1, [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][(m ?? 1) - 1]);
      if (!member || !m || !d) return '❌ Membre ou date invalide.';
      db.birthdays[member.id] = { d, m };
      save();
      return `🎂 ${member.displayName} : ${d}/${m}`;
    },

    // ───────────────────────── Suggestions ─────────────────────────
    async '/suggestions'(guild, sess) {
      const { STATUS } = require('./community');
      const list = Object.entries(db.suggestions ?? {}).sort((a, b) => b[1].at - a[1].at).slice(0, 40);
      await fetchMembers(guild, list.map(([, s]) => s.authorId));
      const btn = (id, status, label) => `<form method="post" class="inline">${csrf(sess)}${hidden('id', id)}${hidden('status', status)}<button class="ghost" style="margin:2px">${label}</button></form>`;
      return {
        title: '💡 Suggestions',
        body: `<div class="card"><p class="muted">Les membres postent dans 💡┃suggestions, le bot en fait une carte avec votes. Change le statut ici : l'auteur est prévenu en MP.</p>
        <table><tr><th>#</th><th>Suggestion</th><th>Votes</th><th>Statut</th><th></th></tr>
        ${list.map(([id, s]) => `<tr><td>${s.number}</td><td>${esc(s.text.slice(0, 300))}<br><span class="muted">${memberName(guild, s.authorId)} · ${fmtDate(s.at)}</span></td><td>👍 ${s.up.length}<br>👎 ${s.down.length}</td><td>${STATUS[s.status].label}</td>
          <td style="white-space:nowrap">${btn(id, 'accepted', '✅')}${btn(id, 'progress', '🔧')}${btn(id, 'denied', '❌')}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Aucune suggestion.</td></tr>'}</table></div>`,
      };
    },
    async 'POST /suggestions'(guild, sess, body) {
      const ok = await require('./community').setSuggestionStatus(guild, body.get('id'), body.get('status'), sess.userId);
      return ok ? '✅ Statut mis à jour.' : '❌ Suggestion introuvable.';
    },

    // ───────────────────────── Hall of Fame, vérification, vocal ─────────────────────────
    '/communaute'(guild, sess) {
      const h = settings.get('hallOfFame');
      const v = settings.get('voiceXp');
      return {
        title: '🏯 Hall of Fame, vérification & vocal',
        body: `<form method="post" class="card">${csrf(sess)}<h3>🏯 Hall of Fame</h3>
        <div class="row"><div><label>Emoji de réaction</label><input type="text" name="emoji" value="${esc(h.emoji)}" maxlength="8"></div>
        <div><label>Réactions nécessaires</label><input type="number" name="threshold" value="${esc(h.threshold)}" min="1" max="100"></div></div>
        <h3 style="margin-top:18px">✅ Vérification anti-bot</h3>${checkbox('captcha', settings.get('verification.captcha') !== false, 'Petit test (cliquer sur le bon emoji) avant de devenir ⚔️ Ronin')}
        <h3 style="margin-top:18px">🎙️ XP en vocal</h3>${checkbox('voice', v.enabled, 'Gagner de l\'XP en vocal (à 2 minimum, pas en sourdine ni en AFK)')}
        <label>XP par minute</label><input type="number" name="xp" value="${esc(v.xpPerMinute)}" min="1" max="100">
        <button>Enregistrer</button></form>`,
      };
    },
    async 'POST /communaute'(guild, sess, body) {
      const emoji = String(body.get('emoji') ?? '').trim();
      if (emoji) settings.set('hallOfFame.emoji', emoji);
      const t = int(body.get('threshold'), 1, 100);
      if (t !== null) settings.set('hallOfFame.threshold', t);
      settings.set('verification.captcha', body.has('captcha'));
      settings.set('voiceXp.enabled', body.has('voice'));
      const xp = int(body.get('xp'), 1, 100);
      if (xp !== null) settings.set('voiceXp.xpPerMinute', xp);
      return '✅ Enregistré.';
    },

    // ───────────────────────── Compteurs ─────────────────────────
    '/stats'(guild, sess) {
      const s = db.stats ?? {};
      const { fmt } = require('./stats');
      const row = (k, label) => `<div class="stat"><b>${fmt(s[k])}</b><span>${label}</span>${s[`${k}Error`] ? `<br><span class="muted">⚠️ ${esc(s[`${k}Error`])}</span>` : ''}</div>`;
      return {
        title: '📊 Compteurs',
        body: `<div class="grid">${row('discord', '👥 membres Discord')}${row('twitch', '🟣 followers Twitch')}${row('tiktok', '📱 abonnés TikTok')}</div>
        <p class="muted">Mis à jour ${s.updatedAt ? fmtDate(s.updatedAt) : 'jamais'} · automatiquement toutes les 10 minutes (limite Discord).</p>
        <form method="post" class="card">${csrf(sess)}${hidden('action', 'refresh')}<button>Mettre à jour maintenant</button></form>
        <form method="post" class="card">${csrf(sess)}${hidden('action', 'tiktok')}<h3>Valeur de secours TikTok</h3>
        <p class="muted">Utilisée si TikTok bloque la lecture automatique (0 = aucune).</p>
        <input type="number" name="value" value="${esc(s.tiktokManual ?? 0)}" min="0"><button>Enregistrer</button></form>`,
      };
    },
    async 'POST /stats'(guild, sess, body) {
      if (body.get('action') === 'tiktok') {
        const v = int(body.get('value'), 0, 1e10);
        db.stats ??= {};
        db.stats.tiktokManual = v || null;
        if (v) db.stats.tiktok = v;
        save();
      }
      await require('./stats').refresh(guild);
      return '📊 Compteurs mis à jour.';
    },

    // ───────────────────────── Musique ─────────────────────────
    '/musique'(guild, sess) {
      const q = require('./music').queues.get(guild.id);
      const { formatDuration } = require('./music');
      const btn = (action, label) => `<form method="post" class="inline">${csrf(sess)}${hidden('action', action)}<button class="ghost">${label}</button></form> `;
      return {
        title: '🎵 Musique',
        body: q?.current
          ? `<div class="card"><h3>🎶 En cours dans <span class="muted">#${esc(guild.channels.cache.get(q.channelId)?.name ?? '?')}</span></h3>
            <p><a href="${esc(q.current.url)}" style="color:#fff">${esc(q.current.title)}</a> · ${formatDuration(q.current.duration)}${q.loop ? ' · 🔂 en boucle' : ''}</p>
            ${btn('skip', '⏭️ Suivante')}${btn('pause', '⏯️ Pause / reprise')}${btn('loop', '🔂 Boucle')}${btn('stop', '⏹️ Arrêter')}</div>
            <div class="card"><h3>À suivre (${q.tracks.length})</h3><table>${q.tracks.slice(0, 30).map((t, n) => `<tr><td>${n + 1}</td><td>${esc(t.title)}</td><td>${formatDuration(t.duration)}</td><td>${memberName(guild, t.requestedBy)}</td></tr>`).join('') || '<tr><td class="muted">Rien.</td></tr>'}</table></div>`
          : '<div class="card"><p>Aucune musique en cours. Rejoins un vocal et tape <code>/play</code> dans Discord.</p></div>',
      };
    },
    async 'POST /musique'(guild, sess, body) {
      const q = require('./music').queues.get(guild.id);
      if (!q) return '❌ Pas de musique en cours.';
      const action = body.get('action');
      if (action === 'skip') q.skip();
      else if (action === 'stop') q.destroy();
      else if (action === 'loop') q.loop = !q.loop;
      else if (action === 'pause') (q.player.state.status === 'paused' ? q.player.unpause() : q.player.pause());
      return '✅ OK';
    },

    // ───────────────────────── Vocaux temporaires ─────────────────────────
    async '/vocaux'(guild, sess) {
      const list = Object.entries(db.tempVoice ?? {}).map(([id, v]) => ({ id, ...v, channel: guild.channels.cache.get(id) })).filter((v) => v.channel);
      await fetchMembers(guild, list.map((v) => v.ownerId));
      return {
        title: '🔊 Vocaux temporaires',
        body: `<div class="card"><p class="muted">Créés quand quelqu'un rejoint « ➕ Créer ton vocal », supprimés automatiquement quand ils sont vides.</p>
        <table><tr><th>Salon</th><th>Propriétaire</th><th>Membres</th><th>Accès</th><th></th></tr>
        ${list.map((v) => `<tr><td>${esc(v.channel.name)}</td><td>${memberName(guild, v.ownerId)}</td><td>${v.channel.members.filter((m) => !m.user.bot).size}</td><td>${v.locked ? '🔒 fermé' : '🔓 libre'}</td>
          <td><form method="post">${csrf(sess)}${hidden('id', v.id)}<button class="ghost" style="margin:0">Supprimer</button></form></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Aucun vocal temporaire ouvert.</td></tr>'}</table></div>`,
      };
    },
    async 'POST /vocaux'(guild, sess, body) {
      const id = body.get('id');
      if (!db.tempVoice?.[id]) return '❌ Ce n\'est pas un vocal temporaire.';
      await guild.channels.cache.get(id)?.delete(`Tableau de bord : ${sess.username}`).catch(() => {});
      delete db.tempVoice[id];
      save();
      return '🗑️ Vocal supprimé.';
    },

    // ───────────────────────── AutoMod ─────────────────────────
    async '/automod'(guild, sess) {
      const am = require('./automod');
      const rules = await guild.autoModerationRules.fetch().catch(() => new Map());
      const fromConfig = new Set(config.automod?.blockedWords ?? []);
      return {
        title: '🤖 AutoMod Discord',
        body: `<div class="card"><p class="muted">Règles appliquées par Discord lui-même, même quand le bot est éteint. Les modos ne sont pas concernés. Alertes dans 📋┃logs.</p>
        <table><tr><th>Règle</th><th>État</th></tr>${[...rules.values()].map((r) => `<tr><td>${esc(r.name)}</td><td>${r.enabled ? '✅ active' : '⛔ désactivée'}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">Aucune règle : clique sur « Appliquer ».</td></tr>'}</table></div>
        <form method="post" class="card">${csrf(sess)}${hidden('action', 'save')}<h3>Mots interdits</h3>
        ${checkbox('enabled', settings.get('automod.enabled') !== false, 'Règles AutoMod « Ronin » actives')}
        <p class="muted">De base (config/server.js) : ${[...fromConfig].map((w) => `<code>${esc(w)}</code>`).join(' ') || '—'}</p>
        <label>Mots ajoutés (un par ligne, * = joker, ex : *arnaque*)</label><textarea name="words">${esc((settings.get('automod.extraWords') ?? []).join('\n'))}</textarea>
        <button>Enregistrer et appliquer</button></form>`,
      };
    },
    async 'POST /automod'(guild, sess, body) {
      const am = require('./automod');
      const words = [...new Set(String(body.get('words') ?? '').split('\n').map((w) => w.trim().toLowerCase()).filter((w) => w && w.length <= 60))];
      settings.set('automod.extraWords', words);
      if (!body.has('enabled')) {
        settings.set('automod.enabled', false);
        await am.disableAutoMod(guild);
        return '⛔ AutoMod Ronin désactivé.';
      }
      settings.set('automod.enabled', true);
      const lines = [];
      await am.ensureAutoMod(guild, (l) => lines.push(l.trim()));
      const errors = lines.filter((l) => l.startsWith('⚠'));
      return errors.length ? `❌ ${errors.join(' · ')}` : `✅ ${words.length} mot(s) ajouté(s), règles à jour.`;
    },

    // ───────────────────────── Graphiques ─────────────────────────
    '/graphiques'(guild, sess, query) {
      const { lineChart, dataTable, fmt } = require('./charts');
      const days = [7, 30, 90].includes(Number(query.get('jours'))) ? Number(query.get('jours')) : 30;
      const pts = require('./history').series(days);
      const last = (k) => [...pts].reverse().find((p) => typeof p[k] === 'number')?.[k];
      const first = (k) => pts.find((p) => typeof p[k] === 'number')?.[k];
      const sum = (k) => pts.reduce((n, p) => n + (p[k] ?? 0), 0);
      const delta = (k) => {
        const a = first(k);
        const b = last(k);
        if (a === undefined || b === undefined) return '';
        const d = b - a;
        return `<span class="muted">${d >= 0 ? '+' : ''}${fmt(d)} sur ${days} j</span>`;
      };
      const tile = (v, label, extra = '') => `<div class="stat"><b>${v}</b><span>${label}</span>${extra ? `<br>${extra}` : ''}</div>`;
      const chart = (title, series, opts = {}) =>
        `<div class="card"><h3>${title}</h3>${lineChart({ points: pts, series, ...opts })}${dataTable(pts, series)}</div>`;
      const range = [7, 30, 90].map((d) => `<a class="btn ${d === days ? '' : 'ghost'}" style="margin:0 4px 0 0" href="/graphiques?jours=${d}">${d} jours</a>`).join('');
      return {
        title: '📈 Graphiques',
        body: `<div style="margin-bottom:14px">${range}</div>
        <div class="grid">${tile(fmt(last('discord')), '👥 membres', delta('discord'))}${tile(fmt(last('twitch')), '🟣 followers Twitch', delta('twitch'))}${tile(fmt(last('tiktok')), '📱 abonnés TikTok', delta('tiktok'))}${tile(fmt(sum('messages')), `💬 messages (${days} j)`)}${tile(fmt(Math.round(sum('voice') / 60)), `🎙️ heures de vocal (${days} j)`)}</div>
        <p class="muted">Survole un graphique pour voir la valeur de chaque jour. Les données s'accumulent depuis l'installation de cette version.</p>
        ${chart('👥 Membres du serveur', [{ key: 'discord', label: 'Membres' }], { zeroBased: false })}
        ${chart('🟣 Followers Twitch', [{ key: 'twitch', label: 'Followers' }], { zeroBased: false })}
        ${chart('📱 Abonnés TikTok', [{ key: 'tiktok', label: 'Abonnés' }], { zeroBased: false })}
        ${chart('💬 Messages par jour', [{ key: 'messages', label: 'Messages' }])}
        ${chart('🎙️ Minutes de vocal par jour', [{ key: 'voice', label: 'Minutes' }], { unit: ' min' })}
        ${chart('🚪 Arrivées et départs par jour', [{ key: 'joins', label: 'Arrivées' }, { key: 'leaves', label: 'Départs' }])}`,
      };
    },

    // ───────────────────────── Saisons ─────────────────────────
    async '/saisons'(guild, sess) {
      const seasons = require('./seasons');
      const cur = seasons.top(25);
      const hist = db.seasonsHistory ?? [];
      await fetchMembers(guild, [...cur.map((p) => p.userId), ...hist.flatMap((h) => h.top.slice(0, 3).map((p) => p.userId))]);
      const s = settings.get('seasons');
      const medals = ['🥇', '🥈', '🥉'];
      return {
        title: '🏆 Saisons du mois',
        body: `<form method="post" class="card">${csrf(sess)}${hidden('action', 'settings')}
        ${checkbox('enabled', s.enabled !== false, 'Saisons activées (podium le 1er du mois, rôle 🏆 Champion du mois)')}
        <div class="row">${[0, 1, 2].map((n) => `<div><label>Récompense ${medals[n]} (両)</label><input type="number" name="r${n}" value="${esc(s.rewards?.[n] ?? 0)}" min="0" max="1000000"></div>`).join('')}</div>
        <button>Enregistrer</button></form>
        <div class="card"><h3>Saison de ${esc(seasons.monthName(db.season?.month ?? new Date().toISOString().slice(0, 7)))}</h3><table><tr><th>#</th><th>Membre</th><th>XP du mois</th></tr>
        ${cur.map((p, n) => `<tr><td>${medals[n] ?? n + 1}</td><td>${memberName(guild, p.userId)}</td><td>${p.xp.toLocaleString('fr-FR')}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Personne n\'a encore gagné d\'XP ce mois-ci.</td></tr>'}</table></div>
        <div class="card"><h3>Saisons passées</h3><table><tr><th>Mois</th><th>Podium</th></tr>
        ${hist.map((h) => `<tr><td>${esc(seasons.monthName(h.month))}</td><td>${h.top.slice(0, 3).map((p, n) => `${medals[n]} ${memberName(guild, p.userId)} (${p.xp.toLocaleString('fr-FR')} XP)`).join('<br>')}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">Aucune saison terminée pour l\'instant.</td></tr>'}</table></div>`,
      };
    },
    async 'POST /saisons'(guild, sess, body) {
      settings.set('seasons.enabled', body.has('enabled'));
      settings.set('seasons.rewards', [0, 1, 2].map((n) => int(body.get(`r${n}`), 0, 1000000) ?? 0));
      return '✅ Saisons enregistrées.';
    },

    // ───────────────────────── Commandes personnalisées ─────────────────────────
    '/commandes'(guild, sess) {
      const custom = require('./custom');
      const list = Object.entries(db.customCommands ?? {}).sort();
      return {
        title: '⌨️ Commandes personnalisées',
        body: `<form method="post" class="card">${csrf(sess)}${hidden('action', 'save')}<h3>Créer / modifier</h3>
        <div class="row"><div><label>Nom (sans le préfixe)</label><input type="text" name="name" maxlength="32" placeholder="discord" required></div>
        <div><label>Préfixe</label><input type="text" name="prefix" value="${esc(custom.PREFIX())}" maxlength="3"></div></div>
        <label>Réponse — <code>{user}</code> = la personne, <code>{server}</code> = le serveur</label><textarea name="response" maxlength="2000" required placeholder="Rejoins le Discord : https://discord.gg/…"></textarea>
        ${checkbox('embed', false, 'Réponse dans un encadré')}<button>Enregistrer</button></form>
        <div class="card"><table><tr><th>Commande</th><th>Réponse</th><th>Utilisations</th><th></th></tr>
        ${list.map(([n, c]) => `<tr><td><code>${esc(custom.PREFIX())}${esc(n)}</code></td><td>${esc(c.response.slice(0, 200))}</td><td>${c.uses ?? 0}</td>
          <td><form method="post">${csrf(sess)}${hidden('action', 'delete')}${hidden('name', n)}<button class="ghost" style="margin:0">Supprimer</button></form></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Aucune commande. Exemples : !discord, !planning, !reseaux, !setup.</td></tr>'}</table></div>`,
      };
    },
    async 'POST /commandes'(guild, sess, body) {
      const custom = require('./custom');
      if (body.get('action') === 'delete') return custom.deleteCommand(body.get('name')) ? '🗑️ Commande supprimée.' : '❌ Introuvable.';
      const prefix = String(body.get('prefix') ?? '').trim();
      if (prefix && prefix.length <= 3 && !/\s/.test(prefix)) {
        db.customPrefix = prefix;
        save();
      }
      const n = custom.setCommand(body.get('name'), String(body.get('response') ?? ''), body.has('embed'));
      return n ? `✅ ${custom.PREFIX()}${n} enregistrée.` : '❌ Nom ou réponse invalide.';
    },

    // ───────────────────────── Menus de rôles ─────────────────────────
    '/menus-roles'(guild, sess) {
      const custom = require('./custom');
      const roles = guild.roles.cache.filter((r) => custom.safeRole(r)).sort((a, b) => b.position - a.position);
      const list = Object.entries(db.roleMenus ?? {});
      return {
        title: '🎭 Menus de rôles',
        body: `<form method="post" class="card">${csrf(sess)}${hidden('action', 'create')}<h3>Nouveau menu</h3>
        <p class="muted">Un message avec des boutons : chacun prend ou enlève lui-même les rôles choisis (jeux, plateformes, régions…). Seuls les rôles sans permission de modération et sous le rôle du bot sont proposés.</p>
        <div class="row"><div><label>Salon</label>${channelSelect(guild, 'channel', findChannel(guild, 'roles')?.id)}</div><div><label>Titre</label><input type="text" name="title" maxlength="200" value="🎮 Tes jeux" required></div></div>
        <label>Description</label><textarea name="description" maxlength="2000" placeholder="Choisis les jeux auxquels tu joues pour trouver des coéquipiers !"></textarea>
        <label>Rôles (25 max) et emoji facultatif</label>
        <table>${roles.map((r) => `<tr><td style="width:32px"><input type="checkbox" name="role" value="${r.id}"></td><td>${esc(r.name)}</td><td style="width:110px"><input type="text" name="emoji_${r.id}" maxlength="8" placeholder="emoji"></td></tr>`).join('') || '<tr><td class="muted">Aucun rôle utilisable : crée d\'abord des rôles (ex : « 🎮 Valorant ») dans Discord.</td></tr>'}</table>
        ${checkbox('exclusive', false, 'Un seul rôle à la fois dans ce menu')}<button>Publier le menu</button></form>
        <div class="card"><h3>Menus publiés</h3><table><tr><th>Titre</th><th>Salon</th><th>Rôles</th><th></th></tr>
        ${list.map(([id, m]) => `<tr><td>${esc(m.title)}</td><td>#${esc(guild.channels.cache.get(m.channelId)?.name ?? '?')}</td><td>${m.roles.map((r) => `${esc(r.emoji ?? '')} ${esc(guild.roles.cache.get(r.roleId)?.name ?? '?')}`).join('<br>')}</td>
          <td><form method="post">${csrf(sess)}${hidden('action', 'delete')}${hidden('id', id)}<button class="ghost" style="margin:0">Supprimer</button></form></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Aucun menu.</td></tr>'}</table></div>`,
      };
    },
    async 'POST /menus-roles'(guild, sess, body) {
      const custom = require('./custom');
      if (body.get('action') === 'delete') return (await custom.deleteMenu(guild, body.get('id'))) ? '🗑️ Menu supprimé.' : '❌ Introuvable.';
      const roles = body.getAll('role').map((roleId) => ({ roleId, emoji: String(body.get(`emoji_${roleId}`) ?? '').trim().slice(0, 8) || null }));
      if (!roles.length) return '❌ Choisis au moins un rôle.';
      await custom.publishMenu(guild, { channelId: body.get('channel'), title: body.get('title') || 'Rôles', description: body.get('description'), roles, exclusive: body.has('exclusive') });
      return '✅ Menu publié.';
    },

    // ───────────────────────── État du bot ─────────────────────────
    '/statut'(guild, sess) {
      const s = require('./health').status(guild.client);
      const up = Math.floor(s.uptime / 60000);
      return {
        title: '🩺 État du bot',
        body: `<div class="grid">
          <div class="stat"><b>${s.ok ? '✅' : '❌'}</b><span>${s.ok ? 'connecté à Discord' : 'déconnecté'}</span></div>
          <div class="stat"><b>${up >= 1440 ? `${Math.floor(up / 1440)} j` : up >= 60 ? `${Math.floor(up / 60)} h` : `${up} min`}</b><span>en marche</span></div>
          <div class="stat"><b>${s.ping} ms</b><span>latence</span></div>
          <div class="stat"><b>${s.memoryMb} Mo</b><span>mémoire</span></div></div>
        <div class="card" style="margin-top:16px"><table>
          <tr><td>Version</td><td><code>${esc(s.version.sha)}</code> ${esc(s.version.subject.slice(0, 120))}${s.version.date ? ` <span class="muted">(${fmtDate(new Date(s.version.date))})</span>` : ''}</td></tr>
          <tr><td>Node.js</td><td>${esc(s.node)}</td></tr>
          <tr><td>Base de données</td><td>${s.dbKb} Ko</td></tr>
          <tr><td>Dernière sauvegarde du serveur</td><td>${s.lastBackup ? fmtDate(s.lastBackup) : 'jamais'}</td></tr>
          <tr><td>Dernière copie de la base (💾┃sauvegardes)</td><td>${s.lastOffsite ? fmtDate(s.lastOffsite) : 'jamais'}</td></tr></table></div>
        <form method="post" class="card">${csrf(sess)}<h3>📦 Copie de la base</h3><p class="muted">Envoie tout de suite une copie compressée de la base dans 💾┃sauvegardes.</p><button class="ghost">Envoyer une copie</button></form>
        <div class="card"><h3>Surveillance</h3><p class="muted">Pour être prévenu par mail si le bot tombe : crée une sonde gratuite sur UptimeRobot vers <code>${esc((process.env.DASHBOARD_URL || 'http://localhost:3000').replace(/\/$/, ''))}/health</code> (le site doit être accessible depuis Internet).</p></div>`,
      };
    },
    async 'POST /statut'(guild) {
      const name = await require('./backup').offsiteBackup(guild, { force: true });
      return name ? `📦 Copie ${name} envoyée.` : '❌ Salon 💾┃sauvegardes introuvable (lance la construction) ou base trop lourde.';
    },
  };
};
