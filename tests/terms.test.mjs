import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../terms.js';

const book = (id, ...roles) => ({ id, title: id, editions: [{ id: 'e1', people: roles.map((role, i) => ({ name: `P${i}`, role })) }] });

test('split takes one role per part, however they are joined', () => {
  assert.deepEqual(T.split('tekst en beeld'), ['tekst', 'beeld']);
  assert.deepEqual(T.split('tekst & beeld'), ['tekst', 'beeld']);
  assert.deepEqual(T.split(' tekst ,beeld '), ['tekst', 'beeld']);
  assert.deepEqual(T.split('oorspronkelijke reeks'), ['oorspronkelijke reeks']);
  assert.deepEqual(T.split('tekeningen'), ['tekeningen']);
  assert.deepEqual(T.split(''), []);
});

test('canonical writes each part as its term stores it', () => {
  const terms = T.vocabulary([]);
  assert.equal(T.canonical('tekst en beeld', terms), 'tekst, beeld');
  assert.equal(T.canonical('Narrator', terms), 'stem');
  assert.equal(T.canonical('kleur en cover', terms), 'kleur, cover');
  assert.equal(T.canonical('beeld, Beeld', terms), 'beeld');
  assert.equal(T.canonical('', terms), '');
});

test('display shows a role in the language asked for', () => {
  const terms = T.vocabulary([]);
  assert.equal(T.display('tekst, beeld', terms, 'en'), 'writer, artist');
  assert.equal(T.display('tekst, beeld', terms, 'nl'), 'tekst, beeld');
  assert.equal(T.display('DEATH', terms, 'en'), 'DEATH');
});

test('your records change, hide and add to the standard roles', () => {
  const terms = T.vocabulary([
    { id: 'role-tekst', kind: 'role', nl: 'tekst', en: 'story', aliases: ['auteur'] },
    { id: 'role-voorwoord', kind: 'role', gone: true },
    { id: 'x1', kind: 'role', nl: 'voetnoten', en: '' },
    { id: 'x2', kind: 'category', nl: 'strip', en: 'comic' },
  ]);
  assert.equal(terms.find((term) => term.id === 'role-tekst').en, 'story');
  assert.ok(!terms.some((term) => term.id === 'role-voorwoord'));
  assert.ok(terms.some((term) => term.nl === 'voetnoten'));
  assert.ok(!terms.some((term) => term.nl === 'strip'));
  assert.equal(T.canonical('Auteur', terms), 'tekst');
  assert.deepEqual(T.missing(terms, 'en').map((term) => term.nl), ['voetnoten']);
});

test('a role with only an English word is stored as that word', () => {
  const terms = T.vocabulary([{ id: 'x', kind: 'role', en: 'storyboard' }]);
  assert.equal(T.canonical('Storyboard', terms), 'storyboard');
});

test('survey finds unknown words and roles written differently', () => {
  const terms = T.vocabulary([]);
  const s = T.survey([book('a', 'tekst en beeld', 'DEATH'), book('b', 'tekst & beeld', 'beeld'), book('c', 'DEATH')], terms);
  assert.deepEqual(s.unknown.map((u) => [u.word, u.count]), [['DEATH', 2]]);
  assert.deepEqual(s.differently.map((d) => [d.from, d.to, d.count]), [['tekst & beeld', 'tekst, beeld', 1], ['tekst en beeld', 'tekst, beeld', 1]]);
  assert.equal(s.used.get('role-beeld'), 3);
});

test('tidy rewrites in place and remembers what was there', () => {
  const books = [book('a', 'tekst en beeld', 'stem'), book('b', 'beeld')];
  const changed = T.tidyOnBooks(books, T.vocabulary([]));
  assert.equal(changed.length, 1);
  assert.equal(books[0].editions[0].people[0].role, 'tekst, beeld');
  assert.equal(changed[0].before.e1[0].role, 'tekst en beeld');
});

test('renaming a word keeps the other parts and drops a doubled one', () => {
  const books = [book('a', 'scenario, tekst'), book('b', 'scenario'), book('c', 'beeld')];
  const changed = T.renameOnBooks(books, 'Scenario', 'tekst');
  assert.equal(changed.length, 2);
  assert.equal(books[0].editions[0].people[0].role, 'tekst');
  assert.equal(books[1].editions[0].people[0].role, 'tekst');
});

test('renaming a word leaves roles without it alone, however they are written', () => {
  const books = [book('a', 'tekst en beeld'), book('b', 'schrijver')];
  const changed = T.renameOnBooks(books, 'schrijver', 'tekst');
  assert.deepEqual(changed.map((c) => c.book.id), ['b']);
  assert.equal(books[0].editions[0].people[0].role, 'tekst en beeld');
});

test('categories and tags are named from the booklog, your records on top', () => {
  const map = T.names([{ id: 'tag:belgie', kind: 'tag', value: 'belgie', en: 'Belgium', aliases: ['belgium'] }], 'tag',
    { booklog: { belgie: 'België', 'b-p-r-d': 'B.P.R.D.' }, used: ['space-opera'] });
  assert.equal(T.nameOf(map, 'belgie', 'en'), 'Belgium');
  assert.equal(T.nameOf(map, 'belgie', 'nl'), 'België');
  assert.equal(T.nameOf(map, 'b-p-r-d', 'en'), 'B.P.R.D.');
  assert.equal(T.nameOf(map, 'space-opera', 'nl'), 'space opera');
  assert.deepEqual(T.canonicalTags(['België', 'Belgium', 'Space Opera', 'Lanfeust des étoiles'], map), ['belgie', 'space-opera', 'lanfeust-des-etoiles']);
  const cats = T.names([], 'category', { used: ['geschiedenis'] });
  assert.equal(T.nameOf(cats, 'geschiedenis', 'en'), 'history');
});

test('tag suggestions: two spellings, a category, a series', () => {
  const books = [{ tags: ['vampieren', 'fantasy'], categories: ['fantasy'] }, { tags: ['vampieren', 'fantasy'] }, { tags: ['vampiers', 'discworld'], series: 'Discworld' },
    { tags: ['robot'] }, { tags: ['robots'] }, { tags: ['robots', 'taal'] }];
  const s = T.tagSuggestions(books, { categories: ['fantasy', 'taal'], series: ['Discworld'] });
  assert.deepEqual(s.filter((x) => x.kind === 'alike').map((x) => [x.from, x.to]), [['vampiers', 'vampieren'], ['robot', 'robots']]);
  // Only where the category or series says it: fantasy on one of its two books, taal on none.
  assert.deepEqual(s.filter((x) => x.kind !== 'alike').map((x) => [x.kind, x.tag, x.books, x.everywhere]), [['category', 'fantasy', 1, false], ['series', 'discworld', 1, true]]);
  T.removeTagWhere(books, 'fantasy', (b) => T.redundant('category', b, 'fantasy'));
  assert.deepEqual(books.slice(0, 2).map((b) => b.tags), [['vampieren'], ['vampieren', 'fantasy']]);
});

test('merging and removing tags, with what was there', () => {
  const books = [{ tags: ['vampiers', 'vampieren'] }, { tags: ['vampiers'] }, { tags: ['x'] }];
  const merged = T.mergeTag(books, 'vampiers', 'vampieren');
  assert.equal(merged.length, 2);
  assert.deepEqual(books.map((b) => b.tags), [['vampieren'], ['vampieren'], ['x']]);
  assert.deepEqual(merged[0].before, ['vampiers', 'vampieren']);
  T.removeTag(books, 'x');
  assert.equal('tags' in books[2], false);
});
