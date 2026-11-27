"""Folio → Hardcover, one way (docs/hardcover-sync-plan.md): the books with a reading status go to
the user's library on Hardcover, with that status, the rating and the dated reads.

Folio is the record. The sync only overwrites what it sends: the status, the rating (when Folio
has one), the edition (when Folio's edition is on Hardcover) and the reads of Folio's dates. It
never sends reviews, categories, tags, places or notes, and never clears a rating. A Hardcover
entry that was there before the sync (Michel imported his Goodreads shelf in 2023) is adopted and
updated, never deleted. Only what the sync added itself is taken away again when the book leaves
Folio's shelf, or loses its reading status.

Books are matched by number first: ISBN-13, ISBN-10 or ASIN, edition by edition (the edition of
the latest read first, then the main one, then the rest). A book no number finds may still be in
the user's own Hardcover library: when exactly one book there has the same title (its own, an
edition's or the original, brackets left out, or what comes before a colon, with the same
numbers in it) and a writer of the
same surname, it is adopted. That match is never made against Hardcover's whole catalogue and
never adds a book: a book neither finds is left out and counted.

What a book is on Hardcover is remembered in HardcoverLink, with a hash of what was last sent, so
an unchanged book costs no request. An unmatched book is asked again when its editions change,
or after a week.

The schema (status ids, DatesReadInput, the *_user_book mutations) was read from Hardcover's
GraphQL introspection on 2026-11-27.
"""
import hashlib
import json
import re
import time
from datetime import timedelta

from django.utils import timezone

from . import hardcover
from .models import Book, HardcoverLink
from .boeken import AUTHOR_ROLES, fold
from .works import by_date, edition_of, main_edition, same_title

# Folio's reading status → Hardcover's user_book_statuses (1 Want to Read, 2 Currently Reading,
# 3 Read, 4 Paused, 5 Did Not Finish, 6 Ignored).
STATUS_ID = {'to-read': 1, 'reading': 2, 'read': 3, 'abandoned': 5}
# Which wins when a book is on more than one status list (it shouldn't be).
STATUS_ORDER = ('reading', 'read', 'abandoned', 'to-read')
DAY = re.compile(r'^\d{4}-\d{2}-\d{2}$')
RETRY_UNMATCHED = timedelta(days=7)
BATCH = 100


class OutOfBudget(Exception):
    """The run has used the requests it may use."""


class Failed(Exception):
    """Hardcover said no to one write."""


# ---------------------------------------------------------------- what Folio wants Hardcover to show

def isbn13(value):
    """An ISBN as 13 digits ('' when it isn't one)."""
    digits = re.sub(r'[^0-9Xx]', '', str(value or '')).upper()
    if len(digits) == 13 and digits.isdigit() and digits[:3] in ('978', '979'):
        return digits
    if len(digits) == 10 and digits[:9].isdigit():
        core = '978' + digits[:9]
        total = sum(int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(core))
        return core + str((10 - total % 10) % 10)
    return ''


def isbn10(value):
    """A 978 ISBN-13 as ISBN-10 ('' for 979 and the rest)."""
    if not re.fullmatch(r'978\d{10}', value or ''):
        return ''
    core = value[3:12]
    check = (11 - sum(int(d) * (10 - i) for i, d in enumerate(core)) % 11) % 11
    return core + ('X' if check == 10 else str(check))


def keys_of(edition):
    """The numbers an edition can be found by on Hardcover: [('isbn13', …), ('asin', …)]."""
    out = []
    if (i := isbn13(edition.get('isbn'))):
        out.append(('isbn13', i))
    if (a := str(edition.get('asin') or '').strip().upper()):
        out.append(('asin', a))
    return out


def status_of(data):
    lists = data.get('lists') or {}
    return next((s for s in STATUS_ORDER if isinstance(lists, dict) and s in lists), None)


def editions_in_order(data):
    """The edition of the latest dated read, the main edition, then the others."""
    reads = [r for r in by_date(data.get('reviews')) if not r.get('dnf')]
    first = [edition_of(data, r.get('ed')) for r in reversed(reads)] + [main_edition(data)]
    out, seen = [], set()
    for e in first + list(data.get('editions') or []):
        if isinstance(e, dict) and e.get('id') not in seen:
            seen.add(e.get('id'))
            out.append(e)
    return out


def unbracketed(title):
    return re.sub(r'\s*[(\[][^)\]]*[)\]]', '', str(title or ''))


def numbers(title):
    return sorted(int(n) for n in re.findall(r'\d+', unbracketed(title)))


def alike(titles, theirs):
    """One of `titles` is `theirs`: the same, or one is the other up to its colon (Mother Night is
    Mother Night: A Novel, but The Mongoliad: Book One is not The Mongoliad: Book Three), brackets
    left out, with the same numbers in it (Vol. 3: Century 1969 is not Vol. 3: Century 1910)."""
    return any(same_title(unbracketed(t), unbracketed(theirs)) and numbers(t) == numbers(theirs) for t in titles)


def surnames(names):
    return {fold(n).split()[-1] for n in names if fold(n)}


def writers_of(data):
    """The writers' names: the people of every edition with a writer's role (or none)."""
    names = [p.get('name') for e in data.get('editions') or [] if isinstance(e, dict) for p in e.get('people') or []
             if isinstance(p, dict) and str(p.get('role') or '').strip().lower() in AUTHOR_ROLES | {''}]
    if data.get('author'):
        names.append(data['author'])
    return [n for n in names if n]


def stars(rating):
    """Folio's 1–10 → Hardcover's 0.5–5 (None for no rating)."""
    try:
        r = float(rating)
    except (TypeError, ValueError):
        return None
    if r <= 0:
        return None
    return min(5.0, max(0.5, round(r) / 2))


def wanted(data):
    """What Hardcover should show for this book, or None when it has no reading status.
    → {status, rating, added, reads: [{date, ed}], partial, editions: [{id, keys}]}"""
    status = status_of(data)
    if not status:
        return None
    reads = [r for r in by_date(data.get('reviews')) if not r.get('dnf')]
    rated = [r for r in reads if stars(r.get('rating')) is not None]
    rating = stars(rated[-1]['rating']) if rated else stars(data.get('rating'))
    full = [r for r in reads if DAY.match(str(r['date'])[:10])]
    return {
        'status': STATUS_ID[status],
        'rating': rating,
        'added': str(data.get('added') or '')[:10] or None,
        'reads': [{'date': str(r['date'])[:10], 'ed': r.get('ed')} for r in full],
        'partial': len(reads) - len(full),
        'editions': [{'id': e.get('id'), 'keys': keys_of(e)} for e in editions_in_order(data)],
        'titles': sorted({str(t) for t in [data.get('title'), data.get('originalTitle')]
                          + [e.get('title') for e in data.get('editions') or [] if isinstance(e, dict)] if t}),
        'writers': sorted(surnames(writers_of(data))),
    }


def digest(want):
    return hashlib.sha256(json.dumps([2, want], sort_keys=True).encode()).hexdigest()[:32]   # 2: reads near a date (2.48.0)


# ---------------------------------------------------------------- what to change on Hardcover

def place(want, found):
    """The Hardcover book this is, and which Hardcover edition each Folio edition is.
    `found` maps a key ('isbn13', …) to {edition_id, book_id}. → (book_id, {folio ed id: edition_id})"""
    book_id = None
    for e in want['editions']:
        hit = next((found[k] for k in e['keys'] if k in found), None)
        if hit:
            book_id = hit['book_id']
            break
    eds = {}
    if book_id:
        for e in want['editions']:
            hit = next((found[k] for k in e['keys'] if k in found and found[k]['book_id'] == book_id), None)
            if hit:
                eds[e['id']] = hit['edition_id']
    return book_id, eds


def by_title(want, entries, taken):
    """The one entry of the user's library with one of the book's titles and a writer of the same
    surname, among the books not `taken`; None when there is none, or more than one."""
    titles, writers = want.get('titles') or [], set(want.get('writers') or ())
    if not titles or not writers:
        return None
    hits = {e['book_id']: e for e in entries if e['book_id'] not in taken
            and alike(titles, (e.get('book') or {}).get('title'))
            and surnames([((c or {}).get('author') or {}).get('name') for c in (e.get('book') or {}).get('cached_contributors') or []
                          if (c or {}).get('contribution') in (None, '', 'Author')]) & writers}
    return next(iter(hits.values())) if len(hits) == 1 else None


def entry_changes(want, eds, entry):
    """The fields of the user book to set: all of them for a new one (`entry` None), else only
    those that differ. A rating Folio doesn't have is left as it is."""
    edition_id = next((eds[e['id']] for e in want['editions'] if e['id'] in eds), None)
    if entry is None:
        obj = {'status_id': want['status']}
        if edition_id:
            obj['edition_id'] = edition_id
        if want['rating'] is not None:
            obj['rating'] = want['rating']
        if want['added']:
            obj['date_added'] = want['added']
        return obj
    obj = {}
    if entry.get('status_id') != want['status']:
        obj['status_id'] = want['status']
    if want['rating'] is not None and (entry.get('rating') is None or float(entry['rating']) != want['rating']):
        obj['rating'] = want['rating']
    if edition_id and entry.get('edition_id') != edition_id:
        obj['edition_id'] = edition_id
    return obj


def days_apart(a, b):
    from datetime import date
    return abs((date.fromisoformat(str(a)[:10]) - date.fromisoformat(str(b)[:10])).days)


def read_changes(want, eds, reads, ours, fresh=()):
    """The reads to add, fill or remove, against the reads the entry has now (`reads`), the ids of
    those the sync made (`ours`) and those Hardcover made just now because of the sync's own write
    (`fresh`: marked Read, it adds a read finished today).

    Each of Folio's dates takes one read: one of that day, else one within a month (the same read,
    dated a little differently by Goodreads), the user's own before the sync's. A read with no
    date, or a fresh one, is filled before a new one is added. What the sync made and no date
    took is removed; nothing else ever is, and only the sync's own reads are changed.
    → [('add', read) | ('set', id, read) | ('drop', id)]"""
    ours, fresh = set(ours) | set(fresh), set(fresh)
    ops, used = [], set()
    dated = [r for r in reads if r.get('finished_at') and r['id'] not in fresh]
    # Fillable: a read with no dates at all, or one Hardcover just finished today on its own (a
    # read it just started, for Currently Reading, is the reading now and stays as it is).
    blank = [r for r in reads if (r['id'] in fresh and r.get('finished_at')) or (not r.get('finished_at') and not r.get('started_at'))]
    days = []
    for w in want['reads']:
        if w['date'] not in days:
            days.append(w['date'])
    wanted_ed = {w['date']: eds.get(w['ed']) for w in want['reads']}
    # The user's own reads first, then the sync's; exact days before near ones, so a near match
    # never takes a read another date has exactly.
    took = {}
    for mine, near in ((False, False), (False, True), (True, False), (True, True)):
        for day in days:
            if day in took:
                continue
            fits = [r for r in dated if r['id'] not in used and (r['id'] in ours) == mine
                    and (str(r['finished_at'])[:10] == day if not near else days_apart(r['finished_at'], day) <= 31)]
            if fits:
                hit = min(fits, key=lambda r: days_apart(r['finished_at'], day))
                used.add(hit['id'])
                took[day] = hit
    for day in days:
        read = {'finished_at': day}
        if wanted_ed.get(day):
            read['edition_id'] = wanted_ed[day]
        hit = took.get(day)
        if hit:
            if hit['id'] in ours and (str(hit['finished_at'])[:10] != day
                                      or (read.get('edition_id') and hit.get('edition_id') != read['edition_id'])):
                ops.append(('set', hit['id'], read))
        elif blank:
            b = blank.pop(0)
            used.add(b['id'])
            ops.append(('set', b['id'], read))
        else:
            ops.append(('add', read))
    for r in reads:
        if r['id'] in ours and r['id'] not in used and r.get('finished_at'):
            ops.append(('drop', r['id']))
    return ops


# ---------------------------------------------------------------- talking to Hardcover

EDITIONS = """query($i13: [String!], $i10: [String!], $asin: [String!]) {
  a: editions(where: {isbn_13: {_in: $i13}}) { id book_id isbn_13 isbn_10 asin users_count }
  b: editions(where: {isbn_10: {_in: $i10}}) { id book_id isbn_13 isbn_10 asin users_count }
  c: editions(where: {asin: {_in: $asin}}) { id book_id isbn_13 isbn_10 asin users_count }
}"""
ME = '{ me { id } }'
LIBRARY = """query($uid: Int!, $off: Int!) {
  user_books(where: {user_id: {_eq: $uid}}, order_by: {id: asc}, limit: 500, offset: $off) {
    id book_id edition_id status_id rating user_book_reads { id started_at finished_at edition_id }
    book { title cached_contributors }
  }
}"""
READS = 'query($id: Int!) { user_books_by_pk(id: $id) { id user_book_reads { id started_at finished_at edition_id } } }'
INSERT = 'mutation($o: UserBookCreateInput!) { insert_user_book(object: $o) { id error } }'
UPDATE = 'mutation($id: Int!, $o: UserBookUpdateInput!) { update_user_book(id: $id, object: $o) { id error } }'
DELETE = 'mutation($id: Int!) { delete_user_book(id: $id) { id } }'
READ_ADD = 'mutation($id: Int!, $r: DatesReadInput!) { insert_user_book_read(user_book_id: $id, user_book_read: $r) { id error } }'
READ_SET = 'mutation($id: Int!, $r: DatesReadInput!) { update_user_book_read(id: $id, object: $r) { id error } }'
READ_DROP = 'mutation($id: Int!) { delete_user_book_read(id: $id) { id } }'


class Client:
    """hardcover.ask with a budget, at no more than 50 requests a minute (the free plan allows 60).
    A query's cost is its number of top-level fields, as Hardcover counts them."""

    def __init__(self, ask=None, budget=2000, pause=1.2, sleep=time.sleep):
        self.ask = ask or hardcover.ask
        self.budget, self.pause, self.sleep = budget, pause, sleep
        self.used = 0

    def __call__(self, query, variables=None, cost=1):
        if self.used + cost > self.budget:
            raise OutOfBudget()
        if self.used:
            self.sleep(self.pause * cost)
        self.used += cost
        return self.ask(query, variables)


def lookup(client, keys):
    """{key: {edition_id, book_id}} for the keys Hardcover knows; where several editions share a
    number, the one most people have shelved."""
    keys = sorted(set(keys))
    found = {}
    for start in range(0, len(keys), BATCH):
        part = keys[start:start + BATCH]
        i13 = [v for kind, v in part if kind == 'isbn13']
        asin = [v for kind, v in part if kind == 'asin']
        i10 = [x for x in (isbn10(v) for v in i13) if x]
        data = client(EDITIONS, {'i13': i13, 'i10': i10, 'asin': asin}, cost=3)
        best = {}
        for e in (data.get('a') or []) + (data.get('b') or []) + (data.get('c') or []):
            names = []
            if e.get('isbn_13') in i13:
                names.append(('isbn13', e['isbn_13']))
            if e.get('isbn_10') and isbn13(e['isbn_10']) in i13:
                names.append(('isbn13', isbn13(e['isbn_10'])))
            if e.get('asin') and e['asin'].upper() in asin:
                names.append(('asin', e['asin'].upper()))
            for k in names:
                if k not in best or (e.get('users_count') or 0) > (best[k].get('users_count') or 0):
                    best[k] = e
        for k, e in best.items():
            found[k] = {'edition_id': e['id'], 'book_id': e['book_id']}
    return found


def library(client):
    """The user's own Hardcover library: [user_book with its reads]."""
    uid = client(ME)['me'][0]['id']
    rows, off = [], 0
    while True:
        page = client(LIBRARY, {'uid': uid, 'off': off})['user_books']
        rows += page
        if len(page) < 500:
            return rows
        off += 500


def checked(result, field):
    out = result.get(field) or {}
    if out.get('error') or not out.get('id'):
        raise Failed(out.get('error') or f'{field} gave no id')
    return out['id']


# ---------------------------------------------------------------- one run

def run(user, client, *, dry_run=False, limit=None, now=None, say=lambda line: None):
    """Bring the user's Hardcover library in line with the shelf. → counts"""
    now = now or timezone.now()
    counts = {'unchanged': 0, 'added': 0, 'updated': 0, 'adopted': 0, 'by title': 0, 'in step': 0, 'unmatched': 0,
              'shared': 0, 'removed': 0, 'let go': 0, 'failed': 0, 'partial dates': 0, 'left for later': 0}
    fields = {}
    links = {link.uid: link for link in HardcoverLink.objects.filter(user=user)}
    todo, keep = [], set()
    for book in Book.shelf(user).only('uid', 'title', 'data'):
        want = wanted(book.data)
        if not want:
            continue
        keep.add(book.uid)
        counts['partial dates'] += want['partial']
        h = digest(want)
        link = links.get(book.uid)
        if link and link.sent == h and not link.error:
            if link.user_book_id:
                counts['unchanged'] += 1
                continue
            if now - link.checked < RETRY_UNMATCHED:
                counts['unmatched'] += 1
                continue
        todo.append((book, want, h, link))
    gone = [link for uid, link in links.items() if uid not in keep]
    if not todo and not gone:
        return counts, fields

    try:
        found = lookup(client, [k for _, want, _, _ in todo for e in want['editions'] for k in e['keys']])
        entries = library(client)
    except OutOfBudget:
        say('Out of requests before anything could be compared.')
        counts['left for later'] = len(todo)
        return counts, fields
    by_id = {e['id']: e for e in entries}
    by_book = {}
    for e in entries:
        by_book.setdefault(e['book_id'], e)
    claimed = {link.book_id: link.uid for link in links.values() if link.book_id and link.uid in keep}

    for link in gone:
        if link.created and link.user_book_id in by_id:
            say(f'remove  {link.uid} (user book {link.user_book_id})')
            if not dry_run:
                try:
                    client(DELETE, {'id': link.user_book_id})
                except OutOfBudget:
                    break
            counts['removed'] += 1
        else:
            counts['let go'] += 1
        if not dry_run:
            link.delete()

    # A book a number finds keeps it from a title match of another book.
    numbered = {place(want, found)[0] for _, want, _, _ in todo} - {None}
    written = 0
    for n, (book, want, h, link) in enumerate(todo):
        if limit is not None and written >= limit:
            counts['left for later'] += len(todo) - n
            break
        entry = by_id.get(link.user_book_id) if link and link.user_book_id else None
        book_id, eds = place(want, found)
        if entry:
            book_id = entry['book_id']
            eds = place(want, {k: v for k, v in found.items() if v['book_id'] == book_id})[1]
        titled = None
        if not book_id:
            titled = by_title(want, entries, numbered | set(claimed))
            if titled:
                book_id = titled['book_id']
                counts['by title'] += 1
                say(f'by title  {book.title} → {(titled.get("book") or {}).get("title")}')
        if not book_id:
            counts['unmatched'] += 1
            say(f'no match  {book.title} ({", ".join(v for e in want["editions"] for _, v in e["keys"]) or "no ISBN or ASIN"})')
            if not dry_run:
                HardcoverLink.objects.update_or_create(user=user, uid=book.uid, defaults={
                    'user_book_id': None, 'book_id': None, 'created': False, 'reads': [], 'sent': h, 'error': ''})
            continue
        if claimed.get(book_id, book.uid) != book.uid:
            counts['shared'] += 1
            say(f'shared  {book.title}: Hardcover book {book_id} is already {claimed[book_id]}')
            continue
        claimed[book_id] = book.uid
        created = bool(link and link.created and entry)
        ours = list(link.reads) if link and entry else []
        if entry is None:
            entry = by_book.get(book_id)
            if entry:
                counts['adopted'] += 1
        obj = entry_changes(want, eds, entry)
        reads_now = (entry or {}).get('user_book_reads') or []
        ops = read_changes(want, eds, reads_now, ours if entry else [])
        for key in (obj if entry else ()):
            fields[key] = fields.get(key, 0) + 1
        if entry and not obj and not ops:
            counts['in step'] += 1
            if not dry_run:
                HardcoverLink.objects.update_or_create(user=user, uid=book.uid, defaults={
                    'user_book_id': entry['id'], 'book_id': book_id, 'created': created, 'reads': ours, 'sent': h, 'error': ''})
            continue
        written += 1
        verb = 'add' if entry is None else 'update'
        say(f'{verb}  {book.title}: {json.dumps(obj, ensure_ascii=False)}'
            + (f', reads {", ".join(o[0] + " " + str(o[-1].get("finished_at", o[-1])) if isinstance(o[-1], dict) else o[0] for o in ops)}' if ops else ''))
        if dry_run:
            counts['added' if entry is None else 'updated'] += 1
            continue
        ub = entry['id'] if entry else None
        try:
            if entry is None:
                ub = checked(client(INSERT, {'o': {'book_id': book_id, **obj}}), 'insert_user_book')
                created = True
                reads_now = (client(READS, {'id': ub})['user_books_by_pk'] or {}).get('user_book_reads') or []
                ops = read_changes(want, eds, reads_now, [], fresh=[r['id'] for r in reads_now])
            elif obj:
                checked(client(UPDATE, {'id': ub, 'o': obj}), 'update_user_book')
                if 'status_id' in obj:   # Hardcover may add a read of its own for the new status
                    before = {r['id'] for r in reads_now}
                    reads_now = (client(READS, {'id': ub})['user_books_by_pk'] or {}).get('user_book_reads') or []
                    ops = read_changes(want, eds, reads_now, ours, fresh=[r['id'] for r in reads_now if r['id'] not in before])
            for op in ops:
                if op[0] == 'add':
                    ours.append(checked(client(READ_ADD, {'id': ub, 'r': op[1]}), 'insert_user_book_read'))
                elif op[0] == 'set':
                    checked(client(READ_SET, {'id': op[1], 'r': op[2]}), 'update_user_book_read')
                    if op[1] not in ours:
                        ours.append(op[1])
                else:
                    client(READ_DROP, {'id': op[1]})
                    ours = [i for i in ours if i != op[1]]
            HardcoverLink.objects.update_or_create(user=user, uid=book.uid, defaults={
                'user_book_id': ub, 'book_id': book_id, 'created': created, 'reads': ours, 'sent': h, 'error': ''})
            counts['added' if entry is None else 'updated'] += 1
        except OutOfBudget:
            counts['left for later'] += len(todo) - n
            say('Out of requests for this run; the rest waits for the next.')
            break
        except (Failed, hardcover.Unavailable) as err:
            counts['failed'] += 1
            say(f'failed  {book.title}: {err}')
            HardcoverLink.objects.update_or_create(user=user, uid=book.uid, defaults={
                'user_book_id': ub, 'book_id': book_id if ub else None, 'created': created, 'reads': ours, 'sent': '',
                'error': str(err)[:500]})
    return counts, fields
