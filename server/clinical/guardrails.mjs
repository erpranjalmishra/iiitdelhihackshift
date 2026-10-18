/**
 * Guardrail engine — deterministic red-flag rules that run independently of
 * any AI model. The final severity is max(AI, guardrail): the rules can only
 * ESCALATE a verdict, never soften it. Every rule cites its clinical source so
 * a clinician can audit exactly why the app said what it said.
 */

export const LEVELS = ['none', 'self_care', 'soon', 'urgent', 'emergency'];
export const levelRank = (l) => Math.max(0, LEVELS.indexOf(l));
export const maxLevel = (a, b) => (levelRank(a) >= levelRank(b) ? a : b);
export const GUARD_VERSION = 'nadi-guard 1.2';

const CONDITION_KEYWORDS = {
  diabetes: /diabet|sugar|madhumeh|मधुमेह|insulin/,
  hypertension: /hypertens|high bp|high blood pressure|\bbp\b|blood pressure/,
  heart_disease: /heart|cardiac|angina|stent|bypass|cabg|heart attack|mi\b|arrhythm|heart failure/,
  asthma: /asthma|dama|दमा/,
  copd: /copd|emphysema|chronic bronchitis/,
  kidney_disease: /kidney|renal|ckd|dialysis/,
  immunocompromised: /hiv|cancer|chemo|transplant|immuno|steroid/,
  liver_disease: /liver|cirrhosis|hepatitis/,
};

export function canonicalConditions(list = []) {
  const out = new Set();
  for (const raw of list) {
    const s = String(raw).toLowerCase();
    for (const [id, re] of Object.entries(CONDITION_KEYWORDS)) if (re.test(s)) out.add(id);
  }
  return out;
}

/** Build the evaluation context from parsed intake, profile, vitals and baseline deviations. */
export function buildContext({ symptoms = [], duration_days = null, severity = null, profile = {}, vitals = {}, deviations = {}, voice = null }) {
  const s = new Set(symptoms);
  const conditions = canonicalConditions(profile.conditions || []);
  if (profile.pregnant) conditions.add('pregnancy');
  // Camera estimates only count when the scan was trustworthy; manual readings always count.
  const camOk = vitals.confidence && vitals.confidence !== 'low';
  const v = {
    hr: vitals.hr_source === 'manual' || camOk ? vitals.hr ?? null : null,
    rr: vitals.rr_source === 'manual' || camOk ? vitals.rr ?? null : null,
    temp_c: vitals.temp_c ?? null, spo2: vitals.spo2 ?? null,
    bp_sys: vitals.bp_sys ?? null, bp_dia: vitals.bp_dia ?? null, glucose: vitals.glucose ?? null,
  };
  const feverish = s.has('fever') || (v.temp_c != null && v.temp_c >= 38);
  return {
    s, v, dev: deviations || {}, voice, conditions,
    age: profile.age ?? null, sex: profile.sex ?? null, pregnant: !!profile.pregnant,
    duration: duration_days, severity, feverish,
    has: (...ids) => ids.some((id) => s.has(id)),
    all: (...ids) => ids.every((id) => s.has(id)),
    cond: (...ids) => ids.some((id) => conditions.has(id)),
    n: (x) => x != null && Number.isFinite(x),
  };
}

// Each rule: id, level, title (+hi), when(ctx) → truthy | string (extra detail), action (+hi), source.
export const RULES = [
  /* ---------------- Emergency ---------------- */
  {
    id: 'CARD-ACS', level: 'emergency', title: 'Possible heart attack', title_hi: 'संभावित दिल का दौरा',
    when: (c) => c.has('chest_pain') && (c.has('radiating_pain', 'sweating', 'breathless', 'nausea', 'fainting', 'palpitations') || (c.n(c.age) && c.age >= 40 && c.cond('diabetes', 'hypertension', 'heart_disease'))),
    why: 'Chest pain together with pain spreading to the arm or jaw, sweating, breathlessness, nausea or known heart risk factors is a classic warning pattern for a heart attack.',
    action: 'Call 112 or 108 now. Stop all activity and sit down. Do not drive yourself. Unlock your door and keep your phone with you.',
    action_hi: 'तुरंत 112 या 108 पर कॉल करें। हर काम रोककर बैठ जाएँ। खुद गाड़ी न चलाएँ। दरवाज़ा खोल दें और फ़ोन पास रखें।',
    source: 'AHA/ACC 2021 Guideline for the Evaluation of Chest Pain',
  },
  {
    id: 'NEURO-STROKE', level: 'emergency', title: 'Possible stroke (BE-FAST signs)', title_hi: 'संभावित स्ट्रोक (BE-FAST लक्षण)',
    when: (c) => c.has('face_droop', 'arm_weakness', 'speech_difficulty', 'vision_loss', 'balance_loss'),
    why: 'Sudden face drooping, one-sided weakness, speech difficulty, vision loss or loss of balance are stroke warning signs. Every minute matters: treatment works best within 4.5 hours.',
    action: 'Call 112 or 108 immediately and note the time symptoms started. Do not give food, water or medicines.',
    action_hi: 'तुरंत 112 या 108 पर कॉल करें और लक्षण शुरू होने का समय नोट करें। खाना, पानी या दवा न दें।',
    source: 'BE-FAST stroke recognition (Aroor et al., Stroke 2017)',
  },
  {
    id: 'NEURO-THUNDERCLAP', level: 'emergency', title: 'Sudden severe headache', title_hi: 'अचानक बहुत तेज़ सिरदर्द',
    when: (c) => c.has('worst_headache'),
    why: 'A sudden, worst-ever ("thunderclap") headache can signal bleeding in the brain and needs emergency imaging.',
    action: 'Go to an emergency department now or call 112 / 108.',
    action_hi: 'अभी इमरजेंसी विभाग जाएँ या 112 / 108 पर कॉल करें।',
    source: 'NICE CG150 Headaches in over 12s (red flags)',
  },
  {
    id: 'INF-MENINGITIS', level: 'emergency', title: 'Possible meningitis', title_hi: 'संभावित मेनिनजाइटिस',
    when: (c) => c.feverish && c.has('headache') && c.has('stiff_neck', 'photophobia', 'confusion', 'rash'),
    why: 'Fever with headache plus a stiff neck, light sensitivity, confusion or a rash can mean meningitis, which can worsen within hours.',
    action: 'Go to an emergency department now or call 112 / 108.',
    action_hi: 'अभी इमरजेंसी विभाग जाएँ या 112 / 108 पर कॉल करें।',
    source: 'NICE NG240 Bacterial meningitis and meningococcal disease (2024)',
  },
  {
    id: 'RESP-SEVERE', level: 'emergency', title: 'Breathing emergency', title_hi: 'सांस की आपात स्थिति',
    when: (c) => c.has('blue_lips', 'cannot_speak') || (c.n(c.v.spo2) && c.v.spo2 < 90) || (c.has('breathless') && c.n(c.v.rr) && c.v.rr >= 30),
    why: (c) => (c.n(c.v.spo2) && c.v.spo2 < 90 ? `Oxygen saturation of ${c.v.spo2}% is dangerously low. ` : '') + 'Blue lips, being too breathless to speak, or very low oxygen are signs the body is not getting enough oxygen.',
    action: 'Call 112 or 108 now. Sit upright; loosen tight clothing.',
    action_hi: 'तुरंत 112 या 108 पर कॉल करें। सीधे बैठें; तंग कपड़े ढीले करें।',
    source: 'WHO IMAI; BTS Guideline for Oxygen Use in Adults (2017)',
  },
  {
    id: 'ALLERGY-ANAPHYLAXIS', level: 'emergency', title: 'Possible severe allergic reaction', title_hi: 'संभावित गंभीर एलर्जी (एनाफिलेक्सिस)',
    when: (c) => c.has('swelling_face') && c.has('breathless', 'wheeze', 'dizziness', 'fainting', 'vomiting', 'rash'),
    why: 'Swelling of the lips, face or throat together with breathing trouble, dizziness or a widespread rash suggests anaphylaxis.',
    action: 'Call 112 or 108 now. If you have an adrenaline auto-injector, use it. Lie down with legs raised unless breathing is easier sitting up.',
    action_hi: 'तुरंत 112 या 108 पर कॉल करें। एड्रेनालिन इंजेक्टर हो तो इस्तेमाल करें।',
    source: 'World Allergy Organization Anaphylaxis Guidance 2020',
  },
  {
    id: 'MH-SELFHARM', level: 'emergency', title: 'You deserve support right now', title_hi: 'आपको अभी सहारे की ज़रूरत है',
    when: (c) => c.has('suicidal'),
    why: 'You mentioned thoughts of ending your life or harming yourself. You are not alone, and talking to someone now can help.',
    action: 'Call Tele-MANAS 14416 (free, 24×7, many Indian languages) or 112 if you are in immediate danger. Stay with someone you trust and move away from anything you could use to hurt yourself.',
    action_hi: 'टेली-मानस 14416 पर कॉल करें (मुफ़्त, 24×7, कई भाषाओं में) या तुरंत ख़तरे में हों तो 112 पर। किसी भरोसेमंद व्यक्ति के साथ रहें।',
    source: 'WHO mhGAP Intervention Guide 2.0; Tele-MANAS (MoHFW)',
  },
  {
    id: 'INF-SEPSIS', level: 'emergency', title: 'Possible sepsis', title_hi: 'संभावित सेप्सिस',
    when: (c) => (c.feverish || (c.n(c.v.temp_c) && c.v.temp_c <= 36)) && (c.has('confusion', 'lethargy', 'blue_lips') || (c.n(c.v.hr) && c.v.hr >= 130) || (c.n(c.v.rr) && c.v.rr >= 25) || (c.n(c.v.spo2) && c.v.spo2 < 92) || (c.n(c.v.bp_sys) && c.v.bp_sys <= 90)),
    why: (c) => 'Infection signs together with ' + [c.has('confusion', 'lethargy') && 'confusion or drowsiness', c.n(c.v.hr) && c.v.hr >= 130 && `a heart rate of ${Math.round(c.v.hr)}`, c.n(c.v.rr) && c.v.rr >= 25 && `a breathing rate of ${Math.round(c.v.rr)}/min`, c.n(c.v.spo2) && c.v.spo2 < 92 && `oxygen of ${c.v.spo2}%`, c.n(c.v.bp_sys) && c.v.bp_sys <= 90 && `low blood pressure (${c.v.bp_sys})`].filter(Boolean).join(', ') + ' meet high-risk sepsis criteria.',
    action: 'Go to an emergency department now or call 112 / 108. Say "I am worried about sepsis".',
    action_hi: 'अभी इमरजेंसी विभाग जाएँ या 112 / 108 पर कॉल करें।',
    source: 'NICE NG51 Sepsis: high-risk criteria (2024 update)',
  },
  {
    id: 'NEURO-SEIZURE', level: 'emergency', title: 'Seizure', title_hi: 'दौरा (सीज़र)',
    when: (c) => c.has('seizure'),
    why: 'A seizure — especially a first one, one lasting over 5 minutes, or repeated seizures — needs urgent medical assessment.',
    action: 'Call 112 or 108. Do not put anything in the mouth. Turn the person on their side and time the seizure.',
    action_hi: '112 या 108 पर कॉल करें। मुँह में कुछ न डालें। व्यक्ति को करवट पर लिटाएँ।',
    source: 'WHO Epilepsy fact sheet; ILAE first-aid guidance',
  },
  {
    id: 'ENV-HEATSTROKE', level: 'emergency', title: 'Possible heatstroke', title_hi: 'संभावित लू (हीटस्ट्रोक)',
    when: (c) => c.has('heat_exposure') && (c.has('confusion', 'fainting', 'seizure', 'lethargy') || (c.n(c.v.temp_c) && c.v.temp_c >= 40)),
    why: 'Heat exposure with confusion, fainting or a very high body temperature is heatstroke, which can damage organs quickly.',
    action: 'Call 108 / 112. Move to shade, remove extra clothing, cool the body with water and fanning. Do not give fluids if not fully alert.',
    action_hi: '108 / 112 पर कॉल करें। छाँव में ले जाएँ, अतिरिक्त कपड़े हटाएँ, पानी और हवा से शरीर ठंडा करें।',
    source: 'NDMA Guidelines on Heat Wave (India); WHO Heat & Health',
  },
  {
    id: 'ENV-SNAKEBITE', level: 'emergency', title: 'Snake bite', title_hi: 'साँप का काटना',
    when: (c) => c.has('snake_bite'),
    why: 'Any snake bite must be treated as venomous until proven otherwise. Anti-snake venom is available free at government hospitals.',
    action: 'Call 108 and go to the nearest government hospital now. Keep the bitten limb still and below heart level. Do NOT cut, suck, or tie a tight tourniquet.',
    action_hi: '108 पर कॉल करें और तुरंत नज़दीकी सरकारी अस्पताल जाएँ। काटे हुए हिस्से को स्थिर रखें। काटें, चूसें या कसकर न बाँधें।',
    source: 'MoHFW Standard Treatment Guidelines: Management of Snakebite (2017)',
  },
  {
    id: 'GI-BLEED', level: 'emergency', title: 'Possible internal bleeding', title_hi: 'संभावित आंतरिक रक्तस्राव',
    when: (c) => c.has('vomit_blood') || (c.has('black_stool', 'blood_stool') && c.has('dizziness', 'fainting', 'palpitations')),
    why: 'Vomiting blood, or black/bloody stools with dizziness or fainting, can mean bleeding in the gut.',
    action: 'Go to an emergency department now or call 112 / 108.',
    action_hi: 'अभी इमरजेंसी विभाग जाएँ या 112 / 108 पर कॉल करें।',
    source: 'NICE CG141 Acute upper GI bleeding',
  },
  {
    id: 'OBS-DANGER', level: 'emergency', title: 'Pregnancy danger sign', title_hi: 'गर्भावस्था का ख़तरे का संकेत',
    // In pregnancy any bleeding the person mentions is treated as a danger sign until a clinician says otherwise.
    when: (c) => c.pregnant && (c.has('vaginal_bleeding', 'bleeding_unspecified', 'seizure', 'reduced_fetal_movement', 'fainting') || (c.has('headache') && c.has('vision_loss')) || (c.has('abdominal_pain') && (c.severity ?? 0) >= 7) || (c.n(c.v.bp_sys) && c.v.bp_sys >= 160)),
    why: 'Bleeding, fits, severe headache with vision problems, severe abdominal pain, very high BP or the baby moving less are danger signs in pregnancy.',
    action: 'Go to the hospital where you are registered, or call 108 / 102 now.',
    action_hi: 'तुरंत उस अस्पताल जाएँ जहाँ आप पंजीकृत हैं, या 108 / 102 पर कॉल करें।',
    source: 'WHO / MoHFW danger signs in pregnancy (MCP card)',
  },
  {
    id: 'CARD-HTN-CRISIS', level: 'emergency', title: 'Hypertensive emergency', title_hi: 'उच्च रक्तचाप की आपात स्थिति',
    when: (c) => c.n(c.v.bp_sys) && (c.v.bp_sys >= 180 || (c.v.bp_dia ?? 0) >= 120) && c.has('chest_pain', 'breathless', 'confusion', 'vision_loss', 'speech_difficulty', 'arm_weakness', 'worst_headache'),
    why: (c) => `Blood pressure of ${c.v.bp_sys}/${c.v.bp_dia ?? '?'} with these symptoms may mean organ damage is occurring.`,
    action: 'Call 112 or 108 now.',
    action_hi: 'तुरंत 112 या 108 पर कॉल करें।',
    source: 'ACC/AHA 2017 High Blood Pressure Guideline',
  },
  {
    id: 'META-HYPO', level: 'emergency', title: 'Severe low blood sugar', title_hi: 'गंभीर रूप से कम ब्लड शुगर',
    when: (c) => (c.n(c.v.glucose) && c.v.glucose < 54) || (c.cond('diabetes') && c.has('confusion', 'fainting', 'seizure') && !(c.n(c.v.glucose) && c.v.glucose >= 100)),
    why: 'Very low blood sugar can cause confusion, fits and loss of consciousness.',
    action: 'If awake and able to swallow: take 15–20 g fast sugar (glucose, 3 tsp sugar in water, or juice) now and recheck in 15 minutes. If drowsy or confused, call 108.',
    action_hi: 'अगर होश में हैं और निगल सकते हैं: अभी 15–20 ग्राम चीनी/ग्लूकोज़ लें, 15 मिनट बाद फिर जाँचें। बेहोशी या उलझन हो तो 108 पर कॉल करें।',
    source: 'ADA Standards of Care in Diabetes 2025 — Hypoglycemia',
  },
  {
    id: 'PEDS-INFANT-FEVER', level: 'emergency', title: 'Fever in a young infant', title_hi: 'छोटे शिशु में बुखार',
    when: (c) => c.n(c.age) && c.age < 1 && c.feverish,
    why: 'In babies under 3 months a temperature of 38 °C or more is a high-risk sign; young infants can become seriously ill quickly.',
    action: 'Take the baby to a doctor or emergency department now.',
    action_hi: 'शिशु को तुरंत डॉक्टर या इमरजेंसी विभाग ले जाएँ।',
    source: 'NICE NG143 Fever in under 5s (traffic-light system)',
  },

  /* ---------------- Urgent (same day) ---------------- */
  {
    id: 'CARD-CHEST', level: 'urgent', title: 'Chest pain needs same-day assessment', title_hi: 'सीने में दर्द की आज ही जाँच ज़रूरी',
    when: (c) => c.has('chest_pain'),
    why: 'Chest pain has many causes, most not dangerous, but heart causes must be ruled out with an ECG.',
    action: 'See a doctor today and ask for an ECG. If pain becomes severe, spreads, or comes with sweating or breathlessness, call 112 / 108.',
    action_hi: 'आज ही डॉक्टर को दिखाएँ और ECG करवाएँ। दर्द बढ़े या पसीना/सांस फूले तो 112 / 108 पर कॉल करें।',
    source: 'AHA/ACC 2021 Chest Pain Guideline',
  },
  {
    id: 'INF-DENGUE-WARNING', level: 'urgent', title: 'Dengue warning signs', title_hi: 'डेंगू के चेतावनी संकेत',
    when: (c) => c.feverish && c.has('bleeding_gums', 'nosebleed', 'bleeding_unspecified', 'persistent_vomiting', 'lethargy', 'black_stool', 'blood_stool') || (c.feverish && c.has('abdominal_pain') && (c.severity ?? 0) >= 6),
    why: 'Fever with bleeding gums or nose, persistent vomiting, severe belly pain or unusual drowsiness are WHO dengue warning signs — platelets may be falling.',
    action: 'Go to a hospital today for a CBC (platelet count) and NS1/IgM test. Drink plenty of fluids. Avoid ibuprofen, aspirin and other painkillers except paracetamol.',
    action_hi: 'आज ही अस्पताल जाकर CBC (प्लेटलेट) और NS1/IgM जाँच करवाएँ। खूब तरल लें। पैरासिटामोल के अलावा कोई दर्द-निवारक (आइबुप्रोफेन, एस्पिरिन) न लें।',
    source: 'WHO Dengue Guidelines (2009); NCVBDC India',
  },
  {
    id: 'RESP-HYPOXIA', level: 'urgent', title: 'Low oxygen level', title_hi: 'ऑक्सीजन स्तर कम',
    when: (c) => c.n(c.v.spo2) && c.v.spo2 >= 90 && c.v.spo2 < 94,
    why: (c) => `An oxygen saturation of ${c.v.spo2}% is below the normal range (94–100%).`,
    action: 'Recheck after resting with warm hands. If still below 94%, see a doctor today; below 90% call 108.',
    action_hi: 'आराम के बाद गर्म हाथों से फिर जाँचें। 94% से कम रहे तो आज ही डॉक्टर को दिखाएँ; 90% से कम हो तो 108 पर कॉल करें।',
    source: 'BTS Oxygen Guideline 2017; MoHFW home-isolation SpO2 thresholds',
  },
  {
    id: 'VITAL-HR', level: 'urgent', title: 'Heart rate out of safe range', title_hi: 'हृदय गति सुरक्षित सीमा से बाहर',
    when: (c) => c.n(c.v.hr) && (c.v.hr >= 130 || (c.v.hr <= 45 && c.has('dizziness', 'fainting', 'breathless', 'chest_pain', 'fatigue'))),
    why: (c) => `A resting heart rate of ${Math.round(c.v.hr)} bpm is outside the safe range${c.v.hr <= 45 ? ' and you have symptoms' : ''}.`,
    action: 'Rest for 10 minutes and re-measure. If it stays this way, see a doctor today. Call 108 if you feel faint or have chest pain.',
    action_hi: '10 मिनट आराम करके फिर मापें। ऐसा ही रहे तो आज डॉक्टर को दिखाएँ।',
    source: 'NEWS2 (Royal College of Physicians, 2017) heart-rate bands',
  },
  {
    id: 'VITAL-RR', level: 'urgent', title: 'Fast breathing', title_hi: 'तेज़ सांस',
    when: (c) => c.n(c.v.rr) && (c.v.rr >= 25 || c.v.rr <= 8),
    why: (c) => `A breathing rate of ${Math.round(c.v.rr)}/min is outside the normal 12–20 range.`,
    action: 'Rest and re-check. If breathing stays fast or you feel short of breath, see a doctor today.',
    action_hi: 'आराम करें और फिर जाँचें। सांस तेज़ ही रहे तो आज डॉक्टर को दिखाएँ।',
    source: 'NEWS2 respiration-rate bands',
  },
  {
    id: 'TEMP-HIGH', level: 'urgent', title: 'Very high fever', title_hi: 'बहुत तेज़ बुखार',
    when: (c) => c.n(c.v.temp_c) && (c.v.temp_c >= 40 || (c.v.temp_c >= 39 && ((c.age ?? 30) >= 65 || (c.age ?? 30) < 5))),
    why: (c) => `A temperature of ${c.v.temp_c} °C is high${(c.age ?? 30) >= 65 || (c.age ?? 30) < 5 ? ' for this age group' : ''}.`,
    action: 'Take paracetamol at the label dose, sponge with lukewarm water, drink fluids, and see a doctor today.',
    action_hi: 'लेबल के अनुसार पैरासिटामोल लें, गुनगुने पानी से पोंछें, तरल लें, और आज डॉक्टर को दिखाएँ।',
    source: 'NICE NG143; WHO IMCI',
  },
  {
    id: 'GI-DEHYDRATION', level: 'urgent', title: 'Signs of dehydration', title_hi: 'पानी की कमी के संकेत',
    when: (c) => c.has('diarrhea', 'vomiting') && c.has('no_urination', 'dry_mouth', 'dizziness', 'lethargy', 'persistent_vomiting'),
    why: 'Losing fluids with little urine, a very dry mouth, dizziness or being unable to keep fluids down means dehydration is developing.',
    action: 'Sip ORS frequently (a few sips every minute). If you cannot keep ORS down or pass little urine for 8+ hours, go to a clinic today for IV fluids.',
    action_hi: 'ORS बार-बार थोड़ा-थोड़ा पिएँ। ORS न रुके या 8+ घंटे पेशाब न आए तो आज ही क्लिनिक जाएँ।',
    source: 'WHO / IMCI dehydration assessment; MoHFW Stop Diarrhoea Campaign',
  },
  {
    id: 'META-DKA', level: 'urgent', title: 'Possible diabetic emergency (DKA)', title_hi: 'संभावित डायबिटिक आपात स्थिति (DKA)',
    when: (c) => (c.cond('diabetes') && c.has('vomiting', 'abdominal_pain') && c.has('thirst', 'frequent_urination', 'fruity_breath', 'confusion', 'breathless')) || (c.n(c.v.glucose) && c.v.glucose >= 300),
    why: 'High sugar with vomiting, belly pain, thirst or fast breathing can mean ketoacidosis.',
    action: 'Check your sugar (and ketones if you can). See a doctor today; go to emergency if vomiting continues or you feel drowsy.',
    action_hi: 'शुगर जाँचें। आज ही डॉक्टर को दिखाएँ; उल्टी न रुके या सुस्ती हो तो इमरजेंसी जाएँ।',
    source: 'ADA Standards of Care 2025 — Hyperglycemic crises',
  },
  {
    id: 'CARD-HTN-URGENCY', level: 'urgent', title: 'Very high blood pressure', title_hi: 'बहुत उच्च रक्तचाप',
    when: (c) => c.n(c.v.bp_sys) && (c.v.bp_sys >= 180 || (c.v.bp_dia ?? 0) >= 120),
    why: (c) => `A blood pressure of ${c.v.bp_sys}/${c.v.bp_dia ?? '?'} is in the severe range.`,
    action: 'Rest 5 minutes and re-measure. If it stays this high, see a doctor today. Do not take extra BP tablets on your own.',
    action_hi: '5 मिनट आराम करके फिर मापें। इतना ही रहे तो आज डॉक्टर को दिखाएँ।',
    source: 'ACC/AHA 2017 High Blood Pressure Guideline',
  },
  {
    id: 'RESP-ASTHMA', level: 'urgent', title: 'Asthma / breathing flare', title_hi: 'दमा का दौरा',
    when: (c) => c.has('wheeze', 'breathless') && c.cond('asthma', 'copd'),
    why: 'Breathlessness or wheeze in someone with asthma or COPD can escalate quickly.',
    action: 'Use your reliever inhaler as prescribed. If there is no relief after it, or you cannot finish sentences, call 108.',
    action_hi: 'डॉक्टर द्वारा बताया गया इनहेलर लें। आराम न मिले तो 108 पर कॉल करें।',
    source: 'GINA 2024 — Management of asthma exacerbations',
  },
  {
    id: 'GI-SEVERE-ABDO', level: 'urgent', title: 'Severe abdominal pain', title_hi: 'तेज़ पेट दर्द',
    when: (c) => c.has('abdominal_pain') && (c.severity ?? 0) >= 7,
    why: 'Severe abdominal pain can signal appendicitis, gallbladder, or other surgical problems.',
    action: 'See a doctor today. Avoid painkillers until examined (they can mask signs). Go to emergency if pain is getting worse, or with fever and vomiting.',
    action_hi: 'आज ही डॉक्टर को दिखाएँ। जाँच से पहले दर्द-निवारक न लें।',
    source: 'NICE CKS Appendicitis / acute abdomen',
  },
  {
    id: 'RESP-HEMOPTYSIS', level: 'urgent', title: 'Coughing up blood', title_hi: 'खांसी में खून',
    when: (c) => c.has('cough_blood'),
    why: 'Coughing up blood needs prompt assessment (causes include TB, infections and others).',
    action: 'See a doctor today. TB testing is free at government health facilities.',
    action_hi: 'आज ही डॉक्टर को दिखाएँ। सरकारी स्वास्थ्य केंद्रों पर TB जाँच मुफ़्त है।',
    source: 'NTEP Technical & Operational Guidelines 2021',
  },
  {
    id: 'GU-PYELO', level: 'urgent', title: 'Possible kidney infection', title_hi: 'संभावित किडनी संक्रमण',
    when: (c) => c.has('burning_urination', 'frequent_urination', 'blood_urine') && c.feverish && c.has('back_pain', 'vomiting', 'chills'),
    why: 'Urinary symptoms with fever, back/side pain or vomiting suggest the infection may have reached the kidneys.',
    action: 'See a doctor today; you may need prescription antibiotics.',
    action_hi: 'आज ही डॉक्टर को दिखाएँ; डॉक्टर की पर्ची वाली दवा की ज़रूरत हो सकती है।',
    source: 'NICE NG111 Pyelonephritis (acute)',
  },
  {
    id: 'BITE-RABIES', level: 'urgent', title: 'Animal bite — rabies risk', title_hi: 'जानवर का काटना — रेबीज़ का ख़तरा',
    when: (c) => c.has('animal_bite'),
    why: 'Dog, monkey and other animal bites carry a rabies risk in India; rabies is preventable but fatal once symptoms start.',
    action: 'Wash the wound with soap and running water for 15 minutes now, then go today for anti-rabies vaccination (free at government hospitals).',
    action_hi: 'घाव को साबुन और बहते पानी से 15 मिनट धोएँ, फिर आज ही एंटी-रेबीज़ टीका लगवाएँ (सरकारी अस्पताल में मुफ़्त)।',
    source: 'National Rabies Control Programme (NRCP) Guidelines',
  },

  /* ---------------- Soon (24–72 h) ---------------- */
  {
    id: 'INF-TB-SCREEN', level: 'soon', title: 'Get tested for TB', title_hi: 'TB की जाँच करवाएँ',
    when: (c) => c.has('cough') && ((c.duration ?? 0) >= 14 || c.has('weight_loss', 'night_sweats')),
    why: 'A cough lasting 2 weeks or more, or with weight loss or night sweats, is "presumptive TB" under India\'s TB programme.',
    action: 'Visit a government health centre within a few days for a free sputum test (NAAT). Cover coughs and ventilate rooms meanwhile.',
    action_hi: 'कुछ दिनों में सरकारी स्वास्थ्य केंद्र पर मुफ़्त बलगम जाँच (NAAT) करवाएँ।',
    source: 'NTEP Technical & Operational Guidelines 2021 (presumptive TB)',
  },
  {
    id: 'INF-FEVER-3D', level: 'soon', title: 'Fever for 3+ days', title_hi: '3+ दिन से बुखार',
    when: (c) => c.feverish && (c.duration ?? 0) >= 3,
    why: 'Fever lasting 3 days or more in India should be tested for dengue, malaria and typhoid rather than waited out.',
    action: 'See a doctor within a day for blood tests (CBC, malaria test, dengue NS1/IgM, ± Widal/culture as advised).',
    action_hi: 'एक दिन में डॉक्टर को दिखाकर खून की जाँच (CBC, मलेरिया, डेंगू) करवाएँ।',
    source: 'NCVBDC (National Center for Vector Borne Diseases Control) case management',
  },
  {
    id: 'GEN-PERSISTENT', level: 'soon', title: 'Symptoms lasting over a week', title_hi: 'एक हफ़्ते से ज़्यादा के लक्षण',
    when: (c) => (c.duration ?? 0) >= 7 && c.s.size > 0,
    why: 'Symptoms that have not improved after a week deserve a proper examination.',
    action: 'Book a doctor visit or a free eSanjeevani teleconsultation in the next few days.',
    action_hi: 'अगले कुछ दिनों में डॉक्टर या मुफ़्त ई-संजीवनी टेलीकंसल्टेशन लें।',
    source: 'General primary-care practice',
  },
  {
    id: 'GU-UTI', level: 'soon', title: 'Possible urinary infection', title_hi: 'संभावित मूत्र संक्रमण',
    when: (c) => c.has('burning_urination', 'blood_urine') || (c.has('frequent_urination') && c.pregnant),
    why: 'Burning or blood in the urine usually points to a urinary infection, which often needs a urine test and prescription treatment.',
    action: 'See a doctor within 1–2 days for a urine test. Drink plenty of water. Do not start leftover antibiotics.',
    action_hi: '1–2 दिन में डॉक्टर से मूत्र जाँच करवाएँ। खूब पानी पिएँ।',
    source: 'NICE NG109 Urinary tract infection (lower)',
  },
  {
    id: 'MH-LOWMOOD', level: 'soon', title: 'Ongoing low mood', title_hi: 'लगातार उदासी',
    when: (c) => c.has('low_mood') && ((c.duration ?? 0) >= 14 || c.has('insomnia', 'fatigue')),
    why: 'Low mood with sleep or energy problems that lasts weeks can be depression, which is common and treatable.',
    action: 'Talk to a doctor or call Tele-MANAS 14416 (free, confidential, 24×7).',
    action_hi: 'डॉक्टर से बात करें या टेली-मानस 14416 पर कॉल करें (मुफ़्त, गोपनीय, 24×7)।',
    source: 'WHO mhGAP Intervention Guide 2.0',
  },
  {
    id: 'RISK-OLDER-FEVER', level: 'soon', title: 'Fever at an older age', title_hi: 'अधिक उम्र में बुखार',
    when: (c) => c.feverish && c.n(c.age) && c.age >= 65,
    why: 'Infections can progress faster and show fewer signs in people over 65.',
    action: 'See a doctor within 24 hours, sooner if confused, breathless, or not drinking.',
    action_hi: '24 घंटे में डॉक्टर को दिखाएँ।',
    source: 'NICE NG51 Sepsis (age as a risk factor)',
  },
  {
    id: 'RISK-CHRONIC', level: 'soon', title: 'New symptoms with a chronic condition', title_hi: 'पुरानी बीमारी के साथ नए लक्षण',
    when: (c) => (c.feverish || c.has('breathless', 'vomiting', 'diarrhea')) && c.cond('diabetes', 'heart_disease', 'kidney_disease', 'copd', 'immunocompromised', 'liver_disease'),
    why: 'Fever, breathlessness or fluid loss can destabilise diabetes, heart, kidney, lung or immune conditions.',
    action: 'Contact your doctor within 24 hours; keep checking your sugar/BP as usual.',
    action_hi: '24 घंटे में अपने डॉक्टर से संपर्क करें।',
    source: 'General primary-care practice',
  },
  {
    id: 'TWIN-DEVIATION', level: 'soon', title: 'Unusual for YOU — vitals off your baseline', title_hi: 'आपके सामान्य से अलग — वाइटल्स बेसलाइन से हटे',
    when: (c) => c.s.size > 0 && ((c.dev.hr ?? 0) >= 2.5 || (c.dev.rr ?? 0) >= 2.5),
    why: (c) => [c.dev.hr >= 2.5 && `resting heart rate is ${c.dev.hr.toFixed(1)} SD above your own 30-day baseline`, c.dev.rr >= 2.5 && `breathing rate is ${c.dev.rr.toFixed(1)} SD above your baseline`].filter(Boolean).join('; ') + ' — together with your symptoms this is a meaningful change for you, even if the number looks "normal" for the average person.',
    action: 'Arrange a doctor visit within 1–2 days; re-scan tomorrow at the same time of day.',
    action_hi: '1–2 दिन में डॉक्टर को दिखाएँ; कल इसी समय दोबारा स्कैन करें।',
    source: 'Nadi Baseline Twin (personal z-score); cf. Mishra et al., Nature BME 2020 (wearable pre-symptomatic detection)',
  },
];

// When the rule on the left fires, the rules on the right add nothing new.
const SUBSUMES = {
  'CARD-ACS': ['CARD-CHEST'],
  'CARD-HTN-CRISIS': ['CARD-HTN-URGENCY'],
  'RESP-SEVERE': ['RESP-HYPOXIA', 'VITAL-RR'],
  'INF-SEPSIS': ['VITAL-HR', 'VITAL-RR'],
  'ENV-HEATSTROKE': ['TEMP-HIGH'],
  'META-HYPO': [],
};

// Advisory notes: shown for transparency, never change the severity.
const ADVISORIES = [
  {
    id: 'VOICE-MPT', when: (c) => c.voice && c.voice.mpt != null && c.voice.mpt < 8,
    text: (c) => `Your sustained "aaah" lasted ${c.voice.mpt}s (typical ≥ 10 s). Short phonation time can reflect breathlessness or reduced lung reserve.`,
  },
  {
    id: 'VOICE-STABILITY', when: (c) => c.voice && c.voice.flags && c.voice.flags.some((f) => f === 'jitter_high' || f === 'shimmer_high'),
    text: () => 'Your voice showed more cycle-to-cycle instability than typical (jitter/shimmer). Common with a sore throat, cold or fatigue; persistent hoarseness over 3 weeks should be checked.',
  },
  {
    id: 'TWIN-QUIET', when: (c) => c.s.size === 0 && ((c.dev.hr ?? 0) >= 2.5 || (c.dev.rr ?? 0) >= 2.5),
    text: () => 'Your vitals are unusual for you today although you reported no symptoms. Rest, hydrate and re-scan later.',
  },
];

export function evaluateGuardrails(input) {
  const c = buildContext(input);
  const fired = [];
  for (const r of RULES) {
    let hit = false;
    try { hit = r.when(c); } catch { hit = false; }
    if (!hit) continue;
    const why = typeof r.why === 'function' ? r.why(c) : r.why;
    fired.push({
      id: r.id, level: r.level, title: r.title, title_hi: r.title_hi || null,
      why: why.charAt(0).toUpperCase() + why.slice(1),
      action: r.action, action_hi: r.action_hi || null, source: r.source,
    });
  }
  // Most severe first; drop a lower rule when a higher one already covers it.
  fired.sort((a, b) => levelRank(b.level) - levelRank(a.level));
  const ids = new Set(fired.map((f) => f.id));
  const deduped = fired.filter((f) => !Object.entries(SUBSUMES).some(([higher, lower]) => ids.has(higher) && lower.includes(f.id)));
  const advisories = [];
  for (const a of ADVISORIES) {
    try { if (a.when(c)) advisories.push({ id: a.id, text: a.text(c) }); } catch { /* skip */ }
  }
  const level = deduped.reduce((acc, f) => maxLevel(acc, f.level), 'none');
  return { level, fired: deduped, advisories, checked: RULES.length, version: GUARD_VERSION };
}

/* ---------------- Output lint: checks applied to the AI's answer ---------------- */

const ANTIBIOTICS = /\b(antibiotic|amoxicillin|amoxyclav|augmentin|azithromycin|azithral|azee|ciprofloxacin|ciplox|levofloxacin|ofloxacin|cefixime|cefuroxime|cephalexin|doxycycline|metronidazole|norfloxacin|clarithromycin|linezolid)s?\b/i;
const CONTROLLED = /\b(tramadol|codeine|alprazolam|clonazepam|diazepam|lorazepam|zolpidem|morphine|oxycodone)\b/i;
const FALSE_REASSURANCE = /(no need (to|for) (see|visit|a) (a )?doctor|don'?t need (to see )?a doctor|nothing to worry|not serious at all|home remedies (are|will be) enough)/i;
const MG_DOSE = /\b\d{2,4}\s?mg\b/i;

export function lintAiOutput(result, { finalLevel, age }) {
  const notes = [];
  const lists = ['self_care', 'recommended_actions'];
  const scrub = (re, note) => {
    let removed = 0;
    for (const k of lists) {
      if (!Array.isArray(result[k])) continue;
      const before = result[k].length;
      result[k] = result[k].filter((line) => !re.test(line));
      removed += before - result[k].length;
    }
    if (removed) notes.push(note);
  };
  scrub(ANTIBIOTICS, { id: 'OUT-AMR', text: 'Removed an antibiotic suggestion: antibiotics need a doctor\'s prescription — self-medication fuels antimicrobial resistance (AMR), a major public-health threat in India (ICMR).' });
  scrub(CONTROLLED, { id: 'OUT-CONTROLLED', text: 'Removed a prescription-only / controlled medicine suggestion.' });
  if (levelRank(finalLevel) >= levelRank('soon')) {
    scrub(FALSE_REASSURANCE, { id: 'OUT-REASSURE', text: 'Removed reassurance that conflicted with the safety verdict.' });
    if (typeof result.summary === 'string' && FALSE_REASSURANCE.test(result.summary)) {
      result.summary = result.summary.replace(FALSE_REASSURANCE, 'please follow the care advice above');
      notes.push({ id: 'OUT-REASSURE-SUMMARY', text: 'Softened reassurance in the summary to match the safety verdict.' });
    }
  }
  if (age != null && age < 12 && [...(result.self_care || []), ...(result.recommended_actions || [])].some((l) => MG_DOSE.test(l))) {
    notes.push({ id: 'OUT-PEDS-DOSE', text: 'Children\'s medicine doses depend on body weight — confirm any dose with a doctor or pharmacist.' });
  }
  return { result, notes };
}
