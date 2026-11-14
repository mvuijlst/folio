// Folio — your books on lists (library, to read, reading, read, lent out, …), added by
// scanning their ISBN barcode. It began as Bookscan, which is why the names of things kept
// in the browser (storage keys, databases, caches) still start with "bookscan": renaming
// those would cut existing installs off from their shelf.
// Plain ES module, no build step. The shelf is stored on the device (IndexedDB) and, for
// signed-in users, synced with the small Django server in server/.

import NL from './lang-nl.js';

const APP_VERSION = '1.9.0'; // shown under Settings, so you can tell which build is running

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

/* ───────────────────────── Language ───────────────────────── */

// The app's own text is written in English in the code; other languages are a dictionary
// from those English sentences (lang-nl.js). The choice is made under Settings and takes
// effect by reloading, so nothing here has to cope with the language changing midway.
const LANGS = { en: 'English', nl: 'Nederlands' };
const DICTIONARIES = { nl: NL };
const langChoice = store.get('lang', 'auto');   // 'auto' follows the device
const lang = langChoice in LANGS
  ? langChoice
  : (navigator.languages || [navigator.language || 'en']).map((l) => l.slice(0, 2).toLowerCase()).find((l) => l in LANGS) || 'en';
/** For dates: the device's own habits when the language follows the device. */
const LOCALE = langChoice in LANGS ? { en: 'en-GB', nl: 'nl-BE' }[lang] : undefined;

/** t('Saved {name}', {name}) → that sentence in the chosen language, with the blanks filled in. */
function t(text, values) {
  const out = DICTIONARIES[lang]?.[text] ?? text;
  return values ? out.replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match) : out;
}

const COUNTED = {
  en: { book: ['book', 'books'], change: ['change', 'changes'], hour: ['hour', 'hours'] },
  nl: { book: ['boek', 'boeken'], change: ['wijziging', 'wijzigingen'], hour: ['uur', 'uur'] },
};
const plural = (n, word) => `${n} ${COUNTED[lang][word][n === 1 ? 0 : 1]}`;

/** Fills the text that is written out in index.html. */
function localize() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.textContent.trim());
  for (const attr of ['aria-label', 'title', 'placeholder']) {
    for (const el of document.querySelectorAll(`[${attr}]`)) el.setAttribute(attr, t(el.getAttribute(attr)));
  }
}

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

// Books and lists each have a database of their own. Lists came later, and adding a store
// to the books database would have meant a version upgrade — which waits for as long as an
// older copy of the app is open in another tab, leaving this one with an empty shelf.
function table(database, name) {
  let opening;
  const open = () => (opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(database, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(name, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(name, mode);
      const req = fn(tx.objectStore(name));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  };
  return {
    all: () => run('readonly', (s) => s.getAll()),
    put: (row) => run('readwrite', (s) => s.put(row)),
    del: (id) => run('readwrite', (s) => s.delete(id)),
  };
}
const DB = { ...table('bookscan', 'books'), lists: table('bookscan-lists', 'lists') };

/** In-memory copy of the shelf, newest first. */
let books = [];

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

async function addBook(data) {
  const book = {
    id: newId(), added: new Date().toISOString(),
    title: '', author: '', publisher: '', date: '', pages: null, isbn: '', cover: '', thumb: '', lists: {},
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
  toast(t('Could not save to this device’s storage'));
}

/* ───────────────────────── Lists ───────────────────────── */

// A book can be on any number of lists. Lists that share a `group` are either-or: putting
// a book on one takes it off the others (to read / reading / read). `book.lists` maps a
// list id to {at, note}: when the book went on that list, and an optional note for lists
// that ask for one ("lent to …").
const EPOCH = '1970-01-01T00:00:00.000Z';
const READING = 'Reading status';
// Every device starts with these, under the same ids, so they are one list everywhere.
// They carry the oldest possible `modified`: any real change, on any device, wins.
const STANDARD_LISTS = [
  { id: 'library', name: 'Library', group: '', noteLabel: '' },
  { id: 'to-read', name: 'To read', group: READING, noteLabel: '' },
  { id: 'reading', name: 'Reading', group: READING, noteLabel: '' },
  { id: 'read', name: 'Read', group: READING, noteLabel: '' },
  { id: 'lent', name: 'Lent out', group: '', noteLabel: 'Lent to' },
];

/** The user's lists, in their order. */
let lists = [];
/** What the library shows: one list, or every book when `list` is null. */
const VIEWS = ['list', 'covers', 'cards'];
// One of: every book, a list (`list`), all series (`seriesIndex`) or one series (`series`, its name).
const view = { list: null, series: null, seriesIndex: false, mode: VIEWS.includes(store.get('view', 'list')) ? store.get('view', 'list') : 'list' };

// The standard lists (and their group and note) are stored under their English names, so
// they are the same list on a Dutch and an English device. Until they are renamed, they
// are shown in the device's language.
const STANDARD_TEXT = new Set([READING, ...STANDARD_LISTS.flatMap((l) => [l.name, l.noteLabel])].filter(Boolean));
const show = (text) => (STANDARD_TEXT.has(text) ? t(text) : text);

const sortLists = () => lists.sort((a, b) => ((a.order ?? 0) - (b.order ?? 0)) || String(a.name).localeCompare(b.name));
const listById = (id) => lists.find((l) => l.id === id);

/** {listId: {at, note}} for a book. Books from before lists existed count as in the Library. */
const shelves = (book) => book.lists || { library: { at: book.added } };

/** The lists a book is on, in list order: [{list, at, note}]. */
function listsOf(book) {
  const on = shelves(book);
  return lists.filter((l) => on[l.id]).map((l) => ({ list: l, at: on[l.id].at || book.added, note: on[l.id].note || '' }));
}

/** Puts list `id` in a {listId: …} map, taking the book off the other lists of its group. */
function place(on, id, at = new Date().toISOString()) {
  const list = listById(id);
  if (!list) return on;
  if (list.group) for (const other of lists) if (other.group === list.group && other.id !== id) delete on[other.id];
  on[id] ??= { at };
  return on;
}

/** A fresh {listId: …} map holding the given lists. */
const placed = (ids) => ids.reduce((on, id) => place(on, id), {});

/** Lists as they are shown: either-or groups kept together, loose lists in between. */
function listSections() {
  const sections = [];
  for (const list of lists) {
    let section = list.group ? sections.find((s) => s.label === list.group) : sections.at(-1);
    if (!section || (!list.group && section.label)) sections.push(section = { label: list.group || '', members: [] });
    section.members.push(list);
  }
  return sections;
}

async function saveList(list) {
  if (!lists.includes(list)) lists.push(list);
  touchList(list.id, list);
  sortLists();
  renderLibrary();
  await DB.lists.put(list).catch(storageFailed);
}

async function removeList(list) {
  lists = lists.filter((l) => l.id !== list.id);
  touchList(list.id);
  renderLibrary();
  await DB.lists.del(list.id).catch(storageFailed);
}

async function loadLists() {
  lists = await DB.lists.all();
  if (!lists.length && !store.get('listsSeeded', false)) await seedLists();
  sortLists();
}

async function seedLists() {
  lists = STANDARD_LISTS.map((l, order) => ({ ...l, order, modified: EPOCH }));
  store.set('listsSeeded', true);
  await Promise.all(lists.map((l) => DB.lists.put(l)));
}

/* Series: books that share a `series` name, in the order of their `seriesNumber`. */

/** What a book's place in its series is called: its label ("4/5") if it has one, else its number. */
const seriesNo = (b) => String(b.seriesLabel || (b.seriesNumber ?? ''));
const seriesOrder = (b) => { const n = parseFloat(b.seriesNumber); return Number.isFinite(n) ? n : Infinity; };
const bySeriesOrder = (a, b) => (seriesOrder(a) - seriesOrder(b)) || (a.added < b.added ? -1 : 1);

/** Every series on the shelf: name → its books, in order. */
function seriesMap() {
  const map = new Map();
  for (const b of books) if (b.series) (map.get(b.series) || map.set(b.series, []).get(b.series)).push(b);
  for (const members of map.values()) members.sort(bySeriesOrder);
  return map;
}

function readRoute() {
  const part = (s) => { try { return decodeURIComponent(s); } catch { return ''; } };
  Object.assign(view, { list: null, series: null, seriesIndex: false });
  let m;
  if ((m = location.hash.match(/^#\/list\/(.+)$/))) view.list = listById(part(m[1])) ? part(m[1]) : null;
  else if ((m = location.hash.match(/^#\/series\/(.+)$/))) view.series = part(m[1]) || null;
  else if (/^#\/series\/?$/.test(location.hash)) view.seriesIndex = true;
}

/** Open every book (null), a list (its id), all series ({seriesIndex: true}) or one ({series: name}). */
function setView(target) {
  const wasSeries = view.seriesIndex || view.series;
  Object.assign(view, { list: null, series: null, seriesIndex: false });
  if (typeof target === 'string') view.list = listById(target) ? target : null;
  else if (target?.series) view.series = target.series;
  else if (target?.seriesIndex) view.seriesIndex = true;
  if (wasSeries || view.seriesIndex || view.series) $('search').value = '';   // what you looked for among series isn't what you look for in one
  const address = view.list ? `#/list/${encodeURIComponent(view.list)}`
    : view.series ? `#/series/${encodeURIComponent(view.series)}`
      : view.seriesIndex ? '#/series' : location.pathname + location.search;
  // Replaced, not pushed: these are tabs, and Back keeps closing sheets and leaving the app.
  history.replaceState(history.state, '', address);
  renderLibrary();
  if (window.scrollY > $('lists').offsetTop) window.scrollTo(0, 0);
}

/* ───────────────────────── Sync (optional account) ───────────────────────── */

// Signing in keeps a copy of the shelf on the server, so it can be opened on other devices.
// Every change stamps the book with `modified` and is remembered in `sync.dirty` until the
// server has it; the newest change to a book wins. Deleted books are sent as tombstones.
// The lists themselves (names, order, groups) sync the same way, next to the books.
const sync = {
  user: store.get('syncUser', null),
  cursor: store.get('syncCursor', null),   // server time of the last completed sync
  dirty: store.get('syncDirty', {}),       // book id → `modified` of a change not yet on the server
  listsCursor: store.get('syncListsCursor', null),
  dirtyLists: store.get('syncDirtyLists', {}),
  last: store.get('syncLast', null),       // when the last sync finished (this device's clock)
  error: '',
  running: null, again: false, timer: 0,
  box: null,                               // the account section, while the settings sheet shows it
};

function saveSyncState() {
  store.set('syncUser', sync.user);
  store.set('syncCursor', sync.cursor);
  store.set('syncDirty', sync.dirty);
  store.set('syncListsCursor', sync.listsCursor);
  store.set('syncDirtyLists', sync.dirtyLists);
  store.set('syncLast', sync.last);
}

const waitingChanges = () => Object.keys(sync.dirty).length + Object.keys(sync.dirtyLists).length;

/** Record a change to a book (pass the book) or its deletion (pass only the id). */
function touch(id, book) {
  const now = new Date().toISOString();
  if (book) book.modified = now;
  sync.dirty[id] = now;
  store.set('syncDirty', sync.dirty);
  scheduleSync();
}

/** The same for a list. */
function touchList(id, list) {
  const now = new Date().toISOString();
  if (list) list.modified = now;
  sync.dirtyLists[id] = now;
  store.set('syncDirtyLists', sync.dirtyLists);
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
  if (!res.ok) throw Object.assign(new Error(json.error ? t(json.error) : t('Server error {n}', { n: res.status })), { status: res.status });
  return json;
}

const time = (iso) => Date.parse(iso) || 0;

async function runSync({ loud = false } = {}) {
  if (!sync.user) return;
  if (navigator.onLine === false) { if (loud) toast(t('You’re offline — changes will sync later')); return; }
  if (sync.running) { sync.again = true; return sync.running; }
  clearTimeout(sync.timer);
  sync.running = (async () => {
    try {
      do {
        sync.again = false;
        const sent = { ...sync.dirty }, sentLists = { ...sync.dirtyLists };
        const pack = (dirty, rows, key) => {
          const byId = new Map(rows.map((r) => [r.id, r]));
          return Object.entries(dirty).map(([id, modified]) => {
            const row = byId.get(id);
            return { id, modified, deleted: !row, [key]: row || null };
          });
        };
        const res = await api('sync', {
          since: sync.cursor, changes: pack(sent, books, 'book'),
          listsSince: sync.listsCursor, lists: pack(sentLists, lists, 'list'),
        });
        if (!sync.user) return;   // signed out meanwhile
        for (const [id, modified] of Object.entries(sent)) if (sync.dirty[id] === modified) delete sync.dirty[id];
        if (res.lists) {   // a server from before lists existed leaves them waiting
          for (const [id, modified] of Object.entries(sentLists)) if (sync.dirtyLists[id] === modified) delete sync.dirtyLists[id];
          await applyRemoteLists(res.lists);
          sync.listsCursor = res.cursor;
        }
        await applyRemote(res.changes || []);
        sync.cursor = res.cursor;
        sync.last = new Date().toISOString();
        sync.error = '';
        saveSyncState();
      } while (sync.again);
      if (loud) toast(t('Shelf synced'));
    } catch (err) {
      if (err.status === 401) {
        forgetAccount();
        toast(t('Signed out — sign in again to keep syncing'), { action: t('Sign in'), onAction: openSettings });
      } else {
        sync.error = err.status ? err.message : t('Couldn’t reach the server');
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

async function applyRemoteLists(changes) {
  if (!changes.length) return;
  for (const c of changes) {
    if (sync.dirtyLists[c.id] && time(sync.dirtyLists[c.id]) >= time(c.modified)) continue;
    const local = listById(c.id);
    if (c.deleted) {
      if (!local) continue;
      lists = lists.filter((l) => l !== local);
      await DB.lists.del(c.id).catch(storageFailed);
    } else {
      const list = { ...c.list, id: c.id, modified: c.modified };
      if (local) {
        for (const k of Object.keys(local)) delete local[k];
        Object.assign(local, list);
      } else {
        lists.push(list);
      }
      await DB.lists.put(local || list).catch(storageFailed);
    }
  }
  sortLists();
  renderLibrary();
}

async function signIn(username, password) {
  const res = await api('login', { username, password });
  sync.user = res.user;
  sync.cursor = sync.listsCursor = null;
  sync.error = '';
  // Offer everything on this device; books the server has newer copies of come back from it.
  for (const b of books) sync.dirty[b.id] ??= b.modified || b.added;
  for (const l of lists) sync.dirtyLists[l.id] ??= l.modified || EPOCH;
  saveSyncState();
  renderAccount();
  await runSync();
  toast(sync.error || t('Signed in — {n} on your shelf', { n: plural(books.length, 'book') }));
}

function forgetAccount() {
  Object.assign(sync, { user: null, cursor: null, listsCursor: null, last: null, error: '' });
  clearTimeout(sync.timer);
  saveSyncState();
  renderAccount();
}

async function signOut({ clearShelf }) {
  if (waitingChanges() && navigator.onLine !== false) await runSync();
  if (!sync.user) return;   // the session had already ended
  const waiting = waitingChanges();
  if (clearShelf && waiting) {
    toast(t('{n} haven’t reached the server yet — sync before clearing this device', { n: plural(waiting, 'change') }));
    return;
  }
  try { await api('logout', {}); } catch {}
  forgetAccount();
  if (clearShelf) {
    const gone = books, goneLists = lists;
    books = [];
    sync.dirty = {};
    sync.dirtyLists = {};
    saveSyncState();
    await Promise.all([...gone.map((b) => DB.del(b.id)), ...goneLists.map((l) => DB.lists.del(l.id))]).catch(storageFailed);
    await seedLists().catch(storageFailed);   // back to the lists a new device starts with
    renderLibrary();
  }
  toast(clearShelf ? t('Signed out and cleared this device') : t('Signed out — your shelf stays on this device'));
}

function agoText(iso) {
  const s = Math.round((Date.now() - time(iso)) / 1000);
  if (s < 45) return t('just now');
  if (s < 3600) return t('{n} min ago', { n: Math.round(s / 60) });
  if (s < 86400) return t('{n} ago', { n: plural(Math.round(s / 3600), 'hour') });
  return new Date(iso).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
}

/** The account part of the settings sheet; re-rendered whenever sync state changes. */
function renderAccount() {
  const box = sync.box;
  if (!box?.isConnected) { sync.box = null; return; }

  if (!sync.user) {
    const user = h('input', { name: 'username', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', required: true });
    const pass = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true });
    const error = h('p', { class: 'field-error', hidden: true });
    const button = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, t('Sign in'));
    const form = h('form', {
      class: 'account-form',
      onsubmit: async (e) => {
        e.preventDefault();
        if (!user.value.trim() || !pass.value) { error.textContent = t('Enter your username and password.'); error.hidden = false; return; }
        button.disabled = true;
        error.hidden = true;
        try {
          await signIn(user.value.trim(), pass.value);
        } catch (err) {
          error.textContent = err.status ? err.message : t('Couldn’t reach the server. Are you online?');
          error.hidden = false;
          button.disabled = false;
        }
      },
    },
    h('div', { class: 'field-row' },
      h('label', { class: 'field' }, h('span', { text: t('Username') }), user),
      h('label', { class: 'field' }, h('span', { text: t('Password') }), pass)),
    error, button);
    box.replaceChildren(
      h('h3', { text: t('Account') }),
      form,
      h('p', { class: 'sheet-note', text: t('Optional. Signed in, your shelf is also kept on the server, so you can open it on your other devices. Ask the person who runs this site for an account.') }));
    return;
  }

  const waiting = waitingChanges();
  let status;
  if (sync.running) status = t('Syncing…');
  else if (sync.error) status = `${sync.error}.${waiting ? ` ${t('{n} waiting.', { n: plural(waiting, 'change') })}` : ''}`;
  else if (waiting) status = t('{n} waiting to sync.', { n: plural(waiting, 'change') });
  else status = sync.last ? t('Synced {when}.', { when: agoText(sync.last) }) : t('Not synced yet.');

  box.replaceChildren(
    h('h3', { text: t('Account') }),
    h('p', { class: 'account-line' }, t('Signed in as '), h('strong', { text: sync.user })),
    h('p', { class: 'sheet-note account-status' + (sync.error ? ' is-error' : ''), text: status }),
    h('div', { class: 'stack account-actions' },
      h('button', { class: 'btn btn-outline btn-block', type: 'button', disabled: !!sync.running, onclick: () => runSync({ loud: true }) }, icon('sync'), t('Sync now')),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-outline', type: 'button', text: t('Sign out'), onclick: () => signOut({ clearShelf: false }) }),
        h('button', { class: 'btn btn-outline btn-danger', type: 'button', text: t('Sign out & clear'), title: t('Sign out and remove the shelf from this device (it stays on the server)'), onclick: () => signOut({ clearShelf: true }) }))),
    h('p', { class: 'sheet-note', text: t('“Sign out & clear” removes the shelf from this device only; it stays on the server.') }));
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
  // Rating (0–10) and how far along come with books from the booklog at boeken.tsuk.org.
  const progress = b.pagesRead && b.pages ? t('{n}% read', { n: Math.min(100, Math.round((b.pagesRead / b.pages) * 100)) }) : '';
  return [b.publisher, yearOf(b.date) || b.date, b.pages && t('{n} pp', { n: b.pages }), progress, b.rating != null && `★ ${b.rating}`]
    .filter(Boolean).join(' · ');
}

/** On a series' own page its name needn't be repeated on every book. */
const inOpenSeries = (b) => !!view.series && b.series === view.series;
const seriesLine = (b) => (b.series ? `${b.series}${seriesNo(b) ? ` #${seriesNo(b)}` : ''}` : '');

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
    extra || h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Close'), onclick: () => sheet.close() }, icon('x')));
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

/**
 * A book's cover, in the cover's own proportions (a square audiobook stays square). Covers
 * kept on the server say how wide they are for their height (`coverRatio`), so the box has
 * the right shape before the image arrives; for other covers it takes shape on loading.
 * Without an image it is a coloured book with the title's first letter (and, where
 * `titled`, the title itself: in the covers view there is nothing else to tell books apart).
 */
function coverEl(book, large, titled) {
  const label = book.title || book.isbn || '?';
  const el = h('div', { class: 'cover' + (large ? ' lg' : ''), style: `--h:${hue(label)}` },
    h('span', { text: (book.title || '?').trim().charAt(0).toUpperCase() }),
    titled && h('small', { text: displayTitle(book) }));
  const shape = (ratio) => {
    if (ratio > 0) el.style.setProperty('--r', Math.min(1.6, Math.max(0.45, ratio)).toFixed(3));
    else el.style.removeProperty('--r');
  };
  const sources = [book.cover, book.thumb].filter(Boolean);
  if (sources.length) {
    shape(book.coverRatio);
    const img = h('img', { alt: '', loading: 'lazy', decoding: 'async' });
    const next = () => { shape(0); const src = sources.shift(); if (src) img.src = src; else img.remove(); };
    img.addEventListener('error', next);
    // Open Library answers a missing cover with a 1×1 pixel image.
    img.addEventListener('load', () => { if (img.naturalWidth < 8) next(); else shape(img.naturalWidth / img.naturalHeight); });
    const first = sources.shift();
    img.src = first;
    el.append(img);
  }
  return el;
}

function displayTitle(b) {
  if (b.title) return b.title;
  return b.pending ? `ISBN ${b.isbn}` : t('Unknown book');
}

/** Small labels for the lists a book is on; in a list's own view only its note ("Lent to: …"). */
function listTags(book, current) {
  const tags = listsOf(book).map(({ list, note }) => {
    if (list === current) return note && `${show(list.noteLabel) || t('Note')}: ${note}`;
    return note ? `${show(list.name)}: ${note}` : show(list.name);
  }).filter(Boolean);
  return tags.length ? h('div', { class: 'book-tags' }, tags.map((text) => h('span', { class: 'tag', text }))) : null;
}

function bookRow(b, onPick, extra, tags) {
  let meta;
  if (b.pending) meta = h('div', { class: 'book-meta flag' }, icon('cloud-off'), t('Will be looked up when you’re online'));
  else if (b.unresolved) meta = h('div', { class: 'book-meta flag', text: t('No match found — tap to fill in') });
  else meta = h('div', { class: 'book-meta', text: metaLine(b) });
  return h('button', { class: 'book', type: 'button', onclick: () => onPick(b) },
    coverEl(b),
    h('div', { class: 'book-text' },
      h('div', { class: 'book-title' }, extra, displayTitle(b)),
      h('div', { class: 'book-author', text: [b.author, inOpenSeries(b) ? '' : seriesLine(b)].filter(Boolean).join(' · ') || (b.title ? '' : b.isbn && !b.pending ? `ISBN ${b.isbn}` : '') }),
      meta, tags));
}

/** A book in the covers view: its cover and its rating. */
function bookTile(b, onPick, numbered) {
  return h('button', { class: 'tile', type: 'button', title: [displayTitle(b), b.author].filter(Boolean).join(' — '), onclick: () => onPick(b) },
    coverEl(b, false, true),
    h('div', { class: 'tile-rating', text: [numbered && seriesNo(b) && `#${seriesNo(b)}`, b.rating != null && `★ ${b.rating}`].filter(Boolean).join(' · ') }));
}

/** The start of the latest review, as plain text. */
function excerpt(b) {
  const text = sortedReviews(b).find((r) => r.text)?.text || '';
  return text.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_>#`]/g, '')
    .replace(/\s+/g, ' ').trim().slice(0, 240);
}

/** A book in the cards view: a larger cover, the details, the lists and the start of the review. */
function bookCard(b, onPick, tags) {
  const text = excerpt(b);
  return h('button', { class: 'bcard', type: 'button', onclick: () => onPick(b) },
    coverEl(b),
    h('div', { class: 'book-text' },
      h('div', { class: 'book-title', text: displayTitle(b) }),
      h('div', { class: 'book-author', text: [b.author, inOpenSeries(b) ? '' : seriesLine(b)].filter(Boolean).join(' · ') }),
      h('div', { class: 'book-meta', text: metaLine(b) }),
      text && h('p', { class: 'card-excerpt', text }),
      tags));
}

const monthLabel = (iso) => new Date(iso).toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' });
const yearLabel = (iso) => String(new Date(iso).getFullYear());

function dayLabel(iso) {
  const d = new Date(iso), now = new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 864e5);
  if (days <= 0) return t('Today');
  if (days === 1) return t('Yesterday');
  // Further back, a month is fine enough (and keeps years of reading from being all headings).
  if (days > 45) return d.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' });
  return d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

function renderNav() {
  const counts = new Map(lists.map((l) => [l.id, 0]));
  for (const b of books) for (const id of Object.keys(shelves(b))) if (counts.has(id)) counts.set(id, counts.get(id) + 1);
  const link = (target, href, isCurrent, name, count) => h('a', {
    class: 'nav-item', href, 'aria-current': isCurrent ? 'page' : null,
    onclick: (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;   // let the browser open a new tab
      e.preventDefault();
      setView(target);
    },
  }, h('span', { text: name }), h('b', { text: String(count) }));
  const item = (id, name, count) => link(id, id ? `#/list/${encodeURIComponent(id)}` : '#/',
    view.list === id && !view.series && !view.seriesIndex, name, count);
  const seriesCount = new Set(books.map((b) => b.series).filter(Boolean)).size;
  const nav = $('lists');
  nav.replaceChildren(
    h('div', { class: 'nav-group' },
      item(null, t('All books'), books.length),
      seriesCount > 0 && link({ seriesIndex: true }, '#/series', view.seriesIndex || !!view.series, t('Series'), seriesCount)),
    ...listSections().map((section) => h('div', { class: 'nav-group' },
      section.label && h('span', { class: 'nav-label', text: show(section.label) }),
      section.members.map((l) => item(l.id, show(l.name), counts.get(l.id))))),
    h('div', { class: 'nav-group' },
      h('button', { class: 'nav-item nav-edit', type: 'button', onclick: () => openLists() }, icon('list'), h('span', { text: t('Edit lists') }))));
  // On a phone the lists are one scrolling row: keep the open one in sight.
  const active = nav.querySelector('[aria-current]');
  if (active && (active.offsetLeft < nav.scrollLeft || active.offsetLeft + active.offsetWidth > nav.scrollLeft + nav.clientWidth)) {
    nav.scrollLeft = active.offsetLeft - 20;
  }
}

/** All series, by name: a few covers, how many books, how many of them read. */
function renderSeriesIndex(query) {
  const all = [...seriesMap()].sort((a, b) => a[0].localeCompare(b[0], LOCALE, { sensitivity: 'base' }));
  const found = query ? all.filter(([name, members]) => fold(name + ' ' + members.map((b) => b.author).join(' ')).includes(query)) : all;
  $('searchWrap').hidden = all.length < 8 && !query;
  shown = { rows: [], next: 0, lastDay: '', key: 'series', current: null, query, when: null, series: null };
  $('library').className = 'library mode-series';
  $('library').replaceChildren(...found.map(([name, members]) => {
    const read = members.filter((b) => shelves(b).read).length;
    const authors = [...new Set(members.map((b) => b.author).filter(Boolean))];
    return h('a', {
      class: 'series-row', href: `#/series/${encodeURIComponent(name)}`,
      onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); setView({ series: name }); },
    },
    h('div', { class: 'series-covers' }, members.slice(0, 4).map((b) => coverEl(b))),
    h('div', { class: 'book-text' },
      h('div', { class: 'book-title', text: name }),
      h('div', { class: 'book-author', text: authors.length > 2 ? `${authors[0]}, …` : authors.join(', ') }),
      h('div', { class: 'book-meta', text: `${plural(members.length, 'book')} · ${t('{n} read', { n: read })}` })));
  }));
  if (!found.length) $('library').append(h('p', { class: 'no-results', text: query ? t('No series match that search.') : t('No books in a series yet. Give a book a series in its details.') }));
}

// Everything a search looks through, folded once per version of a book: with reviews in it,
// that is too much text to redo for every book on every keystroke.
const searchCache = new WeakMap();
function searchText(b) {
  const cached = searchCache.get(b);
  if (cached?.modified === b.modified) return cached.text;
  const text = fold([b.title, b.author, b.series, b.publisher, b.isbn, b.date,
    ...listsOf(b).map((m) => m.note), ...(b.reviews || []).map((r) => r.text)].join(' '));
  searchCache.set(b, { modified: b.modified, text });
  return text;
}

// A shelf can hold thousands of books, so the library is drawn a page at a time: more rows
// are added as you scroll towards the end.
const PAGE = 120;
let shown = { rows: [], next: 0, lastDay: '', key: '', current: null, query: '', when: null };
window.addEventListener('scroll', () => {
  const more = $('more');
  if (more && more.getBoundingClientRect().top < window.innerHeight + 800) appendRows();
}, { passive: true });

function appendRows(upTo = shown.next + PAGE) {
  $('more')?.remove();
  const frag = document.createDocumentFragment();
  const end = Math.min(shown.rows.length, upTo);
  // The denser the view, the coarser its headings: days in the list, months for cards, years for covers.
  // A series is in the order of the books, not of when you added them: no headings there.
  const heading = shown.series ? () => '' : { list: dayLabel, cards: monthLabel, covers: yearLabel }[view.mode];
  for (const b of shown.rows.slice(shown.next, end)) {
    const day = heading(shown.when(b));
    if (!shown.query && day !== shown.lastDay) { frag.append(h('h2', { class: 'day', text: day })); shown.lastDay = day; }
    const number = shown.series && seriesNo(b) ? h('span', { class: 'badge', text: `#${seriesNo(b)}` }) : null;
    if (view.mode === 'covers') frag.append(bookTile(b, openBook, !!shown.series));
    else if (view.mode === 'cards') frag.append(bookCard(b, openBook, listTags(b, shown.current)));
    else frag.append(bookRow(b, openBook, number, listTags(b, shown.current)));
  }
  shown.next = end;
  const more = end < shown.rows.length
    && h('button', { id: 'more', class: 'btn btn-outline btn-block more', type: 'button', onclick: () => appendRows() }, t('Show more'));
  if (more) frag.append(more);   // also a button, for when scrolling isn't how you get there
  $('library').append(frag);
}

function renderLibrary() {
  if (view.list && !listById(view.list)) view.list = null;   // the open list was deleted
  const current = view.list ? listById(view.list) : null;
  const query = fold($('search').value.trim());
  $('count').textContent = books.length ? plural(books.length, 'book') : t('Nothing scanned yet');
  $('search').placeholder = view.seriesIndex ? t('Search series')
    : view.series ? t('Search {list}', { list: view.series })
      : current ? t('Search {list}', { list: show(current.name) }) : t('Search your shelf');
  $('empty').hidden = books.length > 0;
  $('tools').hidden = !books.length;
  $('library').className = `library mode-${view.mode}`;
  for (const button of $('viewSeg').children) button.setAttribute('aria-pressed', String(button.dataset.view === view.mode));
  renderNav();
  $('viewSeg').hidden = view.seriesIndex;
  if (view.seriesIndex) { renderSeriesIndex(query); return; }

  // A list shows the book that went on it last first; the whole shelf, the one added last;
  // a series, its books in their order.
  const when = (b) => (current ? shelves(b)[current.id].at || b.added : b.added);
  const inView = view.series ? books.filter((b) => b.series === view.series).sort(bySeriesOrder)
    : current ? books.filter((b) => shelves(b)[current.id]).sort((a, b) => (when(a) < when(b) ? 1 : -1)) : books;
  $('searchWrap').hidden = inView.length < 8 && !query;

  const found = query
    ? inView.filter((b) => searchText(b).includes(query))
    : inView;
  // Redrawing the same view (after a save, a sync) keeps as many rows as were showing.
  const key = `${view.list}|${view.series}|${view.mode}|${query}`;
  const rows = key === shown.key ? Math.max(PAGE, shown.next) : PAGE;
  shown = { rows: found, next: 0, lastDay: '', key, current, query, when, series: view.series };
  $('library').replaceChildren();
  if (view.series) {
    const read = inView.filter((b) => shelves(b).read).length;
    $('library').append(h('div', { class: 'series-head' },
      h('a', { class: 'link-btn', href: '#/series', onclick: (e) => { e.preventDefault(); setView({ seriesIndex: true }); } }, icon('back'), t('All series')),
      h('h2', { text: view.series }),
      h('p', { text: inView.length ? `${plural(inView.length, 'book')} · ${t('{n} read', { n: read })}` : t('No books in this series.') })));
  }
  appendRows(rows);
  if (query && !found.length) $('library').append(h('p', { class: 'no-results', text: t('No books match that search.') }));
  else if (current && !found.length && books.length) {
    $('library').append(h('p', { class: 'no-results', text: t('Nothing on “{list}” yet. Scan a book while this list is open, or open a book and put it here.', { list: show(current.name) }) }));
  }
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
 * Chips for choosing lists, editing the {listId: {at, note}} map `on` in place. Either-or
 * groups behave like radio buttons that can also be switched off.
 */
function listPicker(on, { notes = true } = {}) {
  const box = h('div', { class: 'list-picker' });
  const chip = (l) => h('button', {
    class: 'chip', type: 'button', text: show(l.name), 'aria-pressed': String(!!on[l.id]),
    onclick: () => { if (on[l.id]) delete on[l.id]; else place(on, l.id); draw(); },
  });
  const noteField = (l) => {
    const input = h('input', { value: on[l.id].note || '', autocomplete: 'off', autocapitalize: 'words' });
    input.addEventListener('input', () => { on[l.id].note = input.value; });
    return h('label', { class: 'field' }, h('span', { text: show(l.noteLabel) }), input);
  };
  function draw() {
    box.replaceChildren(
      ...listSections().map((section) => h('div', { class: 'pick-row' },
        section.label && h('span', { class: 'pick-label', text: show(section.label) }),
        h('div', { class: 'chips' }, section.members.map(chip)))),
      ...(notes ? lists.filter((l) => on[l.id] && l.noteLabel).map(noteField) : []));
  }
  draw();
  return box;
}

/* Changing a cover */

/**
 * Reads a pasted, dropped or chosen picture. → {thumb, ratio, large}: a small copy that
 * travels inside the book (so it shows at once, offline too), its proportions, and a larger
 * one for the server to keep. Null if the file isn't a picture.
 */
async function readCover(file) {
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { return null; }
  const draw = (maxSide) => {
    const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = h('canvas', { width: Math.round(bitmap.width * k), height: Math.round(bitmap.height * k) });
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  };
  const picture = {
    thumb: draw(300).toDataURL('image/jpeg', 0.72),
    ratio: Number((bitmap.width / bitmap.height).toFixed(3)),
    large: await new Promise((resolve) => draw(1600).toBlob(resolve, 'image/jpeg', 0.9)),
  };
  bitmap.close?.();
  return picture;
}

/**
 * Hands the larger picture to the server, which keeps it; the book then points at the
 * server's copy. Without an account or a connection, the small copy inside the book stays
 * the cover, and the server makes a file of that when the book next syncs.
 */
async function uploadCover(book, picture) {
  if (!sync.user || navigator.onLine === false || !picture.large) return;
  try {
    if (!csrfToken()) await fetch(abs('api/session'), { credentials: 'same-origin', cache: 'no-store' });
    const res = await fetch(abs('api/cover'), {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'image/jpeg', 'X-CSRFToken': csrfToken() }, body: picture.large,
    });
    if (!res.ok) return;
    const kept = await res.json();
    if (book.thumb !== picture.thumb || !books.includes(book)) return;   // the cover was changed again meanwhile
    Object.assign(book, { cover: kept.cover, coverFull: kept.coverFull, coverRatio: kept.coverRatio });
    await saveBook(book);
  } catch (err) {
    console.warn('Cover not uploaded', err);
  }
}

/**
 * Add or edit a book.
 *  book      existing record, or a draft when `isNew`
 *  ocrLines  text read from the cover, offered as tap-to-fill chips
 */
function openBookForm({ book, isNew = false, ocrLines = [], heading, subheading, onSaved, onClose, back }) {
  // `back` is where Cancel and Save go instead of closing the sheet (the book's page).
  const leave = () => (back ? back() : sheet.close());
  let saved = false;
  const input = (name, attrs = {}) => h('input', { name, value: book[name] ?? '', autocomplete: 'off', ...attrs });
  const f = {
    title: h('textarea', { name: 'title', rows: 2, class: 'serif', autocomplete: 'off', enterkeyhint: 'next' }),
    author: input('author', { autocapitalize: 'words' }),
    publisher: input('publisher', { autocapitalize: 'words' }),
    date: input('date', { placeholder: t('e.g. 1998'), inputmode: 'numeric' }),
    pages: input('pages', { inputmode: 'numeric', pattern: '[0-9]*' }),
    isbn: input('isbn', { inputmode: 'numeric' }),
    series: input('series', { autocapitalize: 'words', list: 'seriesNames' }),
    seriesNumber: h('input', { name: 'seriesNumber', value: seriesNo(book), inputmode: 'decimal', autocomplete: 'off', placeholder: '1' }),
  };
  const seriesNames = h('datalist', { id: 'seriesNames' }, [...seriesMap().keys()].sort().map((value) => h('option', { value })));
  f.title.value = book.title || '';
  f.title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); f.author.focus(); } });
  const field = (label, control) => h('label', { class: 'field' }, h('span', { text: label }), control);
  const error = h('p', { class: 'field-error', hidden: true });
  // The lists the book is on, edited as a copy until the form is saved.
  const on = {};
  for (const { list, at, note } of listsOf(book)) on[list.id] = note ? { at, note } : { at };

  // Tap-to-fill chips for text read off the cover.
  let ocrBox = null;
  if (ocrLines.length) {
    let target = 'title', run = null;
    const seg = { title: h('button', { type: 'button', text: t('Title') }), author: h('button', { type: 'button', text: t('Author') }) };
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
      h('div', { class: 'ocr-head' }, h('span', { text: t('Tap text from the cover to fill') }), h('div', { class: 'seg' }, seg.title, seg.author)),
      h('div', { class: 'chips' }, chips));
  }

  const swap = (isNew && ocrLines.length) && h('button', {
    class: 'swap', type: 'button',
    onclick: () => { [f.title.value, f.author.value] = [f.author.value, f.title.value]; },
  }, icon('swap'), t('Swap title and author'));

  // A book that came from the booklog: where to read about it, and who has the last word.
  const source = sourceNote(book, true);

  // The cover: tap it to choose a picture; or paste or drop one while no text field has the cursor.
  let picture = null;
  const coverPick = h('button', { class: 'cover-pick', type: 'button', title: t('Change the cover'), 'aria-label': t('Change the cover'), onclick: () => coverFile.click() });
  const drawCover = () => coverPick.replaceChildren(
    coverEl(picture ? { ...book, cover: '', thumb: picture.thumb, coverRatio: picture.ratio } : book, true),
    h('span', { class: 'cover-pick-badge' }, icon('camera')));
  const pickCover = async (file) => {
    const read = file && await readCover(file);
    if (!read) { toast(t('That picture couldn’t be opened')); return; }
    picture = read;
    drawCover();
  };
  const coverFile = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: (e) => { const file = e.target.files[0]; e.target.value = ''; if (file) pickCover(file); } });
  const pictureIn = (transfer) => [...(transfer?.files || [])].find((file) => file.type.startsWith('image/'));
  const onPaste = (e) => {
    if (!form.isConnected) { document.removeEventListener('paste', onPaste); return; }
    const focus = document.activeElement;
    if (focus?.tagName === 'TEXTAREA' || (focus?.tagName === 'INPUT' && focus.type !== 'file')) return;   // the text field gets it
    const file = pictureIn(e.clipboardData);
    if (!file) return;
    e.preventDefault();
    pickCover(file);
  };
  document.addEventListener('paste', onPaste);
  // Phones have no Ctrl+V: a button that reads the clipboard does the same there.
  const pasteButton = navigator.clipboard?.read && h('button', {
    class: 'link-btn', type: 'button', text: t('Paste'),
    onclick: async () => {
      try {
        for (const item of await navigator.clipboard.read()) {
          const type = item.types.find((kind) => kind.startsWith('image/'));
          if (type) { pickCover(await item.getType(type)); return; }
        }
        toast(t('There is no picture on the clipboard'));
      } catch { toast(t('Couldn’t reach the clipboard')); }
    },
  });
  drawCover();

  const form = h('form', {
    novalidate: true, onsubmit: submit,
    ondragover: (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); },
    ondrop: (e) => { const file = pictureIn(e.dataTransfer); if (file) { e.preventDefault(); pickCover(file); } },
  },
    sheetHead(heading || (isNew ? t('New book') : t('Edit book')), subheading || null, coverPick),
    coverFile,
    h('p', { class: 'sheet-note cover-hint' }, t('Tap the cover to choose a picture, or paste or drop one here.'), ' ', pasteButton),
    source,
    ocrBox,
    field(t('Title'), f.title),
    field(t('Author'), f.author),
    swap,
    field(t('Publisher'), f.publisher),
    h('div', { class: 'field-row' }, field(t('Published'), f.date), field(t('Pages'), f.pages)),
    field('ISBN', f.isbn),
    h('div', { class: 'field-row series-fields' }, field(t('Series'), f.series), field(t('Number'), f.seriesNumber)),
    seriesNames,
    lists.length > 0 && h('div', { class: 'sheet-section form-lists' }, h('h3', { text: t('Lists') }), listPicker(on)),
    error,
    h('div', { class: 'btn-row sheet-actions' },
      !isNew && h('button', { class: 'btn btn-quiet btn-danger', type: 'button', 'aria-label': t('Delete book'), onclick: remove }, icon('trash')),
      h('button', { class: 'btn btn-outline', type: 'button', text: t('Cancel'), onclick: leave }),
      h('button', { class: 'btn btn-primary', type: 'submit' }, icon('check'), isNew ? t('Add to shelf') : t('Save'))));

  async function submit(e) {
    e.preventDefault();
    const v = (k) => f[k].value.replace(/\s+/g, ' ').trim();
    const data = {
      title: v('title'), author: v('author'), publisher: v('publisher'), date: normDate(v('date')),
      pages: parseInt(v('pages'), 10) > 0 ? parseInt(v('pages'), 10) : null,
      isbn: toIsbn13(v('isbn')) || v('isbn').replace(/[^0-9Xx]/g, ''),
      lists: {},
      series: v('series'), seriesNumber: null, seriesLabel: '',
      // A new cover: the small copy is the cover until the server has kept the larger one.
      ...(picture && { thumb: picture.thumb, cover: '', coverRatio: picture.ratio, coverSource: '', coverFull: '' }),
    };
    // The number sorts the series; anything that isn't a plain number ("4/5") is a label shown instead.
    const typed = data.series ? v('seriesNumber') : '';
    if (typed && typed === seriesNo(book)) Object.assign(data, { seriesNumber: book.seriesNumber ?? null, seriesLabel: book.seriesLabel || '' });
    else if (/^\d+(?:[.,]\d+)?$/.test(typed)) data.seriesNumber = Number(typed.replace(',', '.'));
    else if (typed) Object.assign(data, { seriesLabel: typed, seriesNumber: Number.isFinite(parseFloat(typed)) ? parseFloat(typed) : null });
    for (const [id, entry] of Object.entries(on)) {
      const note = String(entry.note || '').replace(/\s+/g, ' ').trim();
      data.lists[id] = { at: entry.at || new Date().toISOString(), ...(note && { note }) };
    }
    if (!data.title) {
      error.textContent = t('A book needs at least a title.');
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
    if (picture) uploadCover(result, picture);
    leave();
    onSaved?.(result);
  }

  function remove() {
    sheet.close();
    removeBook(book);
    toast(t('Book removed'), { action: t('Undo'), onAction: () => restoreBook(book) });
  }

  sheet.open(form, () => onClose?.(saved));
}

/* ───────────────────────── Markdown (reviews) ───────────────────────── */

// Reviews are written in Markdown. This draws its everyday part (paragraphs, emphasis, links,
// quotes, lists, images, rules) straight into DOM nodes: nothing in a review is ever read as HTML.
const safeUrl = (url) => (/^(https?:|mailto:)/i.test(url) ? url : null);
const INLINE = /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^\s*](?:.*?[^\s])?)\*\*|\*([^\s*](?:[^*]*?[^\s*])?)\*|_([^\s_](?:[^_]*?[^\s_])?)_|`([^`]+)`|(?: {2,}|\\)\n/g;

function inlineMarkdown(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    // _this_ is emphasis, snake_case_words are not.
    if (m[7] !== undefined && (/\w/.test(text[m.index - 1] || '') || /\w/.test(text[m.index + m[0].length] || ''))) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[2] !== undefined) {
      const src = safeUrl(m[2]);
      out.push(src ? h('a', { class: 'prose-img', href: src, target: '_blank', rel: 'noopener' }, h('img', { src, alt: m[1], loading: 'lazy' })) : m[1]);
    } else if (m[4] !== undefined) {
      const href = safeUrl(m[4]);
      out.push(href ? h('a', { href, target: '_blank', rel: 'noopener' }, inlineMarkdown(m[3])) : m[3]);
    } else if (m[5] !== undefined) out.push(h('strong', null, inlineMarkdown(m[5])));
    else if (m[6] !== undefined || m[7] !== undefined) out.push(h('em', null, inlineMarkdown(m[6] ?? m[7])));
    else if (m[8] !== undefined) out.push(h('code', { text: m[8] }));
    else out.push(h('br'));
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function renderMarkdown(source) {
  const frag = document.createDocumentFragment();
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  const ITEM = /^\s*(?:[-*+]|(\d+)[.)])\s+(.*)$/;
  const para = [];
  const flush = () => { if (para.length) frag.append(h('p', null, inlineMarkdown(para.join('\n')))); para.length = 0; };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (!line.trim()) { flush(); i++; }
    else if (/^\s*(?:-{3,}|\*{3,}|_{3,}|\* \* \*)\s*$/.test(line)) { flush(); frag.append(h('hr')); i++; }
    else if (/^\s*⁂\s*$/.test(line)) { flush(); frag.append(h('p', { class: 'asterism', text: '⁂' })); i++; }
    else if ((m = line.match(/^#{1,6}\s+(.*)$/))) { flush(); frag.append(h('h4', null, inlineMarkdown(m[1]))); i++; }
    else if (/^\s*>/.test(line)) {
      flush();
      const quoted = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quoted.push(lines[i++].replace(/^\s*>\s?/, ''));
      frag.append(h('blockquote', null, renderMarkdown(quoted.join('\n'))));
    } else if ((m = line.match(ITEM))) {
      flush();
      const ordered = m[1] !== undefined, items = [];
      while (i < lines.length && (m = lines[i].match(ITEM))) {
        let item = m[2];
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !ITEM.test(lines[i])) item += '\n' + lines[i++].trim();
        items.push(h('li', null, inlineMarkdown(item)));
      }
      frag.append(h(ordered ? 'ol' : 'ul', null, items));
    } else { para.push(line); i++; }
  }
  flush();
  return frag;
}

/* ───────────────────────── A book's page and its reviews ───────────────────────── */

// A book can have any number of reviews: {id, date, rating, text}. `date` is the day it was
// read ("2026-11-14") and may be empty; `rating` is 0–10 or null; `text` is Markdown. The
// book's own `rating`, shown in lists, is that of the latest review that gives one.

/** Newest read first; reviews without a reading date after those. */
function sortedReviews(book) {
  return [...(book.reviews || [])].sort((a, b) => (!a.date - !b.date) || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

function settleRating(book) {
  const rated = sortedReviews(book).find((r) => r.rating != null);
  if (rated) book.rating = rated.rating; else delete book.rating;
}

const longDate = (day) => new Date(`${day}T12:00:00`).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * For a book that is in the booklog: the link to its page there, and that changes made here
 * are published to it. When the last attempt to publish failed, what the booklog said.
 */
function sourceNote(book, explain) {
  if (!book.boeken || !book.url) return null;
  let host = '';
  try { host = new URL(book.url).host; } catch {}
  if (!host) return null;
  return h('div', { class: 'from-site' },
    h('p', { class: 'sheet-note' },
      h('a', { href: book.url, target: '_blank', rel: 'noopener' }, t('On {host}', { host }), ' ↗'),
      explain && h('br'),
      explain && t('This book is in the booklog at {host}. What you change here is published there within a few minutes.', { host })),
    book.boekenError && h('p', { class: 'field-error', text: t('Not published to {host}: {why}', { host, why: book.boekenError }) }));
}

/** How far along a book on the Reading list is: the page reached, or for an audiobook the time left. */
function progressBox(book, again) {
  if (!shelves(book).reading) return null;
  const audio = !!book.duration;
  const input = audio
    ? h('input', { name: 'left', value: book.durationLeft || '', placeholder: '3u 12m', autocomplete: 'off' })
    : h('input', { name: 'page', type: 'number', min: 0, max: book.pages || null, inputmode: 'numeric', value: book.pagesRead ?? '' });
  const error = h('p', { class: 'field-error', hidden: true });
  const fail = (message) => { error.textContent = message; error.hidden = false; input.focus(); };
  return h('form', {
    class: 'progress-form', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      if (audio) {
        // The booklog writes durations as "3u 12m"; an h for hours is fine too.
        const left = input.value.trim().toLowerCase().replace(/h/g, 'u').replace(/\s+/g, ' ');
        if (!/^(?:\d+u)? ?(?:\d+m)?$/.test(left) || !left) return fail(t('Give the time left like 3u 12m.'));
        book.durationLeft = left;
      } else {
        const page = Math.round(Number(input.value));
        if (input.value.trim() === '' || !(page >= 0)) return fail(t('Which page are you on?'));
        if (book.pages && page > book.pages) return fail(t('That is past the last page ({n}).', { n: book.pages }));
        book.pagesRead = page;
      }
      await saveBook(book);
      toast(t('Progress saved'));
      again();
    },
  },
  h('label', { class: 'field' },
    h('span', { text: audio ? t('Time left') : book.pages ? t('Page (of {n})', { n: book.pages }) : t('Page') }), input),
  h('button', { class: 'btn btn-outline', type: 'submit' }, icon('check'), t('Save')),
  error);
}

function openBook(book) {
  const again = () => { if (books.includes(book)) openBook(book); else sheet.close(); };
  const reviewEl = (review) => h('article', { class: 'review' },
    h('div', { class: 'review-head' },
      h('span', { text: [review.date && longDate(review.date), review.rating != null && `★ ${review.rating}`].filter(Boolean).join(' · ') || t('Note') }),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Edit review'), onclick: () => openReviewForm(book, review, again) }, icon('pencil'))),
    review.text && h('div', { class: 'prose' }, renderMarkdown(review.text)));
  const reviews = sortedReviews(book);

  sheet.open(h('div', { class: 'book-page' },
    h('div', { class: 'page-head' },
      coverEl(book, true),
      h('div', { class: 'page-title' },
        h('h2', { class: 'sheet-title', text: displayTitle(book) }),
        book.author && h('p', { class: 'page-author', text: book.author }),
        seriesLine(book) && h('button', {
          class: 'link-btn page-series', type: 'button', text: seriesLine(book),
          onclick: () => { sheet.close(); setView({ series: book.series }); },
        }),
        metaLine(book) && h('p', { class: 'book-meta', text: metaLine(book) }),
        listTags(book, null)),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Close'), onclick: () => sheet.close() }, icon('x'))),
    sourceNote(book, false),
    progressBox(book, again),
    h('div', { class: 'sheet-section' },
      h('div', { class: 'section-head' },
        h('h3', { text: t('Reviews') }),
        h('button', { class: 'link-btn', type: 'button', onclick: () => openReviewForm(book, null, again) }, icon('plus'), t('Add review'))),
      reviews.length ? reviews.map(reviewEl) : h('p', { class: 'sheet-note', text: t('No reviews yet.') })),
    h('button', { class: 'btn btn-outline btn-block page-edit', type: 'button', onclick: () => openBookForm({ book, back: again }) }, icon('pencil'), t('Edit details'))));
}

/** Write a review, or change one. `back` shows the book's page again. */
function openReviewForm(book, review, back) {
  const isNew = !review;
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const text = h('textarea', { name: 'text', rows: 9, class: 'review-text', autocapitalize: 'sentences' });
  text.value = review?.text || '';
  // Reading date and rating are both optional; a book that was just read most likely was read today.
  const date = h('input', { name: 'date', type: 'date', max: today, value: review ? review.date || '' : (shelves(book).read ? today : '') });
  const rating = h('input', { name: 'rating', type: 'number', min: 0, max: 10, step: 1, inputmode: 'numeric', placeholder: '–', value: review?.rating ?? '' });
  const error = h('p', { class: 'field-error', hidden: true });

  async function submit(e) {
    e.preventDefault();
    const stars = rating.value.trim() === '' ? null : Math.round(Number(rating.value));
    const data = { date: date.value || '', rating: stars, text: text.value.replace(/\r\n?/g, '\n').trim() };
    const fail = (message, input) => { error.textContent = message; error.hidden = false; input.focus(); };
    if (stars != null && !(stars >= 0 && stars <= 10)) return fail(t('A rating goes from 0 to 10.'), rating);
    if (!data.text && !data.date && stars == null) return fail(t('Write something, or give a reading date or a rating.'), text);
    if (review) Object.assign(review, data);
    else (book.reviews ||= []).push({ id: newId(), ...data });
    settleRating(book);
    await saveBook(book);
    back();
  }

  function remove() {
    book.reviews = book.reviews.filter((r) => r !== review);
    settleRating(book);
    saveBook(book);
    back();
    toast(t('Review removed'), { action: t('Undo'), onAction: () => { (book.reviews ||= []).push(review); settleRating(book); saveBook(book); if (sheet.isOpen) back(); } });
  }

  sheet.open(h('form', { novalidate: true, onsubmit: submit },
    sheetHead(isNew ? t('New review') : t('Edit review'), displayTitle(book)),
    h('label', { class: 'field' }, h('span', { text: t('Review') }), text),
    h('p', { class: 'sheet-note md-hint', text: t('Markdown works: *italic*, **bold**, > quote, [link](https://…).') }),
    h('div', { class: 'field-row' },
      h('label', { class: 'field' }, h('span', { text: t('Read on') }), date),
      h('label', { class: 'field' }, h('span', { text: t('Rating (0–10)') }), rating)),
    error,
    h('div', { class: 'btn-row sheet-actions' },
      !isNew && h('button', { class: 'btn btn-quiet btn-danger', type: 'button', 'aria-label': t('Delete review'), onclick: remove }, icon('trash')),
      h('button', { class: 'btn btn-outline', type: 'button', text: t('Cancel'), onclick: back }),
      h('button', { class: 'btn btn-primary', type: 'submit' }, icon('check'), t('Save')))));
  if (isNew) text.focus();
}

/* ───────────────────────── Managing lists ───────────────────────── */

function openLists() {
  const move = async (from, to) => {
    [lists[from], lists[to]] = [lists[to], lists[from]];
    for (const [order, list] of lists.entries()) {
      if (list.order === order) continue;
      list.order = order;
      touchList(list.id, list);
      await DB.lists.put(list).catch(storageFailed);
    }
    renderLibrary();
    draw();
  };
  const row = (list, i) => h('div', { class: 'list-row' },
    h('button', { class: 'list-name', type: 'button', onclick: () => openListForm(list) },
      h('span', { text: show(list.name) }),
      h('small', { text: [list.group && t('One of: {set}', { set: show(list.group) }), list.noteLabel && t('Note: {label}', { label: show(list.noteLabel) })].filter(Boolean).join(' · ') })),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Move {list} up', { list: show(list.name) }), disabled: i === 0, onclick: () => move(i, i - 1) }, icon('up')),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Move {list} down', { list: show(list.name) }), disabled: i === lists.length - 1, onclick: () => move(i, i + 1) }, icon('down')));
  function draw() {
    sheet.open(h('div', null,
      sheetHead(t('Lists'), t('Tap a list to rename it or change how it works.')),
      h('div', { class: 'list-rows' }, lists.map(row)),
      h('button', { class: 'btn btn-outline btn-block', type: 'button', onclick: () => openListForm() }, icon('plus'), t('New list'))));
  }
  draw();
}

/** Add a list, or edit one. Afterwards the sheet goes back to the overview of lists. */
function openListForm(list) {
  const isNew = !list;
  // A standard name is shown translated; left as it is, it is also stored as it was.
  const kept = (input, stored) => { const typed = input.value.replace(/\s+/g, ' ').trim(); return stored && typed === show(stored) ? stored : typed; };
  const name = h('input', { name: 'name', value: show(list?.name || ''), autocomplete: 'off', autocapitalize: 'sentences', enterkeyhint: 'done' });
  const noteLabel = h('input', { name: 'noteLabel', value: show(list?.noteLabel || ''), placeholder: t('e.g. Lent to'), autocomplete: 'off', autocapitalize: 'sentences' });
  const error = h('p', { class: 'field-error', hidden: true });

  // Either-or sets: on its own, one of the sets that exist, or a new one.
  const NEW = Symbol('new set');
  let group = list?.group || '';
  const sets = [...new Set(lists.map((l) => l.group).filter(Boolean))];
  const newSet = h('input', { name: 'group', placeholder: t('Name of the new set, e.g. Wishlist priority'), autocomplete: 'off', autocapitalize: 'sentences' });
  const newSetField = h('label', { class: 'field', hidden: true }, h('span', { text: t('New set') }), newSet);
  const setChips = h('div', { class: 'chips' });
  const drawSets = () => {
    const chip = (value, text) => h('button', {
      class: 'chip', type: 'button', text, 'aria-pressed': String(group === value),
      onclick: () => { group = value; drawSets(); if (value === NEW) newSet.focus(); },
    });
    setChips.replaceChildren(chip('', t('On its own')), ...sets.map((g) => chip(g, show(g))), chip(NEW, t('New set…')));
    newSetField.hidden = group !== NEW;
  };
  drawSets();

  async function submit(e) {
    e.preventDefault();
    const clean = (input) => input.value.replace(/\s+/g, ' ').trim();
    const data = { name: kept(name, list?.name), group: group === NEW ? clean(newSet) : group, noteLabel: kept(noteLabel, list?.noteLabel) };
    const fail = (message, input) => { error.textContent = message; error.hidden = false; input.focus(); };
    if (!data.name) return fail(t('A list needs a name.'), name);
    if (lists.some((l) => l !== list && fold(show(l.name)) === fold(show(data.name)))) return fail(t('There is already a list with that name.'), name);
    if (group === NEW && !data.group) return fail(t('Give the new set a name, or pick “On its own”.'), newSet);
    const target = list || { id: newId(), order: lists.reduce((max, l) => Math.max(max, l.order ?? 0), -1) + 1 };
    Object.assign(target, data);
    await saveList(target);
    openLists();
  }

  function remove() {
    const count = books.filter((b) => shelves(b)[list.id]).length;
    removeList(list);
    openLists();
    // The books keep their place on the list, so undoing brings everything back.
    toast(count
      ? t('Deleted “{list}” — the {n} on it stay on your shelf', { list: show(list.name), n: plural(count, 'book') })
      : t('Deleted “{list}”', { list: show(list.name) }), { action: t('Undo'), onAction: () => saveList(list) });
  }

  sheet.open(h('form', { novalidate: true, onsubmit: submit },
    sheetHead(isNew ? t('New list') : t('Edit list')),
    h('label', { class: 'field' }, h('span', { text: t('Name') }), name),
    h('div', { class: 'sheet-section' },
      h('h3', { text: t('Either-or') }),
      setChips,
      newSetField,
      h('p', { class: 'sheet-note', text: t('Lists in the same set are either-or: putting a book on one takes it off the others, like To read, Reading and Read. A list on its own can hold any book.') })),
    h('div', { class: 'sheet-section' },
      h('h3', { text: t('Note') }),
      h('label', { class: 'field' }, noteLabel),
      h('p', { class: 'sheet-note', text: t('Optional. If you name a note here, each book on this list can carry one — who you lent it to, where you left it.') })),
    error,
    h('div', { class: 'btn-row sheet-actions' },
      !isNew && h('button', { class: 'btn btn-quiet btn-danger', type: 'button', 'aria-label': t('Delete list'), onclick: remove }, icon('trash')),
      h('button', { class: 'btn btn-outline', type: 'button', text: t('Cancel'), onclick: () => openLists() }),
      h('button', { class: 'btn btn-primary', type: 'submit' }, icon('check'), isNew ? t('Add list') : t('Save')))));
  if (isNew) name.focus();
}

/* ───────────────────────── Export ───────────────────────── */

function exportJson() {
  const rows = [...books].reverse().map((b) => ({
    title: b.title, author: b.author, date: b.date, publisher: b.publisher, pages: b.pages ?? null,
    isbn: b.isbn || '', cover: b.cover ? abs(b.cover) : '', added: b.added,
    lists: listsOf(b).map(({ list, at, note }) => ({ list: show(list.name), since: at, ...(note && { note }) })),
    ...(b.series && { series: b.series, seriesNumber: seriesNo(b) }),
    ...(b.rating != null && { rating: b.rating }),
    ...(b.reviews?.length && { reviews: sortedReviews(b).map((r) => ({ date: r.date || '', rating: r.rating ?? null, text: r.text || '' })) }),
  }));
  return JSON.stringify(rows, null, 2);
}

function openExport() {
  if (!books.length) { toast(t('Nothing to export yet')); return; }
  const json = exportJson();
  const name = `folio-${new Date().toISOString().slice(0, 10)}.json`;
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
    toast(t('Saved {name}', { name }));
  };
  const share = async () => {
    try {
      await navigator.share(canShareFile ? { files: [file], title: name } : { title: name, text: json });
      sheet.close();
    } catch (err) {
      if (err?.name !== 'AbortError') toast(t('Sharing didn’t work — try saving the file'));
    }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(json); sheet.close(); toast(t('JSON copied to clipboard')); }
    catch { toast(t('Couldn’t reach the clipboard')); }
  };

  sheet.open(h('div', null,
    sheetHead(t('Export'), t('{n} as JSON, oldest first.', { n: plural(books.length, 'book') })),
    h('div', { class: 'stack' },
      h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: save }, icon('download'), t('Save file')),
      navigator.share && h('button', { class: 'btn btn-outline btn-block', type: 'button', onclick: share }, icon('share'), t('Share…')),
      navigator.clipboard && h('button', { class: 'btn btn-outline btn-block', type: 'button', onclick: copy }, icon('copy'), t('Copy to clipboard')))));
}

/* ───────────────────────── Settings sheet ───────────────────────── */

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });

function openSettings() {
  const chips = Object.entries(OCR_LANGS).map(([code, label]) => {
    const chip = h('button', { class: 'chip', type: 'button', text: label, 'aria-pressed': String(settings.langs.includes(code)) });
    chip.addEventListener('click', () => {
      const on = !settings.langs.includes(code);
      if (!on && settings.langs.length === 1) { toast(t('Keep at least one language')); return; }
      settings.langs = Object.keys(OCR_LANGS).filter((l) => (l === code ? on : settings.langs.includes(l)));
      store.set('langs', settings.langs);
      chip.setAttribute('aria-pressed', String(on));
    });
    return chip;
  });

  const key = h('input', { type: 'text', value: settings.googleKey, placeholder: t('Optional'), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  key.addEventListener('change', () => { settings.googleKey = key.value.trim(); store.set('googleKey', settings.googleKey); });

  const langChip = (code, label) => h('button', {
    class: 'chip', type: 'button', text: label, 'aria-pressed': String(langChoice === code || (code === 'auto' && !(langChoice in LANGS))),
    onclick: () => { store.set('lang', code); location.reload(); },
  });

  sync.box = h('div', { class: 'sheet-section account' });
  sheet.open(h('div', null,
    sheetHead(t('Settings')),
    installPrompt && h('button', {
      class: 'btn btn-primary btn-block', type: 'button',
      onclick: async () => { const p = installPrompt; installPrompt = null; sheet.close(); await p.prompt(); },
    }, icon('download'), t('Install Folio on this phone')),
    sync.box,
    h('div', { class: 'sheet-section' },
      h('h3', { text: t('Language') }),
      h('div', { class: 'chips' }, langChip('auto', t('Same as this device')), Object.entries(LANGS).map(([code, label]) => langChip(code, label)))),
    h('div', { class: 'sheet-section' },
      h('h3', { text: t('Languages on your covers') }),
      h('div', { class: 'chips' }, chips),
      h('p', { class: 'sheet-note', text: t('Used when reading a photographed cover. Fewer languages read faster.') })),
    h('div', { class: 'sheet-section' },
      h('h3', { text: t('Google Books API key') }),
      h('label', { class: 'field' }, key),
      h('p', { class: 'sheet-note' },
        t('Lookups ask Open Library and Google Books. Google’s shared, keyless quota often runs dry; a free key of your own (Google Cloud console → Books API) makes it dependable. It is stored only on this device.'))),
    h('div', { class: 'sheet-section' },
      h('h3', { text: t('About · version {version}', { version: APP_VERSION }) }),
      h('p', { class: 'sheet-note', text: t('Your shelf is stored on this device, and on the server too while you’re signed in. Export it now and then to keep a copy of your own. Book data comes from Open Library and Google Books.') }))));
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
  target: [],   // ids of the lists scanned books go on
};
const alive = (session) => scanner.open && scanner.session === session;

const HINTS = {
  barcode: t('Point at the barcode on the back cover'),
  cover: t('Fit the front cover in the frame'),
  coverNoCam: t('Tap the button to photograph the cover'),
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
  // Scanning from an open list fills that list; otherwise the lists chosen last time.
  scanner.target = (view.list ? [view.list] : store.get('scanTarget', ['library'])).filter(listById);
  scannerEl.hidden = false;
  setMode('barcode');
  updateScanCount();
  renderScanTarget();
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
  $('scanMsgTitle').textContent = denied ? t('The camera is switched off') : t('No camera available');
  $('scanMsgBody').textContent = denied
    ? t('Allow camera access for this site in your browser’s site settings. Until then you can type the ISBN, or photograph a cover with your camera app.')
    : t('You can still add books by typing the ISBN or entering the details by hand.');
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
    if (alive(session)) setHint(t('Barcode reading isn’t available here — type the ISBN instead'));
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
  showCard(busyCard(t('Reading the printed ISBN…')));
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
    status: t('Not an ISBN barcode'), tone: 'warn', title: t('Couldn’t read the ISBN beside it'),
    sub: t('Some older books carry a shop barcode. Hold the printed ISBN number sharp and level, or type it in.'),
    onDismiss: () => { scanner.busy = false; },
    actions: [
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { scanner.lastCode = ''; scanner.busy = false; showCard(null); } }, icon('scan'), t('Try again')),
      h('button', { class: 'btn btn-outline', type: 'button', onclick: openIsbnSheet }, icon('keyboard'), t('Type ISBN')),
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
  $('scanCount').textContent = String(scanner.added);
  $('scanCount').title = t('{n} added', { n: scanner.added });
}

const listNames = (ids) => ids.map((id) => listById(id)).filter(Boolean).map((l) => show(l.name)).join(' + ');

/** The lists a book scanned now goes on, as a fresh {listId: {at}} map. */
const targetLists = () => placed(scanner.target);

function renderScanTarget() {
  $('scanTargetName').textContent = listNames(scanner.target) || t('No list');
}

function openTargetSheet() {
  if (scanner.capturing) return;
  const on = targetLists();
  sheet.open(h('div', null,
    sheetHead(t('Scan onto'), t('Every book you scan goes on these lists. A book that is already on your shelf is put on them too.')),
    listPicker(on, { notes: false }),
    h('button', { class: 'btn btn-primary btn-block sheet-done', type: 'button', onclick: () => sheet.close() }, icon('check'), t('Done'))),
  () => {
    scanner.target = lists.filter((l) => on[l.id]).map((l) => l.id);
    store.set('scanTarget', scanner.target);
    renderScanTarget();
  });
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
    h('button', { class: 'card-x', type: 'button', 'aria-label': t('Dismiss'), onclick: () => { onDismiss?.(); showCard(null); } }, icon('x')));
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
    status: t('Added'), tone: 'ok', statusIcon: 'check', book,
    actions: [
      h('button', { class: 'btn btn-outline', type: 'button', onclick: () => { removeBook(book); scanner.added = Math.max(0, scanner.added - 1); updateScanCount(); showCard(null); } }, icon('undo'), t('Undo')),
      h('button', { class: 'btn btn-outline', type: 'button', onclick: () => openBookForm({ book, onClose: () => { if (scanner.open && books.includes(book)) showCard(addedCard(book)); else showCard(null); } }) }, icon('pencil'), t('Edit')),
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
    // Scanning onto "Lent out" or "Read" is also how a book you already have gets there.
    const before = existing.lists;
    const missing = scanner.target.filter((id) => !shelves(existing)[id]);
    if (!missing.length) {
      showCard(card({ status: listNames(scanner.target) ? t('Already on {lists}', { lists: listNames(scanner.target) }) : t('Already on your shelf'), tone: 'warn', book: existing }));
      return;
    }
    existing.lists = missing.reduce((on, id) => place(on, id), { ...shelves(existing) });
    saveBook(existing);
    const undo = () => {
      if (before) existing.lists = before; else delete existing.lists;
      saveBook(existing);
      showCard(null);
    };
    showCard(card({
      status: t('Put on {lists}', { lists: listNames(missing) }), tone: 'ok', statusIcon: 'check', book: existing,
      actions: [
        h('button', { class: 'btn btn-outline', type: 'button', onclick: undo }, icon('undo'), t('Undo')),
        h('button', { class: 'btn btn-outline', type: 'button', onclick: () => openBookForm({ book: existing }) }, icon('pencil'), t('Edit')),
      ],
    }));
    return;
  }

  showCard(busyCard(t('Looking up {isbn}…', { isbn })));
  const result = await lookupIsbn(isbn);

  if (result.status === 'found') {
    const book = await addBook({ ...result.book, isbn, lists: targetLists() });
    if (!alive(session)) { toast(t('Added “{title}”', { title: book.title })); return; }
    scanner.added++;
    updateScanCount();
    scanner.busy = false;
    buzz(20);
    showCard(addedCard(book));
  } else if (result.status === 'notfound') {
    if (!alive(session)) { toast(t('No match found for ISBN {isbn}', { isbn })); return; }
    warmOcr();
    // Scanning stays paused until one of these is chosen.
    showCard(card({
      status: t('No match'), tone: 'warn', title: t('This ISBN isn’t in the catalogues'), sub: t('{isbn} · Try a photo of the front cover.', { isbn }),
      onDismiss: () => { scanner.busy = false; },
      actions: [
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => setMode('cover', isbn) }, icon('camera'), t('Photograph the cover')),
        h('button', { class: 'btn btn-outline btn-narrow', type: 'button', onclick: () => manualEntry(isbn) }, t('By hand')),
      ],
    }));
  } else {
    const book = await addBook({ isbn, pending: true, lists: targetLists() });
    if (!alive(session)) { toast(t('Saved the ISBN — details follow when you’re online')); return; }
    scanner.added++;
    updateScanCount();
    scanner.busy = false;
    showCard(card({ status: t('Saved for later'), tone: 'warn', statusIcon: 'cloud-off', title: `ISBN ${isbn}`, sub: t('No connection right now. The details will be filled in when you’re back online.') }));
    void book;
  }
}

function manualEntry(isbn = '') {
  openBookForm({
    book: { isbn, lists: targetLists() }, isNew: true,
    onSaved: () => { scanner.added++; updateScanCount(); },
    onClose: (saved) => { if (saved && scanner.open) { setMode('barcode'); toast(t('Added to your shelf')); } },
  });
}

function openIsbnSheet() {
  const input = h('input', { name: 'isbn', inputmode: 'numeric', autocomplete: 'off', placeholder: '978…', enterkeyhint: 'search' });
  const error = h('p', { class: 'field-error', hidden: true, text: t('That isn’t a valid ISBN — check the digits.') });
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
    sheetHead(t('Type the ISBN'), t('The 10 or 13 digits printed above the barcode or on the copyright page.')),
    h('label', { class: 'field' }, h('span', { text: 'ISBN' }), input),
    error,
    h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, icon('search'), t('Look up')));
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
  catch { toast(t('That photo couldn’t be opened')); return; }
  const shots = makeShots(bitmap, 0, 0, bitmap.width, bitmap.height);
  bitmap.close?.();
  await processCover(shots);
}

async function processCover({ canvas, thumb }) {
  const session = scanner.session;
  const isbn = scanner.pendingIsbn;
  scanner.capturing = true;
  $('shutterBtn').disabled = true;
  const progress = busyCard(t('Reading the cover…'), true);
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
    progress.setText(t('Searching the catalogues…'));
    candidates = await searchByText(guess, lines);
    if (!alive(session)) return;
  }
  showCard(null);

  const finish = (saved) => {
    scanner.capturing = false;
    $('shutterBtn').disabled = false;
    if (!scanner.open) return;
    video.play().catch(() => {});
    if (saved) { scanner.added++; updateScanCount(); setMode('barcode'); toast(t('Added to your shelf')); }
    else setHint();
  };
  const draft = { title: guess.title, author: guess.author, isbn, thumb, lists: targetLists() };
  const chipLines = lines.map((l) => tidyCase(l.text)).filter((t) => t.length > 1);
  const editByHand = () => openBookForm({
    book: draft, isNew: true, ocrLines: chipLines, onClose: finish,
    heading: lines.length ? t('Check the details') : t('Couldn’t read the cover'),
    subheading: lines.length ? t('This is what the cover seems to say — fix anything that’s off.') : t('No text could be made out. Type the details, or cancel and try another photo.'),
  });

  if (!candidates.length) { editByHand(); return; }

  let picked = false;
  const rows = candidates.map((c, i) => bookRow(c.book, async (b) => {
    if (picked) return;
    picked = true;
    await addBook({ ...b, isbn: isbn || b.isbn, thumb, lists: targetLists() });
    sheet.close();
  }, i === 0 && c.score >= 0.75 ? h('span', { class: 'badge', text: t('Best match') }) : null));
  rows.forEach((r) => r.classList.add('cand'));
  sheet.open(h('div', null,
    sheetHead(t('Is it one of these?'), t('Tap the right book to add it.')),
    h('div', { class: 'cand-list' }, rows),
    h('button', { class: 'btn btn-outline btn-block', type: 'button', onclick: editByHand }, icon('pencil'), t('None of these — enter it myself'))),
  () => finish(picked));
}

/* ───────────────────────── Wiring ───────────────────────── */

function bindEvents() {
  $('scanBtn').addEventListener('click', openScanner);
  $('exportBtn').addEventListener('click', openExport);
  $('settingsBtn').addEventListener('click', openSettings);
  $('search').addEventListener('input', renderLibrary);
  $('viewSeg').addEventListener('click', (e) => {
    const mode = e.target.closest('button')?.dataset.view;
    if (!VIEWS.includes(mode) || mode === view.mode) return;
    view.mode = mode;
    store.set('view', mode);
    renderLibrary();
  });

  window.addEventListener('hashchange', () => { readRoute(); renderLibrary(); });

  $('scanClose').addEventListener('click', closeLayer);
  $('scanTargetBtn').addEventListener('click', openTargetSheet);
  $('typeIsbnBtn').addEventListener('click', openIsbnSheet);
  $('noBarcodeBtn').addEventListener('click', () => setMode('cover'));
  $('backToBarcodeBtn').addEventListener('click', () => { if (!scanner.capturing) setMode('barcode'); });
  $('byHandBtn').addEventListener('click', () => { if (!scanner.capturing) manualEntry(scanner.pendingIsbn); });
  $('shutterBtn').addEventListener('click', () => { if (scanner.stream) captureCover(); else $('coverFile').click(); });
  $('coverFile').addEventListener('change', (e) => { const file = e.target.files[0]; e.target.value = ''; coverFromFile(file); });
  $('torchBtn').addEventListener('click', async () => {
    const on = $('torchBtn').getAttribute('aria-pressed') !== 'true';
    try { await scanner.track.applyConstraints({ advanced: [{ torch: on }] }); $('torchBtn').setAttribute('aria-pressed', String(on)); }
    catch { toast(t('The flashlight isn’t available')); }
  });
}

// Bookscan became Folio and moved. The old address keeps working for a while, with a
// pointer to the new one: a shelf lives in the browser per address, so it only comes along
// through an account.
const MOVED = { 'bookscan.yusupov.cloud': 'https://folio.yusupov.cloud/' };
function showMoved() {
  const to = MOVED[location.hostname];
  if (!to) return;
  $('moved').replaceChildren(
    h('p', { text: t('Bookscan is now Folio, at {host}. Sign in there and your shelf comes along. This old address will be switched off.', { host: new URL(to).host }) }),
    h('a', { class: 'btn btn-primary', href: to }, t('Open Folio')));
  $('moved').hidden = false;
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
    else toast(t('A new version is ready'), { action: t('Reload'), onAction: () => location.reload(), ms: 12000 });
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
  localize();
  initTheme();
  bindEvents();
  showMoved();
  try {
    books = await DB.all();
    sortBooks();
    await loadLists();
  } catch (err) {
    storageFailed(err);
  }
  readRoute();
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
    history.replaceState(null, '', location.pathname + location.hash);
    openScanner();
  }
}

init();
