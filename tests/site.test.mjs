import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as S from '../site.js';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);

// A book read twice (the second time as an audiobook), one being read, one to read, one given up.
const entries = () => [
  {
    book: 'b1', title: 'De historicus', bookTitle: 'De historicus', writers: ['Elizabeth Kostova'],
    people: [{ name: 'Elizabeth Kostova', role: '' }, { name: 'Ine Willems', role: 'vertaling' }],
    series: '', seriesNumber: '', originalTitle: 'The Historian', originalLanguage: 'en',
    categories: ['Roman'], tags: ['vampieren'], lists: ['Bibliotheek'],
    status: 'read', date: '2025-03-01', dated: true, rating: 8, text: 'Goed, *heel* goed.\n\nTweede alinea: "quote"', html: '<p>Goed, <em>heel</em> goed.</p>',
    edition: { format: 'paper', publisher: 'Poema Pocket', year: '2011', pages: 687, duration: '', minutes: null, isbn: '9789021015996', language: 'nl' },
    cover: { link: 'https://folio.example/covers/web/abc.jpg', bytes: JPEG, ext: 'jpg' },
  },
  {
    book: 'b1', title: 'De historicus', bookTitle: 'De historicus', writers: ['Elizabeth Kostova'], people: [{ name: 'Elizabeth Kostova', role: '' }],
    status: 'read', date: '2026-08-10', dated: true, rating: 7, text: '', html: '',
    edition: { format: 'audiobook', publisher: 'Luisterrijk', year: '2019', pages: '', duration: '25u', minutes: 1500, isbn: '', language: 'nl' },
    cover: { link: 'data:image/jpeg;base64,AAAA' },
  },
  {
    book: 'b2', title: 'Dune', bookTitle: 'Dune', writers: ['Frank Herbert'], people: [{ name: 'Frank Herbert', role: '' }],
    series: 'Dune', seriesNumber: '1', status: 'reading', date: '2026-11-01', dated: false, rating: null, text: '', html: '',
    edition: { format: 'ebook', publisher: 'Ace', year: '1990', pages: 600, isbn: '9780441172719', language: 'en' },
    cover: { link: 'https://covers.openlibrary.org/b/id/1-L.jpg' },
  },
  {
    book: 'b3', title: 'Ça', bookTitle: 'Ça', writers: ['Stephen King'], status: 'to-read', date: '2026-01-05', dated: false, rating: null,
    text: 'Aangeraden door <b>Jan</b>', html: '<p>Aangeraden door &lt;b&gt;Jan&lt;/b&gt;</p>', edition: {}, cover: null,
  },
  {
    book: 'b4', title: 'Ulysses', bookTitle: 'Ulysses', writers: ['James Joyce'], status: 'did-not-finish', date: '2024-06-01', dated: true,
    rating: 3, text: '', html: '', edition: { format: 'paper', pages: 900 }, cover: null,
  },
];

const byPath = (files) => new Map(files.map((f) => [f.path, f.data]));

test('slugs: plain words, no accents, unique, a reread with its year', () => {
  assert.equal(S.slugify('Ça: “Stephen King’s” Ölmäs! — 2'), 'ca-stephen-king-s-olmas-2');
  assert.equal(S.slugify('!!!'), '');
  const slugged = S.withSlugs(entries());
  assert.deepEqual(slugged.map((e) => e.slug), ['de-historicus', 'de-historicus-2026', 'dune', 'ca', 'ulysses']);
  assert.equal(slugged[1].first, 'de-historicus');
  assert.equal(slugged[0].first, undefined);
  const twice = S.withSlugs([{ book: 'x', title: 'Emma', date: '2020-01-01' }, { book: 'y', title: 'Emma', date: '2021-01-01' }]);
  assert.deepEqual(twice.map((e) => e.slug), ['emma', 'emma-2']);   // another book of the same title
});

test('Hugo: a Markdown page per read, the front matter YAML, the covers in static/', () => {
  const files = byPath(S.siteFiles(entries(), { target: 'hugo', covers: 'include' }));
  assert.deepEqual([...files.keys()].sort(), ['README.txt', 'content/books/ca.md', 'content/books/de-historicus-2026.md',
    'content/books/de-historicus.md', 'content/books/dune.md', 'content/books/ulysses.md', 'static/covers/de-historicus.jpg']);
  assert.equal(files.get('static/covers/de-historicus.jpg'), JPEG);
  assert.equal(files.get('content/books/de-historicus.md'), `---
title: "De historicus"
date: 2025-03-01
slug: "de-historicus"
authors: ["Elizabeth Kostova"]
contributors:
 - name: "Ine Willems"
   role: "vertaling"
original_title: "The Historian"
original_language: "en"
status: "read"
rating: 8
stars: 4
format: "paper"
publisher: "Poema Pocket"
year: 2011
pages: 687
isbn: "9789021015996"
language: "nl"
categories: ["Roman"]
tags: ["vampieren"]
lists: ["Bibliotheek"]
cover: "/covers/de-historicus.jpg"
---

Goed, *heel* goed.

Tweede alinea: "quote"
`);
  const reread = files.get('content/books/de-historicus-2026.md');
  assert.match(reread, /^reread_of: "de-historicus"$/m);
  assert.match(reread, /^format: "audiobook"\npublisher: "Luisterrijk"\nyear: 2019\nduration: "25u"\nminutes: 1500$/m);
  assert.doesNotMatch(reread, /^pages:/m);
  assert.match(reread, /^cover: "data:image\/jpeg;base64,AAAA"$/m);   // no picture to put in: its address
  assert.match(files.get('content/books/dune.md'), /^series: \["Dune"\]\nseries_number: 1$/m);
  assert.match(files.get('content/books/dune.md'), /^status: "reading"$/m);
  assert.match(files.get('content/books/ulysses.md'), /^status: "did-not-finish"\nrating: 3\nstars: 1\.5$/m);
  assert.match(files.get('README.txt'), /\[taxonomies\]/);
});

test('linked covers: nothing in the archive, every page points at its cover', () => {
  const files = byPath(S.siteFiles(entries(), { target: 'hugo', covers: 'link' }));
  assert.ok(![...files.keys()].some((p) => p.startsWith('static/')));
  assert.match(files.get('content/books/de-historicus.md'), /^cover: "https:\/\/folio\.example\/covers\/web\/abc\.jpg"$/m);
  assert.match(files.get('content/books/dune.md'), /^cover: "https:\/\/covers\.openlibrary\.org\/b\/id\/1-L\.jpg"$/m);
  assert.doesNotMatch(files.get('content/books/ca.md'), /^cover:/m);
});

test('Eleventy: books/ and covers/, every page in the "books" collection', () => {
  const files = byPath(S.siteFiles(entries(), { target: 'eleventy', covers: 'include' }));
  assert.ok(files.has('books/dune.md') && files.has('covers/de-historicus.jpg') && files.has('README.txt'));
  const page = files.get('books/de-historicus.md');
  assert.match(page, /^tags: \["books", "vampieren"\]$/m);
  assert.doesNotMatch(page, /^slug:/m);
  assert.match(files.get('README.txt'), /addPassthroughCopy\("covers"\)/);
});

test('front matter survives anything in a title', () => {
  const odd = [{ book: 'z', title: 'He said "no"\\: a: b\n#1', writers: ['A, B'], date: '2020-01-01', status: 'read', edition: {} }];
  const page = S.siteFiles(odd, { target: 'hugo' })[0].data;
  const title = page.match(/^title: (.*)$/m)[1];
  assert.equal(JSON.parse(title), 'He said "no"\\: a: b\n#1');
});

// A shelf for the website: a book read twice (the second time as an audiobook), two volumes of a
// series, one to read, one given up, one on no list; a translator; two lists besides the reading ones.
const shelf = () => {
  const people = (...names) => names.map(([name, role = '', sortAs = name]) => ({ name, role, sortAs }));
  return [
    {
      id: 'b1', title: 'De historicus', originalTitle: 'The Historian', originalLanguage: 'English',
      writers: ['Elizabeth Kostova'], people: people(['Elizabeth Kostova', '', 'Kostova, Elizabeth'], ['Ine Willems', 'translator', 'Willems, Ine']),
      categories: ['Novel'], tags: ['vampires'], status: 'read', rating: 7, added: '2025-01-02',
      lists: [{ id: 'read', since: '2026-08-10', note: '' }, { id: 'lent', since: '2026-09-01', note: 'Jan' }],
      cover: { link: 'https://folio.example/covers/web/a-320.webp', large: 'https://folio.example/covers/web/a.jpg', from: 'https://folio.example/covers/web/a.jpg', bytes: JPEG, ext: 'jpg' },
      editions: [
        { id: 'e1', format: 'paper', publisher: 'Poema Pocket', year: '2011', pages: 687, isbn: '9789021015996', language: 'Dutch', main: true,
          cover: { link: 'https://folio.example/covers/web/a-320.webp', from: 'https://folio.example/covers/web/a.jpg', bytes: JPEG, ext: 'jpg' } },
        { id: 'e2', format: 'audiobook', publisher: 'Luisterrijk', year: '2019', duration: '25u', language: 'Dutch', cover: { link: 'data:image/jpeg;base64,AAAA', from: 'data:image/jpeg;base64,AAAA' } },
      ],
      reads: [
        { date: '2025-03-01', rating: 8, html: '<p>Goed, <em>heel</em> goed.</p>', edition: 'e1' },
        { date: '2026-08-10', rating: 7, html: '<p>Als luisterboek.</p>', edition: 'e2' },
      ],
    },
    { id: 'b2', title: 'Dune', writers: ['Frank Herbert'], people: people(['Frank Herbert', '', 'Herbert, Frank']), series: 'Dune', seriesNumber: '1', seriesOrder: 1,
      status: 'reading', added: '2026-11-01', lists: [{ id: 'reading', since: '2026-11-01' }], cover: { link: 'https://covers.openlibrary.org/b/id/1-M.jpg', large: 'https://covers.openlibrary.org/b/id/1-L.jpg' },
      editions: [{ id: 'e1', format: 'ebook', publisher: 'Ace', main: true }], reads: [] },
    { id: 'b3', title: 'Dune Messiah', writers: ['Frank Herbert'], people: people(['Frank Herbert', '', 'Herbert, Frank']), series: 'Dune', seriesNumber: '2', seriesOrder: 2,
      status: 'to-read', added: '2026-11-02', lists: [{ id: 'to-read', since: '2026-11-02' }], cover: null, editions: [], reads: [], note: '<p>Na <b>deel 1</b>.</p>' },
    { id: 'b4', title: 'Ulysses', writers: ['James Joyce'], people: people(['James Joyce', '', 'Joyce, James']), status: 'did-not-finish', rating: 3, added: '2024-05-01',
      lists: [{ id: 'abandoned', since: '2024-06-01' }], cover: null, editions: [{ id: 'e1', format: 'paper', pages: 900, main: true }],
      reads: [{ date: '2024-06-01', rating: 3, dnf: true, html: '' }] },
    { id: 'b5', title: 'The <Odd> One', writers: ['A. Nonymous'], people: [], status: '', added: '2020-01-01', lists: [], cover: null, editions: [], reads: [] },
  ];
};
const LISTS = [{ id: 'to-read', name: 'To read' }, { id: 'reading', name: 'Reading' }, { id: 'read', name: 'Read' }, { id: 'abandoned', name: 'Did not finish' },
  { id: 'lent', name: 'Lent out' }, { id: 'library', name: 'Library' }];

test('website: a page for every book, author, series, list, category and tag, and the covers once', () => {
  const files = byPath(S.htmlSite(shelf(), { lists: LISTS, made: '2026-11-25' }));
  const paths = [...files.keys()];
  assert.equal(paths[0], 'index.html');
  assert.deepEqual(paths.filter((p) => p.startsWith('book/')).sort(),
    ['book/de-historicus.html', 'book/dune-messiah.html', 'book/dune.html', 'book/the-odd-one.html', 'book/ulysses.html']);
  assert.deepEqual(paths.filter((p) => p.startsWith('authors/')).sort(),
    ['authors/a-nonymous.html', 'authors/elizabeth-kostova.html', 'authors/frank-herbert.html', 'authors/index.html', 'authors/ine-willems.html', 'authors/james-joyce.html']);
  assert.deepEqual(paths.filter((p) => p.startsWith('series/')).sort(), ['series/dune.html', 'series/index.html']);
  // The lists exported that have books: Library has none.
  assert.deepEqual(paths.filter((p) => p.startsWith('lists/')).sort(),
    ['lists/did-not-finish.html', 'lists/index.html', 'lists/lent-out.html', 'lists/read.html', 'lists/reading.html', 'lists/to-read.html']);
  assert.ok(files.has('categories/novel.html') && files.has('tags/vampires.html') && files.has('books/index.html') && files.has('style.css'));
  // One picture, used by the book and its edition, is in the zip once.
  assert.deepEqual(paths.filter((p) => p.startsWith('covers/')), ['covers/de-historicus.jpg']);
  // Every link goes somewhere in the site (or out of it).
  for (const [path, data] of files) {
    if (!path.endsWith('.html')) continue;
    for (const [, href] of data.matchAll(/(?:href|src)="([^"#]+)/g)) {
      if (/^(https?:|data:)/.test(href)) continue;
      const target = new URL(href, `http://site/${path}`).pathname.slice(1);
      assert.ok(files.has(target), `${path} → ${href}`);
    }
  }
});

test('website: a book page has everything, linked', () => {
  const files = byPath(S.htmlSite(shelf(), { lists: LISTS, longDate: (d) => `on ${d}` }));
  const page = files.get('book/de-historicus.html');
  assert.match(page, /<h1>De historicus<\/h1>/);
  assert.match(page, /<p class="orig">The Historian<\/p>/);
  assert.match(page, /by <a href="\.\.\/authors\/elizabeth-kostova\.html">Elizabeth Kostova<\/a>/);
  assert.match(page, /Translator: <a href="\.\.\/authors\/ine-willems\.html">Ine Willems<\/a>/);
  assert.match(page, /<img src="\.\.\/covers\/de-historicus\.jpg" alt="Cover of De historicus"/);
  assert.match(page, /data-title="De historicus" onerror="this\.replaceWith\(/);   // a cover that doesn't load: the title instead
  assert.match(page, /<a href="\.\.\/lists\/lent-out\.html">Lent out<\/a> <small>Jan<\/small>/);
  assert.match(page, /<a href="\.\.\/categories\/novel\.html">Novel<\/a>/);
  assert.match(page, /<a href="\.\.\/tags\/vampires\.html">#vampires<\/a>/);
  // Reads newest first, each with its edition when there are several.
  assert.ok(page.indexOf('Read on 2026-08-10') < page.indexOf('Read on 2025-03-01'));
  assert.match(page, /Read on 2026-08-10 · <span class="stars" title="7\/10">★★★½☆<\/span> · Audiobook, Luisterrijk, 2019/);
  assert.match(page, /<div class="review"><p>Goed, <em>heel<\/em> goed\.<\/p><\/div>/);
  assert.match(page, /<dt>Length<\/dt><dd>25u<\/dd>/);
  assert.match(page, /<dt>ISBN<\/dt><dd>9789021015996<\/dd>/);
  assert.match(page, /<link rel="stylesheet" href="\.\.\/style\.css">/);
  assert.match(page, /<a class="site" href="\.\.\/index\.html">Books<\/a>/);
  // A series: where it stands in it, and the volumes before and after.
  const dune = files.get('book/dune.html');
  assert.match(dune, /Book 1 in <a href="\.\.\/series\/dune\.html">Dune<\/a>/);
  assert.match(dune, /<a rel="next" href="\.\.\/book\/dune-messiah\.html">Dune Messiah →<\/a>/);
  assert.match(dune, /<img src="https:\/\/covers\.openlibrary\.org\/b\/id\/1-L\.jpg"/);   // the large one, on its own page
  assert.match(files.get('book/dune-messiah.html'), /<h2>Note<\/h2>\n<div class="review"><p>Na <b>deel 1<\/b>\.<\/p><\/div>/);
  assert.match(files.get('book/the-odd-one.html'), /<h1>The &lt;Odd&gt; One<\/h1>/);
  assert.match(files.get('book/the-odd-one.html'), /<span class="ph">The &lt;Odd&gt; One<\/span>/);
});

test('website: overviews of covers, in pages, in the order of each list', () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ id: `x${i}`, title: `Book ${String.fromCharCode(65 + i)}`, writers: ['W'], status: 'read', added: '2020-01-01',
    lists: [{ id: 'read', since: `2020-01-0${i + 1}` }], reads: [{ date: `2021-0${i + 1}-01`, rating: 6 }], editions: [] }));
  const files = byPath(S.htmlSite(many, { lists: LISTS, pageSize: 3 }));
  assert.deepEqual([...files.keys()].filter((p) => p.startsWith('books/')), ['books/index--2.html', 'books/index--3.html', 'books/index.html']);
  const first = files.get('books/index.html');
  assert.match(first, /<p class="sub">7 books · Page 1 of 3<\/p>/);
  assert.match(first, /<a rel="next" href="index--2\.html">Next →<\/a>/);
  assert.ok(first.indexOf('Book A') < first.indexOf('Book B') && !first.includes('Book D'));   // all books: A to Z
  const middle = files.get('books/index--2.html');
  assert.match(middle, /<a rel="prev" href="index\.html">← Previous<\/a>/);
  assert.match(middle, /<span aria-current="page">2<\/span>/);
  // Read: newest read first.
  const read = files.get('lists/read.html');
  assert.ok(read.indexOf('Book G') < read.indexOf('Book F'));
  assert.match(read, /Read 2021-07-01/);
  assert.ok(files.has('lists/read--3.html'));
  // Home: what was read lately, and the lists.
  assert.match(files.get('index.html'), /<h2>Recently read <a class="more" href="lists\/read\.html">See all →<\/a><\/h2>/);
});

test('website: the authors A to Z by surname, the series in order, a person by what they did', () => {
  const files = byPath(S.htmlSite(shelf(), { lists: LISTS }));
  const authors = files.get('authors/index.html');
  assert.ok(authors.indexOf('Frank Herbert') < authors.indexOf('James Joyce') && authors.indexOf('James Joyce') < authors.indexOf('Elizabeth Kostova'));
  assert.match(authors, /<h2 class="letter" id="H">H<\/h2>/);
  const series = files.get('series/dune.html');
  assert.ok(series.indexOf('>Dune<') < series.indexOf('>Dune Messiah<'));
  assert.match(series, /#1 · Reading/);
  assert.match(files.get('authors/ine-willems.html'), /<h2>Translator<\/h2>/);
  assert.match(files.get('lists/lent-out.html'), /Jan · Added 2026-09-01/);
});

test('website: the authors index in the order of the alphabet, whatever a name starts with', () => {
  const person = (name, sortAs) => ({ name, role: '', sortAs });
  const odd = [
    { id: 'o1', title: '’Salem’s Lot', writers: ['Mitric -Nicolas'], people: [person('Mitric -Nicolas', '-Nicolas, Mitric')], lists: [], editions: [], reads: [] },
    { id: 'o2', title: 'Abc', writers: ['(Pseudo) Pim'], people: [person('(Pseudo) Pim', '(Pim), Pseudo')], lists: [], editions: [], reads: [] },
    { id: 'o3', title: 'Zed', writers: ['Ann Aardvark'], people: [person('Ann Aardvark', 'Aardvark, Ann')], lists: [], editions: [], reads: [] },
    { id: 'o4', title: '1984', writers: ['张 伟'], people: [person('张 伟', '伟, 张')], lists: [], editions: [], reads: [] },
    { id: 'o5', title: 'Émile', writers: ['Ömer Öz'], people: [person('Ömer Öz', 'Öz, Ömer')], lists: [], editions: [], reads: [] },
  ];
  const files = byPath(S.htmlSite(odd, { lists: LISTS }));
  const authors = files.get('authors/index.html');
  const letters = [...authors.match(/<nav class="letters">(.*?)<\/nav>/)[1].matchAll(/>([^<]+)<\/a>/g)].map((m) => m[1]);
  assert.deepEqual(letters, ['A', 'N', 'O', 'P', '#']);
  const headings = [...authors.matchAll(/<h2 class="letter" id="([^"]+)">/g)].map((m) => m[1]);
  assert.deepEqual(headings, ['A', 'N', 'O', 'P', 'other']);
  assert.ok(authors.indexOf('Mitric -Nicolas') > authors.indexOf('id="N"') && authors.indexOf('Mitric -Nicolas') < authors.indexOf('id="O"'));
  // Titles too: a quote mark or a digit doesn't put a book before A.
  const books = files.get('books/index.html');
  const order = [...books.matchAll(/<span class="t">([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(order, ['1984', 'Abc', 'Émile', '’Salem’s Lot', 'Zed']);
});

test('website: linked covers, in another language', () => {
  const files = byPath(S.htmlSite(shelf(), {
    lists: LISTS, covers: 'link', lang: 'nl', title: 'Mijn boeken',
    words: { allBooks: 'Alle boeken', count: (n) => `${n} boeken`, by: 'door', made: 'Gemaakt met Folio, {date}' }, made: '2026-11-25', longDate: (d) => `de ${d}`,
  }));
  assert.ok(![...files.keys()].some((p) => p.startsWith('covers/')));
  const page = files.get('book/de-historicus.html');
  assert.match(page, /<html lang="nl">/);
  assert.match(page, /<title>De historicus · Mijn boeken<\/title>/);
  assert.match(page, /door <a/);
  assert.match(page, /<img src="https:\/\/folio\.example\/covers\/web\/a\.jpg"/);   // the large picture on the book's page
  assert.match(files.get('books/index.html'), /<img src="https:\/\/folio\.example\/covers\/web\/a-320\.webp"/);   // the small one among many
  assert.match(files.get('index.html'), /Gemaakt met Folio, de 2026-11-25/);
  assert.match(files.get('books/index.html'), /<p class="sub">5 boeken<\/p>/);
});

test('pager: every page of few, a window of many', () => {
  assert.deepEqual(S.pagerNumbers(1, 4), [1, 2, 3, 4]);
  assert.deepEqual(S.pagerNumbers(10, 20), [1, 0, 8, 9, 10, 11, 12, 0, 20]);
  assert.deepEqual(S.pagerNumbers(2, 20), [1, 2, 3, 4, 0, 20]);
  assert.deepEqual(S.paginate([], 5), [[]]);
});

test('stars: out of five, halves allowed', () => {
  assert.equal(S.stars(10), '★★★★★');
  assert.equal(S.stars(0), '☆☆☆☆☆');
  assert.equal(S.stars(7), '★★★½☆');
  assert.equal(S.stars(null), '');
});

test('the zip opens with the usual tools, names and bytes intact', () => {
  const files = S.siteFiles(entries(), { target: 'hugo', covers: 'include' });
  const data = S.zip(files, new Date(2026, 10, 25, 14, 30, 10));
  assert.equal(S.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const dir = mkdtempSync(join(tmpdir(), 'folio-zip-'));
  try {
    const archive = join(dir, 'site.zip');
    writeFileSync(archive, data);
    const listing = execFileSync('python3', ['-I', '-c', `
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
for i in z.infolist(): print(i.filename, i.file_size, i.date_time[:5])
`, archive], { encoding: 'utf8' });
    assert.match(listing, /^content\/books\/de-historicus\.md \d+ \(2026, 11, 25, 14, 30\)$/m);
    assert.match(listing, /^static\/covers\/de-historicus\.jpg 10 /m);
    execFileSync('python3', ['-I', '-m', 'zipfile', '-e', archive, join(dir, 'out')]);
    assert.equal(readFileSync(join(dir, 'out', 'content/books/ca.md'), 'utf8'), files.find((f) => f.path === 'content/books/ca.md').data);
    assert.deepEqual(new Uint8Array(readFileSync(join(dir, 'out', 'static/covers/de-historicus.jpg'))), JPEG);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
