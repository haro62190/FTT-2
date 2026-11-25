/**
 * 🏮 Bannière de bienvenue en image : même décor que la bannière de niveau (lune rouge, pagodes),
 * avatar du membre dans un cercle rouge et or, « Bienvenue » au pinceau, pseudo et numéro de membre.
 */
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const { BRAND, resvgFont } = require('./brand');
const { avatarDataUri } = require('./rankcard');

const BG = path.join(__dirname, '..', 'assets', 'levelup-bg.jpg');
const C = BRAND.colors;
const F = BRAND.fonts;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const noEmoji = (s) => String(s ?? '').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim();
const cut = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

let bgUri = null;
const background = () => (bgUri ??= `data:image/jpeg;base64,${fs.readFileSync(BG).toString('base64')}`);
const available = () => fs.existsSync(BG);

/**
 * @param {{ username: string, avatarUrl?: string, count?: number, server?: string }} d
 * @returns {Promise<Buffer>} PNG 1300 px de large
 */
async function renderWelcome({ username, avatarUrl = null, count = null, server = BRAND.community }) {
  const W = 1634;
  const H = 560;
  const name = cut(noEmoji(username) || 'Ronin', 22);
  const nameSize = Math.max(44, Math.min(92, Math.floor(980 / (Math.max(1, name.length) * 0.5))));
  const avatar = avatarUrl ? await avatarDataUri(avatarUrl) : null;
  const AX = 300;
  const AY = 300;
  const R = 150;
  const TX = 560;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.goldLight}"/><stop offset=".5" stop-color="${C.gold}"/><stop offset="1" stop-color="#b8780f"/></linearGradient>
    <linearGradient id="side" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".2"/><stop offset=".3" stop-color="#000" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity=".82"/></linearGradient>
    <clipPath id="av"><circle cx="${AX}" cy="${AY}" r="${R}"/></clipPath>
    <filter id="shadow" x="-5%" y="-30%" width="110%" height="160%"><feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#000" flood-opacity=".95"/></filter>
    <filter id="halo" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="14"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="${C.ink}"/>
  <image width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" xlink:href="${background()}"/>
  <rect width="${W}" height="${H}" fill="url(#side)"/>
  <rect x="6" y="6" width="${W - 12}" height="${H - 12}" fill="none" stroke="${C.red}" stroke-width="6"/>
  <rect x="18" y="18" width="${W - 36}" height="${H - 36}" fill="none" stroke="url(#gold)" stroke-width="2" opacity=".8"/>

  <circle cx="${AX}" cy="${AY}" r="${R + 14}" fill="${C.red}" opacity=".55" filter="url(#halo)"/>
  <circle cx="${AX}" cy="${AY}" r="${R}" fill="${C.panel}"/>
  ${avatar ? `<image x="${AX - R}" y="${AY - R}" width="${R * 2}" height="${R * 2}" clip-path="url(#av)" preserveAspectRatio="xMidYMid slice" xlink:href="${avatar}"/>` : `<text x="${AX}" y="${AY + 40}" text-anchor="middle" font-family="${F.brush}" font-size="130" fill="${C.red}">${esc(name[0]?.toUpperCase() ?? '?')}</text>`}
  <circle cx="${AX}" cy="${AY}" r="${R}" fill="none" stroke="${C.red}" stroke-width="8"/>
  <circle cx="${AX}" cy="${AY}" r="${R + 10}" fill="none" stroke="url(#gold)" stroke-width="3"/>

  <text x="${TX}" y="118" font-family="${F.kanji}" font-size="56" fill="#f4f1f1" filter="url(#shadow)">浪人</text>
  <text x="${TX}" y="228" font-family="${F.brush}" font-size="96" fill="url(#gold)" filter="url(#shadow)">Bienvenue</text>
  <text x="${TX}" y="${228 + nameSize + 14}" font-family="${F.brush}" font-size="${nameSize}" fill="#f7f3f3" filter="url(#shadow)">${esc(name)}</text>
  <text x="${TX}" y="472" font-family="${F.serif}" font-size="34" letter-spacing="2" fill="${C.goldLight}" filter="url(#shadow)">${esc(cut(noEmoji(server), 34).toUpperCase())}</text>
  ${count ? `<text x="${W - 60}" y="472" text-anchor="end" font-family="${F.brush}" font-size="44" fill="${C.redLight}" filter="url(#shadow)">Ronin n°${Number(count).toLocaleString('fr-FR')}</text>` : ''}
</svg>`;
  return new Resvg(svg, { fitTo: { mode: 'width', value: 1300 }, font: resvgFont() }).render().asPng();
}

module.exports = { renderWelcome, available };
