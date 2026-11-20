// National catalogues (docs/shelf-ideas-plan.md, stage 3): an ISBN's registration group says which
// national bibliography to ask beside Open Library and Google Books: 978-90 and 978-94 the Dutch
// KB, 978-2 and 979-10 the French BnF. Both answer a browser (CORS), so the device asks them; the
// server asks them the same way (shelf/national.py). For its own group the national record wins on
// publisher, year, pages and language. Title and writers stay as the other catalogues have them
// (the national ones write names in full, "John Ronald Reuel Tolkien", where the shelf and the
// booklog know "J.R.R. Tolkien"); they are taken only when no other catalogue has any.
// Series are not read from these records, on purpose: a wrong series does more harm than none.
//
// Pure functions only, no DOM: the app builds the address and reads the answer; tests/national.test.mjs.

/** Which national catalogue covers this ISBN-13: 'kb', 'bnf', or '' for none. */
export function nationalFor(isbn) {
  const s = String(isbn || '');
  if (/^978(90|94)\d{8}$/.test(s)) return 'kb';
  if (/^9782\d{9}$/.test(s) || /^97910\d{8}$/.test(s)) return 'bnf';
  return '';
}

/** The names the app shows for each catalogue. */
export const CATALOGUE_NAMES = { google: 'Google Books', openlibrary: 'Open Library', kb: 'KB', bnf: 'BnF' };

/** ISBN-13 (978) as ISBN-10, which older records hold ('' for 979). */
export function isbn10(isbn13) {
  if (!/^978\d{10}$/.test(isbn13 || '')) return '';
  const core = isbn13.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(core[i]) * (10 - i);
  const check = (11 - (sum % 11)) % 11;
  return core + (check === 10 ? 'X' : String(check));
}

const MARC = { eng: 'en', dut: 'nl', nld: 'nl', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', spa: 'es', ita: 'it', por: 'pt', swe: 'sv',
  dan: 'da', nor: 'no', fin: 'fi', pol: 'pl', rus: 'ru', lat: 'la', gre: 'el', jpn: 'ja', chi: 'zh', afr: 'af', fry: 'fy' };
const language = (code) => { const c = String(code || '').toLowerCase(); return /^[a-z]{2}$/.test(c) ? c : MARC[c] || ''; };
const yearIn = (text) => (String(text || '').match(/\b(1[5-9]\d\d|20\d\d)\b/) || [])[1] || '';
const clean = (text) => String(text || '').replace(/\s+/g, ' ').replace(/^[\s[(]+|[\s\])/:;,.]+$/g, '').trim();

/* ── KB: data.bibliotheken.nl, a SPARQL endpoint over the Nederlandse Bibliografie ── */

export const KB_ENDPOINT = 'https://data.bibliotheken.nl/sparql';

/** The SPARQL that asks the KB about one ISBN, as ISBN-13 and as ISBN-10 (older records). */
export function kbQuery(isbn) {
  const values = [isbn, isbn10(isbn)].filter(Boolean).map((v) => `"${v}"`).join(' ');
  return `PREFIX schema: <http://schema.org/>
SELECT ?name ?pages ?lang ?publisher ?year ?author WHERE {
  VALUES ?isbn { ${values} }
  ?b schema:isbn ?isbn .
  OPTIONAL { ?b schema:name ?name }
  OPTIONAL { ?b schema:numberOfPages ?pages }
  OPTIONAL { ?b schema:inLanguage ?lang }
  OPTIONAL { ?b schema:publication ?p . OPTIONAL { ?p schema:startDate ?year } OPTIONAL { ?p schema:publishedBy ?by . ?by schema:name ?publisher } }
  OPTIONAL { ?b schema:author ?a . ?a schema:name ?author }
} LIMIT 40`;
}
export const kbUrl = (isbn) => `${KB_ENDPOINT}?query=${encodeURIComponent(kbQuery(isbn))}`;

/** The KB's SPARQL JSON answer → a book as the lookups have one ({title, author, publisher, date, pages, language}), or null. */
export function fromKb(json) {
  const rows = (json?.results?.bindings || []).map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v?.value])));
  if (!rows.length) return null;
  const first = (key) => rows.map((r) => r[key]).find(Boolean) || '';
  const authors = [...new Set(rows.map((r) => clean(r.author)).filter(Boolean))];
  const pages = Number(first('pages'));
  return {
    title: clean(first('name')),
    author: authors.join(', '),
    publisher: clean(first('publisher')),
    date: yearIn(first('year')),
    pages: pages > 0 ? pages : null,
    language: language(first('lang')),
  };
}

/* ── BnF: catalogue.bnf.fr, SRU in UNIMARC ── */

export const bnfUrl = (isbn) => `https://catalogue.bnf.fr/api/SRU?version=1.2&operation=searchRetrieve&query=${encodeURIComponent(`bib.isbn adj "${isbn}"`)}&recordSchema=unimarcxchange&maximumRecords=1`;

/** UNIMARC fields of the first record in an SRU answer: {tag: [{code: [values]}]}. Read with patterns, so it runs without a DOM. */
export function unimarcFields(xml) {
  const record = (String(xml || '').match(/<(?:\w+:)?record\b[^>]*>[\s\S]*?<\/(?:\w+:)?record>/) || [''])[0];
  const fields = {};
  for (const m of record.matchAll(/<(?:\w+:)?datafield\b[^>]*\btag="(\d{3})"[^>]*>([\s\S]*?)<\/(?:\w+:)?datafield>/g)) {
    const subs = {};
    for (const s of m[2].matchAll(/<(?:\w+:)?subfield\b[^>]*\bcode="(\w)"[^>]*>([\s\S]*?)<\/(?:\w+:)?subfield>/g)) {
      (subs[s[1]] ||= []).push(decode(s[2]));
    }
    (fields[m[1]] ||= []).push(subs);
  }
  return fields;
}
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

/** The BnF's SRU answer → a book as the lookups have one, or null. */
export function fromBnf(xml) {
  if (!/<(?:\w+:)?numberOfRecords>\s*[1-9]/.test(String(xml || ''))) return null;
  const f = unimarcFields(xml);
  const one = (tag, code) => (f[tag] || []).map((x) => x[code]?.[0]).find(Boolean) || '';
  const title = f['200']?.[0] || {};
  // 200 $a the title, $e a subtitle; $h and $i a part's number and title.
  const main = [title.a?.[0], title.e?.[0]].filter(Boolean).map(clean).join(': ');
  const part = [title.h?.[0], title.i?.[0]].filter(Boolean).map(clean).join(', ');
  // 700 the first author, 701 the others ($a surname, $b forename); 702 (translators, illustrators) not.
  const authors = [...(f['700'] || []), ...(f['701'] || [])]
    .map((x) => [x.b?.[0], x.a?.[0]].filter(Boolean).map(clean).join(' ')).filter(Boolean);
  // 210 (older) or 214 (newer records): $c the publisher, $d the date.
  const publisher = clean(one('210', 'c') || one('214', 'c'));
  const pages = Number((one('215', 'a').match(/(\d+)\s*p\b/) || [])[1]);
  return {
    title: [main, part].filter(Boolean).join('. '),
    author: [...new Set(authors)].join(', '),
    publisher,
    date: yearIn(one('210', 'd') || one('214', 'd')),
    pages: pages > 0 ? pages : null,
    language: language(one('101', 'a')),
  };
}

/** What a national record says over the others' merged book: publisher, year, pages and language
    win; title and writers only where the others have none. */
export function withNational(merged, national) {
  if (!national) return merged;
  const out = { ...merged };
  for (const key of ['publisher', 'date', 'pages', 'language']) if (national[key]) out[key] = national[key];
  for (const key of ['title', 'author']) if (!out[key] && national[key]) out[key] = national[key];
  return out;
}
