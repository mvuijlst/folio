// Books and their editions (docs/work-edition-plan.md). A book on the shelf is one record: the
// work you know by its title and writers, with the editions of it you have or read inside
// (`editions`: the paperback, the audiobook, the translation). Reading status is the book's;
// every other list says where a copy is, and belongs to an edition. A read is of one edition.
//
// Pure functions only, no DOM: the app imports them, and so do the tests (node --test tests/).
// The server has the same in server/shelf/works.py; tests/fixtures/works/ holds old records
// and what each must become, and both sides are tested against them.

/** What moved from a book into its editions in the new shape (v: 2). */
export const MOVED = ['format', 'language', 'publisher', 'date', 'pages', 'duration', 'isbn', 'asin',
  'cover', 'coverRatio', 'coverSource', 'coverFull', 'thumb', 'coverPhoto', 'coverOriginal', 'coverCrop', 'people'];
/** The lists of the app's reading-status set; a user's own lists in that set come on top. */
export const STATUS = ['to-read', 'reading', 'read', 'abandoned'];
/** A read that is planned or running: the book is on one of these. */
export const OPEN = ['to-read', 'reading'];
const COVER = ['cover', 'coverRatio', 'coverSource', 'coverFull', 'thumb', 'coverPhoto', 'coverOriginal', 'coverCrop'];
// The facts of an edition that publishing tracks (boekenState), by how far a state goes.
const TRACKED = {
  1: ['publisher', 'date', 'pages', 'isbn', 'cover', 'people'],
  2: ['publisher', 'date', 'pages', 'isbn', 'cover', 'people', 'format', 'duration'],
  3: ['publisher', 'date', 'pages', 'isbn', 'cover', 'people', 'format', 'duration', 'language'],
};

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const empty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);
const clone = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));

/** For comparing names and titles: no case, no accents, no punctuation (as boeken.fold on the server). */
export const fold = (s) => (String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[a-z0-9]+/g) || []).join(' ');

/** People as they are compared: names and roles as plain text, nobody twice or nameless. */
export function tidyPeople(people) {
  const out = [], seen = new Set();
  for (const person of Array.isArray(people) ? people : []) {
    if (!isObj(person)) continue;
    const name = String(person.name ?? '').split(/\s+/).filter(Boolean).join(' ');
    if (!name || seen.has(fold(name))) continue;
    seen.add(fold(name));
    out.push({ name, role: String(person.role ?? '').split(/\s+/).filter(Boolean).join(' ') });
  }
  return out;
}

/** The moved fields of `x` that say something, copied. */
export function factsOf(x) {
  const out = {};
  if (!isObj(x)) return out;
  for (const key of MOVED) if (!empty(x[key])) out[key] = clone(x[key]);
  return out;
}

/** What makes two editions one: the same facts, and the same cover picture. */
function identity(e) {
  const v = (key) => (empty(e[key]) ? '' : e[key]);
  const people = tidyPeople(e.people);
  return JSON.stringify([v('format'), v('isbn'), v('asin'), v('publisher'), v('date'), v('pages'), v('duration'), v('language'),
    people.length ? people : '', v('coverSource') || v('cover') || v('thumb')]);
}

const statusSet = (status) => new Set([...STATUS, ...(status || [])]);
const isOpen = (lists) => OPEN.some((id) => isObj(lists) && lists[id]);
const byDate = (reviews) => reviews.map((r, i) => [r, i]).filter(([r]) => isObj(r) && r.date)
  .sort(([a, i], [b, j]) => (a.date < b.date ? -1 : a.date > b.date ? 1 : i - j)).map(([r]) => r);

/** The edition a review points at, or undefined. */
export const editionOf = (work, id) => (work.editions || []).find((e) => e.id === id);

/** The edition of the latest dated read (that wasn't given up, when `finished`), or undefined. */
export function latestRead(work, { finished = false } = {}) {
  const reads = byDate(work.reviews || []).filter((r) => !finished || !r.dnf);
  for (let i = reads.length - 1; i >= 0; i--) { const e = editionOf(work, reads[i].ed); if (e) return e; }
  return undefined;
}

/**
 * The edition the reading status and progress are about, the one a new read starts from, and
 * the face of the book where nothing else decides: `main` when it names one, else the edition
 * of the latest dated read, else the first under the book's own title (not a translation), else
 * the first.
 */
export function mainEdition(work) {
  const editions = work.editions || [];
  return editionOf(work, work.main) || latestRead(work) || editions.find((e) => !e.title) || editions[0];
}

/**
 * When a book came out, as far as its editions tell: the earliest edition's date as YYYY-MM-DD
 * (a part not known is 00), or '' when none says. A later reprint is all some books know of.
 */
export function firstOut(work) {
  let first = '';
  for (const e of work.editions || []) {
    const m = String(e?.date || '').match(/(?:^|\D)(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
    if (!m) continue;
    const day = `${m[1]}-${(m[2] || '0').padStart(2, '0')}-${(m[3] || '0').padStart(2, '0')}`;
    if (!first || day < first) first = day;
  }
  return first;
}

/**
 * The categories a book new to the shelf (`candidate`: its author and, where known, its series)
 * would have, going by the books that are there: those of its series, else those the other
 * books of its first writer agree on (at least `least` of them, `share` of those the same).
 * A writer of both fantasy and history says nothing. → an array of its own, or null when the
 * shelf doesn't say. Measured on a shelf of 3,400: right for 98% by series, 97% by writer.
 */
export function categoriesLike(candidate, books, { least = 3, share = 0.75 } = {}) {
  const others = books.filter((b) => b !== candidate && (!candidate.id || b.id !== candidate.id) && !b.pending && b.categories?.length);
  const commonest = (rows) => {
    const sets = new Map();
    for (const b of rows) {
      const key = [...b.categories].sort().join(' ');
      const set = sets.get(key) || sets.set(key, { categories: b.categories, n: 0 }).get(key);
      set.n++;
    }
    return [...sets.values()].sort((a, b) => b.n - a.n)[0];
  };
  const series = fold(candidate.series);
  if (series) {
    const best = commonest(others.filter((b) => fold(b.series) === series));
    if (best) return [...best.categories];
  }
  const first = (b) => fold(String(b.author || '').split(',')[0]);
  const writer = first(candidate);
  if (!writer) return null;
  const theirs = others.filter((b) => first(b) === writer);
  const best = commonest(theirs);
  return best && theirs.length >= least && best.n / theirs.length >= share ? [...best.categories] : null;
}

/**
 * One writer's books in the order of their work: each series together and in its own order, the
 * series by when their first book came out, and the books on their own by when they came out,
 * except that one that came out while a series was still running waits until that series is done
 * (and any series running on when it is). → Map(book → a key that sorts so, as a string).
 */
export function writerOrder(works) {
  const NEVER = '9999-99-99';
  const runs = new Map();   // series → [first, last]: when it began and when its last book came out
  for (const w of works) {
    const day = firstOut(w);
    if (!w.series || !day) continue;
    const run = runs.get(fold(w.series));
    if (!run) runs.set(fold(w.series), [day, day]);
    else { if (day < run[0]) run[0] = day; if (day > run[1]) run[1] = day; }
  }
  const number = (w) => { const n = parseFloat(w.seriesNumber); return String(Number.isFinite(n) ? Math.round(n * 100) : 99999999).padStart(8, '0'); };
  const out = new Map();
  for (const w of works) {
    const day = firstOut(w) || NEVER;
    if (w.series) {
      const begun = runs.get(fold(w.series))?.[0] || NEVER;
      out.set(w, `${begun} 0 ${fold(w.series)} ${number(w)} ${day}`);
      continue;
    }
    let at = day;
    for (let moved = true; moved && at !== NEVER;) {
      moved = false;
      for (const [begun, done] of runs.values()) if (begun <= at && at < done) { at = done; moved = true; }
    }
    out.set(w, `${at} 1 ${day}`);
  }
  return out;
}

/**
 * The edition a row shows. Among the editions on `list` (when it is a list of where a copy is)
 * that pass `test`: the main one if it is among them, else the first; null when none is, and
 * the book is not in that place. On Read and Did not finish the latest read's edition comes
 * first instead: a book finished as an e-book shows the e-book there.
 */
export function faceEdition(work, { list = null, test = null, status } = {}) {
  const statuses = statusSet(status);
  const editions = work.editions || [];
  const here = list && !statuses.has(list) ? editions.filter((e) => isObj(e.lists) && e.lists[list]) : editions;
  const passing = test ? here.filter((e) => test(e)) : here;
  if (!passing.length) return null;
  const done = list && statuses.has(list) && !OPEN.includes(list);
  const start = (done && latestRead(work)) || mainEdition(work);
  return passing.includes(start) ? start : passing[0];
}

/**
 * {listId: {at, note}}: the lists the book is on, its own (reading status) and its editions'
 * (where a copy is), the earliest `at` of each, the notes of several editions joined. A book you
 * have finished and now plan or do another read of is under Read as well (`at`: that read's day).
 */
export function shelves(work) {
  const on = {};
  const add = (id, entry) => {
    const at = entry?.at || work.added || '';
    if (!on[id]) { on[id] = { ...entry, at }; return; }
    if (at && at < on[id].at) on[id].at = at;
    if (entry?.note) on[id].note = on[id].note ? `${on[id].note}; ${entry.note}` : entry.note;
  };
  for (const [id, entry] of Object.entries(isObj(work.lists) ? work.lists : {})) add(id, entry);
  for (const e of work.editions || []) for (const [id, entry] of Object.entries(isObj(e.lists) ? e.lists : {})) add(id, entry);
  if (!on.read && isOpen(work.lists)) {
    const read = byDate(work.reviews || []).filter((r) => !r.dnf).pop();
    if (read) on.read = { at: `${read.date}T12:00:00.000Z`, again: true };
  }
  return on;
}

/** The next free id for an edition: e1, e2, … */
export function nextEditionId(work) {
  const used = new Set((work.editions || []).map((e) => e.id));
  let n = (work.editions || []).length + 1;
  while (used.has(`e${n}`)) n += 1;
  return `e${n}`;
}

/**
 * The invariants of a stored book (plan 4.2), enforced in place; → the book. A moved field
 * found on the work goes to the main edition, a list found at the wrong level to the right one.
 */
export function settle(work, status) {
  const statuses = statusSet(status);
  work.editions = Array.isArray(work.editions) ? work.editions.filter(isObj) : [];
  if (!work.editions.length) {
    const up = upgrade({ ...work, editions: undefined }, status);
    for (const key of Object.keys(work)) delete work[key];
    return Object.assign(work, up);
  }
  // Unique ids.
  const seen = new Set(), all = new Set(work.editions.map((e) => e.id));
  let n = 1;
  for (const e of work.editions) {
    if (!e.id || seen.has(e.id)) {
      while (all.has(`e${n}`)) n += 1;
      e.id = `e${n}`;
      all.add(e.id);
    }
    seen.add(e.id);
  }
  if (work.main && !editionOf(work, work.main)) delete work.main;
  // Moved fields at the top level belong to the main edition.
  const main = mainEdition(work);
  for (const key of MOVED) {
    if (!Object.hasOwn(work, key)) continue;   // own fields only (a guard may watch the rest: app.js)
    if (!empty(work[key])) main[key] = work[key]; else delete main[key];
    delete work[key];
  }
  // Lists at the level they belong to.
  const own = isObj(work.lists) ? work.lists : {};
  work.lists = {};
  for (const [id, entry] of Object.entries(own)) {
    if (statuses.has(id)) work.lists[id] = entry;
    else (main.lists ||= {})[id] ??= entry;
  }
  for (const e of work.editions) {
    if (!isObj(e.lists)) { delete e.lists; continue; }
    for (const id of Object.keys(e.lists)) {
      if (!statuses.has(id)) continue;
      if (!work.lists[id] || (e.lists[id]?.at && e.lists[id].at < work.lists[id].at)) work.lists[id] = e.lists[id];
      delete e.lists[id];
    }
    if (!Object.keys(e.lists).length) delete e.lists;
  }
  // Every review points at an edition, and carries none itself.
  const fallback = mainEdition(work).id;
  if (Array.isArray(work.reviews)) {
    for (const r of work.reviews) {
      if (!isObj(r)) continue;
      delete r.edition;
      if (!editionOf(work, r.ed)) r.ed = fallback;
    }
  }
  // `main` lasts as long as the read it is about is planned or running.
  if (!isOpen(work.lists)) delete work.main;
  work.v = 2;
  return work;
}

/**
 * An old record (one edition's facts at the top level, each read carrying its edition) as a
 * new one (plan 6.4). Deterministic, because a device and the server each upgrade the same
 * record and reviews point at editions by id. Returns a new object; `versionOf` is left for
 * the server to merge.
 */
export function upgrade(book, status) {
  if (Array.isArray(book.editions) && book.editions.length) return settle(clone(book), status);
  const statuses = statusSet(status);
  const own = factsOf(book);
  const work = {};
  for (const [key, value] of Object.entries(book)) if (!MOVED.includes(key) && key !== 'editions') work[key] = clone(value);
  const editions = [];
  const made = new Map();
  const make = (facts) => { const e = { id: `e${editions.length + 1}`, ...facts }; editions.push(e); return e; };

  // 2. Each read's edition, once per edition.
  const reviews = Array.isArray(book.reviews) ? book.reviews.map((r) => {
    if (!isObj(r)) return clone(r);
    const { edition, ...rest } = clone(r);
    const facts = factsOf(edition);
    if (!Object.keys(facts).length) return rest;
    const key = identity(facts);
    let e = made.get(key);
    if (!e) made.set(key, e = make(facts));
    else for (const [k, v] of Object.entries(facts)) if (!(k in e)) e[k] = v;
    return { ...rest, ed: e.id };
  }) : null;
  if (reviews) work.reviews = reviews;

  // 3. The book's own facts.
  let home;
  const reads = byDate(reviews || []);
  if (!editions.length) home = make(own);
  else if (book.boekenState) {
    if (isOpen(book.lists) && reads.length) {
      // Another read planned or running: the facts are those of the edition of that read.
      home = made.get(identity(own));
      if (home) { for (const [k, v] of Object.entries(own)) if (!(k in home)) home[k] = v; }
      else home = make(own);
    } else {
      // The facts came from the booklog, which has them per read; only what was changed here
      // and not published yet (what differs from boekenState) is the app's own.
      home = editions.find((e) => e.id === reads.at(-1)?.ed) || editions[0];
      const state = isObj(book.boekenState) ? book.boekenState : {};
      for (const key of TRACKED[state.tracks] || TRACKED[1]) {
        const now = key === 'people' ? tidyPeople(own.people) : own[key];
        const was = state[key];
        if (JSON.stringify(empty(now) ? null : now) === JSON.stringify(empty(was) ? null : was)) continue;
        for (const k of key === 'cover' ? COVER : [key]) { if (k in own) home[k] = clone(own[k]); else delete home[k]; }
      }
      for (const k of ['thumb', 'coverFull', 'coverRatio']) if (!(k in home) && k in own) home[k] = own[k];
    }
  } else {
    // Only in the app: the book's facts are the truth. A read's edition of the same format and
    // ISBN is a stale copy of them.
    home = editions.find((e) => (e.format || '') === (own.format || '') && (e.isbn || '') === (own.isbn || ''));
    if (home) { for (const k of MOVED) delete home[k]; Object.assign(home, own); }
    else home = make(own);
  }

  // 4. A read that doesn't say which edition was of the book's own.
  if (reviews) for (const r of reviews) if (isObj(r) && !r.ed) r.ed = home.id;

  // 5. Reading status is the book's; every other list is of the copy the book stood for.
  const lists = isObj(book.lists) ? book.lists : { library: { at: book.added } };
  work.lists = {};
  for (const [id, entry] of Object.entries(lists)) {
    if (statuses.has(id)) work.lists[id] = clone(entry);
    else (home.lists ||= {})[id] = clone(entry);
  }
  if (book.added) for (const e of editions) e.added = book.added;
  work.editions = editions;
  // 6. `main` while a read of it is planned or running.
  if (isOpen(work.lists)) work.main = home.id; else delete work.main;
  delete work.v;
  work.v = 2;
  return settle(work, status);
}

/** A flat proposal (from a lookup, the assistant, a form) as a new book with one edition. */
export function newWork(flat, status) {
  const statuses = statusSet(status);
  const work = {}, edition = { id: 'e1', ...factsOf(flat) };
  for (const [key, value] of Object.entries(flat)) if (!MOVED.includes(key) && key !== 'lists') work[key] = clone(value);
  work.lists = {};
  for (const [id, entry] of Object.entries(isObj(flat.lists) ? flat.lists : {})) {
    if (statuses.has(id)) work.lists[id] = entry; else (edition.lists ||= {})[id] = entry;
  }
  if (work.added) edition.added = work.added;
  work.editions = [edition];
  work.v = 2;
  return work;
}

/**
 * A flat proposal as another edition of `work`, on the lists of where a copy is that it names.
 * Its reading-status lists are left to the caller. → the new edition (the work is changed).
 */
export function addEdition(work, flat, { status, added } = {}) {
  const statuses = statusSet(status);
  const edition = { id: nextEditionId(work), ...factsOf(flat) };
  if (!empty(flat.title) && fold(flat.title) !== fold(work.title)) edition.title = String(flat.title);
  for (const [id, entry] of Object.entries(isObj(flat.lists) ? flat.lists : {})) if (!statuses.has(id)) (edition.lists ||= {})[id] = entry;
  if (added) edition.added = added;
  work.editions.push(edition);
  return edition;
}

/** A title as it is compared: folded, and without what follows a colon or a dash (the subtitle). */
const mainTitle = (title) => fold(String(title || '').split(/\s*[:—–]\s*|\s+-\s+/)[0]);
export function sameTitle(a, b) {
  const fa = fold(a), fb = fold(b);
  if (!fa || !fb) return false;
  return fa === fb || mainTitle(a) === fb || fa === mainTitle(b);
}
/** An edition's own title is dropped where it is the book's (it says nothing then). */
function tidyTitles(work) {
  for (const e of work.editions || []) if (e.title && fold(e.title) === fold(work.title)) delete e.title;
}
const firstWriter = (author) => fold(String(author || '').split(',')[0]);
const number = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  een: 1, twee: 2, drie: 3, vier: 4, vijf: 5, zes: 6, zeven: 7, acht: 8, negen: 9, tien: 10 };
const ROMAN = { i: 1, v: 5, x: 10 };
const VOLUME = new RegExp(`\\b(?:vol|volume|deel|dl|band|bd|tome|tomo|book|boek|part)\\s+(\\d+|[ivx]+|${Object.keys(WORDS).join('|')})\\b`);
/** The volume a title says it is ("History of the Art of War, Volume II", "Vol. 4", "Deel 3", "Book One"), or null. */
export function volumeOf(title) {
  const said = fold(title).match(VOLUME)?.[1];
  if (!said) return null;
  if (/^\d+$/.test(said)) return Number(said);
  if (WORDS[said]) return WORDS[said];
  if (!/^x{0,3}(ix|iv|v?i{0,3})$/.test(said)) return null;
  let n = 0;
  for (let i = 0; i < said.length; i++) n += ROMAN[said[i]] < (ROMAN[said[i + 1]] || 0) ? -ROMAN[said[i]] : ROMAN[said[i]];
  return n || null;
}
/** Where a book stands in its series or set: its series number, else the volume its title says. */
const placeOf = (b, title = b.title) => number(b.seriesNumber) ?? volumeOf(title);
/** Two places that both say something and differ: two volumes, never one book. */
const otherVolume = (n, m) => n != null && m != null && n !== m;

/**
 * The book on the shelf that `candidate` (a flat proposal) is another edition of, or undefined:
 * the same Open Library work, or the same title by the same first writer, unless both say where
 * they stand in a series (or which volume they are) and that differs: Open Library has works
 * that hold every volume of a set. Two different olids are two books, even with one title:
 * catalogues give the volumes of a set a bare title of the set. Open Library's duplicate works
 * then stay apart, to be combined (twins still finds them). Translations are never found this way.
 */
export function findWork(candidate, books) {
  const olid = String(candidate.olid || '');
  const n = placeOf(candidate);
  const byOlid = olid && books.find((b) => b.olid && b.olid === olid && !otherVolume(n, placeOf(b)));
  if (byOlid) return byOlid;
  const writer = firstWriter(candidate.author);
  if (!writer || !fold(candidate.title)) return undefined;
  return books.find((b) => {
    if (firstWriter(b.author) !== writer || (olid && b.olid && b.olid !== olid)) return false;
    return [b.title, ...(b.editions || []).map((e) => e.title)].some((title) => title && sameTitle(title, candidate.title)
      && !otherVolume(n, placeOf(b, title)));
  });
}

/** Whether `a` and `b` were said to be two books (`apart`: the ids of the books a book is not). */
export const keptApart = (a, b) => (a.apart || []).includes(b.id) || (b.apart || []).includes(a.id);

/** `a` and `b` are two books, not one: each says so of the other (in place). */
export function setApart(a, b) {
  if (!a?.id || !b?.id || a.id === b.id) return;
  for (const [x, y] of [[a, b], [b, a]]) if (!(x.apart || []).includes(y.id)) x.apart = [...(x.apart || []), y.id];
}

/** The books that `book` may be the same book as (twins), the ones it was said not to be left out. */
export function twinsOf(book, books) {
  return books.filter((b) => b !== book && twins([b, book]).size > 0);
}

/**
 * Books that may be the same book as another on the shelf (the same olid, or title and first
 * writer), unless the two were said to be two books (setApart). → Set of ids
 */
export function twins(books) {
  const out = new Set();
  const index = new Map();
  const put = (key, b) => { if (key) (index.get(key) || index.set(key, []).get(key)).push(b); };
  const titles = (b) => [b.title, ...(b.editions || []).map((e) => e.title)].filter(Boolean);
  // Each book under its olid and under each of its titles, whole; then each title is looked up
  // whole and without its subtitle (one may be the other with a subtitle after it).
  for (const b of books) {
    put(b.olid && `olid:${b.olid}`, b);
    const writer = firstWriter(b.author);
    if (writer) for (const title of titles(b)) put(fold(title) && `t:${fold(title)}|${writer}`, b);
  }
  const pair = (a, b) => {
    if (a === b || otherVolume(placeOf(a), placeOf(b)) || keptApart(a, b)) return;
    out.add(a.id); out.add(b.id);
  };
  for (const b of books) {
    for (const other of index.get(b.olid && `olid:${b.olid}`) || []) pair(b, other);
    const writer = firstWriter(b.author);
    if (!writer) continue;
    for (const title of titles(b)) for (const key of new Set([fold(title), mainTitle(title)])) for (const other of index.get(key && `t:${key}|${writer}`) || []) pair(b, other);
  }
  return out;
}

const PROGRESS = ['pagesRead', 'durationLeft', 'percentRead', 'progressUnit'];

/**
 * `absorbed`'s editions and reads in `survivor` (both changed in place; → survivor). The
 * reading status of the absorbed book wins when a read of it is planned or running and none of
 * the survivor is; its edition is then the one being read.
 *
 * Two books with different titles (a translation): each edition keeps the title of the book it
 * came from, and the combined book goes by the survivor's title, or with `title: 'theirs'` by the
 * absorbed book's (with its place in a series).
 */
export function combine(survivor, absorbed, { title = 'mine' } = {}) {
  const ids = new Map();
  const differ = !!absorbed.title && !sameTitle(survivor.title, absorbed.title);
  if (differ && title === 'theirs') {
    for (const e of survivor.editions) if (!e.title) e.title = survivor.title;
    survivor.title = absorbed.title;
    for (const key of ['series', 'seriesNumber', 'seriesLabel', 'olid']) if (!empty(absorbed[key])) survivor[key] = clone(absorbed[key]);
  }
  for (const e of absorbed.editions || []) {
    const copy = clone(e);
    copy.id = editionOf(survivor, e.id) || [...ids.values()].includes(e.id) ? nextEditionId(survivor) : e.id;
    if (differ && !copy.title) copy.title = absorbed.title;
    ids.set(e.id, copy.id);
    survivor.editions.push(copy);
  }
  tidyTitles(survivor);
  for (const r of absorbed.reviews || []) {
    if (!isObj(r)) continue;
    (survivor.reviews ||= []).push({ ...clone(r), ed: ids.get(r.ed) || mainEdition(survivor).id });
  }
  const theirs = isObj(absorbed.lists) ? absorbed.lists : {};
  const mine = isObj(survivor.lists) ? survivor.lists : {};
  if ((isOpen(theirs) && !isOpen(mine)) || (!Object.keys(mine).length && Object.keys(theirs).length)) {
    survivor.lists = clone(theirs);
    const main = mainEdition(absorbed);
    if (isOpen(theirs) && main) survivor.main = ids.get(main.id);
    for (const key of PROGRESS) { if (key in absorbed) survivor[key] = clone(absorbed[key]); else delete survivor[key]; }
  }
  for (const key of ['olid', 'series', 'seriesNumber', 'seriesLabel', 'issues', 'originalLanguage', 'originalTitle']) if (empty(survivor[key]) && !empty(absorbed[key])) survivor[key] = clone(absorbed[key]);
  for (const key of ['categories', 'tags']) {
    const all = [...(survivor[key] || []), ...(absorbed[key] || [])];
    const seen = new Set();
    if (all.length) survivor[key] = all.filter((v) => !seen.has(fold(v)) && seen.add(fold(v)));
  }
  if (absorbed.dropReads?.length) survivor.dropReads = [...new Set([...(survivor.dropReads || []), ...absorbed.dropReads])];
  // What either was said not to be, the combined book is not either (but it is itself).
  const apart = [...new Set([...(survivor.apart || []), ...(absorbed.apart || [])])].filter((id) => id !== survivor.id && id !== absorbed.id);
  if (apart.length) survivor.apart = apart; else delete survivor.apart;
  return survivor;
}

/**
 * Edition `edId` of `work`, with its reads, as a book of its own (`id`, `added`). → {work, piece}
 * (work changed in place). A read of it that was planned or running goes along with it.
 */
export function split(work, edId, { id, added, status } = {}) {
  const edition = editionOf(work, edId);
  const reading = isOpen(work.lists) && mainEdition(work) === edition;
  const piece = { id, added };
  for (const key of ['title', 'author', 'series', 'seriesNumber', 'seriesLabel', 'categories', 'tags', 'olid']) if (!empty(work[key])) piece[key] = clone(work[key]);
  if (edition.title) { piece.title = edition.title; }
  const mine = (work.reviews || []).filter((r) => isObj(r) && r.ed === edId);
  work.reviews = (work.reviews || []).filter((r) => !mine.includes(r));
  if (!work.reviews.length) delete work.reviews;
  work.editions = work.editions.filter((e) => e !== edition);
  const moved = { ...clone(edition), id: 'e1' };
  delete moved.title;
  piece.editions = [moved];
  if (mine.length) piece.reviews = mine.map((r) => ({ ...clone(r), ed: 'e1' }));
  const rated = byDate(piece.reviews || []).filter((r) => r.rating != null).pop();
  if (rated) piece.rating = rated.rating;
  piece.lists = {};
  if (reading) {
    piece.lists = clone(work.lists);
    piece.main = 'e1';
    for (const key of PROGRESS) if (key in work) { piece[key] = work[key]; delete work[key]; }
    work.lists = {};
    delete work.main;
  }
  const done = (w) => byDate(w.reviews || []).filter((r) => !r.dnf).pop();
  for (const w of [work, piece]) {
    if (!Object.keys(w.lists).length && done(w)) w.lists = { read: { at: `${done(w).date}T12:00:00.000Z` } };
  }
  const rest = byDate(work.reviews || []).filter((r) => r.rating != null).pop();
  if (rest) work.rating = rest.rating; else delete work.rating;
  // What is left goes by its editions' own title when they all have the same one (the
  // translation that was split off took the book's title along).
  const left = new Set(work.editions.map((e) => e.title || ''));
  if (left.size === 1 && [...left][0]) work.title = [...left][0];
  tidyTitles(work);
  piece.v = 2;
  settle(work, status);
  settle(piece, status);
  return { work, piece };
}

/**
 * A book as the old shape had it (for showing and exporting): the edition's facts at the top
 * level, `lists` as the union. Never stored.
 */
export function flatView(work, edition = mainEdition(work)) {
  const out = { ...work, ...factsOf(edition || {}) };
  delete out.editions;
  if (edition?.title) out.title = edition.title;
  return out;
}
