// A backup of the shelf (docs/shelf-ideas-plan.md, stage 1): one file holding everything this
// device keeps, as it keeps it: every book with its editions, reads and lists, every list, every
// term. Restoring reads the file back, says what it would change before anything is written, and
// writes only what was chosen. A restore is a merge, never a wipe: what is on the device and not
// in the file stays.
//
// Pure functions only, no DOM: the app (app.js) and the tests (tests/backup.test.mjs) use them.

/** The shape of the file. A file of a later format is refused: it may hold what this copy can't keep. */
export const FORMAT = 1;
/** What the file says it is, so another JSON file is not taken for one. */
export const KIND = 'folio-backup';
/** The three kinds of record, as the file names them. */
export const KINDS = ['books', 'lists', 'terms'];

const EPOCH = '1970-01-01T00:00:00.000Z';
const time = (iso) => Date.parse(iso) || 0;
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const clone = (x) => JSON.parse(JSON.stringify(x));

/** When a record was last changed, as sync reads it. */
export const stampOf = (record) => record?.modified || record?.added || EPOCH;

/** The file: {kind, format, app, made, books, lists, terms}, records as they are stored, oldest book first. */
export function makeBackup({ books = [], lists = [], terms = [], app = '', made = new Date().toISOString() } = {}) {
  const byAdded = [...books].sort((a, b) => (String(a.added || '') < String(b.added || '') ? -1 : 1));
  return { kind: KIND, format: FORMAT, app, made, books: clone(byAdded), lists: clone(lists), terms: clone(terms) };
}

/**
 * Reads a file's text. → {backup} or {error, app?}: `error` is one of
 * 'not-json', 'not-a-backup', 'newer' (made by a later format; `app` says which version made it).
 */
export function readBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { return { error: 'not-json' }; }
  if (!isObj(data) || data.kind !== KIND || !Number.isInteger(data.format)) return { error: 'not-a-backup' };
  if (data.format > FORMAT) return { error: 'newer', app: String(data.app || '') };
  const records = (rows) => (Array.isArray(rows) ? rows.filter((r) => isObj(r) && typeof r.id === 'string' && r.id) : []);
  return { backup: { ...data, books: records(data.books), lists: records(data.lists), terms: records(data.terms) } };
}

/** A record as compared: every key in a fixed order, `modified` left out (the same book changed back is the same). */
function canonical(x) {
  if (Array.isArray(x)) return x.map(canonical);
  if (!isObj(x)) return x;
  return Object.fromEntries(Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => [k, canonical(x[k])]));
}
export function sameRecord(a, b) {
  const strip = (r) => { const { modified, ...rest } = r || {}; return rest; };
  return JSON.stringify(canonical(strip(a))) === JSON.stringify(canonical(strip(b)));
}

/**
 * What restoring `backup` onto what the device has would do, per kind of record.
 * `here` is {books, lists, terms} as the device has them; `gone` is {books, lists, terms}, each a
 * map of id → when that record was deleted (by the server's tombstones, and this device's own
 * deletions not yet synced).
 * → {books, lists, terms}, each {added, same, differ, deleted, stay}:
 *   added    records in the file only;
 *   same     in both, alike;
 *   differ   [{mine, theirs, newer: 'mine' | 'theirs'}], in both and not alike;
 *   deleted  [{theirs, at}]: in the file, deleted here or elsewhere after the file had them;
 *   stay     how many records here the file does not have (they are left as they are).
 */
export function compare(backup, here, gone = {}) {
  const out = {};
  for (const kind of KINDS) {
    const mine = new Map((here[kind] || []).map((r) => [r.id, r]));
    const deletedAt = gone[kind] || {};
    const plan = { added: [], same: [], differ: [], deleted: [], stay: 0 };
    const inFile = new Set();
    for (const theirs of backup[kind] || []) {
      if (inFile.has(theirs.id)) continue;   // a file says each record once; a second is ignored
      inFile.add(theirs.id);
      const local = mine.get(theirs.id);
      if (!local) {
        const at = deletedAt[theirs.id];
        if (at && time(at) >= time(stampOf(theirs))) plan.deleted.push({ theirs, at });
        else plan.added.push(theirs);
      } else if (sameRecord(local, theirs)) plan.same.push(theirs);
      else plan.differ.push({ mine: local, theirs, newer: time(stampOf(theirs)) > time(stampOf(local)) ? 'theirs' : 'mine' });
    }
    plan.stay = [...mine.keys()].filter((id) => !inFile.has(id)).length;
    out[kind] = plan;
  }
  return out;
}

/**
 * The writes a restore makes, given the choices:
 *   prefer     'newer' (default): of two that differ, the more recently changed;
 *              'mine': leave what is here; 'theirs': take the file's;
 *   bringBack  true: also restore records deleted since the file was made.
 * → [{kind, record, before}]: `record` to write, with the `modified` it should carry, and
 *   `before`, what the device had (null for none), for undoing it.
 * A record keeps the file's `modified` where it is newer than what it replaces (so a newer
 * change elsewhere still wins, through sync); where the file's is taken over a newer one, or
 * brought back after it was deleted, it is stamped `now`, so sync takes it as the latest.
 */
export function writes(plan, { prefer = 'newer', bringBack = false, now = new Date().toISOString() } = {}) {
  const out = [];
  for (const kind of KINDS) {
    const p = plan[kind];
    for (const theirs of p.added) out.push({ kind, record: clone(theirs), before: null });
    for (const { mine, theirs, newer } of p.differ) {
      const take = prefer === 'theirs' || (prefer === 'newer' && newer === 'theirs');
      if (!take) continue;
      const record = clone(theirs);
      if (newer !== 'theirs') record.modified = now;
      out.push({ kind, record, before: clone(mine) });
    }
    if (bringBack) for (const { theirs } of p.deleted) out.push({ kind, record: { ...clone(theirs), modified: now }, before: null });
  }
  return out;
}

/** How many of each kind a set of writes adds and replaces: {books: {added, replaced}, …}. */
export function tally(list) {
  const out = Object.fromEntries(KINDS.map((kind) => [kind, { added: 0, replaced: 0 }]));
  for (const w of list) out[w.kind][w.before ? 'replaced' : 'added'] += 1;
  return out;
}
