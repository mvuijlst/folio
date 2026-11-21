// node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
  upgrade, settle, mainEdition, faceEdition, shelves, newWork, addEdition, findWork, volumeOf, combine, split, twins, twinsOf, setApart, flatView, fold,
  firstOut, writerOrder, categoriesLike, blankEdition, fillEdition, placeEdition, sameTitle, titleLikeness,
} from '../works.js';

const dir = new URL('./fixtures/works/', import.meta.url);
const fixtures = readdirSync(dir).filter((n) => n.endsWith('.json')).map((name) => [name, JSON.parse(readFileSync(new URL(name, dir), 'utf8'))]);

for (const [name, f] of fixtures.filter(([, f]) => !Array.isArray(f.before))) {
  test(`upgrade: ${name}`, () => {
    assert.deepEqual(upgrade(f.before, f.status), f.after);
    // Upgrading again changes nothing, and the old record is left as it was.
    assert.deepEqual(upgrade(f.after, f.status), f.after);
    assert.ok(!('editions' in f.before));
  });
}

const fx = (name) => structuredClone(fixtures.find(([n]) => n === `${name}.json`)[1].after);

test('the main edition: main, else the latest read, else the first', () => {
  assert.equal(mainEdition(fx('paper-then-audiobook')).id, 'e2');
  assert.equal(mainEdition(fx('booklog-reading-a-reread')).id, 'e2');
  assert.equal(mainEdition(fx('folio-read-another-edition')).id, 'e1');
  assert.equal(mainEdition(fx('from-before-lists')).id, 'e1');
});

test('the face of a row: the edition that is where you are and passes the filters', () => {
  const book = fx('folio-read-another-edition');
  assert.equal(faceEdition(book, { list: 'library' }).id, 'e2');
  assert.equal(faceEdition(book, { list: 'read' }).id, 'e1');
  assert.equal(faceEdition(book, { list: 'lent' }), null);
  assert.equal(faceEdition(book, { test: (e) => e.format === 'paper' }).id, 'e2');
  assert.equal(faceEdition(book, { list: 'library', test: (e) => e.format === 'ebook' }), null);
});

test('a finished book stays under Read while another read is planned', () => {
  const book = fx('booklog-reading-a-reread');
  const on = shelves(book);
  assert.ok(on.reading && on.read);
  assert.equal(on.read.at, '2012-01-20T12:00:00.000Z');
  // On Read the e-book that is being read now is not its face: the paperback that was read is.
  assert.equal(faceEdition(book, { list: 'read' }).id, 'e1');
  assert.equal(faceEdition(book, { list: 'reading' }).id, 'e2');
  // A read that was given up doesn't count.
  book.reviews[0].dnf = true;
  assert.ok(!shelves(book).read);
});

test('shelves: the lists of the book and of all its editions', () => {
  const book = fx('lent-out-with-a-note');
  addEdition(book, { format: 'ebook', lists: { lent: { at: '2026-01-01T00:00:00.000Z', note: 'Piet' } } });
  const on = shelves(book);
  assert.deepEqual(Object.keys(on).sort(), ['lent', 'library', 'read']);
  assert.equal(on.lent.at, '2026-01-01T00:00:00.000Z');
  assert.equal(on.lent.note, 'Jan; Piet');
});

test('settle puts what is in the wrong place where it belongs', () => {
  const book = fx('scanned-paper-book');
  book.publisher = 'Del Rey';
  book.lists.lent = { at: 'x', note: 'Ann' };
  book.editions[0].lists.read = { at: 'y' };
  book.reviews = [{ id: 'r', date: '2026-01-01', edition: { publisher: 'Old' } }];
  settle(book);
  assert.equal(book.publisher, undefined);
  assert.equal(book.editions[0].publisher, 'Del Rey');
  assert.deepEqual(book.editions[0].lists.lent, { at: 'x', note: 'Ann' });
  assert.ok(book.lists.read && !book.editions[0].lists.read);
  assert.deepEqual(book.reviews[0], { id: 'r', date: '2026-01-01', ed: 'e1' });
  // Off To read and Reading, `main` goes.
  book.lists = { read: { at: 'y' } };
  settle(book);
  assert.equal(book.main, undefined);
});

test('newWork and addEdition split a flat proposal', () => {
  const work = newWork({ id: 'n', added: 'now', title: 'Ash: A Secret History', author: 'Mary Gentle', format: 'paper', isbn: '978', publisher: 'Gollancz', lists: { library: { at: 'now' }, 'to-read': { at: 'now' } } });
  assert.deepEqual(work.lists, { 'to-read': { at: 'now' } });
  assert.deepEqual(work.editions, [{ id: 'e1', format: 'paper', isbn: '978', publisher: 'Gollancz', lists: { library: { at: 'now' } }, added: 'now' }]);
  const audio = addEdition(work, { title: 'Ash', format: 'audiobook', duration: '50u', lists: { 'to-read': { at: 'x' }, lent: { at: 'x' } } });
  assert.deepEqual(audio, { id: 'e2', format: 'audiobook', duration: '50u', title: 'Ash', lists: { lent: { at: 'x' } } });
});

test('findWork: the same olid, or the same title by the same first writer', () => {
  const shelf = [
    { id: 'a', title: 'Ash', author: 'Mary Gentle', editions: [] },
    { id: 'b', title: 'Dune', author: 'Frank Herbert', olid: 'OL893415W', editions: [] },
    { id: 'c', title: 'Guards! Guards!', author: 'Terry Pratchett', seriesNumber: 8, editions: [] },
    { id: 'd', title: 'The Painted Bird', author: 'Jerzy Kosiński', editions: [{ id: 'e1' }, { id: 'e2', title: 'De geverfde vogel' }] },
  ];
  assert.equal(findWork({ title: 'Ash: A Secret History', author: 'Mary Gentle' }, shelf)?.id, 'a');
  assert.equal(findWork({ title: 'ASH', author: 'Gentle, Mary' }, shelf), undefined);   // another first writer, as far as can be told
  assert.equal(findWork({ title: 'Dune Messiah', author: 'Frank Herbert' }, shelf), undefined);
  assert.equal(findWork({ title: 'Duin', author: 'Frank Herbert', olid: 'OL893415W' }, shelf)?.id, 'b');
  assert.equal(findWork({ title: 'Guards! Guards!', author: 'Terry Pratchett', seriesNumber: 9 }, shelf), undefined);
  assert.equal(findWork({ title: 'Guards Guards', author: 'Terry Pratchett' }, shelf)?.id, 'c');
  assert.equal(findWork({ title: 'De geverfde vogel', author: 'Jerzy Kosinski' }, shelf)?.id, 'd');
});

test('volumeOf: the volume a title says it is', () => {
  assert.equal(volumeOf('Warfare in Antiquity: History of the Art of War, Volume I (Warfare in Antiquity)'), 1);
  assert.equal(volumeOf('The Dawn of Modern Warfare: History of the Art of War, Vol. 4'), 4);
  assert.equal(volumeOf('Geschiedenis van de Nederlanden, deel IX'), 9);
  assert.equal(volumeOf('The Way of Kings: Book One of the Stormlight Archive'), 1);
  assert.equal(volumeOf('The Book Thief'), null);
  assert.equal(volumeOf('History of the Art of War'), null);
});

test('findWork: two volumes of a set are two books, even as one Open Library work', () => {
  const shelf = [{ id: 'v1', title: 'Warfare in Antiquity: History of the Art of War, Volume I', author: 'Hans Delbrück', olid: 'OL1104614W', editions: [] }];
  assert.equal(findWork({ title: 'The Barbarian Invasions: History of the Art of War, Volume II', author: 'Hans Delbrück', olid: 'OL1104614W' }, shelf), undefined);
  assert.equal(findWork({ title: 'History of the Art of War: Volume II', author: 'Hans Delbrück' }, [{ ...shelf[0], title: 'History of the Art of War: Volume I', olid: '' }]), undefined);
  assert.equal(findWork({ title: 'Warfare in Antiquity', author: 'Hans Delbrück', olid: 'OL1104614W' }, shelf)?.id, 'v1');   // says no volume: may be the same
  // The scan of 2026-11-17: both volumes came back as the bare title of the set, with their own Open Library works.
  const bare = [{ id: 'b1', title: 'History of the art of war', author: 'Hans Delbrück', olid: 'OL8418663W', editions: [] }];
  assert.equal(findWork({ title: 'History of the art of war', author: 'Hans Delbrück', olid: 'OL8418657W' }, bare), undefined);
  assert.equal(findWork({ title: 'History of the art of war', author: 'Hans Delbrück' }, bare)?.id, 'b1');   // no olid: the title decides
  assert.deepEqual([...twins([...bare, { id: 'b2', title: 'History of the art of war', author: 'Hans Delbrück', olid: 'OL8418657W', editions: [] }])].sort(), ['b1', 'b2']);   // Combine still suggests it
  assert.equal(findWork({ title: 'The Way of Kings: Book One of the Stormlight Archive', author: 'Brandon Sanderson' },
    [{ id: 'k', title: 'The Way of Kings', author: 'Brandon Sanderson', seriesNumber: 1, editions: [] }])?.id, 'k');
  assert.deepEqual([...twins([...shelf, { id: 'v2', title: 'The Barbarian Invasions: History of the Art of War, Volume II', author: 'Hans Delbrück', olid: 'OL1104614W', editions: [] }])], []);
});

test('setApart: two books said not to be one are no twins, and a combined book keeps what both were not', () => {
  const zero = { id: 'z', title: 'Channel Zero', author: 'Brian Wood', editions: [] };
  const jennie = { id: 'j', title: 'Channel Zero: Jennie One', author: 'Brian Wood', editions: [] };
  const other = { id: 'o', title: 'Channel Zero', author: 'Brian Wood', editions: [] };
  assert.deepEqual([...twins([zero, jennie, other])].sort(), ['j', 'o', 'z']);
  setApart(zero, jennie);
  assert.deepEqual(zero.apart, ['j']);
  assert.deepEqual(jennie.apart, ['z']);
  setApart(zero, jennie);   // once is enough
  assert.deepEqual(zero.apart, ['j']);
  assert.deepEqual(twinsOf(zero, [zero, jennie, other]).map((b) => b.id), ['o']);
  assert.deepEqual(twinsOf(jennie, [zero, jennie, other]).map((b) => b.id), ['o']);
  setApart(jennie, other);
  assert.deepEqual([...twins([zero, jennie, other])].sort(), ['o', 'z']);
  combine(zero, other);   // the one Channel Zero is not Jennie One either; it is not itself
  assert.deepEqual(zero.apart, ['j']);
});

test('twins: books that may be one', () => {
  const shelf = [
    { id: 'a', title: 'The Blacktongue Thief', author: 'Christopher Buehlman', olid: 'OL1W', editions: [] },
    { id: 'b', title: 'The Blacktongue Thief', author: 'Christopher Buehlman', olid: 'OL1W', editions: [] },
    { id: 'c', title: 'Something else', author: 'Christopher Buehlman', editions: [] },
  ];
  assert.deepEqual([...twins(shelf)].sort(), ['a', 'b']);
});

test('combine and split are each other\'s undoing for a read edition', () => {
  const crypto = fx('paper-then-audiobook');
  const before = structuredClone(crypto);
  const { work, piece } = split(structuredClone(crypto), 'e2', { id: 'new', added: 'now' });
  assert.equal(work.editions.length, 1);
  assert.deepEqual(work.reviews.map((r) => r.ed), ['e1']);
  assert.deepEqual(piece.editions.map((e) => e.format), ['audiobook']);
  assert.deepEqual(piece.lists, { read: { at: '2019-07-06T12:00:00.000Z' } });
  assert.equal(piece.rating, 8);
  const again = combine(work, piece);
  assert.deepEqual(again.editions.map((e) => e.id), ['e1', 'e2']);
  assert.deepEqual(again.reviews.map((r) => [r.id, r.ed]), before.reviews.map((r) => [r.id, r.ed]));
});

test('combine: a read planned of the absorbed book wins over none', () => {
  const read = fx('folio-read-another-edition');
  const planned = fx('scanned-paper-book');
  planned.pagesRead = 10;
  combine(read, planned);
  assert.deepEqual(Object.keys(read.lists), ['to-read']);
  assert.equal(read.main, 'e3');
  assert.equal(read.editions[2].publisher, 'HarperCollins');
  assert.equal(read.pagesRead, 10);
  assert.deepEqual(shelves(read).read.at, '2026-03-01T12:00:00.000Z');
});

test('split takes a planned read along when it is of that edition', () => {
  const hobbit = fx('booklog-reading-a-reread');
  delete hobbit.boeken;
  const { work, piece } = split(hobbit, 'e2', { id: 'p', added: 'now' });
  assert.deepEqual(Object.keys(piece.lists), ['reading']);
  assert.equal(piece.main, 'e1');
  assert.equal(piece.pagesRead, 120);
  assert.deepEqual(Object.keys(work.lists), ['read']);
  assert.equal(work.pagesRead, undefined);
});

test('combine of a translation: each copy keeps its title, and split gives the rest its own back', () => {
  const nl = () => ({ id: 'nl', title: 'Hoeksteen van de Foundation', author: 'Isaac Asimov', series: 'Foundation', seriesNumber: 2, lists: {},
    editions: [{ id: 'e1', format: 'paper', language: 'nl' }], v: 2 });
  const en = () => ({ id: 'en', title: "Foundation's Edge", author: 'Isaac Asimov', series: 'Foundation', seriesNumber: 6, lists: {},
    editions: [{ id: 'e1', format: 'paper', language: 'en' }], v: 2 });
  // Opened on the Dutch one, the book goes by its title unless the other is chosen.
  const mine = combine(nl(), en());
  assert.equal(mine.title, 'Hoeksteen van de Foundation');
  assert.deepEqual(mine.editions.map((e) => [e.language, e.title]), [['nl', undefined], ['en', "Foundation's Edge"]]);
  const theirs = combine(nl(), en(), { title: 'theirs' });
  assert.equal(theirs.title, "Foundation's Edge");
  assert.equal(theirs.seriesNumber, 6);
  assert.deepEqual(theirs.editions.map((e) => [e.language, e.title]), [['nl', 'Hoeksteen van de Foundation'], ['en', undefined]]);
  assert.equal(mainEdition(theirs).language, 'en');   // the face is the copy under the book's own title
  // Splitting the Dutch copy off again: each book has its own title.
  const { work, piece } = split(mine, 'e1', { id: 'p', added: 'now' });
  assert.equal(piece.title, 'Hoeksteen van de Foundation');
  assert.equal(work.title, "Foundation's Edge");
  assert.deepEqual(work.editions.map((e) => e.title), [undefined]);
  // Same title (a subtitle more or less): nothing changes.
  const plain = combine(en(), { ...en(), title: "Foundation's Edge: Foundation 4" });
  assert.deepEqual(plain.editions.map((e) => e.title), [undefined, undefined]);
});

test('flatView is the book as one edition', () => {
  const book = fx('paper-then-audiobook');
  assert.equal(flatView(book).format, 'audiobook');
  assert.equal(flatView(book, book.editions[0]).publisher, 'Avon');
  assert.equal(fold('Jerzy  Kosiński!'), 'jerzy kosinski');
});

// A writer's books: series together, series by their first book, books on their own by date,
// except one that came out while a series ran, which waits until it is done.
const book = (title, year, series, n) => ({ title, ...(series ? { series, seriesNumber: n } : {}), editions: year ? [{ id: 'e1', date: String(year) }] : [] });
const inOrder = (works) => { const at = writerOrder(works); return [...works].sort((a, b) => (at.get(a) < at.get(b) ? -1 : 1)).map((w) => w.title); };

test('writerOrder: a book that came out while two series ran waits for both', () => {
  // published A1, A2, C, B1, A3, B2, B3, D, E
  const out = [book('A1', 2001, 'A', 1), book('A2', 2002, 'A', 2), book('C', 2003), book('B1', 2004, 'B', 1), book('A3', 2005, 'A', 3),
    book('B2', 2006, 'B', 2), book('B3', 2007, 'B', 3), book('D', 2008), book('E', 2009)];
  assert.deepEqual(inOrder([...out].reverse()), ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C', 'D', 'E']);
});

test('writerOrder: a book between two series stays between them', () => {
  // published A1, A2, A3, C, B1, D, B2, E, B3
  const out = [book('A1', 2001, 'A', 1), book('A2', 2002, 'A', 2), book('A3', 2003, 'A', 3), book('C', 2004), book('B1', 2005, 'B', 1),
    book('D', 2006), book('B2', 2007, 'B', 2), book('E', 2008), book('B3', 2009, 'B', 3)];
  assert.deepEqual(inOrder([...out].reverse()), ['A1', 'A2', 'A3', 'C', 'B1', 'B2', 'B3', 'D', 'E']);
});

test('writerOrder: numbers order a series even when a reprint came out first; undated books come last', () => {
  const out = [book('X2', 1990, 'X', 2), book('X1', 2015, 'X', 1), book('Solo', 1995), book('Undated'), book('Y1', 1980, 'Y', 1)];
  assert.deepEqual(inOrder(out), ['Y1', 'X1', 'X2', 'Solo', 'Undated']);
});

test('firstOut: the earliest edition, whatever its date looks like', () => {
  assert.equal(firstOut({ editions: [{ date: '2008-07-06' }, { date: '1994' }, { date: 'c1999' }] }), '1994-00-00');
  assert.equal(firstOut({ editions: [{ date: '' }, {}] }), '');
  assert.equal(firstOut({ editions: [{ date: '2001-3' }] }), '2001-03-00');
});

const shelved = (id, author, categories, more = {}) => ({ id, title: id, author, categories, editions: [{ id: 'e1' }], ...more });

test('categoriesLike: the series says it, whatever the writer', () => {
  const shelf = [shelved('a', 'Mike Mignola', ['comic', 'horror'], { series: 'Hellboy' }), shelved('b', 'Duncan Fegredo', ['comic', 'horror'], { series: 'Hellboy' }),
    shelved('c', 'Mike Mignola', ['comic'], { series: 'Hellboy' })];
  const like = categoriesLike({ author: 'P. Craig Russell', series: 'hellboy' }, shelf);
  assert.deepEqual(like, ['comic', 'horror']);
  like.push('x');   // an array of its own
  assert.deepEqual(shelf[0].categories, ['comic', 'horror']);
});

test('categoriesLike: a writer the shelf is clear about, by their other books', () => {
  const shelf = [shelved('a', 'K. J. Parker', ['fantasy']), shelved('b', 'K.J. Parker', ['fantasy']), shelved('c', 'K. J. Parker, Tom Holt', ['fantasy']),
    shelved('d', 'K. J. Parker', ['fantasy', 'crime'])];
  assert.deepEqual(categoriesLike({ author: 'K. J. Parker' }, shelf), ['fantasy']);              // three in four
  assert.equal(categoriesLike({ author: 'K. J. Parker' }, shelf.slice(0, 2)), null);             // two books are too few
  assert.equal(categoriesLike({ author: 'Tom Holt, K. J. Parker' }, shelf), null);               // the first writer counts
  assert.equal(categoriesLike({ author: '' }, shelf), null);
  assert.deepEqual(categoriesLike({ author: 'K. J. Parker' }, shelf.slice(0, 2), { least: 2 }), ['fantasy']);
});

test('categoriesLike: a writer of several kinds says nothing', () => {
  const shelf = [shelved('a', 'Bill Bryson', ['wetenschap']), shelved('b', 'Bill Bryson', ['non-fictie']), shelved('c', 'Bill Bryson', ['non-fictie']),
    shelved('d', 'Bill Bryson', ['taal'])];
  assert.equal(categoriesLike({ author: 'Bill Bryson' }, shelf), null);
});

test('categoriesLike: the book itself, books without a category and scans still waiting do not count', () => {
  const shelf = [shelved('a', 'Jack Vance', ['science-fiction']), shelved('b', 'Jack Vance', ['science-fiction']), shelved('c', 'Jack Vance', ['fantasy']),
    shelved('d', 'Jack Vance', []), shelved('e', 'Jack Vance', ['science-fiction'], { pending: true })];
  assert.equal(categoriesLike(shelf[2], shelf), null);                                           // only two others
  assert.equal(categoriesLike({ id: 'c', author: 'Jack Vance' }, shelf), null);                  // the same book, as a copy
  assert.equal(categoriesLike({ author: 'Jack Vance' }, shelf), null);                           // two in three is not clear
  assert.deepEqual(categoriesLike({ author: 'Jack Vance' }, [...shelf, shelved('f', 'Jack Vance', ['science-fiction'])]), ['science-fiction']);
});

test('blankEdition: a copy of that format that says no ISBN yet', () => {
  const work = { title: 'Last Argument of Kings', editions: [
    { id: 'e1', format: 'ebook', publisher: 'Gollancz' },
    { id: 'e2', format: 'audiobook', asin: 'B003NHEU1M', lists: { bib: { at: '2026-11-15' } } },
    { id: 'e3', format: 'paper', language: 'en', added: '2026-11-19' }] };
  assert.equal(blankEdition(work, 'paper').id, 'e3');
  assert.equal(blankEdition(work, 'ebook').id, 'e1');                                            // a publisher, but no ISBN
  assert.equal(blankEdition(work, 'audiobook'), undefined);                                      // its ASIN says which it is
  assert.equal(blankEdition(work, ''), undefined);
  assert.equal(blankEdition({ ...work, editions: [{ id: 'e1', format: 'paper', isbn: '9780575082014' }] }, 'paper'), undefined);
  assert.equal(blankEdition({ ...work, editions: [{ id: 'e1', format: 'paper', title: 'De laatste les' }] }, 'paper'), undefined);   // a translation
});

test('fillEdition: what was found fills in what the edition does not say, its lists on top of its own', () => {
  const work = { title: 'Last Argument of Kings', editions: [{ id: 'e3', format: 'paper', language: 'en', publisher: 'Gollancz', added: '2026-11-19', lists: { mag: { at: '2026-11-01' } } }] };
  const e = fillEdition(work, work.editions[0], { title: 'Last Argument of Kings', format: 'paper', isbn: '9780575082014', publisher: 'Orion', pages: 544, language: 'nl',
    lists: { read: { at: 'x' }, bib: { at: '2026-11-20' }, mag: { at: '2026-11-20' } } }, { status: [] });
  assert.deepEqual(e, { id: 'e3', format: 'paper', language: 'en', publisher: 'Gollancz', added: '2026-11-19', isbn: '9780575082014', pages: 544,
    lists: { mag: { at: '2026-11-01' }, bib: { at: '2026-11-20' } } });
});

test('fillEdition: a cover comes whole, and only where there is none', () => {
  const work = { title: 'X', editions: [{ id: 'e1', format: 'paper', cover: 'covers/own/a.webp', coverRatio: 0.66 }, { id: 'e2', format: 'paper' }] };
  const found = { format: 'paper', isbn: '9780575082014', cover: 'https://covers.openlibrary.org/b/id/1-L.jpg', coverFull: 'covers/web/b.jpg', coverRatio: 0.7 };
  assert.deepEqual(fillEdition(work, work.editions[0], found), { id: 'e1', format: 'paper', cover: 'covers/own/a.webp', coverRatio: 0.66, isbn: '9780575082014' });
  assert.equal(fillEdition(work, work.editions[1], found).coverFull, 'covers/web/b.jpg');
});

test('placeEdition: a place goes on the paper copy where the e-book is shown', () => {
  const ebook = { id: 'e1', format: 'ebook' }, paper = { id: 'e2', format: 'paper' }, audio = { id: 'e3', format: 'audiobook' };
  assert.equal(placeEdition({ editions: [ebook, paper] }, ebook), paper);
  assert.equal(placeEdition({ editions: [audio, ebook, paper] }, audio), paper);
  assert.equal(placeEdition({ editions: [ebook] }, ebook), ebook);                               // no paper copy: the one shown
  const other = { id: 'e4' };
  assert.equal(placeEdition({ editions: [other, paper] }, other), other);                        // not said to be digital: as shown
});

test('nextEditionId: an edition in the book\'s own trash keeps its id', async () => {
  const { nextEditionId } = await import('../works.js');
  assert.equal(nextEditionId({ editions: [{ id: 'e1' }] }), 'e2');
  assert.equal(nextEditionId({ editions: [{ id: 'e1' }], trash: [{ at: '2026', edition: { id: 'e2' } }, { at: '2026', review: { id: 'r' } }] }), 'e3');
});

test('sameTitle: brackets and subtitles, but not two subtitles of one title', () => {
  assert.ok(sameTitle("Wit'ch Fire (Banned & the Banished)", "Wit'ch Fire"));
  assert.ok(sameTitle('Dune', 'Dune (Dune #1)'));
  assert.ok(sameTitle('The Hobbit: or There and Back Again', 'The Hobbit'));
  assert.ok(!sameTitle('Dune: Messiah', 'Dune: Children'));
  assert.ok(!sameTitle("Wit'ch Fire", "Wit'ch Storm (Banned & the Banished)"));
  assert.ok(!sameTitle('', 'Dune'));
});

test('titleLikeness: near spellings close, other volumes and other numbers not', () => {
  assert.equal(titleLikeness("Wit'ch Fire", 'Witch Fire'), 1);
  assert.ok(titleLikeness('The Colour of Magic', 'The Color of Magic') >= 0.7);
  assert.ok(titleLikeness("Wit'ch Fire", "Wit'ch Storm (Banned & the Banished)") < 0.7);
  assert.equal(titleLikeness('De Kiekeboes 12', 'De Kiekeboes 13'), 0);
});
