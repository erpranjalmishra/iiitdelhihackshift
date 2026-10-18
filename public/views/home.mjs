import { h, icon, fmt, timeAgo, deltaLine, SEV_ICON, toast, mount } from '../lib/ui.mjs';
import { api } from '../lib/api.mjs';
import { t, getLang, sevLabel } from '../lib/i18n.mjs';
import { sparkline, drawWave } from '../lib/charts.mjs';

const SLOT_LABEL = { morning: ['Morning', 'सुबह'], afternoon: ['Afternoon', 'दोपहर'], evening: ['Evening', 'शाम'], night: ['Night', 'रात'] };

export async function render({ app }) {
  const lang = getLang();
  const L = (en, hi) => (lang === 'hi' ? hi : en);
  const [twin, meds, eps] = await Promise.all([
    api('/api/twin?days=30'), api('/api/meds'), api('/api/episodes'),
  ]);
  const p = app.profile || {};
  const hour = new Date().getHours();
  const greet = hour < 12 ? t('greeting_m') : hour < 17 ? t('greeting_a') : t('greeting_e');
  const latest = twin.latest;
  const base = twin.baseline;
  const series = (k) => (twin.series[k] || []).filter((x) => x.eligible).map((x) => x.v);

  /* ---- alert banner: unusual vitals or a recent serious check ---- */
  const concerning = latest ? latest.notes.filter((n) => n.concerning) : [];
  const lastEp = eps.episodes[0];
  const recentSerious = lastEp && ['urgent', 'emergency'].includes(lastEp.severity) && Date.now() - Date.parse(lastEp.ts) < 24 * 3600000;
  let alert = null;
  if (recentSerious) {
    alert = h('div', { class: `banner ${lastEp.severity}` }, h('div', { class: 'badge' }, icon(SEV_ICON[lastEp.severity], 24)),
      h('div', { class: 'stack' }, h('div', { class: 'level' }, sevLabel(lastEp.severity)), h('h2', null, lastEp.headline || ''),
        h('div', { class: 'row' }, h('a', { class: 'btn sm', href: '#/check' }, L('Review the advice', 'सलाह देखें')),
          lastEp.severity === 'emergency' ? h('a', { class: 'btn call sm', href: 'tel:112' }, icon('phone', 16), '112') : null)));
  } else if (concerning.length && Date.now() - Date.parse(latest.ts) < 36 * 3600000) {
    alert = h('div', { class: 'banner soon' }, h('div', { class: 'badge' }, icon('twin', 24)),
      h('div', { class: 'stack' },
        h('div', { class: 'level' }, L('Baseline Twin', 'बेसलाइन ट्विन')),
        h('h2', null, L('Your body looks different from your normal today', 'आज आपका शरीर आपके सामान्य से अलग दिख रहा है')),
        h('ul', { class: 'clean small' }, concerning.slice(0, 3).map((n) => h('li', null, n.text))),
        h('div', { class: 'row' }, h('a', { class: 'btn primary sm', href: '#/check' }, icon('check', 16), L('Check how you feel', 'लक्षण जाँचें')),
          h('a', { class: 'btn sm', href: '#/twin' }, L('See trends', 'ट्रेंड देखें')))));
  }

  /* ---- hero: latest heart rate ---- */
  const wave = h('canvas', { class: 'live', style: { height: '96px' }, 'aria-label': 'Pulse waveform from your latest scan' });
  const hero = h('div', { class: 'card' },
    h('div', { class: 'hero' },
      h('div', { class: 'stack' },
        h('div', { class: 'row muted small' }, icon('heart', 16), t('resting_hr')),
        latest ? h('div', { class: 'hero-figure' }, h('span', { class: 'value' }, fmt(latest.hr)), h('span', { class: 'unit' }, 'bpm')) : h('div', { class: 'hero-figure' }, h('span', { class: 'value muted' }, '—')),
        latest ? deltaLine(latest.hr, base.hr, { unit: 'bpm', lang }) : h('div', { class: 'delta' }, t('no_scan_yet')),
        latest ? h('div', { class: 'meta-line' }, h('span', null, timeAgo(latest.ts, lang)), latest.quality != null ? h('span', null, `${L('signal quality', 'सिग्नल गुणवत्ता')} ${fmt(latest.quality)}/100`) : null) : null,
        h('div', { class: 'row', style: { marginTop: '6px' } },
          h('a', { class: 'btn primary', href: '#/scan' }, icon('scan', 18), t('start_scan')),
          h('a', { class: 'btn', href: '#/check' }, icon('check', 18), t('check_symptoms')))),
      h('div', { class: 'stack' }, wave, h('div', { class: 'muted tiny' }, L('Pulse waveform recovered from your camera — each peak is a heartbeat.', 'कैमरे से मिली नाड़ी तरंग — हर शिखर एक धड़कन है।')))));
  // Waveform: from the latest scan detail if present.
  api('/api/readings?days=3').then((r) => {
    const last = [...r.readings].reverse().find((x) => x.detail && x.detail.waveform);
    requestAnimationFrame(() => drawWave(wave, last ? last.detail.waveform : [], { beats: last ? last.detail.beats || [] : [], fs: last ? last.detail.waveformFs || 30 : 30 }));
  }).catch(() => {});

  /* ---- stat tiles ---- */
  const tile = (ic, label, key, unit, decimals, higherIsWorse) => h('div', { class: 'card tight stat' },
    h('div', { class: 'label' }, icon(ic, 16), label),
    h('div', { class: 'value' }, latest && latest[key] != null ? fmt(latest[key], decimals) : '—', h('small', null, unit)),
    key === 'quality' && latest
      ? h('div', { class: 'delta' }, { high: L('High confidence scan', 'उच्च विश्वसनीयता'), medium: L('Medium confidence', 'मध्यम विश्वसनीयता'), low: L('Low — consider re-scanning', 'कम — फिर स्कैन करें') }[latest.confidence] || '—')
      : latest && latest[key] != null ? deltaLine(latest[key], base[key], { unit: unit === '/100' ? '' : unit, decimals, higherIsWorse, lang }) : h('div', { class: 'delta' }, latest ? L('Not measured', 'नहीं मापा') : '—'),
    sparkline(series(key)));
  const tiles = h('div', { class: 'grid-4' },
    tile('wave', t('hrv'), 'rmssd', 'ms', 0, false),
    tile('lungs', t('breathing'), 'rr', '/min', 1, true),
    tile('brain', t('stress'), 'stress', '/100', 0, true),
    tile('heart', L('Signal quality', 'सिग्नल गुणवत्ता'), 'quality', '/100', 0, false));

  /* ---- today's medicines ---- */
  const doses = [];
  for (const m of meds.meds.filter((x) => x.active)) for (const slot of m.times) doses.push({ m, slot, status: m.today[slot] });
  const order = { morning: 0, afternoon: 1, evening: 2, night: 3 };
  doses.sort((a, b) => order[a.slot] - order[b.slot]);
  const medCard = h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, t('todays_meds')), h('a', { class: 'btn ghost sm', href: '#/meds' }, L('All', 'सभी'), icon('chevron', 16))),
    meds.analysis.findings.length ? h('div', { class: 'notice warn small', style: { marginBottom: '10px' } }, icon('alert', 18), h('div', null, h('strong', null, meds.analysis.findings[0].title), ' — ', meds.analysis.findings[0].advice)) : null,
    doses.length ? h('div', null, doses.map(({ m, slot, status }) => {
      const btn = h('button', { class: 'btn sm dose-btn', type: 'button', 'aria-pressed': String(status === 'taken'), onclick: async () => {
        const next = btn.getAttribute('aria-pressed') === 'true' ? null : 'taken';
        try {
          await api(`/api/meds/${m.id}/dose`, { method: 'POST', body: { slot, status: next } });
          btn.setAttribute('aria-pressed', String(next === 'taken'));
          mount(btn, next === 'taken' ? icon('ok', 16) : '', next === 'taken' ? t('taken') : t('mark'));
        } catch (e) { toast(e.message, { bad: true }); }
      } }, status === 'taken' ? icon('ok', 16) : '', status === 'taken' ? t('taken') : t('mark'));
      return h('div', { class: 'dose' }, h('div', null, h('div', { style: { fontWeight: 650 } }, m.name, m.dose ? h('span', { class: 'muted small' }, ` · ${m.dose}`) : null), h('div', { class: 'muted tiny' }, SLOT_LABEL[slot][lang === 'hi' ? 1 : 0])), btn);
    })) : h('div', { class: 'empty' }, h('p', null, L('No medicines added.', 'कोई दवा नहीं जोड़ी गई।')), h('a', { class: 'btn sm', href: '#/meds' }, icon('plus', 16), t('add_med'))));

  /* ---- last check ---- */
  const checkCard = h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, t('last_check')), h('a', { class: 'btn ghost sm', href: '#/check' }, t('new_check'), icon('chevron', 16))),
    lastEp ? h('div', { class: 'stack' },
      h('div', { class: 'row' }, h('span', { class: `sev ${lastEp.severity}` }, h('span', { class: 'swatch' }), sevLabel(lastEp.severity)), h('span', { class: 'muted small' }, timeAgo(lastEp.ts, lang))),
      h('p', { style: { fontWeight: 600 } }, lastEp.headline || ''),
      h('p', { class: 'muted small' }, `“${(lastEp.text || '').slice(0, 140)}”`),
      h('div', { class: 'row' }, h('a', { class: 'btn sm', href: `#/check/${lastEp.id}` }, L('Open', 'खोलें')), h('a', { class: 'btn sm', href: '#/share' }, icon('share', 16), t('share_doctor'))))
      : h('div', { class: 'empty' }, h('p', null, L('No checks yet. Describe how you feel to get guidance.', 'अभी कोई जाँच नहीं।')), h('a', { class: 'btn primary sm', href: '#/check' }, t('check_symptoms'))));

  /* ---- AI insight ---- */
  const insightBody = h('div', { class: 'stack' }, h('p', { class: 'muted' }, L('Get a plain-language read-out of what changed in your vitals, compared with your own baseline.', 'आपके वाइटल्स में क्या बदला — आसान भाषा में।')));
  const insightBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
    insightBtn.disabled = true;
    mount(insightBody, h('div', { class: 'row muted' }, h('span', { class: 'spinner' }), L('Analysing your last 14 days…', 'पिछले 14 दिनों का विश्लेषण…')));
    try {
      const r = await api('/api/twin/insights', { method: 'POST', body: { days: 14, language: lang } });
      mount(insightBody, insightView(r, lang));
    } catch (e) { mount(insightBody, h('div', { class: 'notice bad' }, e.message)); }
    insightBtn.disabled = false;
  } }, icon('sparkle', 16), t('explain_trends'));
  const insightCard = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, t('ai_insight')), insightBtn), insightBody);

  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, `${greet}${p.name ? ', ' + p.name.replace(/\s*\(demo\)/, '') : ''}`), h('p', null, new Date().toLocaleDateString(lang === 'hi' ? 'hi-IN' : undefined, { weekday: 'long', day: 'numeric', month: 'long' })))),
    alert, hero, tiles,
    h('div', { class: 'grid-2' }, medCard, checkCard),
    insightCard,
    h('p', { class: 'disclaimer' }, t('not_diagnosis')));
}

export function insightView(r, lang) {
  const L = (en, hi) => (lang === 'hi' ? hi : en);
  const res = r.result;
  const concernLabel = { none: L('Normal variation', 'सामान्य'), watch: L('Keep an eye on', 'नज़र रखें'), discuss: L('Discuss with a doctor', 'डॉक्टर से बात करें') };
  const arrow = { up: '▲', down: '▼', stable: '≈', mixed: '↕' };
  return h('div', { class: 'stack' },
    h('h3', null, res.headline),
    h('p', { class: 'ink-2' }, res.summary),
    res.observations.length ? h('ul', { class: 'clean plain stack' }, res.observations.map((o) => h('li', { class: 'row', style: { alignItems: 'flex-start', flexWrap: 'nowrap' } },
      h('span', { class: 'tag', style: { minWidth: '28px', justifyContent: 'center' } }, arrow[o.direction] || '•'),
      h('div', null, h('div', null, o.text), h('div', { class: 'muted tiny' }, concernLabel[o.concern]))))) : null,
    res.suggestions.length ? h('div', { class: 'inset stack' }, h('strong', { class: 'small' }, L('Suggestions', 'सुझाव')), h('ul', { class: 'clean small' }, res.suggestions.map((s) => h('li', null, s)))) : null,
    res.discuss_with_doctor ? h('div', { class: 'notice warn' }, icon('doctor', 18), L('These changes are worth discussing with a doctor.', 'इन बदलावों पर डॉक्टर से बात करें।'), h('a', { class: 'btn sm', href: '#/share', style: { marginLeft: 'auto' } }, t('share_doctor'))) : null,
    h('div', { class: 'meta-line' }, h('span', null, r.engine === 'gemini' ? `AI: ${r.model}` : r.engine === 'rules' ? L('Statistics only', 'केवल आँकड़े') : L('Offline engine', 'ऑफ़लाइन इंजन')), r.fallback ? h('span', null, r.fallback.message) : null));
}
