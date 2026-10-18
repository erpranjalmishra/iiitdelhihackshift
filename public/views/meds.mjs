import { h, icon, toast, confirmDialog, mount } from '../lib/ui.mjs';
import { api } from '../lib/api.mjs';
import { t, getLang } from '../lib/i18n.mjs';

const SLOTS = [['morning', 'Morning', 'सुबह'], ['afternoon', 'Afternoon', 'दोपहर'], ['evening', 'Evening', 'शाम'], ['night', 'Night', 'रात']];
const SEV = { contraindicated: ['emergency', 'Never combine', 'कभी साथ न लें'], high: ['urgent', 'High risk', 'उच्च जोखिम'], moderate: ['soon', 'Caution', 'सावधानी'] };

export async function render() {
  const lang = getLang();
  const L = (en, hi) => (lang === 'hi' ? hi : en);
  const page = h('div', { class: 'page' });
  const body = h('div', { class: 'stack-lg' });
  let form = null;

  async function draw(data) {
    const d = data || (await api('/api/meds'));
    const active = d.meds.filter((m) => m.active);
    const parts = [];

    // Safety findings first: this is what prevents harm.
    if (d.analysis.findings.length) {
      parts.push(h('div', { class: 'card stack' }, h('div', { class: 'card-head', style: { marginBottom: 0 } }, h('h2', { class: 'row', style: { gap: '8px' } }, icon('shield', 20), L('Safety check of your medicines', 'आपकी दवाओं की सुरक्षा जाँच')), h('span', { class: 'tag' }, `${d.analysis.findings.length} ${L('finding(s)', 'चेतावनी')}`)),
        d.analysis.findings.map((f) => h('div', { class: `rule ${SEV[f.severity][0]}` },
          h('div', { class: 'row between' }, h('strong', null, f.title), h('span', { class: `sev ${SEV[f.severity][0]}` }, h('span', { class: 'swatch' }), SEV[f.severity][lang === 'hi' ? 2 : 1])),
          h('div', { class: 'small' }, f.detail), h('div', { class: 'small' }, h('strong', null, L('What to do: ', 'क्या करें: ')), f.advice),
          f.meds && f.meds.length ? h('div', { class: 'src' }, f.meds.join(' + ')) : null)),
        h('p', { class: 'disclaimer' }, L('Interaction checks are informational. Always confirm with your doctor or pharmacist before stopping or changing a medicine.', 'यह जानकारी के लिए है। दवा बदलने से पहले डॉक्टर/फार्मासिस्ट से पूछें।'))));
    } else if (active.length) {
      parts.push(h('div', { class: 'notice' }, icon('ok', 18), L(`No known interactions or duplicate ingredients among your ${active.length} medicines.`, `आपकी ${active.length} दवाओं में कोई ज्ञात टकराव नहीं।`)));
    }

    // Today's schedule.
    const doses = [];
    for (const m of active) for (const s of m.times) doses.push({ m, s });
    const order = Object.fromEntries(SLOTS.map(([k], i) => [k, i]));
    doses.sort((a, b) => order[a.s] - order[b.s]);
    const schedule = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, t('todays_meds')), h('span', { class: 'muted small' }, new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }))),
      doses.length ? doses.map(({ m, s }) => {
        const status = m.today[s];
        const btn = h('button', { class: 'btn sm dose-btn', type: 'button', 'aria-pressed': String(status === 'taken'), onclick: async () => {
          try { draw(await api(`/api/meds/${m.id}/dose`, { method: 'POST', body: { slot: s, status: status === 'taken' ? null : 'taken' } })); } catch (e) { toast(e.message, { bad: true }); }
        } }, status === 'taken' ? icon('ok', 16) : null, status === 'taken' ? t('taken') : t('mark'));
        return h('div', { class: 'dose' }, h('div', null, h('div', { style: { fontWeight: 650 } }, m.name, m.dose ? h('span', { class: 'muted small' }, ` · ${m.dose}`) : null),
          h('div', { class: 'muted tiny' }, SLOTS.find(([k]) => k === s)[lang === 'hi' ? 2 : 1])), btn);
      }) : h('p', { class: 'muted' }, L('No scheduled doses.', 'कोई निर्धारित खुराक नहीं।')));

    // Adherence: stat + 7-day grid.
    const a7 = d.adherence7;
    const dayGrid = h('div', { class: 'days' }, a7.perDay.map((x) => {
      const cls = !x.expected ? '' : x.taken >= x.expected ? 'full' : x.taken ? 'part' : '';
      return h('div', { class: 'd' }, h('i', { class: cls, title: `${x.taken}/${x.expected}` }, x.expected ? `${x.taken}/${x.expected}` : '·'), new Date(x.day).toLocaleDateString(undefined, { weekday: 'narrow' }));
    }));
    const adherence = h('div', { class: 'card stack' }, h('h2', null, L('Adherence', 'नियमितता')),
      h('div', { class: 'row', style: { gap: '28px' } },
        h('div', { class: 'stat' }, h('div', { class: 'label' }, L('Last 7 days', 'पिछले 7 दिन')), h('div', { class: 'value' }, a7.rate != null ? `${a7.rate}%` : '—')),
        h('div', { class: 'stat' }, h('div', { class: 'label' }, L('Last 30 days', 'पिछले 30 दिन')), h('div', { class: 'value' }, d.adherence30.rate != null ? `${d.adherence30.rate}%` : '—'))),
      dayGrid, h('p', { class: 'muted tiny' }, L('Each box shows doses taken / doses due that day. Doses not yet due today are not counted as missed.', 'हर बॉक्स: ली गई / निर्धारित खुराक।')));

    // Medicine list.
    const list = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, L('My medicines', 'मेरी दवाएँ'))),
      d.meds.length ? d.meds.map((m) => h('div', { class: 'dose' },
        h('div', { class: 'stack', style: { gap: '2px' } },
          h('div', { style: { fontWeight: 650 } }, m.name, m.dose ? h('span', { class: 'muted small' }, ` · ${m.dose}`) : null, !m.active ? h('span', { class: 'tag', style: { marginLeft: '6px' } }, L('paused', 'रुकी हुई')) : null),
          h('div', { class: 'muted tiny' }, (m.ingredients && m.ingredients.length ? m.ingredients.join(' + ') : L('ingredients not recognised — add them for safety checks', 'घटक पहचाने नहीं गए')) + (m.times.length ? ` · ${m.times.join(', ')}` : '')),
          m.notes ? h('div', { class: 'muted tiny' }, m.notes) : null),
        h('div', { class: 'row', style: { flexWrap: 'nowrap' } },
          h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => { try { draw(await api(`/api/meds/${m.id}`, { method: 'PUT', body: { active: !m.active } })); } catch (e) { toast(e.message, { bad: true }); } } }, m.active ? L('Pause', 'रोकें') : L('Resume', 'फिर शुरू')),
          h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': `Delete ${m.name}`, onclick: async () => {
            if (!(await confirmDialog(L(`Remove ${m.name}?`, `${m.name} हटाएँ?`)))) return;
            try { draw(await api(`/api/meds/${m.id}`, { method: 'DELETE' })); } catch (e) { toast(e.message, { bad: true }); }
          } }, icon('trash', 16))))) : h('p', { class: 'muted' }, L('No medicines yet.', 'अभी कोई दवा नहीं।')));

    form = form || addForm(draw); // one form for the page's lifetime: typed text survives redraws
    parts.push(h('div', { class: 'grid-2' }, schedule, adherence), list, form);
    mount(body, ...parts);
  }

  function addForm(draw) {
    const name = h('input', { class: 'input', placeholder: L('Brand or generic, e.g. Dolo 650, Telma 40, metformin', 'ब्रांड या जेनेरिक नाम'), maxlength: 80 });
    const dose = h('input', { class: 'input', placeholder: L('e.g. 650 mg or 1 tablet', 'जैसे 650 mg'), maxlength: 40 });
    const notes = h('input', { class: 'input', placeholder: L('Why you take it (optional)', 'क्यों लेते हैं (वैकल्पिक)'), maxlength: 200 });
    const resolved = h('div', { class: 'muted small' }, '');
    let timer = 0;
    name.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (!name.value.trim()) { resolved.textContent = ''; return; }
        try {
          const r = await api(`/api/meds/resolve?name=${encodeURIComponent(name.value)}`);
          resolved.textContent = r.ingredients.length ? `${L('Contains', 'घटक')}: ${r.ingredients.join(' + ')}` : L('Not recognised — interaction checks may miss it.', 'पहचाना नहीं गया।');
        } catch { /* ignore */ }
      }, 250);
    });
    const slots = new Set(['morning']);
    const slotChips = h('div', { class: 'chips' }, SLOTS.map(([k, en, hi]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(slots.has(k)), onclick: (e) => {
      if (slots.has(k)) slots.delete(k); else slots.add(k);
      e.currentTarget.setAttribute('aria-pressed', String(slots.has(k)));
    } }, lang === 'hi' ? hi : en)));
    return h('form', { class: 'card stack', onsubmit: async (e) => {
      e.preventDefault();
      if (!name.value.trim()) { name.focus(); return; }
      try {
        const d = await api('/api/meds', { method: 'POST', body: { name: name.value, dose: dose.value, notes: notes.value, times: [...slots] } });
        toast(L(`${name.value} added — safety check updated.`, `${name.value} जोड़ी गई।`));
        draw(d);
        name.value = ''; dose.value = ''; notes.value = ''; resolved.textContent = '';
      } catch (err) { toast(err.message, { bad: true }); }
    } },
      h('h2', null, t('add_med')),
      h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', null, L('Medicine', 'दवा')), name, resolved), h('label', { class: 'field' }, h('span', null, L('Dose', 'खुराक')), dose)),
      h('div', { class: 'field' }, h('span', null, L('When', 'कब')), slotChips),
      h('label', { class: 'field' }, h('span', null, L('Notes', 'नोट')), notes),
      h('div', null, h('button', { class: 'btn primary', type: 'submit' }, icon('plus', 18), t('add_med'))),
      h('p', { class: 'muted tiny' }, L('Tip: ask the chemist for the generic at a Jan Aushadhi Kendra — usually much cheaper for the same medicine.', 'सुझाव: जन औषधि केंद्र पर जेनेरिक दवा सस्ती मिलती है।')));
  }

  page.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, t('meds_title')), h('p', null, L('Doses, adherence, and a safety check that knows Indian brands — e.g. that Dolo 650 and Sinarest both contain paracetamol.', 'खुराक, नियमितता और भारतीय ब्रांड जानने वाली सुरक्षा जाँच।')))), body);
  await draw();
  return page;
}
