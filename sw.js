// Coralcrafter – Service Worker
// Todo o app é local (sem CDN), então funciona 100% offline depois da primeira visita.
// Mude a versão abaixo para forçar a atualização do cache.
const CACHE_NAME = 'coralcrafter-v3';

const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './audio.js',
  './io.js',
  './demos.js',
  './app.js',
  './manifest.json',
  './icon-72x72.png',
  './icon-96x96.png',
  './icon-128x128.png',
  './icon-144x144.png',
  './icon-152x152.png',
  './icon-192x192.png',
  './icon-384x384.png',
  './icon-512x512.png',
  './icon-maskable-192x192.png',
  './icon-maskable-512x512.png',
  './apple-touch-icon.png',
  './favicon-32x32.png'
];
PRECACHE_URLS.push('./coral-voices.bin'); // amostras de coro (98 MP3 empacotados)

// ── Install: pré-cache dos arquivos locais ───────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: remove caches antigos ─────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: rede primeiro para navegação e arquivos do app (sempre a versão
//    mais nova quando online), cache como reserva offline ─────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(request, { ignoreSearch: true }).then((cached) =>
          cached || (request.mode === 'navigate' ? caches.match('./index.html') : undefined)
        )
      )
  );
});
