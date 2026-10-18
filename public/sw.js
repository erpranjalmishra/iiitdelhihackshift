// Service worker: makes the app shell available offline. Health data (/api/*) is never cached here.
const CACHE = 'nadi-shell-v1';
const SHELL = [
  '/', '/index.html', '/styles.css', '/app.mjs', '/manifest.webmanifest', '/icons/icon.svg',
  '/lib/ui.mjs', '/lib/api.mjs', '/lib/i18n.mjs', '/lib/charts.mjs', '/lib/dsp.mjs', '/lib/rppg-core.mjs', '/lib/rppg.mjs',
  '/lib/voice-core.mjs', '/lib/voice.mjs', '/lib/voice-worklet.js',
  '/views/home.mjs', '/views/scan.mjs', '/views/check.mjs', '/views/twin.mjs', '/views/meds.mjs', '/views/share.mjs',
  '/views/settings.mjs', '/views/doctor.mjs', '/views/pair.mjs', '/views/welcome.mjs',
];

self.addEventListener('install', (e) => {
  // Cache files one by one: a single failure must not abort installation.
  e.waitUntil(caches.open(CACHE)
    .then((c) => Promise.allSettled(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Network first (so updates appear immediately), cache as the offline fallback.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => { /* cache is best-effort */ }); }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('/index.html'))),
  );
});
