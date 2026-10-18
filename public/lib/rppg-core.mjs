/**
 * Remote photoplethysmography (rPPG) core.
 *
 * Every heartbeat pushes a pulse of blood into facial capillaries, which shifts
 * skin colour by roughly 0.1–0.5% — invisible to the eye, measurable by a camera.
 * This module turns per-frame mean skin RGB into vitals. Pure functions only:
 * the browser capture layer (rppg.mjs) feeds it, and Node tests feed it
 * synthetic signals with known answers.
 */
import {
  mean, std, clamp, median, resampleUniform, bandpass, welch, spectralPeak, powerAt,
  pulseSnrDb, findPeaks, refinePeak, hrvFromBeats, baevskyStressIndex, stressScoreFromSI,
  estimateRespiration,
} from './dsp.mjs';

export const HR_BAND_HZ = [0.7, 3.5]; // 42–210 bpm

/**
 * POS — "Plane-Orthogonal-to-Skin" (Wang, den Brinker, Stuijk & de Haan,
 * IEEE TBME 2017). Projects temporally normalised RGB onto a plane orthogonal
 * to the skin-tone direction, cancelling specular and intensity changes while
 * keeping the pulsatile component. Overlap-adds 1.6 s windows.
 */
export function pos(r, g, b, fs, windowS = 1.6) {
  const n = r.length;
  const l = Math.max(4, Math.ceil(windowS * fs));
  const H = new Float64Array(n);
  if (n < l) return H;
  const s1 = new Float64Array(l), s2 = new Float64Array(l), h = new Float64Array(l);
  for (let m = 0; m + l <= n; m++) {
    let mr = 0, mg = 0, mb = 0;
    for (let k = 0; k < l; k++) { mr += r[m + k]; mg += g[m + k]; mb += b[m + k]; }
    mr /= l; mg /= l; mb /= l;
    if (mr <= 0 || mg <= 0 || mb <= 0) continue;
    for (let k = 0; k < l; k++) {
      const rn = r[m + k] / mr, gn = g[m + k] / mg, bn = b[m + k] / mb;
      s1[k] = gn - bn;
      s2[k] = -2 * rn + gn + bn;
    }
    const sd2 = std(s2);
    const alpha = sd2 > 1e-12 ? std(s1) / sd2 : 0;
    let hm = 0;
    for (let k = 0; k < l; k++) { h[k] = s1[k] + alpha * s2[k]; hm += h[k]; }
    hm /= l;
    for (let k = 0; k < l; k++) H[m + k] += h[k] - hm;
  }
  return H;
}

/** Strictly increasing timestamps + channel arrays, after dropping a warm-up period. */
function prepare(frames, warmupS) {
  const usable = frames.filter((f) => Number.isFinite(f.t) && f.r > 0 && f.g > 0 && f.b > 0);
  if (usable.length < 2) return null;
  const start = usable[0].t + warmupS;
  const t = [], R = [], G = [], B = [], skin = [], motion = [];
  for (const f of usable) {
    if (f.t < start) continue;
    if (t.length && f.t <= t[t.length - 1]) continue;
    t.push(f.t); R.push(f.r); G.push(f.g); B.push(f.b);
    if (f.skin != null) skin.push(f.skin);
    if (f.motion != null) motion.push(f.motion);
  }
  return { t, R, G, B, skin, motion };
}

/** Peak HR in the cardiac band, correcting the classic error of locking onto the 2nd harmonic. */
function heartRatePeak(freqs, power) {
  const pk = spectralPeak(freqs, power, HR_BAND_HZ[0], HR_BAND_HZ[1]);
  if (!pk) return null;
  const half = pk.freq / 2;
  if (half >= HR_BAND_HZ[0] && powerAt(freqs, power, half) > 0.5 * pk.power) {
    const sub = spectralPeak(freqs, power, half - 0.12, half + 0.12);
    if (sub) return sub;
  }
  return pk;
}

/**
 * Beat-timing noise (seconds) predicted from the spectrum. For a narrowband
 * signal with in-band noise the phase jitter is σφ² ≈ N_in / (2·S), so the
 * timing jitter is σt = σφ / (2π·f0). The noise density is a MEDIAN over bins
 * away from the pulse, so respiratory sidebands are not mistaken for noise.
 */
function beatTimingNoise(freqs, power, f0, bandLo, bandHi) {
  const df = freqs[1] - freqs[0];
  let S = 0;
  const noiseBins = [];
  for (let k = 0; k < freqs.length; k++) {
    const f = freqs[k];
    if (f < HR_BAND_HZ[0] || f > 4.5) continue;
    if (Math.abs(f - f0) <= 0.1) S += power[k];
    else if (Math.abs(f - f0) > 0.45 && Math.abs(f - 2 * f0) > 0.45) noiseBins.push(power[k]);
  }
  if (!S || noiseBins.length < 10) return null;
  const nIn = median(noiseBins) * ((bandHi - bandLo) / df);
  return Math.sqrt(nIn / (2 * S)) / (2 * Math.PI * f0);
}

/**
 * Sub-sample beat timing by aligning every beat to the ensemble-average beat
 * (template matching). Uses the whole beat shape rather than 3 samples at the
 * peak, which is what makes HRV usable on a noisy camera signal.
 */
function alignBeats(sig, idx, period) {
  const half = Math.max(3, Math.round(0.45 * period));
  const reach = Math.max(1, Math.round(0.25 * period));
  const usable = idx.filter((i) => i - half - reach >= 0 && i + half + reach < sig.length);
  if (usable.length < 6) return usable.map((i) => refinePeak(sig, i));
  const L = 2 * half + 1;
  let positions = usable.slice();
  for (let iter = 0; iter < 2; iter++) {
    const tpl = new Float64Array(L);
    for (const p of positions) { const c = Math.round(p); for (let k = 0; k < L; k++) tpl[k] += sig[c - half + k]; }
    const tm = mean(tpl);
    for (let k = 0; k < L; k++) tpl[k] = tpl[k] / positions.length - tm / positions.length;
    positions = usable.map((i) => {
      const scores = new Float64Array(2 * reach + 1);
      for (let s = -reach; s <= reach; s++) {
        let acc = 0;
        for (let k = 0; k < L; k++) acc += tpl[k] * sig[i + s - half + k];
        scores[s + reach] = acc;
      }
      let b = 0;
      for (let j = 1; j < scores.length; j++) if (scores[j] > scores[b]) b = j;
      let off = b;
      if (b > 0 && b < scores.length - 1) {
        const a = scores[b - 1], m = scores[b], c = scores[b + 1], d = a - 2 * m + c;
        if (d < 0) off += (0.5 * (a - c)) / d;
      }
      return i + off - reach;
    });
  }
  return positions;
}

function normalise(arr) {
  let lo = Infinity, hi = -Infinity;
  for (const v of arr) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo || 1;
  return Array.from(arr, (v) => Math.round(((2 * (v - lo)) / span - 1) * 1000) / 1000);
}

function spectrumForDisplay(freqs, power, points = 96) {
  const lo = HR_BAND_HZ[0], hi = HR_BAND_HZ[1];
  const out = [];
  let max = 0;
  for (let i = 0; i < points; i++) {
    const f = lo + ((hi - lo) * i) / (points - 1);
    const p = powerAt(freqs, power, f);
    out.push(p);
    if (p > max) max = p;
  }
  return out.map((p, i) => ({
    bpm: Math.round((lo + ((hi - lo) * i) / (points - 1)) * 600) / 10,
    p: max ? Math.round((p / max) * 1000) / 1000 : 0,
  }));
}

/**
 * Lightweight estimate for the live UI (runs every ~500 ms on the last few seconds).
 * Returns the filtered pulse tail for the waveform and a provisional HR.
 */
export function liveEstimate(frames, { fs = 30, windowS = 10, warmupS = 0 } = {}) {
  const tail = frames.length ? frames.filter((f) => f.t >= frames[frames.length - 1].t - windowS) : [];
  const p = prepare(tail, warmupS);
  if (!p || p.t.length < 2 || p.t[p.t.length - 1] - p.t[0] < 4) return null;
  const r = resampleUniform(p.t, p.R, fs), g = resampleUniform(p.t, p.G, fs), b = resampleUniform(p.t, p.B, fs);
  const pulse = bandpass(pos(r, g, b, fs), fs, HR_BAND_HZ[0], HR_BAND_HZ[1]);
  const psd = welch(pulse, fs, Math.min(pulse.length, fs * 8), 2048);
  const pk = heartRatePeak(psd.freqs, psd.power);
  if (!pk) return null;
  const waveTail = pulse.slice(Math.max(0, pulse.length - fs * 6));
  return {
    hr: Math.round(pk.freq * 60),
    snr: pulseSnrDb(psd.freqs, psd.power, pk.freq),
    wave: normalise(waveTail),
    spectrum: spectrumForDisplay(psd.freqs, psd.power, 72),
    seconds: p.t[p.t.length - 1] - p.t[0],
  };
}

/**
 * Full analysis of a completed scan.
 * frames: [{ t: seconds, r, g, b, skin?: 0–1 coverage, motion?: px/frame }]
 */
export function analyzeRppg(frames, { fs = 30, warmupS = 1.0 } = {}) {
  const p = prepare(frames, warmupS);
  if (!p || p.t.length < fs * 8 || p.t[p.t.length - 1] - p.t[0] < 8) {
    return { ok: false, reason: 'too_short', message: 'Need at least 8 seconds of steady signal.' };
  }
  const { t } = p;
  const durationS = t[t.length - 1] - t[0];
  const r = resampleUniform(t, p.R, fs), g = resampleUniform(t, p.G, fs), b = resampleUniform(t, p.B, fs);

  const raw = pos(r, g, b, fs);
  if (std(raw) < 1e-9) return { ok: false, reason: 'no_pulse', message: 'No pulse detected in the signal.' };
  const pulse = bandpass(raw, fs, HR_BAND_HZ[0], HR_BAND_HZ[1]);
  // The spectrum spans up to 5.5 Hz so the pulse's first harmonic can count as
  // signal at high heart rates (it leaves a 3.5 Hz band above ~105 bpm).
  const wide = bandpass(raw, fs, HR_BAND_HZ[0], 5.5);
  const psd = welch(wide, fs, Math.min(wide.length, fs * 12), 4096);
  const pk = heartRatePeak(psd.freqs, psd.power);
  if (!pk) return { ok: false, reason: 'no_pulse', message: 'No pulse detected in the signal.' };
  const hrHz = pk.freq;
  const hr = hrHz * 60;
  // de Haan's standard 0.7–4 Hz SNR window, widened only as far as needed to keep the 1st harmonic.
  const snr = pulseSnrDb(psd.freqs, psd.power, hrHz, HR_BAND_HZ[0], Math.min(5.5, Math.max(4.0, 2 * hrHz + 0.3)));

  // Beats: DETECT on a band hugging the fundamental (exactly one peak per cycle,
  // no double peaks from the harmonic at high HR), then TIME each beat by
  // template alignment on a wider band that keeps the pulse shape.
  const period = fs / hrHz;
  const coarse = bandpass(raw, fs, Math.max(0.5, hrHz * 0.6), Math.min(4.5, hrHz * 1.6));
  const fine = bandpass(raw, fs, Math.max(0.5, hrHz * 0.6), Math.min(6.0, hrHz * 2.6));
  const idx = findPeaks(coarse, Math.max(2, Math.floor(0.7 * period)), 0.15 * std(coarse));
  const beatPos = alignBeats(fine, idx, period);
  const beatTimes = beatPos.map((p) => p / fs);
  // Peak-to-trough amplitude of each beat (respiratory amplitude modulation, RIAV).
  const beatAmps = beatPos.map((p) => {
    const c = Math.round(p);
    let hi = -Infinity, lo = Infinity;
    for (let k = Math.max(0, c - 2); k <= Math.min(fine.length - 1, c + 2); k++) hi = Math.max(hi, fine[k]);
    for (let k = Math.max(0, Math.round(c - 0.6 * period)); k <= c; k++) lo = Math.min(lo, fine[k]);
    return hi - lo;
  });
  const hrvRaw = hrvFromBeats(beatTimes);
  const hrBeats = hrvRaw ? 60000 / hrvRaw.meanIbi : null;

  // Noise-debiased HRV. Timing jitter σt inflates RMSSD² by 6σt² (each successive
  // difference touches three beat times) and SDNN² by 2σt². Subtract the
  // predicted inflation; if noise explains most of the variability, withhold HRV
  // rather than report a number we cannot trust.
  let hrv = null, si = null, stress = null, hrvWithheld = null;
  const sigmaT = beatTimingNoise(psd.freqs, psd.power, hrHz, Math.max(0.5, hrHz * 0.6), Math.min(4.5, hrHz * 1.6));
  if (hrvRaw && hrvRaw.rmssd != null && sigmaT != null) {
    const nt = (sigmaT * 1000) ** 2;
    const rm2 = hrvRaw.rmssd ** 2 - 6 * nt, sd2 = hrvRaw.sdnn ** 2 - 2 * nt;
    const noiseShare = (6 * nt) / hrvRaw.rmssd ** 2;
    // Threshold chosen from a noise sweep: at ≤ 50% noise share the debiased
    // RMSSD had a 3% median error (p90 39%); beyond it errors exploded past 200%.
    if (noiseShare <= 0.5 && rm2 > 0 && sd2 > 0 && hrvRaw.artifactRate <= 0.25) {
      const sdnn = Math.sqrt(sd2), shrink = sdnn / hrvRaw.sdnn;
      hrv = {
        ...hrvRaw,
        rmssd: Math.sqrt(rm2),
        sdnn,
        rmssdRaw: hrvRaw.rmssd,
        timingNoiseMs: sigmaT * 1000,
        reliability: noiseShare <= 0.35 ? 'good' : 'fair',
      };
      // Baevsky SI on intervals with the noise variance shrunk out of their spread.
      si = baevskyStressIndex(hrvRaw.ibis.map((v) => hrvRaw.meanIbi + (v - hrvRaw.meanIbi) * shrink));
      stress = stressScoreFromSI(si);
    } else {
      hrvWithheld = { reason: 'noise', timingNoiseMs: Math.round(sigmaT * 1000), noiseShare: Math.round(Math.min(noiseShare, 9.99) * 100) / 100 };
    }
  }

  // Respiration: green-channel baseline (RIIV) + beat amplitude (RIAV) + beat timing (RIFV).
  const gm = mean(g);
  const baseline = Float64Array.from(g, (v) => v / gm - 1);
  const resp = estimateRespiration({ baseline, fs, beatTimes, beatAmps });

  // Signal quality. SNR GATES the score (no pulse in the spectrum → no quality,
  // however tidy everything else looks); beat consistency, motion and skin
  // coverage can only scale it down.
  const snrScore = clamp((snr + 9) / 12, 0, 1);
  const artifactScore = hrvRaw ? 1 - hrvRaw.artifactRate : 0;
  const agreeScore = hrBeats ? clamp(1 - Math.abs(hrBeats - hr) / 15, 0, 1) : 0;
  const motionMean = p.motion.length ? mean(p.motion) : 0;
  const motionScore = clamp(1 - (motionMean - 0.4) / 1.6, 0, 1);
  const skinMean = p.skin.length ? mean(p.skin) : 1;
  const coverageScore = clamp((skinMean - 0.12) / 0.33, 0, 1);
  const consistency = 0.4 * artifactScore + 0.3 * agreeScore + 0.15 * motionScore + 0.15 * coverageScore;
  const quality = Math.round(100 * snrScore ** 0.7 * (0.55 + 0.45 * consistency));
  const confidence = quality >= 65 ? 'high' : quality >= 40 ? 'medium' : 'low';

  const tailStart = Math.max(0, pulse.length - fs * 10);
  const tailBeats = beatTimes.filter((bt) => bt * fs >= tailStart).map((bt) => Math.round((bt - tailStart / fs) * 1000) / 1000);

  return {
    ok: true,
    hr: Math.round(hr * 10) / 10,
    hrBeats: hrBeats ? Math.round(hrBeats * 10) / 10 : null,
    hrv: hrv ? {
      rmssd: Math.round(hrv.rmssd * 10) / 10,
      sdnn: Math.round(hrv.sdnn * 10) / 10,
      rmssdRaw: Math.round(hrv.rmssdRaw * 10) / 10,
      timingNoiseMs: Math.round(hrv.timingNoiseMs * 10) / 10,
      reliability: hrv.reliability,
      beats: hrv.beats,
      artifactRate: Math.round(hrv.artifactRate * 1000) / 1000,
    } : null,
    hrvWithheld,
    beatsDetected: hrvRaw ? hrvRaw.beats : idx.length,
    rr: resp ? Math.round(resp.brpm * 10) / 10 : null,
    rrDetail: resp ? { agree: resp.agree, purity: Math.round(resp.purity * 1000) / 1000, sources: resp.estimates.map((e) => ({ name: e.name, brpm: Math.round(e.brpm * 10) / 10, purity: Math.round(e.purity * 1000) / 1000 })) } : null,
    stress,
    stressIndex: si ? Math.round(si) : null,
    snr: Math.round(snr * 10) / 10,
    quality,
    confidence,
    motion: Math.round(motionMean * 100) / 100,
    skin: Math.round(skinMean * 100) / 100,
    durationS: Math.round(durationS * 10) / 10,
    fsActual: Math.round(((t.length - 1) / durationS) * 10) / 10,
    waveform: normalise(pulse.slice(tailStart)),
    waveformFs: fs,
    beats: tailBeats,
    spectrum: spectrumForDisplay(psd.freqs, psd.power),
    medianIbi: hrvRaw ? Math.round(median(hrvRaw.ibis)) : null,
  };
}
