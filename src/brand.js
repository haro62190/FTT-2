/**
 * Direction artistique officielle de Kensei — Les Ronins de haro62190.
 * Source unique des couleurs et signatures utilisées par Discord, les cartes et le dashboard.
 */
const BRAND = Object.freeze({
  name: '剣聖 Kensei',
  community: 'Les Ronins de haro62190',
  kanji: '浪人',
  colors: Object.freeze({
    ink: '#08080b',
    panel: '#111116',
    panelRaised: '#191920',
    line: '#303039',
    text: '#f4f1f1',
    muted: '#aaa4aa',
    red: '#e10600',
    redLight: '#ff4038',
    redDeep: '#65070b',
    gold: '#f5b942',
    goldLight: '#ffe39a',
    success: '#54c987',
    warning: '#e8b84c',
  }),
  fonts: Object.freeze({
    latin: "'DejaVu Sans', 'Segoe UI', Arial, sans-serif",
    display: "'DejaVu Sans', 'Segoe UI Black', 'Segoe UI', Arial, sans-serif",
    japanese: "'Noto Sans CJK JP', 'Yu Gothic', sans-serif",
    // Polices livrées avec le bot (assets/fonts, licence OFL) : pinceau, serif gravé, kanji pinceau
    brush: "'Kaushan Script', 'Segoe Script', cursive",
    serif: "'Cinzel', 'Trajan Pro', Georgia, serif",
    kanji: "'Yuji Syuku', 'Noto Serif CJK JP', 'Yu Mincho', serif",
  }),
  effects: Object.freeze({
    redGlow: 'rgba(225, 6, 0, .32)',
    goldGlow: 'rgba(245, 185, 66, .22)',
    radius: 16,
  }),
});

const path = require('path');
const fs = require('fs');
const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
/** Fichiers de police pour resvg (images générées par le bot). */
const fontFiles = () => (fs.existsSync(FONT_DIR) ? fs.readdirSync(FONT_DIR).filter((f) => /\.(ttf|otf)$/i.test(f)).map((f) => path.join(FONT_DIR, f)) : []);
const resvgFont = () => ({ fontFiles: fontFiles(), loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' });

module.exports = { BRAND, fontFiles, resvgFont, FONT_DIR };
