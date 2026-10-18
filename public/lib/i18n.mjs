// English / हिंदी strings for the interface chrome. AI answers follow the chosen language server-side.
const S = {
  tagline: ['Nadi Pariksha, reimagined', 'नाड़ी परीक्षा, नए रूप में'],
  nav_home: ['Home', 'होम'], nav_scan: ['Scan', 'स्कैन'], nav_check: ['Check', 'जाँच'], nav_twin: ['Twin', 'ट्विन'],
  nav_meds: ['Meds', 'दवाएँ'], nav_share: ['Doctor', 'डॉक्टर'], nav_settings: ['Settings', 'सेटिंग्स'],
  greeting_m: ['Good morning', 'सुप्रभात'], greeting_a: ['Good afternoon', 'नमस्कार'], greeting_e: ['Good evening', 'शुभ संध्या'],
  start_scan: ['Start 60-second scan', '60 सेकंड स्कैन शुरू करें'], check_symptoms: ['Check symptoms', 'लक्षण जाँचें'],
  share_doctor: ['Share with a doctor', 'डॉक्टर से साझा करें'], resting_hr: ['Resting heart rate', 'आराम की हृदय गति'],
  hrv: ['HRV (RMSSD)', 'HRV (RMSSD)'], breathing: ['Breathing rate', 'सांस की दर'], stress: ['Stress index', 'तनाव सूचकांक'],
  temperature: ['Temperature', 'तापमान'], no_scan_yet: ['No scan yet', 'अभी कोई स्कैन नहीं'],
  todays_meds: ["Today's medicines", 'आज की दवाएँ'], last_check: ['Last symptom check', 'पिछली जाँच'],
  explain_trends: ['Explain my trends', 'मेरे ट्रेंड समझाएँ'], ai_insight: ['AI insight', 'AI विश्लेषण'],
  sev_self_care: ['Self-care', 'घर पर देखभाल'], sev_soon: ['See a doctor soon', 'जल्द डॉक्टर को दिखाएँ'],
  sev_urgent: ['Urgent — today', 'आज ही — ज़रूरी'], sev_emergency: ['Emergency', 'आपातकाल'],
  sev_self_care_d: ['Manage at home and monitor', 'घर पर देखभाल करें और नज़र रखें'], sev_soon_d: ['Within 24–72 hours', '24–72 घंटों में'],
  sev_urgent_d: ['Today, within a few hours', 'आज, कुछ घंटों में'], sev_emergency_d: ['Call 112 / 108 now', 'अभी 112 / 108 पर कॉल करें'],
  scan_title: ['Contactless vitals scan', 'बिना छुए वाइटल्स स्कैन'],
  scan_sub: ['Your camera reads your pulse from tiny colour changes in your skin. Video never leaves this device.', 'कैमरा आपकी त्वचा के रंग में सूक्ष्म बदलाव से नाड़ी पढ़ता है। वीडियो इस डिवाइस से बाहर नहीं जाता।'],
  align_face: ['Fit your face inside the oval', 'चेहरे को अंडाकार के अंदर रखें'], hold_still: ['Hold still and breathe normally', 'स्थिर रहें और सामान्य सांस लें'],
  too_dark: ['Too dark — face a window or lamp', 'बहुत अंधेरा — खिड़की या लैंप की ओर मुँह करें'],
  too_bright: ['Too bright — avoid direct light on your face', 'बहुत तेज़ रोशनी — सीधी रोशनी से बचें'],
  moving: ['Movement detected — keep your head still', 'हलचल — सिर स्थिर रखें'], no_face: ['Face not detected — move into the oval', 'चेहरा नहीं दिखा — अंडाकार में आएँ'],
  measuring: ['Measuring…', 'माप रहे हैं…'], voice_title: ['Voice check (optional)', 'आवाज़ जाँच (वैकल्पिक)'],
  voice_sub: ['Take a breath and say a steady "aaaah" for as long as is comfortable.', 'सांस लें और जितनी देर आराम से हो, एक समान "आआआ" बोलें।'],
  save: ['Save', 'सहेजें'], cancel: ['Cancel', 'रद्द करें'], retry: ['Try again', 'फिर से'], skip: ['Skip', 'छोड़ें'], done: ['Done', 'हो गया'],
  describe: ['Describe what you are feeling — in English, Hindi or Hinglish', 'आप कैसा महसूस कर रहे हैं — हिंदी, अंग्रेज़ी या हिंग्लिश में लिखें'],
  assess: ['Assess my symptoms', 'मेरे लक्षणों का आकलन करें'], new_check: ['New check', 'नई जाँच'],
  why_title: ['Why Nadi said this', 'Nadi ने यह क्यों कहा'], possible: ['Possible explanations', 'संभावित कारण'],
  what_now: ['What to do now', 'अब क्या करें'], self_care: ['Self-care', 'घरेलू देखभाल'], watch_for: ['Get help sooner if', 'तुरंत मदद लें अगर'],
  questions_doc: ['Questions for your doctor', 'डॉक्टर से पूछें'], refine: ['Answer to refine', 'उत्तर देकर बेहतर करें'],
  not_diagnosis: ['Nadi is a triage and wellness aid, not a diagnosis or a medical device. In an emergency call 112 or 108.', 'Nadi एक सहायक उपकरण है, निदान या चिकित्सा उपकरण नहीं। आपात स्थिति में 112 या 108 पर कॉल करें।'],
  twin_title: ['Your Baseline Twin', 'आपका बेसलाइन ट्विन'], twin_sub: ['Your vitals compared with YOUR normal — not population averages.', 'आपके वाइटल्स की तुलना आपके अपने सामान्य से — औसत से नहीं।'],
  meds_title: ['Medicines', 'दवाएँ'], add_med: ['Add medicine', 'दवा जोड़ें'], taken: ['Taken', 'ली गई'], mark: ['Mark taken', 'ली गई चिह्नित करें'],
  share_title: ['Share with your doctor', 'डॉक्टर से साझा करें'], create_link: ['Create doctor link', 'डॉक्टर लिंक बनाएँ'],
  settings_title: ['Settings', 'सेटिंग्स'], profile: ['Profile', 'प्रोफ़ाइल'], language: ['Language', 'भाषा'],
  offline: ["You're offline — readings will sync when the connection returns.", 'आप ऑफ़लाइन हैं — कनेक्शन लौटने पर डेटा सिंक होगा।'],
  privacy_line: ['Video & audio are processed on this device and never uploaded.', 'वीडियो और ऑडियो इसी डिवाइस पर प्रोसेस होते हैं, अपलोड नहीं होते।'],
};

let lang = 'en';
try { lang = localStorage.getItem('nadi.lang') || 'en'; } catch { /* storage unavailable */ }

export const getLang = () => lang;
export function setLang(l) {
  lang = l === 'hi' ? 'hi' : 'en';
  try { localStorage.setItem('nadi.lang', lang); } catch { /* ignore */ }
  document.documentElement.lang = lang === 'hi' ? 'hi' : 'en';
}
export function t(key) {
  const pair = S[key];
  if (!pair) return key;
  return pair[lang === 'hi' ? 1 : 0] || pair[0];
}
export const sevLabel = (s) => t(`sev_${s}`);
export const sevDesc = (s) => t(`sev_${s}_d`);
