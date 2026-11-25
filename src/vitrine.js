/**
 * 🌐 Page vitrine publique (haro62190.tech) : présentation, live en direct, planning, clips,
 * compteurs, serveur Minecraft et lien d'invitation Discord. Aucune connexion, aucune donnée privée.
 *
 * .env : PUBLIC_HOST=haro62190.tech (le site répond aussi sur www.). Les textes se règlent sur le
 * tableau de bord (🌐 Page vitrine).
 */
const { ChannelType } = require('discord.js');
const settings = require('./settings');
const { db, save } = require('./store');
const { BRAND } = require('./brand');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const n = (x) => (x === null || x === undefined ? '—' : Math.round(x).toLocaleString('fr-FR'));
const safeUrl = (u) => {
  try {
    const url = new URL(String(u));
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
};

/** Hôtes publics de la vitrine (en minuscules, sans port). */
function publicHosts() {
  const h = (process.env.PUBLIC_HOST || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return h ? [h, h.startsWith('www.') ? h.slice(4) : `www.${h}`] : [];
}
const isPublicHost = (host) => publicHosts().includes(String(host ?? '').toLowerCase().replace(/:\d+$/, ''));

const DEFAULTS = {
  tagline: 'Gaming, lives et bonne humeur : rejoins le dojo.',
  about:
    'Bienvenue chez les Ronins ! Une communauté de joueurs autour des lives Twitch de haro62190 : soirées gaming, tournois, quiz pendant les lives, serveur Minecraft et un Discord où chacun trouve sa place.',
};
const text = (key) => String(settings.get(`vitrine.${key}`) ?? DEFAULTS[key] ?? '');
const links = () => {
  const l = settings.get('vitrine.links') ?? {};
  return ['youtube', 'instagram', 'x'].map((k) => [k, safeUrl(l[k])]).filter(([, u]) => u);
};

/** Lien d'invitation permanent, créé une fois par le bot puis réutilisé. */
async function invite(guild) {
  const custom = safeUrl(settings.get('vitrine.invite'));
  if (custom) return custom;
  const v = (db.vitrine ??= {});
  if (v.invite && Date.now() - (v.inviteCheckedAt ?? 0) < 6 * 3600_000) return v.invite;
  const { findChannel } = require('./shared');
  const channel =
    findChannel(guild, 'welcome') ?? findChannel(guild, 'rules') ?? guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.permissionsFor(guild.members.me)?.has('CreateInstantInvite'));
  const inv = channel && (await channel.createInvite({ maxAge: 0, maxUses: 0, unique: false, reason: 'Page vitrine du site' }).catch(() => null));
  if (inv) {
    v.invite = inv.url;
    v.inviteCheckedAt = Date.now();
    save();
  }
  return v.invite ?? null;
}

async function render(guild, host) {
  const { twitchLogin, tiktokUser } = require('./shared');
  const twitch = twitchLogin();
  const tiktok = tiktokUser();
  const live = db.twitchLive;
  const stats = db.stats ?? {};
  const upcoming = (db.twitchSchedule?.upcoming ?? []).filter((s) => s.start > Date.now() - 3600_000).slice(0, 5);
  const clips = require('./twitchlive').bestClips(30, 6);
  const gs = require('./gameserver');
  const mc = gs.configured() && settings.get('modules.gameServer') !== false ? gs.state() : null;
  const inviteUrl = guild ? await invite(guild).catch(() => db.vitrine?.invite ?? null) : null;
  const name = guild?.name ?? BRAND.community;
  const parent = isPublicHost(host) ? String(host).toLowerCase().replace(/:\d+$/, '') : null;
  const when = (t) => new Date(t).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const c = BRAND.colors;
  const icons = { youtube: '▶️ YouTube', instagram: '📸 Instagram', x: '✖️ X' };

  const liveBlock = live
    ? `<section class="card live"><div class="tag">🔴 EN DIRECT</div><h2>${esc(live.title ?? 'Live en cours')}</h2>
      ${parent && twitch ? `<div class="player"><iframe src="https://player.twitch.tv/?channel=${encodeURIComponent(twitch)}&parent=${encodeURIComponent(parent)}&muted=true" allowfullscreen title="Live Twitch"></iframe></div>` : ''}
      ${twitch ? `<a class="btn" href="https://twitch.tv/${encodeURIComponent(twitch)}" target="_blank" rel="noopener">Regarder sur Twitch</a>` : ''}</section>`
    : '';

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(name)}</title><meta name="description" content="${esc(text('tagline'))}"><link rel="icon" href="/logo.png">
<meta property="og:title" content="${esc(name)}"><meta property="og:description" content="${esc(text('tagline'))}"><meta property="og:image" content="/assets/logo-kensei.jpg">
<style>
@font-face{font-family:Brush;src:url(/assets/brush.ttf) format('truetype');font-display:swap}
@font-face{font-family:Cinzel;src:url(/assets/cinzel.ttf) format('truetype');font-display:swap}
@font-face{font-family:Kanji;src:url(/assets/kanji.ttf) format('truetype');font-display:swap}
:root{--ink:${c.ink};--panel:${c.panel};--line:${c.line};--text:${c.text};--muted:${c.muted};--red:${c.red};--gold:${c.gold}}
*{box-sizing:border-box}html{background:var(--ink)}body{margin:0;background:var(--ink);color:var(--text);font:16px/1.6 system-ui,'Segoe UI',Arial,sans-serif}
a{color:var(--gold)}.wrap{max-width:1040px;margin:0 auto;padding:0 16px}
.hero{position:relative;padding:72px 0 56px;text-align:center;background:linear-gradient(180deg,rgba(8,8,11,.55),var(--ink)),url(/assets/hero.jpg) center/cover;border-bottom:1px solid rgba(225,6,0,.35)}
.hero img{width:112px;height:112px;border-radius:50%;border:3px solid var(--red);box-shadow:0 0 40px rgba(225,6,0,.45)}
.kanji{font-family:Kanji,serif;color:var(--red);font-size:28px;letter-spacing:6px;margin-top:12px}
h1{font-family:Brush,cursive;font-weight:400;font-size:clamp(36px,7vw,64px);margin:6px 0 4px;line-height:1.1}
h2{font-family:Cinzel,serif;font-size:22px;margin:0 0 12px;letter-spacing:1px}
.tagline{color:var(--muted);font-size:18px;margin:0 auto 22px;max-width:640px}
.btn{display:inline-block;margin:6px;padding:12px 22px;border-radius:10px;background:var(--red);color:#fff;text-decoration:none;font-weight:700}
.btn.alt{background:#6441a5}.btn.ghost{background:transparent;border:1px solid var(--line);color:var(--text)}
main{padding:28px 0 40px;display:grid;gap:18px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px}
.live{border-color:var(--red);box-shadow:0 0 30px rgba(225,6,0,.25)}.tag{color:var(--red);font-weight:800;letter-spacing:2px;font-size:13px}
.player{position:relative;padding-top:56.25%;margin:12px 0;border-radius:10px;overflow:hidden}.player iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.kpi{background:#191920;border-radius:12px;padding:14px;text-align:center}.kpi b{display:block;font-size:26px;color:var(--gold)}.kpi span{color:var(--muted);font-size:14px}
ul.plan{list-style:none;margin:0;padding:0}ul.plan li{padding:10px 0;border-bottom:1px solid var(--line)}ul.plan li:last-child{border:0}ul.plan small{color:var(--muted)}
.clips{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}.clip{display:block;text-decoration:none;color:var(--text)}
.clip img{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:10px;display:block;background:#191920}.clip span{display:block;font-size:14px;margin-top:6px}.clip small{color:var(--muted)}
.mc code{background:#191920;padding:4px 8px;border-radius:6px;font-size:17px}.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px}
footer{color:var(--muted);text-align:center;padding:24px 16px 40px;font-size:14px}
@media(max-width:600px){.hero{padding:48px 0 40px}.btn{display:block;margin:8px auto;max-width:320px}}
</style></head><body>
<header class="hero"><div class="wrap">
<img src="/assets/logo-kensei.jpg" alt="Logo ${esc(name)}">
<div class="kanji">${esc(BRAND.kanji)}</div>
<h1>${esc(name)}</h1>
<p class="tagline">${esc(text('tagline'))}</p>
${inviteUrl ? `<a class="btn" href="${esc(inviteUrl)}" target="_blank" rel="noopener">⚔️ Rejoindre le Discord</a>` : ''}
${twitch ? `<a class="btn alt" href="https://twitch.tv/${encodeURIComponent(twitch)}" target="_blank" rel="noopener">🟣 Suivre sur Twitch</a>` : ''}
${tiktok ? `<a class="btn ghost" href="https://www.tiktok.com/@${encodeURIComponent(tiktok)}" target="_blank" rel="noopener">📱 TikTok</a>` : ''}
${links().map(([k, u]) => `<a class="btn ghost" href="${esc(u)}" target="_blank" rel="noopener">${icons[k]}</a>`).join('')}
</div></header>
<main class="wrap">
${liveBlock}
<section class="card"><h2>⛩️ Le dojo</h2><p style="margin:0;white-space:pre-line">${esc(text('about'))}</p></section>
<section class="card"><h2>📊 La communauté</h2><div class="grid">
<div class="kpi"><b>${n(guild?.memberCount ?? stats.discord)}</b><span>membres Discord</span></div>
${stats.twitch != null ? `<div class="kpi"><b>${n(stats.twitch)}</b><span>followers Twitch</span></div>` : ''}
${stats.tiktok != null ? `<div class="kpi"><b>${n(stats.tiktok)}</b><span>abonnés TikTok</span></div>` : ''}
<div class="kpi"><b>${live ? '🔴' : '⚫'}</b><span>${live ? 'en live maintenant' : 'hors ligne'}</span></div>
</div></section>
${
  upcoming.length
    ? `<section class="card"><h2>🗓️ Prochains lives</h2><ul class="plan">${upcoming
        .map((s) => `<li><b>${esc(s.title)}</b>${s.game ? ` <small>· 🎮 ${esc(s.game)}</small>` : ''}<br><small>${esc(when(s.start))}</small></li>`)
        .join('')}</ul></section>`
    : ''
}
${
  clips.length
    ? `<section class="card"><h2>🎬 Meilleurs clips du mois</h2><div class="clips">${clips
        .map((cl) => {
          const url = safeUrl(cl.url);
          const thumb = safeUrl(cl.thumb);
          return url ? `<a class="clip" href="${esc(url)}" target="_blank" rel="noopener">${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy">` : ''}<span>${esc(cl.title)}</span><small>👁️ ${n(cl.views)} vues · par ${esc(cl.creator)}</small></a>` : '';
        })
        .join('')}</div></section>`
    : ''
}
${
  mc
    ? `<section class="card mc"><h2>⛏️ Serveur Minecraft</h2>
  <p><span class="dot" style="background:${mc.online ? c.success : '#555'}"></span><b>${mc.online ? 'En ligne' : 'Hors ligne'}</b>${mc.online ? ` · ${n(mc.players)} / ${n(mc.max)} joueurs` : ''}${mc.version ? ` · version ${esc(mc.version)} (Java)` : ''}</p>
  ${gs.address() ? `<p>Adresse : <code>${esc(gs.address())}</code></p>` : ''}
  <p style="color:var(--muted);margin:0">Pour jouer : rejoins le Discord et tape <code>/minecraft inscrire</code> avec ton pseudo Minecraft.</p></section>`
    : ''
}
</main>
<footer>⚔️ ${esc(BRAND.community)} · propulsé par ${esc(BRAND.name)}</footer>
</body></html>`;
}

/** CSP propre à la vitrine (lecteur Twitch autorisé, aucun script). */
const CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https://static-cdn.jtvnw.net https://clips-media-assets2.twitch.tv https://cdn.discordapp.com; font-src 'self'; frame-src https://player.twitch.tv; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

async function serve(res, guild, host) {
  const html = await render(guild, host);
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Strict-Transport-Security': 'max-age=31536000',
    'Cache-Control': 'public, max-age=60',
  });
  res.end(html);
}

module.exports = { render, serve, invite, isPublicHost, publicHosts, DEFAULTS, CSP };
