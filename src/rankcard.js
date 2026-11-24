/**
 * Carte de rang (/rang) d'après la maquette officielle Kensei :
 * cadre doré, sakura, lune rouge, pagode et 浪人 (fond : assets/rankcard-bg.jpg),
 * avatar dans un cercle rouge, pseudo et grade au pinceau, gros niveau doré, barre d'XP, 4 statistiques.
 * Polices livrées avec le bot (assets/fonts) : rendu identique sur PC et VPS.
 */
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const { BRAND, resvgFont } = require('./brand');

const BG = path.join(__dirname, '..', 'assets', 'rankcard-bg.jpg');
const W = 1104;
const H = 502;
const C = BRAND.colors;
const F = BRAND.fonts;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const num = (n) => Math.round(n ?? 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ');
const cut = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const noEmoji = (s) => String(s ?? '').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim();
/** Taille de police pour qu'un texte tienne dans `width` (≈ largeur moyenne d'un caractère = ratio × taille). */
const fit = (text, max, width, ratio = 0.52) => Math.max(22, Math.min(max, Math.floor(width / (Math.max(1, text.length) * ratio))));

let bgUri = null;
const background = () => (bgUri ??= fs.existsSync(BG) ? `data:image/jpeg;base64,${fs.readFileSync(BG).toString('base64')}` : null);

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

// Icônes dorées des statistiques (dessinées en SVG, 34×34)
const ICONS = {
  star: '<path d="M17 2l4.6 9.6 10.4 1.4-7.6 7.2 1.9 10.4L17 25.6 7.7 30.6l1.9-10.4L2 13l10.4-1.4z" fill="url(#gold)"/>',
  coins:
    '<ellipse cx="17" cy="27" rx="12" ry="4.5" fill="url(#gold)"/><rect x="5" y="17" width="24" height="10" fill="url(#gold)"/><ellipse cx="17" cy="17" rx="12" ry="4.5" fill="#ffe39a"/><rect x="5" y="9" width="24" height="8" fill="url(#gold)"/><ellipse cx="17" cy="9" rx="12" ry="4.5" fill="#ffe39a"/><path d="M5 17a12 4.5 0 0 0 24 0M5 27a12 4.5 0 0 0 24 0" stroke="#8a5a10" stroke-width="1.2" fill="none"/>',
  chat: '<path d="M4 7a5 5 0 0 1 5-5h16a5 5 0 0 1 5 5v12a5 5 0 0 1-5 5H14l-7 7v-7H9a5 5 0 0 1-5-5z" fill="url(#gold)"/><circle cx="11" cy="13" r="2.2" fill="#3a2508"/><circle cx="17" cy="13" r="2.2" fill="#3a2508"/><circle cx="23" cy="13" r="2.2" fill="#3a2508"/>',
  mic: '<rect x="11" y="2" width="12" height="20" rx="6" fill="url(#gold)"/><path d="M6 15a11 11 0 0 0 22 0" stroke="url(#gold)" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M17 26v6M11 32h12" stroke="url(#gold)" stroke-width="3" stroke-linecap="round"/>',
};

// Emblème de grade : deux katanas croisés dans un losange
const EMBLEM =
  '<path d="M20 2l18 18-18 18L2 20z" fill="none" stroke="url(#gold)" stroke-width="2.5"/><path d="M9 31L31 9M9 9l22 22" stroke="url(#gold)" stroke-width="3" stroke-linecap="round"/><circle cx="20" cy="20" r="4" fill="url(#gold)"/>';

/**
 * @param {object} d  { username, avatarUrl, level, xp, needed, rank, totalXp, messages, voiceMinutes, ryo, grade, seasonRank }
 * @returns {Promise<Buffer>} image PNG 1104×502
 */
async function renderRankCard(d) {
  const pct = Math.max(0, Math.min(1, d.needed ? d.xp / d.needed : 0));
  const avatar = d.avatarUrl ? await avatarDataUri(d.avatarUrl) : null;
  const bg = background();
  const name = cut(noEmoji(d.username) || 'Ronin', 22);
  const grade = cut(noEmoji(d.grade) || 'Ronin', 22);
  const nameSize = fit(name, 64, 330);
  const gradeSize = fit(grade, 46, 270);
  const level = String(d.level ?? 0);
  const levelSize = level.length >= 3 ? 104 : 128;
  const rankText = d.rank ? `#${String(d.rank).padStart(2, '0')} au classement` : 'Pas encore classé';
  const barX = 340;
  const barY = 292;
  const barW = 690;
  const stats = [
    ['star', 'XP TOTAL', num(d.totalXp)],
    ['coins', 'RYŌ', num(d.ryo)],
    ['chat', 'MESSAGES', num(d.messages)],
    ['mic', 'VOCAL', `${num(Math.floor((d.voiceMinutes ?? 0) / 60))} h`],
  ];
  const colW = barW / 4;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.goldLight}"/><stop offset=".5" stop-color="${C.gold}"/><stop offset="1" stop-color="#b8780f"/></linearGradient>
    <linearGradient id="goldH" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.gold}" stop-opacity="0"/><stop offset=".5" stop-color="${C.gold}"/><stop offset="1" stop-color="${C.gold}" stop-opacity="0"/></linearGradient>
    <linearGradient id="bar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.redDeep}"/><stop offset=".6" stop-color="${C.red}"/><stop offset="1" stop-color="${C.redLight}"/></linearGradient>
    <radialGradient id="shade" cx=".45" cy=".5" r=".6"><stop offset="0" stop-color="#000" stop-opacity=".72"/><stop offset=".7" stop-color="#000" stop-opacity=".45"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    <clipPath id="av"><circle cx="178" cy="206" r="112"/></clipPath>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="shadow" x="-10%" y="-30%" width="120%" height="160%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000" flood-opacity=".95"/></filter>
  </defs>
  ${bg ? `<image width="${W}" height="${H}" xlink:href="${bg}"/>` : `<rect width="${W}" height="${H}" fill="${C.ink}"/><rect x="14" y="14" width="${W - 28}" height="${H - 28}" fill="none" stroke="${C.gold}" stroke-width="3"/>`}
  <ellipse cx="640" cy="250" rx="470" ry="230" fill="url(#shade)"/>

  <!-- Avatar -->
  <circle cx="178" cy="206" r="124" fill="#0b0405" stroke="${C.red}" stroke-width="7" filter="url(#glow)"/>
  ${avatar ? `<image x="66" y="94" width="224" height="224" clip-path="url(#av)" preserveAspectRatio="xMidYMid slice" xlink:href="${avatar}"/>` : `<text x="178" y="245" text-anchor="middle" font-family="${F.brush}" font-size="110" fill="${C.red}">${esc(name[0]?.toUpperCase() ?? '?')}</text>`}
  <circle cx="178" cy="206" r="131" fill="none" stroke="url(#gold)" stroke-width="2.5" opacity=".9"/>

  <!-- Pseudo, grade, classement -->
  <text x="${barX}" y="112" font-family="${F.brush}" font-size="${nameSize}" fill="#f4f1f1" filter="url(#shadow)">${esc(name)}</text>
  <g transform="translate(${barX},148)">${EMBLEM}</g>
  <text x="${barX + 54}" y="184" font-family="${F.brush}" font-size="${gradeSize}" fill="url(#gold)" filter="url(#shadow)">${esc(grade)}</text>
  <text x="${barX + 2}" y="236" font-family="${F.serif}" font-weight="600" font-size="22" fill="#e9e4e4" filter="url(#shadow)">${esc(rankText)}${d.seasonRank ? `<tspan fill="${C.muted}">  ·  saison #${d.seasonRank}</tspan>` : ''}</text>

  <!-- Niveau -->
  <line x1="742" y1="62" x2="742" y2="248" stroke="${C.gold}" stroke-opacity=".6" stroke-width="2"/>
  <text x="868" y="104" text-anchor="middle" font-family="${F.brush}" font-size="40" fill="#f4f1f1" filter="url(#shadow)">Niveau</text>
  <text x="868" y="${levelSize > 110 ? 236 : 226}" text-anchor="middle" font-family="${F.brush}" font-size="${levelSize}" fill="url(#gold)" filter="url(#shadow)">${esc(level)}</text>
  <path d="M790 250 Q870 236 958 244" stroke="url(#gold)" stroke-width="3" fill="none" opacity=".75"/>

  <!-- Barre d'XP -->
  <rect x="${barX}" y="${barY}" width="${barW}" height="30" rx="15" fill="#120708" stroke="${C.gold}" stroke-opacity=".55" stroke-width="2"/>
  <rect x="${barX + 3}" y="${barY + 3}" width="${Math.max(24, (barW - 6) * pct).toFixed(1)}" height="24" rx="12" fill="url(#bar)" filter="url(#glow)"/>
  <text x="${barX + barW - 16}" y="${barY + 22}" text-anchor="end" font-family="${F.serif}" font-weight="800" font-size="18" fill="#ffffff" filter="url(#shadow)">${num(d.xp)} / ${num(d.needed)} XP</text>

  <!-- Statistiques -->
  ${stats
    .map(([icon, label, value], k) => {
      const x = barX + k * colW;
      return `<g transform="translate(${x + 6},372)">${ICONS[icon]}</g>
  <text x="${x + 50}" y="384" font-family="${F.serif}" font-weight="600" font-size="15" letter-spacing="1.5" fill="#c9c2c2" filter="url(#shadow)">${label}</text>
  <text x="${x + 50}" y="414" font-family="${F.serif}" font-weight="800" font-size="${value.length > 9 ? 22 : 27}" fill="#f4f1f1" filter="url(#shadow)">${esc(value)}</text>
  ${k ? `<line x1="${x - 8}" y1="366" x2="${x - 8}" y2="420" stroke="${C.gold}" stroke-opacity=".45" stroke-width="1.5"/>` : ''}`;
    })
    .join('\n  ')}
</svg>`;
  return new Resvg(svg, { font: resvgFont(), fitTo: { mode: 'original' } }).render().asPng();
}

module.exports = { renderRankCard };
