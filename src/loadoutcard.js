/**
 * Image d'une classe méta (/meta) aux couleurs Kensei : fond de la carte de rang (cadre doré, sakura, 浪人),
 * nom de l'arme au pinceau, jeu / mode / palier, accessoires sur deux colonnes, code de partage.
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
const cut = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const noEmoji = (s) => String(s ?? '').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim();
const fit = (text, max, width, ratio) => Math.max(18, Math.min(max, Math.floor(width / (Math.max(1, text.length) * ratio))));

let bgUri = null;
const background = () => (bgUri ??= fs.existsSync(BG) ? `data:image/jpeg;base64,${fs.readFileSync(BG).toString('base64')}` : null);
const TIER_COLOR = { S: C.gold, A: C.redLight, B: '#c9c2c2', C: '#8f8a8f' };

/** @returns {Buffer} PNG 1104×502 */
function renderLoadout(l) {
  const bg = background();
  const weapon = cut(noEmoji(l.weapon) || 'Arme', 24);
  const weaponSize = fit(weapon, 66, 600, 0.5);
  const sub = [...new Set([l.game, l.mode, l.category].filter(Boolean).map((s) => noEmoji(s)))].join('  ·  ').toUpperCase();
  const items = (l.attachments ?? []).slice(0, 8);
  const perCol = Math.ceil(items.length / 2) || 1;
  const rowH = items.length > 6 ? 54 : 62;
  const tier = l.tier ?? 'A';
  const cell = (a, k) => {
    const col = k < perCol ? 0 : 1;
    const row = k % perCol;
    const x = 96 + col * 330;
    const y = 208 + row * rowH;
    const name = cut(noEmoji(a.name), 26);
    return `<rect x="${x - 16}" y="${y - 22}" width="4" height="40" fill="${C.red}"/>
  <text x="${x}" y="${y - 4}" font-family="${F.serif}" font-weight="600" font-size="13" letter-spacing="1.5" fill="#bdb6b6" filter="url(#shadow)">${esc(cut(noEmoji(a.slot), 22).toUpperCase())}</text>
  <text x="${x}" y="${y + 20}" font-family="${F.serif}" font-weight="800" font-size="${fit(name, 22, 300, 0.62)}" fill="#f4f1f1" filter="url(#shadow)">${esc(name)}</text>`;
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.goldLight}"/><stop offset=".5" stop-color="${C.gold}"/><stop offset="1" stop-color="#b8780f"/></linearGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".82"/><stop offset=".62" stop-color="#000" stop-opacity=".7"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>
    <filter id="shadow" x="-10%" y="-30%" width="120%" height="160%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000" flood-opacity=".95"/></filter>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  ${bg ? `<image width="${W}" height="${H}" xlink:href="${bg}"/>` : `<rect width="${W}" height="${H}" fill="${C.ink}"/>`}
  <rect x="40" y="40" width="760" height="${H - 80}" rx="14" fill="url(#shade)"/>

  <text x="80" y="90" font-family="${F.serif}" font-weight="600" font-size="16" letter-spacing="2.5" fill="${C.gold}" filter="url(#shadow)">${esc(cut(sub, 60))}</text>
  <text x="78" y="152" font-family="${F.brush}" font-size="${weaponSize}" fill="#f7f3f3" filter="url(#shadow)">${esc(weapon)}</text>
  <line x1="80" y1="172" x2="760" y2="172" stroke="${C.gold}" stroke-opacity=".55" stroke-width="1.5"/>

  ${items.map(cell).join('\n  ')}

  ${l.code ? `<text x="80" y="${H - 64}" font-family="${F.serif}" font-weight="600" font-size="15" letter-spacing="2" fill="#bdb6b6" filter="url(#shadow)">CODE DE LA CLASSE  <tspan font-weight="800" font-size="22" fill="url(#gold)" letter-spacing="1">${esc(cut(noEmoji(l.code), 30))}</tspan></text>` : ''}

  <!-- Palier -->
  <circle cx="900" cy="150" r="74" fill="#0b0405" fill-opacity=".85" stroke="${TIER_COLOR[tier] ?? C.gold}" stroke-width="4" filter="url(#glow)"/>
  <text x="900" y="122" text-anchor="middle" font-family="${F.serif}" font-weight="600" font-size="15" letter-spacing="3" fill="#e9e4e4">PALIER</text>
  <text x="900" y="194" text-anchor="middle" font-family="${F.brush}" font-size="82" fill="${tier === 'S' ? 'url(#gold)' : TIER_COLOR[tier] ?? '#fff'}">${esc(tier)}</text>
  <text x="900" y="${H - 64}" text-anchor="middle" font-family="${F.brush}" font-size="30" fill="url(#gold)" filter="url(#shadow)">Classe méta</text>
</svg>`;
  return new Resvg(svg, { font: resvgFont(), fitTo: { mode: 'original' } }).render().asPng();
}

module.exports = { renderLoadout };
