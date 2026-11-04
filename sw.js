// Service worker: makes the app work offline.
// Network first (so updates show up), cache as a fallback when offline.
const CACHE = 'russian-start-v13';
const FILES = ['./', 'index.html', 'style.css', 'data.js', 'family.js', 'family2.js', 'talk_beginner.js', 'talk_mid.js', 'talk_pro.js', 'gloss.js', 'levels.js', 'app.js', 'notes.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== self.location.origin) return; // never cache other sites (e.g. online translation)
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
