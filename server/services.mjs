/**
 * Orchestration of Nadi's core flows:
 *   triage  = parse → safety pre-check → AI (or offline) → escalate-only reconcile → output lint → audit
 *   twin    = personal baseline + series + deviations
 *   handoff = SOAP note + immutable snapshot behind an expiring token
 */
import { randomBytes } from 'node:crypto';
import * as db from './db.mjs';
import { parseSymptoms, symptomLabel, SYMPTOMS } from './clinical/lexicon.mjs';
import { evaluateGuardrails, lintAiOutput, maxLevel, levelRank } from './clinical/guardrails.mjs';
import { computeBaseline, deviations, describeDeviations, twinSummary, TWIN_METRICS, MIN_READINGS, isBaselineEligible } from './clinical/baseline.mjs';
import { analyseMeds, adherence, localDayKey, daysAgoKey, resolveIngredients } from './clinical/meds.mjs';
import { recommendSpecialist } from './clinical/specialists.mjs';
import { interpretLabs } from './clinical/labs.mjs';
import { aiTriage, aiInsights, aiSoap, aiReadDocument, describeAiError } from './ai/index.mjs';
import { SchemaError } from './ai/schema.mjs';
import { publicMessage } from './chat.mjs';

const CARE = { self_care: ['home', 48], soon: ['primary_care', 24], urgent: ['primary_care', 4], emergency: ['hospital_er', 1] };
const ESCALATED_HEADLINE = {
  en: { soon: 'Please see a doctor within 1–2 days.', urgent: 'Please see a doctor today.', emergency: 'Call 112 or 108 now — this needs emergency care.' },
  hi: { soon: 'कृपया 1–2 दिन में डॉक्टर को दिखाएँ।', urgent: 'कृपया आज ही डॉक्टर को दिखाएँ।', emergency: 'तुरंत 112 या 108 पर कॉल करें — यह आपात स्थिति है।' },
};
const SITUATIONAL = new Set(['post_exercise', 'after_caffeine']);
const dayKey = localDayKey; // local calendar day, not UTC
const r1 = (v, d = 1) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

/* ---------------- triage ---------------- */

function mergeParsed(intake) {
  const parsed = parseSymptoms(intake.text || '');
  const symptoms = new Set(parsed.symptoms);
  for (const id of intake.chips || []) if (SYMPTOMS[id]) symptoms.add(id);
  const negated = new Set(parsed.negated);
  let { duration_days, temp_c, severity } = parsed;
  for (const a of intake.answers || []) {
    const p = parseSymptoms(`${a.a || ''}`);
    p.symptoms.forEach((id) => symptoms.add(id));
    p.negated.forEach((id) => negated.add(id));
    duration_days ??= p.duration_days;
    temp_c ??= p.temp_c;
    severity ??= p.severity;
  }
  const pick = (k) => (intake[k] != null && intake[k] !== '' && Number.isFinite(+intake[k]) ? +intake[k] : parsed[k]);
  return {
    symptoms: [...symptoms],
    negated: [...negated].filter((id) => !symptoms.has(id)),
    matched: parsed.matched,
    duration_days: pick('duration_days') ?? duration_days,
    severity: pick('severity') ?? severity,
    temp_c: pick('temp_c') ?? temp_c,
    spo2: pick('spo2'), bp_sys: pick('bp_sys'), bp_dia: pick('bp_dia'), glucose: pick('glucose'),
  };
}

export async function runTriage(intake) {
  const profile = db.getProfile() || {};
  const language = intake.language || profile.language || 'en';
  const P = mergeParsed(intake);

  // Vitals: the chosen or most recent scan (≤ 3 h old) plus anything typed or entered manually.
  const readings = db.listReadings({ days: 60 });
  const scan = intake.use_scan === false ? null : intake.reading_id ? db.getReading(intake.reading_id) : db.latestReading({ withinHours: 3 });
  const baseline = computeBaseline(readings, { excludeId: scan && scan.id });
  const vitals = {
    hr: scan ? scan.hr : null, rr: scan ? scan.rr : null, rmssd: scan ? scan.rmssd : null, stress: scan ? scan.stress : null,
    quality: scan ? scan.quality : null, confidence: scan ? scan.confidence : null,
    hr_source: scan && scan.source === 'manual' ? 'manual' : 'camera', rr_source: 'camera',
    temp_c: P.temp_c ?? (scan && scan.temp_c), spo2: P.spo2 ?? (scan && scan.spo2), bp_sys: P.bp_sys ?? (scan && scan.bp_sys),
    bp_dia: P.bp_dia ?? (scan && scan.bp_dia), glucose: P.glucose ?? (scan && scan.glucose),
    scan_id: scan ? scan.id : null, scan_minutes_ago: scan ? Math.round((Date.now() - Date.parse(scan.ts)) / 60000) : null,
  };
  for (const k of ['temp_c', 'spo2', 'bp_sys', 'bp_dia', 'glucose']) if (vitals[k] === undefined) vitals[k] = null;
  const z = scan ? deviations(scan, baseline) : {};
  const devNotes = scan ? describeDeviations(z, scan, baseline, language) : [];
  const meds = db.listMeds().filter((m) => m.active);
  const medCheck = analyseMeds(meds);

  const guard = evaluateGuardrails({ symptoms: P.symptoms, duration_days: P.duration_days, severity: P.severity, profile, vitals, deviations: z, voice: scan && scan.voice });

  const forModel = {
    profile: { age: profile.age ?? null, sex: profile.sex ?? null, pregnant: !!profile.pregnant, conditions: profile.conditions || [], allergies: profile.allergies || [] },
    complaint: {
      own_words: intake.text || '',
      symptoms: P.symptoms.map((id) => symptomLabel(id)),
      denies: P.negated.map((id) => symptomLabel(id)),
      duration_days: P.duration_days, pain_score_0_10: P.severity,
    },
    answers: intake.answers || [],
    vitals: scan ? {
      method: scan.source === 'manual' ? 'manual entry' : 'camera rPPG (60 s face scan)', minutes_ago: vitals.scan_minutes_ago,
      heart_rate_bpm: r1(scan.hr), breathing_rate_per_min: r1(scan.rr), hrv_rmssd_ms: r1(scan.rmssd), stress_index_0_100: r1(scan.stress, 0),
      signal_quality_0_100: r1(scan.quality, 0), confidence: scan.confidence,
      temperature_c: vitals.temp_c, spo2_pct: vitals.spo2, bp: vitals.bp_sys ? `${vitals.bp_sys}/${vitals.bp_dia}` : null, glucose_mg_dl: vitals.glucose,
    } : { camera_scan: 'none in the last 3 hours', temperature_c: vitals.temp_c, spo2_pct: vitals.spo2, bp: vitals.bp_sys ? `${vitals.bp_sys}/${vitals.bp_dia}` : null, glucose_mg_dl: vitals.glucose },
    baseline: { deviations_z: z, notes: devNotes.map((n) => n.text), learning: Object.values(baseline).every((b) => !b.ready) },
    voice: scan && scan.voice ? { jitter_pct: scan.voice.jitter, shimmer_pct: scan.voice.shimmer, hnr_db: scan.voice.hnr, max_phonation_s: scan.voice.mpt, flags: scan.voice.flags } : null,
    medications: meds.map((m) => ({ name: m.name, dose: m.dose, ingredients: m.ingredients.length ? m.ingredients : undefined })),
    safetyFlags: guard.fired.map((f) => ({ id: f.id, level: f.level, title: f.title, why: f.why })),
  };
  if (medCheck.findings.length) forModel.medications.push({ interaction_findings: medCheck.findings.map((f) => `${f.severity}: ${f.title}`) });

  const ai = await aiTriage({ parsed: P, profile, vitals, guard, devNotes, language }, forModel);

  // The guardrail can only raise severity, never lower it.
  const aiSeverity = ai.result.severity;
  const floor = guard.level === 'none' ? 'self_care' : guard.level;
  const severity = maxLevel(aiSeverity, floor);
  const escalated = levelRank(severity) > levelRank(aiSeverity);
  const { result, notes } = lintAiOutput({ ...ai.result }, { finalLevel: severity, age: profile.age });
  result.severity = severity;
  if (escalated) {
    const top = guard.fired[0];
    const lang = language === 'hi' ? 'hi' : 'en';
    result.headline = `${(lang === 'hi' && top.title_hi) || top.title}: ${ESCALATED_HEADLINE[lang][severity]}`;
    [result.care_setting, result.follow_up_hours] = CARE[severity];
    if (severity === 'emergency') result.self_care = [];
  }
  // Which doctor to see: safety rules decide first, then the AI's pick, then the most likely condition.
  const referral = recommendSpecialist({
    severity, guard, profile, language,
    ai: result.specialist ? { specialist: result.specialist, specialist_reason: result.specialist_reason } : null,
    conditions: (result.possible_conditions || []).map((c) => c.name),
    localTop: ai.engine === 'offline' ? ai.result.top_condition_id : null,
  });

  const stored = {
    ...result, ai_severity: aiSeverity, escalated, lint: notes, vitals, deviations: z, devNotes,
    medFindings: medCheck.findings, engine: ai.engine, fallback: ai.fallback, referral,
  };
  const episode = db.insertEpisode({
    text: intake.text || '', intake: { ...intake, parsed: P, language }, reading_id: scan && scan.id,
    result: stored, guard, severity, engine: ai.engine, model: ai.model, latency_ms: ai.latencyMs,
  });
  db.audit('triage', { episode: episode.id, engine: ai.engine, model: ai.model, ai_severity: aiSeverity, final: severity, escalated, rules: guard.fired.map((f) => f.id), lint: notes.map((n) => n.id), fallback: ai.fallback && ai.fallback.kind, specialist: referral.id });

  return {
    episode_id: episode.id, ts: episode.ts, severity, ai_severity: aiSeverity, escalated, result, guard, lint: notes, referral,
    parsed: P, vitals, deviations: z, devNotes, medFindings: medCheck.findings,
    engine: ai.engine, model: ai.model, surface: ai.surface || null, latencyMs: ai.latencyMs, fallback: ai.fallback, language,
  };
}

export function episodeView(ep) {
  if (!ep) return null;
  const r = ep.result || {};
  // Episodes saved before the specialist finder existed get a referral computed on the fly.
  const referral = r.referral || recommendSpecialist({
    severity: ep.severity, guard: ep.guard || { fired: [] }, profile: db.getProfile() || {}, language: ep.intake.language,
    ai: r.specialist ? { specialist: r.specialist, specialist_reason: r.specialist_reason } : null,
    conditions: (r.possible_conditions || []).map((c) => c.name),
  });
  return {
    episode_id: ep.id, ts: ep.ts, severity: ep.severity, ai_severity: r.ai_severity, escalated: r.escalated, result: r, guard: ep.guard, referral,
    lint: r.lint || [], parsed: ep.intake.parsed, vitals: r.vitals, deviations: r.deviations, devNotes: r.devNotes || [],
    medFindings: r.medFindings || [], engine: ep.engine, model: ep.model, latencyMs: ep.latency_ms, fallback: r.fallback, text: ep.text,
    language: ep.intake.language,
  };
}

/* ---------------- baseline twin ---------------- */

export function twinData(days = 30) {
  const all = db.listReadings({ days: Math.max(days, 60) });
  const baseline = computeBaseline(all);
  const since = Date.now() - days * 86400000;
  const inWindow = all.filter((r) => Date.parse(r.ts) >= since);
  const series = {};
  for (const key of Object.keys(TWIN_METRICS)) {
    const pts = inWindow.filter((r) => r[key] != null).map((r) => ({
      id: r.id, t: r.ts, v: +r[key], z: baseline[key] && baseline[key].ready ? +((r[key] - baseline[key].mean) / baseline[key].sd).toFixed(2) : null,
      context: r.context, eligible: isBaselineEligible(r), source: r.source, quality: r.quality,
      // Exercise/caffeine readings are expected to be high: plotted apart, never flagged as unusual.
      situational: (r.context || []).some((c) => SITUATIONAL.has(c)),
    }));
    if (pts.length) series[key] = pts;
  }
  const latestScan = [...all].reverse().find((r) => r.hr != null) || null;
  const z = latestScan ? deviations(latestScan, baseline) : {};
  const eligibleCount = all.filter((r) => isBaselineEligible(r) && r.hr != null && Date.parse(r.ts) >= Date.now() - 30 * 86400000).length;
  return {
    days, baseline, series, metrics: TWIN_METRICS,
    latest: latestScan ? { id: latestScan.id, ts: latestScan.ts, hr: latestScan.hr, rmssd: latestScan.rmssd, rr: latestScan.rr, stress: latestScan.stress, quality: latestScan.quality, confidence: latestScan.confidence, z, notes: describeDeviations(z, latestScan, baseline) } : null,
    learning: { have: Math.min(eligibleCount, MIN_READINGS), need: MIN_READINGS, ready: eligibleCount >= MIN_READINGS },
  };
}

export async function runInsights({ days = 14, language = 'en' } = {}) {
  const readings = db.listReadings({ days: 60 });
  const baseline = computeBaseline(readings);
  const summary = twinSummary(readings, baseline, days);
  const meds = db.listMeds();
  const adh = meds.length ? adherence(meds, db.medLogs(daysAgoKey(7)), 7) : null;
  const episodes = db.listEpisodes(20).filter((e) => Date.parse(e.ts) >= Date.now() - days * 86400000);
  if (summary.scans < 3) {
    return { result: { headline: 'Not enough readings yet', summary: `Nadi needs at least 3 readings in the last ${days} days to describe trends (you have ${summary.scans}). A daily 60-second scan builds your baseline fast.`, observations: [], suggestions: ['Scan once a day, seated and rested, at about the same time.'], discuss_with_doctor: false }, engine: 'rules', model: null, latencyMs: 0, fallback: null };
  }
  const input = {
    ...summary,
    medication_adherence_7d_pct: adh ? adh.rate : null,
    recent_symptom_checks: episodes.map((e) => ({ date: e.ts.slice(0, 10), outcome: e.severity, symptoms: (e.intake.parsed?.symptoms || []).map((id) => symptomLabel(id)) })),
  };
  const out = await aiInsights(language, input, { adherence: adh, episodes });
  db.audit('insights', { engine: out.engine, model: out.model, days });
  return out;
}

/* ---------------- handoff ---------------- */

export async function createHandoff({ episode_id = null, hours = 24, include_name = true } = {}) {
  const ep = episode_id ? db.getEpisode(episode_id) : db.listEpisodes(1)[0];
  if (!ep) throw Object.assign(new Error('Run a symptom check first — there is nothing to hand off yet.'), { status: 400 });
  const profile = db.getProfile() || {};
  const view = episodeView(ep);
  const scan = ep.reading_id ? db.getReading(ep.reading_id) : null;
  const meds = db.listMeds().filter((m) => m.active);
  const medCheck = analyseMeds(meds);
  const twin = twinData(30);

  const soapData = {
    profile, text: ep.text, parsed: view.parsed, answers: ep.intake.answers || [], vitals: view.vitals, devNotes: view.devNotes,
    voice: scan && scan.voice, guard: ep.guard, result: view.result, severity: ep.severity, meds,
    forModel: {
      patient: { age: profile.age, sex: profile.sex, pregnant: profile.pregnant, conditions: profile.conditions, allergies: profile.allergies },
      complaint_own_words: ep.text, parsed_symptoms: (view.parsed?.symptoms || []).map((id) => symptomLabel(id)),
      denied_symptoms: (view.parsed?.negated || []).map((id) => symptomLabel(id)), duration_days: view.parsed?.duration_days, pain_score: view.parsed?.severity,
      follow_up_answers: ep.intake.answers || [],
      vitals: view.vitals, baseline_deviation_notes: (view.devNotes || []).map((n) => n.text),
      voice_biomarkers: scan && scan.voice,
      medications: meds.map((m) => `${m.name} ${m.dose || ''}`.trim()), medication_findings: medCheck.findings.map((f) => `${f.severity}: ${f.title}`),
      safety_rules: (ep.guard?.fired || []).map((f) => `${f.id} (${f.level}): ${f.title}`), rules_screened: ep.guard?.checked,
      triage: { final: ep.severity, ai: view.ai_severity, escalated_by_rules: view.escalated, possible_conditions: view.result.possible_conditions, questions_for_doctor: view.result.questions_for_doctor },
    },
  };
  const soap = await aiSoap(soapData);

  const token = randomBytes(12).toString('base64url');
  const expires = new Date(Date.now() + Math.min(Math.max(hours, 1), 72) * 3600000).toISOString();
  const pick = (key) => (twin.series[key] || []).map((p) => ({ t: p.t, v: p.v, z: p.z, eligible: p.eligible, situational: p.situational, context: p.context }));
  const payload = {
    generated_at: new Date().toISOString(),
    patient: { name: include_name ? profile.name || null : null, age: profile.age ?? null, sex: profile.sex ?? null, pregnant: !!profile.pregnant, conditions: profile.conditions || [], allergies: profile.allergies || [], city: profile.city || null },
    episode: { id: ep.id, ts: ep.ts, text: ep.text, severity: ep.severity, ai_severity: view.ai_severity, escalated: view.escalated, headline: view.result.headline, possible_conditions: view.result.possible_conditions, parsed: view.parsed, engine: ep.engine, model: ep.model, referral: view.referral },
    guard: { fired: ep.guard?.fired || [], checked: ep.guard?.checked, version: ep.guard?.version },
    vitals: view.vitals, deviations: view.deviations, devNotes: view.devNotes,
    scan: scan ? { ts: scan.ts, hr: scan.hr, rr: scan.rr, rmssd: scan.rmssd, stress: scan.stress, quality: scan.quality, confidence: scan.confidence, voice: scan.voice, waveform: scan.detail && scan.detail.waveform, beats: scan.detail && scan.detail.beats, waveformFs: scan.detail && scan.detail.waveformFs } : null,
    trends: { hr: pick('hr'), rr: pick('rr'), rmssd: pick('rmssd'), stress: pick('stress'), bp_sys: pick('bp_sys'), temp_c: pick('temp_c') },
    baseline: twin.baseline,
    meds: meds.map((m) => ({ name: m.name, dose: m.dose, times: m.times })), med_findings: medCheck.findings,
    soap: soap.result, soap_engine: soap.engine, soap_model: soap.model,
  };
  db.insertHandoff({ token, expires_at: expires, episode_id: ep.id, payload });
  db.audit('handoff.create', { token: token.slice(0, 4) + '…', episode: ep.id, hours, engine: soap.engine });
  return { token, expires_at: expires, soap: soap.result, engine: soap.engine, model: soap.model, fallback: soap.fallback };
}

export function readHandoff(token) {
  const h = db.getHandoff(token);
  if (!h) return { status: 404, error: 'This link does not exist.' };
  if (h.revoked) return { status: 410, error: 'The patient revoked this link.' };
  if (Date.parse(h.expires_at) < Date.now()) return { status: 410, error: 'This link has expired.' };
  db.countHandoffView(token);
  db.audit('handoff.view', { token: token.slice(0, 4) + '…', views: h.views + 1 });
  return { status: 200, data: { ...h.payload, expires_at: h.expires_at, views: h.views + 1, clinician_note: h.clinician_note, note_at: h.note_at } };
}

/* ---------------- live consultation (chat on a doctor link) ---------------- */

export function consultView(token) {
  const h = db.getHandoff(token);
  if (!h) return null;
  const ep = (h.payload && h.payload.episode) || null;
  return {
    token, created_at: h.created_at, expires_at: h.expires_at, revoked: h.revoked, views: h.views,
    active: !h.revoked && Date.parse(h.expires_at) > Date.now(),
    episode: ep ? { id: ep.id, ts: ep.ts, headline: ep.headline, severity: ep.severity, referral: ep.referral || null } : null,
    clinician_note: h.clinician_note, note_at: h.note_at,
    messages: db.listMessages(token).map(publicMessage),
  };
}

/** The latest reading (24 h) as a structured chat message, with deviations from the personal baseline. */
export function vitalsMessage() {
  const r = db.latestReading({ withinHours: 24 });
  if (!r) return null;
  const baseline = computeBaseline(db.listReadings({ days: 60 }), { excludeId: r.id });
  const z = deviations(r, baseline);
  const parts = [];
  if (r.hr != null) parts.push(`HR ${Math.round(r.hr)} bpm`);
  if (r.rr != null) parts.push(`breathing ${r1(r.rr)}/min`);
  if (r.rmssd != null) parts.push(`HRV ${Math.round(r.rmssd)} ms`);
  if (r.stress != null) parts.push(`stress ${Math.round(r.stress)}/100`);
  if (r.temp_c != null) parts.push(`temp ${r1(r.temp_c)} °C`);
  if (r.spo2 != null) parts.push(`SpO2 ${Math.round(r.spo2)}%`);
  if (r.bp_sys != null) parts.push(`BP ${Math.round(r.bp_sys)}/${Math.round(r.bp_dia)}`);
  if (r.glucose != null) parts.push(`glucose ${Math.round(r.glucose)} mg/dL`);
  if (!parts.length) return null;
  const method = r.source === 'manual' ? 'entered manually' : `camera scan, quality ${Math.round(r.quality ?? 0)}/100`;
  return {
    body: `${parts.join(' · ')} (${method})`,
    meta: { reading_id: r.id, ts: r.ts, source: r.source, hr: r.hr, rr: r.rr, rmssd: r.rmssd, stress: r.stress, quality: r.quality, confidence: r.confidence, temp_c: r.temp_c, spo2: r.spo2, bp_sys: r.bp_sys, bp_dia: r.bp_dia, glucose: r.glucose, z },
  };
}

/* ---------------- prescription / lab report reader ---------------- */

const ANTIBIOTIC = /amoxicillin|clavulan|azithromycin|ciprofloxacin|levofloxacin|ofloxacin|norfloxacin|moxifloxacin|cefixime|cefuroxime|cefpodoxime|cefadroxil|cephalexin|ceftriaxone|doxycycline|metronidazole|tinidazole|clarithromycin|erythromycin|linezolid|nitrofurantoin|cotrimoxazole|trimethoprim|sulfamethoxazole|rifaximin|faropenem|\b(augmentin|azithral|azee|ciplox|taxim|zifi|monocef|clavam)\b/i;
const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Gemini reads the photo; everything after that is deterministic: high/low flags from the
 * printed range, critical values, ingredient resolution and interaction checks against
 * the person's current medicines. The image itself is never stored.
 */
export async function readDocument({ data, mimeType, language = 'en' }) {
  let ai;
  try {
    ai = await aiReadDocument({ data, mimeType, language });
  } catch (e) {
    if (e.needsAi) return { ok: false, needs_ai: true, message: e.message };
    const error = e instanceof SchemaError || e.badOutput
      ? { kind: 'bad_output', message: 'Gemini could not produce a reliable reading of this document. Try a sharper, well-lit photo.' }
      : describeAiError(e);
    db.audit('document.read', { ok: false, kind: error.kind });
    return { ok: false, error };
  }
  const doc = ai.result;
  const labs = interpretLabs(doc.lab_results, language);
  const current = db.listMeds().filter((m) => m.active);
  const medicines = doc.medicines.map((m, i) => {
    const ingredients = resolveIngredients(m.name);
    const same = current.find((c) => normName(c.name) === normName(m.name)
      || (ingredients.length && c.ingredients.length === ingredients.length && ingredients.every((x) => c.ingredients.includes(x))));
    return { ...m, key: `rx${i}`, ingredients, recognised: ingredients.length > 0, already: same ? same.name : null, antibiotic: ANTIBIOTIC.test(`${m.name} ${ingredients.join(' ')}`) };
  });
  const fresh = medicines.filter((m) => !m.already);
  const combined = analyseMeds([...current, ...fresh.map((m) => ({ id: m.key, name: m.name, dose: m.dose, times: m.times, ingredients: m.ingredients, active: true }))]);
  const freshNames = new Set(fresh.map((m) => m.name));
  const interactions = combined.findings.filter((f) => (f.meds || []).some((n) => freshNames.has(n)));
  const tips = [];
  if (medicines.some((m) => m.antibiotic)) tips.push('antibiotic_course');
  if (medicines.some((m) => !m.legible)) tips.push('confirm_names');
  if (medicines.some((m) => !m.recognised)) tips.push('unrecognised');
  db.audit('document.read', { ok: true, type: doc.doc_type, medicines: medicines.length, labs: labs.rows.length, level: labs.level, model: ai.model });
  return {
    ok: true, ...doc, medicines, lab_results: labs.rows, level: labs.level, interactions, tips,
    current_meds: current.length, engine: ai.engine, model: ai.model, latencyMs: ai.latencyMs,
  };
}

/* ---------------- medications ---------------- */

export function medsOverview() {
  const meds = db.listMeds();
  const analysis = analyseMeds(meds);
  const logs = db.medLogs(daysAgoKey(30));
  const today = dayKey();
  const todayLogs = new Map(logs.filter((l) => l.day === today).map((l) => [`${l.med_id}|${l.slot}`, l.status]));
  return {
    meds: meds.map((m) => ({ ...m, today: Object.fromEntries((m.times || []).map((s) => [s, todayLogs.get(`${m.id}|${s}`) || null])), resolved: analysis.resolved.find((r) => r.id === m.id) || null })),
    analysis,
    adherence7: adherence(meds, logs, 7),
    adherence30: adherence(meds, logs, 30),
    today,
  };
}
