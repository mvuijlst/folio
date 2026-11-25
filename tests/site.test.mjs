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

test('HTML: a page per reading status, newest first, read books under their year, text escaped', () => {
  const files = byPath(S.siteFiles(entries(), { target: 'html', covers: 'include', title: 'Michel <leest>' }));
  assert.deepEqual([...files.keys()].sort(), ['covers/de-historicus.jpg', 'did-not-finish.html', 'index.html', 'reading.html', 'style.css', 'to-read.html']);
  const read = files.get('index.html');
  assert.match(read, /<title>Read · Michel &lt;leest&gt;<\/title>/);
  assert.match(read, /<strong>Read \(2\)<\/strong>/);
  assert.match(read, /<a href="reading.html">Reading \(1\)<\/a>/);
  assert.ok(read.indexOf('<h2>2026</h2>') < read.indexOf('<h2>2025</h2>'));
  assert.match(read, /<img src="covers\/de-historicus.jpg" alt="Cover of De historicus" loading="lazy">/);
  assert.match(read, /<img src="data:image\/jpeg;base64,AAAA"/);
  assert.match(read, /<span class="stars" title="8\/10">★★★★☆<\/span>/);
  assert.match(read, /Paper|Poema Pocket, 2011, 687 pages/);
  assert.match(read, /Audiobook, Luisterrijk, 2019, 25u/);
  assert.match(read, /<small>\(reread\)<\/small>/);
  assert.match(read, /<div class="review"><p>Goed, <em>heel<\/em> goed.<\/p><\/div>/);
  assert.match(read, /by Elizabeth Kostova · Ine Willems \(vertaling\)/);
  assert.match(files.get('to-read.html'), /Added 2026-01-05/);
  assert.match(files.get('to-read.html'), /&lt;b&gt;Jan&lt;\/b&gt;/);
  assert.match(files.get('reading.html'), /Since 2026-11-01/);
  assert.match(files.get('reading.html'), /by Frank Herbert · Dune #1/);
  assert.match(files.get('did-not-finish.html'), /Stopped 2024-06-01 · <span class="stars" title="3\/10">★½☆☆☆<\/span>/);
});

test('HTML in another language', () => {
  const files = byPath(S.siteFiles(entries().slice(2, 3), {
    target: 'html', covers: 'link', lang: 'nl', words: { title: 'Lezen', reading: 'Lezende', since: 'Sinds {date}', by: 'door' },
    longDate: (d) => `op ${d}`,
  }));
  assert.deepEqual([...files.keys()].sort(), ['reading.html', 'style.css']);
  const page = files.get('reading.html');
  assert.match(page, /<html lang="nl">/);
  assert.match(page, /Sinds op 2026-11-01/);
  assert.match(page, /door Frank Herbert/);
  assert.match(page, /<img src="https:\/\/covers\.openlibrary\.org\/b\/id\/1-L\.jpg"/);
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
