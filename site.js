// Your reading as a website (Export → Hugo, Eleventy, HTML): one page per read, as a reading log
// has it, in a zip to unpack into a site. Hugo and Eleventy get Markdown with YAML front matter
// (the content only: no theme, no configuration of yours is touched); HTML gets plain pages
// that need nothing at all, one per reading status.
//
// The app (app.js) turns its books into entries (below) and fetches the covers; everything
// here is pure, no DOM and no network, so the tests (tests/site.test.mjs) can run it.
//
// An entry is one read of a book, or a book where it stands now (not read yet, being read):
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
export const STATUSES = ['read', 'reading', 'to-read', 'did-not-finish', ''];

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

// ───────────────────────── HTML ─────────────────────────

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The words a page uses, in English; the app hands its own language's. */
export const WORDS = {
  title: 'Reading',
  read: 'Read', reading: 'Reading', 'to-read': 'To read', 'did-not-finish': 'Did not finish', '': 'Other books',
  readOn: 'Read {date}', since: 'Since {date}', added: 'Added {date}', gaveUp: 'Stopped {date}',
  pages: '{n} pages', by: 'by', made: 'Made with Folio', reread: 'reread',
  paper: '', ebook: 'E-book', audiobook: 'Audiobook',
  coverOf: 'Cover of {title}',
};
const fill = (text, values) => String(text).replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '');

/** ★★★★½: a rating of 0–10 as five stars. */
export const stars = (rating) => {
  if (rating == null) return '';
  const r = Math.max(0, Math.min(10, Math.round(rating)));
  return '★'.repeat(Math.floor(r / 2)) + (r % 2 ? '½' : '') + '☆'.repeat(5 - Math.ceil(r / 2));
};

const PAGE_OF = { read: 'index.html', reading: 'reading.html', 'to-read': 'to-read.html', 'did-not-finish': 'did-not-finish.html', '': 'other.html' };

const STYLE = `
:root { color-scheme: light dark; --ink: #222; --soft: #6b6b6b; --line: #ddd; --paper: #fdfdfb; --link: #8a3b12; }
@media (prefers-color-scheme: dark) { :root { --ink: #e8e6e1; --soft: #a19e97; --line: #3a3936; --paper: #1b1a18; --link: #f0a070; } }
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 42rem; padding: 2rem 1rem 4rem; background: var(--paper); color: var(--ink);
  font: 17px/1.55 Georgia, "Times New Roman", serif; }
a { color: var(--link); }
header h1 { font-size: 1.6rem; font-weight: normal; margin: 0 0 .5rem; }
nav { font: 14px/1.6 system-ui, sans-serif; color: var(--soft); }
nav a, nav strong { margin-right: 1rem; white-space: nowrap; }
nav strong { color: var(--ink); }
h2 { font: 600 13px/1.4 system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: var(--soft);
  margin: 2.5rem 0 0; padding-bottom: .4rem; border-bottom: 1px solid var(--line); }
.book { display: flex; gap: 1rem; padding: 1.25rem 0; border-bottom: 1px solid var(--line); }
.book img { width: 72px; height: auto; flex: none; align-self: flex-start; box-shadow: 0 1px 3px rgba(0,0,0,.25); font: 11px/1.3 system-ui, sans-serif; color: var(--soft); }
.book .nocover { width: 72px; flex: none; }
.book h3 { font-size: 1.1rem; margin: 0; line-height: 1.3; }
.book h3 small { font-weight: normal; color: var(--soft); font-size: .85rem; }
.by, .meta { margin: .15rem 0 0; color: var(--soft); font-size: .95rem; }
.meta { font: 13px/1.5 system-ui, sans-serif; }
.stars { color: #c08a00; letter-spacing: .05em; }
.review { margin-top: .6rem; }
.review p { margin: 0 0 .7rem; }
.review img { max-width: 100%; height: auto; }
.review blockquote { margin: 0 0 .7rem; padding-left: 1rem; border-left: 3px solid var(--line); color: var(--soft); }
footer { margin-top: 3rem; font: 12px system-ui, sans-serif; color: var(--soft); }
@media (max-width: 30rem) { .book img, .book .nocover { width: 56px; } }
`.trim();

function htmlEntry(e, place, w, longDate) {
  const ed = e.edition || {};
  const src = place?.file ? `covers/${place.file}` : place?.link || '';
  const series = e.series ? `${e.series}${e.seriesNumber ? ` #${e.seriesNumber}` : ''}` : '';
  const writers = (e.writers || []).join(', ');
  const others = (e.people || []).filter((p) => p.role && !(e.writers || []).includes(p.name)).map((p) => `${p.name} (${p.role})`);
  const when = !e.date ? '' : fill(e.status === 'did-not-finish' && e.dated ? w.gaveUp : e.dated ? w.readOn : e.status === 'reading' ? w.since : w.added, { date: longDate(e.date) });
  const edition = [w[ed.format] || '', ed.publisher, ed.year, ed.format === 'audiobook' ? ed.duration : ed.pages ? fill(w.pages, { n: ed.pages }) : ''].filter(Boolean).join(', ');
  const meta = [when, edition].filter(Boolean).map(esc);
  if (e.rating != null) meta.splice(1, 0, `<span class="stars" title="${esc(`${e.rating}/10`)}">${stars(e.rating)}</span>`);
  return `<article class="book" id="${esc(e.slug)}">
${src ? `<img src="${esc(src)}" alt="${esc(fill(w.coverOf, { title: e.title }))}" loading="lazy">` : '<div class="nocover"></div>'}
<div>
<h3><cite>${esc(e.title)}</cite>${e.first ? ` <small>(${esc(w.reread)})</small>` : ''}</h3>
${writers || series ? `<p class="by">${[writers && `${esc(w.by)} ${esc(writers)}`, others.length && esc(others.join(', ')), series && esc(series)].filter(Boolean).join(' · ')}</p>` : ''}
${meta.length ? `<p class="meta">${meta.join(' · ')}</p>` : ''}
${e.html && e.html.trim() ? `<div class="review">${e.html}</div>` : ''}
</div>
</article>`;
}

function htmlPages(entries, where, { words = WORDS, longDate = (d) => d, lang = 'en', title } = {}) {
  const w = { ...WORDS, ...words };
  const heading = title || w.title;
  const by = new Map(STATUSES.map((s) => [s, []]));
  for (const e of entries) (by.get(e.status) || by.get('')).push(e);
  const present = STATUSES.filter((s) => by.get(s).length);
  if (!present.length) present.push('read');
  return present.map((status) => {
    const nav = present.map((s) => (s === status
      ? `<strong>${esc(w[s])} (${by.get(s).length})</strong>`
      : `<a href="${PAGE_OF[s]}">${esc(w[s])} (${by.get(s).length})</a>`)).join('\n');
    // Read: newest first, under the year; the others: newest first.
    const rows = [...by.get(status)].sort((a, b) => ((a.date || '') < (b.date || '') ? 1 : (a.date || '') > (b.date || '') ? -1 : 0));
    let body = '', year = null;
    for (const e of rows) {
      const y = status === 'read' || status === 'did-not-finish' ? String(e.date || '').slice(0, 4) || '—' : null;
      if (y !== null && y !== year) { body += `<h2>${esc(y)}</h2>\n`; year = y; }
      body += htmlEntry(e, where.get(e), w, longDate) + '\n';
    }
    return {
      name: PAGE_OF[status],
      text: `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(w[status])} · ${esc(heading)}</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<header>
<h1>${esc(heading)}</h1>
<nav>${nav}</nav>
</header>
<main>
${body}</main>
<footer>${esc(w.made)}</footer>
</body>
</html>
`,
    };
  });
}

// ───────────────────────── The files ─────────────────────────

/**
 * The files of the export: [{path, data}] (`data` a string or bytes).
 * `target`: 'hugo', 'eleventy' or 'html'; `covers`: 'include' (the pictures go in, where an
 * entry has its bytes) or 'link' (cover is the picture's address). For HTML, `words`,
 * `longDate`, `lang` and `title` say how the pages speak.
 */
export function siteFiles(entries, { target = 'hugo', covers = 'include', ...html } = {}) {
  const all = withSlugs(entries);
  const { files: pictures, where } = coverPlaces(all, covers === 'include');
  const coverDir = { hugo: 'static/covers', eleventy: 'covers', html: 'covers' }[target];
  const out = [];
  if (target === 'html') {
    for (const page of htmlPages(all, where, html)) out.push({ path: page.name, data: page.text });
    out.push({ path: 'style.css', data: STYLE + '\n' });
  } else {
    const dir = target === 'hugo' ? 'content/books' : 'books';
    for (const e of all) {
      const place = where.get(e);
      const cover = place?.file ? `/covers/${place.file}` : place?.link || '';
      out.push({ path: `${dir}/${e.slug}.md`, data: markdownPage(frontOf(e, target, cover), e.text) });
    }
    out.push({ path: 'README.txt', data: README[target] });
  }
  for (const p of pictures) out.push({ path: `${coverDir}/${p.name}`, data: p.bytes });
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
