// Phone pairing: claims a one-time code from the computer's QR and stores an HttpOnly device cookie.
import { h, icon, toast } from '../lib/ui.mjs';
import { api } from '../lib/api.mjs';

export async function render({ app, args }) {
  const code = args[0] || '';
  const name = h('input', { class: 'input', placeholder: 'e.g. My phone', maxlength: 40 });
  const btn = h('button', { class: 'btn primary lg', type: 'submit' }, icon('link', 18), 'Pair this device');
  const secure = window.isSecureContext;
  return h('div', { class: 'welcome' }, h('form', { class: 'card stack-lg', style: { maxWidth: '480px' }, onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true;
    try {
      await api('/api/pair/claim', { method: 'POST', body: { code, name: name.value } });
      app.session = await api('/api/session');
      toast('Paired — this device can now use Nadi.');
      app.go('scan');
    } catch (err) { toast(err.message, { bad: true }); btn.disabled = false; }
  } },
    h('div', { class: 'row' }, h('span', { style: { color: 'var(--brand)', display: 'inline-flex' } }, icon('logo', 36)), h('h1', null, 'Pair with Nadi')),
    h('p', { class: 'ink-2' }, 'This lets this phone read and add to the health data stored on the computer running Nadi — useful for scanning with the phone camera.'),
    !secure ? h('div', { class: 'notice warn small' }, icon('lock', 16), 'This page is not on HTTPS, so the phone camera will not work here. Pairing still works; for scanning, open the https:// address shown on the computer.') : null,
    h('label', { class: 'field' }, h('span', null, 'Device name'), name),
    h('div', null, btn),
    h('p', { class: 'disclaimer' }, 'Only pair devices you own. You can remove paired devices any time in Settings on the computer.')));
}
