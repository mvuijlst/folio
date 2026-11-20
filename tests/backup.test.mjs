import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../backup.js';

// A shelf as a device keeps it: a book with two editions, reads, lists with notes, people,
// categories, booklog links and an inline thumbnail; lists; terms (a role, a list word, a series).
const shelf = () => ({
  books: [
    {
      id: 'b1', added: '2025-01-02T10:00:00.000Z', modified: '2026-11-01T09:00:00.000Z', v: 2,
      title: 'De historicus', author: 'Elizabeth Kostova', series: '', categories: ['roman'], tags: ['vampieren'],
      olid: 'OL123W', originalLanguage: 'en', originalTitle: 'The Historian',
      lists: { read: { at: '2025-03-01T00:00:00.000Z' } }, main: 'e1', boeken: 'de-historicus', url: 'https://boeken.tsuk.org/x/',
      editions: [
        { id: 'e1', format: 'paper', isbn: '9789021015996', publisher: 'Poema Pocket', date: '2011', pages: 687,
          cover: 'covers/abc.jpg', people: [{ name: 'Elizabeth Kostova', role: '' }, { name: 'Ine Willems', role: 'vertaling' }],
          lists: { library: { at: '2025-01-02T10:00:00.000Z' }, lent: { at: '2026-11-03T00:00:00.000Z', note: 'Jan' } } },
        { id: 'e2', format: 'audiobook', asin: 'B00X', thumb: 'data:image/jpeg;base64,AAAA', coverPhoto: true, duration: 1500 },
      ],
      reviews: [{ id: 'r1', ed: 'e1', date: '2025-03-01', rating: 8, text: 'Goed.', boeken: 'de-historicus' }],
    },
    { id: 'b2', added: '2026-05-05T10:00:00.000Z', modified: '2026-05-05T10:00:00.000Z', v: 2, title: 'Dune', author: 'Frank Herbert',
      lists: { 'to-read': { at: '2026-05-05T10:00:00.000Z' } }, editions: [{ id: 'e1', format: 'ebook' }] },
  ],
  lists: [
    { id: 'library', name: 'Library', group: '', noteLabel: '', order: 0, modified: '1970-01-01T00:00:00.000Z' },
    { id: 'lent', name: 'Lent out', group: '', noteLabel: 'Lent to', order: 5, modified: '2026-01-01T00:00:00.000Z', public: false },
    { id: 'x1', name: 'Bureau', group: 'Plaats', noteLabel: '', order: 6, modified: '2026-02-01T00:00:00.000Z' },
  ],
  terms: [
    { id: 'role:vertaling', kind: 'role', nl: 'vertaling', en: 'translator', modified: '2026-03-01T00:00:00.000Z' },
    { id: 'series:Suske en Wiske', kind: 'series', value: 'Suske en Wiske', total: 370, modified: '2026-04-01T00:00:00.000Z' },
  ],
});

/** A device: what it has, after the writes of a restore. */
function applyWrites(here, list) {
  const out = { books: [...(here.books || [])], lists: [...(here.lists || [])], terms: [...(here.terms || [])] };
  for (const w of list) {
    out[w.kind] = out[w.kind].filter((r) => r.id !== w.record.id);
    out[w.kind].push(w.record);
  }
  return out;
}
const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));

test('a backup restored into an empty device gives the same shelf, record for record', () => {
  const made = B.makeBackup({ ...shelf(), app: '2.29.0' });
  const read = B.readBackup(JSON.stringify(made));
  assert.ok(read.backup);
  const plan = B.compare(read.backup, { books: [], lists: [], terms: [] });
  const list = B.writes(plan);
  const after = applyWrites({}, list);
  for (const kind of B.KINDS) assert.deepEqual(byId(after[kind]), byId(shelf()[kind]), kind);
  assert.deepEqual(B.tally(list), { books: { added: 2, replaced: 0 }, lists: { added: 3, replaced: 0 }, terms: { added: 2, replaced: 0 } });
});

test('the file says what it is, and a file of a later format is refused', () => {
  assert.equal(B.readBackup('not json').error, 'not-json');
  assert.equal(B.readBackup('[{"title":"Dune"}]').error, 'not-a-backup');   // an export, not a backup
  const later = B.readBackup(JSON.stringify({ ...B.makeBackup({ app: '9.0.0' }), format: B.FORMAT + 1 }));
  assert.equal(later.error, 'newer');
  assert.equal(later.app, '9.0.0');
});

test('restoring onto the same shelf changes nothing', () => {
  const plan = B.compare(B.makeBackup(shelf()), shelf());
  for (const kind of B.KINDS) {
    assert.equal(plan[kind].same.length, shelf()[kind].length);
    assert.equal(plan[kind].added.length + plan[kind].differ.length + plan[kind].deleted.length, 0);
  }
  assert.deepEqual(B.writes(plan, { prefer: 'theirs', bringBack: true }), []);
});

test('the same record with keys in another order, or only stamped later, is the same', () => {
  const a = shelf().books[1];
  const b = Object.fromEntries(Object.entries(a).reverse());
  b.modified = '2026-11-19T00:00:00.000Z';
  assert.ok(B.sameRecord(a, b));
});

test('of two that differ: the newer by default, else mine or the file’s', () => {
  const file = B.makeBackup(shelf());
  const here = shelf();
  here.books[0].title = 'Changed here, later';
  here.books[0].modified = '2026-11-15T00:00:00.000Z';          // newer than the file's
  here.books[1].title = 'Changed here, earlier';
  here.books[1].modified = '2026-01-01T00:00:00.000Z';           // older than the file's
  const plan = B.compare(file, here);
  assert.deepEqual(plan.books.differ.map((d) => [d.mine.id, d.newer]), [['b1', 'mine'], ['b2', 'theirs']]);

  const now = '2026-11-20T12:00:00.000Z';
  const newer = B.writes(plan, { now });
  assert.deepEqual(newer.map((w) => w.record.id), ['b2']);
  assert.equal(newer[0].record.modified, '2026-05-05T10:00:00.000Z');   // keeps its own: a later change elsewhere still wins
  assert.equal(newer[0].before.title, 'Changed here, earlier');          // what Undo puts back

  assert.deepEqual(B.writes(plan, { prefer: 'mine', now }), []);

  const theirs = B.writes(plan, { prefer: 'theirs', now });
  assert.deepEqual(theirs.map((w) => [w.record.id, w.record.modified]), [['b1', now], ['b2', '2026-05-05T10:00:00.000Z']]);
});

test('what was deleted since the file was made stays deleted unless asked for', () => {
  const file = B.makeBackup(shelf());
  const here = { ...shelf(), books: [shelf().books[1]] };
  // b1 deleted after the file had it; a list deleted before the file's version was made comes back.
  const gone = { books: { b1: '2026-11-10T00:00:00.000Z' }, lists: { x1: '2026-01-01T00:00:00.000Z' } };
  const plan = B.compare(file, { ...here, lists: here.lists.filter((l) => l.id !== 'x1') }, gone);
  assert.deepEqual(plan.books.deleted.map((d) => d.theirs.id), ['b1']);
  assert.equal(plan.books.added.length, 0);
  assert.deepEqual(plan.lists.added.map((l) => l.id), ['x1']);

  assert.deepEqual(B.writes(plan).filter((w) => w.kind === 'books'), []);
  const now = '2026-11-20T12:00:00.000Z';
  const back = B.writes(plan, { bringBack: true, now }).filter((w) => w.kind === 'books');
  assert.deepEqual(back.map((w) => [w.record.id, w.record.modified, w.before]), [['b1', now, null]]);
});

test('what is here and not in the file stays, and is counted', () => {
  const file = B.makeBackup({ ...shelf(), books: [shelf().books[0]] });
  const plan = B.compare(file, shelf());
  assert.equal(plan.books.stay, 1);
  assert.deepEqual(B.writes(plan), []);
});
