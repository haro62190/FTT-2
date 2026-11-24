/**
 * Pages « gestion » du tableau de bord :
 * 🏆 Tournois · 🌙 Soirées & défis · 👥 Équipes & inscriptions · 📊 Stats Twitch + Discord · 🔔 Centre d'alertes
 * ✉️ Éditeur de messages (aperçu en direct) · 🎬 Galerie de clips
 */
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder } = require('discord.js');
const settings = require('./settings');
const { db, save } = require('./store');

module.exports = ({ esc, csrf, checkbox, fetchMembers, memberName, fmtDate }) => {
  const hidden = (name, value) => `<input type="hidden" name="${name}" value="${esc(value)}">`;
  const inlineBtn = (sess, fields, label, cls = 'ghost') => `<form method="post" class="inline">${csrf(sess)}${Object.entries(fields).map(([k, v]) => hidden(k, v)).join('')}<button class="${cls}" style="margin:0 4px 0 0">${label}</button></form>`;
  const parseDate = (s) => (s ? require('./admin').parisDate(String(s).replace('T', ' ').replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3/$2/$1')) : null);
  const textChannels = (guild) => guild.channels.cache.filter((c) => [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(c.type)).sort((a, b) => a.rawPosition - b.rawPosition);
  const n = (x) => (x === null || x === undefined ? '—' : Math.round(x).toLocaleString('fr-FR'));

  return {
    // ───────────────────────── Tournois ─────────────────────────
    async '/tournois'(guild, sess) {
      const tn = require('./tournaments');
      const list = Object.values(tn.all()).sort((a, b) => b.createdAt - a.createdAt);
      await fetchMembers(guild, list.flatMap((t) => t.entrants.flatMap((e) => e.members)).slice(0, 200));
      const card = (t) => {
        const pend = t.status === 'running' ? tn.pending(t) : [];
        const bracket =
          t.status === 'open'
            ? ''
            : `<div style="display:flex;gap:14px;overflow-x:auto;margin-top:10px">${t.rounds
                .map((round, r) => `<div style="min-width:190px"><div class="muted" style="font-size:12px;margin-bottom:6px">${esc(tn.roundName(t, r))}</div>${round
                  .filter((m) => r > 0 || m.a || m.b)
                  .map((m) => `<div class="card" style="padding:8px 10px;margin-bottom:8px"><div style="${m.winner === m.a && m.a ? 'color:var(--gold);font-weight:700' : ''}">${esc(m.a ? tn.entrantName(t, m.a) : r ? 'à déterminer' : 'exempt')}</div><div style="${m.winner === m.b && m.b ? 'color:var(--gold);font-weight:700' : ''}">${esc(m.b ? tn.entrantName(t, m.b) : r ? 'à déterminer' : 'exempt')}</div></div>`)
                  .join('')}</div>`)
                .join('')}</div>`;
        return `<div class="card"><h3>🏆 ${esc(t.name)} <span class="badge">${esc(tn.STATUS[t.status])}</span></h3>
          <p class="muted">🎮 ${esc(t.game)} · ${t.teamSize === 1 ? 'solo' : `équipes de ${t.teamSize}`} · ${t.entrants.length}/${t.max} inscrits${t.startsAt ? ` · début ${fmtDate(t.startsAt)}` : ''}${t.prize ? ` · prix ${t.prize} 両` : ''}</p>
          ${t.status === 'open' ? `<p>${t.entrants.map((e) => esc(e.name)).join(' · ') || '<span class="muted">Aucun inscrit</span>'}</p>${inlineBtn(sess, { action: 'start', id: t.id }, '⚔️ Lancer le tableau', '')}` : ''}
          ${pend.length ? `<table><tr><th>Match à jouer</th><th>Gagnant</th></tr>${pend.map((m) => `<tr><td><code>${esc(m.id)}</code> ${esc(tn.entrantName(t, m.a))} vs ${esc(tn.entrantName(t, m.b))}</td><td>${inlineBtn(sess, { action: 'win', id: t.id, match: m.id, winner: m.a }, esc(tn.entrantName(t, m.a)))}${inlineBtn(sess, { action: 'win', id: t.id, match: m.id, winner: m.b }, esc(tn.entrantName(t, m.b)))}</td></tr>`).join('')}</table>` : ''}
          ${bracket}
          ${t.status === 'open' || t.status === 'running' ? `<div style="margin-top:10px">${inlineBtn(sess, { action: 'cancel', id: t.id }, '⛔ Annuler')}</div>` : ''}</div>`;
      };
      const games = Object.values(db.ratings ?? {});
      return {
        title: '🏆 Tournois',
        body: `<form method="post" class="card">${csrf(sess)}${hidden('action', 'create')}<h3>➕ Nouveau tournoi</h3>
        <div class="row"><div><label>Nom</label><input type="text" name="name" maxlength="80" required></div><div><label>Jeu</label><input type="text" name="game" maxlength="40" required></div></div>
        <div class="row"><div><label>Joueurs par équipe</label><input type="number" name="teamSize" min="1" max="5" value="1"></div><div><label>Places</label><input type="number" name="max" min="2" max="64" value="16"></div>
        <div><label>Début</label><input type="datetime-local" name="date"></div><div><label>Prix (両)</label><input type="number" name="prize" min="0" value="0"></div></div>
        <button>Créer et publier</button></form>
        ${list.map(card).join('') || '<p class="muted">Aucun tournoi pour l\'instant.</p>'}
        <div class="card"><h3>📈 Classements Elo par jeu</h3>${games.length ? games.map((g) => `<h3 style="margin-top:12px">${esc(g.name)}</h3><table><tr><th>#</th><th>Joueur</th><th>Elo</th><th>V / D</th></tr>${require('./gaming').leaderboard(g.name, 10).map((r, k) => `<tr><td>${k + 1}</td><td>${memberName(guild, r.userId)}</td><td>${r.elo}</td><td>${r.w} / ${r.l}</td></tr>`).join('')}</table>`).join('') : '<p class="muted">Aucun match classé : les matchs de tournoi et /match alimentent l\'Elo.</p>'}</div>`,
      };
    },
    async 'POST /tournois'(guild, sess, body) {
      const tn = require('./tournaments');
      const action = body.get('action');
      if (action === 'create') {
        const date = body.get('date') ? parseDate(body.get('date')) : null;
        const t = tn.create({ name: body.get('name'), game: body.get('game'), teamSize: Number(body.get('teamSize')) || 1, max: Number(body.get('max')) || 16, startsAt: date?.getTime() ?? null, prize: Number(body.get('prize')) || 0, by: sess.userId });
        await tn.publish(guild, t).catch(() => {});
        return `✅ Tournoi ${t.name} créé et publié dans 🏆┃tournois.`;
      }
      const t = tn.all()[body.get('id')];
      if (!t) return '❌ Tournoi introuvable.';
      if (action === 'start') {
        tn.start(t);
        await tn.publish(guild, t).catch(() => {});
        return '✅ Tableau généré et publié.';
      }
      if (action === 'win') {
        const champ = await tn.report(guild, t, body.get('match'), body.get('winner'));
        return champ ? `👑 ${tn.entrantName(t, champ)} remporte ${t.name} !` : '✅ Résultat enregistré.';
      }
      if (action === 'cancel') {
        t.status = 'cancelled';
        save();
        await tn.publish(guild, t).catch(() => {});
        return '⛔ Tournoi annulé.';
      }
      return 'Action inconnue.';
    },

    // ───────────────────────── Soirées, défis, calendrier ─────────────────────────
    async '/soirees'(guild, sess) {
      const nights = Object.values(require('./nights').all()).sort((a, b) => a.startsAt - b.startsAt);
      const ch = require('./challenges');
      const items = await require('./nights').upcoming(guild, 30);
      return {
        title: '🌙 Soirées, défis & calendrier',
        body: `<div class="row">
        <form method="post" class="card">${csrf(sess)}${hidden('action', 'night')}<h3>🌙 Nouvelle soirée gaming</h3>
        <label>Titre</label><input type="text" name="title" maxlength="80" required><label>Jeu</label><input type="text" name="game" maxlength="40">
        <div class="row"><div><label>Date</label><input type="datetime-local" name="date" required></div><div><label>Places</label><input type="number" name="seats" min="1" max="100" value="10"></div></div>
        <button>Publier avec réservations</button></form>
        <form method="post" class="card">${csrf(sess)}${hidden('action', 'challenge')}<h3>🎯 Nouveau défi collectif</h3>
        <label>Titre</label><input type="text" name="title" maxlength="100" required>
        <div class="row"><div><label>Ce qui compte</label><select name="type">${Object.entries(ch.TYPES).map(([k, [e, l]]) => `<option value="${k}">${e} ${esc(l)}</option>`).join('')}</select></div><div><label>Objectif</label><input type="number" name="target" min="1" value="1000"></div></div>
        <div class="row"><div><label>Jours</label><input type="number" name="days" min="1" max="60" value="7"></div><div><label>Ryō par participant</label><input type="number" name="reward" min="0" value="200"></div></div>
        <button>Lancer le défi</button></form></div>
        <div class="card"><h3>🗓️ Calendrier des 30 prochains jours</h3><table><tr><th>Quand</th><th></th><th>Quoi</th></tr>${items.map((x) => `<tr><td style="white-space:nowrap">${fmtDate(x.at)}</td><td>${esc(x.icon)}</td><td>${esc(x.text.replace(/<@(\d+)>/g, (_, id) => guild.members.cache.get(id)?.displayName ?? 'un membre'))}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Rien de prévu.</td></tr>'}</table></div>
        <div class="card"><h3>🌙 Soirées</h3><table><tr><th>Soirée</th><th>Quand</th><th>Places</th><th>Attente</th></tr>${nights.map((x) => `<tr><td><b>${esc(x.title)}</b><br><span class="muted">${esc(x.game)}</span></td><td>${fmtDate(x.startsAt)}</td><td>${x.booked.length}/${x.seats}</td><td>${x.waitlist.length}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Aucune soirée.</td></tr>'}</table></div>
        <div class="card"><h3>🎯 Défis collectifs</h3><table><tr><th>Défi</th><th>Progression</th><th>Fin</th><th>État</th></tr>${Object.values(ch.all()).sort((a, b) => b.startedAt - a.startedAt).slice(0, 20).map((c) => `<tr><td>${esc(c.title)}</td><td>${n(Math.min(c.progress, c.target))} / ${n(c.target)} ${esc(ch.TYPES[c.type][1])}</td><td>${fmtDate(c.endsAt)}</td><td>${c.done ? '✅ réussi' : c.failed ? '❌ raté' : '⏳ en cours'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Aucun défi.</td></tr>'}</table></div>`,
      };
    },
    async 'POST /soirees'(guild, sess, body) {
      if (body.get('action') === 'challenge') {
        const ch = require('./challenges');
        const c = ch.create({ title: body.get('title'), type: body.get('type'), target: Number(body.get('target')) || 100, days: Math.min(60, Number(body.get('days')) || 7), reward: Number(body.get('reward')) || 0, by: sess.userId });
        await ch.publish(guild, c).catch(() => {});
        return `✅ Défi « ${c.title} » lancé et annoncé.`;
      }
      const date = parseDate(body.get('date'));
      if (!date || date.getTime() < Date.now()) return '❌ Date invalide ou passée.';
      const nt = require('./nights');
      const night = nt.create({ title: body.get('title'), game: body.get('game') ?? '', startsAt: date.getTime(), seats: Math.min(100, Number(body.get('seats')) || 10), by: sess.userId });
      await nt.publish(guild, night).catch(() => {});
      return `✅ Soirée « ${night.title} » publiée dans 🌙┃soirées-gaming.`;
    },

    // ───────────────────────── Équipes & inscriptions ─────────────────────────
    async '/equipes'(guild, sess) {
      const tn = require('./tournaments');
      const open = Object.values(tn.all()).filter((t) => t.status === 'open');
      const nights = Object.values(require('./nights').all()).filter((x) => x.startsAt > Date.now() - 3 * 3600_000);
      const lfg = Object.values(db.lfg ?? {}).filter((l) => !l.closed && l.expiresAt > Date.now());
      const players = Object.entries(db.players ?? {});
      await fetchMembers(guild, [...open.flatMap((t) => t.entrants.flatMap((e) => e.members)), ...nights.flatMap((x) => [...x.booked, ...x.waitlist]), ...players.map(([id]) => id)].slice(0, 300));
      const g = require('./gaming');
      return {
        title: '👥 Équipes & inscriptions',
        body: `<div class="card"><h3>🏆 Inscriptions aux tournois ouverts</h3>${open
          .map((t) => `<h3 style="margin-top:12px">${esc(t.name)} <span class="muted" style="font-weight:400">${t.entrants.length}/${t.max}</span></h3><table><tr><th>Équipe</th><th>Joueurs</th><th></th></tr>${t.entrants.map((e) => `<tr><td>${esc(e.name)}</td><td>${e.members.map((id) => memberName(guild, id)).join(', ')}</td><td>${inlineBtn(sess, { action: 'unregister', id: t.id, user: e.members[0] }, 'Retirer')}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Aucun inscrit.</td></tr>'}</table>`)
          .join('') || '<p class="muted">Aucun tournoi en inscription.</p>'}</div>
        <div class="card"><h3>🌙 Réservations des soirées</h3>${nights
          .map((x) => `<h3 style="margin-top:12px">${esc(x.title)} <span class="muted" style="font-weight:400">${fmtDate(x.startsAt)} · ${x.booked.length}/${x.seats}</span></h3><table><tr><th>Membre</th><th>Statut</th><th></th></tr>${[...x.booked.map((id) => [id, '🎟️ réservé']), ...x.waitlist.map((id) => [id, '⏳ attente'])].map(([id, st]) => `<tr><td>${memberName(guild, id)}</td><td>${st}</td><td>${inlineBtn(sess, { action: 'unbook', id: x.id, user: id }, 'Retirer')}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Aucune réservation.</td></tr>'}</table>`)
          .join('') || '<p class="muted">Aucune soirée à venir.</p>'}</div>
        <div class="card"><h3>🎮 Recherches de joueurs en cours</h3><table><tr><th>Jeu</th><th>Par</th><th>Équipe</th><th>Fin</th></tr>${lfg.map((l) => `<tr><td>${esc(l.game)}</td><td>${memberName(guild, l.author)}</td><td>${l.joined.length + 1}/${l.slots + 1}</td><td>${fmtDate(l.expiresAt)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Aucune recherche active.</td></tr>'}</table></div>
        <div class="card"><h3>🕹️ Profils joueurs (${players.length})</h3><table><tr><th>Membre</th><th>Plateformes</th><th>Jeux</th><th>Dispos</th></tr>${players.slice(0, 100).map(([id, p]) => `<tr><td>${memberName(guild, id)}</td><td>${esc(p.platforms.map((k) => g.PLATFORMS.find(([x]) => x === k)?.[1] ?? k).join(', '))}</td><td>${esc(p.games.join(', '))}</td><td>${esc(p.availability.map((k) => g.AVAIL.find(([x]) => x === k)?.[1] ?? k).join(', '))}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Aucun profil : /joueur profil</td></tr>'}</table></div>`,
      };
    },
    async 'POST /equipes'(guild, sess, body) {
      if (body.get('action') === 'unregister') {
        const tn = require('./tournaments');
        const t = tn.all()[body.get('id')];
        if (!t) return '❌ Tournoi introuvable.';
        const e = tn.unregister(t, body.get('user'));
        await tn.publish(guild, t).catch(() => {});
        return `✅ ${e.name} retiré du tournoi.`;
      }
      if (body.get('action') === 'unbook') {
        const nt = require('./nights');
        const x = nt.all()[body.get('id')];
        if (!x) return '❌ Soirée introuvable.';
        const promoted = nt.cancel(x, body.get('user'));
        if (promoted) guild.client.users.send(promoted, `🎟️ Une place s'est libérée : tu participes à **${x.title}** !`).catch(() => {});
        await nt.publish(guild, x).catch(() => {});
        return '✅ Réservation retirée.';
      }
      return 'Action inconnue.';
    },

    // ───────────────────────── Statistiques Twitch + Discord ─────────────────────────
    '/stats-reunies'(guild, sess, query) {
      const { lineChart, dataTable } = require('./charts');
      const days = [30, 90].includes(Number(query.get('jours'))) ? Number(query.get('jours')) : 30;
      const pts = require('./history').series(days);
      const streams = require('./streams').list().filter((s) => s.endedAt > Date.now() - days * 86_400_000);
      const liveDays = new Set(streams.map((s) => new Date(s.startedAt).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' })));
      const avg = (list, k) => (list.length ? list.reduce((s, p) => s + (p[k] ?? 0), 0) / list.length : null);
      const onLive = pts.filter((p) => liveDays.has(p.date));
      const offLive = pts.filter((p) => !liveDays.has(p.date));
      const effect = (k) => {
        const a = avg(onLive, k);
        const b = avg(offLive, k);
        return a !== null && b ? `${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)} %` : '—';
      };
      const tile = (v, label) => `<div class="stat"><b>${v}</b><span>${label}</span></div>`;
      const last = (k) => [...pts].reverse().find((p) => typeof p[k] === 'number')?.[k];
      const range = [30, 90].map((d) => `<a class="btn ${d === days ? '' : 'ghost'}" style="margin:0 4px 0 0" href="/stats-reunies?jours=${d}">${d} jours</a>`).join('');
      return {
        title: '📊 Stats Twitch + Discord',
        body: `<div style="margin-bottom:14px">${range}</div>
        <div class="grid">${tile(n(last('discord')), '👥 membres Discord')}${tile(n(last('twitch')), '🟣 followers Twitch')}${tile(n(last('tiktok')), '📱 abonnés TikTok')}${tile(streams.length, `📺 lives (${days} j)`)}${tile(effect('messages'), '💬 messages les jours de live')}${tile(effect('joins'), '🚪 arrivées les jours de live')}</div>
        <p class="muted">« Les jours de live » : moyenne des jours avec un live comparée aux autres jours de la période.</p>
        <div class="card"><h3>👥 Membres Discord et 🟣 followers Twitch</h3>${lineChart({ points: pts, series: [{ key: 'discord', label: 'Membres' }, { key: 'twitch', label: 'Followers' }], zeroBased: false })}${dataTable(pts, [{ key: 'discord', label: 'Membres' }, { key: 'twitch', label: 'Followers' }])}</div>
        <div class="card"><h3>📺 Chaque live et l'activité du Discord</h3><table><tr><th>Live</th><th>Durée</th><th>Viewers</th><th>Followers</th><th>Messages Discord pendant le live</th><th>Moments forts</th></tr>${streams.map((s) => `<tr><td>${fmtDate(s.startedAt)}<br><span class="muted">${esc((s.title ?? '').slice(0, 60))}</span></td><td>${require('./streams').fmtDuration(s.durationMin)}</td><td>${s.peak ? `pic ${s.peak}` : '—'}${s.avg ? `<br><span class="muted">moy. ${s.avg}</span>` : ''}</td><td>${s.followersGained == null ? '—' : `${s.followersGained >= 0 ? '+' : ''}${s.followersGained}`}</td><td>${n(s.discordMessages ?? null)}</td><td>${s.highlights?.length ?? 0}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Aucun live sur la période.</td></tr>'}</table></div>`,
      };
    },

    // ───────────────────────── Centre d'alertes ─────────────────────────
    async '/alertes'(guild, sess) {
      const rp = require('./reports');
      const ap = require('./applications');
      const reports = Object.values(rp.all()).filter((r) => r.status === 'open' || r.status === 'claimed').sort((a, b) => a.at - b.at);
      const apps = Object.values(ap.all()).filter((a) => a.status === 'pending').sort((a, b) => a.at - b.at);
      const tickets = Object.keys(db.tickets?.open ?? {}).length;
      const quarantined = Object.entries(db.quarantine ?? {});
      const missing = require('./permissions').missing(guild);
      const lockdown = require('./security').lockdown;
      const errors = require('./logger').tail(8);
      await fetchMembers(guild, [...reports.flatMap((r) => [r.reporter, r.target]), ...apps.map((a) => a.userId), ...quarantined.map(([id]) => id)]);
      const box = (ok, title, body) => `<div class="card" style="border-color:${ok ? 'rgba(84,201,135,.35)' : 'rgba(225,6,0,.45)'}"><h3>${ok ? '✅' : '🔔'} ${title}</h3>${body}</div>`;
      return {
        title: '🔔 Centre d\'alertes',
        body: `${lockdown.active ? box(false, 'Serveur verrouillé (anti-raid)', `<p>Jusqu'à ${fmtDate(lockdown.until)}. <a href="/moderation">Gérer</a></p>`) : ''}
        ${box(!missing.length, `Permissions du bot${missing.length ? ` : ${missing.length} manquante(s)` : ''}`, missing.length ? `<p>${esc(missing.join(', '))}</p><p class="muted">Réinvite le bot avec le lien de « npm run invite ».</p>` : '<p class="muted">Le bot a tout ce qu\'il lui faut.</p>')}
        ${box(!reports.length, `Signalements en attente (${reports.length})`, reports.length ? `<table><tr><th>#</th><th>Signalé</th><th>Raison</th><th>Statut</th><th></th></tr>${reports.map((r) => `<tr><td>${r.id}</td><td>${memberName(guild, r.target)}<br><span class="muted">par ${memberName(guild, r.reporter)}</span></td><td>${esc(r.reason.slice(0, 160))}</td><td>${esc(rp.STATUS[r.status][1])}</td><td style="white-space:nowrap">${r.status === 'open' ? inlineBtn(sess, { action: 'report', id: r.id, status: 'claimed' }, 'Je m\'en occupe') : ''}${inlineBtn(sess, { action: 'report', id: r.id, status: 'resolved' }, 'Résolu')}${inlineBtn(sess, { action: 'report', id: r.id, status: 'dismissed' }, 'Sans suite')}</td></tr>`).join('')}</table>` : '<p class="muted">Rien à traiter.</p>')}
        ${box(!apps.length, `Candidatures en attente (${apps.length})`, apps.length ? `<table><tr><th>Candidat</th><th>Poste</th><th>Motivation</th><th></th></tr>${apps.map((a) => `<tr><td>${memberName(guild, a.userId)}<br><span class="muted">${fmtDate(a.at)}</span></td><td>${esc(ap.KINDS[a.kind].label)}</td><td>${esc(String(a.answers.why ?? '').slice(0, 200))}</td><td style="white-space:nowrap">${inlineBtn(sess, { action: 'app', id: a.id, ok: '1' }, 'Accepter', '')}${inlineBtn(sess, { action: 'app', id: a.id, ok: '0' }, 'Refuser')}</td></tr>`).join('')}</table>` : '<p class="muted">Aucune candidature en attente.</p>')}
        ${box(!tickets, `Tickets ouverts (${tickets})`, `<p><a href="/tickets">Voir les tickets</a></p>`)}
        ${box(!quarantined.length, `Membres en quarantaine (${quarantined.length})`, quarantined.length ? `<p>${quarantined.map(([id, q]) => `${memberName(guild, id)} <span class="muted">— ${esc(q.reason ?? '')}</span>`).join('<br>')}</p>` : '<p class="muted">Personne.</p>')}
        ${box(!errors.length, 'Dernières erreurs du bot', errors.length ? `<pre style="white-space:pre-wrap;font-size:12px;max-height:240px;overflow:auto">${esc(errors.join('\n'))}</pre>` : '<p class="muted">Aucune erreur récente.</p>')}`,
      };
    },
    async 'POST /alertes'(guild, sess, body) {
      if (body.get('action') === 'report') {
        const rp = require('./reports');
        const r = rp.all()[body.get('id')];
        if (!r) return '❌ Signalement introuvable.';
        await rp.update(guild, r, body.get('status'), sess.userId);
        return `✅ Signalement #${r.id} : ${rp.STATUS[r.status][1]}.`;
      }
      if (body.get('action') === 'app') {
        const ap = require('./applications');
        const a = ap.all()[body.get('id')];
        if (!a) return '❌ Candidature introuvable.';
        await ap.decide(guild, a, body.get('ok') === '1', sess.userId);
        return body.get('ok') === '1' ? '✅ Candidature acceptée (rôle donné, candidat prévenu).' : '✅ Candidature refusée (candidat prévenu).';
      }
      return 'Action inconnue.';
    },

    // ───────────────────────── Éditeur de messages ─────────────────────────
    '/editeur'(guild, sess) {
      const channels = textChannels(guild);
      const def = require('./shared').findChannel(guild, 'announcements')?.id;
      const field = (name, label, attrs = '') => `<label>${label}</label><input type="text" name="${name}" data-p="${name}" ${attrs}>`;
      return {
        title: '✉️ Éditeur de messages',
        body: `<div class="split" style="grid-template-columns:1fr 1fr">
        <form method="post" class="card" id="ed">${csrf(sess)}
          <label>Salon</label><select name="channel">${channels.map((c) => `<option value="${c.id}" ${c.id === def ? 'selected' : ''}>#${esc(c.name)}</option>`).join('')}</select>
          <label>Modifier un message existant du bot (lien, facultatif)</label><input type="url" name="edit" placeholder="https://discord.com/channels/…">
          <label>Texte au-dessus de l'embed</label><textarea name="content" data-p="content" maxlength="2000" rows="2"></textarea>
          ${field('author', 'Auteur (petit texte en haut)', 'maxlength="256"')}
          ${field('title', 'Titre', 'maxlength="256"')}
          <label>Description (gras **…**, italique *…*, lien [texte](url))</label><textarea name="description" data-p="description" maxlength="4000" rows="6"></textarea>
          <div class="row"><div><label>Couleur</label><input type="color" name="color" data-p="color" value="#e10600" style="height:42px;padding:4px"></div><div>${field('footer', 'Pied de page', 'maxlength="2048"')}</div></div>
          ${field('image', 'Image (lien https)', 'maxlength="500"')}${field('thumbnail', 'Miniature (lien https)', 'maxlength="500"')}
          <label>Boutons-liens (facultatif) — « Texte | https://… », un par ligne, 5 max</label><textarea name="buttons" data-p="buttons" rows="3"></textarea>
          <button>Envoyer</button></form>
        <div class="card" style="position:sticky;top:80px;align-self:start"><h3>Aperçu</h3>
          <div style="background:#313338;border-radius:8px;padding:14px;font:15px/1.4 'gg sans',Inter,system-ui,sans-serif;color:#dbdee1">
            <div style="display:flex;gap:10px"><img src="/logo.png" alt="" style="width:40px;height:40px;border-radius:50%"><div style="flex:1;min-width:0">
            <div><b style="color:#f2f3f5">剣聖 ・ Kensei</b> <span style="background:#5865f2;color:#fff;font-size:10px;padding:1px 4px;border-radius:3px">APP</span></div>
            <div id="pv-content" style="white-space:pre-wrap;margin:2px 0 6px"></div>
            <div id="pv-embed" style="background:#2b2d31;border-left:4px solid #e10600;border-radius:4px;padding:10px 14px;max-width:520px;display:grid;grid-template-columns:1fr auto;gap:8px">
              <div style="min-width:0"><div id="pv-author" style="font-size:13px;font-weight:600;color:#f2f3f5"></div><div id="pv-title" style="font-weight:700;color:#f2f3f5;margin:2px 0"></div><div id="pv-description" style="white-space:pre-wrap;font-size:14px"></div><img id="pv-image" alt="" style="max-width:100%;border-radius:4px;margin-top:8px;display:none"><div id="pv-footer" style="font-size:12px;color:#b5bac1;margin-top:8px"></div></div>
              <img id="pv-thumbnail" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:4px;display:none"></div>
            <div id="pv-buttons" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"></div></div></div></div>
          <p class="muted" style="margin-top:10px">L'aperçu se met à jour pendant que tu écris. Les images externes ne s'affichent que sur Discord.</p></div></div>`,
        // Aperçu en direct (le texte est inséré avec textContent : aucun HTML saisi n'est interprété)
        script: `const f=document.getElementById('ed');const $=(i)=>document.getElementById(i);
function md(el,t){el.textContent='';const re=/(\\*\\*([^*]+)\\*\\*|\\*([^*]+)\\*|\\[([^\\]]+)\\]\\((https?:[^)\\s]+)\\))/g;let last=0,m;while((m=re.exec(t))){el.append(t.slice(last,m.index));let n;if(m[2]){n=document.createElement('b');n.textContent=m[2]}else if(m[3]){n=document.createElement('i');n.textContent=m[3]}else{n=document.createElement('a');n.textContent=m[4];n.href=m[5];n.target='_blank';n.rel='noopener'}el.append(n);last=re.lastIndex}el.append(t.slice(last))}
function up(){const v=(k)=>(f.elements[k]?.value||'');md($('pv-content'),v('content'));$('pv-author').textContent=v('author');$('pv-title').textContent=v('title');md($('pv-description'),v('description'));$('pv-footer').textContent=v('footer');$('pv-embed').style.borderLeftColor=v('color');
const any=['author','title','description','footer','image','thumbnail'].some((k)=>v(k).trim());$('pv-embed').style.display=any?'grid':'none';
const b=$('pv-buttons');b.textContent='';v('buttons').split('\\n').slice(0,5).forEach((l)=>{const [t,u]=l.split('|').map((x)=>x&&x.trim());if(t&&u){const s=document.createElement('span');s.textContent=t+' ↗';s.style.cssText='background:#4e5058;color:#fff;padding:6px 14px;border-radius:4px;font-size:14px';b.append(s)}})}
f.addEventListener('input',up);up();`,
      };
    },
    async 'POST /editeur'(guild, sess, body) {
      const v = (k, max) => String(body.get(k) ?? '').trim().slice(0, max);
      const https = (u) => (/^https:\/\/\S+$/.test(u) ? u : null);
      const embed = new EmbedBuilder().setColor(Number.parseInt((v('color', 7) || '#e10600').replace('#', ''), 16) || 0xe10600);
      let hasEmbed = false;
      if (v('author', 256)) (embed.setAuthor({ name: v('author', 256) }), (hasEmbed = true));
      if (v('title', 256)) (embed.setTitle(v('title', 256)), (hasEmbed = true));
      if (v('description', 4000)) (embed.setDescription(v('description', 4000)), (hasEmbed = true));
      if (v('footer', 2048)) (embed.setFooter({ text: v('footer', 2048) }), (hasEmbed = true));
      if (https(v('image', 500))) (embed.setImage(v('image', 500)), (hasEmbed = true));
      if (https(v('thumbnail', 500))) (embed.setThumbnail(v('thumbnail', 500)), (hasEmbed = true));
      const buttons = v('buttons', 2000)
        .split('\n')
        .map((l) => l.split('|').map((x) => x.trim()))
        .filter(([t, u]) => t && https(u))
        .slice(0, 5)
        .map(([t, u]) => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t.slice(0, 80)).setURL(u));
      const content = v('content', 2000);
      if (!content && !hasEmbed) return '❌ Le message est vide.';
      const payload = { content: content || null, embeds: hasEmbed ? [embed] : [], components: buttons.length ? [new ActionRowBuilder().addComponents(buttons)] : [], allowedMentions: { parse: [] } };
      const edit = v('edit', 300).match(/channels\/\d+\/(\d+)\/(\d+)/);
      if (edit) {
        const ch = guild.channels.cache.get(edit[1]);
        const msg = ch?.isTextBased() && (await ch.messages.fetch(edit[2]).catch(() => null));
        if (!msg || msg.author.id !== guild.client.user.id) return '❌ Message introuvable ou pas envoyé par le bot.';
        await msg.edit(payload);
        return `✅ Message modifié dans #${ch.name}.`;
      }
      const channel = guild.channels.cache.get(body.get('channel'));
      if (!channel?.isTextBased()) return '❌ Salon invalide.';
      await channel.send(payload);
      return `✅ Message envoyé dans #${channel.name}.`;
    },

    // ───────────────────────── Galerie de clips ─────────────────────────
    '/clips'(guild, sess, query) {
      const days = [7, 30, 365].includes(Number(query.get('jours'))) ? Number(query.get('jours')) : 30;
      const clips = require('./twitchlive').bestClips(days, 60);
      const range = [7, 30, 365].map((d) => `<a class="btn ${d === days ? '' : 'ghost'}" style="margin:0 4px 0 0" href="/clips?jours=${d}">${d === 365 ? '1 an' : `${d} jours`}</a>`).join('');
      return {
        title: '🎬 Galerie de clips',
        body: `<div style="margin-bottom:14px">${range}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px">${clips
          .map((c) => `<a href="${esc(c.url)}" target="_blank" rel="noopener" class="card" style="padding:0;overflow:hidden;text-decoration:none;color:inherit;margin:0">${c.thumb && /^https:\/\//.test(c.thumb) ? `<img src="${esc(c.thumb)}" alt="" style="width:100%;aspect-ratio:16/9;object-fit:cover;display:block">` : ''}<div style="padding:10px 12px"><b>${esc(c.title)}</b><div class="muted" style="font-size:13px">par ${esc(c.creator)} · ${n(c.views)} vues · ${fmtDate(c.createdAt)}</div></div></a>`)
          .join('') || '<p class="muted">Aucun clip sur cette période (les clips de la chaîne sont récupérés toutes les 5 minutes).</p>'}</div>`,
      };
    },
  };
};
