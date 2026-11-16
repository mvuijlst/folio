// node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
  upgrade, settle, mainEdition, faceEdition, shelves, newWork, addEdition, findWork, combine, split, twins, flatView, fold,
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

test('flatView is the book as one edition', () => {
  const book = fx('paper-then-audiobook');
  assert.equal(flatView(book).format, 'audiobook');
  assert.equal(flatView(book, book.editions[0]).publisher, 'Avon');
  assert.equal(fold('Jerzy  Kosiński!'), 'jerzy kosinski');
});
