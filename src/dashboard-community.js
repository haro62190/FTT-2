/**
 * Pages « communauté » du tableau de bord : 👤 Membres (statistiques individuelles, classements)
 * et 📜 Quêtes & boosts (événements XP/ryō, réglages des niveaux, récompenses de grade, pilier de la semaine).
 */
const settings = require('./settings');
const { db } = require('./store');
const { config } = require('./shared');

module.exports = ({ esc, csrf, checkbox, fetchMembers, memberName, fmtDate }) => {
  const hidden = (name, value) => `<input type="hidden" name="${name}" value="${esc(value)}">`;
  const num = (v) => Math.round(v ?? 0).toLocaleString('fr-FR');
  const grades = config.roles.filter((r) => r.levelReward).sort((a, b) => a.levelReward - b.levelReward);

  async function findMember(guild, q) {
    q = String(q ?? '').trim().replace(/^<@!?(\d+)>$/, '$1').replace(/^@/, '');
    if (!q) return null;
    if (/^\d{17,20}$/.test(q)) return guild.members.fetch(q).catch(() => null);
    return (await guild.members.fetch({ query: q, limit: 1 }).catch(() => null))?.first() ?? null;
  }

  return {
    // ───────────────────────── Membres ─────────────────────────
    async '/membres'(guild, sess, query) {
      const stats = require('./memberstats');
      const board = stats.BOARDS[query.get('top')] ? query.get('top') : 'xp';
      const list = stats.board(board, 25);
      await fetchMembers(guild, list.map((e) => e.userId));
      let detail = '';
      if (query.get('q')) {
        const m = await findMember(guild, query.get('q'));
        if (!m) detail = '<div class="card"><p class="muted">Aucun membre trouvé.</p></div>';
        else {
          const s = stats.full(m.id);
          const q = db.quests?.[m.id];
          const tile = (label, value) => `<div class="card" style="margin:0"><div class="muted" style="font-size:13px">${label}</div><div style="font-size:22px;font-weight:700">${value}</div></div>`;
          detail = `<div class="card"><h3>${esc(m.displayName)} <span class="muted" style="font-weight:400">· ${esc(m.user.tag)}</span></h3>
          <p class="muted">Arrivé ${fmtDate(m.joinedTimestamp)} · ${m.roles.cache.filter((r) => r.id !== guild.id).map((r) => esc(r.name)).join(', ') || 'aucun rôle'}</p>
          <div class="row">${tile('Niveau', `${s.level}${s.rank ? ` <span class="muted" style="font-size:14px">#${s.rank}</span>` : ''}`)}${tile('XP totale', num(s.totalXp))}${tile('Mois', s.seasonRank ? `#${s.seasonRank}` : '—')}${tile('Semaine', s.weekRank ? `#${s.weekRank}` : '—')}</div>
          <div class="row" style="margin-top:12px">${tile('Messages', num(s.messages))}${tile('Vocal', `${Math.floor(s.voiceMinutes / 60)} h ${s.voiceMinutes % 60}`)}${tile('Réactions', num(s.reactions))}${tile('Quêtes', num(s.questsDone))}</div>
          <div class="row" style="margin-top:12px">${tile('Ryō', `${num(s.ryo)} 両`)}${tile('Ryō gagnés', `${num(s.ryoEarned)} 両`)}${tile('Série /daily', `${s.streak} <span class="muted" style="font-size:14px">record ${s.bestStreak}</span>`)}${tile('Duels gagnés', `${s.duelsWon} / ${s.duels}`)}</div>
          ${require('./feed').memberHistory(m.id).length ? `<h3 style="margin-top:18px">🕒 Historique</h3><table>${require('./feed').memberHistory(m.id).map((e) => `<tr><td style="white-space:nowrap">${fmtDate(e.at)}</td><td>${esc(e.icon)}</td><td>${esc(e.text.replace(/<@(\d+)>/g, (_, id) => guild.members.cache.get(id)?.displayName ?? 'un membre'))}</td></tr>`).join('')}</table>` : ''}
          ${q ? `<h3 style="margin-top:18px">📜 Quêtes en cours</h3><table><tr><th>Quête</th><th>Progression</th></tr>${[...(q.daily ?? []), ...(q.weekly ?? [])]
            .map((x) => {
              const d = require('./quests').DAILY.concat(require('./quests').WEEKLY).find((y) => y.id === x.id);
              return d ? `<tr><td>${x.done ? '✅' : '⬜'} ${esc(d.label)}</td><td>${x.n} / ${d.goal}</td></tr>` : '';
            })
            .join('')}</table>` : ''}</div>`;
        }
      }
      const tabs = Object.entries(stats.BOARDS)
        .map(([k, [label]]) => `<a class="btn ${k === board ? '' : 'ghost'}" style="margin:0 6px 6px 0" href="/membres?top=${k}">${esc(label)}</a>`)
        .join('');
      return {
        title: '👤 Membres',
        body: `<form method="get" class="card"><label>Chercher un membre (pseudo ou ID)</label><div class="row"><input type="text" name="q" value="${esc(query.get('q') ?? '')}" required><button style="flex:0 0 auto;margin:0">Voir ses statistiques</button></div></form>
        ${detail}
        <div class="card"><h3>🏆 Les plus actifs</h3><div>${tabs}</div>
        <table><tr><th>#</th><th>Membre</th><th>${esc(stats.BOARDS[board][0])}</th></tr>
        ${list.map((e, n) => `<tr><td>${n + 1}</td><td><a href="/membres?top=${board}&q=${e.userId}">${memberName(guild, e.userId)}</a></td><td>${esc(e.label)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Personne pour l\'instant.</td></tr>'}
        </table></div>`,
      };
    },

    // ───────────────────────── Lives ─────────────────────────
    async '/lives'(guild, sess, query) {
      const streams = require('./streams');
      const { lineChart, dataTable, fmt } = require('./charts');
      const days = [7, 30, 90, 365].includes(Number(query.get('jours'))) ? Number(query.get('jours')) : 30;
      const sum = streams.summary(days);
      const since = Date.now() - days * 86_400_000;
      const items = streams.list().filter((x) => x.endedAt >= since);
      const pts = items
        .filter((x) => x.platform === 'twitch')
        .slice()
        .reverse()
        .map((x) => ({ date: new Date(x.startedAt).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }), peak: x.peak, avg: x.avg }));
      const series = [{ key: 'avg', label: 'Moyenne' }, { key: 'peak', label: 'Pic' }];
      const tile = (v, label) => `<div class="stat"><b>${v}</b><span>${label}</span></div>`;
      const range = [7, 30, 90, 365].map((d) => `<a class="btn ${d === days ? '' : 'ghost'}" style="margin:0 4px 0 0" href="/lives?jours=${d}">${d === 365 ? '1 an' : `${d} jours`}</a>`).join('');
      const m = db.milestones ?? {};
      const next = (n) => (typeof n === 'number' ? fmt([10, 25, 50, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000, 15000, 20000, 25000, 50000, 75000, 100000].find((x) => x > n) ?? n + 50000) : '—');
      const counts = db.stats ?? {};
      const live = db.twitchLive;
      await fetchMembers(guild, items.flatMap((x) => x.topChatters ?? []));
      return {
        title: '📺 Lives & statistiques',
        body: `${live ? `<div class="card"><h3>🔴 En live en ce moment</h3><p><b>${esc(live.title ?? '')}</b><br>Depuis ${fmtDate(new Date(live.startedAt).getTime())} · pic ${live.peak ?? 0} · moyenne ${live.samples ? Math.round(live.viewerSum / live.samples) : '—'} viewers · ${esc((live.games ?? []).join(', '))}</p></div>` : ''}
        <div style="margin-bottom:14px">${range}</div>
        <div class="grid">${tile(sum.count, '🎬 lives')}${tile(`${sum.hours.toFixed(1).replace('.', ',')} h`, '⏱️ de live')}${tile(fmt(sum.avg), '👀 viewers en moyenne')}${tile(fmt(sum.peak), '🔝 pic de viewers')}${tile(`${sum.followers >= 0 ? '+' : ''}${fmt(sum.followers)}`, '🟣 followers gagnés en live')}</div>
        <div class="card"><h3>👀 Viewers par live (Twitch)</h3>${lineChart({ points: pts, series })}${dataTable(pts, series)}</div>
        <div class="card"><h3>🎉 Paliers d'abonnés</h3><p class="muted">Annonce automatique dans 📢 quand un palier est franchi (module « Paliers d'abonnés »).</p>
        <table><tr><th>Plateforme</th><th>Actuellement</th><th>Dernier palier</th><th>Prochain</th></tr>
        ${[['twitch', '🟣 Twitch'], ['tiktok', '📱 TikTok'], ['discord', '👥 Discord']].map(([k, label]) => `<tr><td>${label}</td><td>${fmt(counts[k])}</td><td>${fmt(m[k] || null)}</td><td>${next(counts[k])}</td></tr>`).join('')}</table></div>
        <div class="card"><h3>🗓️ Historique</h3><table><tr><th>Date</th><th></th><th>Titre</th><th>Durée</th><th>Viewers</th><th>Followers</th><th>Plus actifs</th></tr>
        ${items.map((x) => `<tr><td style="white-space:nowrap">${fmtDate(x.startedAt)}</td><td>${x.platform === 'tiktok' ? '📱' : '🟣'}</td><td>${esc(x.title ?? '')}${x.games?.length ? `<br><span class="muted">${esc(x.games.join(', '))}</span>` : ''}${x.vod ? `<br><a href="${esc(x.vod)}" target="_blank" rel="noopener">Revoir</a>` : ''}</td><td>${streams.fmtDuration(x.durationMin)}</td><td>${x.peak ? `pic ${x.peak}` : '—'}${x.avg ? `<br><span class="muted">moy. ${x.avg}</span>` : ''}</td><td>${x.followersGained == null ? '—' : `${x.followersGained >= 0 ? '+' : ''}${x.followersGained}`}</td><td>${(x.topChatters ?? []).map((id) => memberName(guild, id)).join(', ') || '—'}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Aucun live enregistré sur cette période.</td></tr>'}
        </table></div>`,
      };
    },

    // ───────────────────────── Quêtes & boosts ─────────────────────────
    '/quetes-boost'(guild, sess) {
      const boost = require('./boost').active();
      const l = settings.get('levels');
      const s = settings.get('seasons');
      const mult = l.roleMultipliers ?? {};
      const q = require('./quests');
      return {
        title: '📜 Quêtes, boosts & grades',
        body: `<div class="card"><h3>🔥 Événement boost</h3>
        ${boost ? `<p>En cours : <b>XP ×${boost.xp}</b> · <b>Ryō ×${boost.ryo}</b> jusqu'au ${fmtDate(boost.until)}${boost.reason ? ` — ${esc(boost.reason)}` : ''}</p>
        <form method="post">${csrf(sess)}${hidden('action', 'stop')}<button class="ghost">Arrêter le boost</button></form>` : '<p class="muted">Aucun boost en cours.</p>'}
        <form method="post">${csrf(sess)}${hidden('action', 'boost')}<div class="row">
        <div><label>Durée (heures)</label><input type="number" name="hours" min="1" max="72" value="2" required></div>
        <div><label>XP ×</label><input type="number" name="xp" min="1" max="5" step="0.25" value="2"></div>
        <div><label>Ryō ×</label><input type="number" name="ryo" min="1" max="5" step="0.25" value="1"></div></div>
        <label>Message (facultatif)</label><input type="text" name="reason" maxlength="200" placeholder="Week-end des 500 followers !">
        <button>Lancer et annoncer</button></form></div>

        <form method="post" class="card">${csrf(sess)}${hidden('action', 'levels')}<h3>⚔️ Règles de l'XP</h3>
        ${checkbox('quests', settings.on('quests'), '📜 Quêtes quotidiennes et hebdomadaires (/quetes)')}
        ${checkbox('ignoreBotChannel', l.ignoreBotChannel !== false, 'Pas d\'XP dans 🤖┃commandes')}
        <div class="row"><div><label>Longueur minimale d'un message pour gagner de l'XP</label><input type="number" name="minLength" min="0" max="50" value="${l.minLength ?? 3}"></div></div>
        <h3>Bonus d'XP par rôle</h3><div class="row">
        <div><label>🩸 VIP ×</label><input type="number" name="mult_vip" min="1" max="3" step="0.05" value="${mult.vip ?? 1}"></div>
        <div><label>⭐ Abonné Twitch ×</label><input type="number" name="mult_sub" min="1" max="3" step="0.05" value="${mult.sub ?? 1}"></div>
        <div><label>🚀 Booster Nitro ×</label><input type="number" name="mult_booster" min="1" max="3" step="0.05" value="${mult.booster ?? 1}"></div></div>
        <h3>🎖️ Récompenses de grade</h3><table><tr><th>Grade</th><th>Niveau</th><th>Prime à l'obtention (両)</th><th>Bonus /daily (両)</th></tr>
        ${grades.map((g) => `<tr><td>${esc(g.name)}</td><td>${g.levelReward}</td><td><input type="number" name="bonus_${g.key}" min="0" max="100000" value="${l.gradeBonus?.[g.key] ?? 0}"></td><td><input type="number" name="daily_${g.key}" min="0" max="10000" value="${l.gradeDaily?.[g.key] ?? 0}"></td></tr>`).join('')}</table>
        <h3>🔥 Pilier de la semaine</h3>
        ${checkbox('weekly', s.weekly !== false, 'Chaque lundi : rôle 🔥 Pilier de la semaine + ryō pour le plus actif')}
        <div class="row"><div><label>Récompense (両)</label><input type="number" name="weeklyReward" min="0" max="100000" value="${s.weeklyReward ?? 750}"></div></div>
        <button>Enregistrer</button></form>

        <div class="card"><h3>📜 Quêtes possibles</h3><p class="muted">Chaque membre reçoit 3 quêtes du jour et 3 de la semaine, tirées au hasard. Remise à zéro à minuit et le lundi (heure de Paris).</p>
        <table><tr><th>Type</th><th>Quête</th><th>Récompense</th></tr>
        ${q.DAILY.map((d) => `<tr><td>☀️ Jour</td><td>${esc(d.label)}</td><td>${d.reward} 両</td></tr>`).join('')}
        ${q.WEEKLY.map((d) => `<tr><td>🗓️ Semaine</td><td>${esc(d.label)}</td><td>${d.reward} 両</td></tr>`).join('')}</table></div>`,
      };
    },
    async 'POST /quetes-boost'(guild, sess, body) {
      const action = body.get('action');
      const clamp = (v, min, max, dflt) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
      };
      if (action === 'stop') return require('./boost').stopBoost() ? '🧯 Boost arrêté.' : 'Aucun boost en cours.';
      if (action === 'boost') {
        const b = await require('./boost').startBoost(guild, {
          hours: clamp(body.get('hours'), 1, 72, 2),
          xp: clamp(body.get('xp'), 1, 5, 2),
          ryo: clamp(body.get('ryo'), 1, 5, 1),
          reason: String(body.get('reason') ?? '').slice(0, 200),
          by: sess.userId,
        });
        return `🔥 Boost lancé : XP ×${b.xp} · Ryō ×${b.ryo} jusqu'au ${fmtDate(b.until)}.`;
      }
      settings.set('modules.quests', body.has('quests'));
      settings.set('levels.ignoreBotChannel', body.has('ignoreBotChannel'));
      settings.set('levels.minLength', clamp(body.get('minLength'), 0, 50, 3));
      settings.set('levels.roleMultipliers', {
        vip: clamp(body.get('mult_vip'), 1, 3, 1),
        sub: clamp(body.get('mult_sub'), 1, 3, 1),
        booster: clamp(body.get('mult_booster'), 1, 3, 1),
      });
      settings.set('levels.gradeBonus', Object.fromEntries(grades.map((g) => [g.key, clamp(body.get(`bonus_${g.key}`), 0, 100000, 0)])));
      settings.set('levels.gradeDaily', Object.fromEntries(grades.map((g) => [g.key, clamp(body.get(`daily_${g.key}`), 0, 10000, 0)])));
      settings.set('seasons.weekly', body.has('weekly'));
      settings.set('seasons.weeklyReward', clamp(body.get('weeklyReward'), 0, 100000, 750));
      return '✅ Réglages enregistrés.';
    },
  };
};
