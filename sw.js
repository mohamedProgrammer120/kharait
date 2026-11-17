// Kharait offline shell cache. Never cache authenticated API responses or user data.
const CACHE = 'kharait-shell-v3';
const STATIC_DESTINATIONS = new Set(['document','script','style','image','font']);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.add('./'))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // API responses can contain private account state; Cache API ignores HTTP no-store.
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/auth/')) return;
  if (request.cache === 'no-store' || !STATIC_DESTINATIONS.has(request.destination)) return;

  event.respondWith(
    fetch(request).then(response => {
      if (!response || !response.ok || response.type === 'opaque' ||
          /no-store|private/i.test(response.headers.get('Cache-Control') || '')) return response;
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)));
      return response;
    }).catch(async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') return (await caches.match('./')) || Response.error();
      return Response.error();
    })
  );
});
