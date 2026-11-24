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
  }),
  effects: Object.freeze({
    redGlow: 'rgba(225, 6, 0, .32)',
    goldGlow: 'rgba(245, 185, 66, .22)',
    radius: 16,
  }),
});

module.exports = { BRAND };
