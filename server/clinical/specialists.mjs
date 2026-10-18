/**
 * Specialist finder: which kind of doctor to see, and how soon.
 * Priority: a fired safety rule (authoritative) → the AI's choice → the most
 * likely condition → a general physician. Emergencies always go to the
 * emergency department first; children are routed to a paediatrician and
 * pregnancy adds an obstetrician.
 */

export const SPECIALTIES = {
  general_physician: { en: 'General physician', hi: 'सामान्य चिकित्सक (फ़िज़िशियन)', search: 'general physician' },
  cardiologist: { en: 'Cardiologist (heart)', hi: 'हृदय रोग विशेषज्ञ', search: 'cardiologist' },
  neurologist: { en: 'Neurologist (brain and nerves)', hi: 'न्यूरोलॉजिस्ट (तंत्रिका रोग)', search: 'neurologist' },
  pulmonologist: { en: 'Pulmonologist (chest and lungs)', hi: 'फेफड़ा रोग विशेषज्ञ', search: 'pulmonologist chest physician' },
  gastroenterologist: { en: 'Gastroenterologist (stomach and liver)', hi: 'पेट और लिवर रोग विशेषज्ञ', search: 'gastroenterologist' },
  dermatologist: { en: 'Dermatologist (skin)', hi: 'त्वचा रोग विशेषज्ञ', search: 'dermatologist' },
  ent: { en: 'ENT specialist (ear, nose, throat)', hi: 'नाक-कान-गला विशेषज्ञ', search: 'ENT specialist' },
  ophthalmologist: { en: 'Ophthalmologist (eyes)', hi: 'नेत्र रोग विशेषज्ञ', search: 'eye specialist' },
  dentist: { en: 'Dentist', hi: 'दंत चिकित्सक', search: 'dentist' },
  urologist: { en: 'Urologist (urinary tract)', hi: 'मूत्र रोग विशेषज्ञ', search: 'urologist' },
  gynecologist: { en: 'Gynaecologist / obstetrician', hi: 'स्त्री रोग विशेषज्ञ', search: 'gynecologist' },
  pediatrician: { en: 'Paediatrician (children)', hi: 'बाल रोग विशेषज्ञ', search: 'pediatrician' },
  psychiatrist: { en: 'Psychiatrist or psychologist', hi: 'मनोचिकित्सक / मनोवैज्ञानिक', search: 'psychiatrist' },
  endocrinologist: { en: 'Diabetologist / endocrinologist', hi: 'मधुमेह / हार्मोन विशेषज्ञ', search: 'diabetologist' },
  orthopedic: { en: 'Orthopaedic doctor (bones and joints)', hi: 'हड्डी रोग विशेषज्ञ', search: 'orthopedic doctor' },
};
export const SPECIALTY_IDS = Object.keys(SPECIALTIES);

// A fired guardrail decides the specialty (safety-critical routing is never left to the model).
const RULE_SPECIALTY = {
  'CARD-ACS': 'cardiologist', 'CARD-CHEST': 'cardiologist', 'CARD-HTN-CRISIS': 'cardiologist', 'CARD-HTN-URGENCY': 'cardiologist', 'VITAL-HR': 'cardiologist',
  'NEURO-STROKE': 'neurologist', 'NEURO-THUNDERCLAP': 'neurologist', 'NEURO-SEIZURE': 'neurologist', 'INF-MENINGITIS': 'neurologist',
  'RESP-SEVERE': 'pulmonologist', 'RESP-HYPOXIA': 'pulmonologist', 'RESP-ASTHMA': 'pulmonologist', 'RESP-HEMOPTYSIS': 'pulmonologist', 'INF-TB-SCREEN': 'pulmonologist',
  'OBS-DANGER': 'gynecologist', 'PEDS-INFANT-FEVER': 'pediatrician', 'MH-SELFHARM': 'psychiatrist', 'MH-LOWMOOD': 'psychiatrist',
  'META-HYPO': 'endocrinologist', 'META-DKA': 'endocrinologist', 'GU-PYELO': 'urologist', 'GI-BLEED': 'gastroenterologist',
};

// Offline knowledge-base condition → specialty.
const CONDITION_SPECIALTY = {
  viral_uri: 'general_physician', influenza: 'general_physician', covid: 'general_physician', dengue: 'general_physician',
  malaria: 'general_physician', typhoid: 'general_physician', chikungunya: 'general_physician', pneumonia: 'pulmonologist',
  pharyngitis: 'ent', gastroenteritis: 'general_physician', acs: 'cardiologist', chest_wall: 'general_physician',
  gastritis: 'gastroenterologist', migraine: 'neurologist', tension_headache: 'general_physician', uti: 'general_physician',
  anxiety: 'psychiatrist', asthma_flare: 'pulmonologist', allergic_rhinitis: 'ent', heat_illness: 'general_physician',
  back_strain: 'orthopedic', conjunctivitis: 'ophthalmologist', tb: 'pulmonologist', depression: 'psychiatrist',
  otitis: 'ent', dental: 'dentist', skin_allergy: 'dermatologist', vertigo: 'ent',
};

// Free-text condition names (e.g. from the AI) → specialty. Common infections go to a GP first.
const KEYWORDS = [
  [/gastroenteritis|food poisoning|urinary tract infection|\buti\b|viral|fever|\bflu\b|influenza|common cold|covid|dengue|malaria|typhoid|chikungunya/i, 'general_physician'],
  [/heart(?!burn)|cardi|coronary|angina|arrhythm|palpitat|hypertens/i, 'cardiologist'],
  [/stroke|seizure|epilep|migraine|neuro|meningitis|palsy/i, 'neurologist'],
  [/asthma|copd|pneumonia|bronch|tubercul|\btb\b|lung|pleur/i, 'pulmonologist'],
  [/gastr|acid|reflux|ulcer|\bibs\b|liver|hepat|jaundice|pancrea|gall/i, 'gastroenterologist'],
  [/skin|derma|eczema|psoria|fung|ringworm|urticaria|hives|acne|scabies/i, 'dermatologist'],
  [/\bear\b|sinus|tonsil|throat|pharyn|rhinitis|otitis|vertigo/i, 'ent'],
  [/\beye|conjunctiv|vision/i, 'ophthalmologist'],
  [/tooth|dental|gum|caries/i, 'dentist'],
  [/urinary|\buti\b|kidney stone|prostat|bladder/i, 'urologist'],
  [/pregnan|menstru|period|pcos|vagin|ovar|uter|gynae|gyne/i, 'gynecologist'],
  [/anxiety|depress|panic|mental|insomnia|bipolar/i, 'psychiatrist'],
  [/diabet|thyroid|hormon/i, 'endocrinologist'],
  [/back pain|joint|arthritis|fracture|sprain|muscle strain|bone|osteo/i, 'orthopedic'],
];

const WHEN = {
  emergency: ['Now — emergency department (call 112 / 108)', 'अभी — इमरजेंसी विभाग (112 / 108)'],
  urgent: ['Today, within a few hours', 'आज ही, कुछ घंटों में'],
  soon: ['Within 1–2 days', '1–2 दिनों में'],
  self_care: ['Only if not better in 3–5 days', 'अगर 3–5 दिनों में ठीक न हो'],
};

const specialtyFromText = (name) => {
  for (const [re, id] of KEYWORDS) if (re.test(name || '')) return id;
  return null;
};

/**
 * @param severity final triage level
 * @param ai { specialist, specialist_reason } from the model (may be absent)
 * @param guard guardrail result
 * @param conditions possible-condition names shown to the user
 * @param localTop id of the offline engine's top condition, if any
 */
export function recommendSpecialist({ severity = 'self_care', ai = null, guard = { fired: [] }, conditions = [], localTop = null, profile = {}, language = 'en' }) {
  const hi = language === 'hi';
  const rule = (guard.fired || []).find((f) => RULE_SPECIALTY[f.id]);
  const aiPick = ai && SPECIALTIES[ai.specialist] ? ai.specialist : null;
  const condPick = (localTop && CONDITION_SPECIALTY[localTop]) || conditions.map(specialtyFromText).find(Boolean) || null;

  let id = rule ? RULE_SPECIALTY[rule.id] : aiPick || condPick || 'general_physician';
  const source = rule ? 'rule' : aiPick ? 'ai' : condPick ? 'condition' : 'default';
  let why = rule
    ? `${hi && rule.title_hi ? rule.title_hi : rule.title} (${rule.id})`
    : aiPick && ai.specialist_reason ? ai.specialist_reason
      : conditions[0] ? (hi ? `संभावित कारण: ${conditions[0]}` : `Most likely: ${conditions[0]}`)
        : hi ? 'पहली जाँच के लिए' : 'A good first stop for these symptoms';

  const alternatives = [];
  const age = Number.isFinite(+profile.age) && profile.age !== null ? +profile.age : null;
  if (age != null && age < 14 && !['pediatrician', 'dentist', 'ophthalmologist'].includes(id)) {
    alternatives.push(id);
    id = 'pediatrician';
    why = hi ? 'बच्चों के लिए पहले बाल रोग विशेषज्ञ' : `Children should see a paediatrician first — ${why}`;
  }
  if (profile.pregnant && id !== 'gynecologist') alternatives.push('gynecologist');
  if (id !== 'general_physician' && severity !== 'emergency') alternatives.push('general_physician');

  const s = SPECIALTIES[id];
  const search = severity === 'emergency' ? 'emergency hospital' : s.search;
  return {
    id,
    name: hi ? s.hi : s.en,
    name_en: s.en,
    source,
    why,
    when: WHEN[severity] ? WHEN[severity][hi ? 1 : 0] : WHEN.soon[hi ? 1 : 0],
    emergency: severity === 'emergency',
    teleconsult_ok: severity === 'soon' || severity === 'self_care',
    alternatives: [...new Set(alternatives)].filter((a) => a !== id).slice(0, 2).map((a) => ({ id: a, name: hi ? SPECIALTIES[a].hi : SPECIALTIES[a].en })),
    maps_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${search} near me`)}`,
    teleconsult_url: 'https://esanjeevani.mohfw.gov.in',
  };
}
