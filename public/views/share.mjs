import { h, icon, toast, copyText, timeAgo, dateTimeLabel, confirmDialog, mount } from '../lib/ui.mjs';
import { api } from '../lib/api.mjs';
import { t, getLang, sevLabel } from '../lib/i18n.mjs';

export async function render({ args }) {
  const lang = getLang();
  const L = (en, hi) => (lang === 'hi' ? hi : en);
  const [eps, links] = await Promise.all([api('/api/episodes'), api('/api/handoffs')]);
  const page = h('div', { class: 'page' });
  const out = h('div', { class: 'stack-lg' });
  const linksHost = h('div');

  if (!eps.episodes.length) {
    page.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, t('share_title')))),
      h('div', { class: 'card empty' }, icon('doctor', 36), h('p', null, L('Run a symptom check first — the doctor note is built from it, your vitals and your trends.', 'पहले लक्षण जाँच करें।')), h('a', { class: 'btn primary', href: '#/check' }, t('check_symptoms'))));
    return page;
  }

  const select = h('select', { class: 'select' }, eps.episodes.map((e) => h('option', { value: e.id, selected: args && args[0] === e.id }, `${new Date(e.ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · ${sevLabel(e.severity)} · ${(e.text || '').slice(0, 50)}`)));
  const hours = h('select', { class: 'select' }, [[4, L('4 hours', '4 घंटे')], [24, L('24 hours', '24 घंटे')], [72, L('3 days', '3 दिन')]].map(([v, l]) => h('option', { value: v, selected: v === 24 }, l)));
  const includeName = h('input', { type: 'checkbox', checked: true });
  const btn = h('button', { class: 'btn primary lg', type: 'submit' }, icon('share', 18), t('create_link'));

  const form = h('form', { class: 'card stack', onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true;
    mount(out, h('div', { class: 'card row muted' }, h('span', { class: 'spinner' }), L('Writing the clinical note…', 'क्लिनिकल नोट लिखा जा रहा है…')));
    try {
      const r = await api('/api/handoff', { method: 'POST', body: { episode_id: select.value, hours: +hours.value, include_name: includeName.checked } });
      mount(out, result(r));
      loadLinks();
    } catch (err) { mount(out, h('div', { class: 'notice bad' }, icon('alert', 18), err.message)); }
    btn.disabled = false;
  } },
    h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', null, L('Which check to share', 'कौन सी जाँच')), select), h('label', { class: 'field' }, h('span', null, L('Link valid for', 'लिंक की वैधता')), hours)),
    h('label', { class: 'check' }, includeName, L('Include my name', 'मेरा नाम शामिल करें')),
    h('div', { class: 'row' }, btn),
    h('p', { class: 'muted small' }, L('The doctor gets a read-only snapshot: a SOAP note, your scan waveform, 30-day trends against your baseline, safety flags and medicines. You can revoke it any time; every view is logged.', 'डॉक्टर को केवल-पढ़ने योग्य स्नैपशॉट मिलता है। आप कभी भी रद्द कर सकते हैं।')));

  function result(r) {
    const qr = h('div', { class: 'qr', html: r.qr_svg }); // server-generated QR SVG
    const msg = L('Please review my health summary from Nadi (link expires): ', 'कृपया Nadi से मेरा स्वास्थ्य सारांश देखें: ');
    const soap = r.soap;
    return h('div', { class: 'stack-lg' },
      h('div', { class: 'card' }, h('div', { class: 'grid-2', style: { alignItems: 'center' } },
        h('div', { style: { display: 'grid', justifyItems: 'center' } }, qr),
        h('div', { class: 'stack' },
          h('h2', null, L('Ask your doctor to scan this', 'डॉक्टर से यह स्कैन करवाएँ')),
          h('p', { class: 'ink-2 small' }, r.lan ? L('Works for any phone on the same Wi-Fi as this computer.', 'इसी वाई-फ़ाई पर किसी भी फ़ोन पर काम करता है।') : L('No network address found — the link works on this computer only.', 'केवल इसी कंप्यूटर पर काम करेगा।')),
          h('div', { class: 'inset mono', style: { wordBreak: 'break-all' } }, r.url),
          h('div', { class: 'row' },
            h('button', { class: 'btn sm', type: 'button', onclick: async () => toast((await copyText(r.url)) ? L('Link copied', 'लिंक कॉपी हुआ') : r.url) }, icon('copy', 16), L('Copy', 'कॉपी')),
            h('a', { class: 'btn sm', href: `https://wa.me/?text=${encodeURIComponent(msg + r.url)}`, target: '_blank', rel: 'noopener noreferrer' }, icon('whatsapp', 16), 'WhatsApp'),
            h('a', { class: 'btn sm', href: r.local_url, target: '_blank', rel: 'noopener' }, icon('doctor', 16), L('Preview as doctor', 'डॉक्टर के रूप में देखें'))),
          h('div', { class: 'muted small' }, `${L('Expires', 'समाप्ति')}: ${dateTimeLabel(r.expires_at)} · ${r.engine === 'gemini' ? `AI: ${r.model}` : L('Offline engine', 'ऑफ़लाइन इंजन')}`)))),
      h('div', { class: 'card stack' }, h('div', { class: 'row between' }, h('h2', null, L('Clinical note (SOAP)', 'क्लिनिकल नोट (SOAP)')),
        h('button', { class: 'btn sm', type: 'button', onclick: async () => toast((await copyText(soapText(soap))) ? L('Note copied', 'नोट कॉपी हुआ') : 'Copy failed') }, icon('copy', 16), L('Copy note', 'नोट कॉपी करें'))),
        soapView(soap)));
  }

  async function loadLinks() {
    const r = await api('/api/handoffs').catch(() => links);
    mount(linksHost, r.handoffs.length ? h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, L('Shared links', 'साझा लिंक'))),
      r.handoffs.map((x) => {
        const expired = Date.parse(x.expires_at) < Date.now();
        const status = x.revoked ? L('Revoked', 'रद्द') : expired ? L('Expired', 'समाप्त') : L('Active', 'सक्रिय');
        return h('div', { class: 'dose', style: { alignItems: 'flex-start' } },
          h('div', { class: 'stack', style: { gap: '4px' } },
            h('div', { class: 'row' }, h('span', { class: 'tag' }, status), h('span', { class: 'small' }, `${L('Created', 'बनाया')} ${timeAgo(x.created_at, lang)} · ${x.views} ${L('view(s)', 'बार देखा')}`)),
            x.clinician_note ? h('div', { class: 'notice info small' }, icon('doctor', 16), h('div', null, h('strong', null, L('Doctor replied: ', 'डॉक्टर का जवाब: ')), x.clinician_note)) : null),
          !x.revoked && !expired ? h('button', { class: 'btn ghost sm danger', type: 'button', onclick: async () => {
            if (!(await confirmDialog(L('Revoke this link? The doctor will no longer be able to open it.', 'यह लिंक रद्द करें?')))) return;
            try { await api(`/api/handoff/${x.token}`, { method: 'DELETE' }); toast(L('Link revoked', 'लिंक रद्द')); loadLinks(); } catch (e) { toast(e.message, { bad: true }); }
          } }, L('Revoke', 'रद्द करें')) : null);
      })) : null);
  }

  page.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, t('share_title')), h('p', null, L('Turn a 7-minute OPD visit into a conversation that starts with data.', '7 मिनट की OPD को डेटा से शुरू करें।')))), form, out, linksHost);
  loadLinks();
  return page;
}

export function soapText(s) {
  return `${s.one_liner}\n\nS: ${s.subjective}\n\nO: ${s.objective}\n\nA: ${s.assessment}\n\nP: ${s.plan}\n\nRed flags: ${(s.red_flags || []).join('; ')}\nPatient questions: ${(s.patient_questions || []).join('; ')}\n\n— Generated by Nadi (wellness/triage aid; camera vitals are estimates; AI differentials unverified)`;
}

export function soapView(s) {
  const sec = (letter, label, text) => h('section', null, h('div', { class: 'letter', title: label }, letter), h('div', null, h('div', { class: 'muted tiny', style: { fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' } }, label), h('p', null, text)));
  return h('div', { class: 'soap' },
    h('p', { style: { fontWeight: 650 } }, s.one_liner),
    sec('S', 'Subjective', s.subjective), sec('O', 'Objective', s.objective), sec('A', 'Assessment', s.assessment), sec('P', 'Plan', s.plan),
    s.red_flags && s.red_flags.length ? h('div', { class: 'inset small' }, h('strong', null, 'Red flags: '), s.red_flags.join(' · ')) : null,
    s.patient_questions && s.patient_questions.length ? h('div', { class: 'inset small' }, h('strong', null, 'Patient wants to ask: '), s.patient_questions.join(' · ')) : null);
}
