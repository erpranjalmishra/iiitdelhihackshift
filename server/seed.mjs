/**
 * Demo data with a story: 30 days of a stable personal baseline, then two
 * days where resting HR creeps up and HRV drops BEFORE symptoms (the Baseline
 * Twin catches it), then a post-monsoon fever today. The medicine list hides a
 * real-world trap — Dolo 650 + Sinarest both contain paracetamol.
 * All people and values here are fictional.
 */
import * as db from './db.mjs';
import { RULES, GUARD_VERSION } from './clinical/guardrails.mjs';
import { localDayKey, daysAgoKey } from './clinical/meds.mjs';

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

const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const confidenceFor = (q) => (q >= 65 ? 'high' : q >= 40 ? 'medium' : 'low');

/** A plausible PPG trace (normalised) for the doctor view's waveform panel. */
function syntheticWaveform(hr, seconds = 10, fs = 30) {
  const out = [], beats = [];
  const f = hr / 60;
  let phase = 0;
  for (let i = 0; i < seconds * fs; i++) {
    const t = i / fs;
    const prev = phase;
    phase += (2 * Math.PI * f * (1 + 0.03 * Math.sin(2 * Math.PI * 0.27 * t))) / fs;
    if (Math.floor(prev / (2 * Math.PI)) !== Math.floor(phase / (2 * Math.PI))) beats.push(round(t + 0.12, 3));
    const p = phase % (2 * Math.PI);
    // Systolic upstroke, peak, dicrotic notch, diastolic decay.
    const v = Math.exp(-((p - 1.1) ** 2) / 0.35) + 0.38 * Math.exp(-((p - 2.9) ** 2) / 0.45) - 0.2;
    out.push(round(v * (1 + 0.08 * Math.sin(2 * Math.PI * 0.27 * t)), 3));
  }
  const lo = Math.min(...out), hi = Math.max(...out);
  return { waveform: out.map((v) => round((2 * (v - lo)) / (hi - lo) - 1, 3)), beats, waveformFs: fs };
}

export function seedDemo() {
  db.wipeAll({ keepDevices: true });
  const { uni, gauss } = rng(20261017);
  const now = Date.now();
  const at = (daysAgo, hour, minute = 0) => {
    const d = new Date(now - daysAgo * 86400000);
    d.setHours(hour, minute, Math.floor(uni() * 60), 0);
    return d.toISOString();
  };

  db.saveProfile({
    name: 'Aarav (demo)', age: 34, sex: 'male', height_cm: 174, weight_kg: 76,
    conditions: ['Hypertension'], allergies: ['Sulfa drugs'], pregnant: false,
    language: 'en', city: 'New Delhi', emergency_contact: 'Riya — +91 98xxxxxx21',
  });

  // 30 → 3 days ago: healthy baseline, mostly morning resting scans.
  for (let d = 30; d >= 3; d--) {
    const q = Math.round(62 + uni() * 32);
    db.insertReading({
      ts: at(d, 7, 10 + Math.floor(uni() * 50)), source: 'camera',
      hr: round(66 + gauss() * 2.6), rmssd: round(44 + gauss() * 4.5), sdnn: round(52 + gauss() * 5), rr: round(14.4 + gauss() * 0.8),
      stress: Math.round(30 + gauss() * 5), quality: q, snr: round(2 + uni() * 6), confidence: confidenceFor(q), context: ['resting', 'morning'],
    });
    if (d % 5 === 0) {
      // Post-exercise evening scans — kept out of the baseline by design.
      db.insertReading({
        ts: at(d, 19, 30), source: 'camera', hr: round(93 + gauss() * 4), rmssd: round(21 + gauss() * 3), rr: round(19.5 + gauss()),
        stress: Math.round(62 + gauss() * 5), quality: 58, confidence: 'medium', context: ['post_exercise', 'evening'],
      });
    }
    if (d % 3 === 0) {
      db.insertReading({ ts: at(d, 8, 45), source: 'manual', bp_sys: Math.round(127 + gauss() * 4), bp_dia: Math.round(83 + gauss() * 3), context: ['resting'] });
    }
  }

  // Pre-symptomatic drift: the body changes before the person feels ill.
  db.insertReading({ ts: at(2, 7, 25), source: 'camera', hr: 72.6, rmssd: 33.1, sdnn: 41, rr: 15.9, stress: 49, quality: 84, snr: 6.1, confidence: 'high', context: ['resting', 'morning'] });
  db.insertReading({ ts: at(1, 7, 40), source: 'camera', hr: 77.4, rmssd: 27.5, sdnn: 35, rr: 17.1, stress: 61, quality: 79, snr: 5.4, confidence: 'high', context: ['resting', 'morning'] });

  // Today, 25 minutes ago: fever has started.
  const wave = syntheticWaveform(88);
  db.insertReading({
    ts: new Date(now - 25 * 60000).toISOString(), source: 'camera',
    hr: 88.2, rmssd: 21.4, sdnn: 28, rr: 18.9, stress: 72, quality: 81, snr: 5.8, confidence: 'high', temp_c: 38.6,
    context: ['resting', 'unwell'],
    voice: { ok: true, f0: 118.4, f0Sd: 2.9, jitter: 1.21, shimmer: 4.4, hnr: 17.6, mpt: 9.2, voicedS: 9.4, cycles: 1044, quality: 74, stability: 71, flags: ['jitter_high', 'shimmer_high', 'mpt_short'] },
    detail: { ...wave, snr: 5.8, durationS: 60, hrvWithheld: null },
  });

  // Medicines — Dolo 650 + Sinarest is the hidden duplicate-paracetamol trap.
  const today = localDayKey();
  const telma = db.insertMed({ name: 'Telma 40', dose: '40 mg', times: ['morning'], ingredients: ['telmisartan'], start_date: daysAgoKey(200), notes: 'For blood pressure' });
  const dolo = db.insertMed({ name: 'Dolo 650', dose: '650 mg', times: ['morning', 'night'], ingredients: ['paracetamol'], start_date: daysAgoKey(1), notes: 'For fever' });
  const sinarest = db.insertMed({ name: 'Sinarest', dose: '1 tablet', times: ['night'], ingredients: ['paracetamol', 'phenylephrine', 'chlorpheniramine'], start_date: daysAgoKey(1), notes: 'Bought from the chemist for a blocked nose' });
  const shelcal = db.insertMed({ name: 'Shelcal 500', dose: '500 mg', times: ['night'], ingredients: ['calcium', 'vitamin d3'], start_date: daysAgoKey(90) });
  for (let d = 30; d >= 1; d--) {
    if (uni() < 0.88) db.logDose(telma.id, daysAgoKey(d), 'morning', 'taken');
    if (d > 1 && uni() < 0.8) db.logDose(shelcal.id, daysAgoKey(d), 'night', 'taken');
  }
  db.logDose(dolo.id, daysAgoKey(1), 'morning', 'taken');
  db.logDose(dolo.id, daysAgoKey(1), 'night', 'taken');
  db.logDose(sinarest.id, daysAgoKey(1), 'night', 'taken');
  db.logDose(telma.id, today, 'morning', 'taken');
  db.logDose(dolo.id, today, 'morning', 'taken');

  // An earlier, resolved symptom check for history.
  db.insertEpisode({
    ts: at(12, 22, 15), text: 'Burning in chest and sour burps after a heavy dinner, no pain in arm',
    intake: { text: 'Burning in chest and sour burps after a heavy dinner, no pain in arm', parsed: { symptoms: ['heartburn'], negated: ['radiating_pain'], duration_days: 0.3, severity: 3 }, language: 'en' },
    result: {
      severity: 'self_care', ai_severity: 'self_care', escalated: false, lint: [],
      headline: 'Likely acidity — manageable at home with care.',
      summary: 'Burning after a heavy meal with sour burps and no pain spreading to the arm fits acidity.',
      possible_conditions: [{ name: 'Acidity / gastritis (GERD)', likelihood: 'high', reasoning: 'Burning after meals with sour burps.' }],
      vitals_interpretation: 'No recent vitals were available.', recommended_actions: ['Smaller, earlier dinners; avoid lying down for 2 h after eating'],
      self_care: ['An antacid can relieve symptoms short-term'], watch_for: ['Pain spreading to arm/jaw, sweating'], questions_for_doctor: [], follow_up_questions: [],
      care_setting: 'home', follow_up_hours: 48, confidence: 'medium', vitals: {}, deviations: {}, devNotes: [], medFindings: [], engine: 'offline', fallback: null,
    },
    guard: { level: 'none', fired: [], advisories: [], checked: RULES.length, version: GUARD_VERSION },
    severity: 'self_care', engine: 'offline', model: 'nadi-offline-1', latency_ms: 4,
  });

  db.audit('demo.seed', { readings: db.counts().readings });
  return db.counts();
}
