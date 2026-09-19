/* GlowApp service worker — precaches the shell so the app opens offline.
   Bump CACHE when any shell file changes; the old cache is dropped on
   activate. */
/* Bump together with the ?v= query in index.html: the two must agree or the
   precache stores URLs the page never asks for. */
const CACHE = 'glow-v5';

const SHELL = [
  './index.html',
  './styles.css?v=2.3',
  './sounds.js?v=2.3',
  './i18n.js?v=2.3',
  './charts.js?v=2.3',
  './app.js?v=2.3',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  /* Navigations go to the network first and fall back to the cached shell when
     offline. Answering every navigation from the cache would also swallow any
     other page served from this directory. */
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          /* Only refresh the shell from the app's own page, so a sibling page
             in this directory never overwrites it. */
          const isShell = url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
          if (isShell && response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('./index.html').then((cached) => cached || Response.error()))
    );
    return;
  }

  /* Assets: stale-while-revalidate. The cached copy answers instantly (and
     offline) while a background fetch refreshes it, so a new deploy lands on
     the next load instead of being pinned by the first version ever seen. */
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response && response.status === 200 && response.type === 'basic') {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    )
  );
});
