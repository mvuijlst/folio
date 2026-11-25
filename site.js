// Your reading as a website (Export → Hugo, Eleventy, HTML), in a zip. Hugo and Eleventy get the
// content only, a Markdown page per read with YAML front matter, as a reading log has it (no
// theme, no configuration of yours is touched): siteFiles. HTML gets a whole website to browse,
// a page per book and pages to find them by, that needs nothing at all: htmlSite (below).
//
// The app (app.js) turns its books into entries (below) or books (htmlSite) and fetches the covers; everything
// here is pure, no DOM and no network, so the tests (tests/site.test.mjs) can run it.
//
// An entry (Hugo, Eleventy) is one read of a book, or a book where it stands now (not read yet, being read):
//   { title, bookTitle, writers: [name], people: [{name, role}], series, seriesNumber,
//     originalTitle, originalLanguage, categories: [], tags: [], lists: [name],
//     status: 'read' | 'reading' | 'to-read' | 'did-not-finish' | '',
//     date: 'YYYY-MM-DD' (the day read; else the day it was put where it is), dated: whether
//     `date` is a day of reading, rating: 0–10 or null, text: Markdown, html: the same as HTML,
//     edition: {format, publisher, year, pages, duration, minutes, isbn, language},
//     book: an id shared by the reads of one book (a reread points at the first read),
//     cover: {link, bytes?, ext?} or null: `link` an address (or a data: URL), `bytes` the
//     picture itself when it is to go in the archive }

export const TARGETS = ['hugo', 'eleventy', 'html'];

const fold = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** "The Left Hand of Darkness!" → "the-left-hand-of-darkness"; '' for a title of no letters or digits. */
export function slugify(text) {
  return fold(text).replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/œ/g, 'oe')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');
}

/**
 * Each entry with its `slug` (the page's name, unique in the export) and, for a reread, `first`:
 * the slug of the first read of that book. Oldest first; the first read of a book gets the
 * plain slug, later ones the slug with the year read ("dune-2024"), then a number.
 */
export function withSlugs(entries) {
  const sorted = [...entries].sort((a, b) => (a.date || '') < (b.date || '') ? -1 : (a.date || '') > (b.date || '') ? 1 : 0);
  const taken = new Set();
  const firstOf = new Map();
  const out = new Map();
  const free = (wanted) => {
    let slug = wanted, n = 1;
    while (taken.has(slug)) slug = `${wanted}-${++n}`;
    taken.add(slug);
    return slug;
  };
  for (const e of sorted) {
    const base = slugify(e.title) || slugify(e.bookTitle) || 'book';
    const first = e.book != null ? firstOf.get(e.book) : undefined;
    const year = String(e.date || '').slice(0, 4);
    const slug = free(first && /^\d{4}$/.test(year) && !taken.has(`${base}-${year}`) ? `${base}-${year}` : base);
    if (e.book != null && !firstOf.has(e.book)) firstOf.set(e.book, slug);
    out.set(e, { ...e, slug, ...(first && { first }) });
  }
  return entries.map((e) => out.get(e));
}

// ───────────────────────── Front matter ─────────────────────────

// A JSON string is a YAML double-quoted scalar: quotes, backslashes and line breaks escaped alike.
const scalar = (v) => (typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(String(v)));
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v));
const empty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);

/** YAML for a flat object of strings, numbers, days, lists of strings, and lists of flat objects. */
export function yaml(fields) {
  const lines = [];
  for (const [key, value] of Object.entries(fields)) {
    if (empty(value)) continue;
    if (Array.isArray(value) && value.every((v) => v && typeof v === 'object')) {
      lines.push(`${key}:`);
      for (const item of value) {
        Object.entries(item).filter(([, v]) => !empty(v)).forEach(([k, v], i) => lines.push(`${i ? '   ' : ' - '}${k}: ${scalar(v)}`));
      }
    } else if (Array.isArray(value)) lines.push(`${key}: [${value.map(scalar).join(', ')}]`);
    else if (key === 'date' && isDay(value)) lines.push(`${key}: ${value}`);   // a date, not a string, for Hugo and Eleventy alike
    else lines.push(`${key}: ${scalar(value)}`);
  }
  return lines.join('\n');
}

/** Where a cover is in the export: its address in the site (archive) or elsewhere (link). */
function coverPlaces(entries, include) {
  const named = new Map();   // the same picture (rereads of one edition) is in the archive once
  const files = [];
  const where = new Map();
  for (const e of entries) {
    const c = e.cover;
    if (!c || (!c.link && !c.bytes)) continue;
    if (include && c.bytes) {
      const key = c.link || e.slug;
      if (!named.has(key)) {
        const name = `${e.slug}.${c.ext || 'jpg'}`;
        named.set(key, name);
        files.push({ name, bytes: c.bytes });
      }
      where.set(e, { file: named.get(key) });
    } else if (c.link) where.set(e, { link: c.link });
  }
  return { files, where };
}

const STATUS_WORD = { read: 'read', reading: 'reading', 'to-read': 'to-read', 'did-not-finish': 'did-not-finish' };

/** The front matter of an entry's page. `target`: 'hugo' or 'eleventy'; `cover`: its address. */
export function frontOf(e, target, cover = '') {
  const writers = e.writers || [];
  const others = (e.people || []).filter((p) => p.role && !writers.includes(p.name));
  const ed = e.edition || {};
  return {
    title: e.title,
    date: e.date || '',
    ...(target === 'hugo' && { slug: e.slug }),
    book: e.bookTitle && e.bookTitle !== e.title ? e.bookTitle : '',
    authors: writers,
    contributors: others.map((p) => ({ name: p.name, role: p.role })),
    series: e.series ? [e.series] : [],
    series_number: e.series && e.seriesNumber !== '' && e.seriesNumber != null ? (Number.isFinite(Number(e.seriesNumber)) ? Number(e.seriesNumber) : String(e.seriesNumber)) : '',
    original_title: e.originalTitle || '',
    original_language: e.originalLanguage || '',
    status: STATUS_WORD[e.status] || '',
    reread_of: e.first || '',
    rating: e.rating ?? '',
    stars: e.rating != null ? Math.round(e.rating) / 2 : '',
    format: ed.format || '',
    publisher: ed.publisher || '',
    year: ed.year ? Number(ed.year) : '',
    pages: ed.format !== 'audiobook' && ed.pages ? Number(ed.pages) : '',
    duration: ed.format === 'audiobook' ? ed.duration || '' : '',
    minutes: ed.format === 'audiobook' && ed.minutes ? ed.minutes : '',
    isbn: ed.isbn || '',
    language: ed.language || '',
    categories: e.categories || [],
    // Eleventy makes a collection of every tag: all books are in "books", and in their own tags.
    tags: target === 'eleventy' ? ['books', ...(e.tags || []).filter((t) => t !== 'books')] : e.tags || [],
    lists: e.lists || [],
    cover,
  };
}

const markdownPage = (front, text) => `---\n${yaml(front)}\n---\n${text && text.trim() ? `\n${text.trim()}\n` : ''}`;

const README = {
  hugo: `Folio: your reading, for Hugo

  content/books/   one page per read (a reread points at the first read: reread_of),
                   and a page for each book not read yet or being read (status)
  static/covers/   the covers, if they went in the archive (else cover is their address)

Unpack this into your site. To have pages per author, series, category and tag, add to
hugo.toml:

  [taxonomies]
    author = "authors"
    series = "series"
    category = "categories"
    tag = "tags"

rating is out of 10 (stars: out of 5, halves allowed). date is the day read, or the day the
book was put where it is (status: reading, to-read; none for a book on none of those).
No layouts are included: Hugo's default list and single templates show the pages; your theme
can use any of the fields in the front matter.
`,
  eleventy: `Folio: your reading, for Eleventy

  books/    one page per read (a reread points at the first read: reread_of), and a page
            for each book not read yet or being read (status)
  covers/   the covers, if they went in the archive (else cover is their address)

Unpack this into your site's input folder. Every page is tagged "books", so
collections.books holds them all; the books' own tags are collections too. For the covers,
add to your Eleventy configuration:

  eleventyConfig.addPassthroughCopy("covers");

A layout for the pages goes in books/books.json, e.g. { "layout": "book.njk" }.

rating is out of 10 (stars: out of 5, halves allowed). date is the day read, or the day the
book was put where it is (status: reading, to-read; none for a book on none of those).
`,
};

// ───────────────────────── HTML: a site to browse ─────────────────────────
//
// Not a page per read, as for Hugo and Eleventy, but a page per book, and around them pages to
// find them by: a home page, all books and each list exported as pages of covers, each author,
// series, category and tag. Every link is relative, so the folder works anywhere, from the disk too.
//
// A book, as the app hands it over:
//   { id, title, originalTitle, originalLanguage (its name), writers: [name],
//     people: [{name, role (as shown), sortAs ("Le Guin, Ursula K.")}], series, seriesNumber
//     (as shown), seriesOrder (a number, or null), categories: [name], tags: [name],
//     status: 'read' | 'reading' | 'to-read' | 'did-not-finish' | '', rating (0–10, the latest),
//     added: day, lists: [{id, since: day, note}] (only the lists exported),
//     cover: {link, large, bytes?, ext?} or null (link: the small picture, large: the large one),
//     editions: [{id, title, format, publisher, year, pages, duration, isbn, language, main, cover}],
//     reads: [{date, rating, dnf, html, edition}], note: html (a review without a reading date) }
// Lists: [{id, name}], the lists exported, in their order.

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fill = (text, values) => String(text).replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '');

/** The words the site uses, in English; the app hands its own language's. */
export const WORDS = {
  title: 'Books',
  home: 'Home', books: 'Books', lists: 'Lists', authors: 'Authors', series: 'Series', categories: 'Categories', tags: 'Tags',
  allBooks: 'All books', readingNow: 'Reading now', recentlyRead: 'Recently read', seeAll: 'See all',
  count: (n) => (n === 1 ? '1 book' : `${n} books`),
  page: 'Page {n} of {all}', previous: 'Previous', next: 'Next', pages: 'Pages',
  inSeries: 'Book {n} in {series}', partOf: 'In {series}',
  read: 'Read', reading: 'Reading', 'to-read': 'To read', 'did-not-finish': 'Did not finish',
  readOn: 'Read {date}', gaveUp: 'Stopped {date}', since: 'Since {date}', added: 'Added {date}',
  reads: 'Read', note: 'Note', editions: 'Editions', mainEdition: 'The edition shown',
  publisher: 'Publisher', published: 'Published', pageCount: 'Pages', length: 'Length', isbn: 'ISBN',
  language: 'Language', format: 'Format', originalTitle: 'Original title', originalLanguage: 'Original language',
  pagesCount: '{n} pages', by: 'by', made: 'Made with Folio, {date}',
  paper: 'Paper', ebook: 'E-book', audiobook: 'Audiobook',
  coverOf: 'Cover of {title}', unnumbered: 'Not numbered',
};

/** ★★★★½: a rating of 0–10 as five stars. */
export const stars = (rating) => {
  if (rating == null) return '';
  const r = Math.max(0, Math.min(10, Math.round(rating)));
  return '★'.repeat(Math.floor(r / 2)) + (r % 2 ? '½' : '') + '☆'.repeat(5 - Math.ceil(r / 2));
};

/** How a title is put in order: without accents, case or a leading article. */
const titleKey = (title) => fold(title).replace(/^(?:the|an?|de|het|een|le|la|les|der|die|das|el|los|las|il|lo|l['’])\s*(?=\S)/, '').trim();
const byTitle = (a, b) => titleKey(a.title).localeCompare(titleKey(b.title)) || String(a.title).localeCompare(String(b.title));
const newest = (key) => (a, b) => String(key(b) || '').localeCompare(String(key(a) || '')) || byTitle(a, b);
const lastRead = (book) => (book.reads || []).reduce((m, r) => (r.date > m ? r.date : m), '');

/** Pages of a list of things, `size` at a time (at least one page, empty if need be). */
export function paginate(items, size) {
  const pages = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages.length ? pages : [[]];
}

/** The page numbers a pager shows: all of few, else the first, the last and those around `at` (0 for a gap). */
export function pagerNumbers(at, all) {
  if (all <= 9) return Array.from({ length: all }, (_, i) => i + 1);
  const keep = new Set([1, all, at - 2, at - 1, at, at + 1, at + 2].filter((n) => n >= 1 && n <= all));
  const out = [];
  for (const n of [...keep].sort((a, b) => a - b)) {
    if (out.length && n - out[out.length - 1] > 1) out.push(0);
    out.push(n);
  }
  return out;
}

/** Slugs of things by a name of theirs, unique: Map id → slug. */
function slugsById(things, nameOf, fallback) {
  const taken = new Set();
  const out = new Map();
  for (const thing of things) {
    const base = slugify(nameOf(thing)) || fallback;
    let slug = base, n = 1;
    while (taken.has(slug)) slug = `${base}-${++n}`;
    taken.add(slug);
    out.set(thing.id, slug);
  }
  return out;
}

/** Slugs of names, unique: Map name → slug. */
function slugsFor(keys, fallback) {
  const taken = new Set();
  const out = new Map();
  for (const key of keys) {
    if (out.has(key)) continue;
    const base = slugify(key) || fallback;
    let slug = base, n = 1;
    while (taken.has(slug)) slug = `${base}-${++n}`;
    taken.add(slug);
    out.set(key, slug);
  }
  return out;
}

// A cover that doesn't load is shown as a book without one: its title.
const MISSING = "this.replaceWith(Object.assign(document.createElement('span'),{className:'ph',textContent:this.dataset.title}))";

const STYLE = `
:root { color-scheme: light dark; --ink: #1f1d1a; --soft: #6d6a64; --line: #e2dfd8; --paper: #fbfaf7; --card: #f1eee7; --link: #8a3b12; --star: #b07d00; }
@media (prefers-color-scheme: dark) { :root { --ink: #ebe8e2; --soft: #a39f97; --line: #393733; --paper: #191816; --card: #25231f; --link: #f0a070; --star: #e0b040; } }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 17px/1.55 Georgia, "Times New Roman", serif; }
a { color: var(--link); text-decoration-thickness: 1px; text-underline-offset: 2px; }
.wrap { max-width: 64rem; margin: 0 auto; padding-left: 1rem; padding-right: 1rem; }
.top { border-bottom: 1px solid var(--line); padding: 1.1rem 0 .9rem; }
.top .wrap { display: flex; flex-wrap: wrap; align-items: baseline; gap: .4rem 1.5rem; }
.site { font-size: 1.35rem; color: var(--ink); text-decoration: none; }
.top nav { display: flex; flex-wrap: wrap; gap: .2rem 1.1rem; font: 15px/1.6 system-ui, sans-serif; }
.top nav a { color: var(--soft); text-decoration: none; }
.top nav a:hover, .top nav a[aria-current] { color: var(--ink); }
.top nav a[aria-current] { font-weight: 600; }
main { padding-top: 2rem; padding-bottom: 3rem; }
h1 { font-size: 1.9rem; font-weight: normal; line-height: 1.2; margin: 0 0 .3rem; }
h2 { font: 600 13px/1.4 system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: var(--soft);
  margin: 2.5rem 0 1rem; padding-bottom: .4rem; border-bottom: 1px solid var(--line); }
h2 a { color: inherit; text-decoration: none; }
h2 .more { float: right; text-transform: none; letter-spacing: 0; font-weight: normal; }
.sub { color: var(--soft); margin: 0 0 1.5rem; font: 14px/1.5 system-ui, sans-serif; }
.grid { list-style: none; padding: 0; margin: 0; display: grid; gap: 1.6rem 1.1rem; grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr)); }
.card a { text-decoration: none; color: var(--ink); display: block; }
.cover { display: flex; align-items: flex-end; justify-content: center; aspect-ratio: 2 / 3; margin-bottom: .5rem; }
.cover img { display: block; max-width: 100%; max-height: 100%; height: auto; box-shadow: 0 1px 2px rgba(0,0,0,.2), 0 4px 12px rgba(0,0,0,.08); }
.ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; text-align: center; padding: .7rem;
  background: var(--card); border: 1px solid var(--line); color: var(--soft); font-style: italic; font-size: .9rem; line-height: 1.3; overflow: hidden; }
.card .t { display: block; font-weight: bold; font-size: .95rem; line-height: 1.3; }
.card a:hover .t { text-decoration: underline; }
.card .a, .card .m { display: block; color: var(--soft); font: 13px/1.4 system-ui, sans-serif; margin-top: .15rem; }
.stars { color: var(--star); letter-spacing: .04em; white-space: nowrap; }
.pager { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: .3rem .5rem; margin: 2.5rem 0 0; font: 15px/1.5 system-ui, sans-serif; }
.pager a, .pager span { padding: .2rem .55rem; border-radius: 4px; text-decoration: none; }
.pager [aria-current] { background: var(--ink); color: var(--paper); }
.pager .gap { color: var(--soft); }
.index { columns: 16rem; column-gap: 2rem; list-style: none; padding: 0; margin: 0; }
.index li { break-inside: avoid; padding: .15rem 0; }
.index small, .rows small { color: var(--soft); font: 13px system-ui, sans-serif; }
.letters { display: flex; flex-wrap: wrap; gap: .2rem .7rem; font: 15px system-ui, sans-serif; margin-bottom: 1rem; }
.letter { margin-top: 1.6rem; }
.rows { list-style: none; padding: 0; margin: 0; }
.rows > li { display: flex; align-items: center; gap: 1rem; padding: .8rem 0; border-bottom: 1px solid var(--line); }
.rows .strip { display: flex; gap: .3rem; margin-left: auto; }
.rows .strip img, .rows .strip .ph { width: 2.2rem; height: 3.3rem; object-fit: cover; padding: 0; font-size: 0; border: 0; }
.rows .name { font-size: 1.1rem; }
.book { display: grid; grid-template-columns: minmax(0, 15rem) 1fr; gap: 2rem; align-items: start; }
.book .big img { width: 100%; height: auto; box-shadow: 0 2px 4px rgba(0,0,0,.2), 0 8px 24px rgba(0,0,0,.1); }
.book .big .ph { aspect-ratio: 2 / 3; font-size: 1.2rem; }
.book .orig { color: var(--soft); font-style: italic; margin: 0; }
.book .by { font-size: 1.15rem; margin: .4rem 0; }
.book .meta { font: 14px/1.7 system-ui, sans-serif; color: var(--soft); margin: .6rem 0; }
.chips { list-style: none; padding: 0; margin: .8rem 0 0; display: flex; flex-wrap: wrap; gap: .4rem; font: 13px/1.4 system-ui, sans-serif; }
.chips li { border: 1px solid var(--line); border-radius: 99px; padding: .15rem .65rem; }
.chips a { text-decoration: none; }
.chips small { color: var(--soft); }
.people { margin: .8rem 0 0; font: 14px/1.6 system-ui, sans-serif; color: var(--soft); }
.read { padding: 1rem 0; border-bottom: 1px solid var(--line); }
.read:last-child { border-bottom: 0; }
.read .meta { font: 14px/1.5 system-ui, sans-serif; color: var(--soft); margin: 0 0 .5rem; }
.review p { margin: 0 0 .8rem; }
.review img { max-width: 100%; height: auto; }
.review blockquote { margin: 0 0 .8rem; padding-left: 1rem; border-left: 3px solid var(--line); color: var(--soft); }
.editions { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr)); }
.edition { display: flex; gap: .9rem; font: 14px/1.5 system-ui, sans-serif; }
.edition .cover { width: 3.6rem; flex: none; margin: 0; }
.edition dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 0 .8rem; }
.edition dt { color: var(--soft); }
.edition dd { margin: 0; }
.edition .name { grid-column: 1 / -1; font-weight: 600; margin-bottom: .2rem; }
.series-nav { display: flex; justify-content: space-between; gap: 1rem; margin-top: 2.5rem; padding-top: 1rem; border-top: 1px solid var(--line); font: 15px/1.5 system-ui, sans-serif; }
footer { border-top: 1px solid var(--line); padding: 1.2rem 0 2rem; font: 13px system-ui, sans-serif; color: var(--soft); }
@media (max-width: 40rem) {
  body { font-size: 16px; }
  h1 { font-size: 1.55rem; }
  .grid { grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr)); gap: 1.3rem .8rem; }
  .book { grid-template-columns: 1fr; gap: 1.2rem; }
  .book .big { max-width: 12rem; }
  .rows .strip { display: none; }
}
`.trim();

/**
 * The files of the website: [{path, data}]. `books` and `lists` as above; `covers`: 'include'
 * (pictures with bytes go in covers/) or 'link'; `words`, `longDate`, `lang`, `title`, `made`
 * (a day) say how it speaks; `pageSize`: books on a page of covers.
 */
export function htmlSite(books, { lists = [], covers = 'include', words = {}, longDate = (d) => d, lang = 'en', title, made = new Date().toISOString().slice(0, 10), pageSize = 48 } = {}) {
  const w = { ...WORDS, ...words };
  const count = typeof w.count === 'function' ? w.count : WORDS.count;
  const heading = title || w.title;
  const files = [];

  // Names: the books by title, people, series, lists, categories, tags.
  const all = [...books].sort(byTitle);
  const bookSlug = slugsById(all, (b) => b.title, 'book');   // two books of one title: the second gets a number
  const people = new Map();   // name → {name, sortAs, books: [{book, role}]}
  for (const b of all) {
    for (const p of (b.people?.length ? b.people : (b.writers || []).map((name) => ({ name, role: '' })))) {
      if (!p?.name) continue;
      const person = people.get(p.name) || people.set(p.name, { name: p.name, sortAs: p.sortAs || p.name, books: [] }).get(p.name);
      if (!person.books.some((x) => x.book === b && x.role === (p.role || ''))) person.books.push({ book: b, role: p.role || '' });
    }
  }
  const personSlug = slugsFor([...people.keys()], 'person');
  const seriesOf = new Map();
  for (const b of all) if (b.series) (seriesOf.get(b.series) || seriesOf.set(b.series, []).get(b.series)).push(b);
  const seriesSlug = slugsFor([...seriesOf.keys()], 'series');
  const exported = lists.filter((l) => all.some((b) => (b.lists || []).some((x) => x.id === l.id)));
  const listSlug = slugsById(exported, (l) => l.name, 'list');
  const grouped = (key) => {
    const map = new Map();
    for (const b of all) for (const name of b[key] || []) if (name) (map.get(name) || map.set(name, []).get(name)).push(b);
    return new Map([...map].sort(([a], [b]) => fold(a).localeCompare(fold(b))));
  };
  const categories = grouped('categories');
  const tags = grouped('tags');
  const categorySlug = slugsFor([...categories.keys()], 'category');
  const tagSlug = slugsFor([...tags.keys()], 'tag');

  // Covers: each picture once in covers/, named after the first book it belongs to.
  const coverFile = new Map();
  const placeCover = (cover, slug) => {
    if (!cover || covers !== 'include' || !cover.bytes) return;
    const key = cover.from || cover.large || cover.link || slug;
    if (coverFile.has(key)) { cover.file = coverFile.get(key); return; }
    let name = `${slug}.${cover.ext || 'jpg'}`, n = 1;
    while ([...coverFile.values()].includes(name)) name = `${slug}-${++n}.${cover.ext || 'jpg'}`;
    coverFile.set(key, name);
    cover.file = name;
    files.push({ path: `covers/${name}`, data: cover.bytes });
  };
  for (const b of all) {
    placeCover(b.cover, bookSlug.get(b.id));
    for (const e of b.editions || []) placeCover(e.cover, bookSlug.get(b.id));
  }

  // ── Pieces of a page ──
  const sections = [
    ['books', 'books/index.html', w.books, true],
    ['lists', 'lists/index.html', w.lists, exported.length > 0],
    ['authors', 'authors/index.html', w.authors, people.size > 0],
    ['series', 'series/index.html', w.series, seriesOf.size > 0],
    ['categories', 'categories/index.html', w.categories, categories.size > 0],
    ['tags', 'tags/index.html', w.tags, tags.size > 0],
  ].filter((s) => s[3]);
  const page = (path, { title: pageTitle, section, body }) => {
    const root = '../'.repeat(path.split('/').length - 1);
    const nav = sections.map(([key, href, label]) => `<a href="${root}${href}"${key === section ? ' aria-current="page"' : ''}>${esc(label)}</a>`).join('\n');
    files.push({
      path,
      data: `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${pageTitle ? `${esc(pageTitle)} · ` : ''}${esc(heading)}</title>
<link rel="stylesheet" href="${root}style.css">
</head>
<body>
<header class="top"><div class="wrap">
<a class="site" href="${root}index.html">${esc(heading)}</a>
<nav>
${nav}
</nav>
</div></header>
<main class="wrap">
${body(root)}
</main>
<footer><div class="wrap">${esc(fill(w.made, { date: longDate(made) }))}</div></footer>
</body>
</html>
`,
    });
  };
  const bookHref = (root, b) => `${root}book/${bookSlug.get(b.id)}.html`;
  const personHref = (root, name) => `${root}authors/${personSlug.get(name)}.html`;
  const seriesHref = (root, name) => `${root}series/${seriesSlug.get(name)}.html`;
  const listHref = (root, l) => `${root}lists/${listSlug.get(l.id)}.html`;
  const src = (root, cover, large) => (cover?.file ? `${root}covers/${cover.file}` : (large && cover?.large) || cover?.link || '');
  const picture = (root, b, cover, large) => {
    const s = src(root, cover, large);
    return s ? `<img src="${esc(s)}" alt="${esc(fill(w.coverOf, { title: b.title }))}" loading="lazy" data-title="${esc(b.title)}" onerror="${MISSING}">` : `<span class="ph">${esc(b.title)}</span>`;
  };
  const writersOf = (b) => (b.writers?.length ? b.writers : (b.people || []).filter((p) => !p.role).map((p) => p.name));
  const statusMeta = (b) => [b.status && w[b.status], b.rating != null && `<span class="stars" title="${b.rating}/10">${stars(b.rating)}</span>`].filter(Boolean);
  const card = (root, b, meta = statusMeta(b)) => `<li class="card"><a href="${esc(bookHref(root, b))}"><span class="cover">${picture(root, b, b.cover)}</span><span class="t">${esc(b.title)}</span></a>${
    writersOf(b).length ? `<span class="a">${esc(writersOf(b).join(', '))}</span>` : ''}${meta.length ? `<span class="m">${meta.map((m) => (m.startsWith('<span') ? m : esc(m))).join(' · ')}</span>` : ''}</li>`;
  const grid = (root, items, meta) => `<ul class="grid">\n${items.map((b) => card(root, b, meta ? meta(b) : undefined)).join('\n')}\n</ul>`;
  const strip = (root, items) => `<span class="strip">${items.slice(0, 5).map((b) => picture(root, b, b.cover)).join('')}</span>`;
  const pageName = (base, n) => (n === 1 ? `${base}.html` : `${base}--${n}.html`);

  /** Pages of covers at `base` (.html, then --2.html, …), with a pager. */
  const gridPages = (base, items, { title: pageTitle, section, intro = '', meta }) => {
    const chunks = paginate(items, pageSize);
    const file = (n) => pageName(base, n).split('/').pop();
    chunks.forEach((chunk, i) => {
      const n = i + 1;
      const pager = chunks.length < 2 ? '' : `<nav class="pager" aria-label="${esc(w.pages)}">
${n > 1 ? `<a rel="prev" href="${file(n - 1)}">← ${esc(w.previous)}</a>` : ''}
${pagerNumbers(n, chunks.length).map((k) => (k === 0 ? '<span class="gap">…</span>' : k === n ? `<span aria-current="page">${k}</span>` : `<a href="${file(k)}">${k}</a>`)).join('\n')}
${n < chunks.length ? `<a rel="next" href="${file(n + 1)}">${esc(w.next)} →</a>` : ''}
</nav>`;
      page(pageName(base, n), {
        title: chunks.length > 1 ? `${pageTitle} (${fill(w.page, { n, all: chunks.length })})` : pageTitle, section,
        body: (root) => `<h1>${esc(pageTitle)}</h1>
<p class="sub">${esc(count(items.length))}${chunks.length > 1 ? ` · ${esc(fill(w.page, { n, all: chunks.length }))}` : ''}${intro}</p>
${grid(root, chunk, meta)}
${pager}`,
      });
    });
  };

  // ── Home ──
  const readingNow = all.filter((b) => b.status === 'reading').sort(newest((b) => (b.lists || []).find((l) => l.id === 'reading')?.since || b.added));
  const recent = all.filter((b) => lastRead(b)).sort(newest(lastRead)).slice(0, 12);
  const readMeta = (b) => [lastRead(b) && fill((b.reads || []).find((r) => r.date === lastRead(b))?.dnf ? w.gaveUp : w.readOn, { date: longDate(lastRead(b)) }), b.rating != null && `<span class="stars" title="${b.rating}/10">${stars(b.rating)}</span>`].filter(Boolean);
  const listRows = (root) => `<ul class="rows">
${exported.map((l) => {
    const on = all.filter((b) => (b.lists || []).some((x) => x.id === l.id)).sort(listOrder(l));
    return `<li><a class="name" href="${esc(listHref(root, l))}">${esc(l.name)}</a> <small>${esc(count(on.length))}</small>${strip(root, on)}</li>`;
  }).join('\n')}
</ul>`;
  function listOrder(l) {
    const since = (b) => (b.lists || []).find((x) => x.id === l.id)?.since || '';
    return l.id === 'read' || l.id === 'abandoned' ? newest((b) => lastRead(b) || since(b)) : newest(since);
  }
  page('index.html', {
    title: '', section: 'home',
    body: (root) => `<h1>${esc(heading)}</h1>
<p class="sub">${esc(count(all.length))}</p>
${readingNow.length ? `<h2>${esc(w.readingNow)}</h2>\n${grid(root, readingNow)}` : ''}
${recent.length ? `<h2>${esc(w.recentlyRead)}${exported.some((l) => l.id === 'read') ? ` <a class="more" href="${esc(listHref(root, { id: 'read' }))}">${esc(w.seeAll)} →</a>` : ''}</h2>\n${grid(root, recent, readMeta)}` : ''}
${exported.length ? `<h2>${esc(w.lists)}</h2>\n${listRows(root)}` : ''}
<h2><a href="${root}books/index.html">${esc(w.allBooks)}</a> <a class="more" href="${root}books/index.html">${esc(w.seeAll)} →</a></h2>
${grid(root, all.slice(0, 12))}`,
  });

  // ── All books, the lists ──
  gridPages('books/index', all, { title: w.allBooks, section: 'books' });
  if (exported.length) page('lists/index.html', { title: w.lists, section: 'lists', body: (root) => `<h1>${esc(w.lists)}</h1>\n${listRows(root)}` });
  for (const l of exported) {
    const on = all.filter((b) => (b.lists || []).some((x) => x.id === l.id)).sort(listOrder(l));
    const meta = l.id === 'read' || l.id === 'abandoned' ? readMeta : (b) => {
      const at = (b.lists || []).find((x) => x.id === l.id);
      return [at?.note, at?.since && fill(l.id === 'reading' ? w.since : w.added, { date: longDate(at.since) }), b.rating != null && `<span class="stars" title="${b.rating}/10">${stars(b.rating)}</span>`].filter(Boolean);
    };
    gridPages(`lists/${listSlug.get(l.id)}`, on, { title: l.name, section: 'lists', meta });
  }

  // ── Authors ──
  const sortedPeople = [...people.values()].sort((a, b) => fold(a.sortAs).localeCompare(fold(b.sortAs)));
  const initial = (p) => (fold(p.sortAs).match(/[a-z]/)?.[0] || '#').toUpperCase();
  if (people.size) {
    page('authors/index.html', {
      title: w.authors, section: 'authors',
      body: (root) => {
        const letters = [...new Set(sortedPeople.map(initial))];
        return `<h1>${esc(w.authors)}</h1>
<nav class="letters">${letters.map((x) => `<a href="#${x === '#' ? 'other' : x}">${x}</a>`).join(' ')}</nav>
${letters.map((x) => `<h2 class="letter" id="${x === '#' ? 'other' : x}">${x}</h2>
<ul class="index">
${sortedPeople.filter((p) => initial(p) === x).map((p) => `<li><a href="${esc(personHref(root, p.name))}">${esc(p.name)}</a> <small>${new Set(p.books.map((x) => x.book)).size}</small></li>`).join('\n')}
</ul>`).join('\n')}`;
      },
    });
  }
  for (const p of people.values()) {
    const roles = [...new Set(p.books.map((x) => x.role))].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
    const own = [...new Set(p.books.map((x) => x.book))];
    page(`authors/${personSlug.get(p.name)}.html`, {
      title: p.name, section: 'authors',
      body: (root) => `<h1>${esc(p.name)}</h1>
<p class="sub">${esc(count(own.length))}</p>
${roles.map((role) => {
        const these = p.books.filter((x) => x.role === role).map((x) => x.book).sort((a, b) => (a.series || '').localeCompare(b.series || '') || (a.seriesOrder ?? 1e9) - (b.seriesOrder ?? 1e9) || byTitle(a, b));
        return `${roles.length > 1 || role ? `<h2>${esc(role ? role[0].toLocaleUpperCase() + role.slice(1) : w.books)}</h2>\n` : ''}${grid(root, these)}`;
      }).join('\n')}`,
    });
  }

  // ── Series ──
  const inOrder = (a, b) => (a.seriesOrder ?? 1e9) - (b.seriesOrder ?? 1e9) || byTitle(a, b);
  if (seriesOf.size) {
    page('series/index.html', {
      title: w.series, section: 'series',
      body: (root) => `<h1>${esc(w.series)}</h1>
<ul class="rows">
${[...seriesOf].sort(([a], [b]) => titleKey(a).localeCompare(titleKey(b))).map(([name, these]) => {
        const sorted = [...these].sort(inOrder);
        const who = [...new Set(sorted.flatMap(writersOf))].slice(0, 3).join(', ');
        return `<li><span><a class="name" href="${esc(seriesHref(root, name))}">${esc(name)}</a> <small>${esc(count(these.length))}${who ? ` · ${esc(who)}` : ''}</small></span>${strip(root, sorted)}</li>`;
      }).join('\n')}
</ul>`,
    });
  }
  for (const [name, these] of seriesOf) {
    const sorted = [...these].sort(inOrder);
    page(`series/${seriesSlug.get(name)}.html`, {
      title: name, section: 'series',
      body: (root) => `<h1>${esc(name)}</h1>
<p class="sub">${esc(count(sorted.length))}${(() => { const who = [...new Set(sorted.flatMap(writersOf))]; return who.length ? ` · ${who.map((x) => `<a href="${esc(personHref(root, x))}">${esc(x)}</a>`).join(', ')}` : ''; })()}</p>
${grid(root, sorted, (b) => [b.seriesNumber ? `#${b.seriesNumber}` : w.unnumbered, ...statusMeta(b)])}`,
    });
  }

  // ── Categories and tags ──
  for (const [key, map, slugs, label] of [['categories', categories, categorySlug, w.categories], ['tags', tags, tagSlug, w.tags]]) {
    if (!map.size) continue;
    page(`${key}/index.html`, {
      title: label, section: key,
      body: (root) => `<h1>${esc(label)}</h1>
<ul class="rows">
${[...map].map(([name, these]) => `<li><span><a class="name" href="${root}${key}/${slugs.get(name)}.html">${esc(name)}</a> <small>${esc(count(these.length))}</small></span>${strip(root, these)}</li>`).join('\n')}
</ul>`,
    });
    for (const [name, these] of map) gridPages(`${key}/${slugs.get(name)}`, [...these].sort(byTitle), { title: name, section: key });
  }

  // ── A page per book ──
  for (const b of all) {
    const others = (b.people || []).filter((p) => p.role && !writersOf(b).includes(p.name));
    const byRole = new Map();
    for (const p of others) (byRole.get(p.role) || byRole.set(p.role, []).get(p.role)).push(p.name);
    const volumes = b.series ? [...seriesOf.get(b.series)].sort(inOrder) : [];
    const at = volumes.indexOf(b);
    const editionName = (e) => [e.title && e.title !== b.title ? e.title : '', w[e.format] || '', e.publisher, e.year].filter(Boolean).join(', ');
    const editionOf = (id) => (b.editions || []).find((e) => e.id === id);
    const reads = [...(b.reads || [])].sort((x, y) => String(y.date).localeCompare(String(x.date)));
    page(`book/${bookSlug.get(b.id)}.html`, {
      title: b.title, section: 'books',
      body: (root) => `<article class="book">
<div class="big">${picture(root, b, b.cover, true)}</div>
<div>
<h1>${esc(b.title)}</h1>
${b.originalTitle && b.originalTitle !== b.title ? `<p class="orig">${esc(b.originalTitle)}</p>` : ''}
${writersOf(b).length ? `<p class="by">${esc(w.by)} ${writersOf(b).map((x) => `<a href="${esc(personHref(root, x))}">${esc(x)}</a>`).join(', ')}</p>` : ''}
${b.series ? `<p class="meta">${b.seriesNumber
          ? fill(esc(w.inSeries), { n: esc(b.seriesNumber), series: `<a href="${esc(seriesHref(root, b.series))}">${esc(b.series)}</a>` })
          : fill(esc(w.partOf), { series: `<a href="${esc(seriesHref(root, b.series))}">${esc(b.series)}</a>` })}</p>` : ''}
${statusMeta(b).length ? `<p class="meta">${statusMeta(b).map((m) => (m.startsWith('<span') ? m : esc(m))).join(' · ')}</p>` : ''}
${byRole.size ? `<p class="people">${[...byRole].map(([role, names]) => `${esc(role[0].toLocaleUpperCase() + role.slice(1))}: ${names.map((x) => `<a href="${esc(personHref(root, x))}">${esc(x)}</a>`).join(', ')}`).join('<br>')}</p>` : ''}
${b.originalLanguage ? `<p class="people">${esc(w.originalLanguage)}: ${esc(b.originalLanguage)}</p>` : ''}
${(b.lists || []).length || (b.categories || []).length || (b.tags || []).length ? `<ul class="chips">
${(b.lists || []).map((x) => exported.find((l) => l.id === x.id)).filter(Boolean).map((l) => {
          const on = b.lists.find((x) => x.id === l.id);
          return `<li><a href="${esc(listHref(root, l))}">${esc(l.name)}</a>${on.note ? ` <small>${esc(on.note)}</small>` : ''}${on.since ? ` <small>${esc(longDate(on.since))}</small>` : ''}</li>`;
        }).join('\n')}
${(b.categories || []).map((x) => `<li><a href="${root}categories/${categorySlug.get(x)}.html">${esc(x)}</a></li>`).join('\n')}
${(b.tags || []).map((x) => `<li><a href="${root}tags/${tagSlug.get(x)}.html">#${esc(x)}</a></li>`).join('\n')}
</ul>` : ''}
</div>
</article>
${reads.length ? `<h2>${esc(w.reads)}</h2>
${reads.map((r) => {
          const e = editionOf(r.edition);
          const meta = [r.date && fill(r.dnf ? w.gaveUp : w.readOn, { date: longDate(r.date) }), r.rating != null && `<span class="stars" title="${r.rating}/10">${stars(r.rating)}</span>`, e && (b.editions || []).length > 1 && editionName(e)].filter(Boolean);
          return `<section class="read">
<p class="meta">${meta.map((m) => (m.startsWith('<span') ? m : esc(m))).join(' · ')}</p>
${r.html && r.html.trim() ? `<div class="review">${r.html}</div>` : ''}
</section>`;
        }).join('\n')}` : ''}
${b.note && b.note.trim() ? `<h2>${esc(w.note)}</h2>\n<div class="review">${b.note}</div>` : ''}
${(b.editions || []).some((e) => e.publisher || e.year || e.pages || e.duration || e.isbn || e.format) ? `<h2>${esc(w.editions)}</h2>
<div class="editions">
${(b.editions || []).map((e) => {
          const facts = [
            [w.format, w[e.format] || ''], [w.publisher, e.publisher], [w.published, e.year],
            [e.format === 'audiobook' ? w.length : w.pageCount, e.format === 'audiobook' ? e.duration : e.pages],
            [w.isbn, e.isbn], [w.language, e.language],
          ].filter(([, v]) => v !== '' && v != null);
          return `<div class="edition">${e.cover && (e.cover.file || e.cover.link) ? `<span class="cover">${picture(root, { title: e.title || b.title }, e.cover)}</span>` : ''}<dl>
${e.title && e.title !== b.title ? `<dt class="name">${esc(e.title)}</dt>` : ''}
${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('\n')}
</dl></div>`;
        }).join('\n')}
</div>` : ''}
${volumes.length > 1 ? `<nav class="series-nav">
<span>${at > 0 ? `<a rel="prev" href="${esc(bookHref(root, volumes[at - 1]))}">← ${esc(volumes[at - 1].title)}</a>` : ''}</span>
<a href="${esc(seriesHref(root, b.series))}">${esc(b.series)}</a>
<span>${at < volumes.length - 1 ? `<a rel="next" href="${esc(bookHref(root, volumes[at + 1]))}">${esc(volumes[at + 1].title)} →</a>` : ''}</span>
</nav>` : ''}`,
    });
  }

  files.push({ path: 'style.css', data: STYLE + '\n' });
  // Pages first, in a tidy order; the covers after them.
  return files.sort((a, b) => (a.path.startsWith('covers/') - b.path.startsWith('covers/')) || (a.path === 'index.html' ? -1 : b.path === 'index.html' ? 1 : a.path.localeCompare(b.path)));
}

// ───────────────────────── The files ─────────────────────────

/**
 * The files of the export: [{path, data}] (`data` a string or bytes).
 * `target`: 'hugo', 'eleventy' or 'html'; `covers`: 'include' (the pictures go in, where an
 * entry has its bytes) or 'link' (cover is the picture's address). For HTML, `words`,
 * `longDate`, `lang` and `title` say how the pages speak.
 */
export function siteFiles(entries, { target = 'hugo', covers = 'include' } = {}) {
  if (target !== 'hugo' && target !== 'eleventy') throw new Error(`siteFiles makes Hugo and Eleventy pages; the website is htmlSite`);
  const all = withSlugs(entries);
  const { files: pictures, where } = coverPlaces(all, covers === 'include');
  const dir = target === 'hugo' ? 'content/books' : 'books';
  const out = [];
  for (const e of all) {
    const place = where.get(e);
    const cover = place?.file ? `/covers/${place.file}` : place?.link || '';
    out.push({ path: `${dir}/${e.slug}.md`, data: markdownPage(frontOf(e, target, cover), e.text) });
  }
  out.push({ path: 'README.txt', data: README[target] });
  for (const p of pictures) out.push({ path: `${target === 'hugo' ? 'static/covers' : 'covers'}/${p.name}`, data: p.bytes });
  return out;
}

// ───────────────────────── Zip ─────────────────────────

const CRC = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A zip archive of [{path, data}], stored (not compressed: covers are compressed already, and
 * the text is small), with UTF-8 names. → Uint8Array
 */
export function zip(files, when = new Date()) {
  const utf8 = new TextEncoder();
  const time = ((when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1)) & 0xffff;
  const day = (((Math.max(1980, when.getFullYear()) - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate()) & 0xffff;
  const parts = [], central = [];
  let offset = 0;
  for (const file of files) {
    const name = utf8.encode(file.path);
    const data = typeof file.data === 'string' ? utf8.encode(file.data) : file.data;
    const crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);         // version needed
    head.setUint16(6, 0x0800, true);     // names are UTF-8
    head.setUint16(8, 0, true);          // stored
    head.setUint16(10, time, true);
    head.setUint16(12, day, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, data.length, true);
    head.setUint32(22, data.length, true);
    head.setUint16(26, name.length, true);
    head.setUint16(28, 0, true);
    parts.push(new Uint8Array(head.buffer), name, data);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);        // made by
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, time, true);
    entry.setUint16(14, day, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}
