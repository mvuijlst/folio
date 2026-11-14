// Bookscan service worker: makes the app installable and usable offline,
// and makes sure a new deploy reaches installed copies.
const SHELL = 'bookscan-shell-v1';
const VENDOR = 'bookscan-vendor-v1'; // big, rarely changing libraries (OCR, barcode fallback)

const SHELL_FILES = [
  './',
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
  // 'reload' skips the browser's HTTP cache, so a new worker always starts from fresh files.
  event.waitUntil(caches.open(SHELL)
    .then((cache) => cache.addAll(SHELL_FILES.map((url) => new Request(url, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
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

  if (url.pathname.includes('/vendor/')) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(staleWhileRevalidate(event));
  }
});

// The app asks for a check when it comes back to the foreground.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'bookscan-check') return;
  event.waitUntil(caches.open(SHELL).then((cache) => Promise.all(SHELL_FILES.map((url) => revalidate(cache, url, url).catch(() => {})))));
});

async function cacheFirst(request) {
  const cache = await caches.open(VENDOR);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

// Serve from cache at once and refresh in the background. When a refresh brings
// different content, the open app is told so it can reload into the new version.
async function staleWhileRevalidate(event) {
  const { request } = event;
  const cache = await caches.open(SHELL);
  const navigation = request.mode === 'navigate';
  const key = navigation ? './' : request;
  const hit = await cache.match(key, { ignoreSearch: navigation });
  // The copy handed to the page gets consumed, so keep a clone to compare the fresh one against.
  const refresh = revalidate(cache, key, navigation ? './' : request.url, hit?.clone());
  if (hit) {
    event.waitUntil(refresh.catch((err) => console.warn('Bookscan: refresh failed', err)));
    return hit;
  }
  return refresh;
}

let pending = 0;
let changed = false;

async function revalidate(cache, key, url, known) {
  pending++;
  try {
    const previous = known || await cache.match(key);
    const response = await fetch(url, { cache: 'no-cache' });
    if (response.ok) {
      if (previous && !(await sameContent(previous, response.clone()))) changed = true;
      await cache.put(key, response.clone());
    }
    return response;
  } finally {
    // Announce once everything in flight has landed, so the reload sees a consistent set.
    if (--pending === 0 && changed) {
      changed = false;
      const windows = await self.clients.matchAll({ type: 'window' });
      windows.forEach((client) => client.postMessage({ type: 'bookscan-updated' }));
    }
  }
}

async function sameContent(a, b) {
  const etagA = a.headers.get('etag'), etagB = b.headers.get('etag');
  if (etagA && etagB) return etagA === etagB;
  const [x, y] = (await Promise.all([a.clone().arrayBuffer(), b.arrayBuffer()])).map((buf) => new Uint8Array(buf));
  return x.length === y.length && x.every((byte, i) => byte === y[i]);
}
