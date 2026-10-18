/**
 * Nadi DSP toolkit — pure numeric functions with no DOM access, so the exact
 * same code runs in the browser during a scan and in Node under test.
 */

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function mean(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return a.length ? s / a.length : 0;
}

export function std(a, m = mean(a)) {
  if (a.length < 2) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - m; s += d * d; }
  return Math.sqrt(s / (a.length - 1));
}

export function percentile(a, p) {
  if (!a.length) return NaN;
  const s = Float64Array.from(a).sort();
  const idx = clamp(p, 0, 1) * (s.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

export const median = (a) => percentile(a, 0.5);

export const nextPow2 = (n) => 1 << Math.ceil(Math.log2(Math.max(2, n)));

/** Linear interpolation of irregular samples (t in seconds, ascending) onto a uniform grid. */
export function resampleUniform(t, x, fs, tStart = t[0], tEnd = t[t.length - 1]) {
  const n = Math.max(0, Math.floor((tEnd - tStart) * fs) + 1);
  const out = new Float64Array(n);
  if (t.length < 2) { out.fill(t.length ? x[0] : 0); return out; }
  let j = 0;
  for (let i = 0; i < n; i++) {
    const ti = tStart + i / fs;
    while (j < t.length - 2 && t[j + 1] < ti) j++;
    const t0 = t[j], t1 = t[j + 1];
    const w = t1 > t0 ? clamp((ti - t0) / (t1 - t0), 0, 1) : 0;
    out[i] = x[j] + w * (x[j + 1] - x[j]);
  }
  return out;
}

/** Remove the least-squares straight line. */
export function detrendLinear(x) {
  const n = x.length;
  if (n < 3) return Float64Array.from(x);
  const tm = (n - 1) / 2, xm = mean(x);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - tm) * (x[i] - xm); den += (i - tm) ** 2; }
  const slope = den ? num / den : 0;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = x[i] - (xm + slope * (i - tm));
  return out;
}

/* ---------- IIR filtering (RBJ biquads, Butterworth Q values, zero-phase) ---------- */

// Q values that make cascaded biquads a true Butterworth response.
const BUTTER_Q = { 1: [Math.SQRT1_2], 2: [0.5411961, 1.3065630] };

function biquad(type, fc, fs, q) {
  const w0 = (2 * Math.PI * fc) / fs;
  const cos = Math.cos(w0), alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  const b = type === 'lowpass'
    ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2]
    : [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  return [b[0] / a0, b[1] / a0, b[2] / a0, (-2 * cos) / a0, (1 - alpha) / a0];
}

function runBiquad(x, [b0, b1, b2, a1, a2]) {
  const y = new Float64Array(x.length);
  // Start in steady state for a DC input equal to x[0] to avoid a start-up transient.
  let x1 = x[0], x2 = x[0];
  const dcGain = (b0 + b1 + b2) / (1 + a1 + a2);
  let y1 = Number.isFinite(dcGain) ? x[0] * dcGain : 0, y2 = y1;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi;
    y[i] = yi;
  }
  return y;
}

function reflectPad(x, pad) {
  const n = x.length;
  const out = new Float64Array(n + 2 * pad);
  for (let i = 0; i < pad; i++) {
    out[pad - 1 - i] = 2 * x[0] - x[Math.min(n - 1, i + 1)];
    out[pad + n + i] = 2 * x[n - 1] - x[Math.max(0, n - 2 - i)];
  }
  out.set(x, pad);
  return out;
}

/**
 * Zero-phase Butterworth band-pass (forward-backward, like filtfilt in SciPy).
 * sections = 2 gives a 4th-order high-pass + 4th-order low-pass per direction.
 */
export function bandpass(x, fs, lo, hi, sections = 2) {
  if (x.length < 8) return Float64Array.from(x);
  const qs = BUTTER_Q[sections] || BUTTER_Q[2];
  const stages = [];
  for (const q of qs) stages.push(biquad('highpass', lo, fs, q));
  if (hi < fs / 2) for (const q of qs) stages.push(biquad('lowpass', hi, fs, q));
  const pad = Math.min(x.length - 1, Math.round((3 * fs) / lo));
  let y = reflectPad(x, pad);
  for (const c of stages) y = runBiquad(y, c);
  y.reverse();
  for (const c of stages) y = runBiquad(y, c);
  y.reverse();
  return y.slice(pad, pad + x.length);
}

/* ---------- Spectral analysis ---------- */

/** In-place iterative radix-2 FFT. Length must be a power of two. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr; im[b] = im[a] - vi;
        re[a] += vr; im[a] += vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

/** Hann-windowed, zero-padded power spectrum. */
export function periodogram(x, fs, minNfft = 0) {
  const n = x.length;
  const nfft = Math.max(nextPow2(n), nextPow2(minNfft));
  const re = new Float64Array(nfft), im = new Float64Array(nfft);
  const m = mean(x);
  for (let i = 0; i < n; i++) re[i] = (x[i] - m) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  fft(re, im);
  const half = (nfft >> 1) + 1;
  const freqs = new Float64Array(half), power = new Float64Array(half);
  for (let k = 0; k < half; k++) { freqs[k] = (k * fs) / nfft; power[k] = re[k] * re[k] + im[k] * im[k]; }
  return { freqs, power };
}

/** Welch PSD: averaged periodograms over 50%-overlapping segments. */
export function welch(x, fs, segLen, minNfft = 0) {
  segLen = Math.max(8, Math.min(Math.round(segLen), x.length));
  const step = Math.max(1, Math.floor(segLen / 2));
  let acc = null, freqs = null, count = 0;
  for (let s = 0; s + segLen <= x.length; s += step) {
    const p = periodogram(x.slice(s, s + segLen), fs, minNfft);
    if (!acc) { acc = new Float64Array(p.power.length); freqs = p.freqs; }
    for (let k = 0; k < acc.length; k++) acc[k] += p.power[k];
    count++;
  }
  for (let k = 0; k < acc.length; k++) acc[k] /= count;
  return { freqs, power: acc };
}

/** Dominant peak inside [fmin, fmax] with parabolic sub-bin interpolation. */
export function spectralPeak(freqs, power, fmin, fmax) {
  let best = -1, bp = -Infinity;
  for (let k = 0; k < freqs.length; k++) {
    if (freqs[k] < fmin || freqs[k] > fmax) continue;
    if (power[k] > bp) { bp = power[k]; best = k; }
  }
  if (best < 0) return null;
  let freq = freqs[best];
  if (best > 0 && best < freqs.length - 1) {
    const a = power[best - 1], b = power[best], c = power[best + 1];
    const d = a - 2 * b + c;
    if (d < 0) freq += (0.5 * (a - c) / d) * (freqs[1] - freqs[0]);
  }
  return { freq, power: bp, index: best };
}

/** Power at the bin nearest to f (used for harmonic checks). */
export function powerAt(freqs, power, f) {
  const df = freqs[1] - freqs[0];
  const k = Math.round(f / df);
  return k >= 0 && k < power.length ? power[k] : 0;
}

/** Share of in-band power that sits within ±halfWidth Hz of f0 (spectral purity, 0–1). */
export function bandFraction(freqs, power, f0, halfWidth, fmin, fmax) {
  let inside = 0, total = 0;
  for (let k = 0; k < freqs.length; k++) {
    const f = freqs[k];
    if (f < fmin || f > fmax) continue;
    total += power[k];
    if (Math.abs(f - f0) <= halfWidth) inside += power[k];
  }
  return total > 0 ? inside / total : 0;
}

/** Pulse SNR in dB (de Haan & Jeanne 2013): fundamental ±0.1 Hz and 1st harmonic ±0.2 Hz vs the rest. */
export function pulseSnrDb(freqs, power, f0, fmin = 0.7, fmax = 4.0) {
  let sig = 0, noise = 0;
  for (let k = 0; k < freqs.length; k++) {
    const f = freqs[k];
    if (f < fmin || f > fmax) continue;
    if (Math.abs(f - f0) <= 0.1 || Math.abs(f - 2 * f0) <= 0.2) sig += power[k];
    else noise += power[k];
  }
  return 10 * Math.log10((sig + 1e-12) / (noise + 1e-12));
}

/* ---------- Peaks, HRV, stress, respiration ---------- */

/** Local maxima at least minDist samples apart; keeps the taller of two close peaks. */
export function findPeaks(x, minDist, minHeight = -Infinity) {
  const peaks = [];
  for (let i = 1; i < x.length - 1; i++) {
    if (!(x[i] > x[i - 1] && x[i] >= x[i + 1]) || x[i] < minHeight) continue;
    const last = peaks[peaks.length - 1];
    if (last !== undefined && i - last < minDist) {
      if (x[i] > x[last]) peaks[peaks.length - 1] = i;
    } else peaks.push(i);
  }
  return peaks;
}

/** Sub-sample peak position via parabolic fit. */
export function refinePeak(x, i) {
  if (i <= 0 || i >= x.length - 1) return i;
  const a = x[i - 1], b = x[i], c = x[i + 1], d = a - 2 * b + c;
  return d < 0 ? i + (0.5 * (a - c)) / d : i;
}

/**
 * Time-domain HRV from beat times (seconds). Rejects implausible intervals
 * (outside 300–1500 ms or more than 25% from the median) and only differences
 * intervals that were adjacent in the original series.
 */
export function hrvFromBeats(beatTimes) {
  const raw = [];
  for (let i = 1; i < beatTimes.length; i++) raw.push((beatTimes[i] - beatTimes[i - 1]) * 1000);
  if (raw.length < 8) return null;
  const med = median(raw);
  const ok = raw.map((v) => v >= 300 && v <= 1500 && Math.abs(v - med) <= 0.25 * med);
  const clean = raw.filter((_, i) => ok[i]);
  if (clean.length < 8) return null;
  const diffs = [];
  for (let i = 1; i < raw.length; i++) if (ok[i] && ok[i - 1]) diffs.push(raw[i] - raw[i - 1]);
  const rmssd = diffs.length ? Math.sqrt(mean(diffs.map((d) => d * d))) : null;
  const pnn50 = diffs.length ? (100 * diffs.filter((d) => Math.abs(d) > 50).length) / diffs.length : null;
  return {
    ibis: clean,
    meanIbi: mean(clean),
    sdnn: std(clean),
    rmssd,
    pnn50,
    beats: clean.length + 1,
    artifactRate: 1 - clean.length / raw.length,
  };
}

/** Baevsky stress index SI = AMo / (2·Mo·MxDMn) over cleaned intervals (ms). */
export function baevskyStressIndex(ibisMs) {
  if (!ibisMs || ibisMs.length < 15) return null;
  const binW = 50;
  const bins = new Map();
  for (const v of ibisMs) { const b = Math.floor(v / binW); bins.set(b, (bins.get(b) || 0) + 1); }
  let modeBin = 0, modeCount = -1;
  for (const [b, c] of bins) if (c > modeCount) { modeCount = c; modeBin = b; }
  const mo = ((modeBin + 0.5) * binW) / 1000;
  const amo = (100 * modeCount) / ibisMs.length;
  const range = Math.max(0.05, (percentile(ibisMs, 0.98) - percentile(ibisMs, 0.02)) / 1000);
  return amo / (2 * mo * range);
}

/** Maps Baevsky SI onto 0–100 on a log scale (SI 30 → 0, SI 900 → 100). */
export function stressScoreFromSI(si) {
  if (si == null || !Number.isFinite(si)) return null;
  return Math.round(clamp((100 * Math.log(si / 30)) / Math.log(30), 0, 100));
}

/**
 * Respiration rate (breaths/min) by fusing three respiratory modulations of the
 * pulse signal — baseline (RIIV), amplitude (RIAV) and frequency (RIFV) —
 * following the "smart fusion" idea of Karlen et al. (2013): average when the
 * estimates agree, otherwise trust the spectrally purest one.
 */
export function estimateRespiration({ baseline, fs, beatTimes, beatAmps }) {
  const FMIN = 0.1, FMAX = 0.5, RS = 4; // 6–30 breaths/min; beat series resampled at 4 Hz
  const est = [];
  const pushEstimate = (name, series, sfs) => {
    if (!series || series.length < sfs * 12) return;
    const filtered = bandpass(detrendLinear(series), sfs, 0.08, 0.7, 1);
    const psd = periodogram(filtered, sfs, 4096);
    const pk = spectralPeak(psd.freqs, psd.power, FMIN, FMAX);
    if (!pk) return;
    const purity = bandFraction(psd.freqs, psd.power, pk.freq, 0.04, FMIN, FMAX);
    est.push({ name, brpm: pk.freq * 60, purity });
  };
  if (baseline) pushEstimate('riiv', baseline, fs);
  if (beatTimes && beatTimes.length >= 10) {
    const t = beatTimes.slice(1);
    const ibi = [];
    for (let i = 1; i < beatTimes.length; i++) ibi.push(beatTimes[i] - beatTimes[i - 1]);
    const med = median(ibi);
    const keep = ibi.map((v) => Math.abs(v - med) <= 0.3 * med);
    const tt = t.filter((_, i) => keep[i]), vv = ibi.filter((_, i) => keep[i]);
    if (tt.length >= 10) pushEstimate('rifv', resampleUniform(tt, vv, RS), RS);
    if (beatAmps && beatAmps.length === beatTimes.length) {
      pushEstimate('riav', resampleUniform(beatTimes, beatAmps, RS), RS);
    }
  }
  if (!est.length) return null;
  const rates = est.map((e) => e.brpm);
  const agree = est.length > 1 && std(rates) < 4;
  const best = est.reduce((a, b) => (b.purity > a.purity ? b : a));
  const brpm = agree ? mean(rates) : best.brpm;
  return { brpm, purity: agree ? mean(est.map((e) => e.purity)) : best.purity, agree, estimates: est };
}
