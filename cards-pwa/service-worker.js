// service-worker.js — cache-first (relative scope)
const CACHE = 'cards-pwa-rel-v1';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon-180.png'
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
      if (req.method === 'GET' && new URL(req.url).origin === self.location.origin){
        const c = await caches.open(CACHE);
        c.put(req, res.clone());
      }
      return res;
    } catch (err) {
      return cached || new Response('Offline', {status:503});
    }
  })());
});
