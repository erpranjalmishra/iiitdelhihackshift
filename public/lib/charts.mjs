/**
 * Charts. Single-series trend lines with the person's own baseline as a band
 * (mean ± 1 SD, a 10% wash), recessive hairline grid, crosshair tooltip, keyboard
 * support and a table view. Live waveform / spectrum are drawn on canvas.
 */
import { h, fmt, dateLabel, dateTimeLabel, mount } from './ui.mjs';

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function niceTicks(min, max, count = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) { min -= 1; max += 1; }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const step = (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  const ticks = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.5; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}

/** Re-render an element whenever its container width changes. */
function responsive(container, render) {
  let last = 0, frame = 0;
  const ro = new ResizeObserver(() => {
    const w = Math.round(container.clientWidth);
    if (w && w !== last) { last = w; cancelAnimationFrame(frame); frame = requestAnimationFrame(() => render(w)); }
  });
  ro.observe(container);
  return () => ro.disconnect();
}

/**
 * Trend chart. points: [{t, v, z?, eligible?, context?}], band: {ready, mean, sd, lo, hi}.
 */
export function trendChart({ points, band = null, unit = '', decimals = 0, label = '', height = 200, days = null, lang = 'en' }) {
  const wrap = h('div', { class: 'chart' });
  const svg = s('svg', { role: 'img', tabindex: '0', 'aria-label': `${label}: ${points.length} readings${band && band.ready ? `, your normal range ${fmt(band.lo, decimals)} to ${fmt(band.hi, decimals)} ${unit}` : ''}` });
  const tip = h('div', { class: 'chart-tip hide', role: 'presentation' });
  wrap.append(svg, tip);

  // Situational readings (after exercise / caffeine) are expected to be high: drawn apart, never flagged.
  // Readings taken while unwell stay on the line — they are exactly what the twin should highlight.
  const pts = points.map((p) => ({ ...p, time: Date.parse(p.t), eligible: p.eligible !== false, situational: !!p.situational })).sort((a, b) => a.time - b.time);
  const unusual = (p) => !p.situational && p.z != null && Math.abs(p.z) >= 2;
  const hasExcluded = pts.some((p) => p.situational);
  const hasUnusual = pts.some(unusual);
  let geom = null, sel = -1;

  function render(width) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const m = { l: 38, r: 52, t: 10, b: 24 };
    const iw = Math.max(80, width - m.l - m.r), ih = height - m.t - m.b;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('height', height);
    if (!pts.length) return;
    const now = Date.now();
    const t0 = days ? Math.min(now - days * 86400000, pts[0].time) : pts[0].time;
    const t1 = Math.max(now, pts[pts.length - 1].time);
    const vals = pts.map((p) => p.v).concat(band && band.ready ? [band.lo, band.hi] : []);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo || Math.abs(hi) * 0.1 || 1) * 0.12;
    const ticks = niceTicks(lo - pad, hi + pad, 4);
    lo = ticks[0]; hi = ticks[ticks.length - 1];
    const x = (t) => m.l + ((t - t0) / (t1 - t0 || 1)) * iw;
    const y = (v) => m.t + ih - ((v - lo) / (hi - lo || 1)) * ih;
    const grid = cssVar('--grid'), axis = cssVar('--axis'), muted = cssVar('--muted'), accent = cssVar('--accent'), surface = cssVar('--surface'), serious = cssVar('--serious'), wash = cssVar('--accent-wash'), ink2 = cssVar('--ink-2');

    // Grid + y ticks (hairline, solid, recessive).
    for (const tv of ticks) {
      svg.append(s('line', { x1: m.l, x2: m.l + iw, y1: y(tv), y2: y(tv), stroke: tv === ticks[0] ? axis : grid, 'stroke-width': 1 }));
      svg.append(s('text', { x: m.l - 8, y: y(tv) + 4, 'text-anchor': 'end', 'font-size': 11, fill: muted, style: 'font-variant-numeric: tabular-nums' }, fmt(tv, Number.isInteger(tv) ? 0 : 1)));
    }
    // X ticks: up to 5 evenly spaced dates.
    const nX = Math.max(2, Math.min(5, Math.floor(iw / 110)));
    for (let i = 0; i <= nX; i++) {
      const tt = t0 + ((t1 - t0) * i) / nX;
      svg.append(s('text', { x: x(tt), y: height - 6, 'text-anchor': i === 0 ? 'start' : i === nX ? 'end' : 'middle', 'font-size': 11, fill: muted }, dateLabel(new Date(tt).toISOString())));
    }
    // Personal-normal band + mean hairline.
    if (band && band.ready) {
      svg.append(s('rect', { x: m.l, width: iw, y: y(band.hi), height: Math.max(1, y(band.lo) - y(band.hi)), fill: wash }));
      svg.append(s('line', { x1: m.l, x2: m.l + iw, y1: y(band.mean), y2: y(band.mean), stroke: accent, 'stroke-opacity': 0.45, 'stroke-width': 1 }));
    }
    // Line through every non-situational reading.
    const line = pts.filter((p) => !p.situational);
    if (line.length > 1) {
      svg.append(s('path', { d: line.map((p, i) => `${i ? 'L' : 'M'}${x(p.time).toFixed(1)},${y(p.v).toFixed(1)}`).join(''), fill: 'none', stroke: accent, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    }
    // Markers: situational readings hollow; unusual readings as diamonds with a surface ring.
    for (const p of pts) {
      if (p.situational) svg.append(s('circle', { cx: x(p.time), cy: y(p.v), r: 3.5, fill: surface, stroke: muted, 'stroke-width': 1.5 }));
      else if (unusual(p)) {
        const cx = x(p.time), cy = y(p.v), r = 6;
        svg.append(s('path', { d: `M${cx},${cy - r}L${cx + r},${cy}L${cx},${cy + r}L${cx - r},${cy}Z`, fill: serious, stroke: surface, 'stroke-width': 2 }));
      }
    }
    // End dot + direct label on the latest eligible reading.
    const last = line[line.length - 1];
    if (last) {
      if (!unusual(last)) svg.append(s('circle', { cx: x(last.time), cy: y(last.v), r: 4.5, fill: accent, stroke: surface, 'stroke-width': 2 }));
      svg.append(s('text', { x: x(last.time) + 10, y: y(last.v) + 4, 'font-size': 12.5, 'font-weight': 700, fill: ink2 }, `${fmt(last.v, decimals)}`));
    }
    // Crosshair (hidden until hover/focus) and the pointer-capture layer.
    const cross = s('line', { y1: m.t, y2: m.t + ih, stroke: axis, 'stroke-width': 1, visibility: 'hidden' });
    const ring = s('circle', { r: 5.5, fill: 'none', stroke: accent, 'stroke-width': 2, visibility: 'hidden' });
    const capture = s('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent', style: 'cursor: crosshair' });
    svg.append(cross, ring, capture);
    geom = { x, y, cross, ring, width };
    capture.addEventListener('pointermove', (e) => {
      const rect = svg.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * width;
      let best = 0;
      pts.forEach((p, i) => { if (Math.abs(x(p.time) - px) < Math.abs(x(pts[best].time) - px)) best = i; });
      select(best);
    });
    capture.addEventListener('pointerleave', () => select(-1));
    if (sel >= 0) select(sel);
  }

  function select(i) {
    sel = i;
    if (!geom) return;
    const { x, y, cross, ring, width } = geom;
    if (i < 0) { cross.setAttribute('visibility', 'hidden'); ring.setAttribute('visibility', 'hidden'); tip.classList.add('hide'); return; }
    const p = pts[i];
    cross.setAttribute('x1', x(p.time)); cross.setAttribute('x2', x(p.time)); cross.setAttribute('visibility', 'visible');
    ring.setAttribute('cx', x(p.time)); ring.setAttribute('cy', y(p.v)); ring.setAttribute('visibility', 'visible');
    const why = (p.context || []).filter((c) => ['post_exercise', 'unwell', 'after_caffeine'].includes(c)).join(', ').replace(/_/g, ' ') || (lang === 'hi' ? 'कम गुणवत्ता' : 'low signal quality');
    const zNote = !p.situational && p.z != null ? `${p.z > 0 ? '+' : ''}${p.z.toFixed(1)} SD ${lang === 'hi' ? 'आपके सामान्य से' : 'vs your normal'}` : '';
    const baseNote = !p.eligible ? (lang === 'hi' ? `बेसलाइन में शामिल नहीं (${why})` : `Not used for your baseline (${why})`) : '';
    mount(tip, h('strong', null, `${fmt(p.v, decimals)} ${unit}`), h('div', { class: 'muted' }, dateTimeLabel(p.t)), zNote ? h('div', null, zNote) : null, baseNote ? h('div', { class: 'muted' }, baseNote) : null);
    const rect = svg.getBoundingClientRect(), scale = rect.width / width;
    tip.style.left = `${x(p.time) * scale}px`;
    tip.style.top = `${y(p.v) * scale}px`;
    tip.classList.remove('hide');
  }

  svg.addEventListener('keydown', (e) => {
    if (!pts.length) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      select(Math.max(0, Math.min(pts.length - 1, (sel < 0 ? pts.length : sel) + (e.key === 'ArrowRight' ? 1 : -1))));
    }
  });
  svg.addEventListener('blur', () => select(-1));

  // Legend (single series: no series box — only the encodings actually present) + table toggle.
  const legend = h('div', { class: 'legend' },
    band && band.ready ? h('span', null, h('i', { style: { width: '18px', height: '10px', background: 'var(--accent-wash)', border: '1px solid var(--accent)', borderRadius: '2px' } }), lang === 'hi' ? 'आपका सामान्य दायरा (±1 SD)' : 'Your normal range (±1 SD)') : null,
    hasUnusual ? h('span', null, h('i', { style: { width: '9px', height: '9px', background: 'var(--serious)', transform: 'rotate(45deg)' } }), lang === 'hi' ? 'आपके लिए असामान्य (≥2 SD)' : 'Unusual for you (≥ 2 SD)') : null,
    hasExcluded ? h('span', null, h('i', { style: { width: '9px', height: '9px', borderRadius: '50%', border: '1.5px solid var(--muted)' } }), lang === 'hi' ? 'व्यायाम/चाय के बाद (अपेक्षित)' : 'After exercise / caffeine (expected)') : null,
  );
  const table = h('div', { class: 'table-wrap hide' });
  const toggle = h('button', { class: 'btn ghost sm', type: 'button', 'aria-expanded': 'false', onclick: () => {
    const open = table.classList.toggle('hide') === false;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? (lang === 'hi' ? 'तालिका छिपाएँ' : 'Hide table') : (lang === 'hi' ? 'तालिका देखें' : 'Show table');
    if (open && !table.firstChild) {
      table.append(h('table', { class: 'data' },
        h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, `${label} (${unit})`), h('th', null, 'vs normal'), h('th', null, 'Context'))),
        h('tbody', null, [...pts].reverse().map((p) => h('tr', null, h('td', null, dateTimeLabel(p.t)), h('td', null, fmt(p.v, decimals)), h('td', null, p.z != null ? `${p.z > 0 ? '+' : ''}${p.z.toFixed(1)} SD` : '—'), h('td', null, (p.context || []).join(', ').replace(/_/g, ' ') || '—'))))));
    }
  } }, lang === 'hi' ? 'तालिका देखें' : 'Show table');

  const outer = h('div', null, wrap, h('div', { class: 'row between' }, legend, toggle), table);
  outer._dispose = responsive(wrap, render);
  return outer;
}

/** 12-point sparkline: de-emphasis line, latest point in the accent. */
export function sparkline(values, { height = 34 } = {}) {
  const host = h('div', { class: 'spark', 'aria-hidden': 'true' });
  const v = values.filter((x) => x != null && Number.isFinite(x)).slice(-12);
  if (v.length < 2) return host;
  const svg = s('svg', { height });
  host.append(svg);
  responsive(host, (w) => {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('viewBox', `0 0 ${w} ${height}`);
    const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
    const X = (i) => 3 + (i / (v.length - 1)) * (w - 8);
    const Y = (val) => 4 + (1 - (val - lo) / span) * (height - 8);
    svg.append(s('path', { d: v.map((val, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(val).toFixed(1)}`).join(''), fill: 'none', stroke: cssVar('--muted'), 'stroke-opacity': 0.7, 'stroke-width': 1.75, 'stroke-linejoin': 'round' }));
    svg.append(s('circle', { cx: X(v.length - 1), cy: Y(v[v.length - 1]), r: 4, fill: cssVar('--accent'), stroke: cssVar('--surface'), 'stroke-width': 2 }));
  });
  return host;
}

/* ---------------- canvas renderers for live signals ---------------- */

function prep(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, hgt = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr); }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, hgt);
  return { ctx, w, hgt };
}

/** Pulse waveform (normalised −1..1) with optional beat markers (seconds). */
export function drawWave(canvas, values, { beats = [], fs = 30 } = {}) {
  const { ctx, w, hgt } = prep(canvas);
  ctx.strokeStyle = cssVar('--grid');
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, hgt / 2); ctx.lineTo(w, hgt / 2); ctx.stroke();
  if (!values || values.length < 2) return;
  ctx.strokeStyle = cssVar('--accent');
  ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  values.forEach((v, i) => {
    const px = (i / (values.length - 1)) * w, py = hgt / 2 - v * hgt * 0.4;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  });
  ctx.stroke();
  if (beats.length) {
    const dur = values.length / fs;
    ctx.fillStyle = cssVar('--muted');
    for (const b of beats) { const px = (b / dur) * w; if (px >= 0 && px <= w) ctx.fillRect(px - 0.75, 4, 1.5, 7); }
  }
}

/** Spectrum [{bpm, p}] with the detected peak marked. */
export function drawSpectrum(canvas, spectrum, { peakBpm = null } = {}) {
  const { ctx, w, hgt } = prep(canvas);
  if (!spectrum || spectrum.length < 2) return;
  const b0 = spectrum[0].bpm, b1 = spectrum[spectrum.length - 1].bpm;
  const X = (bpm) => ((bpm - b0) / (b1 - b0)) * w;
  const base = hgt - 16;
  ctx.fillStyle = cssVar('--accent-wash');
  ctx.beginPath(); ctx.moveTo(0, base);
  spectrum.forEach((pt) => ctx.lineTo(X(pt.bpm), base - pt.p * (base - 6)));
  ctx.lineTo(w, base); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = cssVar('--accent'); ctx.lineWidth = 1.5;
  ctx.beginPath();
  spectrum.forEach((pt, i) => { const px = X(pt.bpm), py = base - pt.p * (base - 6); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
  ctx.stroke();
  ctx.fillStyle = cssVar('--muted'); ctx.font = '11px system-ui'; ctx.textAlign = 'center';
  for (const bpm of [60, 90, 120, 150, 180]) if (bpm > b0 && bpm < b1) ctx.fillText(String(bpm), X(bpm), hgt - 3);
  if (peakBpm != null) {
    ctx.strokeStyle = cssVar('--ink-2'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(peakBpm), 4); ctx.lineTo(X(peakBpm), base); ctx.stroke();
    ctx.fillStyle = cssVar('--ink'); ctx.font = '600 11.5px system-ui';
    ctx.textAlign = X(peakBpm) > w - 60 ? 'right' : 'left';
    ctx.fillText(`${Math.round(peakBpm)} bpm`, X(peakBpm) + (ctx.textAlign === 'left' ? 5 : -5), 14);
  }
}
