/* Trip Inspector DRIVER · Trip Report — service worker: whole app offline, OCR files cached on first use */
const VERSION = 'ti-trip-report-v1.1.0';
const SHELL = ['./', './index.html', './manifest.webmanifest', './js/towns.js', './js/app.js', './js/report.js',
  './lib/jspdf.umd.min.js', './lib/jspdf.plugin.autotable.min.js',
  './assets/logo_header.jpg', './assets/logo_full_black.jpg', './assets/logo_report.jpg', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png',
  './fonts/rokkitt-latin-400-normal.woff2', './fonts/rokkitt-latin-700-normal.woff2', './fonts/special-elite-latin-400-normal.woff2'];
self.addEventListener('install', e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL))));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== VERSION && x !== 'ti-ocr').map(x => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener('message', e => { if (e.data === 'skip') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname.includes('/lib/tesseract/')) {
    e.respondWith(caches.open('ti-ocr').then(c => c.match(e.request).then(r => r || fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; }))));
    return;
  }
  if (e.request.mode === 'navigate') { e.respondWith(caches.match('./index.html').then(r => r || fetch(e.request))); return; }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
