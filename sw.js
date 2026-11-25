// Folio's service worker: makes the app installable and usable offline, and makes sure a
// new deploy reaches installed copies. (Cache and message names still say "bookscan", the
// app's first name: renaming them would only throw away what installed copies have cached.)
const SHELL = 'bookscan-shell-v2';   // only renamed when the cache layout changes; updates are detected by content
const VENDOR = 'bookscan-vendor-v1'; // big, rarely changing libraries (OCR, barcode fallback)
const SHARE = 'bookscan-share-v1';   // what another app just shared to this one, until the page picks it up

const MODULES = ['app.js', 'works.js', 'terms.js', 'corners.js', 'backup.js', 'national.js', 'site.js', 'screensaver.js', 'lang-nl.js'];   // imported by one another: refreshed together
const BYPASS = /\/(api|admin|django-static|covers|u)\//;   // never cached here; see the fetch handler (u/: a public library's page)

const SHELL_FILES = [
  './',
  'styles.css',
  'theme.js',
  'app.js',
  'works.js',
  'terms.js',
  'corners.js',
  'backup.js',
  'national.js',
  'site.js',
  'screensaver.js',
  'lang-nl.js',
  'manifest.webmanifest',
  'icons/favicon-48.png',
  'icons/mark-96.png',
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
    await Promise.all(names.filter((n) => n.startsWith('bookscan-') && n !== SHELL && n !== VENDOR && n !== SHARE).map((n) => caches.delete(n)));
    // Nothing in the shell has a query string, and covers are no longer kept here: entries
    // like that are leftovers that can only stand in the way of the real ones.
    const shell = await caches.open(SHELL);
    const strays = (await shell.keys()).filter((r) => { const u = new URL(r.url); return u.search || BYPASS.test(u.pathname); });
    await Promise.all(strays.map((r) => shell.delete(r)));
    // Text recognition reads only printed ISBNs now, in English: the other languages can go.
    const vendor = await caches.open(VENDOR);
    const unread = (await vendor.keys()).filter((r) => /\/vendor\/tesseract\/lang\/(?!eng\.)/.test(new URL(r.url).pathname));
    await Promise.all(unread.map((r) => vendor.delete(r)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Book lookups and cover images go straight to the network.
  // Sharing a page, some text or a picture to the app (share_target in the manifest) arrives
  // as a form posted to an address no server answers. It is kept here and the app is opened.
  if (request.method === 'POST' && url.origin === self.location.origin && url.pathname === new URL('share', self.registration.scope).pathname) {
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // The sync server (API, admin and its assets) is never cached. Nor are cover thumbnails:
  // there can be thousands, and the browser's own cache keeps the ones it has seen.
  if (BYPASS.test(url.pathname)) return;

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

async function receiveShare(request) {
  try {
    const form = await request.formData();
    const cache = await caches.open(SHARE);
    const said = { title: form.get('title') || '', text: form.get('text') || '', url: form.get('url') || '', at: Date.now() };
    await cache.put('shared', new Response(JSON.stringify(said), { headers: { 'Content-Type': 'application/json' } }));
    const picture = form.getAll('picture').find((file) => file && file.size && String(file.type).startsWith('image/'));
    if (picture) await cache.put('shared-picture', new Response(picture, { headers: { 'Content-Type': picture.type } }));
    else await cache.delete('shared-picture');
  } catch (err) {
    console.warn('Folio: could not keep what was shared', err);
  }
  return Response.redirect(new URL('./?shared', self.registration.scope).href, 303);
}

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
  // A navigation's key is './' whatever its query string, so it is matched exactly: with
  // ignoreSearch an older entry such as './?x' would be found first and never be refreshed.
  const hit = await cache.match(key);
  // The copy handed to the page gets consumed, so keep a clone to compare the fresh one against.
  const refresh = revalidate(cache, key, navigation ? './' : request.url, hit?.clone());
  if (hit) {
    event.waitUntil(refresh.catch((err) => console.warn('Folio: refresh failed', err)));
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
      // The app's modules import one another: all of them are fresh in the cache before the page
      // reloads, so it can't come back with a new app.js next to an old works.js. (A page that is
      // still loading keeps the set it started with: nothing is put in the cache under it before.)
      await Promise.all(MODULES.map((url) => fetch(url, { cache: 'no-cache' }).then((r) => (r.ok ? cache.put(url, r) : null)).catch(() => {})));
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
