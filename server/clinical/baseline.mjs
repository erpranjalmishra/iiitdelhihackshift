/**
 * Baseline Twin — your personal normal. Population ranges say "60–100 bpm is
 * normal"; the twin says "your resting HR is usually 64 ± 3, today it's 79".
 * Robust statistics (median ± 1.4826·MAD) so one odd scan can't skew it, and
 * readings taken while unwell / after exercise / with low signal quality are
 * excluded so the baseline reflects your healthy resting state.
 */

export const TWIN_METRICS = {
  hr: { label: 'Resting heart rate', label_hi: 'आराम की हृदय गति', unit: 'bpm', minSd: 2.5, decimals: 0, higherIsWorse: true },
  rmssd: { label: 'Heart-rate variability (RMSSD)', label_hi: 'हृदय गति परिवर्तनशीलता', unit: 'ms', minSd: 4, decimals: 0, higherIsWorse: false },
  rr: { label: 'Breathing rate', label_hi: 'सांस की दर', unit: '/min', minSd: 1, decimals: 1, higherIsWorse: true },
  stress: { label: 'Stress index', label_hi: 'तनाव सूचकांक', unit: '/100', minSd: 5, decimals: 0, higherIsWorse: true },
  temp_c: { label: 'Temperature', label_hi: 'तापमान', unit: '°C', minSd: 0.25, decimals: 1, higherIsWorse: true },
  spo2: { label: 'Oxygen saturation', label_hi: 'ऑक्सीजन', unit: '%', minSd: 1, decimals: 0, higherIsWorse: false },
  bp_sys: { label: 'Systolic BP', label_hi: 'सिस्टोलिक BP', unit: 'mmHg', minSd: 5, decimals: 0, higherIsWorse: true },
};

export const MIN_READINGS = 5;
const EXCLUDE_TAGS = new Set(['unwell', 'post_exercise', 'after_caffeine']);

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function robust(values, minSd) {
  const med = median(values);
  const mad = median(values.map((v) => Math.abs(v - med)));
  let sd = 1.4826 * mad;
  if (!sd) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, values.length - 1));
  }
  return { mean: med, sd: Math.max(sd, minSd) };
}

const finite = (v) => v != null && Number.isFinite(+v);

export function isBaselineEligible(r) {
  return r.confidence !== 'low' && !(r.context || []).some((t) => EXCLUDE_TAGS.has(t));
}

/** Per-metric personal baseline over the trailing window. */
export function computeBaseline(readings, { windowDays = 30, now = Date.now(), excludeId = null } = {}) {
  const cutoff = now - windowDays * 86400000;
  const eligible = readings.filter((r) => r.id !== excludeId && Date.parse(r.ts) >= cutoff && Date.parse(r.ts) <= now && isBaselineEligible(r));
  const out = {};
  for (const [key, meta] of Object.entries(TWIN_METRICS)) {
    const values = eligible.map((r) => r[key]).filter(finite).map(Number);
    if (values.length >= MIN_READINGS) {
      const { mean, sd } = robust(values, meta.minSd);
      const dp = meta.decimals;
      out[key] = { ready: true, n: values.length, mean: +mean.toFixed(dp + 1), sd: +sd.toFixed(dp + 1), lo: +(mean - sd).toFixed(dp + 1), hi: +(mean + sd).toFixed(dp + 1) };
    } else {
      out[key] = { ready: false, n: values.length, needed: MIN_READINGS - values.length };
    }
  }
  return out;
}

/** z-scores of a reading against the baseline (only for metrics with a ready baseline). */
export function deviations(reading, baseline) {
  const z = {};
  if (!reading) return z;
  for (const key of Object.keys(TWIN_METRICS)) {
    const b = baseline[key];
    if (b && b.ready && finite(reading[key])) z[key] = +((reading[key] - b.mean) / b.sd).toFixed(2);
  }
  return z;
}

/** Plain-language description of notable deviations (|z| ≥ 2). */
export function describeDeviations(z, reading, baseline, lang = 'en') {
  const notes = [];
  for (const [key, val] of Object.entries(z)) {
    if (Math.abs(val) < 2) continue;
    const meta = TWIN_METRICS[key], b = baseline[key];
    const diff = reading[key] - b.mean;
    const label = lang === 'hi' ? meta.label_hi : meta.label;
    notes.push({
      metric: key, z: val,
      text: `${label} ${diff > 0 ? '+' : '−'}${Math.abs(diff).toFixed(meta.decimals)} ${meta.unit} vs your usual ${b.mean.toFixed(meta.decimals)} (${val > 0 ? '+' : ''}${val.toFixed(1)} SD)`,
      concerning: meta.higherIsWorse ? val >= 2 : val <= -2,
    });
  }
  return notes;
}

/** Trend for one metric: mean of the last `days` vs the `days` before. */
export function trend(readings, key, days = 7, now = Date.now()) {
  const inRange = (r, a, b) => { const t = Date.parse(r.ts); return t >= now - a * 86400000 && t < now - b * 86400000; };
  const cur = readings.filter((r) => inRange(r, days, -1) && finite(r[key]) && isBaselineEligible(r)).map((r) => +r[key]);
  const prev = readings.filter((r) => inRange(r, 2 * days, days) && finite(r[key]) && isBaselineEligible(r)).map((r) => +r[key]);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const m = avg(cur), p = avg(prev);
  return { key, n: cur.length, mean: m, prevMean: p, delta: m != null && p != null ? m - p : null, deltaPct: m != null && p ? ((m - p) / p) * 100 : null };
}

/** Compact statistical summary handed to the AI (or the offline narrator) for "explain my trends". */
export function twinSummary(readings, baseline, days = 14) {
  const now = Date.now();
  const recent = readings.filter((r) => Date.parse(r.ts) >= now - days * 86400000);
  const metrics = {};
  for (const [key, meta] of Object.entries(TWIN_METRICS)) {
    const vals = recent.filter((r) => finite(r[key]));
    if (!vals.length) continue;
    const t = trend(readings, key, Math.max(3, Math.round(days / 2)), now);
    const outliers = vals
      .map((r) => ({ ts: r.ts.slice(0, 10), v: +r[key], z: baseline[key] && baseline[key].ready ? (r[key] - baseline[key].mean) / baseline[key].sd : null, context: r.context || [] }))
      .filter((o) => o.z != null && Math.abs(o.z) >= 2)
      .map((o) => ({ ...o, z: +o.z.toFixed(1) }));
    metrics[key] = {
      label: meta.label, unit: meta.unit, readings: vals.length,
      latest: +(+vals[vals.length - 1][key]).toFixed(meta.decimals),
      recent_mean: t.mean != null ? +t.mean.toFixed(meta.decimals + 1) : null,
      previous_mean: t.prevMean != null ? +t.prevMean.toFixed(meta.decimals + 1) : null,
      change_pct: t.deltaPct != null ? +t.deltaPct.toFixed(1) : null,
      baseline: baseline[key] && baseline[key].ready ? { mean: baseline[key].mean, sd: baseline[key].sd } : null,
      unusual_days: outliers.slice(-5),
    };
  }
  return { window_days: days, scans: recent.length, metrics };
}
