// Folio — a personal book catalogue and reading log: your books on lists, what you are
// reading and how far along, and a review and an edition for every read. Books are added by
// scanning their barcode, photographing the cover, describing them or sharing a page to the
// app, and can be published to the booklog at boeken.tsuk.org.
// It began as Bookscan, which is why the names of things kept in the browser (storage keys,
// databases, caches) still start with "bookscan": renaming those would cut existing installs
// off from their shelf.
// Plain ES module, no build step. The shelf is stored on the device (IndexedDB) and, for
// signed-in users, synced with the small Django server in server/.

import NL from './lang-nl.js';

const APP_VERSION = '1.29.0'; // shown under Settings, so you can tell which build is running

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

/** el.replaceChildren(), skipping what h() skips: replaceChildren itself writes out an undefined or false as text. */
const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter((kid) => kid != null && kid !== false));

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
    document.querySelector('meta[name="theme-color"]').content = t === 'light' ? '#f6f4fc' : '#100d2a';
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
  if (settle(book)) toast(t('Not on a reading list any more, so it won’t be added to {host}.', { host: booklogHost() }), { ms: 6000 });
  touch(book.id, book);
  renderLibrary();
  await DB.put(book).catch(storageFailed);
}

/** Several books changed at once: one drawing, one sync. → how many lost their way to the booklog. */
async function saveBooks(changed) {
  const now = new Date().toISOString();
  let unwanted = 0;
  for (const book of changed) {
    if (settle(book)) unwanted += 1;
    book.modified = now;
    sync.dirty[book.id] = now;
  }
  store.set('syncDirty', sync.dirty);
  scheduleSync();
  renderLibrary();
  await Promise.all(changed.map((book) => DB.put(book))).catch(storageFailed);
  return unwanted;
}

/** What follows from a change, before a book is saved. → true when it is no longer on its way to the booklog. */
function settle(book) {
  // How progress is said (page or percentage) is chosen per read: it ends with the read.
  if (!shelves(book).reading) { delete book.progressUnit; delete book.percentRead; }
  // Why the booklog refused the book was said about how it was; changed, it gets another
  // try, and the server says so again if it still won't do.
  delete book.boekenError;
  // A book on its way to the booklog goes there on a reading list (to read, reading, read):
  // that is what a post says. Taken off all of them before it got there, it isn't added.
  if (book.boekenWanted && !book.boeken && ![...FIXED.keys()].some((id) => shelves(book)[id])) {
    delete book.boekenWanted;
    return true;
  }
  return false;
}

/** `drop`: the book is given up for good; for a booklog book its page there is deleted too. */
async function removeBook(book, { drop = false } = {}) {
  books = books.filter((b) => b.id !== book.id);
  if (drop) { sync.drops[book.id] = true; store.set('syncDrops', sync.drops); }
  touch(book.id);
  renderLibrary();
  await DB.del(book.id).catch(storageFailed);
}

async function restoreBook(book) {
  if (books.some((b) => b.id === book.id)) return;
  if (sync.drops[book.id]) { delete sync.drops[book.id]; store.set('syncDrops', sync.drops); }
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
  { id: 'abandoned', name: 'Did not finish', group: READING, noteLabel: '' },
  { id: 'lent', name: 'Lent out', group: '', noteLabel: 'Lent to' },
];
// The reading lists are part of the app: always there, always one either-or set, never
// renamed or removed. That is what lets a book offer "start reading", "mark as read" and
// "did not finish", and what the booklog's shelves are tied to.
const FIXED = new Map(STANDARD_LISTS.filter((l) => l.group === READING).map((l) => [l.id, l]));

/** The user's lists, in their order. */
let lists = [];
/** What the library shows: one list, or every book when `list` is null. */
const VIEWS = ['list', 'covers', 'cards'];
// Where you are (the scope): every book, a list (`list`), all series (`seriesIndex`), one
// series (`series`, its name) or one person's books (`author`, the name). Within it, `filters`
// narrow what is shown ({facet: [values]}, see facetsOf) and `sort` orders it ({key, dir};
// null: the order kept for this scope, or its own default, see sortOf).
const view = { list: null, series: null, seriesIndex: false, author: null, filters: {}, sort: null, mode: VIEWS.includes(store.get('view', 'list')) ? store.get('view', 'list') : 'list' };

// The standard lists (and their group and note) are stored under their English names, so
// they are the same list on a Dutch and an English device. Until they are renamed, they
// are shown in the device's language.
const STANDARD_TEXT = new Set([READING, ...STANDARD_LISTS.flatMap((l) => [l.name, l.noteLabel])].filter(Boolean));
const show = (text) => (STANDARD_TEXT.has(text) ? t(text) : text);
/** What a list is called: a fixed list by its own name in your language, any other as you named it. */
const listName = (l) => (FIXED.has(l.id) ? t(FIXED.get(l.id).name) : show(l.name));

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

/** Puts back a fixed list that is missing (an older version let them be deleted) or was taken out of its set. */
async function ensureFixedLists() {
  let mended = false;
  const ids = STANDARD_LISTS.map((l) => l.id);
  for (const [id, standard] of FIXED) {
    let list = listById(id);
    if (list && list.group === READING) continue;
    if (!list) {
      const before = listById(ids[ids.indexOf(id) - 1]);
      list = { ...standard, order: before ? (before.order ?? 0) + 0.5 : lists.length };
      lists.push(list);
    } else list.group = READING;
    touchList(id, list);
    await DB.lists.put(list).catch(storageFailed);
    mended = true;
  }
  if (mended) sortLists();
}

async function removeList(list) {
  if (FIXED.has(list.id)) return;
  lists = lists.filter((l) => l.id !== list.id);
  touchList(list.id);
  renderLibrary();
  await DB.lists.del(list.id).catch(storageFailed);
}

async function loadLists() {
  lists = await DB.lists.all();
  if (!lists.length && !store.get('listsSeeded', false)) await seedLists();
  sortLists();
  await ensureFixedLists();
}

async function seedLists() {
  lists = STANDARD_LISTS.map((l, order) => ({ ...l, order, modified: EPOCH }));
  store.set('listsSeeded', true);
  await Promise.all(lists.map((l) => DB.lists.put(l)));
}

/* Series: books that share a `series` name, in the order of their `seriesNumber`. */

/** What a book's place in its series is called: its label ("4/5") if it has one, else its number. */
const seriesNo = (b) => String(b.seriesLabel || (b.seriesNumber ?? ''));

/** A book's authors, one by one ("John Scalzi, Wil Wheaton" is two). */
const authorsOf = (b) => String(b.author || '').split(',').map((name) => name.trim()).filter(Boolean);

/* The people of a book: who wrote it, and who drew, coloured, lettered, translated or read
   it. `people` is [{name, role}], the role empty for someone who simply wrote it; `author`
   stays the names of the writers, for lists and searching. A book has the people of its
   latest read, and each read's edition its own: the audiobook has a voice, the paperback not.
   A book that only has `author` (scanned, nothing more said) has those as its people. */
const WRITER_ROLES = new Set(['auteur', 'auteurs', 'author', 'schrijver', 'tekst', 'writer']);   // as the booklog has it
const isWriter = (person) => !person.role || WRITER_ROLES.has(person.role.trim().toLowerCase());
const peopleOf = (x) => (Array.isArray(x.people) && x.people.length ? x.people : authorsOf(x).map((name) => ({ name, role: '' })));
/** Those who wrote it; where nobody is said to have, everybody. */
const writersIn = (people) => { const wrote = people.filter(isWriter); return (wrote.length ? wrote : people).map((person) => person.name); };
/** The others, by what they did: [[role, [names]]]. */
function contributorsIn(people) {
  const by = new Map();
  if (people.some(isWriter)) for (const person of people) if (!isWriter(person)) (by.get(person.role) || by.set(person.role, []).get(person.role)).push(person.name);
  return [...by];
}
/** Everyone named on a book or on any edition of it that was read, folded for comparing. */
const everyoneIn = (b) => new Set([b, ...(b.reviews || []).map((r) => r.edition || {})].flatMap((x) => peopleOf(x).map((person) => fold(person.name))).concat(authorsOf(b).map(fold)));

/** A name that leads to all of that person's books. */
const personLink = (name) => h('a', {
  class: 'author-link', href: `#/author/${encodeURIComponent(name)}`, text: name,
  onclick: (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;   // let the browser open a new tab
    e.preventDefault();
    closeLayersThen(() => setView({ author: name }));
  },
});

/** The people editor of a form: a row of name and role each. → { el, first, value() } */
function peopleEditor(people) {
  const known = new Set(), roles = new Set(['tekst', 'beeld', 'kleur', 'inkt', 'letters', 'stem', 'vertaling', 'redactie', 'illustraties', 'voorwoord']);
  for (const b of books) for (const x of [b, ...(b.reviews || []).map((r) => r.edition || {})]) for (const person of peopleOf(x)) { known.add(person.name); if (person.role) roles.add(person.role); }
  const rows = h('div', { class: 'people-rows' });
  const add = (person = {}) => {
    const name = h('input', { name: 'person', value: person.name || '', placeholder: t('Name'), list: 'peopleNames', autocomplete: 'off', autocapitalize: 'words' });
    const role = h('input', { name: 'role', value: person.role || '', placeholder: t('role, if any'), list: 'peopleRoles', autocomplete: 'off', autocapitalize: 'none' });
    const row = h('div', { class: 'people-row' }, name, role, h('button', {
      class: 'icon-btn', type: 'button', 'aria-label': t('Remove'), title: t('Remove'),
      onclick: () => { if (rows.children.length > 1) row.remove(); else name.value = role.value = ''; },
    }, icon('x')));
    rows.append(row);
    return name;
  };
  (people.length ? people : [{}]).forEach(add);
  const el = h('div', { class: 'people' }, rows,
    h('button', { class: 'link-btn', type: 'button', onclick: () => add().focus() }, icon('plus'), t('Add a person')),
    h('datalist', { id: 'peopleNames' }, [...known].sort().map((value) => h('option', { value }))),
    h('datalist', { id: 'peopleRoles' }, [...roles].sort().map((value) => h('option', { value }))));
  return {
    el,
    get first() { return rows.querySelector('input'); },
    /** [{name, role}], nobody twice; several names in one field ("A, B") are several people. */
    value() {
      const out = [], seen = new Set();
      for (const row of rows.children) {
        const [name, role] = [...row.querySelectorAll('input')].map((input) => input.value.replace(/\s+/g, ' ').trim());
        for (const one of name.split(',').map((part) => part.trim()).filter(Boolean)) {
          if (!seen.has(fold(one))) { seen.add(fold(one)); out.push({ name: one, role }); }
        }
      }
      return out;
    },
  };
}
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
  Object.assign(view, { list: null, series: null, seriesIndex: false, author: null, filters: {}, sort: null });
  const [path, query = ''] = location.hash.split('?');
  let m;
  if ((m = path.match(/^#\/list\/(.+)$/))) view.list = listById(part(m[1])) ? part(m[1]) : null;
  else if ((m = path.match(/^#\/series\/(.+)$/))) view.series = part(m[1]) || null;
  else if ((m = path.match(/^#\/author\/(.+)$/))) view.author = part(m[1]) || null;
  else if (/^#\/series\/?$/.test(path)) view.seriesIndex = true;
  // What narrows the view is in the address too: ?format=audiobook&in:Plaats=<list id>
  for (const [key, value] of new URLSearchParams(query)) (view.filters[key] ||= []).push(value);
}

/** The address of what is showing: the scope, and the filters on it. */
function addressOf() {
  const path = view.list ? `#/list/${encodeURIComponent(view.list)}`
    : view.series ? `#/series/${encodeURIComponent(view.series)}`
      : view.author ? `#/author/${encodeURIComponent(view.author)}`
        : view.seriesIndex ? '#/series' : '';
  const query = new URLSearchParams(Object.entries(view.filters).flatMap(([key, values]) => values.map((value) => [key, value]))).toString();
  return (path || (query ? '#/' : '')) + (query ? `?${query}` : '') || location.pathname + location.search;
}

/** Open every book (null), a list (its id), all series ({seriesIndex: true}), one ({series: name}) or an author's books ({author: name}). */
function setView(target) {
  // Going somewhere else ends selecting books (it is a step in history of its own).
  if (picking.on) { closeLayersThen(() => setView(target)); return; }
  const wasSeries = view.seriesIndex || view.series || view.author;
  // Another place: its own filters, and the order kept for it.
  Object.assign(view, { list: null, series: null, seriesIndex: false, author: null, filters: {}, sort: null });
  if (typeof target === 'string') view.list = listById(target) ? target : null;
  else if (target?.series) view.series = target.series;
  else if (target?.seriesIndex) view.seriesIndex = true;
  else if (target?.author) view.author = target.author;
  if (wasSeries || view.seriesIndex || view.series || view.author) $('search').value = '';   // what you looked for among series isn't what you look for in one
  const address = addressOf();
  // Every view is a step in the browser's history, so Back always returns to the one before
  // (and only leaves the app from where you came in). Opening the view you are on adds nothing.
  if (new URL(address, location.href).href !== location.href) history.pushState({ view: true }, '', address);
  renderLibrary();
  if (window.scrollY > $('lists').offsetTop) window.scrollTo(0, 0);
}

/** The same place, narrowed or ordered differently. It is still that place: no new step in history. */
function refine({ filters, sort } = {}) {
  if (filters) view.filters = Object.fromEntries(Object.entries(filters).filter(([, values]) => values.length));
  if (sort) {
    view.sort = sort;
    store.set('sorts', { ...store.get('sorts', {}), [scopeKey()]: sort });
  }
  history.replaceState(history.state, '', addressOf());
  renderLibrary();
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
  drops: store.get('syncDrops', {}),       // ids of deleted books that were dropped, until the server knows
  dirtyLists: store.get('syncDirtyLists', {}),
  last: store.get('syncLast', null),       // when the last sync finished (this device's clock)
  error: '',
  assistant: store.get('assistant', false),   // whether the server can propose books from a description
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
            return { id, modified, deleted: !row, [key]: row || null, ...(!row && key === 'book' && sync.drops[id] && { drop: true }) };
          });
        };
        const res = await api('sync', {
          since: sync.cursor, changes: pack(sent, books, 'book'),
          listsSince: sync.listsCursor, lists: pack(sentLists, lists, 'list'),
        });
        if (!sync.user) return;   // signed out meanwhile
        for (const [id, modified] of Object.entries(sent)) {
          if (sync.dirty[id] !== modified) continue;
          delete sync.dirty[id];
          if (sync.drops[id]) { delete sync.drops[id]; store.set('syncDrops', sync.drops); }
        }
        if (res.lists) {   // a server from before lists existed leaves them waiting
          for (const [id, modified] of Object.entries(sentLists)) if (sync.dirtyLists[id] === modified) delete sync.dirtyLists[id];
          await applyRemoteLists(res.lists);
          sync.listsCursor = res.cursor;
        }
        await applyRemote(res.changes || []);
        sync.cursor = res.cursor;
        if ('assistant' in res && sync.assistant !== !!res.assistant) {
          sync.assistant = !!res.assistant;
          store.set('assistant', sync.assistant);
          renderLibrary();
        }
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
      if (FIXED.has(c.id)) { touchList(c.id, local); continue; }   // a fixed list stays, and is said to stay
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
  await ensureFixedLists();
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

/* What a book is read as: paper, e-book or audiobook. A book says so in `format`, and each
   read's edition for itself. An audiobook is measured in time (`duration`, "11u 36m"), the
   others in pages. Where nothing is said, a length without pages means an audiobook; a book
   from the booklog always says (the import works it out), so nothing is guessed for those. */
const FORMATS = ['paper', 'ebook', 'audiobook'];
const formatName = (format) => ({ paper: t('Paper'), ebook: t('E-book'), audiobook: t('Audiobook') })[format] || '';
const formatOf = (x) => (FORMATS.includes(x.format) ? x.format : (!x.boeken && x.duration && !x.pages ? 'audiobook' : ''));
/** How long it is, said the way its format is measured: "Audiobook · 11u 36m", "E-book · 320 pp", "320 pp". */
function extentOf(x) {
  const format = formatOf(x);
  if (format === 'audiobook') return [t('Audiobook'), x.duration].filter(Boolean).join(' · ');
  return [format === 'ebook' && t('E-book'), x.pages && t('{n} pp', { n: x.pages })].filter(Boolean).join(' · ');
}

/** The three formats as chips; tapping the chosen one again leaves it unsaid. → { el, value, onChange } */
function formatPicker(initial) {
  const picker = { value: FORMATS.includes(initial) ? initial : '', onChange: null, el: h('div', { class: 'chips' }) };
  const draw = () => picker.el.replaceChildren(...FORMATS.map((format) => h('button', {
    class: 'chip', type: 'button', text: formatName(format), 'aria-pressed': String(picker.value === format),
    onclick: () => { picker.value = picker.value === format ? '' : format; draw(); picker.onChange?.(picker.value); },
  })));
  draw();
  return picker;
}

/* What a book is in and about: the language of its edition (a two-letter code, as the booklog
   has it), its categories (the booklog's own small set) and its tags (anything). */
const LANGUAGE_NAMES = { nl: 'Nederlands', en: 'English', fr: 'Français', de: 'Deutsch' };
const languageName = (code) => LANGUAGE_NAMES[code] || String(code || '').toUpperCase();
/** The languages to choose from: the four the booklog mostly has, and any other a book is in. */
const languageCodes = () => [...new Set([...Object.keys(LANGUAGE_NAMES), ...books.map((b) => b.language).filter((code) => /^[a-z]{2}$/.test(code || ''))])];
/** Categories to choose from: the booklog's, most used first, then any other a book has. */
function categoryNames() {
  const all = booklogCategories();
  for (const b of books) for (const c of b.categories || []) if (!all.includes(c)) all.push(c);
  return all;
}
/** "a, b ,, c" → ['a', 'b', 'c'], nothing twice. */
const commaList = (text) => [...new Map(String(text || '').split(',').map((part) => part.replace(/\s+/g, ' ').trim()).filter(Boolean).map((part) => [fold(part), part])).values()];
/** Chips to choose one of, or none: tapping the chosen one again leaves it unsaid. → { el, value } */
function oneChip(options, initial, name = (v) => v) {
  const picker = { value: initial || '', el: h('div', { class: 'chips' }) };
  const draw = () => picker.el.replaceChildren(...options.map((option) => h('button', {
    class: 'chip', type: 'button', text: name(option), 'aria-pressed': String(picker.value === option),
    onclick: () => { picker.value = picker.value === option ? '' : option; draw(); },
  })));
  draw();
  return picker;
}
/** Chips to choose any number of. → { el, value: Set } */
function someChips(options, initial) {
  const picker = { value: new Set(initial), el: h('div', { class: 'chips' }) };
  const draw = () => picker.el.replaceChildren(...[...new Set([...options, ...picker.value])].map((option) => h('button', {
    class: 'chip', type: 'button', text: option, 'aria-pressed': String(picker.value.has(option)),
    onclick: () => { if (!picker.value.delete(option)) picker.value.add(option); draw(); },
  })));
  draw();
  return picker;
}
/** Every tag on the shelf, for suggesting. */
const tagNames = () => [...new Set(books.flatMap((b) => b.tags || []))].sort((a, b) => a.localeCompare(b, LOCALE));

function metaLine(b) {
  // Rating (0–10) and how far along come with books from the booklog at boeken.tsuk.org.
  const { percent } = progressOf(b);
  const progress = percent ? t('{n}% read', { n: percent }) : '';
  return [b.publisher, yearOf(b.date) || b.date, extentOf(b), progress, b.rating != null && `★ ${b.rating}`]
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

// Every overlay pushes a history entry so Android's back gesture closes it. Views are history
// entries too (see setView): Back closes what is open on top first, then walks back through them.
const layers = [];
/** `scrolls`: what is under it can still be scrolled (choosing books is a layer, but over the shelf). */
function openLayer(onClose, { scrolls = false } = {}) {
  layers.push(Object.assign(() => onClose(), { scrolls }));
  history.pushState({ layer: layers.length }, '');
  relock();
}
const relock = () => document.body.classList.toggle('locked', layers.some((layer) => !layer.scrolls));
function closeLayer() { if (layers.length) history.back(); }
/** Close whatever is open on top, then do `next`: going back in history takes a moment, and a
 *  new view must not be pushed onto the entry that is on its way out. Everything that is open
 *  (a sheet over the scanner, say) is left in one step back: two steps in a row, the second
 *  asked for while the first is still landing, can end up a page too far. */
function closeLayersThen(next) {
  if (!layers.length) { next(); return; }
  window.addEventListener('popstate', () => setTimeout(next, 0), { once: true });
  history.go(-layers.length);
}
window.addEventListener('popstate', (e) => {
  // The entry arrived at says how many layers were open when it was made; what is open beyond
  // that is closed, the top one first.
  const depth = Math.min(layers.length, e.state?.layer || 0);
  if (layers.length > depth) {
    while (layers.length > depth) layers.pop()();
    relock();
    return;
  }
  // Nothing was open on top: Back or Forward moved between views.
  readRoute();
  renderLibrary();
});

const sheet = {
  isOpen: false,
  onClose: null,
  /** Opens the sheet, or swaps its content if it is already open. */
  open(content, onClose) {
    $('sheet').classList.remove('tinted');   // a book's page puts its colour back on (tintSheet)
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

// Escape is Cancel: in whatever is on top (the cover, large, over a sheet over the scanner) it
// does what that one's Cancel button does — back to the book from editing it, say. Where there
// is no Cancel, it closes what is open, as a tap beside a sheet does.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (e.target.type === 'search' && e.target.value) return;   // that Escape empties the search box
  const top = coverRoom || (sheet.isOpen && $('sheet')) || (scanner.open && scannerEl);
  if (!top) return;
  e.preventDefault();
  const cancel = [...top.querySelectorAll('[data-cancel]')].filter((b) => b.offsetParent && !b.disabled).pop();
  if (cancel) cancel.click(); else closeLayer();
});

// A field you type in stays clear of the sheet's buttons. The keyboard shrinks the page after
// the field has the focus, and the browser then scrolls it into view behind them.
function clearOfActions() {
  const body = $('sheetBody'), field = document.activeElement;
  if (!sheet.isOpen || !field?.matches?.('input, textarea, select') || !body.contains(field)) return;
  const bar = body.querySelector('.sheet-actions');
  if (!bar || bar.contains(field)) return;
  const box = field.getBoundingClientRect(), top = body.getBoundingClientRect().top + 12;
  const bottom = Math.min(bar.getBoundingClientRect().top, body.getBoundingClientRect().bottom) - 12;
  if (box.bottom > bottom) body.scrollTop += Math.min(box.bottom - bottom, box.top - top);   // a tall field: its top
}
let clearing;
const clearSoon = () => { clearTimeout(clearing); clearing = setTimeout(clearOfActions, 120); };
$('sheetBody').addEventListener('focusin', clearSoon);
window.addEventListener('resize', clearSoon);
window.visualViewport?.addEventListener('resize', clearSoon);

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
    return note ? `${listName(list)}: ${note}` : listName(list);
  }).filter(Boolean);
  return tags.length ? h('div', { class: 'book-tags' }, tags.map((text) => h('span', { class: 'tag', text }))) : null;
}

function bookRow(b, onPick, extra, tags) {
  let meta;
  if (b.pending) meta = h('div', { class: 'book-meta flag' }, icon('cloud-off'), t('Will be looked up when you’re online'));
  else if (b.unresolved) meta = h('div', { class: 'book-meta flag', text: t('No match found — tap to fill in') });
  else meta = h('div', { class: 'book-meta', text: metaLine(b) });
  return h('button', { class: 'book', type: 'button', onclick: (e) => onPick(b, e) },
    coverEl(b),
    h('div', { class: 'book-text' },
      h('div', { class: 'book-title' }, extra, displayTitle(b)),
      h('div', { class: 'book-author', text: [b.author, inOpenSeries(b) ? '' : seriesLine(b)].filter(Boolean).join(' · ') || (b.title ? '' : b.isbn && !b.pending ? `ISBN ${b.isbn}` : '') }),
      meta, tags));
}

/** A book in the covers view: its cover and its rating. */
/* Editions: a read is of an edition (the paperback first, the audiobook the next time), and
   each review says which in `edition`: publisher, date, pages or duration, ISBN, language, cover. */

/** The book's own edition (the copy on the shelf, or the one read last), for a read that doesn't say. */
function mainEdition(b) {
  const edition = {};
  for (const key of ['publisher', 'date', 'pages', 'duration', 'isbn', 'language', 'cover', 'coverRatio', 'thumb', 'format']) {
    if (b[key] != null && b[key] !== '') edition[key] = b[key];
  }
  if (formatOf(b) === 'audiobook') delete edition.pages; else if (formatOf(b)) delete edition.duration;
  if (Array.isArray(b.people) && b.people.length) edition.people = b.people;
  return edition;
}

/** The different covers the book was read in, oldest read first; just the book itself when there is one. */
function editionCovers(b) {
  const seen = new Set(), covers = [];
  const reads = (b.reviews || []).filter((r) => r.edition && (r.edition.cover || r.edition.thumb));
  for (const r of reads.sort((x, y) => (!x.date - !y.date) || (x.date < y.date ? -1 : x.date > y.date ? 1 : 0))) {
    const key = r.edition.cover || r.edition.thumb;
    if (!seen.has(key)) { seen.add(key); covers.push({ title: b.title, ...r.edition }); }
  }
  return covers.length > 1 ? covers.slice(-3) : [b];
}

function editionLine(e) {
  return [extentOf(e), e.publisher, yearOf(e.date) || e.date,
    ...contributorsIn(e.people || []).map(([role, names]) => `${role}: ${names.join(', ')}`)]
    .filter(Boolean).join(' · ');
}

/** A rating out of ten as five stars, filled as far as it goes (9 is four and a half). */
const stars = (rating) => h('span', { class: 'stars', style: `--v:${Math.max(0, Math.min(10, rating)) / 10}`, title: `${rating}/10`, 'aria-label': `${rating}/10`, text: '★★★★★' });

/** When the book was read: "May 2013 · Apr 2018". */
function readDates(b) {
  return sortedReviews(b).filter((r) => r.date).reverse()
    .map((r) => new Date(`${r.date}T12:00:00`).toLocaleDateString(LOCALE, { month: 'short', year: 'numeric' })).join(' · ');
}

/**
 * A book in the covers view: its cover (when it was read in several editions, each one's
 * cover, the latest in front), its rating in stars and, on a series' page, its number and
 * when it was read.
 */
function bookTile(b, onPick, numbered) {
  const covers = editionCovers(b);
  const front = covers.length > 1
    ? h('div', { class: 'cover-stack', style: `--n:${covers.length}` }, covers.map((c, i) => { const el = coverEl(c); el.style.setProperty('--i', i); return el; }))
    : coverEl(b, false, true);
  const dates = numbered ? readDates(b) : '';
  return h('button', { class: 'tile', type: 'button', title: [displayTitle(b), b.author].filter(Boolean).join(' — '), onclick: (e) => onPick(b, e) },
    front,
    h('div', { class: 'tile-foot' },
      b.rating != null ? stars(b.rating) : h('span'),
      numbered && seriesNo(b) && h('span', { class: 'tile-no', text: seriesNo(b) })),
    h('div', { class: 'tile-dates', text: dates }));
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
  return h('button', { class: 'bcard', type: 'button', onclick: (e) => onPick(b, e) },
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

/* ───────────────────────── Where you are: the menu ───────────────────────── */

// The reading lists are the places you go to; so are all books, the series, and the lists
// you keep by hand (lent out, a wishlist). Lists that belong to a set of their own, such as
// the places books stand in, narrow what you see instead: they are filters (facetsOf).
const isScope = (list) => FIXED.has(list.id) || !list.group;

function renderNav() {
  const counts = new Map(lists.map((l) => [l.id, 0]));
  for (const b of books) for (const id of Object.keys(shelves(b))) if (counts.has(id)) counts.set(id, counts.get(id) + 1);
  const go = (target) => (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;   // let the browser open a new tab
    e.preventDefault();
    setView(target);
  };
  const plain = !view.series && !view.seriesIndex && !view.author;
  // `inSheet`: the link is in the More sheet, which closes first; only then is there a new view.
  const link = (target, href, isCurrent, name, count, inSheet) => h('a', {
    class: 'nav-item', href, 'aria-current': isCurrent ? 'page' : null, 'data-list': typeof target === 'string' ? target : null,
    onclick: inSheet ? (e) => { e.preventDefault(); closeLayersThen(() => setView(target)); } : go(target),
  }, h('span', { text: name }), h('b', { text: String(count) }));
  const item = (id, name, count, inSheet) => link(id, id ? `#/list/${encodeURIComponent(id)}` : '#/', view.list === id && plain, name, count, inSheet);
  const seriesCount = new Set(books.map((b) => b.series).filter(Boolean)).size;
  // Only what has books on it (and what is open): an empty list is no place to go.
  const worth = (l) => counts.get(l.id) > 0 || view.list === l.id;
  const reading = ['reading', 'to-read', 'read', 'abandoned'].map(listById).filter((l) => l && (l.id !== 'abandoned' || worth(l)));
  const kept = lists.filter((l) => !FIXED.has(l.id) && isScope(l) && worth(l));
  const series = (inSheet) => seriesCount > 0 && link({ seriesIndex: true }, '#/series', view.seriesIndex || !!view.series, t('Series'), seriesCount, inSheet);
  const edit = () => h('button', { class: 'nav-item nav-edit', type: 'button', onclick: () => openLists() }, icon('list'), h('span', { text: t('Edit lists') }));

  // Beside the books on a wide screen.
  fill($('lists'),
    h('div', { class: 'nav-group' }, reading.map((l) => item(l.id, listName(l), counts.get(l.id)))),
    h('div', { class: 'nav-group' }, item(null, t('All books'), books.length), series()),
    kept.length > 0 && h('div', { class: 'nav-group' },
      h('span', { class: 'nav-label', text: t('Lists') }),
      kept.map((l) => item(l.id, listName(l), counts.get(l.id)))),
    h('div', { class: 'nav-group' }, edit()));

  // Under the thumb on a phone: the four places you go to most, and the rest behind More.
  const tab = (name, label, target, href, isCurrent) => h('a', { class: 'bar-item', href, 'aria-current': isCurrent ? 'page' : null, onclick: go(target) }, icon(name), h('span', { text: label }));
  const elsewhere = !['reading', 'to-read', 'read', null].includes(view.list) || !plain;
  $('bar').replaceChildren(
    tab('book-open', listName(listById('reading')), 'reading', '#/list/reading', view.list === 'reading' && plain),
    tab('bookmark', listName(listById('to-read')), 'to-read', '#/list/to-read', view.list === 'to-read' && plain),
    tab('check', listName(listById('read')), 'read', '#/list/read', view.list === 'read' && plain),
    tab('library', t('All'), null, '#/', view.list === null && plain),
    h('button', {
      class: 'bar-item', type: 'button', 'aria-current': elsewhere ? 'page' : null,
      onclick: () => sheet.open(h('div', null,
        sheetHead(t('More')),
        h('div', { class: 'more-nav' },
          series(true), reading.filter((l) => l.id === 'abandoned').map((l) => item(l.id, listName(l), counts.get(l.id), true)),
          kept.map((l) => item(l.id, listName(l), counts.get(l.id), true)), edit()))),
    }, icon('more'), h('span', { text: t('More') })));
}

/* ───────────────────────── The order of the books ───────────────────────── */

const PARTICLES = new Set(['van', 'de', 'der', 'den', 'ter', 'ten', 'te', 'von', 'zu', 'du', 'des', 'le', 'la', 'di', 'da', 'del', 'della', 'el', 'al']);
/** "Ursula K. Le Guin" → "le guin ursula k": a name as it is sorted, by surname with its particles. */
function surnameFirst(name) {
  // Only what is a name counts: "Platon ." is Platon, "Mitric -Nicolas" is Nicolas Mitric... as far as can be told.
  const words = String(name || '').split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.]+$/gu, '')).filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (words.length < 2) return fold(words[0] || '');
  let cut = words.length - 1;
  while (cut > 1 && PARTICLES.has(words[cut - 1].toLowerCase())) cut--;
  return fold(`${words.slice(cut).join(' ')} ${words.slice(0, cut).join(' ')}`);
}
const titleKey = (b) => fold(b.title).replace(/^[^\p{L}\p{N}]+/u, '').replace(/^(the|a|an|de|het|een|le|la|les|l|der|die|das|un|une) /, '');
/** The day a book was last read ('' if it wasn't, or it isn't said when). */
const lastRead = (b) => (b.reviews || []).reduce((latest, r) => (r.date && r.date > latest ? r.date : latest), '');
/** How long a book is, in pages; an audiobook's hours count for forty pages each, as the booklog reckons. */
const lengthOf = (b) => (formatOf(b) === 'audiobook' && minutesOf(b.duration) != null ? Math.round((minutesOf(b.duration) * 2) / 3) : b.pages || null);

// Each order: what it is called, which way it runs when first chosen (1 up, -1 down), the
// value it sorts by (null or '' sorts last, whichever way), and the heading books share.
const dateHeading = (iso) => (iso ? { list: dayLabel, cards: monthLabel, covers: yearLabel }[view.mode](iso) : t('No date'));
const SORTS = {
  added: { name: () => t('Date added'), dir: -1, value: (b, on) => on(b), heading: (v) => dateHeading(v) },
  read: { name: () => t('Date read'), dir: -1, value: (b) => lastRead(b), heading: (v) => (v ? { list: monthLabel, cards: monthLabel, covers: yearLabel }[view.mode](v) : t('No date')) },
  changed: { name: () => t('Last changed'), dir: -1, value: (b) => b.modified || b.added, heading: (v) => dateHeading(v) },
  author: { name: () => t('Author'), dir: 1, value: (b) => surnameFirst(authorsOf(b)[0]), heading: (v) => (v ? v[0].toUpperCase() : t('No author')) },
  title: { name: () => t('Title'), dir: 1, value: (b) => titleKey(b), heading: (v) => (v ? v[0].toUpperCase() : '') },
  rating: { name: () => t('Rating'), dir: -1, value: (b) => b.rating ?? null, heading: (v) => (v == null ? t('Not rated') : `★ ${v}`) },
  year: { name: () => t('Year published'), dir: -1, value: (b) => yearOf(b.date) || null, heading: (v) => v || t('No year') },
  length: { name: () => t('Length'), dir: 1, value: (b) => lengthOf(b), heading: () => '' },
  series: { name: () => t('Series'), dir: 1, value: (b) => (b.series ? `${fold(b.series)} ${String(Math.round((b.seriesNumber ?? 9999) * 100)).padStart(8, '0')}` : null), heading: (v, b) => b.series || t('Not in a series') },
};

/** What the order is kept under: each place has its own. */
const scopeKey = () => (view.series ? 'series' : view.author ? 'author' : view.list || 'all');
/** The order that suits a place when none was chosen: what you'd ask of it. */
function defaultSort() {
  if (view.list === 'reading') return { key: 'changed', dir: -1 };   // where was I?
  if (view.list === 'read' || view.list === 'abandoned') return { key: 'read', dir: -1 };   // what did I read, and when?
  if (view.list === 'lent') return { key: 'added', dir: 1 };   // who has had it longest?
  if (view.author) return { key: 'series', dir: 1 };
  return { key: 'added', dir: -1 };
}
function sortOf() {
  const kept = view.sort || store.get('sorts', {})[scopeKey()];
  return kept && SORTS[kept.key] ? kept : defaultSort();
}

function openSortSheet() {
  const now = sortOf();
  const row = ([key, sort]) => h('button', {
    class: 'way', type: 'button', 'aria-pressed': String(key === now.key),
    // The order you have: the other way round. Another: the way it usually runs.
    onclick: () => closeLayersThen(() => refine({ sort: { key, dir: key === now.key ? -now.dir : sort.dir } })),
  }, icon(key === now.key ? (now.dir > 0 ? 'up' : 'down') : 'dot'), h('span', { class: 'way-text' }, h('span', { text: sort.name() })), h('span'));
  sheet.open(h('div', null,
    sheetHead(t('Order'), t('Choose the same one again to turn it round.')),
    h('div', { class: 'ways sort-ways' }, Object.entries(SORTS).map(row))));
}

/* ───────────────────────── Filters: narrowing what a place shows ───────────────────────── */

const RATINGS = [['9', '★ 9–10', (r) => r >= 9], ['7', '★ 7–8', (r) => r >= 7 && r < 9], ['5', '★ 5–6', (r) => r >= 5 && r < 7], ['0', () => t('Below 5'), (r) => r != null && r < 5], ['none', () => t('Not rated'), (r) => r == null]];

/**
 * What the books of a place can be narrowed by: [{key, name, values: [{value, name, test}]}].
 * Each facet says of a book which of its values it has. Which facets there are depends on
 * where you are (no reading status inside a reading list) and on the lists you keep (every
 * set of lists of your own, such as the places books stand in, is one).
 */
function facetsOf() {
  const facets = [];
  const status = FIXED.has(view.list);
  if (!status) {
    facets.push({ key: 'status', name: t('Reading status'),
      values: [...FIXED.keys()].map((id) => ({ value: id, name: listName(listById(id) || FIXED.get(id)), test: (b) => !!shelves(b)[id] })) });
  }
  for (const section of listSections().filter((sec) => sec.label && sec.label !== READING)) {
    facets.push({ key: `in:${section.label}`, name: show(section.label),
      values: [...section.members.map((l) => ({ value: l.id, name: listName(l), test: (b) => !!shelves(b)[l.id] })),
        { value: 'none', name: t('None'), test: (b) => !section.members.some((l) => shelves(b)[l.id]) }] });
  }
  const kept = lists.filter((l) => !FIXED.has(l.id) && !l.group && l.id !== view.list);
  if (kept.length) facets.push({ key: 'on', name: t('Lists'), values: kept.map((l) => ({ value: l.id, name: listName(l), test: (b) => !!shelves(b)[l.id] })) });
  facets.push({ key: 'format', name: t('Format'),
    values: [...FORMATS.map((format) => ({ value: format, name: formatName(format), test: (b) => formatOf(b) === format })),
      { value: 'none', name: t('Not said'), test: (b) => !formatOf(b) }] });
  const having = (key, pick, name = (v) => v, order = (a, b) => a.localeCompare(b)) => {
    const all = [...new Set(books.flatMap(pick))].filter(Boolean).sort(order);
    return { key, values: all.map((value) => ({ value: String(value), name: name(value), test: (b) => pick(b).includes(value) })) };
  };
  facets.push({ ...having('category', (b) => b.categories || []), name: t('Category') });
  facets.push({ ...having('language', (b) => [b.language].filter(Boolean), languageName), name: t('Language') });
  if (view.list !== 'to-read' && view.list !== 'reading') {
    facets.push({ ...having('year', (b) => [lastRead(b).slice(0, 4)].filter(Boolean), (v) => v, (a, b) => b.localeCompare(a)), name: t('Year read') });
    facets.push({ key: 'rating', name: t('Rating'), values: RATINGS.map(([value, name, fits]) => ({ value, name: typeof name === 'function' ? name() : name, test: (b) => fits(b.rating ?? null) })) });
  }
  const host = booklogHost();
  facets.push({ key: 'other', name: t('Other'), values: [
    { value: 'nocover', name: t('No cover'), test: (b) => !b.cover && !b.thumb },
    { value: 'photo', name: t('Own photo as cover'), test: (b) => !b.cover && !!b.thumb },
    host && { value: 'local', name: t('Not on {host}', { host }), test: (b) => !b.boeken },
  ].filter(Boolean) });
  return facets;
}

/** Does a book pass every filter (but the one on `except`)? Within a facet any chosen value will do. */
function passes(b, facets, except, filters = view.filters) {
  return facets.every((facet) => {
    const chosen = filters[facet.key];
    if (!chosen?.length || facet.key === except) return true;
    return facet.values.some((v) => chosen.includes(v.value) && v.test(b));
  });
}

function openFilterSheet(inScope) {
  const facets = facetsOf();
  const body = h('div');
  // Chosen here, applied when the sheet closes: only then is the address under it the current one.
  let draft = { ...view.filters };
  const draw = () => {
    const left = inScope.filter((b) => passes(b, facets, null, draft)).length;
    body.replaceChildren(
      sheetHead(t('Filter'), plural(left, 'book')),
      ...facets.map((facet) => {
        // What each value would give, with the other filters as they are.
        const others = inScope.filter((b) => passes(b, facets, facet.key, draft));
        const chosen = draft[facet.key] || [];
        const values = facet.values.map((v) => ({ ...v, count: others.filter(v.test).length })).filter((v) => v.count > 0 || chosen.includes(v.value));
        // A facet that can't tell the books apart is not worth showing.
        if (values.length < 2 && !chosen.length) return null;
        return h('div', { class: 'sheet-section facet' },
          h('h3', { text: facet.name }),
          h('div', { class: 'chips' }, values.map((v) => h('button', {
            class: 'chip', type: 'button', 'aria-pressed': String(chosen.includes(v.value)),
            onclick: () => { draft = { ...draft, [facet.key]: chosen.includes(v.value) ? chosen.filter((x) => x !== v.value) : [...chosen, v.value] }; draw(); },
          }, v.name, h('b', { text: String(v.count) })))));
      }).filter(Boolean),
      h('div', { class: 'btn-row sheet-actions' },
        h('button', { class: 'btn btn-outline', type: 'button', text: t('Clear'), disabled: !Object.values(draft).some((values) => values.length), onclick: () => { draft = {}; draw(); } }),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => sheet.close() }, icon('check'), t('Show {n}', { n: plural(left, 'book') }))));
  };
  draw();
  sheet.open(body, () => refine({ filters: draft }));
}

/** Under the search box: what the view is narrowed by, each to be taken off again. */
function drawActiveFilters(facets) {
  const chips = facets.flatMap((facet) => (view.filters[facet.key] || []).map((value) => {
    const name = facet.values.find((v) => v.value === value)?.name || value;
    return h('button', {
      class: 'chip active-filter', type: 'button', title: t('Remove'),
      onclick: () => refine({ filters: { ...view.filters, [facet.key]: view.filters[facet.key].filter((x) => x !== value) } }),
    }, `${facet.name}: ${name}`, icon('x'));
  }));
  $('activeFilters').replaceChildren(...chips);
  $('activeFilters').hidden = !chips.length;
  $('filterCount').textContent = chips.length ? String(chips.length) : '';
  $('filterCount').hidden = !chips.length;
}

/** All series, by name: a few covers, how many books, how many of them read. */
function renderSeriesIndex(query) {
  const all = [...seriesMap()].sort((a, b) => a[0].localeCompare(b[0], LOCALE, { sensitivity: 'base' }));
  const found = query ? all.filter(([name, members]) => fold(name + ' ' + members.map((b) => b.author).join(' ')).includes(query)) : all;
  $('searchWrap').hidden = all.length < 8 && !query;
  shown = { rows: [], next: 0, lastDay: '', key: 'series', current: null, query, series: null, heading: () => '' };
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
  const text = fold([b.title, b.author, ...peopleOf(b).map((person) => person.name), b.series, b.publisher, b.isbn, b.date,
    ...listsOf(b).map((m) => m.note), ...(b.reviews || []).map((r) => r.text)].join(' '));
  searchCache.set(b, { modified: b.modified, text });
  return text;
}

// A shelf can hold thousands of books, so the library is drawn a page at a time: more rows
// are added as you scroll towards the end.
const PAGE = 120;
let shown = { rows: [], next: 0, lastDay: '', key: '', current: null, query: '', heading: () => '' };
window.addEventListener('scroll', () => {
  const more = $('more');
  if (more && more.getBoundingClientRect().top < window.innerHeight + 800) appendRows();
}, { passive: true });

// On a wide screen the tools stay at the top of the window. The chips of the filters that are
// on can fill a few rows there, so they step aside while you scroll down through the books and
// come back as soon as you scroll up (or reach the top, or tab into them).
{
  const wide = matchMedia('(min-width: 900px)');
  let lastY = window.scrollY, travel = 0;
  const tuck = (on) => {
    const tools = $('tools');
    if (tools.classList.contains('tucked') === on) return;
    // While the tools are stuck, the chips leaving or rejoining the flow would make the books
    // under them jump: keep those where they are (browsers with scroll anchoring already did;
    // this is for the ones without). At rest, the chips simply push the books down again.
    const stuck = tools.getBoundingClientRect().top <= 1 && window.scrollY > 0;
    const before = $('library').getBoundingClientRect().top;
    tools.classList.toggle('tucked', on);
    const shift = $('library').getBoundingClientRect().top - before;
    if (stuck && shift) window.scrollBy(0, shift);
    lastY = window.scrollY;
    travel = 0;
  };
  const update = () => {
    const tools = $('tools');
    const y = window.scrollY, delta = y - lastY;
    lastY = y;
    const stuck = tools.getBoundingClientRect().top <= 1 && y > 0;
    const tabbedIn = $('activeFilters').contains(document.activeElement) && document.activeElement.matches(':focus-visible');
    if (!wide.matches || !stuck || tabbedIn) return tuck(false);
    travel = Math.sign(delta) === Math.sign(travel) ? travel + delta : delta;
    if (travel > 40) tuck(true);
    else if (travel < -8) tuck(false);
  };
  window.addEventListener('scroll', update, { passive: true });
  wide.addEventListener('change', update);
  document.addEventListener('focusin', (e) => { if ($('tools').contains(e.target) && e.target.matches(':focus-visible')) tuck(false); });
}

function appendRows(upTo = shown.next + PAGE) {
  $('more')?.remove();
  const frag = document.createDocumentFragment();
  const end = Math.min(shown.rows.length, upTo);
  // Books that share what they are ordered by share a heading: a month, a letter, a rating.
  // A series is in the order of its books: no headings there.
  for (const b of shown.rows.slice(shown.next, end)) {
    const day = shown.series ? '' : shown.heading(b);
    if (!shown.query && day && day !== shown.lastDay) { frag.append(h('h2', { class: 'day', text: day })); shown.lastDay = day; }
    const number = shown.series && seriesNo(b) ? h('span', { class: 'badge', text: `#${seriesNo(b)}` }) : null;
    // A book opens with the list it is opened from, for previous and next. While books are
    // being selected a tap selects it instead; a Ctrl-click starts selecting.
    const open = (book, e) => {
      if (picking.on) togglePick(book, e);
      else if (e?.ctrlKey || e?.metaKey) startPicking(book);
      else openBook(book, shown.rows);
    };
    const el = view.mode === 'covers' ? bookTile(b, open, !!shown.series)
      : view.mode === 'cards' ? bookCard(b, open, listTags(b, shown.current))
        : bookRow(b, open, number, listTags(b, shown.current));
    // The mark that says it is selected: beside the book in the list, on its cover elsewhere.
    el.dataset.id = b.id;
    const mark = h('span', { class: 'pick-mark', 'aria-hidden': 'true' }, icon('check'));
    if (view.mode === 'list') el.prepend(mark);
    else (el.querySelector('.cover-stack > .cover:last-child') || el.querySelector('.cover')).append(mark);
    if (picking.ids.has(b.id)) el.classList.add('picked');
    if (picking.on) el.setAttribute('aria-pressed', String(picking.ids.has(b.id)));
    frag.append(el);
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
      : view.author ? t('Search {list}', { list: view.author })
      : current ? t('Search {list}', { list: listName(current) }) : t('Search your shelf');
  $('empty').hidden = books.length > 0;
  $('tools').hidden = !books.length;
  $('library').className = `library mode-${view.mode}`;
  for (const button of $('viewSeg').children) button.setAttribute('aria-pressed', String(button.dataset.view === view.mode));
  renderNav();
  $('viewSeg').hidden = $('filterBtn').hidden = $('sortBtn').hidden = $('pickBtn').hidden = view.seriesIndex;
  $('activeFilters').hidden = true;
  if (view.seriesIndex) { renderSeriesIndex(query); drawPicking(); return; }

  // 1. The place: every book, a list, a series, a person's books.
  const since = (b) => (current ? shelves(b)[current.id].at || b.added : b.added);
  const writer = view.author && fold(view.author);
  const inScope = view.series ? books.filter((b) => b.series === view.series)
    : writer ? books.filter((b) => everyoneIn(b).has(writer))
    : current ? books.filter((b) => shelves(b)[current.id]) : books;
  // 2. Narrowed by the filters, and by what is searched for.
  const facets = facetsOf();
  const filtered = Object.keys(view.filters).length ? inScope.filter((b) => passes(b, facets)) : inScope;
  drawActiveFilters(facets);
  $('filterBtn').onclick = () => openFilterSheet(inScope);
  $('searchWrap').hidden = inScope.length < 8 && !query;
  const found = query ? filtered.filter((b) => searchText(b).includes(query)) : filtered;
  // 3. In order. A series has its own; anything else the one chosen for the place. Books
  //    without what is sorted by come last, whichever way the order runs.
  const sort = sortOf(), by = SORTS[sort.key];
  $('sortBtn').hidden = !!view.series;
  $('sortName').textContent = by.name();
  let rowsInOrder;
  if (view.series) rowsInOrder = [...found].sort(bySeriesOrder);
  else {
    const keyed = found.map((b) => [by.value(b, since), b]);
    const empty = (v) => v == null || v === '';
    keyed.sort(([x, a], [y, b]) => (empty(x) - empty(y))
      || (x < y ? -sort.dir : x > y ? sort.dir : 0)
      || (titleKey(a) < titleKey(b) ? -1 : 1));
    rowsInOrder = keyed.map(([, b]) => b);
  }
  // Redrawing the same view (after a save, a sync) keeps as many rows as were showing.
  const key = `${addressOf()}|${sort.key}${sort.dir}|${view.mode}|${query}`;
  const rows = key === shown.key ? Math.max(PAGE, shown.next) : PAGE;
  shown = { rows: rowsInOrder, next: 0, lastDay: '', key, current, query, series: view.series, heading: (b) => by.heading(by.value(b, since), b) };
  $('library').replaceChildren();
  if (view.series) {
    const read = inScope.filter((b) => shelves(b).read).length;
    $('library').append(h('div', { class: 'series-head' },
      h('a', { class: 'link-btn', href: '#/series', onclick: (e) => { e.preventDefault(); setView({ seriesIndex: true }); } }, icon('back'), t('All series')),
      h('h2', { text: view.series }),
      h('p', { text: inScope.length ? `${plural(inScope.length, 'book')} · ${t('{n} read', { n: read })}` : t('No books in this series.') })));
  }
  if (view.author) {
    const read = inScope.filter((b) => shelves(b).read).length;
    $('library').append(h('div', { class: 'series-head' },
      h('h2', { text: view.author }),
      h('p', { text: inScope.length ? `${plural(inScope.length, 'book')} · ${t('{n} read', { n: read })}` : t('No books by this author.') })));
  }
  if (!view.series && !view.author && current && !isScope(current)) {
    // A list that is a filter elsewhere, opened by its address: say where you are.
    $('library').append(h('div', { class: 'series-head' }, h('h2', { text: listName(current) })));
  }
  appendRows(rows);
  if ((query || Object.keys(view.filters).length) && !found.length) $('library').append(h('p', { class: 'no-results', text: t('No books match that.') }));
  else if (current && !found.length && books.length) {
    $('library').append(h('p', { class: 'no-results', text: t('Nothing on “{list}” yet. Add a book while this list is open, or open a book and put it here.', { list: listName(current) }) }));
  }
  drawPicking();
}

/* ───────────────────────── Selecting books, and changing them all at once ─────────────────────────

   Select (beside the views), a Ctrl-click or a long press on a book starts selecting: a tap
   then selects a book instead of opening it, and Shift takes in every book in between. Add
   a book makes way for a bar with what there is to do with them: Edit opens one sheet for
   all of them. Selecting is a step in history, so Back ends it, and going elsewhere does too.
   What is selected stays selected while you search or filter, to pick books from all over. */

const picking = { on: false, ids: new Set(), anchor: null };

/** The books selected: in the order they are shown, then any the view hides now. */
function pickedBooks() {
  const seen = new Set(), out = [];
  for (const b of [...shown.rows, ...books]) if (picking.ids.has(b.id) && !seen.has(b.id)) { seen.add(b.id); out.push(b); }
  return out;
}

function startPicking(first) {
  if (!picking.on) {
    Object.assign(picking, { on: true, ids: new Set(), anchor: null });
    openLayer(endPicking, { scrolls: true });
  }
  if (first) { picking.ids.add(first.id); picking.anchor = first; }
  drawPicking();
}

function endPicking() {
  Object.assign(picking, { on: false, ids: new Set(), anchor: null });
  history.replaceState(history.state, '', addressOf());   // filtered or ordered meanwhile: the address says so
  drawPicking();
}

function togglePick(book, e) {
  const at = shown.rows.indexOf(book), from = picking.anchor ? shown.rows.indexOf(picking.anchor) : -1;
  if (e?.shiftKey && at >= 0 && from >= 0) {
    for (const b of shown.rows.slice(Math.min(at, from), Math.max(at, from) + 1)) picking.ids.add(b.id);
  } else if (!picking.ids.delete(book.id)) picking.ids.add(book.id);
  picking.anchor = book;
  drawPicking();
}

function pickAll() {
  const all = shown.rows.length > 0 && shown.rows.every((b) => picking.ids.has(b.id));
  for (const b of shown.rows) if (all) picking.ids.delete(b.id); else picking.ids.add(b.id);
  drawPicking();
}

/** The marks on the books, and the bar of what to do with them. */
function drawPicking() {
  $('library').classList.toggle('picking', picking.on);
  for (const el of $('library').querySelectorAll('[data-id]')) {
    const on = picking.ids.has(el.dataset.id);
    el.classList.toggle('picked', on);
    if (picking.on) el.setAttribute('aria-pressed', String(on)); else el.removeAttribute('aria-pressed');
  }
  $('pickBtn').setAttribute('aria-pressed', String(picking.on));
  $('addBtn').hidden = picking.on;
  $('pickBar').hidden = !picking.on;
  if (!picking.on) return;
  const n = picking.ids.size;
  const all = shown.rows.length > 0 && shown.rows.every((b) => picking.ids.has(b.id));
  fill($('pickBar'),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Stop selecting'), title: t('Stop selecting'), onclick: closeLayer }, icon('x')),
    h('span', { class: 'pick-count', text: n ? t('{n} selected', { n }) : t('Select books') }),
    shown.rows.length > 0 && h('button', { class: 'link-btn', type: 'button', text: all ? t('None') : t('All {n}', { n: shown.rows.length }), onclick: pickAll }),
    h('button', { class: 'btn btn-primary', type: 'button', disabled: !n, onclick: () => openBulkEdit(pickedBooks()) }, icon('pencil'), t('Edit')));
}

/** A long press on a book starts selecting, with that book; Escape and Ctrl+A do what they do. */
function initPicking() {
  const library = $('library');
  let timer = null, from = null, swallow = false;
  const cancel = () => { clearTimeout(timer); timer = null; };
  library.addEventListener('pointerdown', (e) => {
    swallow = false;
    cancel();
    const el = e.target.closest('[data-id]');
    if (e.pointerType === 'mouse' || picking.on || !el) return;
    from = [e.clientX, e.clientY];
    timer = setTimeout(() => {
      timer = null;
      const book = books.find((b) => b.id === el.dataset.id);
      if (!book) return;
      swallow = true;   // the tap that ends the press is not also a tap on the book
      buzz();
      startPicking(book);
    }, 450);
  });
  library.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - from[0], e.clientY - from[1]) > 10) cancel(); });
  for (const type of ['pointerup', 'pointercancel']) library.addEventListener(type, cancel);
  window.addEventListener('scroll', cancel, { passive: true });
  library.addEventListener('click', (e) => { if (swallow) { swallow = false; e.preventDefault(); e.stopPropagation(); } }, true);
  // A long press on a cover would otherwise offer to save the picture.
  library.addEventListener('contextmenu', (e) => { if (timer || swallow || (picking.on && e.pointerType !== 'mouse')) e.preventDefault(); });
  $('pickBtn').addEventListener('click', () => (picking.on ? closeLayer() : startPicking()));
  document.addEventListener('keydown', (e) => {
    // Only while nothing is open over the shelf.
    if (!picking.on || document.body.classList.contains('locked') || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === 'Escape') closeLayer();
    else if (e.key.toLowerCase() === 'a' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); pickAll(); }
  });
}

/**
 * One sheet for all the books selected. Each part of it starts out changing nothing (it shows
 * how the books are now) and says when it would change something; only those parts are
 * applied. Lists, authors, categories and tags can be added to what the books have, taken
 * from it, or replace it. Undo puts every book back as it was.
 */
function openBulkEdit(chosen) {
  const n = chosen.length;
  const count = (test) => chosen.filter(test).length;
  /** How many of the books have each value: Map(value → n), most first. */
  const tally = (valuesOf) => {
    const map = new Map();
    for (const b of chosen) for (const v of new Set(valuesOf(b))) map.set(v, (map.get(v) || 0) + 1);
    return new Map([...map].sort((a, b) => b[1] - a[1]));
  };
  const chip = (text, have, pressed, onclick, extra = {}) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(pressed), onclick, ...extra },
    text, have > 0 && h('b', { text: String(have) }));

  // A part: a heading (with Reset, once it would change something, and where it applies, the
  // way it changes: add, remove or replace), its controls and a note.
  const part = (label, { modes = false } = {}) => {
    const p = { mode: 'add', controls: h('div'), note: h('p', { class: 'sheet-note', hidden: true }) };
    const seg = modes && h('div', { class: 'seg bulk-mode', role: 'group', 'aria-label': t('How') });
    const drawSeg = () => seg && seg.replaceChildren(...[['add', t('Add')], ['remove', t('Remove')], ['replace', t('Replace')]].map(([mode, name]) => h('button', {
      type: 'button', text: name, 'aria-pressed': String(p.mode === mode),
      onclick: () => { p.mode = mode; drawSeg(); p.draw?.(); },
    })));
    drawSeg();
    p.reset = h('button', { class: 'bulk-reset', type: 'button', text: t('Reset') });
    p.el = h('section', { class: 'bulk-part' }, h('div', { class: 'bulk-head' }, h('h3', { text: label }), p.reset, seg), p.controls, p.note);
    return p;
  };

  /** Choose one of these for all of them (or, with `none`, none of them). */
  const oneOf = (label, options, { name, has, set, none }) => () => {
    const p = part(label);
    let value = null;   // null: as they are; '' (with `none`): none of them
    p.draw = () => fill(p.controls, h('div', { class: 'chips' },
      options.map((option) => chip(name(option), count((b) => has(b, option)), value === option, () => { value = value === option ? null : option; p.draw(); })),
      none && chip(t('None'), count((b) => !options.some((option) => has(b, option))), value === '', () => { value = value === '' ? null : ''; p.draw(); })));
    p.draw();
    p.changed = () => value !== null;
    p.apply = (book) => set(book, value);
    return p;
  };

  // The lists of one either-or set: a book goes on the one chosen, and off the others.
  const setOfLists = (label, members, none) => oneOf(label, members.map((l) => l.id), {
    name: (id) => listName(listById(id)), has: (b, id) => !!shelves(b)[id], none,
    set: (book, id) => {
      const on = { ...shelves(book) };
      if (id) place(on, id); else for (const l of members) delete on[l.id];
      book.lists = on;
    },
  });

  /** Choose any of these chips to add, remove or be all there is. */
  const someOf = (label, options, { name = (v) => v, has, apply, after }) => () => {
    const p = part(label, { modes: true });
    const picked = new Set();
    let touched = false;
    p.draw = () => {
      fill(p.controls, h('div', { class: 'chips' }, options.map((option) => chip(name(option), count((b) => has(b, option)), picked.has(option), () => {
        if (!picked.delete(option)) picked.add(option);
        touched = true;
        p.draw();
      }))), after?.(p.mode, picked));
      p.note.hidden = p.mode !== 'replace';
      p.note.textContent = p.mode === 'replace' ? t('What isn’t chosen here is taken off.') : '';
    };
    p.draw();
    p.changed = () => (p.mode === 'replace' ? touched : picked.size > 0);
    p.apply = (book) => apply(book, p.mode, picked);
    return p;
  };

  /** Type names (comma between them) to add, remove or be all there is; those the books have are offered. */
  const someTyped = (label, { present, apply, suggest, note }) => () => {
    const p = part(label, { modes: true });
    const input = h('input', { autocomplete: 'off', autocapitalize: 'words', list: suggest.id, placeholder: t('Separate them with commas') });
    let touched = false;
    input.addEventListener('input', () => { touched = true; });
    const there = tally(present);
    const offered = h('div', { class: 'chips bulk-present' }, [...there].slice(0, 12).map(([value, have]) => chip(value, have, false, () => {
      const now = commaList(input.value);
      if (!now.some((v) => fold(v) === fold(value))) input.value = [...now, value].join(', ');
      touched = true;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, { title: t('{n} of these books', { n: have }) })));
    fill(p.controls, h('label', { class: 'field bulk-field' }, input), suggest, there.size > 0 && offered);
    p.draw = () => { p.note.textContent = note?.(p.mode) || ''; p.note.hidden = !p.note.textContent; };
    p.draw();
    p.changed = () => (p.mode === 'replace' ? touched : commaList(input.value).length > 0);
    p.apply = (book) => apply(book, p.mode, commaList(input.value));
    return p;
  };

  /** One text for all of them: what they share is filled in; ⊘ empties it for all. */
  const oneText = (label, key, { suggest, extra } = {}) => () => {
    const p = part(label);
    const values = new Set(chosen.map((b) => b[key] || ''));
    const shared = values.size === 1 ? [...values][0] : null;
    // Where they differ, the field says how: "Earthsea, on 2 of them", or "3 different".
    const said = [...values].filter(Boolean);
    const mixed = said.length === 1 ? t('{value}, on {n} of them', { value: said[0], n: count((b) => b[key] === said[0]) }) : t('{n} different', { n: said.length });
    let cleared = false;
    const input = h('input', { value: shared || '', autocomplete: 'off', autocapitalize: 'words', list: suggest?.id, placeholder: shared === null ? mixed : '' });
    // Only where any of them has one is there anything to empty.
    const clear = said.length === 0 ? null : h('button', { class: 'icon-btn bulk-clear', type: 'button', 'aria-pressed': 'false', 'aria-label': t('None, for all of them'), title: t('None, for all of them') }, icon('ban'));
    clear?.addEventListener('click', () => {
      cleared = !cleared;
      clear.setAttribute('aria-pressed', String(cleared));
      input.disabled = cleared;
      if (cleared) input.value = '';
      input.placeholder = cleared ? t('None, for all of them') : shared === null ? mixed : '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const extras = extra?.(input, () => cleared);
    fill(p.controls, h('div', { class: 'bulk-text' + (clear ? '' : ' alone') }, h('label', { class: 'field bulk-field' }, input), clear), suggest, extras?.el);
    const typed = () => input.value.replace(/\s+/g, ' ').trim();
    // Emptied where they all had the same: none for all of them. Left empty where they differ: as they are.
    p.changed = () => cleared || (shared !== null ? typed() !== shared : typed() !== '') || !!extras?.changed();
    p.apply = (book, i) => {
      const value = cleared ? '' : (shared !== null || typed()) ? typed() : book[key] || '';
      book[key] = value;
      extras?.apply(book, i, value);
    };
    return p;
  };

  const setList = (book, key, values) => { if (values.length || book[key]?.length) book[key] = values; };
  // A tag the booklog has as "spice-trade" is the same tag as "Spice trade".
  const tagKey = (tag) => fold(tag).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const sets = listSections().filter((s) => s.label && s.label !== READING);
  const loose = lists.filter((l) => !l.group);
  const host = booklogHost();
  const published = host ? count((b) => b.boeken || b.boekenWanted) : 0;

  const makers = [
    setOfLists(t('Reading status'), lists.filter((l) => l.group === READING), false),
    loose.length > 0 && someOf(t('Lists'), loose.map((l) => l.id), {
      name: (id) => listName(listById(id)), has: (b, id) => !!shelves(b)[id],
      // A list that asks for a note (lent to whom) asks it here too, for every book put on it.
      after: (mode, picked) => mode !== 'remove' && [...picked].map(listById).filter((l) => l?.noteLabel).map((l) => {
        const input = h('input', { value: notes[l.id] || '', autocomplete: 'off', autocapitalize: 'words' });
        input.addEventListener('input', () => { notes[l.id] = input.value.replace(/\s+/g, ' ').trim(); });
        return h('label', { class: 'field bulk-note' }, h('span', { text: show(l.noteLabel) }), input);
      }),
      apply: (book, mode, picked) => {
        const on = { ...shelves(book) };
        for (const l of loose) {
          const wanted = picked.has(l.id);
          if (mode === 'remove' ? wanted : mode === 'replace' && !wanted) delete on[l.id];
          else if (wanted) { place(on, l.id); if (notes[l.id]) on[l.id] = { ...on[l.id], note: notes[l.id] }; }
        }
        book.lists = on;
      },
    }),
    ...sets.map((s) => setOfLists(show(s.label), s.members, true)),
    oneText(t('Series'), 'series', {
      suggest: h('datalist', { id: 'bulkSeries' }, [...seriesMap().keys()].sort().map((value) => h('option', { value }))),
      // Books of one series, selected in the order they are shown, can be numbered in that order.
      extra: (input, cleared) => {
        if (n < 2) return null;
        const box = h('input', { type: 'checkbox' });
        const el = h('label', { class: 'bulk-check' }, box, h('span', { text: t('Number them 1 to {n}, in the order shown', { n }) }));
        const sync = () => { el.hidden = cleared() || !input.value.trim(); if (el.hidden) box.checked = false; };
        input.addEventListener('input', sync);
        sync();
        return {
          el, changed: () => box.checked,
          apply: (book, i, name) => {
            if (!name) Object.assign(book, { seriesNumber: null, seriesLabel: '' });
            else if (box.checked) Object.assign(book, { seriesNumber: i + 1, seriesLabel: '' });
          },
        };
      },
    }),
    someTyped(t('Authors'), {
      present: (b) => peopleOf(b).map((person) => person.name),
      suggest: h('datalist', { id: 'bulkPeople' }, [...new Set(books.flatMap((b) => peopleOf(b).map((person) => person.name)))].sort().map((value) => h('option', { value }))),
      note: (mode) => (mode === 'replace' ? t('Others with a role (translation, voice…) stay.') : ''),
      apply: (book, mode, names) => {
        const named = (person) => names.some((name) => fold(name) === fold(person.name));
        let people = peopleOf(book).map((person) => ({ ...person }));
        if (mode === 'add') people.push(...names.filter((name) => !people.some((person) => fold(person.name) === fold(name))).map((name) => ({ name, role: '' })));
        else if (mode === 'remove') people = people.filter((person) => !named(person));
        else people = [...names.map((name) => ({ name, role: '' })), ...people.filter((person) => !isWriter(person) && !named(person))];
        if (!people.length && book.boeken) return;   // a booklog book always has someone
        const asPeople = people.length > 0 && (people.some((person) => person.role) || Array.isArray(book.people));
        book.author = writersIn(people).join(', ');
        if (asPeople) book.people = people; else delete book.people;
      },
    }),
    oneText(t('Publisher'), 'publisher'),
    oneOf(t('Format'), FORMATS, {
      name: formatName, has: (b, format) => formatOf(b) === format,
      // As in a book's details: an audiobook has a length and no pages, the others pages.
      set: (book, format) => { book.format = format; if (format === 'audiobook') book.pages = null; else book.duration = ''; },
    }),
    oneOf(t('Language'), languageCodes(), { name: languageName, has: (b, code) => b.language === code, set: (book, code) => { book.language = code; } }),
    categoryNames().length > 0 && someOf(t('Categories'), categoryNames(), {
      has: (b, c) => (b.categories || []).includes(c),
      apply: (book, mode, picked) => {
        const now = book.categories || [];
        setList(book, 'categories', mode === 'add' ? [...new Set([...now, ...picked])] : mode === 'remove' ? now.filter((c) => !picked.has(c)) : [...picked]);
      },
    }),
    someTyped(t('Tags'), {
      present: (b) => b.tags || [],
      suggest: h('datalist', { id: 'bulkTags' }, tagNames().map((value) => h('option', { value }))),
      apply: (book, mode, tags) => {
        const now = book.tags || [], keys = new Set(tags.map(tagKey));
        setList(book, 'tags', mode === 'add' ? [...now, ...tags.filter((tag) => !now.some((x) => tagKey(x) === tagKey(tag)))]
          : mode === 'remove' ? now.filter((x) => !keys.has(tagKey(x))) : tags);
      },
    }),
  ].filter(Boolean);
  const notes = {};

  const parts = [];
  const mount = (i) => {
    const p = makers[i]();
    p.reset.addEventListener('click', () => { const fresh = mount(i); p.el.replaceWith(fresh.el); parts[i] = fresh; refresh(); });
    return p;
  };
  makers.forEach((make, i) => { parts[i] = mount(i); });

  const apply = h('button', { class: 'btn btn-primary', type: 'submit' });
  function refresh() {
    let any = false;
    for (const p of parts) { const changed = p.changed(); p.el.classList.toggle('changed', changed); any ||= changed; }
    apply.disabled = !any;
  }
  fill(apply, icon('check'), t('Change {books}', { books: plural(n, 'book') }));

  const titles = chosen.slice(0, 3).map(displayTitle).join(', ');
  const form = h('form', {
    class: 'bulk', novalidate: true, onsubmit: submit,
    // Every control redraws itself first; then the parts say whether they change anything.
    onclick: () => refresh(), oninput: () => refresh(),
  },
    sheetHead(t('Edit {books}', { books: plural(n, 'book') }), n > 3 ? t('{titles} and {n} more', { titles, n: n - 3 }) : titles),
    published > 0 && h('p', { class: 'sheet-note bulk-booklog', text: published === n
      ? t('These are on {host}: what changes is published there within a few minutes.', { host })
      : t('{n} of these are on {host}: what changes is published there within a few minutes.', { n: published, host }) }),
    parts.map((p) => p.el),
    h('div', { class: 'btn-row sheet-actions' },
      h('button', { class: 'btn btn-outline', type: 'button', text: t('Cancel'), 'data-cancel': true, onclick: () => sheet.close() }),
      apply));
  refresh();

  async function submit(e) {
    e.preventDefault();
    const active = parts.filter((p) => p.changed());
    if (!active.length) return;
    const before = new Map(chosen.map((b) => [b, JSON.stringify(b)]));
    chosen.forEach((book, i) => { for (const p of active) p.apply(book, i); });
    const changed = chosen.filter((b) => JSON.stringify(b) !== before.get(b));
    const unwanted = changed.length ? await saveBooks(changed) : 0;
    const said = changed.length
      ? [t('{books} changed', { books: plural(changed.length, 'book') }),
        unwanted > 0 && t('{n} won’t be added to {host}: no reading status.', { n: unwanted, host })].filter(Boolean).join(' · ')
      : t('Nothing to change: they already were like that.');
    // Done: the sheet closes, and so does selecting.
    closeLayersThen(() => toast(said, changed.length ? {
      action: t('Undo'), ms: 8000,
      onAction: async () => {
        for (const book of changed) {
          for (const key of Object.keys(book)) delete book[key];
          Object.assign(book, JSON.parse(before.get(book)));
        }
        await saveBooks(changed);
      },
    } : {}));
  }

  sheet.open(form);
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
    class: 'chip', type: 'button', text: listName(l), 'aria-pressed': String(!!on[l.id]),
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

/* ───────────────────────── The cover: seen large, and changed ─────────────────────────

   Tapping a cover (on a book's page, or in a form) opens it large, at the best size there is,
   and everything to replace it with is right there: the covers the catalogues have of its
   editions, a photo, a picture from the device or the clipboard, or a search on the web. A
   photo can be straightened: drag the four corners onto the book's. What is chosen becomes
   the cover as two things, a small copy that travels inside the book (`thumb`) or the
   catalogue's address (`cover`), and a large one the server keeps (`coverFull`), which is
   also what goes to the booklog. */

/**
 * A picture as a cover. → {thumb, ratio, large}: a small copy that travels inside the book (so
 * it shows at once, offline too), its proportions, and a larger one for the server to keep.
 * `source` is anything a canvas can draw, `width` × `height` its size.
 */
async function pictureOf(source, width, height) {
  const draw = (maxSide) => {
    const k = Math.min(1, maxSide / Math.max(width, height));
    const canvas = h('canvas', { width: Math.round(width * k), height: Math.round(height * k) });
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  };
  return {
    thumb: draw(300).toDataURL('image/jpeg', 0.72),
    ratio: Number((width / height).toFixed(3)),
    large: await new Promise((resolve) => draw(1600).toBlob(resolve, 'image/jpeg', 0.9)),
  };
}

/** Reads a pasted, dropped or chosen picture (a File or Blob). → pictureOf's answer, or null if it isn't a picture. */
async function readCover(file) {
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { return null; }
  const picture = await pictureOf(bitmap, bitmap.width, bitmap.height);
  bitmap.close?.();
  return picture;
}

/** A catalogue cover's address at its largest. */
function largeCover(url) {
  try {
    const u = new URL(url, document.baseURI);
    if (u.hostname === 'covers.openlibrary.org') return u.href.replace(/-[SM]\.jpg/, '-L.jpg');
    if (/^books\.google(usercontent)?\.com$/.test(u.hostname) && !u.searchParams.has('fife')) u.searchParams.set('fife', 'w1200');
    return u.href;
  } catch { return url || ''; }
}

/** The largest picture there is of a cover: the one you supplied, the booklog's own, or the catalogue's large size. */
function fullCover(subject) {
  if (subject.coverFull) return abs(subject.coverFull);
  if (subject.coverSource) return largeCover(subject.coverSource);
  if (/^https:/.test(subject.cover || '')) return largeCover(subject.cover);
  return subject.cover ? abs(subject.cover) : subject.thumb || '';
}

/** Is the cover a picture of your own (one a canvas may read, to straighten it)? */
const ownCover = (subject) => !!(subject.coverFull || (!subject.cover && subject.thumb) || String(subject.cover || '').startsWith('covers/own/'));

/** What a chosen cover makes of a book (or an edition): {picture} is one of your own, {url, ratio} a catalogue's. */
function coverFields(choice) {
  return choice.picture
    ? { thumb: choice.picture.thumb, cover: '', coverRatio: choice.picture.ratio, coverSource: '', coverFull: '' }
    : { cover: choice.url, coverSource: choice.url, coverRatio: choice.ratio || null, thumb: '', coverFull: '' };
}

/**
 * Hands the chosen cover to the server, which keeps it large and small; the book (or edition,
 * `target`) then points at the server's copies. A picture is sent; a catalogue cover, the
 * server fetches itself. Without an account or a connection the book keeps what it has (the
 * small copy, or the catalogue's address), and the server takes it from there on a later sync.
 */
async function keepCover(target, choice, book) {
  if (!sync.user || navigator.onLine === false) return;
  const still = () => books.includes(book) && (choice.picture ? target.thumb === choice.picture.thumb : target.coverSource === choice.url);
  try {
    if (!csrfToken()) await fetch(abs('api/session'), { credentials: 'same-origin', cache: 'no-store' });
    const sent = choice.picture
      ? { headers: { 'Content-Type': 'image/jpeg' }, body: choice.picture.large }
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: choice.url }) };
    if (choice.picture && !choice.picture.large) return;
    const res = await fetch(abs('api/cover'), {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', body: sent.body,
      headers: { ...sent.headers, 'X-CSRFToken': csrfToken() },
    });
    if (!res.ok || !still()) return;   // or the cover was changed again meanwhile
    const kept = await res.json();
    Object.assign(target, { cover: kept.cover, coverFull: kept.coverFull, coverRatio: kept.coverRatio });
    await saveBook(book);
  } catch (err) {
    console.warn('Cover not kept', err);
  }
}
const uploadCover = (target, picture, book) => keepCover(target, { picture }, book);

/**
 * The covers the catalogues have of a book: of its ISBN first, then of its other editions, by
 * title and author. → [{url, small}]: `url` is what the book keeps, `small` what is shown here.
 */
async function coverCandidates({ isbn, title, author }) {
  const who = String(author || '').split(',')[0].trim();
  const google = (q, max) => getJSON(googleUrl(q, max), 6000)
    .then((d) => (d.items || []).map((v) => v.volumeInfo?.imageLinks?.thumbnail).filter(Boolean)
      .map((u) => u.replace(/^http:/, 'https:').replace('&edge=curl', '')))
    .catch(() => []);
  const library = title
    ? getJSON(`https://openlibrary.org/search.json?title=${encodeURIComponent(title)}${who ? `&author=${encodeURIComponent(who)}` : ''}&limit=10&fields=cover_i`, 6000)
      .then((d) => (d.docs || []).filter((doc) => doc.cover_i).map((doc) => `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`))
      .catch(() => [])
    : [];
  const lists = await Promise.all([
    isbn ? [`https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`] : [],
    isbn ? google('isbn:' + isbn, 2) : [],
    title ? google(`intitle:${title}${who ? ` inauthor:${who}` : ''}`, 20) : [],
    library,
  ]);
  return [...new Set(lists.flat())].slice(0, 18).map((url) => ({ url, small: url }));
}

/* Straightening a photo: the four corners of the book, dragged into place on the picture, are
   pulled out into a rectangle (a perspective transform), as a scanner app does. */

/** The 3×3 transform (as 8 numbers) taking (u, v) in the w × h rectangle to the quadrilateral `quad` ([[x, y] × 4], clockwise from top left). */
function homography(w, h, quad) {
  const from = [[0, 0], [w, 0], [w, h], [0, h]];
  const a = [], b = [];
  from.forEach(([u, v], i) => {
    const [x, y] = quad[i];
    a.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
    a.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
  });
  // Gaussian elimination with partial pivoting.
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < 8; r++) {
      const f = a[r][c] / a[c][c];
      for (let k = c; k < 8; k++) a[r][k] -= f * a[c][k];
      b[r] -= f * b[c];
    }
  }
  const m = new Array(8).fill(0);
  for (let r = 7; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < 8; k++) s -= a[r][k] * m[k];
    m[r] = s / a[r][r];
  }
  return m;
}

/** The part of `bitmap` inside `quad` (in its pixels), as an upright rectangle on a canvas. */
function straighten(bitmap, quad) {
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  let w = Math.max(dist(quad[0], quad[1]), dist(quad[3], quad[2]));
  let hgt = Math.max(dist(quad[0], quad[3]), dist(quad[1], quad[2]));
  const k = Math.min(1, 1600 / Math.max(w, hgt));
  w = Math.max(1, Math.round(w * k)); hgt = Math.max(1, Math.round(hgt * k));
  const src = h('canvas', { width: bitmap.width, height: bitmap.height });
  const sctx = src.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(bitmap, 0, 0);
  const sw = src.width, sh = src.height, sp = sctx.getImageData(0, 0, sw, sh).data;
  const out = h('canvas', { width: w, height: hgt });
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, hgt), op = img.data;
  const [a, b, c, d, e, f, g, hh] = homography(w, hgt, quad);
  for (let v = 0; v < hgt; v++) {
    for (let u = 0; u < w; u++) {
      const z = g * u + hh * v + 1;
      const x = Math.min(sw - 1.001, Math.max(0, (a * u + b * v + c) / z));
      const y = Math.min(sh - 1.001, Math.max(0, (d * u + e * v + f) / z));
      const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      const o = (v * w + u) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const top = sp[i00 + ch] + (sp[i10 + ch] - sp[i00 + ch]) * fx;
        const bottom = sp[i01 + ch] + (sp[i11 + ch] - sp[i01 + ch]) * fx;
        op[o + ch] = top + (bottom - top) * fy;
      }
      op[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

let coverRoom = null;   // the cover, open large: while it is, pasting a picture is for it

/**
 * The cover, large, with what to replace it with.
 *  subject   () → what has the cover now (a book, an edition, or the choice not yet saved)
 *  query     {isbn, title, author}: what to look for in the catalogues
 *  onChoose  (choice) → called with {picture} or {url, ratio} when a new cover is used
 */
function openCoverRoom({ subject, query, onChoose }) {
  const current = subject();
  let choice = null;          // what is shown, when it isn't the current cover
  let shownOwn = ownCover(current);
  const picture = h('img', { class: 'room-picture', alt: '' });
  const stage = h('div', { class: 'room-stage', onclick: (e) => { if (e.target === picture) stage.classList.toggle('zoomed'); } }, picture);
  const caption = h('p', { class: 'room-caption' });
  const strip = h('div', { class: 'room-strip' });
  const stripNote = h('p', { class: 'room-note', text: t('Looking in the catalogues…') });
  const use = h('button', { class: 'btn btn-primary', type: 'button', disabled: true, onclick: () => { if (choice) { const c = choice; close(); onChoose(c); } } }, icon('check'), t('Use this cover'));
  const straightenBtn = h('button', { class: 'room-tool', type: 'button', onclick: () => startStraighten() }, icon('crop'), h('span', { text: t('Straighten') }));
  const tools = h('div', { class: 'room-tools' });
  const footer = h('div', { class: 'room-actions' });

  /** Show `large` (with `small` while it loads) and say how big it is. */
  function show(large, small) {
    stage.classList.remove('zoomed');
    straightenBtn.hidden = !shownOwn || !(large || small);
    caption.textContent = '';
    if (!large && !small) {
      stage.replaceChildren(h('div', { class: 'room-empty' }, coverEl(current, true)));
      caption.textContent = t('No cover yet');
      return;
    }
    if (picture.parentNode !== stage) stage.replaceChildren(picture);
    picture.src = small || large;
    if (large && large !== small) {
      const full = new Image();
      full.onload = () => { if (picture.dataset.want === large && full.naturalWidth > 8) picture.src = large; };
      full.src = large;
    }
    picture.dataset.want = large || small;
  }
  picture.addEventListener('load', () => { caption.textContent = `${picture.naturalWidth} × ${picture.naturalHeight}`; });

  function choose(next, large, small) {
    choice = next;
    shownOwn = !!next.picture;
    for (const tile of strip.children) tile.classList.toggle('on', !!next.url && tile.dataset.url === next.url);
    show(large, small);
    use.disabled = false;
  }
  const choosePicture = (pic) => { choose({ picture: pic }, URL.createObjectURL(pic.large), pic.thumb); };
  async function pick(file, straightenFirst) {
    const pic = file && await readCover(file);
    if (!pic) { toast(t('That picture couldn’t be opened')); return; }
    choosePicture(pic);
    if (straightenFirst) startStraighten();
  }

  // The current cover first, then what the catalogues have.
  const tile = (src, url, onPick, label) => {
    const img = h('img', { alt: '', loading: 'lazy' });
    const el = h('button', { class: 'room-tile', type: 'button', 'aria-label': label, title: label, onclick: onPick }, img);
    el.dataset.url = url;
    img.addEventListener('load', () => { if (img.naturalWidth < 8) el.remove(); else el.style.setProperty('--r', (img.naturalWidth / img.naturalHeight).toFixed(3)); });
    img.addEventListener('error', () => { el.remove(); if (!strip.querySelector('.room-tile')) stripNote.hidden = false; });
    img.src = src;
    return el;
  };
  const currentSmall = current.cover || current.thumb;
  if (currentSmall) {
    const el = tile(currentSmall, '', () => {
      choice = null; use.disabled = true; shownOwn = ownCover(current);
      for (const other of strip.children) other.classList.toggle('on', other === el);
      show(fullCover(current), currentSmall);
    }, t('The cover now'));
    el.classList.add('on', 'room-now');
    strip.append(el);
  }
  const have = new Set([current.cover, current.coverSource].filter(Boolean));
  coverCandidates(query).then((found) => {
    if (!coverRoom) return;
    const fresh = found.filter((c) => !have.has(c.url));
    stripNote.hidden = fresh.length > 0;
    if (!fresh.length) stripNote.textContent = t('The catalogues have no other covers of it.');
    for (const c of fresh) {
      const el = tile(c.small, c.url, () => {
        const img = el.querySelector('img');
        choose({ url: c.url, ratio: img.naturalWidth ? Number((img.naturalWidth / img.naturalHeight).toFixed(3)) : null }, largeCover(c.url), c.small);
      }, t('Another cover'));
      strip.append(el);
    }
  });

  // Other ways to a cover: a photo, a picture, the clipboard, the web.
  const camera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; pick(f, true); } });
  const chooser = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; pick(f, false); } });
  const q = [query.title, String(query.author || '').split(',')[0]].filter(Boolean).join(' ');
  fill(tools,
    h('button', { class: 'room-tool', type: 'button', onclick: () => camera.click() }, icon('camera'), h('span', { text: t('Take a photo') })),
    h('button', { class: 'room-tool', type: 'button', onclick: () => chooser.click() }, icon('image'), h('span', { text: t('Choose a picture') })),
    navigator.clipboard?.read && h('button', {
      class: 'room-tool', type: 'button',
      onclick: async () => {
        try {
          for (const item of await navigator.clipboard.read()) {
            const type = item.types.find((kind) => kind.startsWith('image/'));
            if (type) { pick(await item.getType(type)); return; }
          }
          toast(t('There is no picture on the clipboard'));
        } catch { toast(t('Couldn’t reach the clipboard')); }
      },
    }, icon('copy'), h('span', { text: t('Paste') })),
    q && h('a', { class: 'room-tool', target: '_blank', rel: 'noopener', href: `https://www.google.com/search?tbm=isch&tbs=isz:l&q=${encodeURIComponent(q)}` },
      icon('search'), h('span', { text: t('Search the web') })),
    straightenBtn,
    camera, chooser);

  const normalFooter = () => fill(footer, h('button', { class: 'btn btn-outline', type: 'button', text: t('Cancel'), 'data-cancel': true, onclick: close }), use);

  /* Straightening: the picture with a frame of four corners to drag onto the book's. */
  async function startStraighten() {
    let bitmap;
    try {
      const blob = choice?.picture ? choice.picture.large : await fetch(fullCover(current)).then((r) => r.blob());
      bitmap = await createImageBitmap(blob);
    } catch { toast(t('That picture couldn’t be opened')); return; }
    const k = 0.07;
    const quad = [[k, k], [1 - k, k], [1 - k, 1 - k], [k, 1 - k]].map(([x, y]) => [x * bitmap.width, y * bitmap.height]);
    const base = h('canvas', { class: 'room-crop-image', width: bitmap.width, height: bitmap.height });
    base.getContext('2d').drawImage(bitmap, 0, 0);
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'room-crop-frame');
    svg.setAttribute('viewBox', `0 0 ${bitmap.width} ${bitmap.height}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    const shade = document.createElementNS(SVG_NS, 'path');
    shade.setAttribute('class', 'room-crop-shade');
    shade.setAttribute('fill-rule', 'evenodd');
    const edge = document.createElementNS(SVG_NS, 'polygon');
    edge.setAttribute('class', 'room-crop-edge');
    svg.append(shade, edge);
    const handles = quad.map((_, i) => h('span', { class: 'room-handle', 'aria-hidden': 'true', 'data-i': i }));
    const frame = h('div', { class: 'room-crop', style: `--r:${(bitmap.width / bitmap.height).toFixed(4)}` }, base, svg, handles);
    const redraw = () => {
      const pts = quad.map((p) => p.join(',')).join(' ');
      edge.setAttribute('points', pts);
      shade.setAttribute('d', `M0 0H${bitmap.width}V${bitmap.height}H0Z M${quad.map((p) => p.join(' ')).join(' L')} Z`);
      handles.forEach((el, i) => { el.style.left = `${(quad[i][0] / bitmap.width) * 100}%`; el.style.top = `${(quad[i][1] / bitmap.height) * 100}%`; });
    };
    frame.addEventListener('pointerdown', (e) => {
      const box = frame.getBoundingClientRect();
      const at = (ev) => [((ev.clientX - box.left) / box.width) * bitmap.width, ((ev.clientY - box.top) / box.height) * bitmap.height];
      const [px, py] = at(e);
      // The corner nearest to where the finger went down follows it.
      let i = 0, best = Infinity;
      quad.forEach(([x, y], n) => { const d = Math.hypot((x - px) / bitmap.width * box.width, (y - py) / bitmap.height * box.height); if (d < best) { best = d; i = n; } });
      if (best > 60) return;
      e.preventDefault();
      frame.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const [x, y] = at(ev);
        quad[i] = [Math.min(bitmap.width, Math.max(0, x)), Math.min(bitmap.height, Math.max(0, y))];
        redraw();
      };
      const up = () => { frame.removeEventListener('pointermove', move); frame.removeEventListener('pointerup', up); frame.removeEventListener('pointercancel', up); };
      frame.addEventListener('pointermove', move);
      frame.addEventListener('pointerup', up);
      frame.addEventListener('pointercancel', up);
      move(e);
    });
    redraw();
    room.classList.add('cropping');
    stage.replaceChildren(frame);
    caption.textContent = t('Drag the corners onto the corners of the book.');
    const done = () => { room.classList.remove('cropping'); stage.replaceChildren(picture); normalFooter(); };
    fill(footer,
      h('button', { class: 'btn btn-outline', type: 'button', text: t('Cancel'), 'data-cancel': true, onclick: () => { done(); caption.textContent = picture.naturalWidth ? `${picture.naturalWidth} × ${picture.naturalHeight}` : ''; } }),
      h('button', {
        class: 'btn btn-primary', type: 'button',
        onclick: async () => {
          const out = straighten(bitmap, quad);
          done();
          choosePicture(await pictureOf(out, out.width, out.height));
        },
      }, icon('crop'), t('Straighten')));
  }

  const room = h('div', {
    class: 'cover-room', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('Cover'),
    ondragover: (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); },
    ondrop: (e) => { const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/')); if (file) { e.preventDefault(); pick(file); } },
  },
    h('div', { class: 'room-bar' },
      h('h2', { class: 'room-title', text: query.title || t('Cover') }),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Close'), onclick: close }, icon('x'))),
    stage, caption,
    h('div', { class: 'room-change' },
      h('h3', { text: t('Other covers') }),
      strip, stripNote,
      tools,
      h('p', { class: 'room-note', text: t('A picture can also be pasted or dropped here.') })),
    footer);
  normalFooter();
  show(fullCover(current), currentSmall);

  const onPaste = (e) => {
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); pick(file); }
  };
  function close() { closeLayer(); }
  document.body.append(room);
  document.addEventListener('paste', onPaste);
  coverRoom = room;
  requestAnimationFrame(() => room.classList.add('open'));
  openLayer(() => {
    document.removeEventListener('paste', onPaste);
    if (coverRoom === room) coverRoom = null;
    room.classList.remove('open');
    setTimeout(() => room.remove(), 220);
  });
}

/**
 * The cover of a book, or of one edition of it, in a form: a button that opens it large, with
 * what to replace it with (openCoverRoom). A picture can also be pasted (while no text field
 * has the cursor) or dropped on the form. `subject()` is what to draw; `host()` the form it
 * sits in, for as long as pasting applies; `query()` what to look for in the catalogues.
 * → {button, pick, pictureIn, choice}: `choice` is the new cover, once there is one.
 */
function coverControl(subject, host, query) {
  const control = { choice: null };
  const shown = () => (control.choice ? { ...subject(), ...coverFields(control.choice) } : subject());
  const draw = () => control.button.replaceChildren(coverEl(shown(), true), h('span', { class: 'cover-pick-badge' }, icon('camera')));
  control.button = h('button', {
    class: 'cover-pick', type: 'button', title: t('Change the cover'), 'aria-label': t('Change the cover'),
    onclick: () => openCoverRoom({ subject: shown, query: query(), onChoose: (choice) => { control.choice = choice; draw(); } }),
  });
  control.pick = async (file) => {
    const read = file && await readCover(file);
    if (!read) { toast(t('That picture couldn’t be opened')); return; }
    control.choice = { picture: read };
    draw();
  };
  control.pictureIn = (transfer) => [...(transfer?.files || [])].find((file) => file.type.startsWith('image/'));
  const onPaste = (e) => {
    if (!host()?.isConnected) { document.removeEventListener('paste', onPaste); return; }
    if (coverRoom) return;   // the open cover takes it
    const focus = document.activeElement;
    if (focus?.tagName === 'TEXTAREA' || (focus?.tagName === 'INPUT' && focus.type !== 'file')) return;   // the text field gets it
    const file = control.pictureIn(e.clipboardData);
    if (!file) return;
    e.preventDefault();
    control.pick(file);
  };
  document.addEventListener('paste', onPaste);
  draw();
  return control;
}

/** A book's cover on its page: tap it to see it large, and to change it there. */
function coverViewer(book, again) {
  const open = () => openCoverRoom({
    subject: () => book,
    query: { isbn: book.isbn, title: book.title, author: book.author },
    onChoose: (choice) => {
      const keys = ['cover', 'thumb', 'coverRatio', 'coverSource', 'coverFull'];
      const before = Object.fromEntries(keys.map((key) => [key, book[key]]));
      Object.assign(book, coverFields(choice));
      saveBook(book);
      keepCover(book, choice, book);
      if (openedBook === book && bookPageOpen()) again();
      toast(t('Cover replaced'), {
        action: t('Undo'),
        onAction: () => { Object.assign(book, before); saveBook(book); if (openedBook === book && bookPageOpen()) again(); },
      });
    },
  });
  const el = h('button', { class: 'cover-view', type: 'button', title: t('The cover, large'), 'aria-label': t('The cover, large'), onclick: open }, coverEl(book, true));
  el.open = open;
  return el;
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
    duration: input('duration', { placeholder: '11u 36m' }),
    isbn: input('isbn', { inputmode: 'numeric' }),
    series: input('series', { autocapitalize: 'words', list: 'seriesNames' }),
    seriesNumber: h('input', { name: 'seriesNumber', value: seriesNo(book), inputmode: 'decimal', autocomplete: 'off', placeholder: '1' }),
  };
  const seriesNames = h('datalist', { id: 'seriesNames' }, [...seriesMap().keys()].sort().map((value) => h('option', { value })));
  f.title.value = book.title || '';
  // Who made it: a row each. `f.author` is the first name, which the cover's text and Swap fill.
  const who = peopleEditor(peopleOf(book));
  Object.defineProperty(f, 'author', { get: () => who.first });
  f.title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); f.author.focus(); } });
  const field = (label, control) => h('label', { class: 'field' }, h('span', { text: label }), control);
  // Paper, e-book or audiobook; an audiobook has a length where the others have pages.
  const format = formatPicker(formatOf(book));
  const extent = { pages: field(t('Pages'), f.pages), duration: field(t('Length'), f.duration) };
  const showExtent = () => { extent.duration.hidden = format.value !== 'audiobook'; extent.pages.hidden = format.value === 'audiobook'; };
  format.onChange = showExtent;
  showExtent();
  // What it is in and about. A booklog book always says its language (its post does).
  const language = oneChip(languageCodes(), book.language, languageName);
  const categories = someChips(categoryNames(), book.categories || []);
  const tags = h('input', { name: 'tags', value: (book.tags || []).join(', '), autocomplete: 'off', autocapitalize: 'off', list: 'tagNames' });
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
  const cover = coverControl(() => book, () => form, () => ({ isbn: f.isbn.value.replace(/[^0-9Xx]/g, '') || book.isbn, title: f.title.value.trim() || book.title, author: writersIn(who.value()).join(', ') || book.author }));

  const form = h('form', {
    novalidate: true, onsubmit: submit,
    ondragover: (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); },
    ondrop: (e) => { const file = cover.pictureIn(e.dataTransfer); if (file) { e.preventDefault(); cover.pick(file); } },
  },
    sheetHead(heading || (isNew ? t('New book') : t('Edit book')), subheading || null, cover.button),
    source,
    ocrBox,
    field(t('Title'), f.title),
    h('div', { class: 'field' }, h('span', { text: t('Authors and others') }), who.el),
    h('p', { class: 'sheet-note people-hint', text: t('No role for an author. For anyone else, what they did: beeld, kleur, stem, vertaling…') }),
    swap,
    field(t('Publisher'), f.publisher),
    h('div', { class: 'field' }, h('span', { text: t('Format') }), format.el),
    h('div', { class: 'field-row' }, field(t('Published'), f.date), extent.pages, extent.duration),
    field('ISBN', f.isbn),
    h('div', { class: 'field-row series-fields' }, field(t('Series'), f.series), field(t('Number'), f.seriesNumber)),
    seriesNames,
    h('div', { class: 'field' }, h('span', { text: t('Language') }), language.el),
    (categories.value.size > 0 || categoryNames().length > 0) && h('div', { class: 'field' }, h('span', { text: t('Categories') }), categories.el),
    field(t('Tags'), tags),
    h('datalist', { id: 'tagNames' }, tagNames().map((value) => h('option', { value }))),
    lists.length > 0 && h('div', { class: 'sheet-section form-lists' }, h('h3', { text: t('Lists') }), listPicker(on)),
    error,
    h('div', { class: 'btn-row sheet-actions' },
      !isNew && h('button', { class: 'btn btn-quiet btn-danger', type: 'button', 'aria-label': t('Delete book'), onclick: remove }, icon('trash')),
      h('button', { class: 'btn btn-outline', type: 'button', text: t('Cancel'), 'data-cancel': true, onclick: leave }),
      h('button', { class: 'btn btn-primary', type: 'submit' }, icon('check'), isNew ? t('Add to shelf') : t('Save'))));

  async function submit(e) {
    e.preventDefault();
    const v = (k) => f[k].value.replace(/\s+/g, ' ').trim();
    // A book from the booklog always has someone; emptied here, it keeps who it had.
    const people = who.value().length || !book.boeken ? who.value() : peopleOf(book);
    // Said as people where someone has a role (or it was already said so); a book of writers alone just names them.
    const asPeople = people.length > 0 && (people.some((person) => person.role) || Array.isArray(book.people));
    const data = {
      title: v('title'), author: writersIn(people).join(', '), publisher: v('publisher'), date: normDate(v('date')),
      pages: parseInt(v('pages'), 10) > 0 ? parseInt(v('pages'), 10) : null,
      isbn: toIsbn13(v('isbn')) || v('isbn').replace(/[^0-9Xx]/g, ''),
      format: format.value,
      language: language.value || (book.boeken ? book.language || '' : ''),
      categories: [...categories.value], tags: commaList(tags.value),
      lists: {},
      series: v('series'), seriesNumber: null, seriesLabel: '',
      // A new cover: the small copy is the cover until the server has kept the larger one.
      ...(cover.choice && coverFields(cover.choice)),
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
    // An audiobook has a length and no pages; said to be paper or an e-book, pages and no length.
    if (format.value === 'audiobook') Object.assign(data, { pages: null, duration: v('duration').toLowerCase().replace(/h/g, 'u') });
    else if (format.value) data.duration = '';
    if (format.value === 'audiobook' && data.duration && minutesOf(data.duration) == null) {
      error.textContent = t('Give the length like 11u 36m.');
      error.hidden = false;
      f.duration.focus();
      return;
    }
    if (!data.title) {
      error.textContent = t('A book needs at least a title.');
      error.hidden = false;
      f.title.focus();
      return;
    }
    let result = book;
    if (isNew) {
      result = await addBook({ ...book, ...data, ...(asPeople && { people }) });
      rememberTarget(Object.keys(data.lists));
    } else {
      Object.assign(book, data, { pending: false, unresolved: false });
      if (asPeople) book.people = people; else delete book.people;
      await saveBook(book);
    }
    saved = true;
    if (cover.choice) keepCover(result, cover.choice, result);
    leave();
    onSaved?.(result);
  }

  function remove() {
    confirmDelete(book, () => openBookForm({ book, isNew, ocrLines, heading, subheading, onSaved, onClose, back }));
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
function sourceNote(book, explain, again) {
  if (!book.boeken || !book.url) return again ? addToBooklog(book, again) : null;
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

/* Adding a book: the ways there are, to choose from. The same choice, without the barcode,
   is behind "No barcode?" in the scanner. */

/** The lists a book added now goes on: those the last book added went on, however it was added
    (the library, the first time). Adding a pile of books, they mostly go to the same place. */
const addTarget = () => store.get('scanTarget', ['library']).filter(listById);

/** A book was added on these lists: the next one goes there too, in the scanner as well. */
function rememberTarget(ids) {
  const target = ids.filter(listById);
  store.set('scanTarget', target);
  if (scanner.open) { scanner.target = target; renderScanTarget(); }
}

function openAdd(inScanner = false) {
  const way = (name, title, about, go) => h('button', { class: 'way', type: 'button', onclick: go },
    icon(name), h('span', { class: 'way-text' }, h('span', { text: title }), h('small', { text: about })), icon('chevron'));
  const assistant = sync.user && sync.assistant;
  sheet.open(h('div', null,
    inScanner ? sheetHead(t('No barcode?'), t('Other ways to add this book.')) : sheetHead(t('Add a book')),
    h('div', { class: 'ways' },
      !inScanner && way('barcode', t('Scan the barcode'), t('On the back cover. The quickest way.'),
        () => closeLayersThen(() => openScanner())),
      way('camera', t('Photograph the cover'), t('Its front cover is read and looked up.'),
        inScanner ? () => { sheet.close(); setMode('cover'); } : () => closeLayersThen(() => openScanner('cover'))),
      assistant && way('sparkles', t('Describe it'), t('A title, an author, a series, in your own words: the assistant finds the book.'),
        () => closeLayersThen(() => openDescribe())),
      !inScanner && way('keyboard', t('Type the ISBN'), t('The digits above the barcode or on the copyright page.'),
        () => closeLayersThen(() => { openScanner(); openIsbnSheet(); })),
      way('pencil', t('Fill it in by hand'), t('For a book no catalogue knows.'),
        () => { if (!inScanner) scanner.target = addTarget(); manualEntry(inScanner ? scanner.pendingIsbn : ''); }))));
}

/* The assistant: a few words about a book → proposals to add */

/** The books on the shelf that are this one (as the assistant proposed it): the same ISBN, or title and first author. */
const sameBooks = (p) => books.filter((b) => (p.isbn && b.isbn === p.isbn)
  || (fold(b.title) === fold(p.title) && fold(b.author).split(',')[0].trim() === fold(p.author || '').split(',')[0].trim()));

/** Is this book (as the assistant proposed it) on the shelf already? Not when what you have is
    another version of it: the e-book, where this is the audiobook. */
function onShelfAlready(p) {
  return sameBooks(p).find((b) => !formatOf(p) || !formatOf(b) || formatOf(b) === formatOf(p));
}

/** The book on the shelf that this one is another version of (you have the e-book; this is the audiobook), or undefined. */
const versionOfShelf = (p) => !onShelfAlready(p) && sameBooks(p).find((b) => formatOf(b) && formatOf(p) && formatOf(b) !== formatOf(p));

/**
 * `shared`: {text, url} from another app; the search then starts by itself.
 * `found`: {books, thumb, isbn, onClose(saved), byHand()} from the scanner, where the assistant
 * looked at a photographed cover: its proposals are shown at once, to confirm or correct.
 */
function openDescribe(shared, found) {
  const host = booklogHost();
  const words = h('textarea', { name: 'text', rows: found ? 2 : 3, autocapitalize: 'sentences', enterkeyhint: 'search' });
  words.value = found ? [found.books[0].title, found.books[0].author].filter(Boolean).join(', ')
    : [shared?.text, shared?.url].filter(Boolean).join('\n');
  const on = found ? targetLists() : placed(addTarget());
  const error = h('p', { class: 'field-error', hidden: true });
  const find = h('button', { class: `btn ${found ? 'btn-outline' : 'btn-primary'} btn-block`, type: 'submit' }, icon('sparkles'), t('Find'));
  const results = h('div', { class: 'proposals' });
  const hasStatus = () => lists.some((l) => l.group === READING && on[l.id]);
  // One book seen on a photograph: until its catalogue cover is known, the photograph shows it.
  const photo = found && found.books.length === 1 && !found.books[0].cover ? { thumb: found.thumb } : null;
  let proposals = (found?.books || []).map((p) => ({ ...p, ...photo, picked: !onShelfAlready(p) })), toBooklog = true, saved = false;

  function drawResults() {
    const picked = proposals.filter((p) => p.picked);
    const row = (p) => {
      const there = onShelfAlready(p), other = !there && versionOfShelf(p);
      const box = h('input', { type: 'checkbox', checked: p.picked, disabled: !!there, onchange: () => { p.picked = box.checked; drawResults(); } });
      return h('label', { class: 'proposal' + (there ? ' is-there' : '') },
        box, coverEl(p),
        h('div', { class: 'book-text' },
          h('div', { class: 'book-title', text: p.title }),
          h('div', { class: 'book-author', text: [p.author, seriesLine(p)].filter(Boolean).join(' · ') }),
          h('div', { class: 'book-meta', text: there ? t('Already on your shelf') : metaLine(p) }),
          other && h('div', { class: 'book-meta', text: t('Another version: you have it as {format}', { format: formatName(formatOf(other)).toLowerCase() }) }),
          p.note && h('p', { class: 'card-excerpt', text: p.note }),
          h('div', { class: 'book-tags' }, [...(p.categories || []), ...(p.tags || [])].map((text) => h('span', { class: 'tag', text })))));
    };
    const booklog = host && h('label', { class: 'check-line' },
      h('input', { type: 'checkbox', checked: toBooklog, onchange: (e) => { toBooklog = e.target.checked; } }),
      h('span', { text: t('Also add to {host}', { host }) }));
    fill(results,
      ...proposals.map(row),
      proposals.length > 0 && hasStatus() && booklog,
      proposals.length > 0 && h('button', { class: 'btn btn-primary btn-block', type: 'button', disabled: !picked.length, onclick: add },
        icon('check'), t('Add {n}', { n: plural(picked.length, 'book') })),
      found && h('button', { class: 'btn btn-outline btn-block', type: 'button', onclick: found.byHand }, icon('pencil'), t('None of these — enter it myself')));
  }

  async function search(e) {
    e.preventDefault();
    const text = words.value.trim();
    if (!text) { error.textContent = t('Describe the book first.'); error.hidden = false; words.focus(); return; }
    error.hidden = true;
    find.disabled = true;
    results.replaceChildren(h('div', { class: 'card-busy' }, h('div', { class: 'spinner' }), h('div', { text: t('Looking…') })));
    try {
      // A web address in it is the page the book was seen on: the server looks there for its ISBN.
      const url = (text.match(/https:\/\/\S+/) || [])[0] || '';
      const said = text.replace(url, '').trim();
      let res;
      if (sync.user) res = await api('suggest', { text: said, url });
      else {
        // Without an account there is no assistant, but an ISBN can still be looked up from here.
        const isbn = (text.match(/97[89](?:[-\s]?\d){10}/g) || []).map(toIsbn13).find(Boolean);
        const found = isbn && await lookupIsbn(isbn);
        if (!found || found.status !== 'found') throw Object.assign(new Error(t('Sign in to add books from a description.')), { status: 1 });
        res = { books: [{ ...found.book, isbn }] };
      }
      proposals = (res.books || []).map((p) => ({ ...p, picked: !onShelfAlready(p) }));
      drawResults();
      if (!proposals.length) results.replaceChildren(h('p', { class: 'sheet-note', text: t('No books recognised in that.') }));
    } catch (err) {
      results.replaceChildren();
      error.textContent = err.status ? err.message : t('Couldn’t reach the server. Are you online?');
      error.hidden = false;
    } finally {
      find.disabled = false;
    }
  }

  async function add() {
    const picked = proposals.filter((p) => p.picked && !onShelfAlready(p));
    for (const { picked: _, note, ...p } of picked) {
      const book = { ...p, pages: p.pages ?? null, lists: placed(Object.keys(on)) };
      // From a photograph of one book: that photograph is its cover until a better one is found,
      // and a barcode that was scanned first but found nowhere is its ISBN.
      if (found && picked.length === 1) Object.assign(book, { thumb: found.thumb }, found.isbn && { isbn: found.isbn });
      if (found && !book.format) book.format = 'paper';   // photographed: a paper book in the hand
      // Another version of a book you have (its audiobook): a book of its own, which in the booklog
      // is a reread of that one. Its series is the one you know it by, not the store's name for
      // it; what else the find left out, the book you have says.
      const other = versionOfShelf(book);
      if (other) {
        book.versionOf = other.id;
        if (other.series) Object.assign(book, { series: other.series, seriesNumber: other.seriesNumber ?? null, seriesLabel: other.seriesLabel || '' });
        for (const key of ['language', 'categories', 'tags']) {
          const missing = book[key] == null || book[key] === '' || (Array.isArray(book[key]) && !book[key].length);
          if (missing && other[key] != null && other[key] !== '') book[key] = structuredClone(other[key]);
        }
      }
      // The one dry sentence is the book's note: the text of its page in the booklog until it is reviewed.
      if (note) book.reviews = [{ id: newId(), date: '', rating: null, text: note }];
      // The booklog takes a book that has a reading status, a language and a category; the rest waits on its page.
      if (host && toBooklog && hasStatus() && p.language && p.categories?.length) book.boekenWanted = true;
      const added = await addBook(book);
      // The photograph, larger, for the server to keep: it can be straightened later.
      if (!added.cover && added.thumb && found?.canvas && found.thumb === added.thumb) {
        found.canvas.toBlob((large) => large && uploadCover(added, { thumb: added.thumb, large }, added), 'image/jpeg', 0.9);
      }
    }
    saved = picked.length > 0;
    if (saved) rememberTarget(Object.keys(on));
    sheet.close();
    toast(t('{n} added', { n: plural(picked.length, 'book') }));
  }

  const head = found ? sheetHead(t('Is this the book?'), t('This is what the assistant makes of the cover.'))
    : sheetHead(shared ? t('Add what was shared') : t('Add by description'), t('A title, an author, a series, in your own words. One book or several.'));
  const onLists = h('div', { class: found ? 'sheet-section' : 'sheet-section describe-lists' }, h('h3', { text: t('Put them on') }), listPicker(on, { notes: false }));
  const form = h('form', { novalidate: true, onsubmit: search, class: found ? 'sheet-section' : null },
    found && h('h3', { text: t('Not the right book? Say it in words') }),
    h('label', { class: 'field' }, words),
    error,
    !found && onLists,
    find);
  // From a photograph the answer comes first; from words, the question.
  sheet.open(h('div', null, head, found ? [results, onLists, form] : [form, results]), found && (() => found.onClose(saved)));
  if (found) drawResults();
  else if (shared) form.requestSubmit();
  else words.focus();
}

/* A book by its address: #/book/<slug>, where the slug is that of its page in the booklog.
   The booklog's own [edit] link on a book's page comes in this way. */

/** The book a booklog page (its slug) is about: any read of it will do. */
function bookBySlug(slug) {
  // A few slugs are themselves percent-encoded (%ce%b2ehemoth), and an address may or may not
  // have been decoded on its way here: compare both in one spelling.
  const plain = (s) => { try { return decodeURIComponent(s || ''); } catch { return s || ''; } };
  const wanted = plain(slug);
  return books.find((b) => plain(b.boeken) === wanted || (b.reviews || []).some((r) => r.boeken && plain(r.boeken) === wanted));
}

/** Opens the book the address names, if it names one. `retry`: the shelf may not have synced it yet. */
async function openLinkedBook(retry = true) {
  const match = location.hash.match(/^#\/book\/([^/?#]+)\/?$/);
  if (!match) return;
  let slug = match[1];
  try { slug = decodeURIComponent(slug); } catch {}
  let book = bookBySlug(slug);
  if (!book && retry && sync.user && navigator.onLine !== false) {
    await runSync();
    book = bookBySlug(slug);
  }
  // The address has done its work: Back from the book's page goes to the shelf, not to it again.
  history.replaceState(history.state, '', location.pathname + location.search);
  if (book) openBook(book, null);
  else if (!sync.user) toast(t('Sign in to open that book'), { action: t('Sign in'), onAction: openSettings, ms: 8000 });
  else toast(t('That book isn’t on your shelf'));
}

/* What another app shares to this one (see share_target in the manifest and sw.js) */

/** Picks up what the service worker kept. → {title, text, url, picture} or null */
async function takeShare() {
  if (!new URLSearchParams(location.search).has('shared') || !('caches' in window)) return null;
  history.replaceState(history.state, '', location.pathname + location.hash);
  try {
    const cache = await caches.open('bookscan-share-v1');
    const said = await cache.match('shared');
    if (!said) return null;
    const share = await said.json();
    const picture = await cache.match('shared-picture');
    if (picture) share.picture = await picture.blob();
    await Promise.all([cache.delete('shared'), cache.delete('shared-picture')]);
    return Date.now() - share.at < 10 * 60 * 1000 ? share : null;   // not something left over from another day
  } catch { return null; }
}

/**
 * A picture becomes the cover of a book you pick. A page of the booklog opens that book.
 * Anything else (a bookshop's page, a line of text) is looked up and proposed for adding.
 */
function handleShare(share) {
  if (share.picture) { openCoverFor(share.picture); return; }
  const url = share.url || (String(share.text).match(/https?:\/\/\S+/) || [])[0] || '';
  const host = booklogHost();
  if (url && host) {
    try {
      const page = new URL(url);
      const slug = page.host === host && (page.pathname.match(/^\/\d{4}\/\d{2}\/([^/]+)\/?$/) || [])[1];
      const book = slug && books.find((b) => b.boeken === slug || (b.reviews || []).some((r) => r.boeken === slug));
      if (book) { openBook(book, null); return; }
    } catch {}
  }
  const text = [share.title, share.text].filter(Boolean).join('\n').replace(url, '').trim();
  if (text || url) openDescribe({ text, url: url.startsWith('https://') ? url : '' });
}

/** A shared picture: choose the book, and for a book read in several editions the read, it is the cover of. */
async function openCoverFor(blob) {
  const picture = await readCover(blob);
  if (!picture) { toast(t('That picture couldn’t be opened')); return; }
  const search = h('input', { type: 'search', placeholder: t('Search your shelf'), autocomplete: 'off', enterkeyhint: 'search' });
  const results = h('div', { class: 'cand-list' });

  async function put(book, review) {
    const fields = { thumb: picture.thumb, cover: '', coverRatio: picture.ratio, coverFull: '' };
    if (review) review.edition = { ...(review.edition || {}), ...fields };
    else Object.assign(book, fields, { coverSource: '' });
    await saveBook(book);
    uploadCover(review ? review.edition : book, picture, book);
    sheet.close();
    toast(t('Cover replaced'));
  }
  function choose(book) {
    const reads = sortedReviews(book).filter((r) => r.date);
    if (reads.length < 2) { put(book, null); return; }
    // Read in more than one edition: whose cover is it?
    results.replaceChildren(
      h('p', { class: 'sheet-note', text: t('This book was read more than once. Which edition is this the cover of?') }),
      ...reads.map((r) => h('button', { class: 'btn btn-outline btn-block', type: 'button', onclick: () => put(book, r) },
        [longDate(r.date), r.edition && editionLine(r.edition)].filter(Boolean).join(' — '))));
    search.hidden = true;
  }
  function draw() {
    const query = fold(search.value.trim());
    // Searching also reads reviews, so a book whose title or author has the words comes before
    // one that merely mentions them.
    const rank = (b) => (fold(b.title).includes(query) ? 0 : fold(`${b.author} ${b.series || ''}`).includes(query) ? 1 : 2);
    const found = (query
      ? books.filter((b) => searchText(b).includes(query)).sort((a, b) => rank(a) - rank(b))
      : [...books].sort((a, b) => ((a.modified || a.added) < (b.modified || b.added) ? 1 : -1))).slice(0, 30);
    fill(results, ...found.map((b) => { const row = bookRow(b, choose); row.classList.add('cand'); return row; }),
      !found.length && h('p', { class: 'no-results', text: t('No books match that search.') }));
  }
  search.addEventListener('input', draw);
  draw();
  sheet.open(h('div', null,
    sheetHead(t('Whose cover is this?'), t('Pick the book this picture is the cover of.'), coverEl({ title: '', thumb: picture.thumb, coverRatio: picture.ratio }, true)),
    h('label', { class: 'field' }, search),
    results));
}

/* Adding a book to the booklog */

/** The booklog this shelf belongs to ("boeken.tsuk.org"), or '' when it has none. */
function booklogHost() {
  const known = books.find((b) => b.boeken && b.url);
  try { return known ? new URL(known.url).host : ''; } catch { return ''; }
}

/** The booklog's categories, most used first: it has a small, fixed set, and the books carry them. */
function booklogCategories() {
  const count = new Map();
  for (const b of books) if (b.boeken) for (const c of b.categories || []) count.set(c, (count.get(c) || 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

/** On the page of a book that isn't in the booklog: the way in, or that it is on its way. */
function addToBooklog(book, again) {
  const host = booklogHost();
  if (!host) return null;
  const open = () => openBooklogForm(book, again);
  return h('div', { class: 'from-site' },
    book.boekenWanted
      ? h('p', { class: 'sheet-note' }, t('This book will be added to {host} within a few minutes.', { host }), ' ',
        h('button', { class: 'link-btn', type: 'button', text: t('Change'), onclick: open }))
      : h('button', { class: 'link-btn', type: 'button', onclick: open }, icon('plus'), t('Add to {host}', { host })),
    book.boekenError && h('p', { class: 'field-error', text: t('Not published to {host}: {why}', { host, why: book.boekenError }) }));
}

/**
 * What the booklog wants to know before a book gets a page there: where you are with it,
 * the language of the edition, and its categories. Saying yes here is what makes it public.
 */
function openBooklogForm(book, back) {
  const host = booklogHost();
  const status = lists.filter((l) => l.group === READING);
  const on = {};
  for (const { list, at, note } of listsOf(book)) on[list.id] = note ? { at, note } : { at };
  let language = book.language || '';
  const chosen = new Set(book.categories || []);
  const tags = h('input', { name: 'tags', value: (book.tags || []).join(', '), autocomplete: 'off', autocapitalize: 'off' });
  // A book without a review can get a sentence about it: the text of its page until it is reviewed.
  const note = !(book.reviews || []).length && h('textarea', { name: 'note', rows: 2, autocapitalize: 'sentences' });
  const error = h('p', { class: 'field-error', hidden: true });
  // The assistant fills in what it knows of the book; nothing is saved until Add.
  const suggest = sync.user && sync.assistant && h('button', {
    class: 'link-btn', type: 'button',
    onclick: async () => {
      suggest.disabled = true;
      error.hidden = true;
      try {
        const res = await api('suggest', { text: `${book.title} — ${book.author || ''}${book.isbn ? ` (ISBN ${book.isbn})` : ''}` });
        const p = (res.books || [])[0];
        if (!p) throw Object.assign(new Error(t('No books recognised in that.')), { status: 1 });
        language ||= p.language || '';
        for (const name of p.categories || []) chosen.add(name);
        if (!tags.value.trim()) tags.value = (p.tags || []).join(', ');
        if (note && !note.value.trim()) note.value = p.note || '';
        draw();
      } catch (err) {
        error.textContent = err.status ? err.message : t('Couldn’t reach the server. Are you online?');
        error.hidden = false;
      } finally {
        suggest.disabled = false;
      }
    },
  }, icon('sparkles'), t('Suggest'));
  const rows = { status: h('div', { class: 'chips' }), language: h('div', { class: 'chips' }), categories: h('div', { class: 'chips' }) };
  const chip = (text, pressed, onclick) => h('button', { class: 'chip', type: 'button', text, 'aria-pressed': String(pressed), onclick });
  function draw() {
    rows.status.replaceChildren(...status.map((l) => chip(listName(l), !!on[l.id], () => { if (on[l.id]) delete on[l.id]; else place(on, l.id); draw(); })));
    rows.language.replaceChildren(...Object.entries(LANGUAGE_NAMES)
      .map(([code, name]) => chip(name, language === code, () => { language = code; draw(); })));
    rows.categories.replaceChildren(...booklogCategories()
      .map((name) => chip(name, chosen.has(name), () => { if (!chosen.delete(name)) chosen.add(name); draw(); })));
  }
  draw();

  async function submit(e) {
    e.preventDefault();
    const fail = (message) => { error.textContent = message; error.hidden = false; };
    if (!status.some((l) => on[l.id])) return fail(t('Choose a reading status.'));
    if (!language) return fail(t('Choose a language.'));
    if (!chosen.size) return fail(t('Choose at least one category.'));
    Object.assign(book, {
      lists: on, language, categories: [...chosen],
      tags: tags.value.split(',').map((tag) => tag.replace(/\s+/g, ' ').trim()).filter(Boolean),
      boekenWanted: true, boekenError: '',
    });
    if (note && note.value.trim()) book.reviews = [{ id: newId(), date: '', rating: null, text: note.value.trim() }];
    await saveBook(book);
    back();
  }

  sheet.open(h('form', { class: 'list-picker', novalidate: true, onsubmit: submit },
    sheetHead(t('Add to {host}', { host }), displayTitle(book)),
    h('p', { class: 'sheet-note booklog-note' },
      t('The book gets a page of its own there, which anyone can see. A book you have read takes its review, rating and reading date along.'), ' ', suggest),
    h('div', { class: 'sheet-section' }, h('h3', { text: show(READING) }), rows.status),
    h('div', { class: 'sheet-section' }, h('h3', { text: t('Language of this edition') }), rows.language),
    h('div', { class: 'sheet-section' }, h('h3', { text: t('Categories') }), rows.categories),
    h('div', { class: 'sheet-section' }, h('h3', { text: t('Tags') }),
      h('label', { class: 'field' }, tags), h('p', { class: 'sheet-note', text: t('Optional. Separate tags with commas.') })),
    note && h('div', { class: 'sheet-section' }, h('h3', { text: t('Note') }),
      h('label', { class: 'field' }, note),
      h('p', { class: 'sheet-note', text: t('Optional. One sentence about the book: the text of its page until you review it.') })),
    error,
    h('div', { class: 'btn-row sheet-actions' },
      book.boekenWanted && h('button', {
        class: 'btn btn-quiet btn-danger', type: 'button', text: t('Don’t add'),
        onclick: async () => { book.boekenWanted = false; book.boekenError = ''; await saveBook(book); back(); },
      }),
      h('button', { class: 'btn btn-outline', type: 'button', text: t('Cancel'), 'data-cancel': true, onclick: back }),
      h('button', { class: 'btn btn-primary', type: 'submit' }, icon('check'), t('Add')))));
}

/**
 * What you can do next with a book, by the reading list it is on: start one you meant to
 * read (or drop it), finish or give up one you are reading.
 */
function bookActions(book, again) {
  const on = shelves(book);
  const move = async (id, message) => {
    const before = book.lists, said = { progressUnit: book.progressUnit, percentRead: book.percentRead };
    book.lists = place({ ...shelves(book) }, id);
    await saveBook(book);
    again();
    toast(message, {
      action: t('Undo'),
      onAction: async () => {
        if (before) book.lists = before; else delete book.lists;
        for (const key in said) if (said[key] != null) book[key] = said[key];
        await saveBook(book);
        if (sheet.isOpen) again();
      },
    });
  };
  if (on.reading) {
    return h('div', { class: 'btn-row book-actions' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openReviewForm(book, null, again, { finish: true }) }, icon('check'), t('Mark as read')),
      h('button', { class: 'btn btn-outline', type: 'button', text: t('Did not finish'), onclick: () => move('abandoned', t('Marked as not finished')) }));
  }
  if (on['to-read']) {
    return h('div', { class: 'btn-row book-actions' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => move('reading', t('Started reading')) }, icon('book'), t('Start reading')),
      h('button', { class: 'btn btn-outline btn-danger', type: 'button', text: t('Drop'), onclick: () => confirmDrop(book) }));
  }
  return null;
}

/**
 * Deleting a book. One that is in the booklog can go from there too, with all its reads: that
 * is asked, and ticked unless you untick it. `back()` returns to where you came from.
 */
function confirmDelete(book, back) {
  const host = book.boeken ? booklogHost() : '';
  const gone = (fromBooklog) => {
    sheet.close();
    removeBook(book, { drop: fromBooklog });
    toast(fromBooklog ? t('Book removed, also from {host}', { host }) : t('Book removed'), { action: t('Undo'), onAction: () => restoreBook(book) });
  };
  if (!host) { gone(false); return; }
  const reads = new Set([book.boeken, ...(book.reviews || []).map((r) => r.boeken).filter(Boolean)]).size;
  const note = h('p', { class: 'sheet-note drop-note', text: reads > 1 ? t('All {n} of its pages there go, one for each read. The booklog’s history keeps a copy.', { n: reads }) : t('Its page there goes. The booklog’s history keeps a copy.') });
  const also = h('input', { type: 'checkbox', checked: true, onchange: () => { note.hidden = !also.checked; } });
  sheet.open(h('div', null,
    sheetHead(t('Delete this book?'), displayTitle(book)),
    h('label', { class: 'check-line' }, also, h('span', { text: t('Also delete it from {host}', { host }) })),
    note,
    h('div', { class: 'btn-row sheet-actions' },
      h('button', { class: 'btn btn-outline', type: 'button', text: t('Cancel'), 'data-cancel': true, onclick: back }),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => gone(also.checked) }, icon('trash'), t('Delete')))));
}

/** Dropping a book you meant to read takes it out of the shelf for good; that is asked first. */
function confirmDrop(book) {
  const host = book.boeken ? booklogHost() : '';
  sheet.open(h('div', null,
    sheetHead(t('Drop this book?'), displayTitle(book)),
    h('p', { class: 'sheet-note drop-note', text: host ? t('It is removed from your shelf, and its page on {host} is deleted.', { host }) : t('It is removed from your shelf.') }),
    h('div', { class: 'btn-row sheet-actions' },
      h('button', { class: 'btn btn-outline', type: 'button', text: t('Cancel'), 'data-cancel': true, onclick: () => openBook(book) }),
      h('button', {
        class: 'btn btn-primary', type: 'button',
        onclick: () => {
          sheet.close();
          removeBook(book, { drop: true });
          toast(t('Book dropped'), { action: t('Undo'), onAction: () => restoreBook(book) });
        },
      }, icon('trash'), t('Drop')))));
}

/* How far along a book on the Reading list is. The booklog keeps the page reached (for an
   audiobook: the time left), and that is what a book holds in `pagesRead` / `durationLeft`.
   It can be said as a percentage as well; the two are kept in step through the book's
   length. Which of the two was typed in is the one this read goes by from then on
   (`progressUnit: 'percent'`, with the figure itself in `percentRead`; nothing for the
   other), until the other one is typed in. */

/** Minutes in the booklog's "3u 12m" ("3h 12m" is fine too); null if it isn't a length of time. */
function minutesOf(text) {
  const m = String(text || '').trim().toLowerCase().match(/^(?:(\d+)\s*(?:u|h|uur|uren))?\s*(?:(\d+)\s*(?:m|min))?$/);
  return m && (m[1] || m[2]) ? Number(m[1] || 0) * 60 + Number(m[2] || 0) : null;
}
const spanOf = (minutes) => { const hours = Math.floor(minutes / 60), rest = minutes % 60; return hours && rest ? `${hours}u ${rest}m` : hours ? `${hours}u` : `${rest}m`; };

/** Pages read (audiobook: minutes listened) at `percent` of `total`. */
const doneAt = (percent, total) => Math.round((total * percent) / 100);

/** → { audio, total, done, percent, byPercent }: pages (audiobook: minutes) in all and so far; null where unknown. */
function progressOf(book) {
  const audio = formatOf(book) === 'audiobook' && !!book.duration;
  const total = audio ? minutesOf(book.duration) : (book.pages > 0 ? book.pages : null);
  const left = audio ? minutesOf(book.durationLeft) : null;
  const done = audio ? (total != null && left != null ? Math.max(0, total - left) : null)
    : (Number.isFinite(book.pagesRead) ? book.pagesRead : null);
  const byPercent = book.progressUnit === 'percent';
  const said = byPercent && Number.isFinite(book.percentRead) ? book.percentRead : null;
  let percent = total && done != null ? Math.min(100, Math.round((done / total) * 100)) : null;
  // The percentage as it was typed, as long as it still is what the booklog has in pages.
  if (said != null && (!total || done == null || doneAt(said, total) === done)) percent = said;
  return { audio, total, done, percent, byPercent };
}

function progressBox(book, again) {
  if (!shelves(book).reading) return null;
  const { audio, total, percent, byPercent } = progressOf(book);
  const amount = audio
    ? h('input', { name: 'left', value: book.durationLeft || '', placeholder: '3u 12m', autocomplete: 'off' })
    : h('input', { name: 'page', type: 'number', min: 0, max: total, inputmode: 'numeric', value: book.pagesRead ?? '' });
  const share = h('input', { name: 'percent', type: 'number', min: 0, max: 100, inputmode: 'numeric', value: percent ?? '', 'aria-label': t('Percentage read') });
  const error = h('p', { class: 'field-error', hidden: true });
  const fail = (input, message) => { error.textContent = message; error.hidden = false; input.focus(); };

  const pageOf = () => (amount.value.trim() === '' ? NaN : Math.round(Number(amount.value)));
  const shareOf = () => (share.value.trim() === '' ? NaN : Math.round(Number(share.value)));

  // Each field follows the other while it is typed in; the one typed in last is the one that counts.
  let typed = null;
  amount.addEventListener('input', () => {
    typed = 'amount';
    error.hidden = true;
    if (!total) return;
    const done = audio ? (minutesOf(amount.value) == null ? NaN : total - minutesOf(amount.value)) : pageOf();
    share.value = done >= 0 && done <= total ? Math.round((done / total) * 100) : '';
  });
  share.addEventListener('input', () => {
    typed = 'percent';
    error.hidden = true;
    if (!total) return;
    const p = shareOf();
    if (!(p >= 0 && p <= 100)) amount.value = '';
    else amount.value = audio ? spanOf(total - doneAt(p, total)) : doneAt(p, total);
  });

  const fields = [
    h('label', { class: 'field progress-amount' },
      h('span', { text: audio ? t('Time left') : total ? t('Page (of {n})', { n: total }) : t('Page') }), amount),
    h('label', { class: 'field progress-percent' }, h('span', { text: '%' }), share),
  ];
  return h('form', {
    class: 'progress-form', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      const unit = typed || (byPercent ? 'percent' : 'amount');
      if (unit === 'percent') {
        const p = shareOf();
        if (!(p >= 0 && p <= 100)) return fail(share, t('Give a percentage from 0 to 100.'));
        book.progressUnit = 'percent';
        book.percentRead = p;
        if (total && audio) book.durationLeft = spanOf(total - doneAt(p, total));
        else if (total) book.pagesRead = doneAt(p, total);
      } else {
        if (audio) {
          const left = minutesOf(amount.value);
          if (left == null) return fail(amount, t('Give the time left like 3u 12m.'));
          if (total && left > total) return fail(amount, t('That is more than the whole book ({n}).', { n: book.duration }));
          book.durationLeft = spanOf(left);
        } else {
          const page = pageOf();
          if (!(page >= 0)) return fail(amount, t('Which page are you on?'));
          if (total && page > total) return fail(amount, t('That is past the last page ({n}).', { n: total }));
          book.pagesRead = page;
        }
        delete book.progressUnit;
        delete book.percentRead;
      }
      await saveBook(book);
      toast(t('Progress saved'));
      again();
    },
  },
  ...(byPercent ? fields.reverse() : fields),   // what this read goes by comes first
  h('button', { class: 'btn btn-outline', type: 'submit' }, icon('check'), t('Save')),
  error);
}

/* A book's page takes a little of its cover's colour, as its page in the booklog does: the
   first of the cover's main colours that is neither nearly white nor nearly black, or else
   the darkest. It is worked out here from the picture, once per cover. */

const tints = new Map();   // cover address → '#rrggbb', or '' when it can't be told

function coverTint(src) {
  if (!tints.has(src)) tints.set(src, new Promise((resolve) => {
    const img = new Image();
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';   // a catalogue that doesn't allow reading its picture gives no colour
    img.onerror = () => resolve('');
    img.onload = () => {
      try {
        if (img.naturalWidth < 8) { resolve(''); return; }
        const w = 40, hgt = Math.max(1, Math.round((w * img.naturalHeight) / img.naturalWidth));
        const canvas = h('canvas', { width: w, height: hgt });
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, hgt);
        const px = ctx.getImageData(0, 0, w, hgt).data;
        const bins = new Map();   // colours that look alike are counted together
        for (let i = 0; i < px.length; i += 4) {
          if (px[i + 3] < 200) continue;
          const key = ((px[i] >> 5) << 6) | ((px[i + 1] >> 5) << 3) | (px[i + 2] >> 5);
          const bin = bins.get(key) || bins.set(key, [0, 0, 0, 0]).get(key);
          bin[0]++; bin[1] += px[i]; bin[2] += px[i + 1]; bin[3] += px[i + 2];
        }
        const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        const main = [...bins.values()].sort((a, b) => b[0] - a[0]).slice(0, 8).map(([n, r, g, b]) => {
          const rgb = [r / n, g / n, b / n];
          return { rgb, lum: 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]) };
        });
        const pick = main.find((c) => c.lum >= 0.10 && c.lum <= 0.50) || main.sort((a, b) => a.lum - b.lum)[0];
        resolve(pick ? '#' + pick.rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('') : '');
      } catch { resolve(''); }
    };
    img.src = src;
  }));
  return tints.get(src);
}

async function tintSheet(book) {
  const src = [book.cover, book.thumb].find(Boolean);
  const colour = src ? await coverTint(src) : '';
  if (openedBook !== book || !bookPageOpen()) return;   // another book, or another sheet, by now
  if (colour) $('sheet').style.setProperty('--cover', colour);
  $('sheet').classList.toggle('tinted', !!colour);
}

/** For a book that has no cover, or only the photograph taken of it when it was added: a way
 *  to the cover's own page (coverViewer), where better ones are found. */
function coverSearch(book, viewer) {
  if (book.cover || !book.title) return null;   // `thumb` alone is your own photograph
  return h('button', { class: 'link-btn cover-search', type: 'button', onclick: () => viewer.open() },
    icon('search'), book.thumb ? t('Find a better cover') : t('Find a cover'));
}

/* From a book to the one before or after it in the list it was opened from: swipe right or
   left on its page (as on the booklog), the arrow keys, or the two arrows on the page. */

/** The books of the list the open book was opened from, in the order shown; null when it wasn't from a list. */
let trail = null;

function neighbour(book, step) {
  const at = trail ? trail.indexOf(book) : -1;
  return at < 0 ? null : trail[at + step] || null;
}

/** The book whose page is open in the sheet, if that is what the sheet shows. */
let openedBook = null;
const bookPageOpen = () => sheet.isOpen && !!openedBook && !!$('sheetBody').querySelector('.book-page');

function turnTo(step) {
  const next = bookPageOpen() && neighbour(openedBook, step);
  if (next) openBook(next);
}

function initTurning() {
  let x0 = null, y0 = null;
  const SWIPE = 60;   // px, as on the booklog
  $('sheet').addEventListener('touchstart', (e) => {
    const field = e.target.closest('input, textarea, select');
    [x0, y0] = e.touches.length === 1 && !field ? [e.touches[0].clientX, e.touches[0].clientY] : [null, null];
  }, { passive: true });
  $('sheet').addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) < SWIPE || Math.abs(dx) < Math.abs(dy) * 1.5) return;   // not a sideways swipe
    turnTo(dx > 0 ? -1 : 1);
  }, { passive: true });
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !bookPageOpen()) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === 'ArrowLeft') turnTo(-1);
    else if (e.key === 'ArrowRight') turnTo(1);
  });
}

/** `rows`: the list the book is opened from (null: from none); left out, it stays what it was. */
function openBook(book, rows) {
  if (rows !== undefined) trail = rows;
  openedBook = book;
  const again = () => { if (books.includes(book)) openBook(book); else sheet.close(); };
  const before = neighbour(book, -1), after = neighbour(book, 1);
  const turn = (other, name, label) => h('button', { class: 'icon-btn', type: 'button', 'aria-label': label, title: label, disabled: !other, onclick: () => openBook(other) }, icon(name));
  // With more than one read, each says which edition it was: its cover and a line about it.
  const several = (book.reviews || []).filter((r) => r.date).length > 1;
  const reviewEl = (review) => {
    const e = several && review.edition;
    return h('article', { class: 'review' },
      h('div', { class: 'review-head' },
        e && (e.cover || e.thumb) && coverEl({ title: book.title, ...e }),
        h('div', { class: 'review-what' },
          h('span', { text: [review.date && longDate(review.date), review.rating != null && `★ ${review.rating}`].filter(Boolean).join(' · ') || t('Note') }),
          e && editionLine(e) && h('small', { text: editionLine(e) })),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Edit review'), onclick: () => openReviewForm(book, review, again) }, icon('pencil'))),
      review.text && h('div', { class: 'prose' }, renderMarkdown(review.text)));
  };
  const reviews = sortedReviews(book);

  const viewer = coverViewer(book, again);
  sheet.open(h('div', { class: 'book-page' },
    h('div', { class: 'page-head' },
      viewer,
      h('div', { class: 'page-title' },
        h('h2', { class: 'sheet-title', text: displayTitle(book) }),
        // Each name leads to all of that person's books: the writers, then the others by what they did.
        book.author && h('p', { class: 'page-author' }, authorsOf(book).flatMap((name, i) => [i > 0 && ', ', personLink(name)])),
        contributorsIn(peopleOf(book)).length > 0 && h('p', { class: 'page-people' },
          contributorsIn(peopleOf(book)).flatMap(([role, names], i) => [i > 0 && ' · ', `${role}: `, ...names.flatMap((name, j) => [j > 0 && ', ', personLink(name)])])),
        seriesLine(book) && h('button', {
          class: 'link-btn page-series', type: 'button', text: seriesLine(book),
          onclick: () => closeLayersThen(() => setView({ series: book.series })),
        }),
        metaLine(book) && h('p', { class: 'book-meta', text: metaLine(book) }),
        // What it is in and about, quietly: the language and categories, then the tags.
        (book.language || book.categories?.length || book.tags?.length) && h('p', { class: 'book-meta page-about' },
          [book.language && languageName(book.language), ...(book.categories || [])].filter(Boolean).join(' · '),
          book.tags?.length > 0 && h('span', { text: (book.language || book.categories?.length ? ' · ' : '') + book.tags.join(', ') })),
        listTags(book, null),
        coverSearch(book, viewer)),
      h('div', { class: 'page-corner' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Close'), onclick: () => sheet.close() }, icon('x')),
        (before || after) && h('div', { class: 'page-turn' }, turn(before, 'back', t('Previous book')), turn(after, 'forward', t('Next book'))))),
    sourceNote(book, false, again),
    progressBox(book, again),
    bookActions(book, again),
    h('div', { class: 'sheet-section' },
      h('div', { class: 'section-head' },
        h('h3', { text: t('Reviews') }),
        // A read that has only its date yet (marked as read, nothing said) is the one a review is for.
        h('button', { class: 'link-btn', type: 'button', onclick: () => openReviewForm(book, sortedReviews(book).find((r) => r.date && !r.text && r.rating == null) || null, again) }, icon('plus'), t('Add review'))),
      reviews.length ? reviews.map(reviewEl) : h('p', { class: 'sheet-note', text: t('No reviews yet.') })),
    h('button', { class: 'btn btn-outline btn-block page-edit', type: 'button', onclick: () => openBookForm({ book, back: again }) }, icon('pencil'), t('Edit details'))));
  tintSheet(book);
}

/** Write a review, or change one. `back` shows the book's page again. */
/** `finish`: this review is of the read just finished; saving it also puts the book on Read. */
function openReviewForm(book, review, back, { finish = false } = {}) {
  const isNew = !review;
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const text = h('textarea', { name: 'text', rows: 9, class: 'review-text', autocapitalize: 'sentences' });
  text.value = review?.text || '';
  // Reading date and rating are both optional; a book that was just read most likely was read today.
  const date = h('input', { name: 'date', type: 'date', max: today, value: review ? review.date || '' : (finish || shelves(book).read ? today : '') });
  const rating = h('input', { name: 'rating', type: 'number', min: 0, max: 10, step: 1, inputmode: 'numeric', placeholder: '–', value: review?.rating ?? '' });
  const error = h('p', { class: 'field-error', hidden: true });

  // The edition read this time. A new read starts from the book's own, so only what differs needs saying.
  const edition = { ...(review?.edition || mainEdition(book)) };
  const cover = coverControl(() => ({ title: book.title, ...edition }), () => form, () => ({ isbn: ed.isbn.value.replace(/[^0-9Xx]/g, '') || edition.isbn || '', title: book.title, author: book.author }));
  const ed = {
    publisher: h('input', { name: 'publisher', value: edition.publisher || '', autocomplete: 'off', autocapitalize: 'words' }),
    date: h('input', { name: 'published', value: edition.date || '', inputmode: 'numeric', autocomplete: 'off' }),
    pages: h('input', { name: 'pages', value: edition.pages ?? '', inputmode: 'numeric', autocomplete: 'off' }),
    duration: h('input', { name: 'duration', value: edition.duration || '', placeholder: '11u 36m', autocomplete: 'off' }),
    isbn: h('input', { name: 'isbn', value: edition.isbn || '', inputmode: 'numeric', autocomplete: 'off' }),
  };
  const who = peopleEditor(edition.people || peopleOf(book));
  const format = formatPicker(formatOf(edition));
  let language = edition.language || '';
  const languages = h('div', { class: 'chips' });
  const drawLanguages = () => languages.replaceChildren(...['nl', 'en', 'fr', 'de'].map((code) => h('button', {
    class: 'chip', type: 'button', text: code.toUpperCase(), 'aria-pressed': String(language === code),
    onclick: () => { language = language === code ? '' : code; drawLanguages(); },
  })));
  drawLanguages();

  async function submit(e) {
    e.preventDefault();
    const stars = rating.value.trim() === '' ? null : Math.round(Number(rating.value));
    const data = { date: date.value || '', rating: stars, text: text.value.replace(/\r\n?/g, '\n').trim() };
    const said = (input) => input.value.replace(/\s+/g, ' ').trim();
    const read = {
      ...edition,
      publisher: said(ed.publisher), date: normDate(said(ed.date)),
      pages: parseInt(said(ed.pages), 10) > 0 ? parseInt(said(ed.pages), 10) : null,
      duration: said(ed.duration).toLowerCase().replace(/h/g, 'u'),
      isbn: toIsbn13(said(ed.isbn)) || said(ed.isbn).replace(/[^0-9Xx]/g, ''),
      language, format: format.value,
      ...(cover.choice && coverFields(cover.choice)),
    };
    // Who made this edition, where that was said before, someone has a role, or it isn't the book's writers.
    const people = who.value();
    const same = (a, b) => a.length === b.length && a.every((person, i) => fold(person.name) === fold(b[i].name) && (person.role || '') === (b[i].role || ''));
    if (people.length && (Array.isArray(edition.people) || people.some((person) => person.role) || !same(people, peopleOf(book)))) read.people = people;
    else delete read.people;
    // An audiobook has a length and no pages; said to be paper or an e-book, pages and no length.
    if (format.value === 'audiobook') read.pages = null; else if (format.value) read.duration = '';
    for (const key of Object.keys(read)) if (read[key] == null || read[key] === '') delete read[key];
    if (Object.keys(read).length) data.edition = read;
    const fail = (message, input) => { error.textContent = message; error.hidden = false; input.focus(); };
    if (stars != null && !(stars >= 0 && stars <= 10)) return fail(t('A rating goes from 0 to 10.'), rating);
    const blank = !data.text && !data.date && stars == null;
    if (blank && !finish) return fail(t('Write something, or give a reading date or a rating.'), text);
    if (finish) book.lists = place({ ...shelves(book) }, 'read');
    if (review && !data.edition) delete review.edition;
    if (review) Object.assign(review, data);
    else if (!blank) (book.reviews ||= []).push({ id: newId(), ...data });
    settleRating(book);
    await saveBook(book);
    if (cover.choice && data.edition) keepCover(data.edition, cover.choice, book);
    back();
  }

  function remove() {
    // A read that is in the booklog is a post there, which goes too (shelf/publish.py).
    const host = review.boeken && booklogHost();
    book.reviews = book.reviews.filter((r) => r !== review);
    if (host) book.dropReads = [...new Set([...(book.dropReads || []), review.boeken])];
    settleRating(book);
    saveBook(book);
    back();
    toast(host ? t('Review removed, also from {host}', { host }) : t('Review removed'), {
      action: t('Undo'),
      onAction: () => {
        (book.reviews ||= []).push(review);
        if (host) { book.dropReads = book.dropReads.filter((slug) => slug !== review.boeken); if (!book.dropReads.length) delete book.dropReads; }
        settleRating(book);
        saveBook(book);
        if (sheet.isOpen) back();
      },
    });
  }

  const edPages = h('label', { class: 'field' }, h('span', { text: t('Pages') }), ed.pages);
  const edLength = h('label', { class: 'field' }, h('span', { text: t('Length') }), ed.duration);
  const showExtent = () => { edLength.hidden = format.value !== 'audiobook'; edPages.hidden = format.value === 'audiobook'; };
  format.onChange = showExtent;
  showExtent();

  const form = h('form', {
    novalidate: true, onsubmit: submit,
    ondragover: (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); },
    ondrop: (e) => { const file = cover.pictureIn(e.dataTransfer); if (file) { e.preventDefault(); cover.pick(file); } },
  },
    sheetHead(finish ? t('Finished it') : isNew ? t('New review') : t('Edit review'), displayTitle(book)),
    h('label', { class: 'field' }, h('span', { text: t('Review') }), text),
    h('p', { class: 'sheet-note md-hint', text: t('Markdown works: *italic*, **bold**, > quote, [link](https://…).') }),
    h('div', { class: 'field-row' },
      h('label', { class: 'field' }, h('span', { text: t('Read on') }), date),
      h('label', { class: 'field' }, h('span', { text: t('Rating (0–10)') }), rating)),
    h('details', { class: 'edition-box', open: !!(review?.edition && Object.keys(review.edition).length && !isNew) && false },
      h('summary', null, h('span', { text: t('Edition read') }), h('small', { text: editionLine(edition) })),
      h('div', { class: 'field' }, h('span', { text: t('Format') }), format.el),
      h('div', { class: 'edition-cover' }, cover.button,
        h('p', { class: 'sheet-note', text: t('The cover of this edition. Tap it to see it large, or to change it.') })),
      h('label', { class: 'field' }, h('span', { text: t('Publisher') }), ed.publisher),
      h('div', { class: 'field-row' },
        h('label', { class: 'field' }, h('span', { text: t('Published') }), ed.date),
        h('label', { class: 'field' }, h('span', { text: 'ISBN' }), ed.isbn)),
      h('div', { class: 'field-row' }, edPages, edLength),
      h('div', { class: 'field' }, h('span', { text: t('Language') }), languages),
      h('div', { class: 'field' }, h('span', { text: t('Authors and others') }), who.el),
      h('p', { class: 'sheet-note people-hint', text: t('Who made this edition: an audiobook has a voice (stem), a translation a translator (vertaling).') })),
    error,
    h('div', { class: 'btn-row sheet-actions' },
      !isNew && h('button', { class: 'btn btn-quiet btn-danger', type: 'button', 'aria-label': t('Delete review'), onclick: remove }, icon('trash')),
      h('button', { class: 'btn btn-outline', type: 'button', text: t('Cancel'), 'data-cancel': true, onclick: back }),
      h('button', { class: 'btn btn-primary', type: 'submit' }, icon('check'), t('Save'))));
  sheet.open(form);
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
    h(FIXED.has(list.id) ? 'div' : 'button', FIXED.has(list.id) ? { class: 'list-name' } : { class: 'list-name', type: 'button', onclick: () => openListForm(list) },
      h('span', { text: listName(list) }),
      h('small', { text: [FIXED.has(list.id) && t('Part of the app'), list.group && t('One of: {set}', { set: show(list.group) }), list.noteLabel && t('Note: {label}', { label: show(list.noteLabel) })].filter(Boolean).join(' · ') })),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Move {list} up', { list: listName(list) }), disabled: i === 0, onclick: () => move(i, i - 1) }, icon('up')),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Move {list} down', { list: listName(list) }), disabled: i === lists.length - 1, onclick: () => move(i, i + 1) }, icon('down')));
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
    if (lists.some((l) => l !== list && fold(listName(l)) === fold(show(data.name)))) return fail(t('There is already a list with that name.'), name);
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
      ? t('Deleted “{list}” — the {n} on it stay on your shelf', { list: listName(list), n: plural(count, 'book') })
      : t('Deleted “{list}”', { list: listName(list) }), { action: t('Undo'), onAction: () => saveList(list) });
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
      h('button', { class: 'btn btn-outline', type: 'button', text: t('Cancel'), 'data-cancel': true, onclick: () => openLists() }),
      h('button', { class: 'btn btn-primary', type: 'submit' }, icon('check'), isNew ? t('Add list') : t('Save')))));
  if (isNew) name.focus();
}

/* ───────────────────────── Export ───────────────────────── */

function exportJson() {
  const rows = [...books].reverse().map((b) => ({
    title: b.title, author: b.author, date: b.date, publisher: b.publisher, pages: b.pages ?? null,
    isbn: b.isbn || '', cover: b.cover ? abs(b.cover) : '', added: b.added,
    lists: listsOf(b).map(({ list, at, note }) => ({ list: listName(list), since: at, ...(note && { note }) })),
    ...(b.series && { series: b.series, seriesNumber: seriesNo(b) }),
    ...(b.rating != null && { rating: b.rating }),
    ...(b.reviews?.length && { reviews: sortedReviews(b).map((r) => ({ date: r.date || '', rating: r.rating ?? null, text: r.text || '' })) }),
  }));
  return JSON.stringify(rows, null, 2);
}

/* The CSV layout of a Goodreads export, which other reading sites import too: StoryGraph,
   BookWyrm, Hardcover, LibraryThing and Goodreads itself. One row per book, so a book read
   more than once comes with its latest read; ratings go from 0–10 to 1–5 stars, and the series
   goes in the title, "A Wizard of Earthsea (Earthsea, #1)", as Goodreads has it. Books with
   no reading status are put on to-read, as Goodreads does with every book it is given. */
const GOODREADS_COLUMNS = ['Book Id', 'Title', 'Author', 'Author l-f', 'Additional Authors', 'ISBN', 'ISBN13',
  'My Rating', 'Average Rating', 'Publisher', 'Binding', 'Number of Pages', 'Year Published',
  'Original Publication Year', 'Date Read', 'Date Added', 'Bookshelves', 'Bookshelves with positions',
  'Exclusive Shelf', 'My Review', 'Spoiler', 'Private Notes', 'Read Count', 'Owned Copies'];
const GOODREADS_SHELF = { 'to-read': 'to-read', reading: 'currently-reading', read: 'read', abandoned: 'did-not-finish' };

/** "Ursula K. Le Guin" → "Le Guin, Ursula K.", the surname taking its particles along. */
function lastFirst(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return words.join(' ');
  let cut = words.length - 1;
  while (cut > 1 && PARTICLES.has(words[cut - 1].toLowerCase())) cut--;
  return `${words.slice(cut).join(' ')}, ${words.slice(0, cut).join(' ')}`;
}

/** A 13-digit ISBN as ISBN-10, where there is one ('' for 979-…). */
function toIsbn10(isbn13) {
  if (!/^978\d{10}$/.test(isbn13 || '')) return '';
  const core = isbn13.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(core[i]) * (10 - i);
  const check = (11 - (sum % 11)) % 11;
  return core + (check === 10 ? 'X' : String(check));
}

function exportGoodreads() {
  const cell = (v) => { const text = String(v ?? ''); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
  const day = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso || '') ? iso.slice(0, 10).replace(/-/g, '/') : '');
  const quoted = (isbn) => (isbn ? `="${isbn}"` : '');   // as Goodreads writes them, so a spreadsheet keeps the zeros
  const slug = (text) => fold(text).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const rows = [...books].reverse().map((b) => {
    const people = peopleOf(b);
    const writers = writersIn(people);
    const others = [...writers.slice(1), ...people.map((person) => person.name).filter((name) => !writers.includes(name))];
    const on = listsOf(b);
    const status = on.find(({ list }) => FIXED.has(list.id))?.list.id;
    const shelf = GOODREADS_SHELF[status] || 'to-read';
    const reads = (b.reviews || []).filter((r) => r.date).length;
    const isbn13 = toIsbn13(b.isbn) || '';
    const format = formatOf(b);
    return [
      '', b.series ? `${b.title} (${b.series}${seriesNo(b) ? `, #${seriesNo(b)}` : ''})` : b.title, writers[0] || '', lastFirst(writers[0]), others.join(', '), quoted(toIsbn10(isbn13)), quoted(isbn13),
      b.rating != null ? Math.max(1, Math.round(b.rating / 2)) : 0, '', b.publisher || '',
      { ebook: 'ebook', audiobook: 'Audiobook' }[format] || '', b.pages || '', yearOf(b.date), '',
      day(lastRead(b)), day(b.added),
      on.filter(({ list }) => !FIXED.has(list.id)).map(({ list }) => slug(listName(list))).filter(Boolean).join(', '), '',
      shelf, sortedReviews(b).find((r) => r.text?.trim())?.text.trim() || '', '',
      on.filter(({ note }) => note).map(({ list, note }) => `${listName(list)}: ${note}`).join('; '),
      shelf === 'read' ? Math.max(reads, 1) : reads, shelves(b).library ? 1 : 0,
    ];
  });
  return [GOODREADS_COLUMNS, ...rows].map((row) => row.map(cell).join(',')).join('\n') + '\n';
}

const EXPORTS = {
  json: { make: exportJson, type: 'application/json', ext: 'json', about: (n) => t('{n} as JSON, oldest first.', { n }), copied: () => t('JSON copied to clipboard') },
  goodreads: { make: exportGoodreads, type: 'text/csv', ext: 'csv', about: (n) => t('{n} as a CSV file laid out like a Goodreads export, which StoryGraph, BookWyrm, Hardcover, LibraryThing and Goodreads can import. One row per book, with its latest read; ratings become 1 to 5 stars.', { n }), copied: () => t('CSV copied to clipboard') },
};

function openExport(kind = 'json') {
  if (!books.length) { toast(t('Nothing to export yet')); return; }
  const how = EXPORTS[kind];
  const text = how.make();
  const name = `folio-${new Date().toISOString().slice(0, 10)}.${how.ext}`;
  const file = typeof File === 'function' ? new File([text], name, { type: how.type }) : null;
  const canShareFile = !!file && !!navigator.canShare?.({ files: [file] });

  const save = () => {
    const url = URL.createObjectURL(new Blob([text], { type: how.type }));
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
      await navigator.share(canShareFile ? { files: [file], title: name } : { title: name, text });
      sheet.close();
    } catch (err) {
      if (err?.name !== 'AbortError') toast(t('Sharing didn’t work — try saving the file'));
    }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); sheet.close(); toast(how.copied()); }
    catch { toast(t('Couldn’t reach the clipboard')); }
  };

  sheet.open(h('div', null,
    sheetHead(t('Export'), how.about(plural(books.length, 'book'))),
    h('div', { class: 'stack' },
      h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: save }, icon('download'), t('Save file')),
      navigator.share && h('button', { class: 'btn btn-outline btn-block', type: 'button', onclick: share }, icon('share'), t('Share…')),
      navigator.clipboard && h('button', { class: 'btn btn-outline btn-block', type: 'button', onclick: copy }, icon('copy'), t('Copy to clipboard')))));
}

/* ───────────────────────── Settings sheet ───────────────────────── */

/** Offered only on a phone or tablet (a touch screen): on a desktop the browser tab does fine,
    and the browser has its own install button for whoever wants one. */
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  if (matchMedia('(pointer: coarse)').matches) installPrompt = e;
});

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
      h('h3', { text: t('Your shelf, as a file') }),
      h('div', { class: 'stack' },
        h('button', { class: 'btn btn-outline btn-block', type: 'button', onclick: () => openExport('json') }, icon('download'), t('Export as JSON')),
        h('button', { class: 'btn btn-outline btn-block', type: 'button', onclick: () => openExport('goodreads') }, icon('download'), t('Export for Goodreads, StoryGraph…'))),
      h('p', { class: 'sheet-note', text: t('StoryGraph, BookWyrm, Hardcover, LibraryThing and Goodreads, all free, can import the CSV: a public page of what you read, with your ratings and reviews.') })),
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

/** `mode`: 'barcode', or 'cover' to start at photographing the front cover. */
function openScanner(mode = 'barcode') {
  if (scanner.open) return;
  scanner.open = true;
  const session = ++scanner.session;
  Object.assign(scanner, { added: 0, busy: false, capturing: false, lastCode: '', pendingIsbn: '' });
  // Scanned books go where the last book added went.
  scanner.target = addTarget();
  scannerEl.hidden = false;
  setMode(mode === 'cover' ? 'cover' : 'barcode');
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
  if (mode === 'cover' && !coverByAssistant()) warmOcr();   // the text recogniser is only the fallback then
}

function updateScanCount() {
  $('scanCount').hidden = scanner.added < 1;
  $('scanCount').textContent = String(scanner.added);
  $('scanCount').title = t('{n} added', { n: scanner.added });
}

const listNames = (ids) => ids.map((id) => listById(id)).filter(Boolean).map((l) => listName(l)).join(' + ');

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
    rememberTarget(lists.filter((l) => on[l.id]).map((l) => l.id));
    scanner.target = addTarget();
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

// What is yours about one copy and not the other: where it is, what you thought of it, how far
// you got, and its page in the booklog. A second copy starts without them.
const OF_ONE_COPY = ['id', 'added', 'modified', 'lists', 'reviews', 'reads', 'reviewed', 'rating', 'pagesRead', 'percentRead',
  'progressUnit', 'progressLog', 'durationLeft', 'boeken', 'boekenWanted', 'boekenError', 'url'];

/** Another copy of a book you have, on lists `on`: the same edition, a book of its own. */
function addCopy(book, on) {
  const copy = structuredClone(book);
  for (const key of OF_ONE_COPY) delete copy[key];
  copy.lists = on;
  scanner.added++;
  updateScanCount();
  return addBook(copy);
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

  // With more than one copy, the one that is already where you are scanning to answers.
  const copies = books.filter((b) => b.isbn === isbn);
  const existing = copies.find((b) => scanner.target.every((id) => shelves(b)[id])) || copies[0];
  if (existing) {
    scanner.busy = false;
    // The copy in your hand may be another one: then it becomes a book of its own, on the
    // lists you are scanning to, and the one you had stays where it was.
    const another = (then) => h('button', { class: 'btn btn-outline btn-whole', type: 'button', onclick: async (e) => {
      e.currentTarget.disabled = true;
      then?.();
      showCard(addedCard(await addCopy(existing, targetLists())));
    } }, icon('plus'), t('Another copy'));
    // Scanning onto "Lent out" or "Read" is also how a book you already have gets there.
    const before = existing.lists;
    const missing = scanner.target.filter((id) => !shelves(existing)[id]);
    if (!missing.length) {
      showCard(card({
        status: listNames(scanner.target) ? t('Already on {lists}', { lists: listNames(scanner.target) }) : t('Already on your shelf'), tone: 'warn', book: existing,
        actions: [another()],
      }));
      return;
    }
    existing.lists = missing.reduce((on, id) => place(on, id), { ...shelves(existing) });
    saveBook(existing);
    const putBack = () => {
      if (before) existing.lists = before; else delete existing.lists;
      saveBook(existing);
    };
    showCard(card({
      status: t('Put on {lists}', { lists: listNames(missing) }), tone: 'ok', statusIcon: 'check', book: existing,
      actions: [
        h('button', { class: 'btn btn-outline', type: 'button', onclick: () => { putBack(); showCard(null); } }, icon('undo'), t('Undo')),
        h('button', { class: 'btn btn-outline', type: 'button', onclick: () => openBookForm({ book: existing }) }, icon('pencil'), t('Edit')),
        another(putBack),
      ],
    }));
    return;
  }

  showCard(busyCard(t('Looking up {isbn}…', { isbn })));
  const result = await lookupIsbn(isbn);

  if (result.status === 'found') {
    const book = await addBook({ ...result.book, isbn, format: 'paper', lists: targetLists() });   // a barcode is on a paper book
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
    const book = await addBook({ isbn, pending: true, format: 'paper', lists: targetLists() });
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

/** With an account and an assistant on the server, a photographed cover is shown to the assistant. */
const coverByAssistant = () => !!(sync.user && sync.assistant) && navigator.onLine !== false;

/** The books the assistant sees on a photographed cover (usually one; none if it can't tell). */
async function booksOnCover(canvas) {
  const k = Math.min(1, 1024 / Math.max(canvas.width, canvas.height));
  const small = h('canvas', { width: Math.round(canvas.width * k), height: Math.round(canvas.height * k) });
  small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
  const res = await api('suggest', { image: small.toDataURL('image/jpeg', 0.82) });
  return res.books || [];
}

async function processCover({ canvas, thumb }) {
  const session = scanner.session;
  const isbn = scanner.pendingIsbn;
  scanner.capturing = true;
  $('shutterBtn').disabled = true;
  const progress = busyCard(coverByAssistant() ? t('Looking at the cover…') : t('Reading the cover…'), true);
  showCard(progress);
  setHint('');

  const finish = (saved) => {
    scanner.capturing = false;
    $('shutterBtn').disabled = false;
    if (!scanner.open) return;
    video.play().catch(() => {});
    if (saved) { scanner.added++; updateScanCount(); setMode('barcode'); toast(t('Added to your shelf')); }
    else setHint();
  };

  // The assistant looks at the photograph itself, which reads a cover far better than
  // character recognition does. Where there is none, or it can't tell, the text is read here.
  if (coverByAssistant()) {
    let seen = [], waited = 0;
    const creep = setInterval(() => progress.setProgress(1 - 0.9 ** ++waited), 400);   // it takes a few seconds
    try { seen = await booksOnCover(canvas); }
    catch (err) { console.warn('Folio: the assistant could not look at the cover', err); }
    clearInterval(creep);
    if (!alive(session)) return;
    if (seen.length) {
      showCard(null);
      openDescribe(null, {
        books: seen, thumb, canvas, isbn, onClose: finish,
        byHand: () => openBookForm({
          book: { title: seen[0].title, author: seen[0].author, isbn, thumb, lists: targetLists() }, isNew: true, onClose: finish,
          heading: t('Check the details'),
        }),
      });
      return;
    }
    progress.setProgress(0);
    progress.setText(t('Reading the cover…'));
  }

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
    await addBook({ ...b, isbn: isbn || b.isbn, thumb, format: 'paper', lists: targetLists() });
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
  initTurning();
  initPicking();
  $('addBtn').addEventListener('click', () => openAdd());
  $('settingsBtn').addEventListener('click', openSettings);
  $('sortBtn').addEventListener('click', openSortSheet);
  $('search').addEventListener('input', renderLibrary);
  $('viewSeg').addEventListener('click', (e) => {
    const mode = e.target.closest('button')?.dataset.view;
    if (!VIEWS.includes(mode) || mode === view.mode) return;
    view.mode = mode;
    store.set('view', mode);
    renderLibrary();
  });

  window.addEventListener('hashchange', () => { readRoute(); renderLibrary(); openLinkedBook(); });

  $('scanClose').addEventListener('click', closeLayer);
  $('scanTargetBtn').addEventListener('click', openTargetSheet);
  $('typeIsbnBtn').addEventListener('click', openIsbnSheet);
  $('noBarcodeBtn').addEventListener('click', () => { if (!scanner.capturing) openAdd(true); });
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
  // Reloaded with a sheet open, the page is on that sheet's step in history, but nothing is open
  // now: it is a plain step again, or closing what opens next would stop there.
  if (history.state?.layer) history.replaceState(null, '', location.href);
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
  takeShare().then((share) => { if (share) handleShare(share); });
  openLinkedBook();
  if (new URLSearchParams(location.search).has('scan')) {
    history.replaceState(null, '', location.pathname + location.hash);
    openScanner();
  }
}

init();
