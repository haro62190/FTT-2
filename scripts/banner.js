/**
 * Génère la bannière du serveur (assets/banner.png, 1920×1080) à partir du décor Kensei
 * (assets/levelup-bg.jpg : samouraï, lune rouge, torii, pagodes). Utilisation : npm run banner
 */
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const { BRAND, resvgFont } = require('../src/brand');

const W = 1920;
const H = 1080;
const C = BRAND.colors;
const F = BRAND.fonts;
const bg = `data:image/jpeg;base64,${fs.readFileSync(path.join(__dirname, '..', 'assets', 'levelup-bg.jpg')).toString('base64')}`;
const BAND_Y = 352;
const BAND_H = Math.round((W / 1634) * 382); // 449

const corner = '<path d="M0 0H90M0 0V90M14 14H62V30H30V62H14Z" fill="none" stroke="url(#gold)" stroke-width="3"/><path d="M22 22H46V38H38V46H22Z" fill="url(#gold)" opacity=".9"/>';
const corners = [`translate(34,34)`, `translate(${W - 34},34) scale(-1,1)`, `translate(34,${H - 34}) scale(1,-1)`, `translate(${W - 34},${H - 34}) scale(-1,-1)`];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.goldLight}"/><stop offset=".5" stop-color="${C.gold}"/><stop offset="1" stop-color="#b8780f"/></linearGradient>
    <linearGradient id="goldH" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.gold}" stop-opacity="0"/><stop offset=".5" stop-color="${C.gold}"/><stop offset="1" stop-color="${C.gold}" stop-opacity="0"/></linearGradient>
    <linearGradient id="bandFade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".12" stop-color="#fff"/><stop offset=".88" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <mask id="band"><rect y="${BAND_Y}" width="${W}" height="${BAND_H}" fill="url(#bandFade)"/></mask>
    <radialGradient id="sun" cx=".5" cy=".42" r=".6"><stop offset="0" stop-color="${C.red}" stop-opacity=".38"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    <linearGradient id="shadeTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050304" stop-opacity=".92"/><stop offset="1" stop-color="#050304" stop-opacity=".55"/></linearGradient>
    <filter id="blur" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="22"/></filter>
    <filter id="shadow" x="-10%" y="-30%" width="120%" height="160%"><feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000" flood-opacity=".95"/></filter>
    <filter id="glow" x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur in="SourceAlpha" stdDeviation="12" result="b"/><feFlood flood-color="${C.red}" flood-opacity=".7"/><feComposite in2="b" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>

  <!-- Fond : le décor agrandi et flouté, assombri -->
  <rect width="${W}" height="${H}" fill="#050304"/>
  <image x="-300" y="-140" width="${W + 600}" height="${H + 280}" preserveAspectRatio="xMidYMid slice" xlink:href="${bg}" filter="url(#blur)" opacity=".75"/>
  <rect width="${W}" height="${H}" fill="url(#shadeTop)"/>
  <rect width="${W}" height="${H}" fill="url(#sun)"/>

  <!-- Bandeau net : samouraï, lune, torii, pagodes -->
  <image y="${BAND_Y}" width="${W}" height="${BAND_H}" xlink:href="${bg}" mask="url(#band)"/>
  <rect x="0" y="${BAND_Y - 2}" width="${W}" height="2" fill="url(#goldH)"/>
  <rect x="0" y="${BAND_Y + BAND_H}" width="${W}" height="2" fill="url(#goldH)"/>

  <!-- Titre -->
  <text x="${W / 2}" y="118" text-anchor="middle" font-family="${F.kanji}" font-size="44" letter-spacing="26" fill="${C.redLight}" opacity=".95" filter="url(#shadow)">浪人</text>
  <text x="${W / 2}" y="268" text-anchor="middle" font-family="${F.brush}" font-size="150" fill="url(#gold)" filter="url(#shadow)">Les Ronins</text>
  <text x="${W / 2}" y="330" text-anchor="middle" font-family="${F.serif}" font-weight="600" font-size="34" letter-spacing="14" fill="#f4f1f1" filter="url(#shadow)">DE HARO62190</text>

  <!-- Bas -->
  <path d="M${W / 2 - 360} 890 H${W / 2 - 40} M${W / 2 + 40} 890 H${W / 2 + 360}" stroke="url(#goldH)" stroke-width="2"/>
  <path d="M${W / 2} 878 l12 12 l-12 12 l-12 -12z" fill="url(#gold)"/>
  <text x="${W / 2}" y="955" text-anchor="middle" font-family="${F.serif}" font-weight="600" font-size="30" letter-spacing="9" fill="#e9e4e4" filter="url(#shadow)">STREAMS  ·  GAMING  ·  COMMUNAUTÉ</text>

  <!-- Cadre -->
  <rect x="14" y="14" width="${W - 28}" height="${H - 28}" fill="none" stroke="${C.red}" stroke-width="6" opacity=".9"/>
  <rect x="28" y="28" width="${W - 56}" height="${H - 56}" fill="none" stroke="url(#gold)" stroke-width="2" opacity=".7"/>
  ${corners.map((t) => `<g transform="${t}">${corner}</g>`).join('')}
</svg>`;

const out = path.join(__dirname, '..', 'assets', 'banner.png');
fs.writeFileSync(out, new Resvg(svg, { font: resvgFont(), fitTo: { mode: 'original' } }).render().asPng());
console.log(`🖼️  Bannière générée : ${out}`);
