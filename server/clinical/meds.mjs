/**
 * Medication safety: Indian brand → ingredient resolution, duplicate-ingredient
 * detection (e.g. Dolo 650 + Sinarest = double paracetamol), daily paracetamol
 * load, and clinically significant interaction classes.
 * Informational only — always confirm with a doctor or pharmacist.
 */

export const BRANDS = {
  'dolo': ['paracetamol'], 'dolo 650': ['paracetamol'], 'crocin': ['paracetamol'], 'calpol': ['paracetamol'], 'pacimol': ['paracetamol'],
  'p 650': ['paracetamol'], 'paracip': ['paracetamol'], 'metacin': ['paracetamol'],
  'combiflam': ['ibuprofen', 'paracetamol'], 'brufen': ['ibuprofen'], 'ibugesic': ['ibuprofen'],
  'sinarest': ['paracetamol', 'phenylephrine', 'chlorpheniramine'], 'd cold total': ['paracetamol', 'phenylephrine', 'chlorpheniramine'],
  'vicks action 500': ['paracetamol', 'phenylephrine', 'caffeine'], 'coldact': ['paracetamol', 'phenylephrine', 'chlorpheniramine'],
  'crocin cold': ['paracetamol', 'phenylephrine', 'caffeine'], 'saridon': ['paracetamol', 'propyphenazone', 'caffeine'],
  'cheston cold': ['paracetamol', 'phenylephrine', 'cetirizine'], 'nicip plus': ['nimesulide', 'paracetamol'],
  'disprin': ['aspirin'], 'ecosprin': ['aspirin'], 'ecosprin av': ['aspirin', 'atorvastatin'], 'loprin': ['aspirin'],
  'voveran': ['diclofenac'], 'voveran sr': ['diclofenac'], 'dynapar': ['diclofenac'], 'zerodol': ['aceclofenac'],
  'zerodol p': ['aceclofenac', 'paracetamol'], 'zerodol sp': ['aceclofenac', 'paracetamol', 'serratiopeptidase'],
  'hifenac p': ['aceclofenac', 'paracetamol'], 'meftal': ['mefenamic acid'], 'meftal spas': ['mefenamic acid', 'dicyclomine'],
  'nise': ['nimesulide'], 'nimulid': ['nimesulide'], 'etoshine': ['etoricoxib'], 'naprosyn': ['naproxen'], 'ketorol': ['ketorolac'],
  'ultracet': ['tramadol', 'paracetamol'], 'tramazac': ['tramadol'], 'contramal': ['tramadol'],
  'pan 40': ['pantoprazole'], 'pan d': ['pantoprazole', 'domperidone'], 'pantocid': ['pantoprazole'], 'pantop': ['pantoprazole'],
  'omez': ['omeprazole'], 'omez d': ['omeprazole', 'domperidone'], 'nexpro': ['esomeprazole'], 'razo': ['rabeprazole'], 'rablet': ['rabeprazole'],
  'rantac': ['ranitidine'], 'aciloc': ['ranitidine'], 'digene': ['antacid'], 'gelusil': ['antacid'], 'eno': ['antacid'], 'mucaine': ['antacid'],
  'glycomet': ['metformin'], 'glucophage': ['metformin'], 'gluconorm': ['metformin'], 'janumet': ['sitagliptin', 'metformin'],
  'galvus met': ['vildagliptin', 'metformin'], 'amaryl': ['glimepiride'], 'glimy': ['glimepiride'], 'gemer': ['glimepiride', 'metformin'],
  'jardiance': ['empagliflozin'], 'forxiga': ['dapagliflozin'],
  'telma': ['telmisartan'], 'telma h': ['telmisartan', 'hydrochlorothiazide'], 'telma am': ['telmisartan', 'amlodipine'],
  'amlong': ['amlodipine'], 'amlokind': ['amlodipine'], 'stamlo': ['amlodipine'], 'losar': ['losartan'], 'repace': ['losartan'],
  'olmezest': ['olmesartan'], 'envas': ['enalapril'], 'cardace': ['ramipril'], 'aldactone': ['spironolactone'],
  'lasix': ['furosemide'], 'dytor': ['torsemide'], 'concor': ['bisoprolol'], 'met xl': ['metoprolol'], 'metolar': ['metoprolol'],
  'atorva': ['atorvastatin'], 'lipvas': ['atorvastatin'], 'rosuvas': ['rosuvastatin'], 'clopilet': ['clopidogrel'], 'deplatt': ['clopidogrel'],
  'warf': ['warfarin'], 'acitrom': ['acenocoumarol'], 'eliquis': ['apixaban'], 'xarelto': ['rivaroxaban'],
  'sorbitrate': ['isosorbide dinitrate'], 'nitrocontin': ['nitroglycerin'], 'isordil': ['isosorbide dinitrate'],
  'thyronorm': ['levothyroxine'], 'eltroxin': ['levothyroxine'], 'thyrox': ['levothyroxine'],
  'azithral': ['azithromycin'], 'azee': ['azithromycin'], 'azithromycin': ['azithromycin'], 'augmentin': ['amoxicillin', 'clavulanate'],
  'moxikind cv': ['amoxicillin', 'clavulanate'], 'mox': ['amoxicillin'], 'novamox': ['amoxicillin'], 'ciplox': ['ciprofloxacin'],
  'cifran': ['ciprofloxacin'], 'levoflox': ['levofloxacin'], 'oflox': ['ofloxacin'], 'zanocin': ['ofloxacin'],
  'taxim o': ['cefixime'], 'zifi': ['cefixime'], 'metrogyl': ['metronidazole'], 'flagyl': ['metronidazole'], 'doxy 1': ['doxycycline'],
  'fluconazole': ['fluconazole'], 'forcan': ['fluconazole'],
  'allegra': ['fexofenadine'], 'cetzine': ['cetirizine'], 'okacet': ['cetirizine'], 'levocet': ['levocetirizine'], 'avil': ['pheniramine'],
  'montair lc': ['montelukast', 'levocetirizine'], 'montek lc': ['montelukast', 'levocetirizine'], 'asthalin': ['salbutamol'],
  'deriphyllin': ['theophylline', 'etofylline'], 'foracort': ['formoterol', 'budesonide'], 'budecort': ['budesonide'],
  'ondem': ['ondansetron'], 'emeset': ['ondansetron'], 'domstal': ['domperidone'], 'vomikind': ['ondansetron'],
  'nexito': ['escitalopram'], 'cipralex': ['escitalopram'], 'serta': ['sertraline'], 'daxid': ['sertraline'], 'fludac': ['fluoxetine'],
  'alprax': ['alprazolam'], 'restyl': ['alprazolam'], 'rivotril': ['clonazepam'], 'clonotril': ['clonazepam'], 'zolfresh': ['zolpidem'],
  'licab': ['lithium'], 'eptoin': ['phenytoin'], 'tegretol': ['carbamazepine'], 'levipil': ['levetiracetam'],
  'shelcal': ['calcium', 'vitamin d3'], 'calcimax': ['calcium', 'vitamin d3'], 'livogen': ['iron', 'folic acid'], 'autrin': ['iron', 'folic acid'],
  'becosules': ['vitamin b complex'], 'limcee': ['vitamin c'], 'electral': ['oral rehydration salts'], 'ors': ['oral rehydration salts'],
  'manforce': ['sildenafil'], 'penegra': ['sildenafil'], 'suhagra': ['sildenafil'], 'tadacip': ['tadalafil'],
  'hcqs': ['hydroxychloroquine'], 'r cinex': ['rifampicin', 'isoniazid'], 'akt 4': ['rifampicin', 'isoniazid', 'pyrazinamide', 'ethambutol'],
};

const CLASSES = {
  nsaid: ['ibuprofen', 'diclofenac', 'aceclofenac', 'mefenamic acid', 'naproxen', 'nimesulide', 'etoricoxib', 'ketorolac', 'aspirin'],
  anticoagulant: ['warfarin', 'acenocoumarol', 'apixaban', 'rivaroxaban', 'dabigatran'],
  antiplatelet: ['aspirin', 'clopidogrel', 'ticagrelor', 'prasugrel'],
  raas: ['telmisartan', 'losartan', 'olmesartan', 'enalapril', 'ramipril', 'lisinopril'],
  diuretic: ['hydrochlorothiazide', 'furosemide', 'torsemide', 'chlorthalidone'],
  potassium_sparing: ['spironolactone', 'eplerenone'],
  ssri: ['escitalopram', 'sertraline', 'fluoxetine', 'paroxetine', 'citalopram'],
  qt: ['azithromycin', 'ciprofloxacin', 'levofloxacin', 'ofloxacin', 'ondansetron', 'domperidone', 'hydroxychloroquine', 'escitalopram', 'fluconazole', 'haloperidol'],
  benzodiazepine: ['alprazolam', 'clonazepam', 'diazepam', 'lorazepam', 'zolpidem'],
  opioid: ['tramadol', 'codeine', 'tapentadol', 'morphine'],
  sedating_antihistamine: ['chlorpheniramine', 'pheniramine', 'promethazine', 'diphenhydramine'],
  nitrate: ['isosorbide dinitrate', 'isosorbide mononitrate', 'nitroglycerin'],
  pde5: ['sildenafil', 'tadalafil'],
  quinolone: ['ciprofloxacin', 'levofloxacin', 'ofloxacin', 'norfloxacin'],
  chelating: ['antacid', 'calcium', 'iron'],
  inr_raising_antimicrobial: ['azithromycin', 'ciprofloxacin', 'levofloxacin', 'metronidazole', 'fluconazole', 'cefixime', 'doxycycline'],
  ppi_cyp2c19: ['omeprazole', 'esomeprazole'],
};

const inClass = (ing, cls) => CLASSES[cls].includes(ing);
const normaliseName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Resolve a brand or generic name to ingredients (best effort). */
export function resolveIngredients(name) {
  const n = normaliseName(name);
  if (!n) return [];
  if (BRANDS[n]) return BRANDS[n];
  // Strip trailing strengths/forms: "dolo 650 mg tab" → "dolo 650" → "dolo".
  const words = n.split(' ');
  for (let k = words.length; k >= 1; k--) {
    const key = words.slice(0, k).join(' ');
    if (BRANDS[key]) return BRANDS[key];
  }
  // Generic names typed directly.
  const generics = new Set(Object.values(BRANDS).flat());
  const hits = [...generics].filter((g) => n.includes(g));
  return hits.length ? hits : [];
}

/** Daily milligrams for a dose string like "650 mg" taken at `timesPerDay`. */
function dailyMg(dose, timesPerDay) {
  const m = String(dose || '').match(/(\d+(?:\.\d+)?)\s*mg/i);
  if (!m) return null;
  return parseFloat(m[1]) * Math.max(1, timesPerDay);
}

// Brand strengths (mg of paracetamol per tablet) when the user only typed the brand.
const PCM_STRENGTH = { 'dolo 650': 650, 'p 650': 650, 'dolo': 650, 'crocin': 500, 'calpol': 500, 'combiflam': 325, 'sinarest': 500, 'vicks action 500': 500, 'saridon': 250, 'zerodol p': 325, 'hifenac p': 325, 'ultracet': 325, 'd cold total': 500, 'coldact': 500, 'crocin cold': 500, 'cheston cold': 325, 'nicip plus': 325 };

/** Pairwise/class interaction rules. Each returns null or a finding. */
const RULES = [
  { id: 'DUP-PCM', severity: 'high', test: (ings) => ings.paracetamol >= 2, title: 'Two medicines both contain paracetamol', detail: 'Taking them together can exceed the safe daily limit and damage the liver. Adults should not exceed 4 g a day (lower with alcohol use, low body weight or liver disease).', advice: 'Take only one paracetamol-containing product; ask a pharmacist which to keep.' },
  { id: 'DUP-NSAID', severity: 'high', test: (_, cls) => cls.nsaidNonAspirin >= 2, title: 'Two anti-inflammatory painkillers (NSAIDs) together', detail: 'Combining NSAIDs (e.g. ibuprofen + diclofenac/aceclofenac/nimesulide) multiplies the risk of stomach bleeding and kidney injury without better pain relief.', advice: 'Use only one NSAID at a time, with food, for the shortest time.' },
  { id: 'BLEED', severity: 'high', test: (_, cls) => (cls.anticoagulant || cls.antiplatelet) && cls.nsaidNonAspirin, title: 'Bleeding risk: blood thinner + NSAID painkiller', detail: 'NSAIDs on top of blood thinners or antiplatelets (aspirin, clopidogrel, warfarin) raise the risk of serious stomach and other bleeding.', advice: 'Prefer paracetamol for pain; talk to your doctor before taking any NSAID.' },
  { id: 'BLEED-DUAL', severity: 'moderate', test: (_, cls) => cls.anticoagulant && cls.antiplatelet, title: 'Anticoagulant + antiplatelet together', detail: 'This combination is sometimes intended, but increases bleeding risk.', advice: 'Make sure your doctor prescribed both on purpose; watch for black stools or unusual bruising.' },
  { id: 'INR-ABX', severity: 'high', test: (_, cls) => cls.anticoagulantVKA && cls.inr_raising_antimicrobial, title: 'Warfarin/acenocoumarol + antibiotic or antifungal', detail: 'Many antimicrobials (azithromycin, ciprofloxacin, metronidazole, fluconazole) can sharply raise INR and cause bleeding.', advice: 'Tell your doctor you take warfarin/acenocoumarol; an extra INR check is usually needed.' },
  { id: 'K-HIGH', severity: 'high', test: (_, cls) => cls.raas && cls.potassium_sparing, title: 'High potassium risk', detail: 'An ACE inhibitor/ARB (telmisartan, losartan, ramipril…) with spironolactone can raise potassium to dangerous levels.', advice: 'This needs regular potassium and kidney blood tests.' },
  { id: 'AKI-TRIPLE', severity: 'high', test: (_, cls) => cls.raas && cls.diuretic && cls.nsaidNonAspirin, title: '"Triple whammy" kidney risk', detail: 'BP medicine (ACE/ARB) + diuretic + NSAID together can cause acute kidney injury, especially with dehydration.', advice: 'Avoid NSAID painkillers; use paracetamol and ask your doctor.' },
  { id: 'AKI-DOUBLE', severity: 'moderate', test: (_, cls) => cls.raas && cls.nsaidNonAspirin && !cls.diuretic, title: 'BP medicine + NSAID', detail: 'NSAIDs can blunt BP control and strain the kidneys when combined with ACE inhibitors/ARBs.', advice: 'Keep NSAID use short; prefer paracetamol.' },
  { id: 'SEROTONIN', severity: 'high', test: (_, cls) => cls.ssri && cls.opioidTramadol, title: 'Serotonin syndrome / seizure risk', detail: 'Tramadol with SSRI antidepressants (escitalopram, sertraline, fluoxetine) can cause serotonin syndrome and seizures.', advice: 'Ask your doctor for a different painkiller.' },
  { id: 'PDE5-NITRATE', severity: 'contraindicated', test: (_, cls) => cls.pde5 && cls.nitrate, title: 'Sildenafil/tadalafil + nitrate — dangerous', detail: 'This combination can cause a sudden, life-threatening drop in blood pressure.', advice: 'Never take these together. Seek medical advice before using either.' },
  { id: 'RESP-DEPRESSION', severity: 'high', test: (_, cls) => cls.benzodiazepine && cls.opioid, title: 'Sedative + opioid: breathing risk', detail: 'Benzodiazepines/sleeping pills with opioids like tramadol or codeine can dangerously slow breathing.', advice: 'Do not combine without explicit medical supervision.' },
  { id: 'SEDATION', severity: 'moderate', test: (_, cls) => cls.sedating_antihistamine && (cls.benzodiazepine || cls.opioid), title: 'Extra drowsiness', detail: 'Cold medicines with chlorpheniramine/pheniramine add to the sedation from sleeping pills or opioids.', advice: 'Avoid driving; consider a non-drowsy alternative.' },
  { id: 'QT', severity: 'moderate', test: (_, cls) => cls.qtCount >= 2, title: 'Two medicines that can affect heart rhythm (QT)', detail: 'Combining QT-prolonging drugs (e.g. azithromycin, ondansetron, domperidone, ciprofloxacin, escitalopram) raises the risk of rhythm problems, especially with low potassium or heart disease.', advice: 'Tell your doctor; an ECG may be advised if you have heart disease.' },
  { id: 'CLOPI-PPI', severity: 'moderate', test: (_, cls) => cls.clopidogrel && cls.ppi_cyp2c19, title: 'Clopidogrel + omeprazole/esomeprazole', detail: 'These PPIs can reduce how well clopidogrel protects the heart.', advice: 'Pantoprazole is usually preferred — ask your doctor.' },
  { id: 'CHELATE-QUINOLONE', severity: 'moderate', test: (_, cls) => cls.quinolone && cls.chelating, title: 'Antacid / calcium / iron blocks the antibiotic', detail: 'These bind ciprofloxacin/levofloxacin/ofloxacin in the gut so less is absorbed.', advice: 'Take the antibiotic 2 h before or 6 h after antacids, calcium or iron.' },
  { id: 'CHELATE-THYROID', severity: 'moderate', test: (_, cls) => cls.levothyroxine && cls.chelating, title: 'Thyroid tablet absorption reduced', detail: 'Calcium, iron and antacids reduce levothyroxine absorption.', advice: 'Take levothyroxine on an empty stomach, 4 h apart from these.' },
  { id: 'LITHIUM', severity: 'high', test: (_, cls) => cls.lithium && (cls.nsaidNonAspirin || cls.raas || cls.diuretic), title: 'Lithium toxicity risk', detail: 'NSAIDs, ACE inhibitors/ARBs and diuretics raise lithium levels.', advice: 'Your lithium level needs checking; tell your psychiatrist.' },
  { id: 'THEO-CIPRO', severity: 'high', test: (ings) => ings.theophylline && ings.ciprofloxacin, title: 'Theophylline + ciprofloxacin', detail: 'Ciprofloxacin raises theophylline levels, risking seizures and arrhythmias.', advice: 'Ask for a different antibiotic or a dose adjustment.' },
];

/**
 * Analyse a medication list.
 * meds: [{ id, name, dose, times: ['morning', ...], ingredients?: [] , active }]
 */
export function analyseMeds(meds) {
  const active = meds.filter((m) => m.active !== false);
  const resolved = active.map((m) => ({ ...m, ingredients: m.ingredients && m.ingredients.length ? m.ingredients : resolveIngredients(m.name) }));
  const ingCount = {};
  for (const m of resolved) for (const i of new Set(m.ingredients)) ingCount[i] = (ingCount[i] || 0) + 1;
  const all = Object.keys(ingCount);
  const has = (cls) => all.some((i) => inClass(i, cls));
  const cls = {
    anticoagulant: has('anticoagulant'), antiplatelet: has('antiplatelet'), raas: has('raas'), diuretic: has('diuretic'),
    potassium_sparing: has('potassium_sparing'), ssri: has('ssri'), benzodiazepine: has('benzodiazepine'), opioid: has('opioid'),
    sedating_antihistamine: has('sedating_antihistamine'), nitrate: has('nitrate'), pde5: has('pde5'), quinolone: has('quinolone'),
    chelating: has('chelating'), inr_raising_antimicrobial: has('inr_raising_antimicrobial'), ppi_cyp2c19: has('ppi_cyp2c19'),
    anticoagulantVKA: !!(ingCount.warfarin || ingCount.acenocoumarol),
    nsaidNonAspirin: all.filter((i) => inClass(i, 'nsaid') && i !== 'aspirin').reduce((n, i) => n + ingCount[i], 0),
    qtCount: all.filter((i) => inClass(i, 'qt')).length,
    opioidTramadol: !!ingCount.tramadol, clopidogrel: !!ingCount.clopidogrel, levothyroxine: !!ingCount.levothyroxine, lithium: !!ingCount.lithium,
  };
  const findings = [];
  for (const r of RULES) {
    if (!r.test(ingCount, cls)) continue;
    findings.push({ id: r.id, severity: r.severity, title: r.title, detail: r.detail, advice: r.advice, meds: involvedMeds(r.id, resolved) });
  }

  // Daily paracetamol load across every product that contains it.
  let pcmMg = 0, pcmKnown = false;
  for (const m of resolved) {
    if (!m.ingredients.includes('paracetamol')) continue;
    const times = Math.max(1, (m.times || []).length);
    let mg = dailyMg(m.dose, times);
    if (mg == null) {
      const key = normaliseName(m.name).split(' ').slice(0, 3).join(' ');
      const strength = PCM_STRENGTH[key] ?? PCM_STRENGTH[key.split(' ').slice(0, 2).join(' ')] ?? PCM_STRENGTH[key.split(' ')[0]];
      if (strength) mg = strength * times;
    } else if (m.ingredients.length > 1) {
      // A combination's "mg" is ambiguous; fall back to the brand's paracetamol strength when we know it.
      const key = normaliseName(m.name).split(' ').slice(0, 2).join(' ');
      if (PCM_STRENGTH[key]) mg = PCM_STRENGTH[key] * times;
    }
    if (mg != null) { pcmMg += mg; pcmKnown = true; }
  }
  if (pcmKnown && pcmMg > 3000) {
    findings.unshift({
      id: 'PCM-DAILY', severity: pcmMg > 4000 ? 'high' : 'moderate',
      title: `About ${Math.round(pcmMg)} mg of paracetamol a day`,
      detail: pcmMg > 4000 ? 'This is above the 4,000 mg adult maximum and can cause liver damage.' : 'This is close to the 4,000 mg adult maximum; 3,000 mg is a safer ceiling for many people.',
      advice: 'Reduce the dose or the number of paracetamol-containing products; confirm with a pharmacist.',
      meds: resolved.filter((m) => m.ingredients.includes('paracetamol')).map((m) => m.name),
    });
  }

  const order = { contraindicated: 0, high: 1, moderate: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return {
    findings,
    resolved: resolved.map((m) => ({ id: m.id, name: m.name, ingredients: m.ingredients, recognised: m.ingredients.length > 0 })),
    paracetamol_mg_per_day: pcmKnown ? Math.round(pcmMg) : null,
  };
}

function involvedMeds(ruleId, resolved) {
  const pick = (pred) => resolved.filter((m) => m.ingredients.some(pred)).map((m) => m.name);
  switch (ruleId) {
    case 'DUP-PCM': return pick((i) => i === 'paracetamol');
    case 'DUP-NSAID': return pick((i) => inClass(i, 'nsaid') && i !== 'aspirin');
    case 'BLEED': case 'BLEED-DUAL': return pick((i) => inClass(i, 'anticoagulant') || inClass(i, 'antiplatelet') || (inClass(i, 'nsaid') && ruleId === 'BLEED'));
    case 'INR-ABX': return pick((i) => ['warfarin', 'acenocoumarol'].includes(i) || inClass(i, 'inr_raising_antimicrobial'));
    case 'K-HIGH': return pick((i) => inClass(i, 'raas') || inClass(i, 'potassium_sparing'));
    case 'AKI-TRIPLE': case 'AKI-DOUBLE': return pick((i) => inClass(i, 'raas') || inClass(i, 'diuretic') || (inClass(i, 'nsaid') && i !== 'aspirin'));
    case 'SEROTONIN': return pick((i) => inClass(i, 'ssri') || i === 'tramadol');
    case 'PDE5-NITRATE': return pick((i) => inClass(i, 'pde5') || inClass(i, 'nitrate'));
    case 'RESP-DEPRESSION': case 'SEDATION': return pick((i) => inClass(i, 'benzodiazepine') || inClass(i, 'opioid') || inClass(i, 'sedating_antihistamine'));
    case 'QT': return pick((i) => inClass(i, 'qt'));
    case 'CLOPI-PPI': return pick((i) => i === 'clopidogrel' || inClass(i, 'ppi_cyp2c19'));
    case 'CHELATE-QUINOLONE': return pick((i) => inClass(i, 'quinolone') || inClass(i, 'chelating'));
    case 'CHELATE-THYROID': return pick((i) => i === 'levothyroxine' || inClass(i, 'chelating'));
    case 'LITHIUM': return pick((i) => i === 'lithium' || inClass(i, 'raas') || inClass(i, 'diuretic') || (inClass(i, 'nsaid') && i !== 'aspirin'));
    case 'THEO-CIPRO': return pick((i) => i === 'theophylline' || i === 'ciprofloxacin');
    default: return [];
  }
}

/** Calendar day in the server's LOCAL time zone (YYYY-MM-DD). UTC keys would roll "today" over at 05:30 in India. */
export function localDayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Local day key `n` calendar days before `from`. */
export function daysAgoKey(n, from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() - n);
  return localDayKey(d);
}

// A dose only counts as missed once its slot has passed (local time).
const DUE_HOUR = { morning: 11, afternoon: 16, evening: 20, night: 24 };

/** Adherence over the last `days` from dose logs. */
export function adherence(meds, logs, days = 7, now = new Date()) {
  const dayKeys = [];
  for (let i = days - 1; i >= 0; i--) dayKeys.push(daysAgoKey(i, now));
  const todayKey = localDayKey(now);
  const logMap = new Map(logs.map((l) => [`${l.med_id}|${l.day}|${l.slot}`, l.status]));
  let expected = 0, taken = 0;
  const perDay = dayKeys.map((day) => {
    let e = 0, t = 0;
    for (const m of meds.filter((x) => x.active)) {
      if (m.start_date && day < m.start_date) continue;
      for (const slot of m.times || []) {
        const status = logMap.get(`${m.id}|${day}|${slot}`);
        if (day === todayKey && !status && now.getHours() < (DUE_HOUR[slot] ?? 24)) continue; // not due yet
        e++;
        if (status === 'taken') t++;
      }
    }
    expected += e; taken += t;
    return { day, expected: e, taken: t };
  });
  return { days, expected, taken, rate: expected ? Math.round((100 * taken) / expected) : null, perDay };
}
