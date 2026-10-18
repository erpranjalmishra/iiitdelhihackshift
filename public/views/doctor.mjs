// Clinician view of a shared handoff — opened from the patient's QR code on any device.
import { h, icon, fmt, toast, copyText, dateTimeLabel, mount } from '../lib/ui.mjs';
import { api } from '../lib/api.mjs';
import { trendChart, drawWave } from '../lib/charts.mjs';
import { soapView, soapText } from './share.mjs';

const SEV = { self_care: 'Self-care', soon: 'See a doctor soon', urgent: 'Urgent — today', emergency: 'Emergency' };
const METRICS = [['hr', 'Heart rate', 'bpm', 0], ['rr', 'Breathing rate', '/min', 1], ['rmssd', 'HRV (RMSSD)', 'ms', 0], ['stress', 'Stress index', '/100', 0], ['bp_sys', 'Systolic BP', 'mmHg', 0], ['temp_c', 'Temperature', '°C', 1]];

export async function render({ args }) {
  const token = args[0] || '';
  const root = h('div', null);
  let d;
  try {
    d = await api(`/api/handoff/${encodeURIComponent(token)}`);
  } catch (e) {
    root.append(h('div', { class: 'welcome' }, h('div', { class: 'card stack', style: { maxWidth: '480px' } }, h('div', { class: 'row' }, icon('lock', 24), h('h1', null, 'Link unavailable')), h('p', null, e.message), h('p', { class: 'muted small' }, 'Ask the patient to share a new link from Nadi.'))));
    return root;
  }
  const disposers = [];
  const p = d.patient, ep = d.episode;
  const hoursLeft = Math.max(0, Math.round((Date.parse(d.expires_at) - Date.now()) / 3600000));
  const who = [p.name, p.age != null ? `${p.age} y` : null, p.sex, p.pregnant ? 'pregnant' : null].filter(Boolean).join(' · ');

  // Latest scan waveform.
  const wave = h('canvas', { class: 'live', style: { height: '120px' } });
  if (d.scan && d.scan.waveform) requestAnimationFrame(() => drawWave(wave, d.scan.waveform, { beats: d.scan.beats || [], fs: d.scan.waveformFs || 30 }));

  const tile = (label, v, unit, dec = 0, sub = null) => h('div', { class: 'card tight stat' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, fmt(v, dec), h('small', null, unit)), sub ? h('div', { class: 'delta' }, sub) : null);
  const z = d.deviations || {};
  const zTxt = (k) => (z[k] != null ? `${z[k] > 0 ? '+' : ''}${z[k].toFixed(1)} SD vs personal baseline` : null);

  const trends = METRICS.filter(([k]) => d.trends[k] && d.trends[k].length >= 2).map(([k, label, unit, dec]) => {
    const chart = trendChart({ points: d.trends[k], band: d.baseline[k], unit, decimals: dec, label, days: 30, height: 160 });
    disposers.push(chart._dispose);
    return h('div', { class: 'card stack' }, h('div', { class: 'row between' }, h('h3', null, label), d.baseline[k] && d.baseline[k].ready ? h('span', { class: 'muted small' }, `baseline ${fmt(d.baseline[k].mean, dec)} ± ${fmt(d.baseline[k].sd, dec)}`) : null), chart);
  });

  const noteBox = h('textarea', { class: 'textarea', placeholder: 'e.g. Please get CBC + NS1 today; paracetamol only; return if bleeding or abdominal pain.', maxlength: 2000 });
  const author = h('input', { class: 'input', placeholder: 'Your name (optional), e.g. Dr. Mehta', maxlength: 80 });
  const noteHost = h('div');
  const showNote = (text, at) => mount(noteHost, text ? h('div', { class: 'notice info' }, icon('doctor', 18), h('div', null, h('strong', null, 'Note sent to patient'), at ? h('span', { class: 'muted small' }, ` · ${dateTimeLabel(at)}`) : null, h('div', { style: { whiteSpace: 'pre-wrap' } }, text))) : null);
  showNote(d.clinician_note, d.note_at);

  root.append(
    h('div', { class: 'doctor-top' },
      h('div', { class: 'row' }, h('span', { style: { color: '#9ec5f4', display: 'inline-flex' } }, icon('logo', 22)), h('strong', null, 'Nadi · Clinician view'), h('span', { style: { opacity: 0.75 } }, `Shared by the patient · read-only · expires in ${hoursLeft} h · viewed ${d.views}×`)),
      h('button', { class: 'btn sm', type: 'button', onclick: () => window.print() }, icon('print', 16), 'Print')),
    h('div', { class: 'page' },
      h('div', { class: 'card' }, h('div', { class: 'row between' },
        h('div', { class: 'stack', style: { gap: '4px' } }, h('h1', null, who || 'Patient'),
          h('div', { class: 'meta-line', style: { fontSize: '13px' } },
            h('span', null, `Conditions: ${(p.conditions || []).join(', ') || 'none reported'}`),
            h('span', null, `Allergies: ${(p.allergies || []).join(', ') || 'none reported'}`),
            p.city ? h('span', null, p.city) : null)),
        h('div', { class: 'stack', style: { justifyItems: 'end' } }, h('span', { class: `sev ${ep.severity}` }, h('span', { class: 'swatch' }), SEV[ep.severity]), h('span', { class: 'muted small' }, dateTimeLabel(ep.ts))))),
      h('div', { class: 'card stack' }, h('h2', null, 'Presenting complaint'), h('p', { style: { fontSize: '16px' } }, `“${ep.text}”`), h('p', { class: 'muted small' }, ep.headline),
        ep.escalated ? h('div', { class: 'notice warn small' }, icon('shield', 16), `AI suggested "${SEV[ep.ai_severity]}"; deterministic safety rules escalated to "${SEV[ep.severity]}".`) : null),
      d.guard.fired.length ? h('div', { class: 'card stack' }, h('h2', null, `Safety rules fired (${d.guard.fired.length}/${d.guard.checked})`),
        d.guard.fired.map((f) => h('div', { class: `rule ${f.level}` }, h('strong', null, `${f.title}`), h('div', { class: 'small' }, f.why), h('div', { class: 'src' }, `${f.id} · ${f.source}`))))
        : h('div', { class: 'notice' }, icon('ok', 18), `No red-flag rules fired (${d.guard.checked} screened, ${d.guard.version}).`),
      h('div', { class: 'card stack' }, h('div', { class: 'row between' }, h('h2', null, 'SOAP note'), h('div', { class: 'row' }, h('span', { class: 'muted small' }, d.soap_engine === 'gemini' ? `AI-drafted (${d.soap_model})` : 'Template-drafted (offline)'),
        h('button', { class: 'btn sm', type: 'button', onclick: async () => toast((await copyText(soapText(d.soap))) ? 'Copied to clipboard' : 'Copy failed') }, icon('copy', 16), 'Copy'))), soapView(d.soap)),
      d.scan ? h('div', { class: 'card stack' }, h('div', { class: 'row between' }, h('h2', null, 'Camera scan (rPPG)'), h('span', { class: 'muted small' }, `${dateTimeLabel(d.scan.ts)} · signal quality ${fmt(d.scan.quality)}/100 (${d.scan.confidence})`)),
        h('div', { class: 'grid-4' }, tile('Heart rate', d.scan.hr, 'bpm', 0, zTxt('hr')), tile('Breathing', d.scan.rr, '/min', 1, zTxt('rr')), tile('HRV (RMSSD)', d.scan.rmssd, 'ms', 0, zTxt('rmssd')), tile('Stress index', d.scan.stress, '/100', 0, zTxt('stress'))),
        d.scan.waveform ? h('div', { class: 'stack' }, h('strong', { class: 'small' }, 'Pulse waveform, last 10 s (ticks = detected beats)'), wave) : null,
        d.scan.voice ? h('p', { class: 'small' }, h('strong', null, 'Voice (sustained /a/): '), `F0 ${fmt(d.scan.voice.f0, 0)} Hz · jitter ${fmt(d.scan.voice.jitter, 2)}% · shimmer ${fmt(d.scan.voice.shimmer, 2)}% · HNR ${fmt(d.scan.voice.hnr, 1)} dB · MPT ${fmt(d.scan.voice.mpt, 1)} s`) : null,
        h('p', { class: 'disclaimer' }, 'Remote-photoplethysmography estimates from a consumer camera (POS algorithm); wellness-grade, not a medical device. Interpret alongside clinical examination.')) : null,
      trends.length ? h('div', null, h('h2', { style: { margin: '4px 0 12px' } }, '30-day trends vs personal baseline'), h('div', { class: 'grid-2' }, trends)) : null,
      h('div', { class: 'card stack' }, h('h2', null, 'Medications'),
        d.meds.length ? h('ul', { class: 'clean' }, d.meds.map((m) => h('li', null, `${m.name}${m.dose ? ' ' + m.dose : ''}${m.times && m.times.length ? ' — ' + m.times.join(', ') : ''}`))) : h('p', { class: 'muted' }, 'None recorded.'),
        d.med_findings.map((f) => h('div', { class: `rule ${f.severity === 'moderate' ? 'soon' : 'urgent'}` }, h('strong', null, f.title), h('div', { class: 'small' }, f.detail), f.meds && f.meds.length ? h('div', { class: 'src' }, f.meds.join(' + ')) : null))),
      h('form', { class: 'card stack no-print', onsubmit: async (e) => {
        e.preventDefault();
        if (!noteBox.value.trim()) return;
        try {
          await api(`/api/handoff/${encodeURIComponent(token)}/note`, { method: 'POST', body: { note: noteBox.value, author: author.value } });
          showNote(noteBox.value + (author.value ? `\n— ${author.value}` : ''), new Date().toISOString());
          noteBox.value = '';
          toast('Sent — the patient will see this in Nadi.');
        } catch (err) { toast(err.message, { bad: true }); }
      } }, h('h2', null, 'Reply to the patient'), noteBox, author, h('div', null, h('button', { class: 'btn primary', type: 'submit' }, icon('doctor', 18), 'Send note'))),
      noteHost,
      h('p', { class: 'disclaimer' }, 'Generated by Nadi, a patient-facing triage and wellness aid. Differentials are AI-suggested and unverified. Shared with explicit patient consent; access is time-limited and logged.')),
  );
  root._dispose = () => { for (const fn of disposers) fn(); };
  return root;
}
