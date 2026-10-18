// Ground-truth tests for the signal pipelines: synthesize signals with known
// physiology, run the exact browser code, and check the answers come back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRppg, liveEstimate } from '../public/lib/rppg-core.mjs';
import { analyzeVoice } from '../public/lib/voice-core.mjs';
import { fft, bandpass, welch, spectralPeak } from '../public/lib/dsp.mjs';

function rng(seed) {
  let a = seed >>> 0;
  const uni = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(uni() + 1e-12)) * Math.cos(2 * Math.PI * uni());
  return { uni, gauss };
}

/**
 * Simulated face video: mean skin RGB per frame. Blood-volume pulse with a
 * harmonic, respiratory sinus arrhythmia (frequency modulation), respiratory
 * amplitude + baseline modulation, slow illumination drift, sensor noise and
 * irregular frame timing (like a real webcam).
 */
function synthFace({ hr = 72, rr = 15, seconds = 45, fs = 30, noise = 0.002, pulseAmp = 0.003, seed = 1, pulse = true }) {
  const { uni, gauss } = rng(seed);
  const frames = [];
  const beats = [];
  let t = 0, phase = 0;
  const f0 = hr / 60, fr = rr / 60;
  const sig = [0.33, 0.77, 0.53]; // relative blood-volume-pulse signature in R, G, B
  const dc = [170, 120, 95];
  while (t < seconds) {
    const dt = 1 / fs + (uni() - 0.5) * 0.008;
    const tPrev = t, phPrev = phase;
    t += dt;
    const resp = Math.sin(2 * Math.PI * fr * t);
    phase += 2 * Math.PI * f0 * (1 + 0.04 * resp) * dt;
    const cycle = Math.floor(phase / (2 * Math.PI));
    if (cycle > Math.floor(phPrev / (2 * Math.PI))) {
      beats.push(tPrev + ((2 * Math.PI * cycle - phPrev) / (phase - phPrev)) * dt);
    }
    const wave = pulse ? (Math.sin(phase) + 0.35 * Math.sin(2 * phase - 0.8)) * (1 + 0.15 * resp) + 0.5 * resp : 0;
    const illum = 1 + 0.02 * Math.sin(2 * Math.PI * 0.05 * t) + 0.01 * Math.sin(2 * Math.PI * 0.013 * t + 1);
    const c = dc.map((d, i) => d * illum * (1 + pulseAmp * sig[i] * wave) + gauss() * noise * d);
    frames.push({ t, r: c[0], g: c[1], b: c[2], skin: 0.6, motion: 0.3 });
  }
  // Ground-truth RMSSD from the exact simulated beat times.
  const ibi = beats.slice(1).map((b, i) => (b - beats[i]) * 1000);
  const d = ibi.slice(1).map((v, i) => v - ibi[i]);
  frames.trueRmssd = Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length);
  return frames;
}

/** Sustained vowel with controlled F0, jitter and shimmer, framed by silence. */
function synthVowel({ f0 = 120, seconds = 4, fs = 48000, jitterPct = 0.5, shimmerPct = 2, noiseRel = 0.02, seed = 7 }) {
  const { gauss } = rng(seed);
  const lead = 0.6;
  const out = new Float32Array(Math.round((seconds + 2 * lead) * fs));
  const start = Math.round(lead * fs), end = start + Math.round(seconds * fs);
  // local jitter% ≈ 112.8·σ for iid perturbations, so invert to get σ
  const sj = jitterPct / 112.8, ss = shimmerPct / 112.8;
  let phi = 0, T = (fs / f0) * (1 + gauss() * sj), A = 0.3 * (1 + gauss() * ss);
  const g = (p) => { let v = 0; for (let k = 1; k <= 8; k++) v += Math.sin(2 * Math.PI * k * p - 0.3 * k) / k ** 1.2; return v; };
  for (let n = 0; n < out.length; n++) {
    let v = gauss() * 0.0005;
    if (n >= start && n < end) {
      phi += 1 / T;
      if (phi >= 1) { phi -= 1; T = (fs / f0) * (1 + gauss() * sj); A = 0.3 * (1 + gauss() * ss); }
      v += A * g(phi) + gauss() * noiseRel * 0.3;
    }
    out[n] = v;
  }
  return out;
}

test('FFT recovers a pure tone', () => {
  const n = 1024, fs = 100, re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 12.5 * i) / fs);
  fft(re, im);
  let best = 0;
  for (let k = 1; k < n / 2; k++) if (re[k] ** 2 + im[k] ** 2 > re[best] ** 2 + im[best] ** 2) best = k;
  assert.ok(Math.abs((best * fs) / n - 12.5) < fs / n);
});

test('band-pass keeps the pass band and rejects drift', () => {
  const fs = 30, n = 30 * 40, x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * 1.2 * i) / fs) + 5 * Math.sin((2 * Math.PI * 0.03 * i) / fs) + 2 * Math.sin((2 * Math.PI * 8 * i) / fs);
  const y = bandpass(x, fs, 0.7, 3.5);
  const psd = welch(y, fs, 300, 2048);
  const pk = spectralPeak(psd.freqs, psd.power, 0.01, 14);
  assert.ok(Math.abs(pk.freq - 1.2) < 0.03, `peak at ${pk.freq}`);
});

for (const hr of [58, 72, 96, 124]) {
  test(`rPPG recovers heart rate ${hr} bpm from simulated face video`, () => {
    const res = analyzeRppg(synthFace({ hr, seed: hr }));
    assert.equal(res.ok, true);
    assert.ok(Math.abs(res.hr - hr) <= 2, `expected ${hr}, got ${res.hr}`);
    assert.ok(res.quality >= 55, `quality ${res.quality}`);
  });
}

test('rPPG recovers respiration rate even on a noisy signal', () => {
  const res = analyzeRppg(synthFace({ hr: 70, rr: 15, seconds: 60, seed: 11 }));
  assert.equal(res.ok, true);
  assert.ok(res.rr != null && Math.abs(res.rr - 15) <= 2, `rr ${res.rr} ${JSON.stringify(res.rrDetail)}`);
  assert.ok(Math.abs(res.hrBeats - 70) < 4, `beat-derived HR ${res.hrBeats}`);
});

test('rPPG noise-debiased HRV matches ground truth on a clean signal', () => {
  for (const seed of [1, 2, 3]) {
    const frames = synthFace({ hr: 72, seconds: 60, noise: 0.0002, seed });
    const res = analyzeRppg(frames);
    assert.ok(res.hrv, `hrv withheld: ${JSON.stringify(res.hrvWithheld)}`);
    const err = Math.abs(res.hrv.rmssd - frames.trueRmssd) / frames.trueRmssd;
    assert.ok(err < 0.2, `rmssd ${res.hrv.rmssd} vs true ${frames.trueRmssd.toFixed(1)} (raw ${res.hrv.rmssdRaw})`);
    assert.ok(res.stress != null && res.stress >= 0 && res.stress <= 100);
  }
});

test('rPPG withholds HRV when timing noise dominates (never a made-up number)', () => {
  const res = analyzeRppg(synthFace({ hr: 72, seconds: 60, noise: 0.0015, seed: 4 }));
  assert.equal(res.ok, true);
  assert.equal(res.hrv, null);
  assert.equal(res.stress, null);
  assert.equal(res.hrvWithheld.reason, 'noise');
  assert.ok(Math.abs(res.hr - 72) <= 2, 'HR is still reported');
});

test('rPPG respiration tracks a faster breathing rate', () => {
  const res = analyzeRppg(synthFace({ hr: 88, rr: 24, seconds: 60, seed: 5 }));
  assert.ok(Math.abs(res.rr - 24) <= 2.5, `rr ${res.rr}`);
});

test('rPPG flags a signal with no pulse as low quality', () => {
  const res = analyzeRppg(synthFace({ pulse: false, seed: 3 }));
  assert.ok(!res.ok || res.quality < 45, `quality ${res.quality}`);
});

test('rPPG quality degrades gracefully with heavy noise', () => {
  const clean = analyzeRppg(synthFace({ hr: 75, seed: 21 }));
  const noisy = analyzeRppg(synthFace({ hr: 75, seed: 21, noise: 0.012 }));
  assert.ok(noisy.quality < clean.quality, `${noisy.quality} !< ${clean.quality}`);
});

test('live estimate works on a 6-second window', () => {
  const frames = synthFace({ hr: 80, seconds: 8, seed: 9 });
  const live = liveEstimate(frames);
  assert.ok(live && Math.abs(live.hr - 80) <= 4, `live hr ${live && live.hr}`);
  assert.ok(live.wave.length > 100);
});

test('rejects scans that are too short', () => {
  assert.equal(analyzeRppg(synthFace({ seconds: 5 })).ok, false);
});

test('voice: recovers F0, jitter, shimmer and phonation time', () => {
  const res = analyzeVoice(synthVowel({ f0: 120, jitterPct: 0.5, shimmerPct: 2 }), 48000);
  assert.equal(res.ok, true, res.message);
  assert.ok(Math.abs(res.f0 - 120) < 3, `f0 ${res.f0}`);
  assert.ok(res.jitter > 0.25 && res.jitter < 1.0, `jitter ${res.jitter}`);
  assert.ok(res.shimmer > 1.0 && res.shimmer < 3.5, `shimmer ${res.shimmer}`);
  assert.ok(res.hnr > 12, `hnr ${res.hnr}`);
  assert.ok(Math.abs(res.mpt - 4) < 0.4, `mpt ${res.mpt}`);
  assert.ok(!res.flags.includes('jitter_high'), res.flags.join());
});

test('voice: flags a pathologically unstable voice', () => {
  const res = analyzeVoice(synthVowel({ f0: 210, jitterPct: 2.5, shimmerPct: 7, seed: 3, fs: 44100 }), 44100);
  assert.equal(res.ok, true, res.message);
  assert.ok(Math.abs(res.f0 - 210) < 5, `f0 ${res.f0}`);
  assert.ok(res.jitter > 1.5, `jitter ${res.jitter}`);
  assert.ok(res.flags.includes('jitter_high') && res.flags.includes('shimmer_high'), res.flags.join());
  assert.ok(res.stability < 70, `stability ${res.stability}`);
});

test('voice: rejects silence', () => {
  const { gauss } = rng(1);
  const silence = Float32Array.from({ length: 48000 * 3 }, () => gauss() * 0.001);
  assert.equal(analyzeVoice(silence, 48000).ok, false);
});
