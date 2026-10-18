// Clinical-logic tests: symptom parsing (EN / Hinglish / Devanagari), guardrails,
// medication safety, the baseline twin and AI-output validation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSymptoms } from '../server/clinical/lexicon.mjs';
import { evaluateGuardrails, lintAiOutput, maxLevel, RULES } from '../server/clinical/guardrails.mjs';
import { analyseMeds, resolveIngredients, adherence } from '../server/clinical/meds.mjs';
import { computeBaseline, deviations } from '../server/clinical/baseline.mjs';
import { rankConditions } from '../server/clinical/conditions.mjs';
import { validateTriage, validateDocument, SchemaError } from '../server/ai/schema.mjs';
import { recommendSpecialist } from '../server/clinical/specialists.mjs';
import { parseLabNumber, parseRange, flagFromRange, standardise, checkCritical, interpretLabs } from '../server/clinical/labs.mjs';
import { parseJsonLoose, describeError } from '../server/ai/gemini.mjs';
import { localTriage } from '../server/ai/local.mjs';

const guard = (text, extra = {}) => {
  const p = parseSymptoms(text);
  return evaluateGuardrails({ symptoms: p.symptoms, duration_days: p.duration_days, severity: p.severity, profile: extra.profile || {}, vitals: { temp_c: p.temp_c, spo2: p.spo2, bp_sys: p.bp_sys, bp_dia: p.bp_dia, glucose: p.glucose, ...(extra.vitals || {}) }, deviations: extra.deviations || {} });
};
const ids = (g) => g.fired.map((f) => f.id);

/* ---------------- symptom parsing ---------------- */

test('parses English with duration, Fahrenheit temperature and negation', () => {
  const p = parseSymptoms('Fever since 3 days, 102 F, headache and body ache. No cough.');
  assert.deepEqual([...p.symptoms].sort(), ['body_ache', 'fever', 'headache']);
  assert.deepEqual(p.negated, ['cough']);
  assert.equal(p.duration_days, 3);
  assert.equal(p.temp_c, 38.9);
});

test('parses Hinglish and Devanagari', () => {
  const p = parseSymptoms('2 din se bukhar hai, sir dard aur ulti ho rahi hai');
  assert.ok(['fever', 'headache', 'vomiting'].every((s) => p.symptoms.includes(s)), p.symptoms.join());
  assert.equal(p.duration_days, 2);
  const d = parseSymptoms('मुझे बुखार और खांसी है');
  assert.ok(d.symptoms.includes('fever') && d.symptoms.includes('cough'), d.symptoms.join());
});

test('negation respects clause breaks and Hindi post-negation', () => {
  const a = parseSymptoms('no fever but cough for 3 weeks');
  assert.ok(a.symptoms.includes('cough') && a.negated.includes('fever'));
  const b = parseSymptoms('sir dard hai, bukhar nahi hai');
  assert.ok(b.symptoms.includes('headache'), 'headache must not be negated');
  assert.ok(b.negated.includes('fever'));
});

test('English contractions negate; punctuation ends the negation scope (safety-first)', () => {
  const a = parseSymptoms("I don't have fever, just a sore throat");
  assert.ok(a.negated.includes('fever') && a.symptoms.includes('sore_throat'), JSON.stringify(a));
  const b = parseSymptoms("I don't feel well. Fever since morning");
  assert.ok(b.symptoms.includes('fever'), 'fever must not be negated by an earlier sentence');
  const c = parseSymptoms("haven't had any vomiting");
  assert.ok(c.negated.includes('vomiting'));
  const d = parseSymptoms('no fever, cough since 3 days');
  assert.ok(d.negated.includes('fever') && d.symptoms.includes('cough'));
});

test('temperature fallback reads "fever 3 din se, 102 tha" but not BP or durations', () => {
  assert.equal(parseSymptoms('fever 3 din se, 102 tha').temp_c, 38.9);
  assert.equal(parseSymptoms('bukhar 2 din se hai aur kal raat 101.5 tha').temp_c, 38.6);
  assert.equal(parseSymptoms('fever since yesterday, my bp is 102/70').temp_c, null);
  assert.equal(parseSymptoms('fever for 100 days').temp_c, null);
});

test('extracts SpO2, blood pressure and blood sugar from free text', () => {
  const p = parseSymptoms('feeling dizzy, my oxygen is 91%, bp 182/124 and sugar 45');
  assert.equal(p.spo2, 91);
  assert.equal(p.bp_sys, 182);
  assert.equal(p.bp_dia, 124);
  assert.equal(p.glucose, 45);
});

/* ---------------- guardrails ---------------- */

test('guardrail scenarios reach the expected level', () => {
  const cases = [
    ['Crushing chest pain going to my left arm and sweating', 'emergency', 'CARD-ACS'],
    ['seene mein dard aur baayein haath tak ja raha hai', 'emergency', 'CARD-ACS'],
    ['My face is drooping and my speech is slurred', 'emergency', 'NEURO-STROKE'],
    ['I want to end my life', 'emergency', 'MH-SELFHARM'],
    ['saanp ne kata pair par', 'emergency', 'ENV-SNAKEBITE'],
    ['lips swollen and difficulty breathing after eating peanuts', 'emergency', 'ALLERGY-ANAPHYLAXIS'],
    ['fever with headache and stiff neck', 'emergency', 'INF-MENINGITIS'],
    ['fever 4 days and bleeding gums', 'urgent', 'INF-DENGUE-WARNING'],
    ['dog bit me on the hand', 'urgent', 'BITE-RABIES'],
    ['cough for 3 weeks with night sweats', 'soon', 'INF-TB-SCREEN'],
    ['burning urination since yesterday', 'soon', 'GU-UTI'],
    ['dizzy, sugar 45', 'emergency', 'META-HYPO'],
  ];
  for (const [text, level, rule] of cases) {
    const g = guard(text);
    assert.equal(g.level, level, `"${text}" → ${g.level} (${ids(g).join(',')})`);
    assert.ok(ids(g).includes(rule), `"${text}" should fire ${rule}, fired ${ids(g).join(',')}`);
  }
});

test('a mild cold fires no red flags', () => {
  const g = guard('runny nose and sneezing since this morning, slight sore throat');
  assert.equal(g.level, 'none', ids(g).join(','));
});

test('vitals-driven rules: sepsis criteria and low oxygen', () => {
  const sepsis = guard('fever and feeling confused', { vitals: { hr: 134, rr: 26, confidence: 'high' } });
  assert.ok(ids(sepsis).includes('INF-SEPSIS'));
  assert.equal(sepsis.level, 'emergency');
  // A low-quality camera reading must not trigger heart-rate rules on its own.
  const lowQ = guard('feeling tired', { vitals: { hr: 140, confidence: 'low' } });
  assert.ok(!ids(lowQ).includes('VITAL-HR'), 'low-confidence camera HR should be ignored');
});

test('pregnancy and infant rules use the profile', () => {
  assert.ok(ids(guard('some bleeding', { profile: { pregnant: true } })).includes('OBS-DANGER'));
  assert.equal(guard('fever', { profile: { age: 0 } }).level, 'emergency');
});

test('baseline-twin deviation escalates only together with symptoms', () => {
  assert.ok(ids(guard('feeling feverish and tired', { deviations: { hr: 3.1 } })).includes('TWIN-DEVIATION'));
  const quiet = evaluateGuardrails({ symptoms: [], profile: {}, vitals: {}, deviations: { hr: 3.1 } });
  assert.equal(quiet.level, 'none');
  assert.ok(quiet.advisories.some((a) => a.id === 'TWIN-QUIET'));
});

test('higher-level rules subsume their lower duplicates', () => {
  const g = guard('chest pain spreading to my jaw with sweating');
  assert.ok(ids(g).includes('CARD-ACS') && !ids(g).includes('CARD-CHEST'));
});

test('rules only escalate: the final level is the max of AI and guardrail', () => {
  assert.equal(maxLevel('self_care', 'emergency'), 'emergency');
  assert.equal(maxLevel('urgent', 'soon'), 'urgent');
  assert.equal(maxLevel('soon', 'none'), 'soon');
});

test('every rule cites a source and has a valid level', () => {
  for (const r of RULES) {
    assert.ok(r.source && r.source.length > 5, `${r.id} has no source`);
    assert.ok(['emergency', 'urgent', 'soon'].includes(r.level), r.id);
  }
  assert.equal(new Set(RULES.map((r) => r.id)).size, RULES.length, 'rule ids must be unique');
});

test('output lint removes antibiotics and false reassurance', () => {
  const { result, notes } = lintAiOutput({
    self_care: ['Rest and fluids', 'Take azithromycin 500 mg for 3 days'],
    recommended_actions: ['No need to see a doctor', 'Monitor temperature'],
    summary: 'Probably viral.',
  }, { finalLevel: 'urgent', age: 30 });
  assert.deepEqual(result.self_care, ['Rest and fluids']);
  assert.deepEqual(result.recommended_actions, ['Monitor temperature']);
  assert.ok(notes.some((n) => n.id === 'OUT-AMR') && notes.some((n) => n.id === 'OUT-REASSURE'));
});

/* ---------------- medications ---------------- */

test('resolves Indian brands to ingredients', () => {
  assert.deepEqual(resolveIngredients('Dolo 650 mg tablet'), ['paracetamol']);
  assert.deepEqual(resolveIngredients('Combiflam'), ['ibuprofen', 'paracetamol']);
  assert.deepEqual(resolveIngredients('telma 40'), ['telmisartan']);
});

test('detects duplicate paracetamol and the daily load', () => {
  const r = analyseMeds([
    { id: 'a', name: 'Dolo 650', dose: '650 mg', times: ['morning', 'afternoon', 'night'] },
    { id: 'b', name: 'Sinarest', dose: '1 tablet', times: ['morning', 'night'] },
    { id: 'c', name: 'Crocin', dose: '500 mg', times: ['evening'] },
  ]);
  const f = r.findings.map((x) => x.id);
  assert.ok(f.includes('DUP-PCM'));
  assert.equal(r.paracetamol_mg_per_day, 650 * 3 + 500 * 2 + 500);
  assert.ok(f.includes('PCM-DAILY'), 'over 3 g/day should be flagged');
});

test('detects dangerous interaction classes', () => {
  const has = (meds, id) => analyseMeds(meds.map((name, i) => ({ id: String(i), name, times: ['morning'] }))).findings.some((f) => f.id === id);
  assert.ok(has(['Warf', 'Brufen'], 'BLEED'));
  assert.ok(has(['Manforce', 'Sorbitrate'], 'PDE5-NITRATE'));
  assert.ok(has(['Nexito', 'Ultracet'], 'SEROTONIN'));
  assert.ok(has(['Telma H', 'Voveran'], 'AKI-TRIPLE'));
  assert.ok(has(['Clopilet', 'Omez'], 'CLOPI-PPI'));
  assert.ok(!has(['Telma 40', 'Shelcal'], 'BLEED'));
});

test('adherence ignores doses that are not due yet today', () => {
  const meds = [{ id: 'm', active: true, times: ['morning', 'night'], start_date: '2026-01-01' }];
  const now = new Date('2026-10-17T09:00:00');
  const r = adherence(meds, [{ med_id: 'm', day: now.toISOString().slice(0, 10), slot: 'morning', status: 'taken' }], 1, now);
  assert.equal(r.expected, 1, 'night dose is not due at 9 am');
  assert.equal(r.rate, 100);
});

/* ---------------- baseline twin ---------------- */

test('baseline is robust and excludes situational readings', () => {
  const now = Date.now();
  const readings = [];
  for (let d = 1; d <= 10; d++) readings.push({ id: `r${d}`, ts: new Date(now - d * 86400000).toISOString(), hr: 64 + (d % 3), context: ['resting'], confidence: 'high' });
  readings.push({ id: 'ex', ts: new Date(now - 2 * 86400000).toISOString(), hr: 140, context: ['post_exercise'], confidence: 'high' });
  readings.push({ id: 'lq', ts: new Date(now - 3 * 86400000).toISOString(), hr: 150, context: [], confidence: 'low' });
  const b = computeBaseline(readings, { now });
  assert.ok(b.hr.ready && b.hr.n === 10, `n=${b.hr.n}`);
  assert.ok(Math.abs(b.hr.mean - 65) <= 1, `mean ${b.hr.mean}`);
  assert.ok(deviations({ hr: 80 }, b).hr > 2.5);
  assert.equal(computeBaseline(readings.slice(0, 3), { now }).hr.ready, false);
});

test('condition ranking follows the evidence and the season', () => {
  const monsoon = rankConditions({ symptoms: ['fever', 'body_ache', 'joint_pain', 'eye_pain', 'headache'], duration_days: 2, month: 8 });
  assert.equal(monsoon[0].id, 'dengue');
  const cough = rankConditions({ symptoms: ['cough', 'weight_loss', 'night_sweats'], duration_days: 21 });
  assert.equal(cough[0].id, 'tb');
});

/* ---------------- AI contract & offline engine ---------------- */

test('model output is validated: bad severity is rejected, fields are coerced', () => {
  assert.throws(() => validateTriage({ severity: 'maybe', headline: 'x' }), SchemaError);
  const v = validateTriage({ severity: 'soon', headline: 'See a doctor', follow_up_hours: 999, care_setting: 'moon', possible_conditions: [{ name: 'Flu', likelihood: 'certain', reasoning: 'r' }] });
  assert.equal(v.follow_up_hours, 168);
  assert.equal(v.care_setting, 'primary_care');
  assert.equal(v.possible_conditions[0].likelihood, 'low');
});

test('tolerant JSON parsing and error classification', () => {
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonLoose('Sure! {"a":2} hope this helps'), { a: 2 });
  assert.throws(() => parseJsonLoose('{"a": oops}'), (e) => e.badOutput === true);
  assert.throws(() => parseJsonLoose(''), (e) => e.badOutput === true);
  assert.equal(describeError(Object.assign(new Error('API key not valid. Please pass a valid API key.'), { status: 400 })).kind, 'auth');
  assert.equal(describeError(Object.assign(new Error('Resource has been exhausted'), { status: 429 })).kind, 'quota');
  assert.equal(describeError(new Error('timeout')).kind, 'timeout');
  // A rejected reasoning depth must not be mistaken for an unavailable model (seen live on gemini-3.8-flash).
  assert.equal(describeError(Object.assign(new Error('Thinking level THINKING_LEVEL_MINIMAL is not supported for this model. Please retry with other thinking level.'), { status: 400 })).kind, 'thinking');
  assert.equal(describeError(Object.assign(new Error('models/gemini-9-flash is not found for API version v1beta'), { status: 404 })).kind, 'model');
});

test('Gemini adapter: rejected thinking level retries the same model; a 429 fails over and rests the model', async () => {
  const gemini = await import('../server/ai/gemini.mjs');
  const calls = [];
  const fake = {
    models: {
      list: async () => ['gemini-3.8-flash', 'gemini-3.6-flash'].map((n) => ({ name: `models/${n}`, supportedActions: ['generateContent'] })),
      generateContent: async () => { throw new Error('should use interactions'); },
    },
    interactions: {
      create: async (p) => {
        calls.push(`${p.model}${p.generation_config ? ':' + p.generation_config.thinking_level : ''}`);
        if (p.generation_config && p.generation_config.thinking_level === 'minimal') throw Object.assign(new Error('Thinking level THINKING_LEVEL_MINIMAL is not supported for this model.'), { status: 400 });
        // 3.8-flash allows 3 requests (the rejected-thinking attempt counts), then hits its free-tier quota.
        if (p.model === 'gemini-3.8-flash' && calls.filter((c) => c.startsWith('gemini-3.8')).length > 3) throw Object.assign(new Error('You exceeded your current quota'), { status: 429 });
        return { output_text: '{"ok": true}' };
      },
    },
  };
  gemini._useClientForTests(fake, ['gemini-3.8-flash', 'gemini-3.6-flash']);
  const a = await gemini.generateJSON({ system: 's', input: 'i', schema: {}, thinking: 'minimal' });
  assert.equal(a.model, 'gemini-3.8-flash', 'same model, retried without the rejected thinking level');
  assert.deepEqual(calls, ['gemini-3.8-flash:minimal', 'gemini-3.8-flash']);
  await gemini.generateJSON({ system: 's', input: 'i', schema: {}, thinking: 'low' });
  const c = await gemini.generateJSON({ system: 's', input: 'i', schema: {}, thinking: 'low' });
  assert.equal(c.model, 'gemini-3.6-flash', 'quota on 3.8 → answered by 3.6');
  assert.ok(gemini.status().resting_models.some((m) => m.model === 'gemini-3.8-flash'));
  const d = await gemini.generateJSON({ system: 's', input: 'i', schema: {}, thinking: 'low' });
  assert.equal(d.model, 'gemini-3.6-flash', 'resting model is skipped until its cooldown ends');
  gemini.configure(null);
});

test('offline engine produces a valid triage object that honours the guardrail', () => {
  const p = parseSymptoms('chest pain spreading to left arm, sweating');
  const g = evaluateGuardrails({ symptoms: p.symptoms, profile: {}, vitals: {} });
  const out = validateTriage(localTriage({ parsed: p, vitals: {}, guard: g, devNotes: [], profile: {} }));
  assert.equal(out.severity, 'emergency');
  assert.equal(out.care_setting, 'hospital_er');
  assert.match(out.possible_conditions[0].name, /heart attack|angina/i);
});

/* ---------------- specialist finder ---------------- */

test('specialist finder: safety rules decide, then the AI, then the condition; children and pregnancy are routed', () => {
  const chest = guard('chest pain spreading to left arm, sweating');
  const r1 = recommendSpecialist({ severity: 'emergency', guard: chest, ai: { specialist: 'gastroenterologist', specialist_reason: 'acidity' } });
  assert.equal(r1.id, 'cardiologist', 'a fired cardiac rule overrides the AI');
  assert.equal(r1.source, 'rule');
  assert.equal(r1.emergency, true);
  assert.match(r1.maps_url, /emergency%20hospital%20near%20me/);
  const r2 = recommendSpecialist({ severity: 'soon', guard: { fired: [] }, ai: { specialist: 'dermatologist', specialist_reason: 'Itchy rash' } });
  assert.equal(r2.id, 'dermatologist');
  assert.equal(r2.source, 'ai');
  assert.ok(r2.teleconsult_ok);
  assert.ok(r2.alternatives.some((a) => a.id === 'general_physician'));
  assert.equal(recommendSpecialist({ severity: 'soon', localTop: 'conjunctivitis' }).id, 'ophthalmologist');
  assert.equal(recommendSpecialist({ severity: 'soon', conditions: ['Possible migraine'] }).id, 'neurologist');
  assert.equal(recommendSpecialist({ severity: 'soon', conditions: ['Heartburn (acid reflux)'] }).id, 'gastroenterologist', 'heartburn is not a heart problem');
  assert.equal(recommendSpecialist({ severity: 'soon', conditions: ['Viral fever', 'Possible migraine'] }).id, 'general_physician', 'the top condition decides');
  const child = recommendSpecialist({ severity: 'soon', localTop: 'pneumonia', profile: { age: 6 } });
  assert.equal(child.id, 'pediatrician');
  assert.ok(child.alternatives.some((a) => a.id === 'pulmonologist'));
  assert.ok(recommendSpecialist({ severity: 'soon', localTop: 'uti', profile: { pregnant: true } }).alternatives.some((a) => a.id === 'gynecologist'));
  assert.equal(recommendSpecialist({}).id, 'general_physician');
  assert.equal(recommendSpecialist({ severity: 'soon', ai: { specialist: 'astrologer' } }).id, 'general_physician', 'unknown AI value ignored');
  assert.match(recommendSpecialist({ severity: 'urgent', language: 'hi' }).name, /[ऀ-ॿ]/, 'Hindi names');
});

test('triage schema keeps a valid specialist and drops an invented one', () => {
  const base = { severity: 'soon', headline: 'See a doctor', summary: '', possible_conditions: [], vitals_interpretation: '', recommended_actions: [], self_care: [], watch_for: [], questions_for_doctor: [], follow_up_questions: [], care_setting: 'primary_care', follow_up_hours: 24, confidence: 'medium' };
  assert.equal(validateTriage({ ...base, specialist: 'ent', specialist_reason: 'Ear pain' }).specialist, 'ent');
  assert.equal(validateTriage({ ...base, specialist: 'witch_doctor' }).specialist, null);
});

/* ---------------- prescription / lab report reader ---------------- */

test('lab reader: flags come from the printed range and units are normalised before critical checks', () => {
  assert.equal(parseLabNumber('1,50,000'), 150000);
  assert.equal(parseLabNumber('1.5 lakh'), 150000);
  assert.equal(parseLabNumber('Positive'), null);
  assert.deepEqual(parseRange('1.5 - 4.5 lakh'), { lo: 150000, hi: 450000 });
  assert.deepEqual(parseRange('Up to 5'), { lo: null, hi: 5 });
  assert.equal(parseRange('M: 13-17 F: 12-15'), null, 'two ranges are ambiguous: no flag');
  assert.equal(flagFromRange('85', '150-450'), 'low');
  assert.equal(flagFromRange('95', '70 - 100'), 'normal');
  assert.equal(flagFromRange('300', '150000-450000'), null, 'mismatched units are not guessed');
  assert.equal(standardise('platelets', '85', '10^3/uL'), 85000);
  assert.equal(standardise('platelets', '1.2 lakh', 'lakh/cumm'), 120000, 'a multiplier is applied once');
  assert.equal(standardise('glucose_fasting', '5.5', 'mmol/L'), 99);
  const { rows, level } = interpretLabs([
    { test: 'Platelets', value: '15', unit: '10^3/uL', reference_range: '150-450', analyte: 'platelets', value_standard: 15 },
    { test: 'HbA1c', value: '7.2', unit: '%', reference_range: '4.0-5.6', analyte: 'hba1c', value_standard: 7.2 },
  ]);
  assert.equal(rows[0].value_standard, 15000, 'our conversion beats a mis-converted model value');
  assert.equal(rows[0].critical.level, 'urgent');
  assert.equal(rows[1].flag, 'high');
  assert.equal(rows[1].critical.level, 'soon');
  assert.equal(level, 'urgent');
  assert.equal(checkCritical('platelets', 85).level, 'check', 'implausible value: confirm the units');
});

test('document schema validation coerces model output', () => {
  const d = validateDocument({
    doc_type: 'prescription', summary: 'x', doctor_or_lab: '', date: '',
    medicines: [{ name: 'Dolo 650', dose: '1 tab', frequency: '1-0-1', times: ['morning', 'night', 'noon'], duration: '3 days', instructions: '', legible: true }, { name: '' }],
    lab_results: [{ test: 'Hb', value: 12.5, unit: 'g/dL', reference_range: '13-17', analyte: 'nonsense', value_standard: null, explanation: '' }],
    warnings: [],
  });
  assert.equal(d.medicines.length, 1);
  assert.deepEqual(d.medicines[0].times, ['morning', 'night']);
  assert.equal(d.lab_results[0].analyte, 'other');
  assert.equal(d.lab_results[0].value, '12.5');
  assert.equal(d.lab_results[0].value_standard, -1);
  assert.throws(() => validateDocument({ doc_type: 'selfie' }), SchemaError);
});

test('Gemini adapter: image input works on both API surfaces', async () => {
  const gemini = await import('../server/ai/gemini.mjs');
  const seen = [];
  const fake = {
    models: {
      list: async () => [{ name: 'models/gemini-3.8-flash', supportedActions: ['generateContent'] }],
      generateContent: async (p) => { seen.push(['generateContent', p.contents]); return { text: '{"ok": true}' }; },
    },
    interactions: { create: async (p) => { seen.push(['interactions', p.input]); throw new Error('interaction finished without text'); } },
  };
  gemini._useClientForTests(fake, ['gemini-3.8-flash']);
  const input = [{ type: 'text', text: 'Read this' }, { type: 'image', data: 'QUJD', mime_type: 'image/jpeg' }];
  const out = await gemini.generateJSON({ system: 's', input, schema: {}, thinking: 'low' });
  assert.equal(out.json.ok, true);
  assert.deepEqual(seen[0], ['interactions', input], 'Interactions API receives the content blocks as they are');
  assert.deepEqual(seen[1][1], [{ role: 'user', parts: [{ text: 'Read this' }, { inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } }] }], 'generateContent receives inline parts');
  gemini.configure(null);
});
