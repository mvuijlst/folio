// Words the app keeps in two languages: for now the roles of people on a book (who drew it,
// coloured it, read it aloud). Lists, categories and tags are meant to join later.
//
// A role is stored on a book as its Dutch word, because that is how the booklog says it
// (`roles:` in a post), and publishing sends it as it is. The English word is for showing.
// A role with no Dutch word yet is stored as its English one. Renaming a role's Dutch word
// therefore rewrites the books that have it (the app does that, see `renameOnBooks`).
//
// The app comes with a set of roles (ROLES). Your changes to them, and roles of your own,
// are records like lists: kept on the device and synced with an account. A record with the id
// of a standard role overrides it; `gone: true` hides one.
//
// Pure functions only, no DOM: the app imports them, and so do the tests (node --test tests/).

/** The language a word is stored in; the other is for showing. */
export const STORED = 'nl';
export const LANGS = ['en', 'nl'];

/** The roles every device starts with: the words the booklog uses most. */
export const ROLES = [
  ['tekst', 'writer'],
  ['beeld', 'artist'],
  ['potlood', 'penciller'],
  ['inkt', 'inker'],
  ['kleur', 'colourist'],
  ['letters', 'letterer'],
  ['illustraties', 'illustrator'],
  ['stem', 'narrator'],
  ['vertaling', 'translator'],
  ['redactie', 'editor'],
  ['voorwoord', 'foreword'],
].map(([nl, en]) => ({ id: `role-${nl}`, kind: 'role', nl, en, aliases: [], standard: true }));

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
/** For comparing words: no case, no accents, no punctuation (as works.js and the server fold). */
export const fold = (s) => (String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).join(' ');

/** The value a term puts on a book. */
export const valueOf = (term) => clean(term[STORED]) || clean(term.en) || clean(Object.values(term).find((v) => typeof v === 'string'));

/** The terms of a kind: the standard ones as you changed them, then your own, in that order. */
export function vocabulary(records, kind = 'role') {
  const mine = new Map((records || []).filter((r) => r && r.kind === kind).map((r) => [r.id, r]));
  const out = [];
  for (const term of kind === 'role' ? ROLES : []) {
    const over = mine.get(term.id);
    mine.delete(term.id);
    if (over?.gone) continue;
    out.push(over ? { ...term, ...over, standard: true } : term);
  }
  for (const r of mine.values()) if (!r.gone && valueOf(r)) out.push(r);
  return out;
}

/** "tekst en beeld", "tekst & beeld", "tekst, beeld" → ['tekst', 'beeld']: one person, several roles. */
export function split(text) {
  return clean(text).split(/\s*(?:,|;|&|\+|\/|\s(?:en|and|et|und)\s)\s*/i).map(clean).filter(Boolean);
}

/** fold(word) → term, for every way of writing a term: in each language, and its aliases. */
export function index(terms) {
  const by = new Map();
  for (const term of terms) for (const word of [valueOf(term), ...LANGS.map((l) => term[l]), ...(term.aliases || [])]) {
    const key = fold(word);
    if (key && !by.has(key)) by.set(key, term);
  }
  return by;
}

/** A role as typed or found → as it is stored: each part as its term's value, nothing twice, ", " between. */
export function canonical(text, terms, by = index(terms)) {
  const out = [];
  for (const part of split(text)) {
    const term = by.get(fold(part));
    const value = term ? valueOf(term) : part;
    if (!out.some((v) => fold(v) === fold(value))) out.push(value);
  }
  return out.join(', ');
}

/** A role as stored → as shown in `lang`: each part in that language where it has a word there. */
export function display(text, terms, lang, by = index(terms)) {
  return split(text).map((part) => {
    const term = by.get(fold(part));
    return term ? clean(term[lang]) || valueOf(term) : part;
  }).join(', ');
}

/** Every role on the shelf, in every edition's people. Calls fn(person, book, edition). */
function eachRole(books, fn) {
  for (const book of books || []) for (const e of book.editions || []) for (const person of e.people || []) {
    if (person && clean(person.role)) fn(person, book, e);
  }
}

/**
 * How roles are written on the shelf, against the terms:
 *  - `used`: term id → how many people have it (as one of their roles);
 *  - `unknown`: words that are no term, [{word, count, books: [title…]}], most used first;
 *  - `differently`: roles written otherwise than they are stored, [{from, to, count, books}].
 */
export function survey(books, terms) {
  const by = index(terms);
  const used = new Map(), unknown = new Map(), differently = new Map();
  eachRole(books, (person, book) => {
    const role = clean(person.role);
    for (const part of split(role)) {
      const term = by.get(fold(part));
      if (term) used.set(term.id, (used.get(term.id) || 0) + 1);
      else {
        const row = unknown.get(fold(part)) || unknown.set(fold(part), { word: part, count: 0, books: [] }).get(fold(part));
        row.count += 1;
        if (!row.books.includes(book.title)) row.books.push(book.title);
      }
    }
    const to = canonical(role, terms, by);
    if (to !== role) {
      const row = differently.get(role) || differently.set(role, { from: role, to, count: 0, books: [] }).get(role);
      row.count += 1;
      if (!row.books.includes(book.id)) row.books.push(book.id);
    }
  });
  const order = (a, b) => b.count - a.count || a.word?.localeCompare?.(b.word) || 0;
  return { used, unknown: [...unknown.values()].sort(order), differently: [...differently.values()].sort((a, b) => b.count - a.count || a.from.localeCompare(b.from)) };
}

/**
 * Rewrites the roles of people on books with `fn(role) → role`. Returns the books that changed,
 * each with what its editions' people were before ({book, before}), so it can be undone.
 * Changes the books in place.
 */
export function rewrite(books, fn) {
  const changed = [];
  for (const book of books || []) {
    let before = null;
    for (const e of book.editions || []) {
      if (!Array.isArray(e.people)) continue;
      const people = e.people.map((person) => {
        if (!person || !clean(person.role)) return person;
        const role = fn(clean(person.role));
        return role === person.role ? person : { ...person, role };
      });
      if (people.some((p, i) => p !== e.people[i])) {
        before ??= Object.fromEntries((book.editions || []).map((x) => [x.id, x.people]));
        e.people = people;
      }
    }
    if (before) changed.push({ book, before });
  }
  return changed;
}

/** Every role written as its term's value: the cleanup. */
export const tidyOnBooks = (books, terms) => {
  const by = index(terms);
  return rewrite(books, (role) => canonical(role, terms, by));
};

/** `word` (one part of a role) written as `value` instead, wherever it appears. Roles without it stay exactly as they are. */
export const renameOnBooks = (books, word, value) => rewrite(books, (role) => {
  if (!split(role).some((part) => fold(part) === fold(word))) return role;
  const parts = split(role).map((part) => (fold(part) === fold(word) ? value : part));
  return parts.filter((part, i) => parts.findIndex((p) => fold(p) === fold(part)) === i).join(', ');
});

/** The terms that lack a word in `lang`. */
export const missing = (terms, lang) => terms.filter((term) => !clean(term[lang]));
