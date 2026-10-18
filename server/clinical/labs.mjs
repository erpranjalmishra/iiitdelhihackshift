/**
 * Lab report interpretation that does not trust the model's arithmetic:
 * high/low flags come from the reference range printed on the report, values are
 * converted to standard units here, and a small table of critical values decides
 * when a result means "see a doctor today".
 */

const MULT = /(?:x|×|\*)\s*10\s*(?:\^|e)?\s*(\d)|10([³⁵⁶])/;
const SUP = { '³': 3, '⁵': 5, '⁶': 6 };

/** Multiplier written inside a value or range ("1.5 lakh", "x10^3", "10³"), or 1. */
function writtenScale(t) {
  if (/lakh|\blacs?\b/.test(t)) return 100000;
  if (/thousand|\bk\/|\bk\b/.test(t)) return 1000;
  const m = t.match(MULT);
  if (m) return 10 ** (m[1] != null ? +m[1] : SUP[m[2]]);
  return 1;
}

/** Parse a printed number: "1,50,000" → 150000, "1.5 lakh" → 150000, "4.5", "85 x10^3" → 85000. */
export function parseLabNumber(s) {
  if (s == null) return null;
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  const t = String(s).toLowerCase().replace(/,/g, '').trim();
  const m = t.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  return parseFloat(m[0]) * writtenScale(t);
}

/** Parse a printed reference range into { lo, hi }; null when absent or ambiguous (e.g. separate male/female ranges). */
export function parseRange(s) {
  if (!s) return null;
  let t = String(s).toLowerCase().replace(/,/g, '').trim();
  const scale = writtenScale(t);
  t = t.replace(MULT, ' ').replace(/(\d)\s*(?:–|—|to)\s*(\d)/g, '$1-$2');
  const pairs = t.match(/\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?/g) || [];
  if (pairs.length > 1) return null;
  const nums = (t.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  if (/^(<|≤|<=|up\s*to|below|less than)/.test(t) && nums.length) return { lo: null, hi: nums[0] * scale };
  if (/^(>|≥|>=|above|more than)/.test(t) && nums.length) return { lo: nums[0] * scale, hi: null };
  const m = t.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
  if (m && +m[1] <= +m[2]) return { lo: +m[1] * scale, hi: +m[2] * scale };
  return null;
}

/** 'low' | 'high' | 'normal' from the printed range, or null when it cannot be computed reliably. */
export function flagFromRange(value, range) {
  const v = parseLabNumber(value), r = parseRange(range);
  if (v == null || !r) return null;
  // Value and range in different units (e.g. 150 vs 150000–450000): refuse to guess.
  if (r.lo > 0 && r.hi > 0 && v > 0) {
    const mid = (r.lo + r.hi) / 2;
    if (v / mid > 50 || mid / v > 50) return null;
  }
  if (r.lo != null && v < r.lo) return 'low';
  if (r.hi != null && v > r.hi) return 'high';
  return 'normal';
}

/**
 * Convert to the standard unit for each analyte (per µL for counts, g/dL, mg/dL, %, mmol/L).
 * Returns null for analytes we do not convert or values we cannot read.
 */
export function standardise(analyte, value, unit = '') {
  const v = parseLabNumber(value);
  if (v == null) return null;
  const raw = String(value).toLowerCase();
  const u = String(unit || '').toLowerCase().replace(/\s+/g, '').replace(/μ/g, 'µ');
  const scaledInValue = writtenScale(raw.replace(/,/g, '')) !== 1;
  switch (analyte) {
    case 'platelets': case 'wbc': {
      if (scaledInValue) return v;
      if (/lakh|lac/.test(u)) return v * 100000;
      if (/10\^?9\/l|10⁹|x10\^?3|10\^3|10³|thou|\bk\/|\/nl|10\*3/.test(u)) return v * 1000; // 10⁹/L = 10³/µL
      return v; // cells/µL = /cumm = /mm³
    }
    case 'hemoglobin': return /g\/l$/.test(u) ? v / 10 : v; // g/L → g/dL
    case 'glucose_fasting': case 'glucose_random': return /mmol/.test(u) ? v * 18 : v; // mmol/L → mg/dL
    case 'hba1c': return /mmol\/mol/.test(u) ? Math.round((0.09148 * v + 2.152) * 10) / 10 : v; // IFCC → NGSP %
    case 'potassium': case 'sodium': case 'inr': return v; // mmol/L = mEq/L
    default: return null;
  }
}

export const ANALYTES = ['platelets', 'hemoglobin', 'wbc', 'glucose_fasting', 'glucose_random', 'hba1c', 'potassium', 'sodium', 'inr',
  'creatinine', 'urea', 'tsh', 'cholesterol_total', 'ldl', 'hdl', 'triglycerides', 'alt', 'ast', 'bilirubin', 'vitamin_d', 'vitamin_b12', 'crp', 'esr', 'other'];

// Plausible bounds in standard units: outside them the unit was probably misread.
const PLAUSIBLE = {
  platelets: [1000, 2000000], wbc: [100, 300000], hemoglobin: [2, 25], glucose_fasting: [15, 1500], glucose_random: [15, 1500],
  hba1c: [3, 20], potassium: [1, 10], sodium: [90, 200], inr: [0.5, 15],
};

// Most severe first. Thresholds follow common laboratory critical-value lists; HbA1c ≥ 6.5% is the ADA diabetes cut-off.
const CRITICAL = [
  { analyte: 'platelets', below: 20000, level: 'urgent', en: 'Very low platelets: bleeding risk. See a doctor today.', hi: 'प्लेटलेट्स बहुत कम हैं — रक्तस्राव का ख़तरा। आज ही डॉक्टर को दिखाएँ।' },
  { analyte: 'platelets', below: 100000, level: 'soon', en: 'Low platelets, as often seen in dengue. See a doctor within a day and repeat the test as advised.', hi: 'प्लेटलेट्स कम हैं (डेंगू में आम)। एक दिन में डॉक्टर को दिखाएँ और सलाह अनुसार जाँच दोहराएँ।' },
  { analyte: 'hemoglobin', below: 7, level: 'urgent', en: 'Haemoglobin is in the severe anaemia range. See a doctor today.', hi: 'हीमोग्लोबिन बहुत कम है (गंभीर एनीमिया)। आज ही डॉक्टर को दिखाएँ।' },
  { analyte: 'glucose_fasting', below: 54, level: 'urgent', en: 'Very low blood sugar. Eat or drink something sugary now and see a doctor today.', hi: 'शुगर बहुत कम है — अभी कुछ मीठा लें और आज ही डॉक्टर को दिखाएँ।' },
  { analyte: 'glucose_random', below: 54, level: 'urgent', en: 'Very low blood sugar. Eat or drink something sugary now and see a doctor today.', hi: 'शुगर बहुत कम है — अभी कुछ मीठा लें और आज ही डॉक्टर को दिखाएँ।' },
  { analyte: 'glucose_fasting', above: 400, level: 'urgent', en: 'Very high blood sugar. See a doctor today.', hi: 'शुगर बहुत ज़्यादा है। आज ही डॉक्टर को दिखाएँ।' },
  { analyte: 'glucose_random', above: 400, level: 'urgent', en: 'Very high blood sugar. See a doctor today.', hi: 'शुगर बहुत ज़्यादा है। आज ही डॉक्टर को दिखाएँ।' },
  { analyte: 'potassium', below: 3.0, level: 'urgent', en: 'Potassium is dangerously low. See a doctor today.', hi: 'पोटैशियम ख़तरनाक रूप से कम है। आज ही डॉक्टर को दिखाएँ।' },
  { analyte: 'potassium', above: 6.0, level: 'urgent', en: 'Potassium is dangerously high. See a doctor today.', hi: 'पोटैशियम ख़तरनाक रूप से ज़्यादा है। आज ही डॉक्टर को दिखाएँ।' },
  { analyte: 'sodium', below: 125, level: 'urgent', en: 'Sodium is dangerously low. See a doctor today.', hi: 'सोडियम ख़तरनाक रूप से कम है। आज ही डॉक्टर को दिखाएँ।' },
  { analyte: 'sodium', above: 155, level: 'urgent', en: 'Sodium is dangerously high. See a doctor today.', hi: 'सोडियम ख़तरनाक रूप से ज़्यादा है। आज ही डॉक्टर को दिखाएँ।' },
  { analyte: 'wbc', below: 2000, level: 'urgent', en: 'Very low white blood cells: high infection risk. See a doctor today.', hi: 'सफ़ेद रक्त कोशिकाएँ बहुत कम हैं — संक्रमण का ख़तरा। आज ही डॉक्टर को दिखाएँ।' },
  { analyte: 'wbc', above: 30000, level: 'urgent', en: 'Very high white blood cells. See a doctor today.', hi: 'सफ़ेद रक्त कोशिकाएँ बहुत ज़्यादा हैं। आज ही डॉक्टर को दिखाएँ।' },
  { analyte: 'inr', above: 4.5, level: 'urgent', en: 'INR is high: bleeding risk on blood thinners. Contact your doctor today.', hi: 'INR ज़्यादा है — ख़ून पतला करने की दवा पर रक्तस्राव का ख़तरा। आज ही डॉक्टर से संपर्क करें।' },
  { analyte: 'hba1c', above: 6.49, level: 'soon', en: 'HbA1c is in the diabetes range (6.5% or more). See a doctor to confirm it and plan treatment.', hi: 'HbA1c डायबिटीज़ की सीमा में है (6.5% या अधिक)। पुष्टि और इलाज के लिए डॉक्टर को दिखाएँ।' },
];

/** Critical-value check on a standard-unit number; null when nothing applies. */
export function checkCritical(analyte, valueStd, language = 'en') {
  const bounds = PLAUSIBLE[analyte];
  if (!bounds || valueStd == null || !Number.isFinite(+valueStd)) return null;
  const v = +valueStd;
  if (v < bounds[0] || v > bounds[1]) {
    return { level: 'check', text: language === 'hi' ? 'यह मान असामान्य इकाई में लगता है — डॉक्टर से पुष्टि करें।' : 'This value looks like it is in unusual units. Please confirm it with your doctor.' };
  }
  for (const c of CRITICAL) {
    if (c.analyte !== analyte) continue;
    if ((c.below != null && v < c.below) || (c.above != null && v > c.above)) return { level: c.level, text: language === 'hi' ? c.hi : c.en };
  }
  return null;
}

const LEVEL_RANK = { none: 0, check: 0, soon: 1, urgent: 2 };

/** Enrich model-read lab rows with deterministic flags; returns { rows, level }. */
export function interpretLabs(rows = [], language = 'en') {
  let level = 'none';
  const out = rows.map((r) => {
    const flag = flagFromRange(r.value, r.reference_range);
    const mine = standardise(r.analyte, r.value, r.unit);
    const model = Number.isFinite(r.value_standard) && r.value_standard > 0 ? r.value_standard : null;
    const std = mine ?? model;
    const critical = checkCritical(r.analyte, std, language);
    if (critical && LEVEL_RANK[critical.level] > LEVEL_RANK[level]) level = critical.level;
    return { ...r, value_standard: std, flag, critical };
  });
  return { rows: out, level };
}
