// service-worker.js — cache-first for static assets (scoped to /cards-pwa/)
const CACHE = 'cards-pwa-subpath-v1';
const BASE = '/cards-pwa';
const ASSETS = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/app.js',
  BASE + '/manifest.webmanifest',
  BASE + '/icon-192.png',
  BASE + '/icon-512.png',
  BASE + '/apple-touch-icon-180.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(ASSETS);
    self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => k===CACHE ? null : caches.delete(k)));
    self.clients.claim();
  })());
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  e.respondWith((async () => {
    const cached = await caches.match(req, {ignoreSearch:true});
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (req.method === 'GET' && new URL(req.url).origin === self.location.origin && new URL(req.url).pathname.startsWith(BASE)) {
        const c = await caches.open(CACHE);
        c.put(req, res.clone());
      }
      return res;
    } catch (err) {
      return cached || new Response('Offline', {status:503});
    }
  })());
});
