/**
 * Symptom extraction from free text in English, Hinglish (romanised Hindi) and
 * Devanagari, with negation handling ("no fever", "bukhar nahi hai") and
 * extraction of duration, temperature, pain score, SpO2, BP and blood sugar.
 */

// id -> { en, hi, terms }. Latin terms match on word boundaries with common
// inflections (s/es/ing/ed); Devanagari terms match as substrings.
export const SYMPTOMS = {
  fever: { en: 'Fever', hi: 'बुखार', terms: ['fever', 'feverish', 'high temperature', 'running temperature', 'bukhar', 'bukhaar', 'bukar', 'taap', 'jwar', 'बुखार', 'ज्वर', 'तापमान'] },
  chills: { en: 'Chills / shivering', hi: 'कंपकंपी', terms: ['chill', 'shiver', 'rigor', 'kapkapi', 'thand lag', 'कंपकंपी', 'ठंड लग'] },
  cough: { en: 'Cough', hi: 'खांसी', terms: ['cough', 'khansi', 'khaansi', 'khasi', 'खांसी', 'खाँसी'] },
  cough_blood: { en: 'Coughing blood', hi: 'खांसी में खून', terms: ['coughing blood', 'cough with blood', 'blood in sputum', 'blood in phlegm', 'hemoptysis', 'khansi mein khoon', 'khoon wali khansi', 'balgam mein khoon', 'खांसी में खून', 'बलगम में खून'] },
  phlegm: { en: 'Phlegm', hi: 'बलगम', terms: ['phlegm', 'sputum', 'mucus', 'balgam', 'kaf', 'बलगम', 'कफ'] },
  sore_throat: { en: 'Sore throat', hi: 'गले में दर्द', terms: ['sore throat', 'throat pain', 'painful swallowing', 'throat infection', 'gala kharab', 'gale mein dard', 'gale me dard', 'gala dard', 'गले में दर्द', 'गला खराब'] },
  runny_nose: { en: 'Runny / blocked nose', hi: 'नाक बहना', terms: ['runny nose', 'blocked nose', 'stuffy nose', 'nasal congestion', 'cold', 'naak beh', 'naak band', 'zukam', 'jukam', 'sardi', 'नाक बह', 'जुकाम', 'सर्दी'] },
  sneezing: { en: 'Sneezing', hi: 'छींक', terms: ['sneez', 'chheenk', 'chhink', 'छींक'] },
  loss_smell: { en: 'Loss of smell / taste', hi: 'गंध/स्वाद नहीं', terms: ['loss of smell', 'lost my smell', 'cannot smell', "can't smell", 'loss of taste', 'no taste', 'smell nahi', 'swad nahi', 'गंध नहीं', 'स्वाद नहीं'] },
  headache: { en: 'Headache', hi: 'सिर दर्द', terms: ['headache', 'head ache', 'head pain', 'migraine', 'sir dard', 'sar dard', 'sir me dard', 'sir mein dard', 'sirdard', 'सिर दर्द', 'सिरदर्द', 'सर दर्द'] },
  worst_headache: { en: 'Sudden worst-ever headache', hi: 'अचानक बहुत तेज़ सिरदर्द', terms: ['worst headache', 'thunderclap', 'sudden severe headache', 'worst pain of my life', 'zindagi ka sabse tez dard'] },
  stiff_neck: { en: 'Stiff neck', hi: 'गर्दन अकड़ना', terms: ['stiff neck', 'neck stiffness', 'cannot bend neck', 'gardan akad', 'gardan jakad', 'गर्दन अकड़'] },
  photophobia: { en: 'Light sensitivity', hi: 'रोशनी से तकलीफ', terms: ['light sensitivity', 'sensitive to light', 'light hurts', 'photophobia', 'roshni se takleef'] },
  body_ache: { en: 'Body ache', hi: 'बदन दर्द', terms: ['body ache', 'body pain', 'muscle pain', 'muscle ache', 'myalgia', 'badan dard', 'badan me dard', 'sharir dard', 'बदन दर्द', 'शरीर में दर्द'] },
  joint_pain: { en: 'Joint pain', hi: 'जोड़ों में दर्द', terms: ['joint pain', 'joints hurt', 'arthralgia', 'jodo mein dard', 'jodon me dard', 'jodo me dard', 'जोड़ों में दर्द', 'जोड़ों में'] },
  eye_pain: { en: 'Pain behind the eyes', hi: 'आँखों के पीछे दर्द', terms: ['pain behind eye', 'pain behind the eye', 'behind my eye', 'eye pain', 'eyes hurt', 'retro orbital', 'aankh ke peeche', 'aankhon ke peeche', 'aankh ke piche', 'aankhon ke piche', 'aankhon mein dard', 'aankh mein dard', 'आँखों के पीछे', 'आंखों के पीछे'] },
  fatigue: { en: 'Fatigue / weakness', hi: 'कमज़ोरी', terms: ['tired', 'fatigue', 'weakness', 'weak', 'exhausted', 'lethargic', 'no energy', 'kamzori', 'kamjori', 'thakan', 'thakaan', 'कमजोरी', 'कमज़ोरी', 'थकान'] },
  lethargy: { en: 'Unusually drowsy / hard to wake', hi: 'बहुत सुस्ती', terms: ['very drowsy', 'hard to wake', 'not responding', 'unresponsive', 'bahut susti', 'behad susti', 'सुस्ती'] },
  nausea: { en: 'Nausea', hi: 'जी मिचलाना', terms: ['nausea', 'nauseous', 'queasy', 'feel like vomiting', 'ji machal', 'jee machal', 'जी मिचला'] },
  vomiting: { en: 'Vomiting', hi: 'उल्टी', terms: ['vomit', 'throwing up', 'threw up', 'puking', 'ulti', 'ultee', 'उल्टी'] },
  persistent_vomiting: { en: 'Cannot keep fluids down', hi: 'पानी भी नहीं रुक रहा', terms: ["can't keep anything down", 'cannot keep anything down', 'cannot keep water down', "can't keep water down", 'vomiting everything', 'repeated vomiting', 'baar baar ulti', 'pani bhi nahi ruk', 'बार बार उल्टी'] },
  vomit_blood: { en: 'Vomiting blood', hi: 'खून की उल्टी', terms: ['vomiting blood', 'blood in vomit', 'vomited blood', 'khoon ki ulti', 'ulti mein khoon', 'खून की उल्टी'] },
  diarrhea: { en: 'Diarrhoea / loose motions', hi: 'दस्त', terms: ['diarrhea', 'diarrhoea', 'loose motion', 'loose stool', 'watery stool', 'dast', 'pet kharab', 'दस्त', 'पतले दस्त'] },
  blood_stool: { en: 'Blood in stool', hi: 'मल में खून', terms: ['blood in stool', 'bloody stool', 'bloody diarrhea', 'potty mein khoon', 'mal mein khoon', 'मल में खून'] },
  black_stool: { en: 'Black, tarry stool', hi: 'काला मल', terms: ['black stool', 'tarry stool', 'black potty', 'kala mal', 'काला मल'] },
  abdominal_pain: { en: 'Abdominal pain', hi: 'पेट दर्द', terms: ['stomach pain', 'stomach ache', 'abdominal pain', 'belly pain', 'tummy pain', 'stomach cramp', 'pet dard', 'pet me dard', 'pet mein dard', 'पेट दर्द', 'पेट में दर्द'] },
  heartburn: { en: 'Acidity / heartburn', hi: 'एसिडिटी', terms: ['heartburn', 'acidity', 'acid reflux', 'gastric', 'gas problem', 'burping', 'khatti dakar', 'seene mein jalan', 'सीने में जलन', 'एसिडिटी', 'खट्टी डकार'] },
  burning_urination: { en: 'Burning urination', hi: 'पेशाब में जलन', terms: ['burning urination', 'burning while urinating', 'painful urination', 'burning pee', 'dysuria', 'peshab mein jalan', 'peshab me jalan', 'पेशाब में जलन'] },
  frequent_urination: { en: 'Frequent urination', hi: 'बार-बार पेशाब', terms: ['frequent urination', 'peeing a lot', 'urinating often', 'baar baar peshab', 'बार बार पेशाब'] },
  blood_urine: { en: 'Blood in urine', hi: 'पेशाब में खून', terms: ['blood in urine', 'red urine', 'peshab mein khoon', 'पेशाब में खून'] },
  no_urination: { en: 'Little or no urine', hi: 'पेशाब कम/नहीं', terms: ['not urinated', 'no urine', 'not peeing', 'very little urine', 'peshab nahi aa', 'peshab kam', 'पेशाब नहीं'] },
  back_pain: { en: 'Back pain', hi: 'कमर दर्द', terms: ['back pain', 'backache', 'lower back', 'kamar dard', 'kamar me dard', 'peeth dard', 'कमर दर्द', 'पीठ दर्द'] },
  chest_pain: { en: 'Chest pain / pressure', hi: 'सीने में दर्द', terms: ['chest pain', 'chest tightness', 'chest pressure', 'pain in chest', 'pain in my chest', 'heaviness in chest', 'chest heaviness', 'tight chest', 'seene mein dard', 'seene me dard', 'chhati mein dard', 'chhati me dard', 'सीने में दर्द', 'छाती में दर्द'] },
  radiating_pain: { en: 'Pain spreading to arm / jaw', hi: 'दर्द बाँह/जबड़े तक', terms: ['left arm', 'pain in arm', 'arm pain', 'jaw pain', 'pain spreading', 'radiating', 'goes to my arm', 'baayein haath', 'bayen hath', 'jabde mein dard', 'बाएं हाथ', 'जबड़े'] },
  palpitations: { en: 'Palpitations', hi: 'धड़कन तेज़', terms: ['palpitation', 'heart racing', 'racing heart', 'heart pounding', 'pounding heart', 'irregular heartbeat', 'dhadkan tez', 'dil tez', 'धड़कन तेज'] },
  breathless: { en: 'Shortness of breath', hi: 'सांस फूलना', terms: ['shortness of breath', 'short of breath', 'breathless', 'difficulty breathing', 'hard to breathe', 'trouble breathing', "can't breathe", 'cannot breathe', 'saans phool', 'saans lene mein', 'sans phool', 'saans ki takleef', 'सांस फूल', 'सांस लेने में'] },
  wheeze: { en: 'Wheezing', hi: 'घरघराहट', terms: ['wheez', 'whistling breath', 'ghar ghar', 'seeti ki awaaz', 'घरघराहट'] },
  blue_lips: { en: 'Blue lips / face', hi: 'होंठ नीले', terms: ['blue lips', 'lips turning blue', 'bluish', 'cyanosis', 'honth neele', 'होंठ नीले'] },
  cannot_speak: { en: 'Too breathless to speak', hi: 'बोल नहीं पा रहे', terms: ['cannot speak', "can't speak", 'unable to talk', 'cannot finish sentence', 'bol nahi pa'] },
  dizziness: { en: 'Dizziness', hi: 'चक्कर', terms: ['dizzy', 'dizziness', 'lightheaded', 'light headed', 'vertigo', 'room spinning', 'chakkar', 'चक्कर'] },
  fainting: { en: 'Fainting', hi: 'बेहोशी', terms: ['faint', 'passed out', 'blacked out', 'collapse', 'syncope', 'behosh', 'behoshi', 'बेहोश'] },
  confusion: { en: 'Confusion', hi: 'भ्रम / उलझन', terms: ['confused', 'confusion', 'disoriented', 'not making sense', 'delirious', 'ulta seedha bol', 'भ्रम'] },
  seizure: { en: 'Seizure / fits', hi: 'दौरा / मिर्गी', terms: ['seizure', 'convulsion', 'fits', 'fitting', 'mirgi', 'daura pad', 'दौरा', 'मिर्गी'] },
  face_droop: { en: 'Face drooping', hi: 'चेहरा टेढ़ा', terms: ['face droop', 'drooping face', 'face is drooping', 'mouth droop', 'face crooked', 'face numb on one side', 'chehra tedha', 'muh tedha', 'चेहरा टेढ़ा', 'मुंह टेढ़ा'] },
  arm_weakness: { en: 'Sudden arm/leg weakness', hi: 'हाथ-पैर में कमज़ोरी', terms: ['arm weakness', 'weak arm', 'cannot lift arm', "can't lift my arm", 'one side weak', 'weakness on one side', 'leg weakness on one side', 'haath nahi uth', 'ek taraf kamzori', 'हाथ नहीं उठ'] },
  speech_difficulty: { en: 'Slurred / difficult speech', hi: 'बोलने में दिक्कत', terms: ['slurred speech', 'speech slurred', 'trouble speaking', 'difficulty speaking', 'words not coming', 'zabaan ladkhada', 'bolne mein dikkat', 'बोलने में दिक्कत'] },
  vision_loss: { en: 'Sudden vision loss / double vision', hi: 'अचानक दिखना बंद', terms: ['vision loss', 'lost vision', 'sudden blindness', 'double vision', 'blurred vision suddenly', 'dikhna band', 'dhundla dikh', 'दिखना बंद'] },
  balance_loss: { en: 'Sudden loss of balance', hi: 'संतुलन खोना', terms: ['loss of balance', 'cannot walk straight', 'losing balance', 'santulan', 'लड़खड़ा'] },
  numbness: { en: 'Numbness / tingling', hi: 'सुन्नपन', terms: ['numb', 'tingling', 'pins and needles', 'sunn', 'jhunjhuni', 'सुन्न'] },
  rash: { en: 'Rash / red spots', hi: 'चकत्ते / दाने', terms: ['rash', 'red spots', 'spots on skin', 'hives', 'daane', 'chakatte', 'lal daane', 'दाने', 'चकत्ते'] },
  itching: { en: 'Itching', hi: 'खुजली', terms: ['itch', 'khujli', 'khujlee', 'खुजली'] },
  swelling_face: { en: 'Swollen lips / face / throat', hi: 'होंठ/चेहरा सूजना', terms: ['swollen lip', 'lip swelling', 'lips swollen', 'lips are swollen', 'lips swelling', 'swelling of lips', 'swelling of the lips', 'swollen face', 'face swelling', 'face is swollen', 'face swollen', 'swelling of face', 'swelling of the face', 'puffy face', 'swollen tongue', 'tongue swollen', 'tongue is swollen', 'swelling of tongue', 'throat swelling', 'throat closing', 'throat is closing', 'eyes swollen shut', 'honth sooj', 'chehra sooj', 'jeebh sooj', 'सूजन', 'होंठ सूज'] },
  bleeding_unspecified: { en: 'Bleeding', hi: 'रक्तस्राव', terms: ['bleeding', 'blood loss', 'losing blood', 'khoon aa raha', 'khoon nikal', 'khoon beh', 'खून आ रहा', 'खून निकल'] },
  bleeding_gums: { en: 'Bleeding gums', hi: 'मसूड़ों से खून', terms: ['bleeding gums', 'gums bleeding', 'gum bleeding', 'masoodon se khoon', 'masudo se khoon', 'masude se khoon', 'मसूड़ों से खून'] },
  nosebleed: { en: 'Nosebleed', hi: 'नाक से खून', terms: ['nosebleed', 'nose bleed', 'bleeding nose', 'blood from nose', 'naak se khoon', 'nakseer', 'नाक से खून', 'नकसीर'] },
  sweating: { en: 'Cold sweat', hi: 'पसीना', terms: ['cold sweat', 'sweating', 'sweaty', 'clammy', 'paseena', 'pasina', 'पसीना'] },
  thirst: { en: 'Excessive thirst', hi: 'बहुत प्यास', terms: ['very thirsty', 'excessive thirst', 'always thirsty', 'bahut pyaas', 'zyada pyaas', 'बहुत प्यास'] },
  dry_mouth: { en: 'Very dry mouth', hi: 'मुँह सूखना', terms: ['dry mouth', 'mouth is dry', 'munh sookh', 'muh sukh', 'मुंह सूख'] },
  fruity_breath: { en: 'Fruity-smelling breath', hi: 'साँस में फल जैसी गंध', terms: ['fruity breath', 'sweet smelling breath', 'acetone breath'] },
  weight_loss: { en: 'Unintended weight loss', hi: 'वज़न कम होना', terms: ['weight loss', 'losing weight', 'lost weight', 'wajan kam', 'vajan kam', 'वजन कम', 'वज़न कम'] },
  night_sweats: { en: 'Night sweats', hi: 'रात को पसीना', terms: ['night sweat', 'sweating at night', 'raat ko paseena', 'raat mein paseena', 'रात को पसीना'] },
  anxiety: { en: 'Anxiety / panic', hi: 'घबराहट', terms: ['anxious', 'anxiety', 'panic', 'nervous', 'restless', 'ghabrahat', 'ghabrahat', 'bechaini', 'घबराहट', 'बेचैनी'] },
  low_mood: { en: 'Low mood', hi: 'उदासी', terms: ['depressed', 'depression', 'hopeless', 'sad all the time', 'low mood', 'nothing feels good', 'udaas', 'udasi', 'man nahi lagta', 'उदास', 'मन नहीं लगता'] },
  insomnia: { en: 'Poor sleep', hi: 'नींद नहीं', terms: ['insomnia', "can't sleep", 'cannot sleep', 'not sleeping', 'poor sleep', 'neend nahi', 'neend nahin', 'नींद नहीं'] },
  suicidal: { en: 'Thoughts of self-harm', hi: 'आत्म-हानि के विचार', terms: ['suicide', 'suicidal', 'kill myself', 'end my life', 'want to die', 'self harm', 'hurt myself', 'no reason to live', 'khudkushi', 'atmahatya', 'marna chahta', 'marna chahti', 'jeena nahi chahta', 'jeena nahi chahti', 'आत्महत्या', 'मरना चाहत'] },
  heat_exposure: { en: 'Heat / sun exposure', hi: 'लू / धूप', terms: ['heat stroke', 'heatstroke', 'sunstroke', 'in the sun', 'heat wave', 'heatwave', 'working in heat', 'loo lag', 'lu lag', 'dhoop mein', 'लू लग', 'धूप में'] },
  snake_bite: { en: 'Snake bite', hi: 'साँप का काटना', terms: ['snake bite', 'snakebite', 'bitten by a snake', 'snake bit', 'saanp ne kata', 'sanp ne kata', 'saap ne kata', 'सांप ने काटा', 'साँप'] },
  animal_bite: { en: 'Dog / animal bite', hi: 'कुत्ते का काटना', terms: ['dog bite', 'dog bit', 'bitten by a dog', 'monkey bite', 'cat bite', 'kutte ne kata', 'bandar ne kata', 'कुत्ते ने काटा'] },
  eye_redness: { en: 'Red / sticky eyes', hi: 'आँख लाल', terms: ['red eye', 'pink eye', 'conjunctivitis', 'eye discharge', 'sticky eyes', 'aankh laal', 'aankh aana', 'आँख लाल', 'आंख लाल'] },
  ear_pain: { en: 'Ear pain', hi: 'कान दर्द', terms: ['ear pain', 'earache', 'ear ache', 'kaan dard', 'kaan me dard', 'कान दर्द'] },
  toothache: { en: 'Toothache', hi: 'दाँत दर्द', terms: ['toothache', 'tooth pain', 'daant dard', 'dant dard', 'दांत दर्द'] },
  vaginal_bleeding: { en: 'Vaginal bleeding (pregnancy)', hi: 'योनि से रक्तस्राव', terms: ['vaginal bleeding', 'bleeding down there', 'spotting', 'bleeding during pregnancy', 'khoon aa raha', 'रक्तस्राव'] },
  reduced_fetal_movement: { en: 'Baby moving less', hi: 'बच्चे की हलचल कम', terms: ['baby not moving', 'baby moving less', 'reduced fetal movement', 'less kicks', 'bacha hil nahi', 'हलचल कम'] },
};

const NEG_BEFORE = new Set(['no', 'not', 'without', 'denies', 'deny', 'denied', 'never', 'nor', 'none', 'absent', 'na', 'bina', 'नहीं', 'बिना',
  "don't", 'dont', "doesn't", 'doesnt', "didn't", 'didnt', "haven't", 'havent', "hasn't", 'hasnt', "hadn't", "isn't", "aren't", "wasn't", "weren't"]);
const NEG_AFTER = new Set(['nahi', 'nahin', 'nhi', 'nai', 'नहीं', 'नही']);
// A clause break ends a negation's scope. Punctuation counts, so "I don't feel well, fever since
// morning" keeps the fever: when in doubt, detecting a symptom is safer than missing one.
const CLAUSE_BREAK = new Set([',', 'but', 'however', 'though', 'although', 'lekin', 'magar', 'parantu', 'लेकिन', 'मगर']);
const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, an: 1, ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, saat: 7, aath: 8, nau: 9, das: 10 };

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isLatin = (s) => /^[\x00-\x7f]+$/.test(s);

// Precompiled matchers: [id, term, regex | null]
const MATCHERS = [];
for (const [id, def] of Object.entries(SYMPTOMS)) {
  for (const term of def.terms) {
    const t = term.toLowerCase();
    MATCHERS.push([id, t, isLatin(t) ? new RegExp(`(?:^|[^a-z])(${escapeRe(t)}(?:s|es|ing|ed|y|ness)?)(?=[^a-z]|$)`, 'g') : null]);
  }
}

export function normalise(text) {
  return ` ${String(text || '').toLowerCase().replace(/[’`]/g, "'")
    .replace(/[,;!?।|]+/g, ' , ') // clause punctuation becomes a "," token (Devanagari danda included)
    .replace(/\.(?=\s|$)/g, ' , ') // sentence-ending full stops too — decimals like 101.5 are kept
    .replace(/[^\p{L}\p{M}\p{N}'/.,°\s-]/gu, ' ').replace(/\s+/g, ' ').trim()} `;
}

function isNegated(text, start, end) {
  const before = text.slice(Math.max(0, start - 40), start).trim().split(/\s+/).slice(-4);
  // Hindi negates after the noun ("bukhar nahi hai", "bukhar to nahi"); a 2-word
  // window keeps "sir dard hai, bukhar nahi" from negating the headache.
  const after = text.slice(end, end + 25).trim().split(/\s+/).slice(0, 2);
  // "no X", "not having X", "no fever or X" — scanning back from the term, a
  // clause break ("no fever but cough") ends the negation's scope.
  for (let i = before.length - 1; i >= 0; i--) {
    if (CLAUSE_BREAK.has(before[i])) break;
    if (NEG_BEFORE.has(before[i])) return true;
  }
  return after.some((w) => NEG_AFTER.has(w));
}

function wordNumber(s) {
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NUM_WORDS[s] ?? null;
}

function extractDuration(t) {
  const unit = [
    [/(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|a|an|ek|do|teen|char|chaar|paanch|panch|chhe|saat|aath|nau|das)\s*(?:days?|din|दिन)\b/, 1],
    [/(\d+(?:\.\d+)?|one|two|three|four|five|six|a|an|ek|do|teen|char|chaar)\s*(?:weeks?|hafte|hafta|हफ्ते|सप्ताह)/, 7],
    [/(\d+(?:\.\d+)?|one|two|three|four|five|six|a|an|ek|do|teen)\s*(?:months?|mahine|mahina|महीने)/, 30],
    [/(\d+(?:\.\d+)?|one|two|three|four|five|six|a|an|ek|do|teen)\s*(?:hours?|hrs?|ghante|घंटे)/, 1 / 24],
  ];
  for (const [re, mult] of unit) {
    const m = t.match(re);
    if (m) { const n = wordNumber(m[1]); if (n != null) return Math.round(n * mult * 100) / 100; }
  }
  if (/since yesterday|kal se|कल से/.test(t)) return 1;
  if (/since (this )?morning|subah se|aaj se|since today|सुबह से/.test(t)) return 0.3;
  if (/since last week|pichhle hafte/.test(t)) return 7;
  return null;
}

const toCelsius = (v, scale) => {
  if (scale === 'c' || (!scale && v >= 34 && v <= 43)) return v >= 34 && v <= 43 ? v : null;
  if (v >= 93 && v <= 110) return Math.round(((v - 32) * 5) / 9 * 10) / 10;
  return null;
};

const FEVER_WORD = /fever|temp|bukhar|बुखार|ज्वर|taap/g;

function extractTemperature(t) {
  // 1. An explicit unit is unambiguous: "101 F", "38.5°c".
  const u = t.match(/(\d{2,3}(?:\.\d)?)\s*(?:°|deg(?:ree)?s?)?\s*(f|c|fahrenheit|celsius)\b/);
  if (u) {
    const c = toCelsius(parseFloat(u[1]), u[2][0]);
    if (c != null) return c;
  }
  // 2. Otherwise only in a fever message, and only numbers that are shaped like a body temperature
  //    and don't clearly belong to something else ("bp 102/70", "for 100 days", "age 39").
  const feverAt = [...t.matchAll(FEVER_WORD)].map((x) => x.index);
  if (!feverAt.length) return null;
  const re = /(\d{2,3}(?:\.\d)?)/g;
  let n;
  while ((n = re.exec(t))) {
    const raw = n[1], at = n.index;
    const before = t.slice(Math.max(0, at - 10), at);
    const after = t.slice(at + raw.length, at + raw.length + 8);
    if (/bp|sugar|glucose|spo2|sp02|oxygen|o2|pulse|hr|heart|age|weight|kg|saal|year/.test(before)) continue;
    if (/^\s*(\/|%|mg|kg|bpm|years?|yrs?|saal|din|days?|hours?|hrs?|ghante|weeks?|hafte|months?|mahine|mmhg|ml|minutes?|mins?)/.test(after)) continue;
    const v = parseFloat(raw);
    if (v >= 93 && v <= 110) return toCelsius(v, 'f');
    // Celsius needs a decimal ("37.9") or to sit right after the fever word ("fever 39").
    const nearFever = feverAt.some((i) => at > i && at - i <= 16);
    if (v >= 35 && v <= 43 && (raw.includes('.') || nearFever)) return v;
  }
  return null;
}

export function parseSymptoms(text) {
  const t = normalise(text);
  const found = new Map(), negated = new Set();
  for (const [id, term, re] of MATCHERS) {
    if (re) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(t))) {
        const start = m.index + m[0].indexOf(m[1]), end = start + m[1].length;
        if (isNegated(t, start, end)) negated.add(id);
        else if (!found.has(id)) found.set(id, term);
      }
    } else {
      let i = t.indexOf(term);
      while (i >= 0) {
        if (isNegated(t, i, i + term.length)) negated.add(id);
        else if (!found.has(id)) found.set(id, term);
        i = t.indexOf(term, i + term.length);
      }
    }
  }
  // A specific finding implies its parent symptom.
  const implies = { worst_headache: 'headache', cough_blood: 'cough', persistent_vomiting: 'vomiting', vomit_blood: 'vomiting', cannot_speak: 'breathless', blue_lips: 'breathless' };
  for (const [child, parent] of Object.entries(implies)) if (found.has(child) && !found.has(parent)) found.set(parent, '(implied)');
  // "cold" is ambiguous ("cold sweat", "feeling cold"); drop the runny-nose reading when it is only the bare word.
  if (found.get('runny_nose') === 'cold' && /cold sweat|feel(ing)? cold|thand/.test(t)) found.delete('runny_nose');

  const sev = t.match(/(\d{1,2})\s*(?:\/|out of)\s*10/);
  const spo2 = t.match(/(?:spo2|sp02|oxygen|saturation|o2)\D{0,8}(\d{2,3})\s*%?/);
  const bp = t.match(/\b(?:bp|blood pressure)\D{0,8}(\d{2,3})\s*\/\s*(\d{2,3})/);
  const sugar = t.match(/(?:sugar|glucose|rbs|fbs)\D{0,10}(\d{2,3})/);
  const num = (m, lo, hi, i = 1) => { if (!m) return null; const v = +m[i]; return v >= lo && v <= hi ? v : null; };

  return {
    symptoms: [...found.keys()],
    matched: Object.fromEntries(found),
    negated: [...negated].filter((id) => !found.has(id)),
    duration_days: extractDuration(t),
    temp_c: extractTemperature(t),
    severity: num(sev, 0, 10),
    spo2: num(spo2, 50, 100),
    bp_sys: num(bp, 60, 260, 1),
    bp_dia: num(bp, 30, 160, 2),
    glucose: num(sugar, 20, 700),
  };
}

export const symptomLabel = (id, lang = 'en') => (SYMPTOMS[id] ? SYMPTOMS[id][lang === 'hi' ? 'hi' : 'en'] : id);

/** Quick-pick chips shown in the triage UI. */
export const COMMON_CHIPS = ['fever', 'cough', 'headache', 'sore_throat', 'body_ache', 'breathless', 'chest_pain', 'abdominal_pain', 'vomiting', 'diarrhea', 'dizziness', 'fatigue', 'rash', 'anxiety', 'burning_urination', 'runny_nose'];
