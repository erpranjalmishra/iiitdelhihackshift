// Nadi app shell: router, layout, theme, language, session and offline handling.
import { h, mount, icon, toast } from './lib/ui.mjs';
import { api, flushQueue, queuedCount } from './lib/api.mjs';
import { t, getLang, setLang } from './lib/i18n.mjs';

const VIEWS = {
  '': () => import('./views/home.mjs'),
  scan: () => import('./views/scan.mjs'),
  check: () => import('./views/check.mjs'),
  twin: () => import('./views/twin.mjs'),
  meds: () => import('./views/meds.mjs'),
  share: () => import('./views/share.mjs'),
  settings: () => import('./views/settings.mjs'),
  doctor: () => import('./views/doctor.mjs'),
  pair: () => import('./views/pair.mjs'),
  welcome: () => import('./views/welcome.mjs'),
};
const NAV = [
  ['', 'home', 'nav_home'], ['scan', 'scan', 'nav_scan'], ['check', 'check', 'nav_check'], ['twin', 'twin', 'nav_twin'],
  ['meds', 'pill', 'nav_meds'], ['share', 'share', 'nav_share'], ['settings', 'settings', 'nav_settings'],
];

export const app = {
  session: null, profile: null, ai: null, meta: null, current: null, root: document.getElementById('app'),
  lang: getLang,
  go(path) { location.hash = `#/${path}`; },
  async refreshProfile() { const r = await api('/api/profile'); app.profile = r.profile; return r; },
  async refreshAi() { try { app.ai = await api('/api/ai/status'); } catch { app.ai = null; } updateEnginePill(); },
  rerender() { render(); },
};

/* ---------- theme ---------- */
const THEMES = ['system', 'light', 'dark'];
function getTheme() { try { return localStorage.getItem('nadi.theme') || 'system'; } catch { return 'system'; } }
export function applyTheme(theme = getTheme()) {
  try { localStorage.setItem('nadi.theme', theme); } catch { /* ignore */ }
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
app.applyTheme = applyTheme;
app.getTheme = getTheme;

/* ---------- shell ---------- */
let enginePill = null;
function updateEnginePill() {
  if (!enginePill) return;
  const ai = app.ai;
  const on = ai && ai.provider === 'gemini';
  mount(enginePill, 
    h('span', { class: ['dot', on ? 'on' : 'warn'] }),
    on ? `Gemini${ai.model ? ' · ' + ai.model.replace(/^gemini-/, '') : ''}` : getLang() === 'hi' ? 'ऑफ़लाइन इंजन' : 'Offline engine',
  );
  enginePill.title = on ? 'AI: Google Gemini, with deterministic safety guardrails' : 'AI: built-in offline clinical engine (add a Gemini key in Settings)';
}

function langToggle() {
  const cur = getLang();
  return h('div', { class: 'seg', role: 'group', 'aria-label': 'Language' },
    h('button', { type: 'button', 'aria-pressed': String(cur === 'en'), onclick: () => switchLang('en') }, 'EN'),
    h('button', { type: 'button', 'aria-pressed': String(cur === 'hi'), onclick: () => switchLang('hi') }, 'हिं'),
  );
}

async function switchLang(l) {
  setLang(l);
  if (app.profile && app.session && app.session.patient) {
    try { await api('/api/profile', { method: 'PUT', body: { ...app.profile, language: l } }); app.profile.language = l; } catch { /* keep local choice */ }
  }
  render();
}

function themeButton() {
  const cur = getTheme();
  const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
  return h('button', { class: 'btn ghost sm', type: 'button', title: `Theme: ${cur} (click for ${next})`, onclick: () => { applyTheme(next); render(); } },
    icon(cur === 'dark' ? 'moon' : cur === 'light' ? 'sun' : 'globe', 16),
    (getLang() === 'hi' ? { system: 'ऑटो', dark: 'डार्क', light: 'लाइट' } : { system: 'Auto', dark: 'Dark', light: 'Light' })[cur] || cur);
}

function logo(size = 30) {
  return h('span', { style: { color: 'var(--brand)', display: 'inline-flex' } }, icon('logo', size));
}

function shell(active, content) {
  enginePill = h('span', { class: 'engine-pill' });
  updateEnginePill();
  const link = ([path, ic, key]) => h('a', { href: `#/${path}`, 'aria-current': active === path ? 'page' : null }, icon(ic, 20), t(key));
  const offline = h('div', { class: ['offline-bar', navigator.onLine ? 'hide' : ''], role: 'status' }, t('offline'));
  window.__nadiOffline = offline;
  return h('div', { class: 'shell' },
    h('aside', { class: 'sidebar' },
      h('a', { class: 'brand', href: '#/' }, logo(), h('div', null, h('div', { class: 'brand-name' }, 'Nadi'), h('div', { class: 'brand-sub' }, t('tagline')))),
      h('nav', { class: 'nav', 'aria-label': 'Main' }, NAV.map(link)),
      h('div', { class: 'sidebar-foot' }, enginePill, h('div', { class: 'row' }, langToggle(), themeButton()))),
    h('div', { class: 'main' },
      offline,
      h('header', { class: 'topbar' },
        h('a', { class: 'brand', href: '#/' }, logo(26), h('span', { class: 'brand-name' }, 'Nadi')),
        h('div', { class: 'row' }, langToggle(),
          h('a', { class: 'btn ghost icon', href: '#/share', 'aria-label': t('nav_share') }, icon('share', 20)),
          h('a', { class: 'btn ghost icon', href: '#/settings', 'aria-label': t('nav_settings') }, icon('settings', 20)))),
      h('main', { id: 'main', tabindex: '-1' }, content)),
    h('nav', { class: 'bottom-nav', 'aria-label': 'Main' }, NAV.slice(0, 5).map(([path, ic, key]) =>
      h('a', { href: `#/${path}`, 'aria-current': active === path ? 'page' : null }, icon(ic, 22), t(key)))),
  );
}

function notPaired() {
  return h('div', { class: 'welcome' }, h('div', { class: 'card stack-lg', style: { maxWidth: '520px' } },
    h('div', { class: 'row' }, logo(36), h('h1', null, 'Nadi')),
    h('div', { class: 'notice info' }, icon('lock', 20), h('div', null,
      h('strong', null, 'This device is not paired. '),
      'Health data stays on the computer running Nadi. To use this phone, open Settings → "Use on your phone" on that computer and scan the QR code.')),
    h('p', { class: 'muted small' }, 'Doctors: open the link the patient shared with you — it works without pairing.'),
  ));
}

/* ---------- router ---------- */
// Each navigation gets a number. A view that finishes loading after the user has already moved on
// (e.g. a slow Settings page overtaken by a quick Meds click) is disposed instead of being mounted.
let renderSeq = 0;
const dispose = (el) => { if (el && typeof el._dispose === 'function') { try { el._dispose(); } catch { /* ignore */ } } };

async function render() {
  const seq = ++renderSeq;
  const stale = () => seq !== renderSeq;
  const [name = '', ...args] = location.hash.replace(/^#\/?/, '').split('/');
  dispose(app.current);
  app.current = null;
  const loader = VIEWS[name];
  if (!loader) { app.go(''); return; }

  const show = async (target) => {
    const mod = await loader();
    if (stale()) return;
    const el = await mod.render({ app, args });
    if (stale()) { dispose(el); return; }
    app.current = el;
    mount(target(), el);
  };

  // Public, standalone pages.
  if (name === 'doctor' || name === 'pair') return show(() => app.root);
  if (!app.session) app.session = await api('/api/session').catch(() => ({ patient: false }));
  if (stale()) return;
  if (!app.session.patient) { mount(app.root, notPaired()); return; }
  if (!app.profile) { try { await app.refreshProfile(); } catch { /* handled below */ } }
  if (stale()) return;
  if (!app.profile && name !== 'welcome') { app.go('welcome'); return; }
  if (name === 'welcome') return show(() => app.root);

  const placeholder = h('div', { class: 'page' }, h('div', { class: 'row muted' }, h('span', { class: 'spinner' }), getLang() === 'hi' ? 'लोड हो रहा है…' : 'Loading…'));
  mount(app.root, shell(name, placeholder));
  try {
    await show(() => document.getElementById('main'));
    if (!stale()) document.title = `${name ? t(`nav_${name}`) + ' · ' : ''}Nadi`;
  } catch (e) {
    if (stale()) return;
    console.error(e);
    const main = document.getElementById('main');
    if (main) mount(main, h('div', { class: 'page' }, h('div', { class: 'notice bad' }, icon('alert', 20), String(e.message || e))));
  }
}

/* ---------- boot ---------- */
async function boot() {
  applyTheme();
  setLang(getLang());
  try { app.session = await api('/api/session'); } catch { app.session = { patient: false }; }
  if (app.session.patient) {
    app.refreshAi();
    try { await app.refreshProfile(); if (app.profile && app.profile.language && app.profile.language !== getLang()) setLang(app.profile.language); } catch { /* first run */ }
  }
  window.addEventListener('hashchange', render);
  window.addEventListener('online', async () => {
    window.__nadiOffline && window.__nadiOffline.classList.add('hide');
    const n = await flushQueue();
    if (n) toast(`Synced ${n} reading${n > 1 ? 's' : ''} saved while offline.`);
  });
  window.addEventListener('offline', () => window.__nadiOffline && window.__nadiOffline.classList.remove('hide'));
  if (queuedCount() && navigator.onLine) flushQueue().then((n) => n && toast(`Synced ${n} offline reading${n > 1 ? 's' : ''}.`));
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* optional */ });
  }
  render();
}

boot();
