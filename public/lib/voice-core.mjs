/**
 * Voice biomarkers from a sustained vowel ("aaah").
 *
 * Jitter (cycle-to-cycle period variation), shimmer (cycle-to-cycle amplitude
 * variation) and harmonics-to-noise ratio are the classic acoustic measures of
 * vocal-fold stability; maximum phonation time (how long you can sustain the
 * vowel on one breath) reflects respiratory and phonatory reserve.
 * Pure functions — shared by the browser recorder and Node tests.
 */
import { mean, median, clamp, bandpass, percentile } from './dsp.mjs';

/** Reference limits for a sustained /a/ (MDVP / Praat normative thresholds). */
export const VOICE_NORMS = { jitter: 1.04, shimmer: 3.81, hnr: 20, mpt: 10 };

const MIN_F0 = 70, MAX_F0 = 500;

/** Band-limit (60 Hz – 5 kHz) and decimate to roughly targetFs for pitch tracking. */
export function prepareVoice(samples, srcFs, targetFs = 12000) {
  const D = Math.max(1, Math.round(srcFs / targetFs));
  const fs = srcFs / D;
  const full = bandpass(Float64Array.from(samples), srcFs, 60, Math.min(0.45 * fs, 5000));
  const x = new Float64Array(Math.floor(full.length / D));
  for (let i = 0; i < x.length; i++) x[i] = full[i * D];
  return { full, x, fs, D };
}

/** Normalised cross-correlation pitch estimate for one frame, with an octave-error guard. */
export function framePitch(x, start, len, fs, minF0 = MIN_F0, maxF0 = MAX_F0) {
  const minLag = Math.max(2, Math.floor(fs / maxF0));
  const maxLag = Math.min(len - 8, Math.ceil(fs / minF0));
  if (maxLag <= minLag + 2) return { f0: 0, r: 0 };
  const rs = new Float64Array(maxLag + 2);
  for (let tau = minLag - 1; tau <= maxLag + 1; tau++) {
    let xy = 0, xx = 0, yy = 0;
    const end = start + len - tau;
    for (let n = start; n < end; n++) { const a = x[n], b = x[n + tau]; xy += a * b; xx += a * a; yy += b * b; }
    rs[tau] = xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : 0;
  }
  let bestLag = minLag, bestR = -1;
  for (let tau = minLag; tau <= maxLag; tau++) if (rs[tau] > bestR) { bestR = rs[tau]; bestLag = tau; }
  // Prefer the shortest lag that is nearly as periodic: avoids reporting an octave too low.
  for (let tau = minLag; tau < bestLag; tau++) {
    if (rs[tau] >= 0.92 * bestR && rs[tau] >= rs[tau - 1] && rs[tau] >= rs[tau + 1]) { bestLag = tau; bestR = rs[tau]; break; }
  }
  let lag = bestLag;
  const a = rs[bestLag - 1], b = rs[bestLag], c = rs[bestLag + 1], d = a - 2 * b + c;
  if (d < 0) lag += (0.5 * (a - c)) / d;
  return { f0: fs / lag, r: bestR };
}

function rmsOf(x, start, len) {
  let s = 0;
  for (let i = start; i < start + len; i++) s += x[i] * x[i];
  return Math.sqrt(s / len);
}

/** Quick level + pitch on the most recent audio, for the live recorder UI. */
export function livePitch(tail, srcFs) {
  const D = Math.max(1, Math.round(srcFs / 12000));
  const fs = srcFs / D;
  const n = Math.floor(tail.length / D);
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < D; k++) s += tail[i * D + k]; x[i] = s / D; }
  const len = Math.min(n, Math.round(0.04 * fs));
  if (len < 64) return { f0: 0, r: 0, rms: 0 };
  const start = n - len;
  const rms = rmsOf(x, start, len);
  const { f0, r } = framePitch(x, start, len, fs);
  return { f0: r > 0.5 ? f0 : 0, r, rms };
}

/** Marks glottal cycles at full sample rate inside [s0, s1) and returns periods (s) and peak-to-peak amplitudes. */
function markCycles(full, srcFs, s0, s1, f0At) {
  let mx = -Infinity, mn = Infinity;
  for (let i = s0; i < s1; i++) { if (full[i] > mx) mx = full[i]; if (full[i] < mn) mn = full[i]; }
  const sign = mx >= -mn ? 1 : -1;
  const argmax = (lo, hi) => {
    let best = lo, bv = -Infinity;
    for (let i = lo; i < hi; i++) { const v = sign * full[i]; if (v > bv) { bv = v; best = i; } }
    return best;
  };
  const refine = (i) => {
    if (i <= 0 || i >= full.length - 1) return i;
    const a = sign * full[i - 1], b = sign * full[i], c = sign * full[i + 1], d = a - 2 * b + c;
    return d < 0 ? i + (0.5 * (a - c)) / d : i;
  };
  const T0 = srcFs / f0At(s0);
  let p = argmax(s0, Math.min(s1, s0 + Math.round(1.5 * T0)));
  const marks = [refine(p)];
  for (;;) {
    const T = srcFs / f0At(p);
    const lo = Math.round(p + 0.75 * T), hi = Math.round(p + 1.25 * T);
    if (hi >= s1) break;
    p = argmax(lo, hi);
    marks.push(refine(p));
  }
  const periods = [], amps = [];
  for (let i = 1; i < marks.length; i++) {
    periods.push((marks[i] - marks[i - 1]) / srcFs);
    let hi = -Infinity, lo = Infinity;
    for (let k = Math.floor(marks[i - 1]); k < Math.floor(marks[i]); k++) { if (full[k] > hi) hi = full[k]; if (full[k] < lo) lo = full[k]; }
    amps.push(hi - lo);
  }
  return { periods, amps };
}

/** Mean absolute consecutive difference relative to the mean, in %, skipping outlier cycles. */
function perturbation(values, ok) {
  const diffs = [], kept = [];
  for (let i = 0; i < values.length; i++) if (ok[i]) kept.push(values[i]);
  for (let i = 1; i < values.length; i++) if (ok[i] && ok[i - 1]) diffs.push(Math.abs(values[i] - values[i - 1]));
  if (diffs.length < 10 || !kept.length) return null;
  return (100 * mean(diffs)) / mean(kept);
}

/**
 * Full analysis of a recorded sustained vowel.
 * samples: Float32Array/Array of PCM in [-1, 1]; srcFs: sample rate (e.g. 48000).
 */
export function analyzeVoice(samples, srcFs) {
  if (!samples || samples.length < srcFs * 1.5) {
    return { ok: false, reason: 'too_short', message: 'Hold the "aaah" for at least 2 seconds.' };
  }
  let clipped = 0;
  for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]) >= 0.985) clipped++;
  const clipFrac = clipped / samples.length;

  const { full, x, fs, D } = prepareVoice(samples, srcFs);
  const frameLen = Math.round(0.04 * fs), hop = Math.round(0.01 * fs);
  const frames = [];
  for (let s = 0; s + frameLen < x.length; s += hop) frames.push({ s, rms: rmsOf(x, s, frameLen) });
  if (frames.length < 50) return { ok: false, reason: 'too_short', message: 'Recording too short.' };

  const rmsList = frames.map((f) => f.rms);
  const noise = Math.max(1e-5, percentile(rmsList, 0.1));
  const peakRms = percentile(rmsList, 0.98);
  const thr = Math.max(noise * 3, peakRms * 0.12, 0.002);
  for (const f of frames) {
    if (f.rms < thr) { f.voiced = false; continue; }
    const pr = framePitch(x, f.s, frameLen, fs);
    f.f0 = pr.f0; f.r = pr.r;
    f.voiced = pr.r >= 0.5 && pr.f0 >= MIN_F0 && pr.f0 <= MAX_F0;
  }

  // Longest phonation run, bridging gaps up to 150 ms (natural micro-breaks).
  let best = { a: -1, b: -1 }, curA = -1, lastV = -1;
  const GAP = 15;
  frames.forEach((f, i) => {
    if (!f.voiced) return;
    if (curA < 0 || i - lastV > GAP) curA = i;
    lastV = i;
    if (i - curA > best.b - best.a) best = { a: curA, b: i };
  });
  const voicedFrames = frames.filter((f) => f.voiced);
  if (best.a < 0 || voicedFrames.length < 50) {
    return { ok: false, reason: 'no_voice', message: 'No steady voice detected. Try a louder, steady "aaah" closer to the mic.' };
  }
  const mpt = ((best.b - best.a) * hop + frameLen) / fs;

  // Analyse the stable core of the longest run (trim 200 ms onset/offset).
  const runFrames = frames.slice(best.a, best.b + 1).filter((f) => f.voiced);
  const trim = Math.round(0.2 * fs / hop);
  const core = runFrames.length > 2 * trim + 20 ? runFrames.slice(trim, runFrames.length - trim) : runFrames;
  const f0s = core.map((f) => f.f0);
  const f0Med = median(f0s);
  const coreOk = core.filter((f) => Math.abs(f.f0 - f0Med) / f0Med < 0.2);
  const f0Mean = mean(coreOk.map((f) => f.f0));
  const f0Sd = Math.sqrt(mean(coreOk.map((f) => (f.f0 - f0Mean) ** 2)));
  const rMed = clamp(median(coreOk.map((f) => f.r)), 0.01, 0.9999);
  const hnr = 10 * Math.log10(rMed / (1 - rMed));

  // Cycle-level jitter and shimmer at the original sample rate.
  const s0 = core[0].s * D, s1 = Math.min(full.length - 1, (core[core.length - 1].s + frameLen) * D);
  const f0At = (sample) => {
    const fi = Math.round(sample / D / hop);
    const f = frames[clamp(fi, 0, frames.length - 1)];
    return f && f.voiced && Math.abs(f.f0 - f0Med) / f0Med < 0.2 ? f.f0 : f0Med;
  };
  const { periods, amps } = markCycles(full, srcFs, s0, s1, f0At);
  const pMed = median(periods);
  const ok = periods.map((p) => Math.abs(p - pMed) / pMed < 0.25);
  const jitter = perturbation(periods, ok);
  const shimmer = perturbation(amps, ok);

  const voicedRms = mean(coreOk.map((f) => f.rms));
  const snrDb = 20 * Math.log10(voicedRms / noise);
  const voicedS = (voicedFrames.length * hop) / fs;
  const quality = Math.round(100 * clamp(
    0.35 * clamp(voicedS / 3, 0, 1) + 0.35 * clamp((snrDb - 10) / 20, 0, 1) + 0.3 * clamp(1 - clipFrac * 20, 0, 1), 0, 1));

  const flags = [];
  if (jitter != null && jitter > VOICE_NORMS.jitter) flags.push('jitter_high');
  if (shimmer != null && shimmer > VOICE_NORMS.shimmer) flags.push('shimmer_high');
  if (hnr < 15) flags.push('hnr_low');
  if (mpt < VOICE_NORMS.mpt) flags.push('mpt_short');
  if (clipFrac > 0.01) flags.push('clipping');

  const penalty =
    30 * clamp(((jitter ?? 1) - VOICE_NORMS.jitter) / 2, 0, 1) +
    30 * clamp(((shimmer ?? 3) - VOICE_NORMS.shimmer) / 6, 0, 1) +
    25 * clamp((18 - hnr) / 12, 0, 1) +
    15 * clamp((VOICE_NORMS.mpt - mpt) / 7, 0, 1);

  const round = (v, d = 2) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
  return {
    ok: true,
    f0: round(f0Mean, 1),
    f0Sd: round(f0Sd, 1),
    jitter: round(jitter),
    shimmer: round(shimmer),
    hnr: round(hnr, 1),
    mpt: round(mpt, 1),
    voicedS: round(voicedS, 1),
    cycles: periods.length,
    snrDb: round(snrDb, 1),
    clipping: round(clipFrac * 100, 2),
    quality,
    stability: Math.round(clamp(100 - penalty, 0, 100)),
    flags,
  };
}
