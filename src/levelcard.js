/**
 * Bannière « Passage de niveau » d'après la maquette officielle Kensei :
 * décor samouraï / lune rouge / pagodes (assets/levelup-bg.jpg), cadre rouge et or,
 * « 剣聖 KENSEI » et « LES RONINS » en tête, félicitations au pinceau doré, plaque « Nouveau grade ».
 */
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const { BRAND, resvgFont } = require('./brand');

const BG = path.join(__dirname, '..', 'assets', 'levelup-bg.jpg');
const C = BRAND.colors;
const F = BRAND.fonts;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const cut = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
// Les emojis ne sont pas dans les polices : on les retire du texte dessiné
const noEmoji = (s) => String(s ?? '').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim();
// Taille de police pour qu'une ligne tienne dans `width` (Kaushan Script ≈ 0,5 × taille par caractère)
const fit = (text, max, width) => Math.max(30, Math.min(max, Math.floor(width / (Math.max(1, text.length) * 0.5))));

let bgUri = null;
const background = () => (bgUri ??= `data:image/jpeg;base64,${fs.readFileSync(BG).toString('base64')}`);
const available = () => fs.existsSync(BG);

// Coin de cadre doré (motif de clé japonaise), dessiné en haut à gauche puis retourné pour les 3 autres coins
const CORNER = '<path d="M0 0H70M0 0V70M10 10H54V24H24V54H10Z" fill="none" stroke="url(#gold)" stroke-width="3"/><path d="M18 18H40V32H32V40H18Z" fill="url(#gold)" opacity=".85"/>';

/**
 * @param {{ username: string, level: number, grade?: string }} d
 * @returns {Buffer} PNG 1300×400
 */
function renderLevelUp({ username, level, grade = null }) {
  const W = 1634;
  const H = 502;
  const name = cut(noEmoji(username) || 'Ronin', 22);
  const gradeName = grade ? cut(noEmoji(grade), 24) : null;
  const title = `Félicitations ${name} !`;
  const titleSize = fit(title, 92, 1250);
  const plate = gradeName ? `Nouveau grade : ${gradeName}` : null;
  const plateW = plate ? Math.min(760, Math.max(380, plate.length * 17 + 120)) : 0;
  const y1 = plate ? 322 : 350;
  const y2 = plate ? 386 : 425;
  const corners = [
    `translate(26,26)`,
    `translate(${W - 26},26) scale(-1,1)`,
    `translate(26,${H - 26}) scale(1,-1)`,
    `translate(${W - 26},${H - 26}) scale(-1,-1)`,
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.goldLight}"/><stop offset=".5" stop-color="${C.gold}"/><stop offset="1" stop-color="#b8780f"/></linearGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset=".45" stop-color="#000" stop-opacity=".1"/><stop offset=".72" stop-color="#000" stop-opacity=".6"/><stop offset="1" stop-color="#000" stop-opacity=".88"/></linearGradient>
    <linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>
    <linearGradient id="plate" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a0b0b"/><stop offset="1" stop-color="#0b0405"/></linearGradient>
    <filter id="shadow" x="-5%" y="-30%" width="110%" height="160%"><feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#000" flood-opacity=".95"/></filter>
    <filter id="glow" x="-5%" y="-40%" width="110%" height="180%"><feGaussianBlur in="SourceAlpha" stdDeviation="7" result="b"/><feFlood flood-color="${C.red}" flood-opacity=".6"/><feComposite in2="b" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="${C.ink}"/>
  <image width="${W}" height="${H}" preserveAspectRatio="xMidYMin slice" xlink:href="${background()}"/>
  <rect width="${W}" height="130" fill="url(#top)"/>
  <rect y="${H * 0.35}" width="${W}" height="${H * 0.65}" fill="url(#fade)"/>

  <!-- Cadre rouge et or -->
  <rect x="6" y="6" width="${W - 12}" height="${H - 12}" fill="none" stroke="${C.red}" stroke-width="6"/>
  <rect x="18" y="18" width="${W - 36}" height="${H - 36}" fill="none" stroke="url(#gold)" stroke-width="2" opacity=".8"/>
  ${corners.map((t) => `<g transform="${t}">${CORNER}</g>`).join('')}

  <!-- En-tête -->
  <text x="70" y="104" font-family="${F.kanji}" font-size="64" fill="#f4f1f1" filter="url(#shadow)">剣聖</text>
  <text x="212" y="102" font-family="${F.brush}" font-size="58" fill="url(#gold)" filter="url(#shadow)">KENSEI</text>
  <text x="${W - 70}" y="96" text-anchor="end" font-family="${F.brush}" font-size="46" fill="#e9e4e4" filter="url(#shadow)">LES RONINS</text>

  <!-- Félicitations -->
  <text x="${W / 2}" y="${y1}" text-anchor="middle" font-family="${F.brush}" font-size="${titleSize}" fill="url(#gold)" filter="url(#shadow)">${esc(title)}</text>
  <text x="${W / 2}" y="${y2}" text-anchor="middle" font-family="${F.brush}" font-size="50" fill="#f7f3f3" filter="url(#shadow)">Tu viens d’atteindre le <tspan fill="${C.redLight}" filter="url(#glow)">niveau ${Number(level)}</tspan> !</text>
  ${
    plate
      ? `<g transform="translate(${W / 2},438)">
    <path d="M${-plateW / 2} 0 L${-plateW / 2 + 26} -30 H${plateW / 2 - 26} L${plateW / 2} 0 L${plateW / 2 - 26} 30 H${-plateW / 2 + 26} Z" fill="url(#plate)" stroke="url(#gold)" stroke-width="2.5"/>
    <path d="M${-plateW / 2 - 14} 0 l10 -10 l10 10 l-10 10z M${plateW / 2 + 14} 0 l-10 -10 l-10 10 l10 10z" fill="url(#gold)"/>
    <text y="11" text-anchor="middle" font-family="${F.brush}" font-size="32" fill="url(#gold)">${esc(plate)}</text>
  </g>`
      : ''
  }
</svg>`;
  return new Resvg(svg, { fitTo: { mode: 'width', value: 1300 }, font: resvgFont() }).render().asPng();
}

/**
 * Annonce un passage de niveau : bannière en image (si activée) + texte, avec repli sur le texte seul.
 * @param channel salon où annoncer · member : GuildMember · rewards : rôles obtenus (avec `bonus` en ryō)
 */
async function announce(channel, member, level, rewards = [], { voice = false } = {}) {
  if (!channel) return;
  require('./feed').member(member.id, '⚔️', `Niveau ${level}${rewards.length ? ` · grade ${rewards.map((r) => r.name).join(', ')}` : ''}`);
  require('./feed').push('🏆', `${member.displayName ?? member.user?.username} a atteint le niveau ${level}${rewards.length ? ` (${rewards.map((r) => r.name).join(', ')})` : ''}`);
  const { AttachmentBuilder } = require('discord.js');
  const settings = require('./settings');
  const text =
    `${voice ? '🎙️' : '⚔️'} GG ${member}, tu passes au **niveau ${level}**${voice ? ' en vocal' : ''} !` +
    (rewards.length ? `\n🎖️ Nouveau grade : ${rewards.map((r) => `**${r.name}**${r.bonus ? ` (+${r.bonus} 両)` : ''}`).join(', ')}` : '');
  let files = [];
  if (settings.get('levels.banner') !== false && available()) {
    try {
      const png = renderLevelUp({ username: member.displayName ?? member.user?.username, level, grade: rewards.at(-1)?.name ?? null });
      files = [new AttachmentBuilder(png, { name: `niveau-${level}.png` })];
    } catch (err) {
      console.error('Bannière de niveau :', err.message);
    }
  }
  await channel.send({ content: text, files, allowedMentions: { users: [member.id] } }).catch(() => {});
}

module.exports = { renderLevelUp, available, announce };
