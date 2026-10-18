/**
 * Knowledge base of common presentations in Indian primary care, scored with a
 * transparent naive-Bayes model: prior × season × Π P(symptom | condition) / P(symptom).
 * Used by the offline engine; the AI path gets the same structured inputs.
 */

const monsoon = (m) => (m >= 6 && m <= 10 ? 2.2 : 0.7); // Jul–Nov peak for vector-borne disease
const summer = (m) => (m >= 3 && m <= 6 ? 2.5 : 0.4); // Apr–Jul heat season
const winterResp = (m) => (m >= 10 || m <= 1 ? 1.6 : 0.9);

export const CONDITIONS = [
  {
    id: 'viral_uri', name: 'Common cold (viral upper respiratory infection)', name_hi: 'सामान्य ज़ुकाम (वायरल)',
    prior: 0.2, season: winterResp, level: 'self_care', setting: 'home',
    cardinal: [['runny_nose', 'sneezing', 'sore_throat', 'cough']],
    p: { runny_nose: 0.85, sneezing: 0.6, sore_throat: 0.6, cough: 0.55, headache: 0.3, fever: 0.25, fatigue: 0.35, body_ache: 0.2, phlegm: 0.3 },
    duration: (d) => (d == null ? 1 : d <= 10 ? 1.2 : 0.25),
    why: 'Nasal symptoms, sore throat and cough with little or no fever fit a common viral cold.',
    self_care: ['Rest and drink warm fluids (water, soups, ginger-tulsi tea)', 'Steam inhalation and saline gargles 2–3 times a day', 'Paracetamol at the label dose if you have aches or fever'],
    watch_for: ['Fever above 101 °F (38.5 °C) for more than 3 days', 'Breathlessness or chest pain', 'Symptoms lasting more than 10 days'],
    ask_doctor: ['Do I need any tests, or is this safe to manage at home?'],
  },
  {
    id: 'influenza', name: 'Flu-like illness (influenza)', name_hi: 'फ्लू जैसी बीमारी (इन्फ्लुएंजा)',
    prior: 0.1, season: winterResp, level: 'self_care', setting: 'home',
    cardinal: [['fever', 'chills']],
    p: { fever: 0.9, chills: 0.6, body_ache: 0.8, fatigue: 0.8, headache: 0.65, cough: 0.7, sore_throat: 0.5, runny_nose: 0.4 },
    duration: (d) => (d == null ? 1 : d <= 7 ? 1.2 : 0.3),
    why: 'A sudden fever with marked body aches, tiredness and cough is typical of influenza.',
    self_care: ['Rest at home and avoid contact with older or pregnant family members', 'Fluids and paracetamol for fever and aches', 'Wear a mask around others until 24 h without fever'],
    watch_for: ['Breathlessness, chest pain, confusion', 'Fever returning after improving', 'Inability to keep fluids down'],
    ask_doctor: ['Am I in a high-risk group that needs antiviral treatment?'],
  },
  {
    id: 'covid', name: 'COVID-19-like illness', name_hi: 'कोविड-19 जैसी बीमारी',
    prior: 0.04, season: () => 1, level: 'self_care', setting: 'teleconsult',
    cardinal: [['fever', 'cough', 'loss_smell', 'sore_throat']],
    p: { loss_smell: 0.45, fever: 0.65, cough: 0.7, fatigue: 0.7, sore_throat: 0.45, headache: 0.5, body_ache: 0.5, breathless: 0.2, diarrhea: 0.1 },
    why: 'Fever, cough and especially loss of smell or taste are consistent with COVID-19.',
    tests: 'Rapid antigen or RT-PCR test',
    self_care: ['Isolate and mask around others', 'Check oxygen with a pulse oximeter twice a day if available', 'Fluids, rest, paracetamol for fever'],
    watch_for: ['Oxygen below 94%', 'Breathlessness or chest pain', 'Fever beyond 5 days'],
    ask_doctor: ['Should I get tested, and when can I stop isolating?'],
  },
  {
    id: 'dengue', name: 'Dengue (suspected)', name_hi: 'डेंगू (संदिग्ध)',
    prior: 0.05, season: monsoon, level: 'soon', setting: 'primary_care',
    cardinal: [['fever']],
    p: { fever: 0.97, headache: 0.75, body_ache: 0.8, joint_pain: 0.6, eye_pain: 0.5, rash: 0.35, nausea: 0.45, vomiting: 0.35, fatigue: 0.65, chills: 0.35, bleeding_gums: 0.12, nosebleed: 0.1, abdominal_pain: 0.3, runny_nose: 0.08, cough: 0.12 },
    duration: (d) => (d == null ? 1 : d <= 10 ? 1.3 : 0.3),
    why: 'High fever with severe body or joint aches, headache or pain behind the eyes is the classic dengue pattern.',
    tests: 'CBC with platelet count + NS1 antigen (days 1–5) or dengue IgM (after day 5)',
    self_care: ['Drink 2.5–3 L of fluids a day (water, ORS, coconut water, soups)', 'Paracetamol only — avoid ibuprofen, aspirin and diclofenac, which raise bleeding risk', 'Sleep under a mosquito net so mosquitoes cannot spread it to family'],
    watch_for: ['Bleeding gums or nose, black stools, red spots', 'Severe belly pain or repeated vomiting', 'Drowsiness or restlessness — especially as the fever comes down (days 3–7 are the critical phase)'],
    ask_doctor: ['Do I need a platelet count today, and a repeat in 24–48 h?', 'Which warning signs should bring me straight back?'],
  },
  {
    id: 'malaria', name: 'Malaria (suspected)', name_hi: 'मलेरिया (संदिग्ध)',
    prior: 0.03, season: monsoon, level: 'soon', setting: 'primary_care',
    cardinal: [['fever', 'chills']],
    p: { fever: 0.97, chills: 0.8, sweating: 0.6, headache: 0.6, body_ache: 0.55, nausea: 0.4, vomiting: 0.35, fatigue: 0.6, abdominal_pain: 0.15, cough: 0.1, runny_nose: 0.05 },
    why: 'Fever with shaking chills followed by sweating is typical of malaria, which is common after the monsoon.',
    tests: 'Malaria rapid diagnostic test (RDT) or blood smear — free at government facilities',
    self_care: ['Get tested before taking any antimalarial', 'Fluids and paracetamol for fever'],
    watch_for: ['Confusion, drowsiness, fits', 'Yellow eyes, dark urine, very little urine', 'Breathlessness'],
    ask_doctor: ['Should I be tested for both malaria and dengue?'],
  },
  {
    id: 'typhoid', name: 'Typhoid (enteric fever, suspected)', name_hi: 'टाइफ़ाइड (संदिग्ध)',
    prior: 0.03, season: monsoon, level: 'soon', setting: 'primary_care',
    cardinal: [['fever']],
    p: { fever: 0.97, headache: 0.6, abdominal_pain: 0.5, fatigue: 0.7, diarrhea: 0.3, nausea: 0.35, vomiting: 0.25, body_ache: 0.4, cough: 0.2, runny_nose: 0.05 },
    duration: (d) => (d == null ? 0.8 : d >= 5 ? 2.2 : d >= 3 ? 1 : 0.35),
    why: 'A fever that keeps rising over several days with headache, tiredness and stomach upset fits typhoid.',
    tests: 'Blood culture (best in week 1); avoid relying on the Widal test alone',
    self_care: ['Drink only boiled or bottled water; eat freshly cooked food', 'Fluids and paracetamol; do not start antibiotics without a doctor'],
    watch_for: ['Severe belly pain or a hard, swollen belly', 'Blood in stool, confusion', 'Fever above 103 °F not coming down'],
    ask_doctor: ['Do I need a blood culture before starting treatment?'],
  },
  {
    id: 'chikungunya', name: 'Chikungunya (suspected)', name_hi: 'चिकनगुनिया (संदिग्ध)',
    prior: 0.015, season: monsoon, level: 'soon', setting: 'primary_care',
    cardinal: [['fever'], ['joint_pain']],
    p: { fever: 0.95, joint_pain: 0.95, rash: 0.4, headache: 0.5, body_ache: 0.6, fatigue: 0.6, swelling_face: 0.02 },
    why: 'Fever with intense joint pain, often in the hands and feet, is the hallmark of chikungunya.',
    tests: 'Chikungunya IgM/RT-PCR; dengue test as well since they overlap',
    self_care: ['Rest the joints; cold packs help', 'Paracetamol; avoid ibuprofen/aspirin until dengue is ruled out'],
    watch_for: ['Bleeding, severe belly pain (to exclude dengue)', 'Joint pain lasting beyond 2 weeks'],
    ask_doctor: ['Can we rule out dengue before I take anti-inflammatory painkillers?'],
  },
  {
    id: 'pneumonia', name: 'Chest infection (pneumonia, possible)', name_hi: 'छाती का संक्रमण (निमोनिया, संभावित)',
    prior: 0.025, season: winterResp, level: 'urgent', setting: 'primary_care',
    cardinal: [['cough'], ['fever', 'breathless']],
    p: { cough: 0.9, fever: 0.8, breathless: 0.6, phlegm: 0.6, chest_pain: 0.35, chills: 0.45, fatigue: 0.6, runny_nose: 0.15 },
    why: 'Cough with fever plus breathlessness or chest pain on breathing suggests the infection may involve the lungs.',
    tests: 'Clinical examination ± chest X-ray, oxygen saturation',
    self_care: ['Rest, fluids, paracetamol for fever while arranging a doctor visit'],
    watch_for: ['Oxygen below 94%, fast breathing, blue lips', 'Confusion or drowsiness'],
    ask_doctor: ['Do I need a chest X-ray or antibiotics?'],
  },
  {
    id: 'pharyngitis', name: 'Throat infection (pharyngitis / tonsillitis)', name_hi: 'गले का संक्रमण',
    prior: 0.06, season: winterResp, level: 'self_care', setting: 'teleconsult',
    cardinal: [['sore_throat']],
    p: { sore_throat: 0.97, fever: 0.55, headache: 0.35, body_ache: 0.25, cough: 0.15, runny_nose: 0.15 },
    why: 'A painful throat with fever and little cough or cold points to a throat infection.',
    self_care: ['Warm salt-water gargles, warm fluids, honey (not for babies under 1)', 'Paracetamol for pain'],
    watch_for: ['Unable to swallow saliva or open the mouth', 'Muffled voice, drooling', 'Rash'],
    ask_doctor: ['Does this look bacterial, and do I actually need antibiotics?'],
  },
  {
    id: 'gastroenteritis', name: 'Gastroenteritis / food poisoning', name_hi: 'पेट का संक्रमण / फूड पॉइज़निंग',
    prior: 0.12, season: monsoon, level: 'self_care', setting: 'home',
    cardinal: [['diarrhea', 'vomiting']],
    p: { diarrhea: 0.9, vomiting: 0.6, nausea: 0.7, abdominal_pain: 0.65, fever: 0.3, body_ache: 0.2, fatigue: 0.4 },
    why: 'Loose motions with vomiting and stomach cramps fit an infection of the gut, often from food or water.',
    self_care: ['ORS after every loose stool (1 packet in 1 L of clean water); keep sipping', 'Light food: rice, curd, banana, khichdi', 'Zinc tablets for children as advised by a doctor'],
    watch_for: ['Very little urine, very dry mouth, dizziness', 'Blood in stool or high fever', 'Cannot keep ORS down'],
    ask_doctor: ['Do I need a stool test or any medicine beyond ORS?'],
  },
  {
    id: 'acs', name: 'Heart attack or angina (acute coronary syndrome)', name_hi: 'दिल का दौरा या एनजाइना',
    prior: 0.02, season: () => 1, level: 'emergency', setting: 'hospital_er',
    cardinal: [['chest_pain']],
    p: { chest_pain: 0.95, radiating_pain: 0.5, sweating: 0.5, breathless: 0.45, nausea: 0.3, dizziness: 0.2, fainting: 0.08, palpitations: 0.15, fatigue: 0.25, heartburn: 0.12 },
    why: 'Chest pain or pressure — especially spreading to the arm or jaw, with sweating, nausea or breathlessness — must be treated as the heart until proven otherwise.',
    tests: 'ECG within 10 minutes of arrival, troponin blood test',
    self_care: [],
    watch_for: ['Pain lasting more than a few minutes or coming back', 'Sweating, breathlessness, fainting'],
    ask_doctor: ['Do I need an ECG and troponin test now?'],
  },
  {
    id: 'chest_wall', name: 'Chest-wall muscle strain', name_hi: 'छाती की मांसपेशी में खिंचाव',
    prior: 0.04, season: () => 1, level: 'soon', setting: 'primary_care',
    cardinal: [['chest_pain']],
    p: { chest_pain: 0.95, back_pain: 0.2, body_ache: 0.2, cough: 0.2, radiating_pain: 0.05, sweating: 0.03, breathless: 0.05 },
    why: 'Chest pain that is sharp, worse on pressing the spot or moving, without sweating or breathlessness, is often from the chest wall — but heart causes must be ruled out first.',
    self_care: ['Rest from heavy lifting; a warm compress may help — only once a doctor has ruled out the heart'],
    watch_for: ['Pain with exertion, sweating, breathlessness or spreading to the arm/jaw — call 112'],
    ask_doctor: ['Has an ECG ruled out a heart cause?'],
  },
  {
    id: 'gastritis', name: 'Acidity / gastritis (GERD)', name_hi: 'एसिडिटी / गैस्ट्राइटिस',
    prior: 0.1, season: () => 1, level: 'self_care', setting: 'home',
    cardinal: [['heartburn', 'abdominal_pain']],
    p: { heartburn: 0.9, abdominal_pain: 0.5, nausea: 0.35, chest_pain: 0.12 },
    why: 'Burning in the upper belly or chest after meals, sour burps and bloating point to acidity.',
    self_care: ['Smaller, earlier dinners; avoid lying down for 2 h after eating', 'Cut down on tea/coffee, spicy and fried food, alcohol and smoking', 'An antacid can relieve symptoms short-term'],
    watch_for: ['Pain spreading to arm/jaw, sweating (rule out the heart)', 'Black stools, vomiting blood, trouble swallowing, weight loss'],
    ask_doctor: ['Should I be tested for H. pylori?'],
  },
  {
    id: 'migraine', name: 'Migraine', name_hi: 'माइग्रेन',
    prior: 0.06, season: () => 1, level: 'self_care', setting: 'home',
    cardinal: [['headache']],
    p: { headache: 0.98, nausea: 0.55, vomiting: 0.25, photophobia: 0.6, dizziness: 0.2, fever: 0.03 },
    why: 'A throbbing headache with nausea or sensitivity to light is typical of migraine.',
    self_care: ['Rest in a dark, quiet room; hydrate', 'Paracetamol or ibuprofen early in the attack (if safe for you)', 'Track triggers: missed meals, poor sleep, screen time, stress'],
    watch_for: ['Sudden worst-ever headache', 'Headache with fever and stiff neck', 'Weakness, numbness, speech or vision changes'],
    ask_doctor: ['Would preventive treatment help if attacks are frequent?'],
  },
  {
    id: 'tension_headache', name: 'Tension-type headache', name_hi: 'तनाव वाला सिरदर्द',
    prior: 0.09, season: () => 1, level: 'self_care', setting: 'home',
    cardinal: [['headache']],
    p: { headache: 0.98, anxiety: 0.3, insomnia: 0.25, fatigue: 0.35, fever: 0.03 },
    why: 'A steady, band-like headache linked to stress, poor sleep or long screen time is usually tension-type.',
    self_care: ['Regular sleep, hydration and screen breaks (20-20-20 rule)', 'Neck and shoulder stretches; paracetamol if needed'],
    watch_for: ['Headache waking you from sleep or getting steadily worse', 'Any neurological symptoms'],
    ask_doctor: ['Could my eyesight or blood pressure be contributing?'],
  },
  {
    id: 'uti', name: 'Urinary tract infection', name_hi: 'मूत्र मार्ग संक्रमण (UTI)',
    prior: 0.05, season: summer, level: 'soon', setting: 'primary_care',
    cardinal: [['burning_urination', 'frequent_urination', 'blood_urine']],
    p: { burning_urination: 0.9, frequent_urination: 0.75, blood_urine: 0.2, abdominal_pain: 0.35, fever: 0.2, back_pain: 0.15 },
    why: 'Burning and frequent urination are the typical signs of a bladder infection.',
    tests: 'Urine routine & microscopy ± urine culture',
    self_care: ['Drink plenty of water', 'Do not take leftover antibiotics — a urine test guides the right one'],
    watch_for: ['Fever, chills, back or side pain, vomiting (kidney involvement)', 'Symptoms in pregnancy'],
    ask_doctor: ['Do I need a urine culture before antibiotics?'],
  },
  {
    id: 'anxiety', name: 'Anxiety / panic symptoms', name_hi: 'चिंता / घबराहट',
    prior: 0.06, season: () => 1, level: 'self_care', setting: 'teleconsult',
    cardinal: [['anxiety', 'palpitations']],
    p: { anxiety: 0.9, palpitations: 0.6, breathless: 0.35, dizziness: 0.35, insomnia: 0.45, chest_pain: 0.2, numbness: 0.25, sweating: 0.3, fatigue: 0.35 },
    why: 'Racing heart, breathlessness or dizziness together with worry or panic are common anxiety symptoms.',
    self_care: ['Slow breathing: in for 4, hold 4, out for 6, for 5 minutes', 'Limit caffeine; keep regular sleep and daily movement', 'Talk to someone you trust; Tele-MANAS 14416 is free and confidential'],
    watch_for: ['Chest pain with sweating or pain spreading to the arm (rule out the heart first)', 'Thoughts of self-harm'],
    ask_doctor: ['Could a thyroid problem or anaemia be contributing?'],
  },
  {
    id: 'asthma_flare', name: 'Asthma / wheezy bronchitis flare', name_hi: 'दमा / सांस की नली में सूजन',
    prior: 0.03, season: winterResp, level: 'urgent', setting: 'primary_care',
    cardinal: [['wheeze', 'breathless']],
    p: { wheeze: 0.85, breathless: 0.85, cough: 0.7, chest_pain: 0.25, anxiety: 0.2 },
    why: 'Wheezing, breathlessness and cough together suggest narrowed airways.',
    self_care: ['Use your prescribed reliever inhaler', 'Avoid smoke, dust and cold air; sit upright'],
    watch_for: ['Unable to speak full sentences, blue lips', 'Reliever not helping or needed every 4 h'],
    ask_doctor: ['Is my preventer inhaler technique and dose right?'],
  },
  {
    id: 'allergic_rhinitis', name: 'Allergic rhinitis (allergy)', name_hi: 'एलर्जी (एलर्जिक राइनाइटिस)',
    prior: 0.07, season: (m) => (m >= 1 && m <= 3) || m === 9 || m === 10 ? 1.6 : 0.9, level: 'self_care', setting: 'home',
    cardinal: [['sneezing', 'runny_nose', 'itching', 'eye_redness']],
    p: { sneezing: 0.85, runny_nose: 0.85, itching: 0.55, eye_redness: 0.4, cough: 0.25, fever: 0.02, body_ache: 0.03 },
    why: 'Repeated sneezing, a runny nose and itchy eyes without fever point to an allergy.',
    self_care: ['Avoid triggers: dust, pollen, smoke, pets; wash bedding weekly', 'A non-drowsy antihistamine (e.g. cetirizine) can help', 'Saline nasal rinse'],
    watch_for: ['Wheezing or breathlessness', 'Fever or thick discoloured discharge for over 10 days'],
    ask_doctor: ['Would a nasal steroid spray help me?'],
  },
  {
    id: 'heat_illness', name: 'Heat exhaustion / dehydration', name_hi: 'लू / पानी की कमी',
    prior: 0.04, season: summer, level: 'self_care', setting: 'home',
    cardinal: [['heat_exposure', 'thirst', 'dry_mouth', 'dizziness']],
    p: { heat_exposure: 0.8, dizziness: 0.6, fatigue: 0.65, thirst: 0.6, headache: 0.55, nausea: 0.4, sweating: 0.45, dry_mouth: 0.4, fainting: 0.1 },
    why: 'Dizziness, headache, thirst and tiredness after heat exposure suggest heat exhaustion or dehydration.',
    self_care: ['Move to a cool place, loosen clothing, sip ORS or lemon-salt-sugar water', 'Cool with wet cloths and fanning', 'Avoid outdoor work 12–3 pm; wear light, loose cotton and a cap'],
    watch_for: ['Confusion, fainting, no sweating with hot skin (heatstroke — call 108)', 'Vomiting that stops you drinking'],
    ask_doctor: ['Do any of my regular medicines raise heat risk?'],
  },
  {
    id: 'back_strain', name: 'Muscular back strain', name_hi: 'कमर में मांसपेशी खिंचाव',
    prior: 0.06, season: () => 1, level: 'self_care', setting: 'home',
    cardinal: [['back_pain']],
    p: { back_pain: 0.98, body_ache: 0.2, fever: 0.03, numbness: 0.08 },
    why: 'Back pain without fever, numbness or bladder problems is most often a muscle strain.',
    self_care: ['Keep gently active; avoid bed rest', 'Warm compress; paracetamol or a topical gel', 'Check desk and sleeping posture'],
    watch_for: ['Numbness in the groin, loss of bladder/bowel control (emergency)', 'Leg weakness, fever, or pain after an injury'],
    ask_doctor: ['Would physiotherapy help?'],
  },
  {
    id: 'conjunctivitis', name: 'Conjunctivitis (eye flu)', name_hi: 'आँख आना (कंजंक्टिवाइटिस)',
    prior: 0.04, season: monsoon, level: 'self_care', setting: 'teleconsult',
    cardinal: [['eye_redness']],
    p: { eye_redness: 0.97, itching: 0.4, runny_nose: 0.2, fever: 0.1 },
    why: 'Red, watery or sticky eyes, often spreading from one eye to the other, are typical of "eye flu".',
    self_care: ['Wash hands often; do not share towels', 'Clean the eyes with boiled-and-cooled water', 'Avoid steroid eye drops unless prescribed'],
    watch_for: ['Eye pain, blurred vision, light sensitivity', 'No improvement in 5–7 days'],
    ask_doctor: ['Do I need antibiotic drops or is this viral?'],
  },
  {
    id: 'tb', name: 'Tuberculosis (needs testing)', name_hi: 'टीबी (जाँच ज़रूरी)',
    prior: 0.02, season: () => 1, level: 'soon', setting: 'primary_care',
    cardinal: [['cough']],
    p: { cough: 0.95, weight_loss: 0.55, night_sweats: 0.5, fever: 0.55, fatigue: 0.6, cough_blood: 0.2, phlegm: 0.6, runny_nose: 0.05, sneezing: 0.03 },
    duration: (d) => (d == null ? 0.5 : d >= 14 ? 5 : d >= 7 ? 0.8 : 0.15),
    why: 'A cough lasting 2 weeks or more, especially with weight loss, night sweats or evening fevers, must be tested for TB.',
    tests: 'Sputum NAAT (CBNAAT/TrueNat) and chest X-ray — free under NTEP',
    self_care: ['Cover your mouth when coughing; keep rooms ventilated', 'TB is curable with free treatment and Ni-kshay Poshan nutrition support'],
    watch_for: ['Coughing blood', 'Breathlessness or chest pain'],
    ask_doctor: ['Can I get a sputum NAAT test today?'],
  },
  {
    id: 'depression', name: 'Low mood / depression', name_hi: 'उदासी / अवसाद',
    prior: 0.04, season: () => 1, level: 'soon', setting: 'teleconsult',
    cardinal: [['low_mood']],
    p: { low_mood: 0.95, insomnia: 0.55, fatigue: 0.6, anxiety: 0.4, weight_loss: 0.15 },
    why: 'Feeling low with poor sleep and low energy for weeks can be depression — common and treatable.',
    self_care: ['Keep a simple routine: sleep, meals, a daily walk in daylight', 'Reach out to someone you trust', 'Tele-MANAS 14416 — free, confidential counselling'],
    watch_for: ['Thoughts of self-harm — call 14416 or 112 immediately'],
    ask_doctor: ['Would talking therapy or medication help me?'],
  },
  {
    id: 'otitis', name: 'Ear infection', name_hi: 'कान का संक्रमण',
    prior: 0.03, season: winterResp, level: 'soon', setting: 'primary_care',
    cardinal: [['ear_pain']],
    p: { ear_pain: 0.97, fever: 0.4, runny_nose: 0.35, headache: 0.2 },
    why: 'Ear pain, often after a cold, with or without fever suggests a middle-ear infection.',
    self_care: ['Paracetamol for pain; warm compress', 'Do not put oil or objects in the ear'],
    watch_for: ['Discharge from the ear, swelling behind the ear', 'High fever, severe headache'],
    ask_doctor: ['Does my eardrum look infected?'],
  },
  {
    id: 'dental', name: 'Dental problem', name_hi: 'दाँत की समस्या',
    prior: 0.03, season: () => 1, level: 'soon', setting: 'primary_care',
    cardinal: [['toothache']],
    p: { toothache: 0.98, fever: 0.15, swelling_face: 0.1, headache: 0.15 },
    why: 'Tooth pain usually comes from decay or a gum infection and needs a dentist.',
    self_care: ['Warm salt-water rinses; paracetamol for pain', 'Avoid very hot, cold or sweet foods'],
    watch_for: ['Facial swelling, fever, trouble swallowing or opening the mouth'],
    ask_doctor: ['Is this decay, a gum infection, or an abscess?'],
  },
  {
    id: 'skin_allergy', name: 'Skin allergy / hives', name_hi: 'त्वचा की एलर्जी / पित्ती',
    prior: 0.04, season: () => 1, level: 'self_care', setting: 'teleconsult',
    cardinal: [['rash', 'itching']],
    p: { rash: 0.85, itching: 0.85, swelling_face: 0.08, fever: 0.05 },
    why: 'An itchy, raised rash that comes and goes is often an allergic reaction (hives).',
    self_care: ['Avoid new soaps, foods or medicines that may be the trigger', 'Cool compresses; a non-drowsy antihistamine can help'],
    watch_for: ['Swelling of lips, face or throat, or breathing trouble (call 112)', 'Rash with fever or blisters'],
    ask_doctor: ['Could a medicine I am taking cause this?'],
  },
  {
    id: 'vertigo', name: 'Inner-ear vertigo (BPPV)', name_hi: 'चक्कर (वर्टिगो)',
    prior: 0.03, season: () => 1, level: 'self_care', setting: 'teleconsult',
    cardinal: [['dizziness']],
    p: { dizziness: 0.95, nausea: 0.5, vomiting: 0.2, balance_loss: 0.15, headache: 0.1 },
    why: 'Short spells of spinning when turning the head or lying down are typical of inner-ear vertigo.',
    self_care: ['Move slowly when getting up; sit if dizzy', 'Hydrate; avoid driving during spells'],
    watch_for: ['Dizziness with slurred speech, weakness, double vision or a severe headache (call 112)'],
    ask_doctor: ['Could the Epley manoeuvre help me?'],
  },
];

const BACKGROUND = 0.06; // P(symptom) among all presentations
const LEAK = 0.02; // P(symptom | condition) for symptoms not listed

/**
 * Rank conditions for the given findings. Returns probabilities normalised over
 * the conditions that explain at least one finding.
 */
export function rankConditions({ symptoms = [], duration_days = null, month = new Date().getMonth(), vitals = {}, stressHigh = false } = {}) {
  const s = new Set(symptoms);
  if (!s.size) return [];
  const scored = [];
  for (const c of CONDITIONS) {
    const explained = [...s].filter((id) => c.p[id] != null);
    if (!explained.length) continue;
    let logp = Math.log(c.prior * c.season(month));
    for (const id of s) logp += Math.log((c.p[id] ?? LEAK) / BACKGROUND);
    for (const group of c.cardinal || []) if (!group.some((id) => s.has(id))) logp += Math.log(0.08);
    if (c.duration) logp += Math.log(c.duration(duration_days));
    if (vitals.rr != null && vitals.rr >= 22 && ['pneumonia', 'asthma_flare'].includes(c.id)) logp += Math.log(1.6);
    if (stressHigh && c.id === 'anxiety') logp += Math.log(1.3);
    scored.push({ c, logp, explained });
  }
  if (!scored.length) return [];
  const max = Math.max(...scored.map((x) => x.logp));
  const z = scored.reduce((acc, x) => acc + Math.exp(x.logp - max), 0);
  return scored
    .map((x) => ({ ...x.c, prob: Math.exp(x.logp - max) / z, explained: x.explained }))
    .sort((a, b) => b.prob - a.prob);
}
