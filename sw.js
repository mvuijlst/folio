// Bookscan service worker: makes the app installable and usable offline.
const SHELL = 'bookscan-shell-v2';   // bump to ship a new app version
const VENDOR = 'bookscan-vendor-v1'; // big, rarely changing libraries (OCR, barcode fallback)

const SHELL_FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'fonts/fraunces-latin-opsz-normal.woff2',
  'fonts/fraunces-latin-opsz-italic.woff2',
  'fonts/instrument-sans-latin-wght-normal.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('bookscan-') && n !== SHELL && n !== VENDOR).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Book lookups and cover images go straight to the network.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // The sync server (API, admin and its assets) is never cached.
  if (/\/(api|admin|django-static)\//.test(url.pathname)) return;

  if (url.pathname.includes('/vendor/')) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(staleWhileRevalidate(event));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(VENDOR);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

// Serve from cache at once, refresh in the background: updates show on the next launch.
async function staleWhileRevalidate(event) {
  const { request } = event;
  const cache = await caches.open(SHELL);
  const key = request.mode === 'navigate' ? './' : request;
  const hit = await cache.match(key, { ignoreSearch: request.mode === 'navigate' });
  const refresh = fetch(request).then((response) => {
    if (response.ok) cache.put(key, response.clone());
    return response;
  });
  if (hit) {
    event.waitUntil(refresh.catch(() => {}));
    return hit;
  }
  return refresh;
}
