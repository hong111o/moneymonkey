/*
 * MoneyMonkey service worker: lets the app open offline.
 * Network-first for the app's own files (so updates show up straight away), falling back
 * to the cached copy when offline. Price, FX and GitHub requests are never cached.
 */
const CACHE = 'moneymonkey-v49';
const SHELL = [
  './', 'index.html', 'css/styles.css', 'manifest.webmanifest',
  'js/calc.js', 'js/prices.js', 'js/charts.js', 'js/icons.js', 'js/sync.js',
  'js/app/00-core.js', 'js/app/01-sections.js', 'js/app/02-dashboard.js', 'js/app/03-lists.js', 'js/app/04-cashflow.js', 'js/app/05-trading.js', 'js/app/06-reports.js', 'js/app/07-forms.js', 'js/app/08-payments.js', 'js/app/09-data.js', 'js/app/10-ui.js', 'js/app/11-layout.js', 'js/app/12-main.js',
  'icons/favicon-32.png', 'icons/favicon-64.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    // `no-cache` checks with the server every time, so a new version isn't held back by the
    // browser's HTTP cache (GitHub Pages lets browsers keep files for 10 minutes).
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html')))
  );
});
