import { h, icon, fmt, toast, dateTimeLabel, confirmDialog, mount } from '../lib/ui.mjs';
import { api } from '../lib/api.mjs';
import { t, getLang } from '../lib/i18n.mjs';
import { trendChart } from '../lib/charts.mjs';
import { insightView } from './home.mjs';

const ICONS = { hr: 'heart', rmssd: 'wave', rr: 'lungs', stress: 'brain', temp_c: 'thermo', spo2: 'lungs', bp_sys: 'heart' };

export async function render({ app }) {
  const lang = getLang();
  const L = (en, hi) => (lang === 'hi' ? hi : en);
  let days = 30;
  const page = h('div', { class: 'page' });
  const body = h('div', { class: 'stack-lg' });
  const disposers = [];

  async function load() {
    body.style.opacity = '0.55'; // refetch keeps the frame; no skeleton flash
    let twin;
    try { twin = await api(`/api/twin?days=${days}`); } catch (e) { toast(e.message, { bad: true }); body.style.opacity = '1'; return; }
    for (const d of disposers.splice(0)) d();
    const parts = [];

    if (!twin.learning.ready) {
      const pct = Math.round((twin.learning.have / twin.learning.need) * 100);
      parts.push(h('div', { class: 'card stack' }, h('div', { class: 'row' }, icon('twin', 22), h('h2', null, L('Your twin is learning your normal', 'आपका ट्विन आपका सामान्य सीख रहा है'))),
        h('p', { class: 'ink-2' }, L(`${twin.learning.have} of ${twin.learning.need} resting scans so far. After ${twin.learning.need}, Nadi compares every reading with YOUR baseline instead of population averages.`, `${twin.learning.need} में से ${twin.learning.have} स्कैन।`)),
        h('div', { class: 'meter' }, h('i', { style: { width: `${pct}%` } })),
        h('div', null, h('a', { class: 'btn primary', href: '#/scan' }, icon('scan', 18), t('start_scan')))));
    }

    const insightBody = h('div', { class: 'stack' }, h('p', { class: 'muted' }, L('Ask AI to explain what changed over the selected period, compared with your own baseline.', 'चुनी गई अवधि में क्या बदला — AI से समझें।')));
    const insightBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
      insightBtn.disabled = true;
      mount(insightBody, h('div', { class: 'row muted' }, h('span', { class: 'spinner' }), L('Analysing…', 'विश्लेषण…')));
      try { mount(insightBody, insightView(await api('/api/twin/insights', { method: 'POST', body: { days: Math.min(days, 30), language: lang } }), lang)); }
      catch (e) { mount(insightBody, h('div', { class: 'notice bad' }, e.message)); }
      insightBtn.disabled = false;
    } }, icon('sparkle', 16), t('explain_trends'));
    parts.push(h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, t('ai_insight')), insightBtn), insightBody));

    const card = (key) => {
      const meta = twin.metrics[key];
      const pts = twin.series[key];
      if (!pts || pts.length < 2) return null; // a single reading is listed in the table below, not charted
      const b = twin.baseline[key];
      const last = pts[pts.length - 1];
      const chart = trendChart({ points: pts, band: b, unit: meta.unit, decimals: meta.decimals, label: lang === 'hi' ? meta.label_hi : meta.label, days, lang });
      disposers.push(chart._dispose);
      return h('div', { class: 'card stack' },
        h('div', { class: 'row between' },
          h('div', null, h('h2', { class: 'row', style: { gap: '8px' } }, icon(ICONS[key] || 'wave', 18), lang === 'hi' ? meta.label_hi : meta.label),
            h('div', { class: 'muted small' }, b && b.ready ? L(`Your normal: ${fmt(b.mean, meta.decimals)} ± ${fmt(b.sd, meta.decimals)} ${meta.unit} (${b.n} readings)`, `आपका सामान्य: ${fmt(b.mean, meta.decimals)} ± ${fmt(b.sd, meta.decimals)}`) : L('Baseline still learning', 'बेसलाइन बन रही है'))),
          h('div', { style: { textAlign: 'right' } }, h('div', { style: { fontSize: '24px', fontWeight: 700 } }, fmt(last.v, meta.decimals), h('small', { class: 'muted', style: { fontSize: '13px', marginLeft: '3px' } }, meta.unit)),
            h('div', { class: 'muted tiny' }, dateTimeLabel(last.t)))),
        chart);
    };
    const vitalCards = ['hr', 'rmssd', 'rr', 'stress'].map(card).filter(Boolean);
    if (vitalCards.length) parts.push(h('div', { class: 'grid-2' }, vitalCards));
    const manualCards = ['temp_c', 'spo2', 'bp_sys'].map(card).filter(Boolean);
    if (manualCards.length) parts.push(h('h2', null, L('Manual readings', 'मैन्युअल रीडिंग')), h('div', { class: 'grid-2' }, manualCards));
    if (!vitalCards.length && !manualCards.length) parts.push(h('div', { class: 'card empty' }, icon('twin', 32), h('p', null, L('No readings in this period yet.', 'इस अवधि में कोई रीडिंग नहीं।')), h('a', { class: 'btn primary', href: '#/scan' }, t('start_scan'))));

    // Reading log with delete (data stays under the person's control).
    const all = [];
    for (const [k, list] of Object.entries(twin.series)) for (const p of list) all.push({ ...p, key: k });
    const byId = new Map();
    for (const p of all) { const r = byId.get(p.id) || { id: p.id, t: p.t, context: p.context, source: p.source, quality: p.quality }; r[p.key] = p.v; byId.set(p.id, r); }
    const rows = [...byId.values()].sort((a, b) => Date.parse(b.t) - Date.parse(a.t)).slice(0, 40);
    if (rows.length) {
      parts.push(h('details', { class: 'card' }, h('summary', { style: { cursor: 'pointer', fontWeight: 650 } }, L(`All readings (${rows.length})`, `सभी रीडिंग (${rows.length})`)),
        h('div', { class: 'table-wrap', style: { marginTop: '10px' } }, h('table', { class: 'data' },
          h('thead', null, h('tr', null, ['When', 'HR', 'RMSSD', 'Breathing', 'Stress', 'Temp', 'BP', 'Source', 'Context', ''].map((x) => h('th', null, x)))),
          h('tbody', null, rows.map((r) => h('tr', null,
            h('td', null, dateTimeLabel(r.t)), h('td', null, fmt(r.hr)), h('td', null, fmt(r.rmssd)), h('td', null, fmt(r.rr, 1)), h('td', null, fmt(r.stress)),
            h('td', null, r.temp_c != null ? `${fmt(r.temp_c, 1)}°C` : '—'), h('td', null, r.bp_sys != null ? fmt(r.bp_sys) : '—'),
            h('td', null, r.source === 'manual' ? L('manual', 'मैन्युअल') : `${L('camera', 'कैमरा')}${r.quality != null ? ` · q${fmt(r.quality)}` : ''}`),
            h('td', null, (r.context || []).join(', ').replace(/_/g, ' ')),
            h('td', null, h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': 'Delete reading', onclick: async () => {
              if (!(await confirmDialog(L('Delete this reading?', 'यह रीडिंग हटाएँ?')))) return;
              try { await api(`/api/readings/${r.id}`, { method: 'DELETE' }); toast(L('Deleted', 'हटाया गया')); load(); } catch (e) { toast(e.message, { bad: true }); }
            } }, icon('trash', 16))))))))));
    }
    mount(body, ...parts);
    body.style.opacity = '1';
  }

  const presets = h('div', { class: 'seg', role: 'group', 'aria-label': 'Date range' }, [[7, L('7 days', '7 दिन')], [30, L('30 days', '30 दिन')], [90, L('90 days', '90 दिन')]].map(([d, label]) =>
    h('button', { type: 'button', 'aria-pressed': String(d === days), onclick: (e) => {
      days = d;
      for (const b of presets.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
      load();
    } }, label)));

  page.append(
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, t('twin_title')), h('p', null, t('twin_sub'))), h('a', { class: 'btn primary', href: '#/scan' }, icon('scan', 18), t('nav_scan'))),
    h('div', { class: 'row' }, presets, h('span', { class: 'muted small' }, L('Readings after exercise, caffeine or while unwell are shown but kept out of your baseline.', 'व्यायाम/चाय/बीमारी वाली रीडिंग बेसलाइन में शामिल नहीं।'))),
    body);
  await load();
  page._dispose = () => { for (const d of disposers) d(); };
  return page;
}
