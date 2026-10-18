/**
 * Offline clinical engine. Produces the same contracts as the Gemini path from
 * the knowledge base, guardrails and baseline twin, so Nadi keeps working with
 * no network, no key, or an exhausted quota — and says so honestly.
 */
import { rankConditions } from '../clinical/conditions.mjs';
import { levelRank, maxLevel } from '../clinical/guardrails.mjs';
import { symptomLabel } from '../clinical/lexicon.mjs';
import { TWIN_METRICS } from '../clinical/baseline.mjs';

const uniq = (arr) => [...new Set(arr.filter(Boolean))];
const fmt = (v, d = 0) => (v == null ? '—' : Number(v).toFixed(d));

const HEADLINES = {
  self_care: 'This looks manageable at home — rest, fluids and keep an eye on it.',
  soon: 'Please see a doctor within the next 1–2 days.',
  urgent: 'Please see a doctor today — within the next few hours.',
  emergency: 'This needs emergency care now — call 112 or 108.',
};
const CARE = { self_care: ['home', 48], soon: ['primary_care', 24], urgent: ['primary_care', 4], emergency: ['hospital_er', 1] };
const PATHWAY = {
  self_care: 'Rest at home, re-check how you feel in 24–48 hours and repeat a Nadi scan tomorrow at the same time.',
  soon: 'Book a doctor visit in the next 1–2 days — eSanjeevani offers free video consultations if travel is hard.',
  urgent: 'Go to a doctor today: your nearest clinic, PHC/CHC or hospital OPD.',
  emergency: 'Call 112 or 108 now, or have someone take you to the nearest emergency department.',
};

export function vitalsNarrative(vitals, devNotes = []) {
  if (!vitals || (vitals.hr == null && vitals.temp_c == null && vitals.spo2 == null && vitals.bp_sys == null)) {
    return 'No recent vitals were available. A 60-second Nadi camera scan adds heart rate, breathing rate and stress to this assessment.';
  }
  const parts = [];
  if (vitals.hr != null) {
    const src = vitals.hr_source === 'manual' ? 'entered' : `camera estimate, signal quality ${fmt(vitals.quality)}/100`;
    const band = vitals.hr > 100 ? 'above the usual resting range' : vitals.hr < 50 ? 'below the usual resting range' : 'within the usual resting range';
    parts.push(`Heart rate ${fmt(vitals.hr)} bpm (${src}) is ${band}.`);
  }
  if (vitals.rr != null) parts.push(`Breathing rate ${fmt(vitals.rr, 1)}/min is ${vitals.rr > 20 ? 'faster than the typical 12–20' : vitals.rr < 10 ? 'slower than typical' : 'within the typical 12–20 range'}.`);
  if (vitals.rmssd != null) parts.push(`HRV (RMSSD) ${fmt(vitals.rmssd)} ms.`);
  if (vitals.temp_c != null) parts.push(`Temperature ${fmt(vitals.temp_c, 1)} °C${vitals.temp_c >= 38 ? ' indicates fever' : ''}.`);
  if (vitals.spo2 != null) parts.push(`Oxygen ${fmt(vitals.spo2)}%${vitals.spo2 < 94 ? ' is below normal' : ' is normal'}.`);
  if (vitals.bp_sys != null) parts.push(`BP ${fmt(vitals.bp_sys)}/${fmt(vitals.bp_dia)} mmHg.`);
  if (vitals.quality != null && vitals.quality < 40 && vitals.hr_source !== 'manual') parts.push('The camera signal was weak, so these estimates carry little weight.');
  const notable = devNotes.filter((d) => d.concerning);
  if (notable.length) parts.push(`${notable.length === 1 ? 'One reading is' : `${notable.length} readings are`} well outside your own baseline (listed below) — a meaningful change for you, even where a number looks "normal" for the average person.`);
  return parts.join(' ');
}

function followUpQuestions(parsed, vitals) {
  const s = new Set(parsed.symptoms);
  const q = [];
  if (parsed.duration_days == null && s.size) q.push('How many days have you had these symptoms?');
  if (s.has('fever') && vitals.temp_c == null) q.push('What is your temperature (°F or °C), if you can measure it?');
  if (s.has('chest_pain')) q.push('Does the pain spread to your arm, jaw or back, or come with sweating or breathlessness?');
  if (s.has('headache') && !s.has('worst_headache')) q.push('Did the headache start suddenly and is it the worst you have ever had?');
  if (s.has('abdominal_pain') && parsed.severity == null) q.push('How bad is the pain from 1 to 10, and where exactly is it?');
  if (s.has('diarrhea') || s.has('vomiting')) q.push('Are you passing urine normally and able to keep fluids down?');
  if (s.has('cough') && parsed.duration_days == null) q.push('Has the cough lasted 2 weeks or more?');
  if (s.has('breathless')) q.push('Are you breathless at rest, or only when walking or climbing stairs?');
  if (!s.size) q.push('What symptoms are you experiencing, and since when?');
  return q.slice(0, 3);
}

function headlineFor(severity, lead) {
  if (!lead || lead.prob < 0.3 || severity === 'emergency') return HEADLINES[severity];
  const name = lead.name.split(' (')[0];
  const short = name.charAt(0).toLowerCase() + name.slice(1);
  if (severity === 'self_care') return `Likely ${short} — manageable at home with care.`;
  if (severity === 'soon') return `Possible ${short} — please see a doctor within 1–2 days.`;
  return `Possible ${short} — please see a doctor today.`;
}

export function localTriage(ctx) {
  const { parsed, vitals = {}, guard, devNotes = [], profile = {} } = ctx;
  const ranked = rankConditions({ symptoms: parsed.symptoms, duration_days: parsed.duration_days, vitals, stressHigh: (vitals.stress ?? 0) >= 70 });
  const top = ranked.filter((r) => r.prob >= 0.03).slice(0, 4);

  let severity = 'self_care';
  if (top[0] && top[0].prob >= 0.3) severity = maxLevel(severity, top[0].level);
  if (top.some((t) => t.prob >= 0.2 && levelRank(t.level) >= levelRank('soon'))) severity = maxLevel(severity, 'soon');
  if ((parsed.severity ?? 0) >= 8) severity = maxLevel(severity, 'soon');
  if ((parsed.severity ?? 0) >= 9) severity = maxLevel(severity, 'urgent');
  if (guard && guard.level !== 'none') severity = maxLevel(severity, guard.level);

  const likelihood = (p) => (p >= 0.45 ? 'high' : p >= 0.18 ? 'moderate' : 'low');
  const possible = top.map((c) => ({
    name: c.name,
    likelihood: likelihood(c.prob),
    reasoning: `${c.why} Matches: ${c.explained.map((id) => symptomLabel(id).toLowerCase()).join(', ')}.`,
  }));

  const lead = top[0];
  const symptomText = parsed.symptoms.length ? parsed.symptoms.slice(0, 5).map((id) => symptomLabel(id).toLowerCase()).join(', ') : 'the symptoms you described';
  const dur = parsed.duration_days != null ? ` for about ${parsed.duration_days >= 1 ? Math.round(parsed.duration_days) + ' day' + (Math.round(parsed.duration_days) === 1 ? '' : 's') : 'less than a day'}` : '';
  const flagged = guard && guard.fired.length ? ` Our safety check flagged: ${guard.fired.slice(0, 2).map((f) => f.title.toLowerCase()).join('; ')}.` : '';
  const summary = `You reported ${symptomText}${dur}.` +
    (lead ? ` The most likely explanation is ${lead.name.toLowerCase().replace(/ \(.*\)$/, '')}${top[1] ? `, though ${top[1].name.toLowerCase().replace(/ \(.*\)$/, '')} is also possible` : ''}.` : ' This does not clearly match a common pattern, so a doctor should take a look if it persists.') +
    flagged;

  // A fired rule at the final severity already says where to go; don't repeat it.
  const ruleCoversPathway = guard && guard.fired.some((f) => f.level === severity);
  const actions = uniq([
    ...(guard ? guard.fired.slice(0, 2).map((f) => f.action) : []),
    ruleCoversPathway ? null : PATHWAY[severity],
    lead && lead.tests && levelRank(severity) >= levelRank('soon') ? `Ask about: ${lead.tests}.` : null,
    severity !== 'emergency' ? 'Re-run this check if anything gets worse or new symptoms appear.' : null,
  ]).slice(0, 5);

  const feverish = parsed.symptoms.includes('fever') || (vitals.temp_c ?? 0) >= 38;
  const baseCare = [...(top[0] ? top[0].self_care : []), ...(top[1] && top[1].prob >= 0.2 ? top[1].self_care.slice(0, 1) : [])];
  const coversFever = baseCare.some((s) => /paracetamol|fluid/i.test(s));
  const selfCare = uniq([
    ...baseCare,
    feverish && !coversFever ? 'Drink plenty of fluids; paracetamol at the label dose can ease fever — check the total from all medicines' : null,
  ]).slice(0, 6);

  const watchFor = uniq([
    ...(top[0] ? top[0].watch_for : []),
    ...(top[1] && top[1].prob >= 0.2 ? top[1].watch_for.slice(0, 1) : []),
    'Breathing difficulty, chest pain, confusion or fainting — call 112 / 108',
  ]).slice(0, 6);

  const questions = uniq([...(top[0] ? top[0].ask_doctor : []), ...(top[1] ? top[1].ask_doctor.slice(0, 1) : []), profile.conditions && profile.conditions.length ? 'Do any of my current medicines need adjusting while I am unwell?' : null]).slice(0, 4);

  const hasVitals = vitals.hr != null || vitals.temp_c != null;
  const confidence = top[0] && top[0].prob >= 0.5 && parsed.symptoms.length >= 3 ? 'high' : parsed.symptoms.length <= 1 && !hasVitals ? 'low' : 'medium';
  const [care_setting, follow_up_hours] = CARE[severity];

  return {
    severity,
    headline: headlineFor(severity, lead),
    summary,
    possible_conditions: possible,
    vitals_interpretation: vitalsNarrative(vitals, devNotes),
    recommended_actions: actions,
    self_care: severity === 'emergency' ? [] : selfCare,
    watch_for: watchFor,
    questions_for_doctor: questions,
    follow_up_questions: followUpQuestions(parsed, vitals),
    care_setting,
    follow_up_hours,
    confidence,
    specialist: null, // decided by the specialist finder from rules and the top condition
    specialist_reason: '',
    top_condition_id: lead ? lead.id : null,
  };
}

export function localInsights(summary, { adherence = null, episodes = [] } = {}) {
  const obs = [];
  let worst = null;
  for (const [key, m] of Object.entries(summary.metrics || {})) {
    const meta = TWIN_METRICS[key];
    if (!meta) continue;
    let z = null;
    if (m.baseline && m.recent_mean != null) z = (m.recent_mean - m.baseline.mean) / m.baseline.sd;
    const change = m.change_pct;
    const direction = change == null ? 'stable' : Math.abs(change) < 3 ? 'stable' : change > 0 ? 'up' : 'down';
    const concerningDir = meta.higherIsWorse ? (z ?? 0) > 0 : (z ?? 0) < 0;
    const concern = z != null && Math.abs(z) >= 2 && concerningDir ? 'discuss' : z != null && Math.abs(z) >= 1 && concerningDir ? 'watch' : 'none';
    const base = m.baseline ? ` (your baseline ${fmt(m.baseline.mean, meta.decimals)} ± ${fmt(m.baseline.sd, meta.decimals)})` : '';
    const changeTxt = change != null ? `, ${change > 0 ? 'up' : 'down'} ${Math.abs(change).toFixed(0)}% on the previous period` : '';
    obs.push({ metric: key, text: `${meta.label}: averaging ${fmt(m.recent_mean, meta.decimals)} ${meta.unit}${base}${changeTxt}.`, direction, concern });
    if (z != null && (!worst || Math.abs(z) > Math.abs(worst.z))) worst = { key, z, label: meta.label, concerningDir };
  }
  if (adherence && adherence.rate != null) {
    obs.push({ metric: 'adherence', text: `Medicines: ${adherence.taken} of ${adherence.expected} doses logged in the last ${adherence.days} days (${adherence.rate}%).`, direction: 'stable', concern: adherence.rate < 80 ? 'watch' : 'none' });
  }
  const recentBad = episodes.filter((e) => levelRank(e.severity) >= levelRank('soon')).length;
  if (recentBad) obs.push({ metric: 'symptoms', text: `${recentBad} recent symptom check${recentBad > 1 ? 's' : ''} recommended seeing a doctor.`, direction: 'mixed', concern: 'watch' });

  const hrUp = summary.metrics?.hr?.change_pct > 5, hrvDown = summary.metrics?.rmssd?.change_pct < -10;
  const stressHigh = summary.metrics?.stress?.recent_mean >= 60;
  const suggestions = uniq([
    hrUp || hrvDown ? 'Your body may be under strain (higher resting HR / lower HRV): prioritise 7–8 h of sleep, fluids and a lighter day.' : null,
    stressHigh ? 'Try 5 minutes of slow breathing (in 4 s, out 6 s) twice a day and re-scan to see the effect.' : null,
    adherence && adherence.rate != null && adherence.rate < 80 ? 'Set phone reminders for the doses you miss most often.' : null,
    'Scan at the same time each day, seated and rested, for the most reliable baseline.',
  ]).slice(0, 4);

  const headline = worst && Math.abs(worst.z) >= 1 && worst.concerningDir
    ? `${worst.label} has drifted ${Math.abs(worst.z).toFixed(1)} SD ${worst.z > 0 ? 'above' : 'below'} your normal recently.`
    : 'Your vitals are steady and within your personal normal range.';
  return {
    headline,
    summary: `Based on ${summary.scans} readings over the last ${summary.window_days} days, compared against your own baseline rather than population averages.`,
    observations: obs.slice(0, 5),
    suggestions,
    discuss_with_doctor: !!(worst && Math.abs(worst.z) >= 2 && worst.concerningDir) || recentBad >= 2,
  };
}

export function localSoap(d) {
  const p = d.profile || {};
  const who = [p.age != null ? `${p.age}-year-old` : 'Adult', p.sex === 'female' ? 'female' : p.sex === 'male' ? 'male' : 'patient'].join(' ');
  const syms = (d.parsed?.symptoms || []).map((id) => symptomLabel(id).toLowerCase());
  const dur = d.parsed?.duration_days != null ? `${Math.round(d.parsed.duration_days * 10) / 10} d` : 'duration not stated';
  const conds = (p.conditions || []).length ? `PMH: ${p.conditions.join(', ')}.` : 'No known chronic conditions reported.';
  const v = d.vitals || {};
  const vit = [
    v.hr != null && `HR ${fmt(v.hr)} bpm (${v.hr_source === 'manual' ? 'manual' : `camera rPPG, quality ${fmt(v.quality)}/100`})`,
    v.rr != null && `RR ${fmt(v.rr, 1)}/min (rPPG)`,
    v.rmssd != null && `RMSSD ${fmt(v.rmssd)} ms`,
    v.temp_c != null && `T ${fmt(v.temp_c, 1)} °C`,
    v.spo2 != null && `SpO2 ${fmt(v.spo2)}%`,
    v.bp_sys != null && `BP ${fmt(v.bp_sys)}/${fmt(v.bp_dia)}`,
    v.glucose != null && `glucose ${fmt(v.glucose)} mg/dL`,
  ].filter(Boolean).join(', ');
  const dev = (d.devNotes || []).map((n) => n.text.replace(/your usual/g, 'personal baseline')).join('; ');
  const voice = d.voice ? `Voice (sustained /a/): jitter ${fmt(d.voice.jitter, 2)}%, shimmer ${fmt(d.voice.shimmer, 2)}%, HNR ${fmt(d.voice.hnr, 1)} dB, MPT ${fmt(d.voice.mpt, 1)} s.` : '';
  const flags = (d.guard?.fired || []).map((f) => `${f.id}: ${f.title}`);
  const ai = d.result || {};
  const ddx = (ai.possible_conditions || []).map((c) => `${c.name} (${c.likelihood})`).join('; ');
  const meds = (d.meds || []).map((m) => `${m.name}${m.dose ? ' ' + m.dose : ''}`).join(', ');
  return {
    one_liner: `${who} with ${syms.slice(0, 3).join(', ') || 'symptoms as described'} (${dur}). ${conds}`,
    subjective: `Pt reports: "${(d.text || '').slice(0, 300).replace(/[.\s]+$/, '')}". Parsed: ${syms.join(', ') || '—'}; duration ${dur}${d.parsed?.severity != null ? `; severity ${d.parsed.severity}/10` : ''}. Denies: ${(d.parsed?.negated || []).map((id) => symptomLabel(id).toLowerCase()).join(', ') || 'none recorded'}. ${conds} Meds: ${meds || 'none recorded'}. Allergies: ${(p.allergies || []).join(', ') || 'none recorded'}.${(d.answers || []).length ? ' Follow-up answers: ' + d.answers.map((a) => `${a.q} → ${a.a}`).join('; ') + '.' : ''}`,
    objective: `${vit || 'No vitals recorded.'}${dev ? ` Baseline deviation: ${dev}.` : ''} ${voice} Camera vitals are wellness estimates, not medical-grade.`.trim(),
    assessment: `Triage tier: ${String(d.severity || ai.severity || '').toUpperCase()}. ${flags.length ? 'Safety rules fired: ' + flags.join('; ') + '.' : 'No safety rules fired.'} AI-suggested, unverified differential: ${ddx || '—'}.`,
    plan: `${(ai.recommended_actions || []).slice(0, 3).join(' ')} Consider: ${(ai.questions_for_doctor || []).slice(0, 2).join(' ')}`.trim(),
    red_flags: flags.length ? flags : [`No red-flag rule fired (${d.guard?.checked ?? 'all'} screened)`],
    patient_questions: (ai.questions_for_doctor || []).slice(0, 4),
  };
}
