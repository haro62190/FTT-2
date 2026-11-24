/**
 * Bannière « Passage de niveau » (image fournie par haro62190 : assets/levelup.jpg).
 * Le texte d'exemple « {level} » de l'image est masqué puis réécrit avec le pseudo et le vrai niveau.
 */
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const { BRAND } = require('./brand');

const BG = path.join(__dirname, '..', 'assets', 'levelup.jpg');
const FONT = BRAND.fonts.display;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const cut = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
// Les emojis ne sont pas dans les polices du serveur : on les retire du texte dessiné
const noEmoji = (s) => String(s ?? '').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim();
// Taille de police pour qu'une ligne tienne dans le cadre (≈ 620 px de large)
const fit = (text, max, width = 620) => Math.max(26, Math.min(max, Math.floor(width / (text.length * 0.6))));

let bgUri = null;
const background = () => (bgUri ??= `data:image/jpeg;base64,${fs.readFileSync(BG).toString('base64')}`);
const available = () => fs.existsSync(BG);

/**
 * @param {{ username: string, level: number, grade?: string }} d
 * @returns {Buffer} PNG 1280×720
 */
function renderLevelUp({ username, level, grade = null }) {
  const W = 1672;
  const H = 941;
  const name = cut(noEmoji(username) || 'Ronin', 24);
  const gradeName = grade ? cut(noEmoji(grade), 24) : null;
  const line2 = Boolean(gradeName);
  const title = `Félicitations ${name} !`;
  const titleSize = fit(title, line2 ? 44 : 50);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BRAND.colors.goldLight}"/><stop offset=".55" stop-color="${BRAND.colors.gold}"/><stop offset="1" stop-color="#b87916"/></linearGradient>
    <linearGradient id="roninRed" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${BRAND.colors.redDeep}"/><stop offset=".5" stop-color="${BRAND.colors.red}"/><stop offset="1" stop-color="${BRAND.colors.redLight}"/></linearGradient>
    <filter id="soft" x="-5%" y="-20%" width="110%" height="140%"><feGaussianBlur stdDeviation="6"/></filter>
    <filter id="glow" x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur in="SourceAlpha" stdDeviation="5" result="b"/><feFlood flood-color="${BRAND.colors.gold}" flood-opacity=".55"/><feComposite in2="b" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="shadow" x="-5%" y="-30%" width="110%" height="160%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000" flood-opacity=".9"/></filter>
  </defs>
  <image width="${W}" height="${H}" xlink:href="${background()}"/>
  <rect x="8" y="8" width="${W-16}" height="${H-16}" rx="22" fill="none" stroke="url(#roninRed)" stroke-width="8" opacity=".9"/>
  <path d="M48 48 H360 M1312 893 H1624" stroke="${BRAND.colors.gold}" stroke-width="3" opacity=".85"/>
  <text x="64" y="94" font-family="${FONT}" font-size="28" font-weight="900" letter-spacing="5" fill="${BRAND.colors.text}" opacity=".92">剣聖 KENSEI</text>
  <text x="1608" y="94" text-anchor="end" font-family="${FONT}" font-size="20" font-weight="700" letter-spacing="3" fill="${BRAND.colors.gold}">LES RONINS</text>
  <!-- On efface le texte d'exemple du cadre -->
  <rect x="505" y="658" width="680" height="132" rx="14" fill="${BRAND.colors.ink}" filter="url(#soft)"/>
  <rect x="520" y="662" width="650" height="122" rx="10" fill="#090506"/>
  <text x="845" y="${line2 ? 716 : 722}" text-anchor="middle" font-family="${FONT}" font-weight="900" font-style="italic" font-size="${titleSize}" fill="url(#gold)" filter="url(#glow)">${esc(title)}</text>
  <text x="845" y="${line2 ? 758 : 770}" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="${line2 ? 30 : 34}" fill="${BRAND.colors.text}" filter="url(#shadow)">Tu viens d’atteindre le niveau <tspan fill="url(#gold)" font-weight="900" font-size="${line2 ? 36 : 42}">${Number(level)}</tspan> !</text>
  ${line2 ? `<text x="845" y="786" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="22" fill="${BRAND.colors.redLight}" filter="url(#shadow)">${esc(`Nouveau grade : ${gradeName}`)}</text>` : ''}
</svg>`;
  return new Resvg(svg, { fitTo: { mode: 'width', value: 1280 }, font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' } }).render().asPng();
}

/**
 * Annonce un passage de niveau : bannière en image (si activée) + texte, avec repli sur le texte seul.
 * @param channel salon où annoncer · member : GuildMember · rewards : rôles obtenus (avec `bonus` en ryō)
 */
async function announce(channel, member, level, rewards = [], { voice = false } = {}) {
  if (!channel) return;
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
