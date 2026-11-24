/**
 * Carte de rang en image (PNG) aux couleurs des Ronins, dessinée en SVG puis convertie par resvg.
 * Polices : celles installées sur la machine (sur un VPS Debian : apt install fonts-dejavu fonts-noto-cjk).
 */
const { Resvg } = require('@resvg/resvg-js');
const { BRAND } = require('./brand');

const LATIN = "'DejaVu Sans', 'Segoe UI', 'Liberation Sans', Arial, sans-serif";
const CJK = "'Noto Sans CJK JP', 'Yu Gothic', 'MS Gothic', 'IPAGothic', sans-serif";
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const num = (n) => Math.round(n ?? 0).toLocaleString('fr-FR').replace(/ | /g, ' ');
const cut = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

async function avatarDataUri(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? 'image/png';
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * @param {object} d  { username, avatarUrl, level, xp, needed, rank, totalXp, messages, voiceMinutes, ryo, grade, seasonRank }
 * @returns {Promise<Buffer>} image PNG 1000×300
 */
async function renderRankCard(d) {
  const W = 1000;
  const H = 300;
  const pct = Math.max(0, Math.min(1, d.needed ? d.xp / d.needed : 0));
  const barX = 290;
  const barW = 660;
  const avatar = d.avatarUrl ? await avatarDataUri(d.avatarUrl) : null;
  const stats = [
    ['XP TOTAL', num(d.totalXp)],
    ['RYŌ 両', num(d.ryo)],
    ['MESSAGES', num(d.messages)],
    ['VOCAL', `${num(Math.round((d.voiceMinutes ?? 0) / 60))} h`],
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${BRAND.colors.ink}"/><stop offset=".65" stop-color="${BRAND.colors.redDeep}"/><stop offset="1" stop-color="#26090d"/></linearGradient>
    <linearGradient id="bar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${BRAND.colors.redDeep}"/><stop offset="1" stop-color="${BRAND.colors.redLight}"/></linearGradient>
    <radialGradient id="sun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${BRAND.colors.red}" stop-opacity=".55"/><stop offset="1" stop-color="#e10600" stop-opacity="0"/></radialGradient>
    <clipPath id="av"><circle cx="145" cy="150" r="96"/></clipPath>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="${W}" height="${H}" rx="26" fill="url(#bg)"/>
  <circle cx="860" cy="70" r="190" fill="url(#sun)"/>
  <text x="975" y="275" text-anchor="end" font-family="${CJK}" font-size="150" font-weight="bold" fill="#ffffff" fill-opacity=".045">浪人</text>
  <rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="24" fill="none" stroke="${BRAND.colors.red}" stroke-opacity=".55" stroke-width="3"/>
  <circle cx="145" cy="150" r="104" fill="none" stroke="#e10600" stroke-width="6" filter="url(#glow)"/>
  ${avatar ? `<image x="49" y="54" width="192" height="192" clip-path="url(#av)" preserveAspectRatio="xMidYMid slice" xlink:href="${avatar}" href="${avatar}"/>` : `<circle cx="145" cy="150" r="96" fill="#1c1c1f"/><text x="145" y="175" text-anchor="middle" font-family="${LATIN}" font-size="80" font-weight="bold" fill="${BRAND.colors.red}">${esc((d.username ?? '?')[0]?.toUpperCase())}</text>`}
  <text x="${barX}" y="78" font-family="${LATIN}" font-size="40" font-weight="bold" fill="#ffffff">${esc(cut(d.username ?? 'Ronin', 20))}</text>
  <text x="${barX}" y="112" font-family="${LATIN}" font-size="22" fill="${BRAND.colors.redLight}">${esc(cut(d.grade ?? '⚔️ Ronin', 32))}${d.seasonRank ? `<tspan fill="${BRAND.colors.muted}">\u00a0\u00a0·\u00a0\u00a0saison du mois #${d.seasonRank}</tspan>` : ''}</text>
  <text x="${barX + barW}" y="70" text-anchor="end" font-family="${LATIN}" fill="#9a9aa2" font-size="22">RANG <tspan fill="#ffffff" font-size="44" font-weight="bold">#${d.rank ?? '—'}</tspan>   NIVEAU <tspan fill="${BRAND.colors.redLight}" font-size="56" font-weight="bold">${d.level}</tspan></text>
  <rect x="${barX}" y="140" width="${barW}" height="34" rx="17" fill="#1f1f23"/>
  <rect x="${barX}" y="140" width="${Math.max(34, barW * pct).toFixed(1)}" height="34" rx="17" fill="url(#bar)" filter="url(#glow)"/>
  <text x="${barX + barW - 14}" y="164" text-anchor="end" font-family="${LATIN}" font-size="19" font-weight="bold" fill="#ffffff">${num(d.xp)} / ${num(d.needed)} XP</text>
  ${stats
    .map(
      ([label, value], k) => `<text x="${barX + k * 168}" y="226" font-family="${LATIN}" font-size="15" fill="#9a9aa2" letter-spacing="2">${label}</text>
  <text x="${barX + k * 168}" y="258" font-family="${LATIN}" font-size="28" font-weight="bold" fill="${BRAND.colors.text}">${esc(value)}</text>`,
    )
    .join('\n  ')}
</svg>`;
  return new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' }, fitTo: { mode: 'original' } }).render().asPng();
}

module.exports = { renderRankCard };
