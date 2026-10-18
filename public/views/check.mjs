import { h, icon, fmt, toast, timeAgo, SEV_ICON, mount } from '../lib/ui.mjs';
import { api } from '../lib/api.mjs';
import { t, getLang, sevLabel, sevDesc } from '../lib/i18n.mjs';

const CARE = { home: ['At home', 'घर पर'], teleconsult: ['Teleconsultation (eSanjeevani)', 'टेलीकंसल्टेशन (ई-संजीवनी)'], primary_care: ['Clinic / PHC / OPD', 'क्लिनिक / PHC / OPD'], hospital_er: ['Emergency department', 'इमरजेंसी विभाग'] };

export async function render({ app, args }) {
  const lang = getLang();
  const L = (en, hi) => (lang === 'hi' ? hi : en);
  const [meta, eps, recent] = await Promise.all([
    app.meta ? Promise.resolve(app.meta) : api('/api/meta').then((m) => (app.meta = m)),
    api('/api/episodes'),
    api('/api/readings?days=1'),
  ]);
  const symLabel = Object.fromEntries(meta.symptoms.map((s) => [s.id, lang === 'hi' ? s.hi : s.en]));
  const latestScan = [...recent.readings].reverse().find((r) => r.hr != null && Date.now() - Date.parse(r.ts) < 3 * 3600000);

  const page = h('div', { class: 'page' });
  const resultHost = h('div', { class: 'stack-lg' });

  /* ---------- intake form ---------- */
  const chips = new Set();
  const text = h('textarea', { class: 'textarea', placeholder: L('e.g. "Fever since yesterday, around 101, body ache and pain behind the eyes" or "kal se bukhar hai, sir dard aur badan dard"', 'जैसे: "कल से बुखार है, सिर दर्द और बदन दर्द"'), maxlength: 2000, 'aria-label': t('describe') });
  const dictate = (() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    let rec = null;
    const btn = h('button', { class: 'btn icon', type: 'button', title: L('Speak instead of typing (uses your browser\'s speech service)', 'टाइप करने की जगह बोलें'), 'aria-label': 'Dictate', onclick: () => {
      if (rec) { rec.stop(); return; }
      rec = new SR();
      rec.lang = lang === 'hi' ? 'hi-IN' : 'en-IN';
      rec.interimResults = false;
      rec.continuous = true;
      btn.classList.add('primary');
      rec.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) text.value += (text.value ? ' ' : '') + e.results[i][0].transcript; };
      rec.onend = () => { rec = null; btn.classList.remove('primary'); };
      rec.onerror = () => { toast(L('Dictation unavailable — please type instead.', 'डिक्टेशन उपलब्ध नहीं।'), { bad: true }); };
      rec.start();
    } }, icon('mic', 18));
    return btn;
  })();
  const chipEls = h('div', { class: 'chips' }, meta.chips.map((id) => h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', onclick: (e) => {
    if (chips.has(id)) chips.delete(id); else chips.add(id);
    e.currentTarget.setAttribute('aria-pressed', String(chips.has(id)));
  } }, symLabel[id] || id)));
  const days = h('input', { class: 'input', type: 'number', min: 0, step: '0.5', placeholder: L('e.g. 2', 'जैसे 2') });
  const painOut = h('strong', null, '—');
  const pain = h('input', { type: 'range', min: 0, max: 10, step: 1, value: 0, oninput: () => { painOut.textContent = pain.value === '0' ? '—' : `${pain.value}/10`; } });
  const temp = h('input', { class: 'input', type: 'number', step: '0.1', placeholder: '101.2' });
  const tempUnit = h('select', { class: 'select', style: { maxWidth: '84px' } }, h('option', { value: 'F' }, '°F'), h('option', { value: 'C' }, '°C'));
  const useScan = h('input', { type: 'checkbox', checked: !!latestScan });
  const submit = h('button', { class: 'btn primary lg', type: 'submit' }, icon('sparkle', 18), t('assess'));

  const form = h('form', { class: 'card stack-lg', onsubmit: (e) => { e.preventDefault(); run([]); } },
    h('label', { class: 'field' }, h('span', null, t('describe')), h('div', { class: 'input-group' }, text, dictate)),
    h('div', { class: 'stack' }, h('span', { class: 'small', style: { fontWeight: 600, color: 'var(--ink-2)' } }, L('Or tap what applies', 'या चुनें')), chipEls),
    h('div', { class: 'grid-3' },
      h('label', { class: 'field' }, h('span', null, L('For how many days?', 'कितने दिनों से?')), days),
      h('label', { class: 'field' }, h('span', null, h('span', null, L('How bad, 0–10? ', 'कितना तेज़, 0–10? ')), painOut), pain),
      h('label', { class: 'field' }, h('span', null, L('Temperature (if measured)', 'तापमान (अगर मापा)')), h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, temp, tempUnit))),
    latestScan
      ? h('label', { class: 'check inset' }, useScan, h('span', null, L(`Include my scan from ${timeAgo(latestScan.ts, lang)} — HR ${fmt(latestScan.hr)} bpm, breathing ${fmt(latestScan.rr, 1)}/min, quality ${fmt(latestScan.quality)}/100`, `मेरा ${timeAgo(latestScan.ts, lang)} का स्कैन शामिल करें — HR ${fmt(latestScan.hr)}`)))
      : h('div', { class: 'notice info small' }, icon('scan', 18), h('div', null, L('Tip: a 60-second scan first adds heart rate, breathing and your personal baseline to the assessment. ', 'सुझाव: पहले 60 सेकंड का स्कैन करें। '), h('a', { href: '#/scan' }, L('Scan now', 'अभी स्कैन करें')))),
    h('div', { class: 'row' }, submit, h('span', { class: 'muted small' }, L(`${meta.guard.rules} safety rules run on every check`, `हर जाँच पर ${meta.guard.rules} सुरक्षा नियम`))),
    h('p', { class: 'disclaimer' }, t('not_diagnosis')));

  /* ---------- run triage ---------- */
  let lastIntake = null;
  async function run(answers) {
    const chosen = [...chips];
    if (!text.value.trim() && !chosen.length) { toast(L('Describe your symptoms or pick at least one.', 'लक्षण लिखें या चुनें।'), { bad: true }); text.focus(); return; }
    let temp_c = temp.value ? +temp.value : null;
    if (temp_c != null && tempUnit.value === 'F') temp_c = Math.round(((temp_c - 32) * 5) / 9 * 10) / 10;
    lastIntake = {
      text: text.value.trim(), chips: chosen, duration_days: days.value || null, severity: pain.value !== '0' ? +pain.value : null,
      temp_c, use_scan: useScan.checked, reading_id: useScan.checked && latestScan ? latestScan.id : null, language: lang, answers,
    };
    submit.disabled = true;
    const engineName = app.ai && app.ai.provider === 'gemini' ? `Gemini${app.ai.model ? ' (' + app.ai.model + ')' : ''}` : L('offline clinical engine', 'ऑफ़लाइन इंजन');
    const steps = [L('Reading your symptoms', 'लक्षण पढ़ रहे हैं'), L(`Safety pre-check · ${meta.guard.rules} red-flag rules`, `सुरक्षा जाँच · ${meta.guard.rules} नियम`), `${L('Clinical reasoning', 'विश्लेषण')} · ${engineName}`, L('Safety post-check & output review', 'अंतिम सुरक्षा जाँच')];
    const stepEls = steps.map((s) => h('div', { class: 'ps' }, h('span', { class: 'spinner', style: { visibility: 'hidden' } }), s));
    mount(resultHost, h('div', { class: 'card' }, h('div', { class: 'progress-steps', 'aria-live': 'polite' }, stepEls)));
    resultHost.scrollIntoView({ behavior: 'smooth', block: 'start' });
    let i = 0;
    const tick = () => {
      stepEls.forEach((el, k) => {
        el.className = `ps ${k < i ? 'done' : k === i ? 'active' : ''}`;
        el.firstChild.replaceWith(k < i ? icon('ok', 18) : h('span', { class: 'spinner', style: { visibility: k === i ? 'visible' : 'hidden' } }));
      });
    };
    tick();
    const timer = setInterval(() => { if (i < 2) { i++; tick(); } }, 650);
    try {
      const r = await api('/api/triage', { method: 'POST', body: lastIntake });
      clearInterval(timer);
      i = 4; tick();
      await new Promise((res) => setTimeout(res, 250));
      mount(resultHost, resultView(r));
      loadHistory();
    } catch (e) {
      clearInterval(timer);
      mount(resultHost, h('div', { class: 'notice bad' }, icon('alert', 20), e.message));
    }
    submit.disabled = false;
  }

  /* ---------- result ---------- */
  function resultView(r) {
    const res = r.result;
    const sev = r.severity;
    const parts = [];
    const fired = r.guard.fired || [];
    const top = fired[0];

    parts.push(h('div', { class: `banner ${sev}`, role: sev === 'emergency' ? 'alert' : 'status' },
      h('div', { class: 'badge' }, icon(SEV_ICON[sev], 26)),
      h('div', { class: 'stack' },
        h('div', { class: 'level' }, `${sevLabel(sev)} · ${sevDesc(sev)}`),
        h('h2', null, res.headline),
        h('div', { class: 'row small ink-2' }, icon('clock', 16), `${L('Where', 'कहाँ')}: ${CARE[res.care_setting] ? CARE[res.care_setting][lang === 'hi' ? 1 : 0] : res.care_setting}`, h('span', null, '·'), `${L('Re-check within', 'फिर जाँचें')} ${res.follow_up_hours} h`),
        sev === 'emergency' ? h('div', { class: 'row' },
          h('a', { class: 'btn call', href: 'tel:112' }, icon('phone', 20), L('Call 112', '112 पर कॉल करें')),
          h('a', { class: 'btn call', href: 'tel:108', style: { background: '#b42f2f' } }, icon('phone', 20), L('Ambulance 108', 'एम्बुलेंस 108'))) : null,
        sev === 'emergency' && top ? h('div', { class: 'notice bad' }, icon('siren', 18), h('div', null, h('strong', null, L('Right now: ', 'अभी: ')), (lang === 'hi' && top.action_hi) || top.action)) : null)));

    if (r.escalated) {
      parts.push(h('div', { class: 'notice warn' }, icon('shield', 20), h('div', null,
        h('strong', null, L('Escalated by a safety rule. ', 'सुरक्षा नियम ने स्तर बढ़ाया। ')),
        L(`The ${r.engine === 'gemini' ? 'AI' : 'engine'} suggested "${sevLabel(r.ai_severity)}"; Nadi's deterministic rules raised it to "${sevLabel(sev)}". Rules can only make advice more cautious, never less.`, `AI ने "${sevLabel(r.ai_severity)}" कहा; नियमों ने इसे "${sevLabel(sev)}" किया।`))));
    }

    parts.push(h('div', { class: 'card stack' }, h('p', { style: { fontSize: '16px' } }, res.summary)));

    // Why: guardrails + advisories + parsed findings.
    const why = h('div', { class: 'card stack' }, h('div', { class: 'card-head', style: { marginBottom: 0 } }, h('h2', null, t('why_title')), h('span', { class: 'tag' }, icon('shield', 14), `${fired.length}/${r.guard.checked} ${L('rules fired', 'नियम लागू')}`)));
    if (fired.length) {
      for (const f of fired) why.append(h('div', { class: `rule ${f.level}` },
        h('div', { class: 'row between' }, h('strong', null, (lang === 'hi' && f.title_hi) || f.title), h('span', { class: `sev ${f.level}` }, h('span', { class: 'swatch' }), sevLabel(f.level))),
        h('div', { class: 'small' }, f.why),
        h('div', { class: 'small' }, h('strong', null, L('Action: ', 'क्या करें: ')), (lang === 'hi' && f.action_hi) || f.action),
        h('div', { class: 'src' }, `${f.id} · ${f.source}`)));
    } else {
      why.append(h('div', { class: 'notice' }, icon('ok', 18), L(`No red flags found across ${r.guard.checked} clinical safety rules.`, `${r.guard.checked} सुरक्षा नियमों में कोई ख़तरे का संकेत नहीं मिला।`)));
    }
    for (const a of r.guard.advisories || []) why.append(h('div', { class: 'notice info small' }, icon('info', 16), a.text));
    const found = (r.parsed.symptoms || []).map((id) => symLabel[id] || id);
    const denied = (r.parsed.negated || []).map((id) => symLabel[id] || id);
    why.append(h('div', { class: 'meta-line' },
      h('span', null, `${L('Understood', 'समझा')}: ${found.join(', ') || '—'}`),
      denied.length ? h('span', null, `${L('You said no to', 'नहीं')}: ${denied.join(', ')}`) : null,
      r.parsed.duration_days != null ? h('span', null, `${L('Duration', 'अवधि')}: ${r.parsed.duration_days} ${lang === 'hi' ? 'दिन' : r.parsed.duration_days === 1 ? 'day' : 'days'}`) : null,
      r.parsed.temp_c != null ? h('span', null, `${L('Temp', 'तापमान')}: ${r.parsed.temp_c} °C`) : null));
    parts.push(why);

    // Possible conditions.
    if (res.possible_conditions.length) {
      const bars = (lik) => { const n = { high: 3, moderate: 2, low: 1 }[lik] || 1; return h('span', { class: 'bars', 'aria-hidden': 'true' }, [1, 2, 3].map((k) => h('i', { class: k <= n ? 'on' : '', style: { height: `${4 + k * 3}px` } }))); };
      const likLabel = { high: L('More likely', 'अधिक संभावित'), moderate: L('Possible', 'संभव'), low: L('Less likely', 'कम संभावित') };
      parts.push(h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, t('possible')), h('span', { class: 'muted small' }, L('Not a diagnosis', 'निदान नहीं'))),
        res.possible_conditions.map((c) => h('div', { class: 'cond' }, h('strong', null, c.name), h('span', { class: 'lik' }, bars(c.likelihood), likLabel[c.likelihood]), h('div', { class: 'why' }, c.reasoning)))));
    }

    // Vitals.
    const devs = (r.devNotes || []).filter((n) => n.concerning);
    parts.push(h('div', { class: 'card stack' }, h('h2', null, L('What your vitals add', 'आपके वाइटल्स क्या बताते हैं')), h('p', null, res.vitals_interpretation),
      devs.length ? h('div', { class: 'inset stack' }, h('strong', { class: 'small' }, L('Compared with your own baseline', 'आपके अपने सामान्य की तुलना में')), h('ul', { class: 'clean small' }, devs.map((n) => h('li', null, n.text)))) : null));

    // Actions.
    const list = (title, items, ordered = false) => (items && items.length ? h('div', { class: 'card stack' }, h('h2', null, title), h(ordered ? 'ol' : 'ul', { class: ordered ? 'steps' : 'clean' }, items.map((x) => h('li', null, x)))) : null);
    parts.push(h('div', { class: 'grid-2' }, list(t('what_now'), res.recommended_actions, true), list(t('watch_for'), res.watch_for)));
    parts.push(h('div', { class: 'grid-2' }, list(t('self_care'), res.self_care), list(t('questions_doc'), res.questions_for_doctor)));

    // Medication warnings.
    if (r.medFindings && r.medFindings.length) {
      parts.push(h('div', { class: 'card stack' }, h('h2', null, L('About your medicines', 'आपकी दवाओं के बारे में')),
        r.medFindings.map((f) => h('div', { class: `rule ${f.severity === 'moderate' ? 'soon' : 'urgent'}` }, h('strong', null, f.title), h('div', { class: 'small' }, f.detail), h('div', { class: 'small' }, h('strong', null, L('Advice: ', 'सलाह: ')), f.advice), f.meds && f.meds.length ? h('div', { class: 'src' }, f.meds.join(' + ')) : null))));
    }

    // Output lint notes.
    if (r.lint && r.lint.length) parts.push(h('div', { class: 'notice info small' }, icon('shield', 16), h('div', null, h('strong', null, L('Safety edits to the AI answer: ', 'AI उत्तर में सुरक्षा बदलाव: ')), r.lint.map((n) => n.text).join(' '))));

    // Follow-up questions → refine.
    if (res.follow_up_questions && res.follow_up_questions.length && sev !== 'emergency') {
      const inputs = res.follow_up_questions.map((q) => ({ q, el: h('input', { class: 'input', placeholder: L('Your answer', 'आपका उत्तर') }) }));
      parts.push(h('form', { class: 'card stack', onsubmit: (e) => {
        e.preventDefault();
        const answers = inputs.map(({ q, el }) => ({ q, a: el.value.trim() })).filter((a) => a.a);
        if (!answers.length) { toast(L('Answer at least one question.', 'कम से कम एक उत्तर दें।'), { bad: true }); return; }
        run([...(lastIntake && lastIntake.answers ? lastIntake.answers : []), ...answers]);
      } }, h('h2', null, t('refine')), inputs.map(({ q, el }) => h('label', { class: 'field' }, h('span', null, q), el)), h('div', null, h('button', { class: 'btn', type: 'submit' }, icon('refresh', 16), L('Update assessment', 'आकलन अपडेट करें')))));
    }

    parts.push(h('div', { class: 'card stack' },
      h('div', { class: 'row' },
        h('a', { class: 'btn primary', href: `#/share/${r.episode_id}` }, icon('share', 18), t('share_doctor')),
        h('a', { class: 'btn', href: 'https://esanjeevani.mohfw.gov.in', target: '_blank', rel: 'noopener noreferrer' }, icon('link', 18), L('eSanjeevani free teleconsult', 'ई-संजीवनी टेलीकंसल्ट')),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { mount(resultHost); text.value = ''; window.scrollTo({ top: 0, behavior: 'smooth' }); text.focus(); } }, t('new_check'))),
      h('div', { class: 'meta-line' },
        h('span', null, `${L('Engine', 'इंजन')}: ${r.engine === 'gemini' ? `Gemini · ${r.model}` : L('Nadi offline clinical engine', 'Nadi ऑफ़लाइन इंजन')}`),
        r.latencyMs != null ? h('span', null, `${(r.latencyMs / 1000).toFixed(1)} s`) : null,
        h('span', null, `${L('Confidence', 'विश्वास')}: ${res.confidence}`),
        r.fallback ? h('span', null, r.fallback.message) : null),
      h('p', { class: 'disclaimer' }, t('not_diagnosis'))));
    return h('div', { class: 'stack-lg' }, parts);
  }

  /* ---------- history ---------- */
  const historyHost = h('div');
  function loadHistory(list) {
    const draw = (episodes) => mount(historyHost, episodes.length ? h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, L('Past checks', 'पिछली जाँचें'))),
      episodes.slice(0, 10).map((e) => h('a', { href: `#/check/${e.id}`, class: 'dose', style: { textDecoration: 'none', color: 'inherit' } },
        h('div', { class: 'stack', style: { gap: '2px' } }, h('div', { style: { fontWeight: 600 } }, e.headline || ''), h('div', { class: 'muted tiny' }, `${timeAgo(e.ts, lang)} · “${(e.text || '').slice(0, 70)}”`)),
        h('span', { class: `sev ${e.severity}` }, h('span', { class: 'swatch' }), sevLabel(e.severity))))) : null);
    if (list) draw(list); else api('/api/episodes').then((r) => draw(r.episodes)).catch(() => {});
  }

  page.append(
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, L('How are you feeling?', 'आप कैसा महसूस कर रहे हैं?')), h('p', null, L('AI triage with clinical safety guardrails — tells you how urgently to seek care and what to do meanwhile.', 'AI ट्राइएज — कितनी जल्दी डॉक्टर को दिखाना है और तब तक क्या करना है।')))),
    form, resultHost, historyHost);
  loadHistory(eps.episodes);

  if (args && args[0]) {
    try {
      const ep = await api(`/api/episodes/${args[0]}`);
      text.value = ep.text || '';
      mount(resultHost, resultView(ep));
      requestAnimationFrame(() => resultHost.scrollIntoView({ block: 'start' }));
    } catch (e) { toast(e.message, { bad: true }); }
  }
  return page;
}
