/**
 * Output contracts shared by every engine (Gemini and the offline engine), as
 * JSON Schema the model is constrained to, plus validators that coerce or
 * reject whatever comes back — model output is never trusted blindly.
 */
import { SPECIALTY_IDS } from '../clinical/specialists.mjs';
import { ANALYTES } from '../clinical/labs.mjs';

const str = (description) => ({ type: 'string', description });
const strList = (max, description) => ({ type: 'array', items: { type: 'string' }, maxItems: max, description });

export const SEVERITIES = ['self_care', 'soon', 'urgent', 'emergency'];
export const CARE_SETTINGS = ['home', 'teleconsult', 'primary_care', 'hospital_er'];

export const TRIAGE_SCHEMA = {
  type: 'object',
  properties: {
    severity: { type: 'string', enum: SEVERITIES, description: 'self_care = manage at home; soon = doctor within 24–72 h; urgent = today, within hours; emergency = call 112/108 now. Must be at least the highest SAFETY_FLAGS level.' },
    headline: str('One short sentence (at most 14 words) telling the person what to do now.'),
    summary: str('2–4 plain-language sentences explaining the assessment, referencing their own inputs.'),
    possible_conditions: {
      type: 'array', maxItems: 4,
      description: 'Most likely explanations first. Use "possible" language; never a definitive diagnosis.',
      items: {
        type: 'object',
        properties: {
          name: str('Condition name in plain language.'),
          likelihood: { type: 'string', enum: ['high', 'moderate', 'low'] },
          reasoning: str('One sentence grounded in the inputs.'),
        },
        required: ['name', 'likelihood', 'reasoning'],
      },
    },
    vitals_interpretation: str('What the camera/manual vitals and baseline deviations add, weighed by signal quality. Say so if vitals were not available.'),
    recommended_actions: strList(5, 'Concrete next steps, most important first.'),
    self_care: strList(6, 'Safe home measures. No prescription-only medicines, no antibiotics.'),
    watch_for: strList(6, 'Specific warning signs that should make them seek care sooner.'),
    questions_for_doctor: strList(4, 'Useful questions to ask the doctor.'),
    follow_up_questions: strList(3, 'Up to 3 short questions whose answers would most change this assessment. Empty if none needed.'),
    care_setting: { type: 'string', enum: CARE_SETTINGS },
    follow_up_hours: { type: 'integer', minimum: 1, maximum: 168, description: 'When to re-assess or check in, in hours.' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Confidence in this assessment given the information available.' },
    specialist: { type: 'string', enum: SPECIALTY_IDS, description: 'The kind of doctor best placed to see this person next. general_physician for common fevers and infections, unclear pictures, or when several systems are involved; a specialty only when the picture clearly points to one organ system.' },
    specialist_reason: str('One short sentence: why this kind of doctor.'),
  },
  required: ['severity', 'headline', 'summary', 'possible_conditions', 'vitals_interpretation', 'recommended_actions', 'self_care', 'watch_for', 'questions_for_doctor', 'follow_up_questions', 'care_setting', 'follow_up_hours', 'confidence', 'specialist', 'specialist_reason'],
};

const TIMES = ['morning', 'afternoon', 'evening', 'night'];
export const DOC_TYPES = ['prescription', 'lab_report', 'other', 'unreadable'];

export const DOCUMENT_SCHEMA = {
  type: 'object',
  properties: {
    doc_type: { type: 'string', enum: DOC_TYPES, description: 'unreadable if the image is too blurred, dark or cropped to read reliably.' },
    summary: str('2-3 plain-language sentences: what this document is and what it says. Never diagnose.'),
    doctor_or_lab: str('Doctor, clinic or laboratory name if printed, else empty.'),
    date: str('Date printed on the document, as written, else empty.'),
    medicines: {
      type: 'array', maxItems: 12,
      items: {
        type: 'object',
        properties: {
          name: str('Medicine name exactly as written, with strength, e.g. "Dolo 650" or "Azithral 500".'),
          dose: str('Amount per intake as written, e.g. "1 tablet" or "5 ml". Empty if not written.'),
          frequency: str('As written, e.g. "1-0-1", "BD", "twice a day", "SOS".'),
          times: { type: 'array', items: { type: 'string', enum: TIMES }, maxItems: 4, description: 'Times of day implied by the frequency (1-0-1 = morning and night; 1-1-1 = morning, afternoon, night). Empty for SOS/as needed.' },
          duration: str('As written, e.g. "5 days". Empty if not written.'),
          instructions: str('As written, e.g. "after food". Empty if none.'),
          legible: { type: 'boolean', description: 'false if you are not sure you read the name correctly.' },
        },
        required: ['name', 'dose', 'frequency', 'times', 'duration', 'instructions', 'legible'],
      },
    },
    lab_results: {
      type: 'array', maxItems: 40,
      items: {
        type: 'object',
        properties: {
          test: str('Test name as printed.'),
          value: str('Result exactly as printed, including any multiplier such as "1.2 lakh" or "85,000".'),
          unit: str('Unit as printed, else empty.'),
          reference_range: str('Reference or normal range exactly as printed, else empty.'),
          analyte: { type: 'string', enum: ANALYTES, description: 'Closest standard analyte; other if none fits.' },
          value_standard: { type: 'number', description: 'The value in standard units: platelets and WBC per microlitre (cells/cumm), haemoglobin g/dL, glucose mg/dL, HbA1c %, potassium and sodium mmol/L, INR as a ratio. -1 if you cannot convert.' },
          explanation: str('One plain-language sentence on what this test measures.'),
        },
        required: ['test', 'value', 'unit', 'reference_range', 'analyte', 'value_standard', 'explanation'],
      },
    },
    warnings: strList(4, 'Anything to confirm with a doctor or pharmacist, e.g. a hard-to-read name or a missing dose.'),
  },
  required: ['doc_type', 'summary', 'doctor_or_lab', 'date', 'medicines', 'lab_results', 'warnings'],
};

export const INSIGHT_SCHEMA = {
  type: 'object',
  properties: {
    headline: str('One sentence summarising the most important pattern.'),
    summary: str('2–3 sentences in plain language.'),
    observations: {
      type: 'array', maxItems: 5,
      items: {
        type: 'object',
        properties: {
          metric: { type: 'string', enum: ['hr', 'rmssd', 'rr', 'stress', 'temp_c', 'spo2', 'bp_sys', 'adherence', 'symptoms', 'general'] },
          text: str('One concrete observation with numbers.'),
          direction: { type: 'string', enum: ['up', 'down', 'stable', 'mixed'] },
          concern: { type: 'string', enum: ['none', 'watch', 'discuss'] },
        },
        required: ['metric', 'text', 'direction', 'concern'],
      },
    },
    suggestions: strList(4, 'Practical, safe lifestyle or follow-up suggestions.'),
    discuss_with_doctor: { type: 'boolean' },
  },
  required: ['headline', 'summary', 'observations', 'suggestions', 'discuss_with_doctor'],
};

export const SOAP_SCHEMA = {
  type: 'object',
  properties: {
    one_liner: str('Clinical one-liner, e.g. "34-year-old male with 3 days of fever and myalgia, no comorbidities."'),
    subjective: str('History of presenting illness in clinical shorthand: onset, duration, severity, associated and negative symptoms, relevant history, medications, allergies.'),
    objective: str('Vitals with method and quality (camera rPPG estimates are not medical-grade), baseline deviations, voice biomarkers, manual readings.'),
    assessment: str('Triage tier, safety rules that fired, and differential considerations — clearly labelled as AI-suggested and unverified.'),
    plan: str('Suggested next steps and tests for the clinician to consider.'),
    red_flags: strList(6, 'Red flags present or explicitly screened negative.'),
    patient_questions: strList(4, 'Questions the patient wants answered.'),
  },
  required: ['one_liner', 'subjective', 'objective', 'assessment', 'plan', 'red_flags', 'patient_questions'],
};

/* ---------------- validators ---------------- */

const asStr = (v, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const asList = (v, max, len = 300) => (Array.isArray(v) ? v.map((x) => asStr(String(x ?? ''), len)).filter(Boolean).slice(0, max) : []);
const oneOf = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);

export class SchemaError extends Error {}

export function validateTriage(o) {
  if (!o || typeof o !== 'object') throw new SchemaError('not an object');
  if (!SEVERITIES.includes(o.severity)) throw new SchemaError(`bad severity: ${o.severity}`);
  const headline = asStr(o.headline, 200);
  if (!headline) throw new SchemaError('missing headline');
  return {
    severity: o.severity,
    headline,
    summary: asStr(o.summary, 1200),
    possible_conditions: (Array.isArray(o.possible_conditions) ? o.possible_conditions : [])
      .filter((c) => c && typeof c.name === 'string')
      .slice(0, 4)
      .map((c) => ({ name: asStr(c.name, 120), likelihood: oneOf(c.likelihood, ['high', 'moderate', 'low'], 'low'), reasoning: asStr(c.reasoning, 400) })),
    vitals_interpretation: asStr(o.vitals_interpretation, 800),
    recommended_actions: asList(o.recommended_actions, 5),
    self_care: asList(o.self_care, 6),
    watch_for: asList(o.watch_for, 6),
    questions_for_doctor: asList(o.questions_for_doctor, 4),
    follow_up_questions: asList(o.follow_up_questions, 3, 200),
    care_setting: oneOf(o.care_setting, CARE_SETTINGS, 'primary_care'),
    follow_up_hours: Math.min(168, Math.max(1, Math.round(Number(o.follow_up_hours) || 24))),
    confidence: oneOf(o.confidence, ['low', 'medium', 'high'], 'medium'),
    specialist: oneOf(o.specialist, SPECIALTY_IDS, null),
    specialist_reason: asStr(o.specialist_reason, 240),
  };
}

export function validateDocument(o) {
  if (!o || typeof o !== 'object' || !DOC_TYPES.includes(o.doc_type)) throw new SchemaError('bad document reading');
  return {
    doc_type: o.doc_type,
    summary: asStr(o.summary, 900),
    doctor_or_lab: asStr(o.doctor_or_lab, 120),
    date: asStr(o.date, 40),
    medicines: (Array.isArray(o.medicines) ? o.medicines : []).filter((m) => m && asStr(m.name)).slice(0, 12).map((m) => ({
      name: asStr(m.name, 80),
      dose: asStr(m.dose, 40),
      frequency: asStr(m.frequency, 40),
      times: Array.isArray(m.times) ? [...new Set(m.times.filter((t) => TIMES.includes(t)))] : [],
      duration: asStr(m.duration, 40),
      instructions: asStr(m.instructions, 120),
      legible: m.legible !== false,
    })),
    lab_results: (Array.isArray(o.lab_results) ? o.lab_results : []).filter((r) => r && asStr(r.test) && asStr(String(r.value ?? ''))).slice(0, 40).map((r) => ({
      test: asStr(r.test, 80),
      value: asStr(String(r.value), 40),
      unit: asStr(r.unit, 30),
      reference_range: asStr(r.reference_range, 60),
      analyte: oneOf(r.analyte, ANALYTES, 'other'),
      value_standard: typeof r.value_standard === 'number' && Number.isFinite(r.value_standard) ? r.value_standard : -1,
      explanation: asStr(r.explanation, 240),
    })),
    warnings: asList(o.warnings, 4),
  };
}

export function validateInsight(o) {
  if (!o || typeof o !== 'object' || !asStr(o.headline)) throw new SchemaError('bad insight');
  return {
    headline: asStr(o.headline, 240),
    summary: asStr(o.summary, 900),
    observations: (Array.isArray(o.observations) ? o.observations : []).slice(0, 5).map((x) => ({
      metric: oneOf(x && x.metric, INSIGHT_SCHEMA.properties.observations.items.properties.metric.enum, 'general'),
      text: asStr(x && x.text, 300),
      direction: oneOf(x && x.direction, ['up', 'down', 'stable', 'mixed'], 'stable'),
      concern: oneOf(x && x.concern, ['none', 'watch', 'discuss'], 'none'),
    })).filter((x) => x.text),
    suggestions: asList(o.suggestions, 4),
    discuss_with_doctor: !!o.discuss_with_doctor,
  };
}

export function validateSoap(o) {
  if (!o || typeof o !== 'object' || !asStr(o.one_liner)) throw new SchemaError('bad soap');
  return {
    one_liner: asStr(o.one_liner, 300),
    subjective: asStr(o.subjective, 1500),
    objective: asStr(o.objective, 1500),
    assessment: asStr(o.assessment, 1500),
    plan: asStr(o.plan, 1200),
    red_flags: asList(o.red_flags, 6),
    patient_questions: asList(o.patient_questions, 4),
  };
}
