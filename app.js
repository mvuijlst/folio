// Bookscan — catalog books by scanning their ISBN barcode.
// Plain ES module, no build step. The shelf is stored on the device (IndexedDB) and, for
// signed-in users, synced with the small Django server in server/.

const APP_VERSION = '1.2.0'; // shown under Settings, so you can tell which build is running

/* ───────────────────────── Helpers ───────────────────────── */

const $ = (id) => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Tiny hyperscript: h('div', {class: 'x', onclick: fn}, child, …) */
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid);
  return e;
}

function icon(name) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('class', 'icon');
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(SVG_NS, 'use');
  u.setAttribute('href', '#i-' + name);
  s.append(u);
  return s;
}

const fold = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const buzz = (ms = 35) => { try { navigator.vibrate?.(ms); } catch {} };
const abs = (path) => new URL(path, document.baseURI).href;

/* ───────────────────────── Settings ───────────────────────── */

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem('bookscan.' + key); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem('bookscan.' + key, JSON.stringify(value)); } catch {} },
};

const OCR_LANGS = { eng: 'English', nld: 'Nederlands', fra: 'Français', deu: 'Deutsch' };
const settings = {
  langs: store.get('langs', ['eng', 'nld', 'fra']).filter((l) => l in OCR_LANGS),
  googleKey: store.get('googleKey', ''),
};
if (!settings.langs.length) settings.langs = ['eng'];

function initTheme() {
  const apply = (t) => {
    document.documentElement.setAttribute('data-theme', t);
    document.querySelector('meta[name="theme-color"]').content = t === 'light' ? '#f7f3ec' : '#131210';
  };
  let theme = 'dark';
  try { theme = localStorage.getItem('bookscan.theme') || 'dark'; } catch {}
  apply(theme);
  $('themeToggle').addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('bookscan.theme', theme); } catch {}
    apply(theme);
  });
}

/* ───────────────────────── Storage (IndexedDB) ───────────────────────── */

const DB = (() => {
  let opening;
  const open = () => (opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('bookscan', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('books', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('books', mode);
      const req = fn(tx.objectStore('books'));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  };
  return {
    all: () => run('readonly', (s) => s.getAll()),
    put: (book) => run('readwrite', (s) => s.put(book)),
    del: (id) => run('readwrite', (s) => s.delete(id)),
  };
})();

/** In-memory copy of the shelf, newest first. */
let books = [];

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

async function addBook(data) {
  const book = {
    id: newId(), added: new Date().toISOString(),
    title: '', author: '', publisher: '', date: '', pages: null, isbn: '', cover: '', thumb: '',
    ...data,
  };
  books.unshift(book);
  touch(book.id, book);
  renderLibrary();
  await DB.put(book).catch(storageFailed);
  return book;
}

async function saveBook(book) {
  touch(book.id, book);
  renderLibrary();
  await DB.put(book).catch(storageFailed);
}

async function removeBook(book) {
  books = books.filter((b) => b.id !== book.id);
  touch(book.id);
  renderLibrary();
  await DB.del(book.id).catch(storageFailed);
}

async function restoreBook(book) {
  if (books.some((b) => b.id === book.id)) return;
  books.push(book);
  sortBooks();
  touch(book.id, book);
  renderLibrary();
  await DB.put(book).catch(storageFailed);
}

const sortBooks = () => books.sort((a, b) => (a.added < b.added ? 1 : -1));

function storageFailed(err) {
  console.error(err);
  toast('Could not save to this device’s storage');
}

/* ───────────────────────── Sync (optional account) ───────────────────────── */

// Signing in keeps a copy of the shelf on the server, so it can be opened on other devices.
// Every change stamps the book with `modified` and is remembered in `sync.dirty` until the
// server has it; the newest change to a book wins. Deleted books are sent as tombstones.
const sync = {
  user: store.get('syncUser', null),
  cursor: store.get('syncCursor', null),   // server time of the last completed sync
  dirty: store.get('syncDirty', {}),       // book id → `modified` of a change not yet on the server
  last: store.get('syncLast', null),       // when the last sync finished (this device's clock)
  error: '',
  running: null, again: false, timer: 0,
  box: null,                               // the account section, while the settings sheet shows it
};

function saveSyncState() {
  store.set('syncUser', sync.user);
  store.set('syncCursor', sync.cursor);
  store.set('syncDirty', sync.dirty);
  store.set('syncLast', sync.last);
}

/** Record a change to a book (pass the book) or its deletion (pass only the id). */
function touch(id, book) {
  const now = new Date().toISOString();
  if (book) book.modified = now;
  sync.dirty[id] = now;
  store.set('syncDirty', sync.dirty);
  scheduleSync();
}

function scheduleSync(ms = 1500) {
  if (!sync.user) return;
  clearTimeout(sync.timer);
  sync.timer = setTimeout(() => runSync(), ms);
}

function csrfToken() {
  return decodeURIComponent((document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1] || '');
}

async function api(path, data) {
  const url = abs('api/' + path);
  const post = () => fetch(url, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken() },
    body: JSON.stringify(data),
  });
  let res;
  if (data === undefined) {
    res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  } else {
    if (!csrfToken()) await fetch(abs('api/session'), { credentials: 'same-origin', cache: 'no-store' });
    res = await post();
    // No or stale CSRF cookie: fetch a fresh one and try once more.
    if (res.status === 403) { await fetch(abs('api/session'), { credentials: 'same-origin', cache: 'no-store' }); res = await post(); }
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `Server error ${res.status}`), { status: res.status });
  return json;
}

const time = (iso) => Date.parse(iso) || 0;

async function runSync({ loud = false } = {}) {
  if (!sync.user) return;
  if (navigator.onLine === false) { if (loud) toast('You’re offline — changes will sync later'); return; }
  if (sync.running) { sync.again = true; return sync.running; }
  clearTimeout(sync.timer);
  sync.running = (async () => {
    try {
      do {
        sync.again = false;
        const sent = { ...sync.dirty };
        const byId = new Map(books.map((b) => [b.id, b]));
        const changes = Object.entries(sent).map(([id, modified]) => {
          const book = byId.get(id);
          return book ? { id, modified, deleted: false, book } : { id, modified, deleted: true, book: null };
        });
        const res = await api('sync', { since: sync.cursor, changes });
        if (!sync.user) return;   // signed out meanwhile
        for (const [id, modified] of Object.entries(sent)) if (sync.dirty[id] === modified) delete sync.dirty[id];
        await applyRemote(res.changes || []);
        sync.cursor = res.cursor;
        sync.last = new Date().toISOString();
        sync.error = '';
        saveSyncState();
      } while (sync.again);
      if (loud) toast('Shelf synced');
    } catch (err) {
      if (err.status === 401) {
        forgetAccount();
        toast('Signed out — sign in again to keep syncing', { action: 'Sign in', onAction: openSettings });
      } else {
        sync.error = err.status ? err.message : 'Couldn’t reach the server';
        if (loud) toast(sync.error);
      }
    } finally {
      sync.running = null;
      renderAccount();
    }
  })();
  return sync.running;
}

/** Bring changes made on other devices into this one. */
async function applyRemote(changes) {
  if (!changes.length) return;
  for (const c of changes) {
    // A newer change made here wins; it goes up on the next round.
    if (sync.dirty[c.id] && time(sync.dirty[c.id]) >= time(c.modified)) continue;
    const local = books.find((b) => b.id === c.id);
    if (c.deleted) {
      if (!local) continue;
      books = books.filter((b) => b !== local);
      await DB.del(c.id).catch(storageFailed);
    } else {
      const book = { ...c.book, id: c.id, modified: c.modified };
      if (local) {
        // Keep the same object: an open edit form may hold it.
        for (const k of Object.keys(local)) delete local[k];
        Object.assign(local, book);
      } else {
        books.push(book);
      }
      await DB.put(local || book).catch(storageFailed);
    }
  }
  sortBooks();
  renderLibrary();
}

async function signIn(username, password) {
  const res = await api('login', { username, password });
  sync.user = res.user;
  sync.cursor = null;
  sync.error = '';
  // Offer everything on this device; books the server has newer copies of come back from it.
  for (const b of books) sync.dirty[b.id] ??= b.modified || b.added;
  saveSyncState();
  renderAccount();
  await runSync();
  toast(sync.error || `Signed in — ${plural(books.length, 'book')} on your shelf`);
}

function forgetAccount() {
  Object.assign(sync, { user: null, cursor: null, last: null, error: '' });
  clearTimeout(sync.timer);
  saveSyncState();
  renderAccount();
}

async function signOut({ clearShelf }) {
  if (Object.keys(sync.dirty).length && navigator.onLine !== false) await runSync();
  if (!sync.user) return;   // the session had already ended
  const waiting = Object.keys(sync.dirty).length;
  if (clearShelf && waiting) {
    toast(`${plural(waiting, 'change')} haven’t reached the server yet — sync before clearing this device`);
    return;
  }
  try { await api('logout', {}); } catch {}
  forgetAccount();
  if (clearShelf) {
    const gone = books;
    books = [];
    sync.dirty = {};
    saveSyncState();
    renderLibrary();
    await Promise.all(gone.map((b) => DB.del(b.id))).catch(storageFailed);
  }
  toast(clearShelf ? 'Signed out and cleared this device' : 'Signed out — your shelf stays on this device');
}

function agoText(iso) {
  const s = Math.round((Date.now() - time(iso)) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return plural(Math.round(s / 3600), 'hour') + ' ago';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** The account part of the settings sheet; re-rendered whenever sync state changes. */
function renderAccount() {
  const box = sync.box;
  if (!box?.isConnected) { sync.box = null; return; }

  if (!sync.user) {
    const user = h('input', { name: 'username', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', required: true });
    const pass = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true });
    const error = h('p', { class: 'field-error', hidden: true });
    const button = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Sign in');
    const form = h('form', {
      class: 'account-form',
      onsubmit: async (e) => {
        e.preventDefault();
        if (!user.value.trim() || !pass.value) { error.textContent = 'Enter your username and password.'; error.hidden = false; return; }
        button.disabled = true;
        error.hidden = true;
        try {
          await signIn(user.value.trim(), pass.value);
        } catch (err) {
          error.textContent = err.status ? err.message : 'Couldn’t reach the server. Are you online?';
          error.hidden = false;
          button.disabled = false;
        }
      },
    },
    h('div', { class: 'field-row' },
      h('label', { class: 'field' }, h('span', { text: 'Username' }), user),
      h('label', { class: 'field' }, h('span', { text: 'Password' }), pass)),
    error, button);
    box.replaceChildren(
      h('h3', { text: 'Account' }),
      form,
      h('p', { class: 'sheet-note', text: 'Optional. Signed in, your shelf is also kept on the server, so you can open it on your other devices. Ask the person who runs this site for an account.' }));
    return;
  }

  const waiting = Object.keys(sync.dirty).length;
  let status;
  if (sync.running) status = 'Syncing…';
  else if (sync.error) status = `${sync.error}.${waiting ? ` ${plural(waiting, 'change')} waiting.` : ''}`;
  else if (waiting) status = `${plural(waiting, 'change')} waiting to sync.`;
  else status = sync.last ? `Synced ${agoText(sync.last)}.` : 'Not synced yet.';

  box.replaceChildren(
    h('h3', { text: 'Account' }),
    h('p', { class: 'account-line' }, 'Signed in as ', h('strong', { text: sync.user })),
    h('p', { class: 'sheet-note account-status' + (sync.error ? ' is-error' : ''), text: status }),
    h('div', { class: 'stack account-actions' },
      h('button', { class: 'btn btn-outline btn-block', type: 'button', disabled: !!sync.running, onclick: () => runSync({ loud: true }) }, icon('sync'), 'Sync now'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-outline', type: 'button', text: 'Sign out', onclick: () => signOut({ clearShelf: false }) }),
        h('button', { class: 'btn btn-outline btn-danger', type: 'button', text: 'Sign out & clear', title: 'Sign out and remove the shelf from this device (it stays on the server)', onclick: () => signOut({ clearShelf: true }) }))),
    h('p', { class: 'sheet-note', text: '“Sign out & clear” removes the shelf from this device only; it stays on the server.' }));
}

/* ───────────────────────── ISBN & dates ───────────────────────── */

function isbn13Valid(d) {
  if (!/^\d{13}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(d[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(d[12]);
}

/** Accepts ISBN-10 or ISBN-13 in any punctuation; returns a 13-digit ISBN or null. */
function toIsbn13(input) {
  const d = String(input || '').toUpperCase().replace(/[^0-9X]/g, '');
  if (d.length === 13) return isbn13Valid(d) && /^97[89]/.test(d) ? d : null;
  if (d.length !== 10 || !/^\d{9}[\dX]$/.test(d)) return null;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (d[i] === 'X' ? 10 : Number(d[i])) * (10 - i);
  if (sum % 11 !== 0) return null;
  const core = '978' + d.slice(0, 9);
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(core[i]) * (i % 2 ? 3 : 1);
  return core + ((10 - (s % 10)) % 10);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monthNo = (name) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
const pad2 = (n) => String(n).padStart(2, '0');

/** Normalises the many date spellings in book databases to YYYY, YYYY-MM or YYYY-MM-DD. */
function normDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  let m;
  if ((m = s.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?(?:T.*)?$/))) {
    return [m[1], m[2] && pad2(m[2]), m[2] && m[3] && pad2(m[3])].filter(Boolean).join('-');
  }
  if ((m = s.match(/^([A-Za-z]+)\.? (\d{1,2}),? (\d{4})$/)) && monthNo(m[1])) return `${m[3]}-${pad2(monthNo(m[1]))}-${pad2(m[2])}`;
  if ((m = s.match(/^(\d{1,2}) ([A-Za-z]+)\.?,? (\d{4})$/)) && monthNo(m[2])) return `${m[3]}-${pad2(monthNo(m[2]))}-${pad2(m[1])}`;
  if ((m = s.match(/^([A-Za-z]+)\.?,? (\d{4})$/)) && monthNo(m[1])) return `${m[2]}-${pad2(monthNo(m[1]))}`;
  if ((m = s.match(/^\D{0,3}(\d{4})\D{0,2}$/))) return m[1];
  return s;
}

const yearOf = (date) => (String(date || '').match(/\b(1[4-9]\d\d|20\d\d)\b/) || [])[1] || '';

function metaLine(b) {
  return [b.publisher, yearOf(b.date) || b.date, b.pages && `${b.pages} pp`].filter(Boolean).join(' · ');
}

/* ───────────────────────── Lookups ───────────────────────── */

const FIELDS = ['title', 'author', 'publisher', 'date', 'pages', 'cover'];

async function getJSON(url, ms = 8000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { http: res.status });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function googleUrl(query, max) {
  const fields = 'totalItems,items(id,volumeInfo(title,subtitle,authors,publisher,publishedDate,pageCount,imageLinks,industryIdentifiers))';
  let url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=${max}&printType=books&fields=${encodeURIComponent(fields)}`;
  if (settings.googleKey) url += `&key=${encodeURIComponent(settings.googleKey)}`;
  return url;
}

function fromGoogle(volume) {
  const i = volume.volumeInfo || {};
  const ids = i.industryIdentifiers || [];
  const isbn = ids.find((x) => x.type === 'ISBN_13')?.identifier || toIsbn13(ids.find((x) => x.type === 'ISBN_10')?.identifier) || '';
  const cover = (i.imageLinks?.thumbnail || i.imageLinks?.smallThumbnail || '').replace(/^http:/, 'https:').replace('&edge=curl', '');
  return {
    title: [i.title, i.subtitle].filter(Boolean).join(': '),
    author: (i.authors || []).join(', '),
    publisher: i.publisher || '',
    date: normDate(i.publishedDate),
    pages: i.pageCount > 0 ? i.pageCount : null,
    cover, isbn,
  };
}

function fromOpenLibraryEdition(d) {
  return {
    title: [d.title, d.subtitle].filter(Boolean).join(': '),
    author: (d.authors || []).map((a) => a.name).filter(Boolean).join(', '),
    publisher: (d.publishers || []).map((p) => p.name).filter(Boolean).join(', '),
    date: normDate(d.publish_date),
    pages: d.number_of_pages > 0 ? d.number_of_pages : null,
    cover: d.cover?.medium || d.cover?.large || '',
    isbn: '',
  };
}

function fromOpenLibrarySearch(d) {
  const isbn = (d.isbn || []).find((x) => x.length === 13) || '';
  return {
    title: [d.title, d.subtitle].filter(Boolean).join(': '),
    author: (d.author_name || []).slice(0, 3).join(', '),
    publisher: (d.publisher || [])[0] || '',
    date: d.first_publish_year ? String(d.first_publish_year) : '',
    pages: d.number_of_pages_median > 0 ? d.number_of_pages_median : null,
    cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : '',
    isbn,
  };
}

/** Each source resolves to {ok, book} — ok:false means we got no answer at all. */
async function sourceGoogleIsbn(isbn) {
  try {
    const data = await getJSON(googleUrl('isbn:' + isbn, 1));
    return { ok: true, book: data.items?.length ? fromGoogle(data.items[0]) : null };
  } catch { return { ok: false }; }
}

async function sourceOpenLibraryIsbn(isbn) {
  try {
    const data = await getJSON(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
    const hit = data['ISBN:' + isbn];
    return { ok: true, book: hit ? fromOpenLibraryEdition(hit) : null };
  } catch { return { ok: false }; }
}

function mergeBooks(list) {
  const out = {};
  for (const key of FIELDS) out[key] = list.map((b) => b[key]).find(Boolean) || (key === 'pages' ? null : '');
  return out;
}

/**
 * Asks Google Books and Open Library at once. Returns as soon as the record is
 * complete, otherwise waits for both and merges whatever each one knows.
 * → {status: 'found', book} | {status: 'notfound'} | {status: 'unreachable'}
 */
async function lookupIsbn(isbn) {
  if (navigator.onLine === false) return { status: 'unreachable' };
  const tasks = [sourceGoogleIsbn(isbn), sourceOpenLibraryIsbn(isbn)];
  const results = [];
  const merged = () => {
    const found = results.filter((r) => r?.book?.title).map((r) => r.book);
    return found.length ? mergeBooks(found) : null;
  };
  await new Promise((resolve) => {
    let left = tasks.length;
    tasks.forEach((task, i) => task.then((r) => {
      results[i] = r;
      const m = merged();
      if ((m && FIELDS.every((k) => m[k])) || --left === 0) resolve();
    }));
  });
  const book = merged();
  if (book) return { status: 'found', book };
  return results.some((r) => r?.ok) ? { status: 'notfound' } : { status: 'unreachable' };
}

/* Free-text search, used for the text read off a cover photo. */

const tokens = (s) => fold(s).match(/[a-z0-9]{2,}/g) || [];

function near(a, b) {
  if (a === b) return true;
  if (a.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  // one edit apart?
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return true;
}

async function searchByText(guess, lines) {
  const queries = [...new Set([
    [guess.title, guess.author].filter(Boolean).join(' '),
    guess.title,
  ].map((q) => q.trim()).filter((q) => q.length >= 3))];
  if (!queries.length || navigator.onLine === false) return [];

  const jobs = queries.flatMap((q) => [
    getJSON(googleUrl(q, 6), 6000).then((d) => (d.items || []).map(fromGoogle)).catch(() => []),
    getJSON(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=6&fields=key,title,subtitle,author_name,first_publish_year,publisher,number_of_pages_median,cover_i,isbn`, 6000)
      .then((d) => (d.docs || []).map(fromOpenLibrarySearch)).catch(() => []),
  ]);
  const found = (await Promise.all(jobs)).flat().filter((b) => b.title);

  const seen = [...new Set(lines.flatMap((l) => tokens(l.text)))];
  const hit = (w) => seen.some((s) => near(s, w));
  const share = (words) => (words.length ? words.filter(hit).length / words.length : 0);
  const scored = found.map((b) => {
    const t = share(tokens(b.title.split(':')[0])), a = share(tokens(b.author));
    const filled = FIELDS.filter((k) => b[k]).length;
    return { book: b, score: t * 0.65 + a * 0.35 + filled * 0.005 };
  }).filter((c) => c.score >= 0.34).sort((x, y) => y.score - x.score);

  const out = [], keys = new Set();
  for (const c of scored) {
    const key = tokens(c.book.title.split(':')[0]).join(' ') + '|' + tokens(c.book.author).pop() + '|' + yearOf(c.book.date);
    if (keys.has(key)) continue;
    keys.add(key);
    out.push(c);
    if (out.length === 6) break;
  }
  return out;
}

/* ───────────────────────── Layers, sheet, toast ───────────────────────── */

// Every overlay pushes a history entry so Android's back gesture closes it.
const layers = [];
function openLayer(onClose) {
  layers.push(onClose);
  history.pushState({ layer: layers.length }, '');
  document.body.classList.add('locked');
}
function closeLayer() { if (layers.length) history.back(); }
window.addEventListener('popstate', () => {
  const close = layers.pop();
  if (!layers.length) document.body.classList.remove('locked');
  close?.();
});

const sheet = {
  isOpen: false,
  onClose: null,
  /** Opens the sheet, or swaps its content if it is already open. */
  open(content, onClose) {
    $('sheetBody').replaceChildren(content);
    $('sheetBody').scrollTop = 0;
    this.onClose = onClose || null;
    if (this.isOpen) return;
    this.isOpen = true;
    $('sheet').hidden = $('backdrop').hidden = false;
    void $('sheet').offsetHeight; // start the transition from the hidden state
    $('sheet').classList.add('open');
    $('backdrop').classList.add('open');
    openLayer(() => this.hide());
  },
  close() { if (this.isOpen) closeLayer(); },
  hide() {
    this.isOpen = false;
    $('sheet').classList.remove('open');
    $('backdrop').classList.remove('open');
    document.activeElement?.blur?.();
    setTimeout(() => { if (!this.isOpen) { $('sheet').hidden = $('backdrop').hidden = true; $('sheetBody').replaceChildren(); } }, 280);
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
  },
};
$('backdrop').addEventListener('click', () => sheet.close());

function sheetHead(title, sub, extra) {
  return h('div', { class: 'sheet-head' },
    h('div', null, h('h2', { class: 'sheet-title', text: title }), sub && h('p', { class: 'sheet-sub', text: sub })),
    extra || h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => sheet.close() }, icon('x')));
}

let toastTimer;
function toast(message, { action, onAction, ms = 3200 } = {}) {
  const el = $('toast');
  el.replaceChildren(h('span', { text: message }));
  if (action) el.append(h('button', { type: 'button', text: action, onclick: () => { hide(); onAction?.(); } }));
  el.hidden = false;
  void el.offsetHeight;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hide, action ? Math.max(ms, 5000) : ms);
  function hide() {
    el.classList.remove('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 220);
  }
}

/* ───────────────────────── Library ───────────────────────── */

function hue(text) {
  let x = 7;
  for (const ch of String(text || '')) x = (x * 31 + ch.codePointAt(0)) % 360;
  return x;
}

function coverEl(book, large) {
  const label = book.title || book.isbn || '?';
  const el = h('div', { class: 'cover' + (large ? ' lg' : ''), style: `--h:${hue(label)}` },
    h('span', { text: (book.title || '?').trim().charAt(0).toUpperCase() }));
  const sources = [book.cover, book.thumb].filter(Boolean);
  if (sources.length) {
    const img = h('img', { alt: '', loading: 'lazy', decoding: 'async' });
    const next = () => { const src = sources.shift(); if (src) img.src = src; else img.remove(); };
    img.addEventListener('error', next);
    // Open Library answers a missing cover with a 1×1 pixel image.
    img.addEventListener('load', () => { if (img.naturalWidth < 8) next(); });
    next();
    el.append(img);
  }
  return el;
}

function displayTitle(b) {
  if (b.title) return b.title;
  return b.pending ? `ISBN ${b.isbn}` : 'Unknown book';
}

function bookRow(b, onPick, extra) {
  let meta;
  if (b.pending) meta = h('div', { class: 'book-meta flag' }, icon('cloud-off'), 'Will be looked up when you’re online');
  else if (b.unresolved) meta = h('div', { class: 'book-meta flag', text: 'No match found — tap to fill in' });
  else meta = h('div', { class: 'book-meta', text: metaLine(b) });
  return h('button', { class: 'book', type: 'button', onclick: () => onPick(b) },
    coverEl(b),
    h('div', { class: 'book-text' },
      h('div', { class: 'book-title' }, extra, displayTitle(b)),
      h('div', { class: 'book-author', text: b.author || (b.title ? '' : b.isbn && !b.pending ? `ISBN ${b.isbn}` : '') }),
      meta));
}

function dayLabel(iso) {
  const d = new Date(iso), now = new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 864e5);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

function renderLibrary() {
  const query = fold($('search').value.trim());
  $('count').textContent = books.length ? plural(books.length, 'book') : 'Nothing scanned yet';
  $('searchWrap').hidden = books.length < 8 && !query;
  $('empty').hidden = books.length > 0;

  const list = query
    ? books.filter((b) => fold([b.title, b.author, b.publisher, b.isbn, b.date].join(' ')).includes(query))
    : books;
  const frag = document.createDocumentFragment();
  let lastDay = '';
  for (const b of list) {
    const day = dayLabel(b.added);
    if (!query && day !== lastDay) { frag.append(h('h2', { class: 'day', text: day })); lastDay = day; }
    frag.append(bookRow(b, (book) => openBookForm({ book })));
  }
  if (query && !list.length) frag.append(h('p', { class: 'no-results', text: 'No books match that search.' }));
  $('library').replaceChildren(frag);
}

/* ───────────────────────── Book form ───────────────────────── */

const SMALL_WORDS = /^(a|an|the|of|and|in|on|to|for|at|by|de|het|een|van|en|der|den|te|ten|ter|op|le|la|les|du|des|et|un|une|und|das|die|von|zu)$/;

/** ALL-CAPS cover text → Title Case; anything already mixed-case is left alone. */
function tidyCase(s) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (!s || s !== s.toUpperCase() || !/\p{L}{2}/u.test(s)) return s;
  return s.toLowerCase().split(' ').map((w, i) => (i > 0 && SMALL_WORDS.test(w) ? w : w.replace(/(^|[-'’.])(\p{L})/gu, (m, p, c) => p + c.toUpperCase()))).join(' ');
}

/**
 * Add or edit a book.
 *  book      existing record, or a draft when `isNew`
 *  ocrLines  text read from the cover, offered as tap-to-fill chips
 */
function openBookForm({ book, isNew = false, ocrLines = [], heading, subheading, onSaved, onClose }) {
  let saved = false;
  const input = (name, attrs = {}) => h('input', { name, value: book[name] ?? '', autocomplete: 'off', ...attrs });
  const f = {
    title: h('textarea', { name: 'title', rows: 2, class: 'serif', autocomplete: 'off', enterkeyhint: 'next' }),
    author: input('author', { autocapitalize: 'words' }),
    publisher: input('publisher', { autocapitalize: 'words' }),
    date: input('date', { placeholder: 'e.g. 1998', inputmode: 'numeric' }),
    pages: input('pages', { inputmode: 'numeric', pattern: '[0-9]*' }),
    isbn: input('isbn', { inputmode: 'numeric' }),
  };
  f.title.value = book.title || '';
  f.title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); f.author.focus(); } });
  const field = (label, control) => h('label', { class: 'field' }, h('span', { text: label }), control);
  const error = h('p', { class: 'field-error', hidden: true });

  // Tap-to-fill chips for text read off the cover.
  let ocrBox = null;
  if (ocrLines.length) {
    let target = 'title', run = null;
    const seg = { title: h('button', { type: 'button', text: 'Title' }), author: h('button', { type: 'button', text: 'Author' }) };
    const setTarget = (t) => { target = t; run = null; for (const k in seg) seg[k].setAttribute('aria-pressed', String(k === t)); };
    for (const k in seg) {
      seg[k].addEventListener('click', () => setTarget(k));
      f[k].addEventListener('focus', () => setTarget(k));
      f[k].addEventListener('input', () => { run = null; });
    }
    setTarget('title');
    const chips = ocrLines.slice(0, 12).map((line) => h('button', {
      class: 'chip', type: 'button', text: line,
      onpointerdown: (e) => e.preventDefault(), // keep the keyboard where it is
      onclick: () => {
        // First tap replaces the field; further taps in a row append.
        f[target].value = run === target && f[target].value ? `${f[target].value} ${line}` : line;
        run = target;
      },
    }));
    ocrBox = h('div', { class: 'ocr' },
      h('div', { class: 'ocr-head' }, h('span', { text: 'Tap text from the cover to fill' }), h('div', { class: 'seg' }, seg.title, seg.author)),
      h('div', { class: 'chips' }, chips));
  }

  const swap = (isNew && ocrLines.length) && h('button', {
    class: 'swap', type: 'button',
    onclick: () => { [f.title.value, f.author.value] = [f.author.value, f.title.value]; },
  }, icon('swap'), 'Swap title and author');

  const form = h('form', { novalidate: true, onsubmit: submit },
    sheetHead(heading || (isNew ? 'New book' : 'Edit book'), subheading || null,
      (book.cover || book.thumb) ? coverEl(book) : null),
    ocrBox,
    field('Title', f.title),
    field('Author', f.author),
    swap,
    field('Publisher', f.publisher),
    h('div', { class: 'field-row' }, field('Published', f.date), field('Pages', f.pages)),
    field('ISBN', f.isbn),
    error,
    h('div', { class: 'btn-row sheet-actions' },
      !isNew && h('button', { class: 'btn btn-quiet btn-danger', type: 'button', 'aria-label': 'Delete book', onclick: remove }, icon('trash')),
      h('button', { class: 'btn btn-outline', type: 'button', text: 'Cancel', onclick: () => sheet.close() }),
      h('button', { class: 'btn btn-primary', type: 'submit' }, icon('check'), isNew ? 'Add to shelf' : 'Save')));

  async function submit(e) {
    e.preventDefault();
    const v = (k) => f[k].value.replace(/\s+/g, ' ').trim();
    const data = {
      title: v('title'), author: v('author'), publisher: v('publisher'), date: normDate(v('date')),
      pages: parseInt(v('pages'), 10) > 0 ? parseInt(v('pages'), 10) : null,
      isbn: toIsbn13(v('isbn')) || v('isbn').replace(/[^0-9Xx]/g, ''),
    };
    if (!data.title) {
      error.textContent = 'A book needs at least a title.';
      error.hidden = false;
      f.title.focus();
      return;
    }
    let result = book;
    if (isNew) {
      result = await addBook({ ...book, ...data });
    } else {
      Object.assign(book, data, { pending: false, unresolved: false });
      await saveBook(book);
    }
    saved = true;
    sheet.close();
    onSaved?.(result);
  }

  function remove() {
    sheet.close();
    removeBook(book);
    toast('Book removed', { action: 'Undo', onAction: () => restoreBook(book) });
  }

  sheet.open(form, () => onClose?.(saved));
}

/* ───────────────────────── Export ───────────────────────── */

function exportJson() {
  const rows = [...books].reverse().map((b) => ({
    title: b.title, author: b.author, date: b.date, publisher: b.publisher, pages: b.pages ?? null,
    isbn: b.isbn || '', cover: b.cover || '', added: b.added,
  }));
  return JSON.stringify(rows, null, 2);
}

function openExport() {
  if (!books.length) { toast('Nothing to export yet'); return; }
  const json = exportJson();
  const name = `bookscan-${new Date().toISOString().slice(0, 10)}.json`;
  const file = typeof File === 'function' ? new File([json], name, { type: 'application/json' }) : null;
  const canShareFile = !!file && !!navigator.canShare?.({ files: [file] });

  const save = () => {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    sheet.close();
    toast(`Saved ${name}`);
  };
  const share = async () => {
    try {
      await navigator.share(canShareFile ? { files: [file], title: name } : { title: name, text: json });
      sheet.close();
    } catch (err) {
      if (err?.name !== 'AbortError') toast('Sharing didn’t work — try saving the file');
    }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(json); sheet.close(); toast('JSON copied to clipboard'); }
    catch { toast('Couldn’t reach the clipboard'); }
  };

  sheet.open(h('div', null,
    sheetHead('Export', `${plural(books.length, 'book')} as JSON, oldest first.`),
    h('div', { class: 'stack' },
      h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: save }, icon('download'), 'Save file'),
      navigator.share && h('button', { class: 'btn btn-outline btn-block', type: 'button', onclick: share }, icon('share'), 'Share…'),
      navigator.clipboard && h('button', { class: 'btn btn-outline btn-block', type: 'button', onclick: copy }, icon('copy'), 'Copy to clipboard'))));
}

/* ───────────────────────── Settings sheet ───────────────────────── */

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });

function openSettings() {
  const chips = Object.entries(OCR_LANGS).map(([code, label]) => {
    const chip = h('button', { class: 'chip', type: 'button', text: label, 'aria-pressed': String(settings.langs.includes(code)) });
    chip.addEventListener('click', () => {
      const on = !settings.langs.includes(code);
      if (!on && settings.langs.length === 1) { toast('Keep at least one language'); return; }
      settings.langs = Object.keys(OCR_LANGS).filter((l) => (l === code ? on : settings.langs.includes(l)));
      store.set('langs', settings.langs);
      chip.setAttribute('aria-pressed', String(on));
    });
    return chip;
  });

  const key = h('input', { type: 'text', value: settings.googleKey, placeholder: 'Optional', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  key.addEventListener('change', () => { settings.googleKey = key.value.trim(); store.set('googleKey', settings.googleKey); });

  sync.box = h('div', { class: 'sheet-section account' });
  sheet.open(h('div', null,
    sheetHead('Settings'),
    installPrompt && h('button', {
      class: 'btn btn-primary btn-block', type: 'button',
      onclick: async () => { const p = installPrompt; installPrompt = null; sheet.close(); await p.prompt(); },
    }, icon('download'), 'Install Bookscan on this phone'),
    sync.box,
    h('div', { class: 'sheet-section' },
      h('h3', { text: 'Languages on your covers' }),
      h('div', { class: 'chips' }, chips),
      h('p', { class: 'sheet-note', text: 'Used when reading a photographed cover. Fewer languages read faster.' })),
    h('div', { class: 'sheet-section' },
      h('h3', { text: 'Google Books API key' }),
      h('label', { class: 'field' }, key),
      h('p', { class: 'sheet-note' },
        'Lookups ask Open Library and Google Books. Google’s shared, keyless quota often runs dry; a free key of your own (Google Cloud console → Books API) makes it dependable. It is stored only on this device.')),
    h('div', { class: 'sheet-section' },
      h('h3', { text: `About · version ${APP_VERSION}` }),
      h('p', { class: 'sheet-note', text: 'Your shelf is stored on this device, and on the server too while you’re signed in. Export it now and then to keep a copy of your own. Book data comes from Open Library and Google Books.' }))));
  renderAccount();
  if (sync.user && !sync.running && time(sync.last) < Date.now() - 30000) runSync();
}

/* ───────────────────────── Scanner ───────────────────────── */

const scannerEl = $('scanner'), video = $('video');
const scanner = {
  open: false, session: 0, mode: 'barcode',
  stream: null, track: null, detector: null,
  busy: false, capturing: false,
  lastCode: '', lastSeen: 0,
  added: 0, pendingIsbn: '', wakeLock: null, hintTimer: 0,
};
const alive = (session) => scanner.open && scanner.session === session;

const HINTS = {
  barcode: 'Point at the barcode on the back cover',
  cover: 'Fit the front cover in the frame',
  coverNoCam: 'Tap the button to photograph the cover',
};

function setHint(text, ms) {
  clearTimeout(scanner.hintTimer);
  $('scanHint').textContent = text ?? (scanner.mode === 'cover' ? (scanner.stream ? HINTS.cover : HINTS.coverNoCam) : (scanner.stream ? HINTS.barcode : ''));
  if (ms) scanner.hintTimer = setTimeout(() => setHint(), ms);
}

function openScanner() {
  if (scanner.open) return;
  scanner.open = true;
  const session = ++scanner.session;
  Object.assign(scanner, { added: 0, busy: false, capturing: false, lastCode: '', pendingIsbn: '' });
  scannerEl.hidden = false;
  setMode('barcode');
  updateScanCount();
  openLayer(closeScannerNow);
  startCamera(session);
  scanLoop(session);
  requestWakeLock();
}

function closeScannerNow() {
  scanner.open = false;
  scanner.session++;
  stopCamera();
  showCard(null);
  scannerEl.hidden = true;
  scannerEl.classList.remove('no-camera', 'busy', 'hit');
  scanner.wakeLock?.release?.().catch(() => {});
  scanner.wakeLock = null;
}

async function requestWakeLock() {
  try { scanner.wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
}

async function startCamera(session) {
  $('scanMsg').hidden = true;
  scannerEl.classList.remove('no-camera');
  let stream;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' });
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  } catch (err) {
    if (alive(session)) cameraUnavailable(err);
    return;
  }
  if (!alive(session) || document.hidden) { stream.getTracks().forEach((t) => t.stop()); return; }
  scanner.stream = stream;
  scanner.track = stream.getVideoTracks()[0];
  video.srcObject = stream;
  video.play().catch(() => {});
  const caps = scanner.track.getCapabilities?.() || {};
  if (caps.focusMode?.includes?.('continuous')) scanner.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
  $('torchBtn').hidden = !caps.torch;
  $('torchBtn').setAttribute('aria-pressed', 'false');
  setHint();
}

function stopCamera() {
  scanner.stream?.getTracks().forEach((t) => t.stop());
  scanner.stream = scanner.track = null;
  video.srcObject = null;
  $('torchBtn').hidden = true;
}

function cameraUnavailable(err) {
  const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
  scannerEl.classList.add('no-camera');
  $('scanMsgTitle').textContent = denied ? 'The camera is switched off' : 'No camera available';
  $('scanMsgBody').textContent = denied
    ? 'Allow camera access for this site in your browser’s site settings. Until then you can type the ISBN, or photograph a cover with your camera app.'
    : 'You can still add books by typing the ISBN or entering the details by hand.';
  $('scanMsg').hidden = false;
  setHint();
}

document.addEventListener('visibilitychange', () => {
  if (!scanner.open) return;
  if (document.hidden) stopCamera();
  else if (!scanner.stream) { startCamera(scanner.session); requestWakeLock(); }
});

// ISBNs are EAN-13. UPC-A is read too: older (mostly American) paperbacks carry a
// shop barcode instead, with the ISBN only printed next to it.
const BARCODE_FORMATS = ['ean_13', 'upc_a'];

async function getDetector() {
  if ('BarcodeDetector' in window) {
    try {
      const formats = (await window.BarcodeDetector.getSupportedFormats()).filter((f) => BARCODE_FORMATS.includes(f));
      if (formats.includes('ean_13')) return new window.BarcodeDetector({ formats });
    } catch {}
  }
  // Browsers without the native detector get a WebAssembly one.
  const zx = await import('./vendor/barcode/ponyfill.js');
  zx.prepareZXingModule({ overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? abs('vendor/barcode/zxing_reader.wasm') : prefix + path) } });
  return new zx.BarcodeDetector({ formats: BARCODE_FORMATS });
}

async function scanLoop(session) {
  let detector;
  try { detector = await (scanner.detector ??= getDetector()); }
  catch (err) {
    console.error(err);
    scanner.detector = null;
    if (alive(session)) setHint('Barcode reading isn’t available here — type the ISBN instead');
    return;
  }
  while (alive(session)) {
    const ready = scanner.mode === 'barcode' && !scanner.busy && !sheet.isOpen && scanner.stream && video.readyState >= 2 && !video.paused;
    if (ready) {
      try {
        const codes = await detector.detect(video);
        if (alive(session) && !scanner.busy && !sheet.isOpen) handleCodes(codes);
      } catch {}
    } else {
      // While paused, keep treating the book in front of the lens as "still there".
      scanner.lastSeen = performance.now();
    }
    await new Promise((r) => setTimeout(r, 90));
  }
}

function handleCodes(codes) {
  if (!codes.length) return;
  const now = performance.now();
  const seen = codes.map((code) => ({ value: String(code.rawValue || '').replace(/\D/g, ''), box: code.boundingBox }));
  const isIsbn = (c) => isbn13Valid(c.value) && /^97[89]/.test(c.value);
  // An ISBN barcode wins; failing that, any other retail barcode may have the ISBN printed beside it.
  const hit = seen.find(isIsbn) || seen.find((c) => c.value.length >= 12 && c.box);
  if (!hit) return;
  // Ignore the book that is still lying in front of the lens.
  if (hit.value === scanner.lastCode && now - scanner.lastSeen < 2500) { scanner.lastSeen = now; return; }
  scanner.lastCode = hit.value;
  scanner.lastSeen = now;
  if (isIsbn(hit)) onIsbn(hit.value);
  else readPrintedIsbn(hit.box);
}

/* Printed ISBN next to a non-ISBN barcode */

// ISBNs beside barcodes are set in OCR-A or OCR-B. General-purpose OCR reads OCR-B well
// but takes several OCR-A digits for letters (its 6 comes out as b, L or k). These are
// the confusions measured on both fonts; the check digit rejects any wrong guess.
const LOOKALIKE = {
  O: '0', o: '0', D: '0', Q: '0',
  I: '1', l: '1', '|': '1', '!': '1', ']': '1', '[': '1',
  Z: '2', z: '2',
  S: '5', s: '5',
  b: '6', L: '6', k: '6', G: '6', h: '6',
  B: '8', '&': '8',
  g: '9', q: '9',
};

/**
 * Reads an ISBN from the start of `str` ("0-7868-8944-6 …"). Strict on purpose: the
 * number must end on a group boundary with exactly 10 or 13 digits and a valid check
 * digit, and an unreadable character ends it — nothing is skipped or guessed.
 */
function parseIsbn(str) {
  const groups = String(str).replace(/^[^0-9A-Za-z]+/, '').split(/[\s\-–—=.:]+/);
  let digits = '', ten = null, used = 0;
  for (const group of groups) {
    let mapped = '';
    for (const ch of group) {
      const d = /[0-9]/.test(ch) ? ch : /x/i.test(ch) ? 'X' : LOOKALIKE[ch];
      if (!d) { mapped = null; break; }
      mapped += d;
    }
    if (!mapped) break;
    digits += mapped;
    used++;
    if (digits.length === 10 && !ten) ten = toIsbn13(digits);
    if (digits.length === 13) return toIsbn13(digits) || null;
    if (digits.length > 13) return null;
  }
  // "978-…" cut short is an incomplete ISBN-13, not an ISBN-10.
  return ten && digits.length === 10 && (used === groups.length || !/^97[89]/.test(digits)) ? ten : null;
}

/** Finds a printed ISBN in OCR text. */
function findPrintedIsbn(text) {
  const SYMBOL = '[0-9A-Za-z|!\\]\\[&]';
  const hyphenated = new RegExp(`${SYMBOL}+(?:[-–—]${SYMBOL}+){2,4}`, 'g');
  for (const line of String(text || '').split('\n')) {
    const candidates = [];
    const labelled = line.match(/[I1l|][S5][B8]N(?:[-\s]*1[03]\b)?[\s:.#-]*(.+)/i);
    if (labelled) candidates.push(labelled[1]);
    candidates.push(...(line.match(hyphenated) || []));
    for (const candidate of candidates) {
      // Second try: a digit read twice, once as itself and once as its look-alike ("O0", "b6").
      const deduped = candidate.replace(/([A-Za-z|!\]\[&])([0-9])|([0-9])([A-Za-z|!\]\[&])/g,
        (m, a, b, c, d) => (a ? (LOOKALIKE[a] === b ? b : m) : (LOOKALIKE[d] === c ? c : m)));
      const isbn = parseIsbn(candidate) || (deduped !== candidate && parseIsbn(deduped));
      if (isbn) return isbn;
    }
  }
  return null;
}

/** Cuts a region (in camera pixels) out of the live picture, scaled for reading. */
function cropVideo(region, scale) {
  const x0 = Math.max(0, region.x), y0 = Math.max(0, region.y);
  const x1 = Math.min(video.videoWidth, region.x + region.w), y1 = Math.min(video.videoHeight, region.y + region.h);
  if (x1 - x0 < 20 || y1 - y0 < 10) return null;
  const k = Math.max(1, Math.min(3, scale));
  const canvas = h('canvas', { width: Math.round((x1 - x0) * k), height: Math.round((y1 - y0) * k) });
  canvas.getContext('2d').drawImage(video, x0, y0, x1 - x0, y1 - y0, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Where an ISBN is usually printed relative to a barcode: just above it or just below it. */
function readingPlan(box, lastTry) {
  const w = box.width;
  const thin = box.height < w * 0.3; // some detectors report a scan line, not the whole symbol
  const mid = box.y + box.height / 2;
  const top = thin ? mid - w * 0.35 : box.y, bottom = thin ? mid + w * 0.35 : box.y + box.height;
  const x = box.x - w * 0.25, width = w * 2.05;
  const above = { x, y: top - w * 0.45, w: width, h: w * 0.5 };
  const below = { x, y: bottom - w * 0.05, w: width, h: w * 0.5 };
  // Two sizes each, because this lettering reads differently at different scales.
  const plan = [
    { region: above, scale: 650 / w, psm: '6' },
    { region: below, scale: 650 / w, psm: '6' },
    { region: above, scale: 520 / w, psm: '6' },
    { region: below, scale: 520 / w, psm: '6' },
  ];
  if (lastTry) plan.push({ region: { x, y: top - w * 0.55, w: width, h: bottom - top + w * 1.1 }, scale: 520 / w, psm: '11' });
  return plan;
}

async function readPrintedIsbn(firstBox) {
  const session = scanner.session;
  const ATTEMPTS = 3;
  scanner.busy = true;
  buzz(15);
  showCard(busyCard('Reading the printed ISBN…'));
  let isbn = null, worker = null;
  try {
    worker = await getOcrWorker();
    const detector = await scanner.detector;
    // A few fresh frames, in case the first one was blurred.
    for (let attempt = 0; attempt < ATTEMPTS && !isbn && alive(session); attempt++) {
      let box = firstBox;
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 200));
        const codes = await detector.detect(video).catch(() => []);
        const scanned = codes.map((c) => String(c.rawValue || '').replace(/\D/g, '')).find((v) => isbn13Valid(v) && /^97[89]/.test(v));
        if (scanned) { isbn = scanned; break; }
        box = codes.find((c) => c.boundingBox)?.boundingBox;
        if (!box) continue;
      }
      for (const step of readingPlan(box, attempt === ATTEMPTS - 1)) {
        const canvas = cropVideo(step.region, step.scale);
        if (!canvas) continue;
        await worker.setParameters({ tessedit_pageseg_mode: step.psm });
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('OCR timed out')), 15000));
        const { data } = await Promise.race([worker.recognize(canvas, {}, { text: true }), timeout]);
        isbn = findPrintedIsbn(data.text);
        if (isbn || !alive(session)) break;
      }
    }
  } catch (err) {
    console.warn(err);
  }
  if (!alive(session)) return;
  if (isbn) { onIsbn(isbn); return; }
  // Scanning stays paused until one of these is chosen.
  showCard(card({
    status: 'Not an ISBN barcode', tone: 'warn', title: 'Couldn’t read the ISBN beside it',
    sub: 'Some older books carry a shop barcode. Hold the printed ISBN number sharp and level, or type it in.',
    onDismiss: () => { scanner.busy = false; },
    actions: [
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { scanner.lastCode = ''; scanner.busy = false; showCard(null); } }, icon('scan'), 'Try again'),
      h('button', { class: 'btn btn-outline', type: 'button', onclick: openIsbnSheet }, icon('keyboard'), 'Type ISBN'),
    ],
  }));
}

function setMode(mode, isbn = '') {
  scanner.mode = mode;
  scanner.pendingIsbn = isbn;
  scanner.busy = false;
  scannerEl.dataset.mode = mode;
  showCard(null);
  setHint();
  if (mode === 'cover') warmOcr();
}

function updateScanCount() {
  $('scanCount').hidden = scanner.added < 1;
  $('scanCount').textContent = `${scanner.added} added`;
}

/* Result cards */

function showCard(node) {
  $('scanCard').replaceChildren(...(node ? [node] : []));
  scannerEl.classList.toggle('busy', scanner.busy);
}

function card({ status, tone, statusIcon, book, title, sub, actions = [], onDismiss }) {
  const text = h('div', null,
    status && h('div', { class: 'card-status ' + (tone || '') }, statusIcon && icon(statusIcon), status),
    h('div', { class: 'card-title', text: book ? displayTitle(book) : title }),
    (book?.author || sub) && h('div', { class: 'card-sub', text: book ? book.author : sub }),
    book && metaLine(book) && h('div', { class: 'card-meta', text: metaLine(book) }));
  return h('div', { class: 'card' },
    h('div', { class: 'card-main' + (book ? '' : ' solo') }, book && coverEl(book, true), text),
    actions.length > 0 && h('div', { class: 'card-actions' }, actions),
    h('button', { class: 'card-x', type: 'button', 'aria-label': 'Dismiss', onclick: () => { onDismiss?.(); showCard(null); } }, icon('x')));
}

function busyCard(text, withProgress) {
  const bar = h('i');
  const label = h('div', { class: 'card-title', text });
  const node = h('div', { class: 'card' }, h('div', { class: 'card-busy' }, h('div', { class: 'spinner' }), label),
    withProgress && h('div', { class: 'progress' }, bar));
  node.setProgress = (p) => { bar.style.width = `${Math.round(p * 100)}%`; };
  node.setText = (t) => { label.textContent = t; };
  return node;
}

function addedCard(book) {
  return card({
    status: 'Added', tone: 'ok', statusIcon: 'check', book,
    actions: [
      h('button', { class: 'btn btn-outline', type: 'button', onclick: () => { removeBook(book); scanner.added = Math.max(0, scanner.added - 1); updateScanCount(); showCard(null); } }, icon('undo'), 'Undo'),
      h('button', { class: 'btn btn-outline', type: 'button', onclick: () => openBookForm({ book, onClose: () => { if (scanner.open && books.includes(book)) showCard(addedCard(book)); else showCard(null); } }) }, icon('pencil'), 'Edit'),
    ],
  });
}

function pulse() {
  scannerEl.classList.add('hit');
  setTimeout(() => scannerEl.classList.remove('hit'), 700);
}

async function onIsbn(isbn) {
  const session = scanner.session;
  scanner.busy = true;
  buzz();
  pulse();

  const existing = books.find((b) => b.isbn === isbn);
  if (existing) {
    scanner.busy = false;
    showCard(card({ status: 'Already on your shelf', tone: 'warn', book: existing }));
    return;
  }

  showCard(busyCard(`Looking up ${isbn}…`));
  const result = await lookupIsbn(isbn);

  if (result.status === 'found') {
    const book = await addBook({ ...result.book, isbn });
    if (!alive(session)) { toast(`Added “${book.title}”`); return; }
    scanner.added++;
    updateScanCount();
    scanner.busy = false;
    buzz(20);
    showCard(addedCard(book));
  } else if (result.status === 'notfound') {
    if (!alive(session)) { toast(`No match found for ISBN ${isbn}`); return; }
    warmOcr();
    // Scanning stays paused until one of these is chosen.
    showCard(card({
      status: 'No match', tone: 'warn', title: 'This ISBN isn’t in the catalogues', sub: `${isbn} · Try a photo of the front cover.`,
      onDismiss: () => { scanner.busy = false; },
      actions: [
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => setMode('cover', isbn) }, icon('camera'), 'Photograph the cover'),
        h('button', { class: 'btn btn-outline btn-narrow', type: 'button', onclick: () => manualEntry(isbn) }, 'By hand'),
      ],
    }));
  } else {
    const book = await addBook({ isbn, pending: true });
    if (!alive(session)) { toast('Saved the ISBN — details follow when you’re online'); return; }
    scanner.added++;
    updateScanCount();
    scanner.busy = false;
    showCard(card({ status: 'Saved for later', tone: 'warn', statusIcon: 'cloud-off', title: `ISBN ${isbn}`, sub: 'No connection right now. The details will be filled in when you’re back online.' }));
    void book;
  }
}

function manualEntry(isbn = '') {
  openBookForm({
    book: { isbn }, isNew: true,
    onSaved: () => { scanner.added++; updateScanCount(); },
    onClose: (saved) => { if (saved && scanner.open) { setMode('barcode'); toast('Added to your shelf'); } },
  });
}

function openIsbnSheet() {
  const input = h('input', { name: 'isbn', inputmode: 'numeric', autocomplete: 'off', placeholder: '978…', enterkeyhint: 'search' });
  const error = h('p', { class: 'field-error', hidden: true, text: 'That isn’t a valid ISBN — check the digits.' });
  const form = h('form', {
    novalidate: true,
    onsubmit: (e) => {
      e.preventDefault();
      const isbn = toIsbn13(input.value);
      if (!isbn) { error.hidden = false; input.focus(); return; }
      sheet.close();
      onIsbn(isbn);
    },
  },
    sheetHead('Type the ISBN', 'The 10 or 13 digits printed above the barcode or on the copyright page.'),
    h('label', { class: 'field' }, h('span', { text: 'ISBN' }), input),
    error,
    h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, icon('search'), 'Look up'));
  input.addEventListener('input', () => { error.hidden = true; });
  sheet.open(form);
  input.focus();
}

/* ───────────────────────── Cover photo → OCR → search ───────────────────────── */

const ocr = { promise: null, langs: '', onProgress: null };

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = h('script', { src });
    s.onload = resolve;
    s.onerror = () => { s.remove(); reject(new Error('Could not load ' + src)); };
    document.head.append(s);
  });
}

/** Starts (or reuses) the text-recognition worker. Roughly 10 MB on first use, cached afterwards. */
function getOcrWorker() {
  const langs = settings.langs.join('+');
  if (ocr.promise && ocr.langs === langs) return ocr.promise;
  ocr.promise?.then((w) => w.terminate()).catch(() => {});
  ocr.langs = langs;
  const mine = ocr.promise = (async () => {
    if (!window.Tesseract) await loadScript('vendor/tesseract/tesseract.min.js');
    const worker = await window.Tesseract.createWorker(settings.langs, 1, {
      workerPath: abs('vendor/tesseract/worker.min.js'),
      corePath: abs('vendor/tesseract/core'),
      langPath: abs('vendor/tesseract/lang'),
      workerBlobURL: false,
      cacheMethod: 'none', // the service worker already keeps these files
      logger: (m) => ocr.onProgress?.(m),
    });
    await worker.setParameters({ user_defined_dpi: '200' });
    return worker;
  })();
  mine.catch(() => { if (ocr.promise === mine) ocr.promise = null; });
  return mine;
}

function warmOcr() { getOcrWorker().catch((err) => console.warn('OCR unavailable', err)); }

/** Turns Tesseract's block tree into clean lines, top to bottom. */
function extractLines(data) {
  const lines = [];
  for (const block of data.blocks || []) for (const para of block.paragraphs || []) for (const line of para.lines || []) {
    const words = (line.words || [])
      .filter((w) => w.confidence >= 60)
      .map((w) => ({ text: w.text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.!?]+$/gu, ''), box: w.bbox }))
      .filter((w) => /[\p{L}\p{N}]/u.test(w.text));
    if (!words.some((w) => /\p{L}{2}/u.test(w.text))) continue;
    lines.push({
      text: words.map((w) => w.text).join(' '),
      height: Math.max(...words.map((w) => w.box.y1 - w.box.y0)),
      top: Math.min(...words.map((w) => w.box.y0)),
      bottom: Math.max(...words.map((w) => w.box.y1)),
      left: Math.min(...words.map((w) => w.box.x0)),
    });
  }
  // Reading order: top to bottom, and left to right for pieces on the same row.
  return lines.sort((a, b) => (Math.abs(a.top - b.top) < Math.min(a.height, b.height) * 0.5 ? a.left - b.left : a.top - b.top));
}

const BLURB = /bestsell|author of|auteur van|winner|winnaar|prize|prijs|\broman\b|novel|edition|editie|foreword|voorwoord|introduc|vertaald|translated|\btimes\b|review|million|miljoen/i;
const NAME_PART = /^(\p{Lu}[\p{L}.'’-]*|van|de|der|den|von|le|la|du|di|da|ten|ter|and|en|et|&)$/u;

/**
 * The biggest text is usually the title, and the most prominent name-shaped line
 * the author — unless the biggest text is itself a name sitting above a title.
 */
function guessTitleAuthor(lines) {
  if (!lines.length) return { title: '', author: '' };
  const text = (group) => group.map((l) => l.text).join(' ');
  const tallestOf = (pool) => pool.reduce((a, b) => (b.height > a.height ? b : a));
  const nameLike = (str) => {
    const parts = str.split(/\s+/);
    return parts.length >= 2 && parts.length <= 5 && parts.every((p) => NAME_PART.test(p)) && !BLURB.test(str);
  };
  // Lines of one title are about the same size and sit close together.
  const joins = (a, b) => a && b
    && Math.min(a.height, b.height) >= Math.max(a.height, b.height) * 0.72
    && b.top - a.bottom < Math.max(a.height, b.height) * 1.1;
  const groupAround = (seed, pool) => {
    let from = pool.indexOf(seed), to = from;
    while (to - from < 2 && joins(pool[from - 1], pool[from])) from--;
    while (to - from < 2 && joins(pool[to], pool[to + 1])) to++;
    return pool.slice(from, to + 1);
  };

  let title = groupAround(tallestOf(lines), lines);
  let rest = lines.filter((l) => !title.includes(l));
  let author = '';
  if (rest.length && nameLike(text(title))) {
    const second = groupAround(tallestOf(rest), rest);
    if (!nameLike(text(second)) && !BLURB.test(text(second)) && second[0].height >= title[0].height * 0.4) {
      author = text(title);
      title = second;
      rest = rest.filter((l) => !second.includes(l));
    }
  }
  if (!author) author = rest.filter((l) => nameLike(l.text)).sort((a, b) => b.height - a.height)[0]?.text || '';
  return { title: tidyCase(text(title)), author: tidyCase(author) };
}

/** Crops the part of the camera frame that sits inside the viewfinder. */
function grabFinderFrame() {
  const vw = video.videoWidth, vh = video.videoHeight;
  const er = video.getBoundingClientRect(), fr = $('finder').getBoundingClientRect();
  const scale = Math.max(er.width / vw, er.height / vh); // object-fit: cover
  const ox = (er.width - vw * scale) / 2, oy = (er.height - vh * scale) / 2;
  const pad = fr.width * 0.05;
  const x = Math.max(0, (fr.left - er.left - ox - pad) / scale);
  const y = Math.max(0, (fr.top - er.top - oy - pad) / scale);
  const w = Math.min(vw - x, (fr.width + 2 * pad) / scale);
  const hgt = Math.min(vh - y, (fr.height + 2 * pad) / scale);
  return makeShots(video, x, y, w, hgt);
}

function makeShots(source, sx, sy, sw, sh) {
  const draw = (maxSide) => {
    const k = Math.min(1, maxSide / Math.max(sw, sh));
    const c = h('canvas', { width: Math.round(sw * k), height: Math.round(sh * k) });
    c.getContext('2d').drawImage(source, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  };
  return { canvas: draw(1500), thumb: draw(300).toDataURL('image/jpeg', 0.72) };
}

async function captureCover() {
  if (scanner.capturing || !scanner.stream || video.readyState < 2) return;
  const shots = grabFinderFrame();
  video.pause();
  $('flash').classList.remove('go');
  void $('flash').offsetHeight;
  $('flash').classList.add('go');
  buzz();
  await processCover(shots);
}

async function coverFromFile(file) {
  if (!file || scanner.capturing) return;
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { toast('That photo couldn’t be opened'); return; }
  const shots = makeShots(bitmap, 0, 0, bitmap.width, bitmap.height);
  bitmap.close?.();
  await processCover(shots);
}

async function processCover({ canvas, thumb }) {
  const session = scanner.session;
  const isbn = scanner.pendingIsbn;
  scanner.capturing = true;
  $('shutterBtn').disabled = true;
  const progress = busyCard('Reading the cover…', true);
  showCard(progress);
  setHint('');

  let lines = [], printedIsbn = null;
  try {
    ocr.onProgress = (m) => { if (m.status === 'recognizing text') progress.setProgress(0.15 + m.progress * 0.85); else progress.setProgress(0.1); };
    const worker = await getOcrWorker();
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('OCR timed out')), 30000));
    await worker.setParameters({ tessedit_pageseg_mode: '11' }); // sparse text: covers are not paragraphs
    const { data } = await Promise.race([worker.recognize(canvas, {}, { text: true, blocks: true }), timeout]);
    lines = extractLines(data);
    printedIsbn = findPrintedIsbn(data.text);
  } catch (err) {
    console.warn(err);
  } finally {
    ocr.onProgress = null;
  }
  if (!alive(session)) return;

  // A photographed back cover or copyright page: the ISBN on it beats guessing from the text.
  if (printedIsbn && printedIsbn !== isbn) {
    scanner.capturing = false;
    $('shutterBtn').disabled = false;
    video.play().catch(() => {});
    setMode('barcode');
    onIsbn(printedIsbn);
    return;
  }

  const guess = guessTitleAuthor(lines);
  let candidates = [];
  if (guess.title) {
    progress.setProgress(1);
    progress.setText('Searching the catalogues…');
    candidates = await searchByText(guess, lines);
    if (!alive(session)) return;
  }
  showCard(null);

  const finish = (saved) => {
    scanner.capturing = false;
    $('shutterBtn').disabled = false;
    if (!scanner.open) return;
    video.play().catch(() => {});
    if (saved) { scanner.added++; updateScanCount(); setMode('barcode'); toast('Added to your shelf'); }
    else setHint();
  };
  const draft = { title: guess.title, author: guess.author, isbn, thumb };
  const chipLines = lines.map((l) => tidyCase(l.text)).filter((t) => t.length > 1);
  const editByHand = () => openBookForm({
    book: draft, isNew: true, ocrLines: chipLines, onClose: finish,
    heading: lines.length ? 'Check the details' : 'Couldn’t read the cover',
    subheading: lines.length ? 'This is what the cover seems to say — fix anything that’s off.' : 'No text could be made out. Type the details, or cancel and try another photo.',
  });

  if (!candidates.length) { editByHand(); return; }

  let picked = false;
  const rows = candidates.map((c, i) => bookRow(c.book, async (b) => {
    if (picked) return;
    picked = true;
    await addBook({ ...b, isbn: isbn || b.isbn, thumb });
    sheet.close();
  }, i === 0 && c.score >= 0.75 ? h('span', { class: 'badge', text: 'Best match' }) : null));
  rows.forEach((r) => r.classList.add('cand'));
  sheet.open(h('div', null,
    sheetHead('Is it one of these?', 'Tap the right book to add it.'),
    h('div', { class: 'cand-list' }, rows),
    h('button', { class: 'btn btn-outline btn-block', type: 'button', onclick: editByHand }, icon('pencil'), 'None of these — enter it myself')),
  () => finish(picked));
}

/* ───────────────────────── Wiring ───────────────────────── */

function bindEvents() {
  $('scanBtn').addEventListener('click', openScanner);
  $('exportBtn').addEventListener('click', openExport);
  $('settingsBtn').addEventListener('click', openSettings);
  $('search').addEventListener('input', renderLibrary);

  $('scanClose').addEventListener('click', closeLayer);
  $('typeIsbnBtn').addEventListener('click', openIsbnSheet);
  $('noBarcodeBtn').addEventListener('click', () => setMode('cover'));
  $('backToBarcodeBtn').addEventListener('click', () => { if (!scanner.capturing) setMode('barcode'); });
  $('byHandBtn').addEventListener('click', () => { if (!scanner.capturing) manualEntry(scanner.pendingIsbn); });
  $('shutterBtn').addEventListener('click', () => { if (scanner.stream) captureCover(); else $('coverFile').click(); });
  $('coverFile').addEventListener('change', (e) => { const file = e.target.files[0]; e.target.value = ''; coverFromFile(file); });
  $('torchBtn').addEventListener('click', async () => {
    const on = $('torchBtn').getAttribute('aria-pressed') !== 'true';
    try { await scanner.track.applyConstraints({ advanced: [{ torch: on }] }); $('torchBtn').setAttribute('aria-pressed', String(on)); }
    catch { toast('The flashlight isn’t available'); }
  });
}

/** Books scanned without a connection get their details as soon as there is one. */
let retrying = false;
async function retryPending() {
  if (retrying || navigator.onLine === false) return;
  retrying = true;
  try {
    for (const book of books.filter((b) => b.pending)) {
      const result = await lookupIsbn(book.isbn);
      if (result.status === 'unreachable') break;
      if (result.status === 'found') Object.assign(book, result.book, { pending: false });
      else Object.assign(book, { pending: false, unresolved: true });
      await saveBook(book);
    }
  } finally {
    retrying = false;
  }
}

/**
 * Installed copies must pick up a new deploy. The service worker compares what it has
 * cached with the server; when something changed it says so, and the app restarts into
 * the new version (or offers to, if you are in the middle of something).
 */
function initUpdates() {
  if (!('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  let registration = null, lastCheck = Date.now();

  sw.register('sw.js', { updateViaCache: 'none' })
    .then((reg) => { registration = reg; })
    .catch((err) => console.warn('Service worker failed', err));

  sw.addEventListener('message', (event) => {
    if (event.data?.type !== 'bookscan-updated') return;
    let recent = false;
    try {
      recent = Date.now() - Number(sessionStorage.getItem('bookscan.reloaded') || 0) < 30000;
      if (!recent && !layers.length) sessionStorage.setItem('bookscan.reloaded', String(Date.now()));
    } catch {}
    if (!layers.length && !recent) location.reload();
    else toast('A new version is ready', { action: 'Reload', onAction: () => location.reload(), ms: 12000 });
  });

  // An installed app can sit in the background for days: check again when it comes back.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || Date.now() - lastCheck < 10 * 60 * 1000) return;
    lastCheck = Date.now();
    registration?.update().catch(() => {});
    sw.controller?.postMessage({ type: 'bookscan-check' });
  });
}

async function init() {
  initTheme();
  bindEvents();
  try {
    books = await DB.all();
    sortBooks();
  } catch (err) {
    storageFailed(err);
  }
  renderLibrary();
  navigator.storage?.persist?.().catch(() => {});
  initUpdates();
  window.addEventListener('online', () => { retryPending(); runSync(); });
  // Pick up changes from other devices whenever the app comes back to the foreground.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && time(sync.last) < Date.now() - 30000) runSync();
  });
  retryPending();
  runSync();

  // Home-screen shortcut: jump straight into the scanner.
  if (new URLSearchParams(location.search).has('scan')) {
    history.replaceState(null, '', location.pathname);
    openScanner();
  }
}

init();
