/**
 * Graphiques SVG générés côté serveur (le tableau de bord n'exécute aucun script : CSP stricte).
 * Palette catégorielle validée sur le fond sombre #141416 (scripts/validate_palette.js du guide dataviz) :
 * série 1 = bleu #3987e5, série 2 = orange #d95926. Le rouge du thème reste réservé à l'interface et aux alertes.
 * Survol : chaque jour a une zone de survol (plus large que le point) avec une infobulle native (<title>).
 */
const SERIES = ['#3987e5', '#d95926'];
const INK = { primary: '#e8e8ea', secondary: '#c3c2b7', muted: '#9a9aa2', grid: '#2c2c2a', surface: '#141416' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => (n === null || n === undefined ? '—' : Math.round(n).toLocaleString('fr-FR'));
const dateFr = (iso) => {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
};

/** Valeurs « propres » pour l'axe Y : 0 … max arrondi */
function niceMax(max) {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * pow).find((s) => max / s <= 4) ?? 10 * pow;
  return Math.ceil(max / step) * step;
}

/**
 * Courbe(s) sur une période.
 * @param {object} o { points: [{date, ...}], series: [{ key, label }], unit, zeroBased }
 */
function lineChart({ points, series, unit = '', zeroBased = true }) {
  const W = 640;
  const H = 210;
  const L = 48;
  const R = series.length > 1 ? 92 : 64;
  const T = 14;
  const B = 28;
  const iw = W - L - R;
  const ih = H - T - B;
  const vals = series.flatMap((s) => points.map((p) => p[s.key]).filter((v) => typeof v === 'number'));
  if (!vals.length) return `<p class="muted">Pas encore de données : elles s'accumulent jour après jour.</p>`;
  const lo = zeroBased ? 0 : Math.min(...vals);
  const hiRaw = Math.max(...vals);
  const hi = zeroBased ? niceMax(hiRaw) : hiRaw === lo ? lo + 1 : hiRaw + (hiRaw - lo) * 0.1;
  const min = zeroBased ? 0 : Math.max(0, lo - (hi - lo) * 0.1);
  const x = (i) => L + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v) => T + ih - ((v - min) / (hi - min || 1)) * ih;
  const ticks = [0, 0.5, 1].map((t) => min + t * (hi - min));

  const grid = ticks
    .map((v) => `<line x1="${L}" x2="${L + iw}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${INK.grid}" stroke-width="1"/>
      <text x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="${INK.muted}">${fmt(v)}</text>`)
    .join('');
  const xLabels = [0, Math.floor((points.length - 1) / 2), points.length - 1]
    .filter((v, i, a) => a.indexOf(v) === i)
    .map((i) => `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="${INK.muted}">${dateFr(points[i].date)}</text>`)
    .join('');

  const lines = series
    .map((s, si) => {
      const color = SERIES[si];
      const pts = points.map((p, i) => [i, p[s.key]]).filter(([, v]) => typeof v === 'number');
      if (!pts.length) return '';
      const d = pts.map(([i, v], k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
      const area =
        series.length === 1 && zeroBased
          ? `<path d="${d}L${x(pts.at(-1)[0]).toFixed(1)},${y(min).toFixed(1)}L${x(pts[0][0]).toFixed(1)},${y(min).toFixed(1)}Z" fill="${color}" fill-opacity=".12"/>`
          : '';
      const [li, lv] = pts.at(-1);
      // Étiquette directe sur le dernier point (avec le nom de la série s'il y en a plusieurs)
      return `${area}<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${x(li).toFixed(1)}" cy="${y(lv).toFixed(1)}" r="4.5" fill="${color}" stroke="${INK.surface}" stroke-width="2"/>
        <text x="${(x(li) + 9).toFixed(1)}" y="${(y(lv) + 4 + (series.length > 1 ? si * 13 - 6 : 0)).toFixed(1)}" font-size="12" font-weight="600" fill="${INK.primary}">${fmt(lv)}${series.length > 1 ? `<tspan fill="${INK.muted}" font-weight="400"> ${esc(s.label)}</tspan>` : ''}</text>`;
    })
    .join('');

  // Zones de survol : une colonne par jour, infobulle avec toutes les valeurs
  const colW = iw / Math.max(1, points.length - 1);
  const hover = points
    .map((p, i) => {
      const tip = `${dateFr(p.date)} — ${series.map((s) => `${s.label} : ${fmt(p[s.key])}${unit}`).join(' · ')}`;
      return `<rect x="${(x(i) - colW / 2).toFixed(1)}" y="${T}" width="${colW.toFixed(1)}" height="${ih}" fill="transparent"><title>${esc(tip)}</title></rect>`;
    })
    .join('');

  const legend =
    series.length > 1
      ? `<div class="legend">${series.map((s, si) => `<span><i style="background:${SERIES[si]}"></i>${esc(s.label)}</span>`).join('')}</div>`
      : '';
  return `${legend}<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(series.map((s) => s.label).join(', '))}" style="font-family:system-ui,sans-serif;display:block">${grid}${xLabels}${lines}${hover}</svg>`;
}

/** Tableau des valeurs (alternative accessible aux graphiques) */
function dataTable(points, columns) {
  return `<details><summary class="muted" style="cursor:pointer">Voir les valeurs</summary><table><tr><th>Jour</th>${columns.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr>
    ${[...points].reverse().map((p) => `<tr><td>${dateFr(p.date)}</td>${columns.map((c) => `<td>${fmt(p[c.key])}</td>`).join('')}</tr>`).join('')}</table></details>`;
}

module.exports = { lineChart, dataTable, SERIES, fmt };
