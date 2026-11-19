// Words the app keeps in two languages: the roles of people on a book (who drew it, coloured
// it, read it aloud), and its categories and tags (further down).
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

/* ───────────────────────── Categories and tags ─────────────────────────

   Both are stored on a book as the booklog's slug (`categories`, `tags`: "science-fiction",
   "belgie"), and naming them never changes that. Each has a name in Dutch, which is the title
   of its page in the booklog ("België"), and one in English for showing ("Belgium"). The Dutch
   names come from the booklog (the server says them); without it a slug is its own name
   ("science fiction"). Your names, and tags merged into another, are records:
   {id: "tag:belgie", kind: "tag", value: "belgie", nl, en, aliases: [merged slugs]}.
   Categories are the booklog's fixed set (D-055, D-057): they can be named, not added or merged. */

/** The categories' English names, as the app comes. */
export const CATEGORY_EN = {
  literatuur: 'literature', fantasy: 'fantasy', 'science-fiction': 'science fiction', horror: 'horror', crime: 'crime',
  romance: 'romance', comic: 'comics', geschiedenis: 'history', biografie: 'biography', wetenschap: 'science',
  religie: 'religion', taal: 'language', design: 'design', kunst: 'art', koken: 'cooking', informatica: 'computing',
  'non-fictie': 'non-fiction',
};

/** As the booklog (Hugo) turns a name into an address: "Lanfeust des étoiles" → "lanfeust-des-etoiles". */
export const slugify = (s) => String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').replace(/['’]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
/** A slug as a name, when nothing better is known: "science-fiction" → "science fiction". */
export const prettify = (slug) => String(slug ?? '').replace(/-/g, ' ');

/**
 * The categories or tags (`kind`) as names: slug → {id, kind, value, nl, en, aliases, record}.
 * From the booklog's names (`booklog`: slug → title), every slug in `used`, and your records on top.
 */
export function names(records, kind, { booklog = {}, used = [] } = {}) {
  const out = new Map();
  const add = (slug) => {
    if (!slug || out.has(slug)) return;
    out.set(slug, { id: `${kind}:${slug}`, kind, value: slug, nl: '', en: kind === 'category' ? CATEGORY_EN[slug] || '' : '', aliases: [] });
  };
  for (const slug of Object.keys(booklog)) add(slug);
  for (const slug of used) add(slug);
  for (const [slug, title] of Object.entries(booklog)) if (clean(title)) out.get(slug).nl = clean(title);   // the booklog's name, even when it is the slug itself
  for (const r of records || []) {
    if (!r || r.kind !== kind || !r.value) continue;
    add(r.value);
    const entry = out.get(r.value);
    for (const key of ['nl', 'en']) if (key in r) entry[key] = clean(r[key]);
    entry.aliases = [...new Set([...(entry.aliases || []), ...(r.aliases || [])])];
    entry.record = true;
  }
  return out;
}

/** The name of a slug in `lang`: its name there, else its Dutch one, else the slug itself. */
export const nameOf = (map, slug, lang) => {
  const entry = map.get(slug);
  return clean(entry?.[lang]) || clean(entry?.nl) || prettify(slug);
};

/** fold(any way of writing it: slug, names, slugs merged into it) → slug. */
export function nameIndex(map) {
  const by = new Map();
  for (const entry of map.values()) {
    for (const word of [entry.value, prettify(entry.value), entry.nl, entry.en, ...(entry.aliases || [])]) {
      const key = fold(word);
      if (key && !by.has(key)) by.set(key, entry.value);
    }
  }
  return by;
}

/** Tags as typed or found → as stored: a known one as its slug, a new one slugged; nothing twice. */
export function canonicalTags(list, map, by = nameIndex(map)) {
  const out = [];
  for (const word of list || []) {
    const slug = by.get(fold(word)) || slugify(word);
    if (slug && !out.includes(slug)) out.push(slug);
  }
  return out;
}

/** How many books have each slug in `key` ('tags' or 'categories'). */
export function counts(books, key) {
  const n = new Map();
  for (const b of books || []) for (const slug of new Set(b?.[key] || [])) n.set(slug, (n.get(slug) || 0) + 1);
  return n;
}

/**
 * Tags that could go, or be one: {kind: 'alike', from, to} for two spellings of one word
 * (vampiers, vampieren: the one on fewer books goes), {kind: 'category', tag} for a tag that
 * says what a category says, {kind: 'series', tag} for one that names a series.
 */
export function tagSuggestions(books, { categories = [], series = [] } = {}) {
  const n = counts(books, 'tags');
  const stem = (slug) => {
    const k = slug.replace(/-/g, '');
    return k.endsWith('en') && k.length > 4 ? k.slice(0, -2) : k.replace(/s$/, '');
  };
  const groups = new Map();
  for (const slug of n.keys()) (groups.get(stem(slug)) || groups.set(stem(slug), []).get(stem(slug))).push(slug);
  const out = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => n.get(b) - n.get(a) || a.localeCompare(b));
    for (const from of group.slice(1)) out.push({ kind: 'alike', from, to: group[0], books: n.get(from) });
  }
  // Only where it says nothing more: on the books that have that category, or are in that series.
  const cats = new Set(categories), named = new Set(series.map(slugify));
  for (const slug of n.keys()) {
    const kind = cats.has(slug) ? 'category' : named.has(slug) ? 'series' : '';
    const said = kind && (books || []).filter((b) => (b?.tags || []).includes(slug) && redundant(kind, b, slug)).length;
    if (said) out.push({ kind, tag: slug, books: said, everywhere: said === n.get(slug) });
  }
  return out;
}

/** Whether book `b` says what tag `slug` says already: it has that category, or is in that series. */
export const redundant = (kind, b, slug) => (kind === 'category' ? (b?.categories || []).includes(slug) : slugify(b?.series) === slug);

/** Rewrites `key` ('tags') on books with fn(list) → list; returns [{book, before}] of those that changed. Changes them in place. */
export function rewriteList(books, key, fn) {
  const changed = [];
  for (const book of books || []) {
    const before = Array.isArray(book?.[key]) ? book[key] : [];
    const after = fn(before);
    if (after.length !== before.length || after.some((x, i) => x !== before[i])) {
      changed.push({ book, before });
      if (after.length) book[key] = after; else delete book[key];
    }
  }
  return changed;
}
/** Tag `from` becomes `to` on every book (once). */
export const mergeTag = (books, from, to) => rewriteList(books, 'tags', (list) => (list.includes(from) ? [...new Set(list.map((x) => (x === from ? to : x)))] : list));
/** Tag `slug` off every book. */
export const removeTag = (books, slug) => rewriteList(books, 'tags', (list) => list.filter((x) => x !== slug));
/** Tag `slug` off the books for which where(book) holds. */
export const removeTagWhere = (books, slug, where) => rewriteList((books || []).filter(where), 'tags', (list) => list.filter((x) => x !== slug));
