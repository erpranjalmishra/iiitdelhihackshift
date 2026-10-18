import { h, icon, toast, mount } from '../lib/ui.mjs';
import { api } from '../lib/api.mjs';
import { t, getLang, setLang } from '../lib/i18n.mjs';

export async function render({ app }) {
  const lang = getLang();
  const consent = h('input', { type: 'checkbox', id: 'consent' });
  const err = h('div', { class: 'notice warn hide', role: 'alert' });
  const need = () => {
    if (consent.checked) return true;
    mount(err, icon('info', 18), lang === 'hi' ? 'आगे बढ़ने के लिए कृपया ऊपर की बात स्वीकार करें।' : 'Please tick the acknowledgement above to continue.');
    err.classList.remove('hide');
    return false;
  };

  const feature = (ic, title, text) => h('div', { class: 'feature' }, h('div', { class: 'ico' }, icon(ic, 20)), h('div', null, h('h3', null, title), h('p', { class: 'small ink-2' }, text)));

  const name = h('input', { class: 'input', placeholder: lang === 'hi' ? 'आपका नाम' : 'Your first name', maxlength: 60 });
  const age = h('input', { class: 'input', type: 'number', min: 0, max: 120, placeholder: '34' });
  const sex = h('select', { class: 'select' }, h('option', { value: '' }, '—'), h('option', { value: 'female' }, lang === 'hi' ? 'महिला' : 'Female'), h('option', { value: 'male' }, lang === 'hi' ? 'पुरुष' : 'Male'), h('option', { value: 'other' }, lang === 'hi' ? 'अन्य' : 'Other'));
  const conditions = h('input', { class: 'input', placeholder: lang === 'hi' ? 'जैसे: डायबिटीज़, BP (कॉमा से अलग)' : 'e.g. diabetes, high BP, asthma (comma separated)' });
  const allergies = h('input', { class: 'input', placeholder: lang === 'hi' ? 'जैसे: पेनिसिलिन' : 'e.g. penicillin' });
  const pregnant = h('input', { type: 'checkbox' });
  const split = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

  const demoBtn = h('button', { class: 'btn primary lg', type: 'button', onclick: async () => {
    if (!need()) return;
    demoBtn.disabled = true;
    demoBtn.textContent = 'Loading demo…';
    try {
      await api('/api/demo/seed', { method: 'POST' });
      await app.refreshProfile();
      if (lang !== 'en') await api('/api/profile', { method: 'PUT', body: { ...app.profile, language: lang } });
      toast(lang === 'hi' ? 'डेमो डेटा लोड हुआ' : 'Demo loaded: 30 days of history for "Aarav".');
      app.go('');
    } catch (e) { toast(e.message, { bad: true }); demoBtn.disabled = false; }
  } }, icon('sparkle', 18), lang === 'hi' ? 'डेमो डेटा के साथ देखें' : 'Explore with demo data');

  const form = h('form', { class: 'stack hide', onsubmit: async (e) => {
    e.preventDefault();
    if (!need()) return;
    try {
      await api('/api/profile', { method: 'PUT', body: { name: name.value, age: age.value, sex: sex.value, conditions: split(conditions.value), allergies: split(allergies.value), pregnant: pregnant.checked, language: getLang() } });
      await app.refreshProfile();
      app.go('scan');
    } catch (e2) { toast(e2.message, { bad: true }); }
  } },
    h('div', { class: 'grid-2' },
      h('label', { class: 'field' }, h('span', null, lang === 'hi' ? 'नाम' : 'Name'), name),
      h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', null, lang === 'hi' ? 'उम्र' : 'Age'), age), h('label', { class: 'field' }, h('span', null, lang === 'hi' ? 'लिंग' : 'Sex'), sex))),
    h('label', { class: 'field' }, h('span', null, lang === 'hi' ? 'पुरानी बीमारियाँ' : 'Long-term conditions'), conditions),
    h('label', { class: 'field' }, h('span', null, lang === 'hi' ? 'एलर्जी' : 'Allergies'), allergies),
    h('label', { class: 'check' }, pregnant, lang === 'hi' ? 'मैं गर्भवती हूँ' : 'I am pregnant'),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, lang === 'hi' ? 'शुरू करें' : 'Start — first scan', icon('chevron', 18))),
  );

  return h('div', { class: 'welcome' }, h('div', { class: 'card stack-lg' },
    h('div', { class: 'row between' },
      h('div', { class: 'row' }, h('span', { style: { color: 'var(--brand)', display: 'inline-flex' } }, icon('logo', 44)), h('div', null, h('h1', null, 'Nadi'), h('div', { class: 'muted' }, t('tagline')))),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Language' },
        h('button', { type: 'button', 'aria-pressed': String(lang === 'en'), onclick: () => { setLang('en'); app.rerender(); } }, 'English'),
        h('button', { type: 'button', 'aria-pressed': String(lang === 'hi'), onclick: () => { setLang('hi'); app.rerender(); } }, 'हिंदी'))),
    h('p', { style: { fontSize: '17px' } }, lang === 'hi'
      ? 'आपका फ़ोन कैमरा ही सेंसर है। 60 सेकंड में हृदय गति, सांस की दर और तनाव — बिना किसी डिवाइस के। फिर AI आपके लक्षणों का सुरक्षित आकलन करता है।'
      : 'Your phone camera is the sensor. In 60 seconds Nadi reads heart rate, breathing rate, HRV and stress — no wearable, no lab. Then AI triage, guarded by clinical safety rules, tells you what to do next.'),
    h('div', { class: 'grid-2' },
      feature('scan', lang === 'hi' ? 'बिना छुए वाइटल्स' : 'Contactless vitals', lang === 'hi' ? 'कैमरा त्वचा के रंग में सूक्ष्म बदलाव से नाड़ी पढ़ता है (rPPG)। वीडियो डिवाइस से बाहर नहीं जाता।' : 'Remote photoplethysmography reads your pulse from invisible skin-colour changes. Video never leaves your device.'),
      feature('shield', lang === 'hi' ? 'सुरक्षा-नियमों वाला AI' : 'AI triage with guardrails', lang === 'hi' ? '38 क्लिनिकल नियम AI के फ़ैसले को केवल बढ़ा सकते हैं, घटा नहीं सकते।' : '38 cited clinical red-flag rules run beside the AI and can only escalate its verdict — never soften it.'),
      feature('twin', lang === 'hi' ? 'बेसलाइन ट्विन' : 'Baseline Twin', lang === 'hi' ? 'आपकी तुलना आपके अपने सामान्य से — बीमारी के लक्षणों से पहले बदलाव पकड़ें।' : 'Compares you with YOUR normal, so it can notice change before you feel ill.'),
      feature('doctor', lang === 'hi' ? 'डॉक्टर हैंडऑफ़' : 'Doctor handoff', lang === 'hi' ? 'QR से डॉक्टर को SOAP नोट और ट्रेंड — 24 घंटे में लिंक खत्म।' : 'A SOAP note, trends and your pulse waveform behind an expiring QR link.')),
    h('label', { class: 'check inset', style: { alignItems: 'flex-start' } }, consent, h('span', { class: 'small' }, t('not_diagnosis'))),
    err,
    h('div', { class: 'row' }, demoBtn,
      h('button', { class: 'btn lg', type: 'button', onclick: () => { form.classList.remove('hide'); name.focus(); } }, icon('user', 18), lang === 'hi' ? 'अपनी प्रोफ़ाइल बनाएँ' : 'Set up my profile')),
    form,
    h('p', { class: 'disclaimer' }, t('privacy_line')),
  ));
}
