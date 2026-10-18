import { h, icon, toast, confirmDialog, dateTimeLabel, timeAgo, mount } from '../lib/ui.mjs';
import { api } from '../lib/api.mjs';
import { t, getLang } from '../lib/i18n.mjs';

export async function render({ app }) {
  const lang = getLang();
  const L = (en, hi) => (lang === 'hi' ? hi : en);
  const local = !!(app.session && app.session.local);
  const [profileRes, meta, ai] = await Promise.all([api('/api/profile'), app.meta ? Promise.resolve(app.meta) : api('/api/meta'), api('/api/ai/status')]);
  app.meta = meta;
  const p = profileRes.profile || {};
  const page = h('div', { class: 'page' });

  /* ---------- profile ---------- */
  const f = {
    name: h('input', { class: 'input', value: p.name || '', maxlength: 60 }),
    age: h('input', { class: 'input', type: 'number', min: 0, max: 120, value: p.age ?? '' }),
    sex: h('select', { class: 'select' }, ['', 'female', 'male', 'other'].map((s) => h('option', { value: s, selected: p.sex === s }, s ? s[0].toUpperCase() + s.slice(1) : '—'))),
    conditions: h('input', { class: 'input', value: (p.conditions || []).join(', ') }),
    allergies: h('input', { class: 'input', value: (p.allergies || []).join(', ') }),
    city: h('input', { class: 'input', value: p.city || '', maxlength: 60 }),
    contact: h('input', { class: 'input', value: p.emergency_contact || '', maxlength: 80 }),
    pregnant: h('input', { type: 'checkbox', checked: !!p.pregnant }),
  };
  const split = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const profileCard = h('form', { class: 'card stack', onsubmit: async (e) => {
    e.preventDefault();
    try {
      await api('/api/profile', { method: 'PUT', body: { name: f.name.value, age: f.age.value, sex: f.sex.value, conditions: split(f.conditions.value), allergies: split(f.allergies.value), city: f.city.value, emergency_contact: f.contact.value, pregnant: f.pregnant.checked, language: lang } });
      await app.refreshProfile();
      toast(L('Profile saved', 'प्रोफ़ाइल सहेजी गई'));
    } catch (err) { toast(err.message, { bad: true }); }
  } },
    h('h2', null, t('profile')),
    h('div', { class: 'grid-3' }, h('label', { class: 'field' }, h('span', null, L('Name', 'नाम')), f.name), h('label', { class: 'field' }, h('span', null, L('Age', 'उम्र')), f.age), h('label', { class: 'field' }, h('span', null, L('Sex', 'लिंग')), f.sex)),
    h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', null, L('Long-term conditions (comma separated)', 'पुरानी बीमारियाँ')), f.conditions), h('label', { class: 'field' }, h('span', null, L('Allergies', 'एलर्जी')), f.allergies)),
    h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', null, L('City', 'शहर')), f.city), h('label', { class: 'field' }, h('span', null, L('Emergency contact', 'आपातकालीन संपर्क')), f.contact)),
    h('label', { class: 'check' }, f.pregnant, L('Currently pregnant', 'गर्भवती')),
    h('div', null, h('button', { class: 'btn primary', type: 'submit' }, t('save'))));

  /* ---------- AI engine ---------- */
  const aiStatus = h('div', { class: 'stack' });
  const drawAi = (s) => {
    const on = s.provider === 'gemini';
    mount(aiStatus, 
      h('div', { class: 'row' }, h('span', { class: ['dot', on ? 'on' : 'warn'] }), h('strong', null, on ? `Google Gemini${s.model ? ' · ' + s.model : ' (model picked on first use)'}` : L('Offline clinical engine', 'ऑफ़लाइन क्लिनिकल इंजन')),
        s.key ? h('span', { class: 'tag' }, `key ${s.key}`) : null, on && s.surface ? h('span', { class: 'tag' }, s.surface === 'interactions' ? 'Interactions API' : 'generateContent') : null),
      s.last_error ? h('div', { class: 'notice warn small' }, icon('alert', 16), `${s.last_error.message} (${s.last_error.kind}${s.last_error.status ? ' ' + s.last_error.status : ''})`) : null,
      h('p', { class: 'muted small' }, on
        ? L('Triage, trend insights and doctor notes use Gemini with schema-constrained JSON. Requests are sent with store=false. If Gemini fails (quota, network, bad output) the offline engine answers and says so. Safety guardrails always run locally.', 'Gemini से उत्तर; विफल होने पर ऑफ़लाइन इंजन।')
        : L('Everything works offline with the built-in clinical engine (knowledge base + guardrails). Add a free Gemini API key for richer, conversational reasoning in English and Hindi.', 'ऑफ़लाइन इंजन से सब काम करता है। बेहतर उत्तरों के लिए Gemini कुंजी जोड़ें।')));
  };
  drawAi(ai);
  const keyInput = h('input', { class: 'input', type: 'password', placeholder: 'AIza…', autocomplete: 'off', spellcheck: 'false' });
  const testBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
    testBtn.disabled = true;
    try {
      const r = await api('/api/ai/test', { method: 'POST' });
      if (r.ok) toast(`Gemini OK · ${r.model} · ${(r.latencyMs / 1000).toFixed(1)} s · “${r.says}”`);
      else toast(r.error ? r.error.message : 'Test failed', { bad: true });
      drawAi(r.status); app.refreshAi();
    } catch (e) { toast(e.message, { bad: true }); }
    testBtn.disabled = false;
  } }, icon('refresh', 16), L('Test connection', 'कनेक्शन जाँचें'));
  const aiCard = h('div', { class: 'card stack' }, h('h2', { class: 'row', style: { gap: '8px' } }, icon('sparkle', 20), L('AI engine', 'AI इंजन')), aiStatus,
    local ? h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      try {
        const r = await api('/api/ai/key', { method: 'POST', body: { key: keyInput.value.trim() } });
        keyInput.value = '';
        drawAi(r.status); app.refreshAi();
        toast(r.test && r.test.ok ? `Gemini connected · ${r.test.model}` : r.test && r.test.error ? `Saved, but: ${r.test.error.message}` : L('Key removed — offline engine active.', 'कुंजी हटाई गई।'), { bad: !!(r.test && r.test.error) });
      } catch (err) { toast(err.message, { bad: true }); }
    } },
      h('label', { class: 'field' }, h('span', null, L('Gemini API key', 'Gemini API कुंजी')), keyInput),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, L('Save & test key', 'सहेजें और जाँचें')), testBtn,
        h('a', { class: 'btn ghost', href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener noreferrer' }, icon('link', 16), L('Get a free key', 'मुफ़्त कुंजी पाएँ'))),
      h('p', { class: 'muted tiny' }, L('Stored only in the .env file on this computer (git-ignored). Leave empty and save to remove.', 'केवल इस कंप्यूटर की .env फ़ाइल में।')))
      : h('div', { class: 'row' }, testBtn, h('span', { class: 'muted small' }, L('The key can only be changed on the computer running Nadi.', 'कुंजी केवल मुख्य कंप्यूटर पर बदली जा सकती है।'))));

  /* ---------- phone pairing ---------- */
  const pairHost = h('div', { class: 'stack' });
  const devicesHost = h('div');
  const loadDevices = async () => {
    if (!local) return;
    const r = await api('/api/devices').catch(() => ({ devices: [] }));
    mount(devicesHost, r.devices.length ? h('div', { class: 'stack' }, h('strong', { class: 'small' }, L('Paired devices', 'जुड़े डिवाइस')),
      r.devices.map((d) => h('div', { class: 'dose' }, h('div', null, h('div', null, d.name), h('div', { class: 'muted tiny' }, `${L('paired', 'जोड़ा')} ${timeAgo(d.created_at, lang)} · ${L('last seen', 'अंतिम बार')} ${timeAgo(d.last_seen, lang)}`)),
        h('button', { class: 'btn ghost sm danger', type: 'button', onclick: async () => { await api(`/api/devices/${d.id}`, { method: 'DELETE' }); toast(L('Device removed', 'डिवाइस हटाया')); loadDevices(); } }, L('Remove', 'हटाएँ'))))) : null);
  };
  const pairCard = h('div', { class: 'card stack' }, h('h2', { class: 'row', style: { gap: '8px' } }, icon('link', 20), L('Use on your phone', 'फ़ोन पर उपयोग करें')),
    h('p', { class: 'muted small' }, L('Your data lives on this computer. Pair your phone to scan with its camera — other devices on the Wi-Fi cannot see anything unless paired.', 'डेटा इसी कंप्यूटर पर रहता है। फ़ोन को जोड़कर उसके कैमरे से स्कैन करें।')),
    local ? h('div', null, h('button', { class: 'btn', type: 'button', onclick: async () => {
      try {
        const r = await api('/api/pair/start', { method: 'POST' });
        mount(pairHost, h('div', { class: 'grid-2', style: { alignItems: 'center' } },
          h('div', { class: 'qr', html: r.qr_svg }),
          h('div', { class: 'stack' }, h('strong', null, L('Scan with your phone camera (valid 10 minutes, one use)', 'फ़ोन कैमरे से स्कैन करें (10 मिनट)')), h('div', { class: 'inset mono', style: { wordBreak: 'break-all' } }, r.url),
            !r.https ? h('div', { class: 'notice warn small' }, icon('lock', 16), L('Phone cameras need HTTPS. Stop Nadi, run "npm run certs", start again, then pair — the QR will use https://.', 'फ़ोन कैमरे को HTTPS चाहिए: "npm run certs" चलाएँ।')) : null)));
        loadDevices();
      } catch (e) { toast(e.message, { bad: true }); }
    } }, icon('share', 16), L('Show pairing QR', 'पेयरिंग QR दिखाएँ'))) : h('p', { class: 'small' }, L('This device is paired.', 'यह डिवाइस जुड़ा है।')),
    pairHost, devicesHost);

  /* ---------- appearance ---------- */
  const themeSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Theme' }, ['system', 'light', 'dark'].map((th) =>
    h('button', { type: 'button', 'aria-pressed': String(app.getTheme() === th), onclick: () => { app.applyTheme(th); app.rerender(); } }, th === 'system' ? L('Auto', 'ऑटो') : th === 'light' ? L('Light', 'लाइट') : L('Dark', 'डार्क'))));
  const prefs = h('div', { class: 'card stack' }, h('h2', null, L('Appearance', 'दिखावट')), h('div', { class: 'row' }, h('span', { class: 'small', style: { minWidth: '90px' } }, t('language')), h('span', { class: 'muted small' }, L('Use the EN / हिं switch in the menu.', 'मेनू में EN / हिं स्विच।'))), h('div', { class: 'row' }, h('span', { class: 'small', style: { minWidth: '90px' } }, L('Theme', 'थीम')), themeSeg));

  /* ---------- safety transparency ---------- */
  const lvl = { emergency: L('Emergency', 'आपातकाल'), urgent: L('Urgent', 'ज़रूरी'), soon: L('Soon', 'जल्द') };
  const rules = h('details', { class: 'card' }, h('summary', { style: { cursor: 'pointer', fontWeight: 650 } }, L(`Safety guardrails: ${meta.guard.rules} rules (${meta.guard.emergency} emergency · ${meta.guard.urgent} urgent · ${meta.guard.soon} see-soon) — ${meta.guard.version}`, `सुरक्षा नियम: ${meta.guard.rules}`)),
    h('p', { class: 'muted small', style: { margin: '10px 0' } }, L('These deterministic rules run on every symptom check, independently of the AI. The final verdict is the more cautious of the two; rules can never lower it.', 'ये नियम हर जाँच पर AI से अलग चलते हैं।')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', null, h('tr', null, h('th', null, 'ID'), h('th', null, L('Level', 'स्तर')), h('th', null, L('Rule', 'नियम')), h('th', null, L('Source', 'स्रोत')))),
      h('tbody', null, meta.rules.map((r) => h('tr', null, h('td', { class: 'mono' }, r.id), h('td', null, h('span', { class: `sev ${r.level}` }, h('span', { class: 'swatch' }), lvl[r.level])), h('td', null, r.title), h('td', { class: 'muted' }, r.source)))))));

  /* ---------- data & privacy ---------- */
  const auditHost = h('div');
  const dataCard = h('div', { class: 'card stack' }, h('h2', { class: 'row', style: { gap: '8px' } }, icon('lock', 20), L('Your data', 'आपका डेटा')),
    h('ul', { class: 'clean small' },
      h('li', null, L('Camera video and microphone audio are processed in your browser and never uploaded — only the resulting numbers are saved.', 'वीडियो/ऑडियो ब्राउज़र में प्रोसेस होते हैं, अपलोड नहीं।')),
      h('li', null, L(`Readings, checks and medicines are stored in a SQLite file on the computer running Nadi (${profileRes.counts.readings} readings, ${profileRes.counts.episodes} checks, ${profileRes.counts.meds} medicines).`, `डेटा इसी कंप्यूटर की SQLite फ़ाइल में।`)),
      h('li', null, L('With a Gemini key, the text of a symptom check (not video/audio) is sent to Google to generate the answer, with store=false.', 'Gemini कुंजी होने पर केवल लक्षण का पाठ Google को जाता है।')),
      h('li', null, L('Doctor links are read-only snapshots that expire and can be revoked; every view is logged.', 'डॉक्टर लिंक समय-सीमित हैं और रद्द किए जा सकते हैं।'))),
    h('div', { class: 'row' },
      h('a', { class: 'btn', href: '/api/export', download: '' }, icon('download', 16), L('Export all my data (JSON)', 'सारा डेटा निर्यात करें')),
      h('button', { class: 'btn', type: 'button', onclick: async () => {
        if (!(await confirmDialog(L('Replace your current data with the demo dataset?', 'डेमो डेटा से बदलें?')))) return;
        await api('/api/demo/seed', { method: 'POST' }); await app.refreshProfile(); toast(L('Demo data loaded', 'डेमो डेटा लोड हुआ')); app.go('');
      } }, icon('sparkle', 16), L('Load demo data', 'डेमो डेटा लोड करें')),
      local ? h('button', { class: 'btn danger', type: 'button', onclick: async () => {
        if (!(await confirmDialog(L('Permanently delete ALL data, including paired devices? This cannot be undone.', 'सारा डेटा स्थायी रूप से हटाएँ?')))) return;
        await api('/api/data', { method: 'DELETE' }); app.profile = null; toast(L('All data deleted', 'सारा डेटा हटाया गया')); app.go('welcome');
      } }, icon('trash', 16), L('Delete everything', 'सब हटाएँ')) : null),
    h('details', null, h('summary', { style: { cursor: 'pointer' }, onclick: async () => {
      if (auditHost.firstChild) return;
      const r = await api('/api/audit');
      mount(auditHost, h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', null, h('tr', null, h('th', null, 'When'), h('th', null, 'Event'), h('th', null, 'Detail'))),
        h('tbody', null, r.audit.slice(0, 60).map((a) => h('tr', null, h('td', null, dateTimeLabel(a.ts)), h('td', { class: 'mono' }, a.event), h('td', { class: 'muted', style: { maxWidth: '420px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, a.detail ? JSON.stringify(a.detail) : '')))))));
    } }, L('Audit log', 'ऑडिट लॉग')), auditHost));

  const about = h('div', { class: 'card stack' }, h('h2', null, L('About Nadi', 'Nadi के बारे में')),
    h('p', { class: 'small' }, `v${meta.version} · `, L('Science inside: POS rPPG (Wang et al., IEEE TBME 2017) · pulse SNR (de Haan & Jeanne 2013) · Baevsky stress index · respiratory "smart fusion" (Karlen et al. 2013) · noise-debiased HRV · voice jitter/shimmer/HNR (MDVP/Praat norms; Boersma 1993).', 'विज्ञान: POS rPPG, Baevsky तनाव सूचकांक, आदि।')),
    h('p', { class: 'disclaimer' }, t('not_diagnosis')));

  page.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, t('settings_title')))), profileCard, aiCard, pairCard, prefs, rules, dataCard, about);
  loadDevices();
  return page;
}
