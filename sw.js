const CACHE_NAME = 'bookclip-v1';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './fonts/Pretendard-Regular.woff2',
  './fonts/YeongdeokSea.woff2',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('bookclip-') && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function refreshInBackground(request, cache) {
  return fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.hostname === 'www.googleapis.com' || url.origin !== self.location.origin || event.request.method !== 'GET') return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match('./index.html', { ignoreSearch: true });
        const refresh = refreshInBackground(new Request('./index.html'), cache);
        if (cached) {
          event.waitUntil(refresh);
          return cached;
        }
        return (await refresh) || Response.error();
      })
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request, { ignoreSearch: true });
      const refresh = refreshInBackground(event.request, cache);
      if (cached) {
        event.waitUntil(refresh);
        return cached;
      }
      return (await refresh) || Response.error();
    })
  );
});
