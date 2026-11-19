"""Books and their editions (docs/work-edition-plan.md), as the server sees them.

A book on the shelf is one record: the work, with the editions of it you have or read inside
(`editions`). Reading status is the book's, every other list belongs to an edition, and each
read points at the edition it was of (`ed`). The app does the same in works.js; both are tested
against tests/fixtures/works/ at the top of the repository.

Publishing and importing were written against the old shape: one edition's facts at the top
level and each review carrying its edition. `flat` gives them that view of a new record.
"""
import copy
import json
import re

from .boeken import fold, tidy_people

# What moved from a book into its editions (v: 2).
MOVED = ('format', 'language', 'publisher', 'date', 'pages', 'duration', 'isbn', 'asin',
         'cover', 'coverRatio', 'coverSource', 'coverFull', 'thumb', 'coverPhoto', 'coverOriginal', 'coverCrop', 'people')
STATUS = ('to-read', 'reading', 'read', 'abandoned')
OPEN = ('to-read', 'reading')
COVER = ('cover', 'coverRatio', 'coverSource', 'coverFull', 'thumb', 'coverPhoto', 'coverOriginal', 'coverCrop')
# The facts of an edition that publishing tracks (boekenState), by how far a state goes.
TRACKED = {
    1: ('publisher', 'date', 'pages', 'isbn', 'cover', 'people'),
    2: ('publisher', 'date', 'pages', 'isbn', 'cover', 'people', 'format', 'duration'),
    3: ('publisher', 'date', 'pages', 'isbn', 'cover', 'people', 'format', 'duration', 'language'),
}


def empty(value):
    return value is None or value == '' or (isinstance(value, list) and not value)


def facts_of(x):
    """The moved fields of `x` that say something, copied."""
    if not isinstance(x, dict):
        return {}
    return {key: copy.deepcopy(x[key]) for key in MOVED if key in x and not empty(x[key])}


def identity(e):
    """What makes two editions one: the same facts, and the same cover picture."""
    v = lambda key: '' if empty(e.get(key)) else e[key]
    people = tidy_people(e.get('people'))
    return json.dumps([v('format'), v('isbn'), v('asin'), v('publisher'), v('date'), v('pages'), v('duration'), v('language'),
                       people or '', v('coverSource') or v('cover') or v('thumb')], ensure_ascii=False)


def status_set(status=None):
    return set(STATUS) | set(status or ())


def is_open(lists):
    return isinstance(lists, dict) and any(lists.get(key) for key in OPEN)


def by_date(reviews):
    """The dated reads, oldest first (in stored order where the day is the same)."""
    dated = [(r, i) for i, r in enumerate(reviews or []) if isinstance(r, dict) and r.get('date')]
    return [r for r, i in sorted(dated, key=lambda ri: (ri[0]['date'], ri[1]))]


def edition_of(data, ed_id):
    return next((e for e in data.get('editions') or [] if isinstance(e, dict) and e.get('id') == ed_id), None)


def latest_read(data, finished=False):
    for review in reversed([r for r in by_date(data.get('reviews')) if not (finished and r.get('dnf'))]):
        edition = edition_of(data, review.get('ed'))
        if edition:
            return edition
    return None


def main_edition(data):
    """`main` when it names an edition, else the edition of the latest dated read, else the first
    under the book's own title (not a translation), else the first."""
    editions = [e for e in data.get('editions') or [] if isinstance(e, dict)]
    own = next((e for e in editions if not e.get('title')), None)
    return edition_of(data, data.get('main')) or latest_read(data) or own or (editions[0] if editions else None)


def next_edition_id(data):
    used = {e.get('id') for e in data.get('editions') or []}
    n = len(data.get('editions') or []) + 1
    while f'e{n}' in used:
        n += 1
    return f'e{n}'


def settle(data, status=None):
    """The invariants of a stored book (plan 4.2), enforced in place. → the book"""
    statuses = status_set(status)
    editions = [e for e in data.get('editions') or [] if isinstance(e, dict)] if isinstance(data.get('editions'), list) else []
    if not editions:
        new = upgrade({k: v for k, v in data.items() if k != 'editions'}, status)
        data.clear()
        data.update(new)
        return data
    data['editions'] = editions
    seen, every, n = set(), {e.get('id') for e in editions}, 1
    for e in editions:
        if not e.get('id') or e['id'] in seen:
            while f'e{n}' in every:
                n += 1
            e['id'] = f'e{n}'
            every.add(e['id'])
        seen.add(e['id'])
    if data.get('main') and not edition_of(data, data['main']):
        data.pop('main')
    main = main_edition(data)
    for key in MOVED:
        if key in data:
            value = data.pop(key)
            if empty(value):
                main.pop(key, None)
            else:
                main[key] = value
    own = data.get('lists') if isinstance(data.get('lists'), dict) else {}
    data['lists'] = {}
    for key, entry in own.items():
        if key in statuses:
            data['lists'][key] = entry
        else:
            main.setdefault('lists', {}).setdefault(key, entry)
    for e in editions:
        if not isinstance(e.get('lists'), dict):
            e.pop('lists', None)
            continue
        for key in [k for k in e['lists'] if k in statuses]:
            entry = e['lists'].pop(key)
            if key not in data['lists'] or ((entry or {}).get('at') and entry['at'] < (data['lists'][key] or {}).get('at', '')):
                data['lists'][key] = entry
        if not e['lists']:
            e.pop('lists')
    fallback = main_edition(data)['id']
    if isinstance(data.get('reviews'), list):
        for review in data['reviews']:
            if not isinstance(review, dict):
                continue
            review.pop('edition', None)
            if not edition_of(data, review.get('ed')):
                review['ed'] = fallback
    if not is_open(data['lists']):
        data.pop('main', None)
    data['v'] = 2
    return data


def upgrade(book, status=None):
    """An old record as a new one (plan 6.4); the same algorithm as works.js. Returns a new dict.
    `versionOf` is left alone: to_works merges those books."""
    if isinstance(book.get('editions'), list) and book['editions']:
        return settle(copy.deepcopy(book), status)
    statuses = status_set(status)
    own = facts_of(book)
    work = {key: copy.deepcopy(value) for key, value in book.items() if key not in MOVED and key != 'editions'}
    editions, made = [], {}

    def make(facts):
        edition = {'id': f'e{len(editions) + 1}', **facts}
        editions.append(edition)
        return edition

    # 2. Each read's edition, once per edition.
    reviews = None
    if isinstance(book.get('reviews'), list):
        reviews = []
        for review in book['reviews']:
            if not isinstance(review, dict):
                reviews.append(copy.deepcopy(review))
                continue
            rest = {k: copy.deepcopy(v) for k, v in review.items() if k != 'edition'}
            facts = facts_of(review.get('edition'))
            if facts:
                key = identity(facts)
                edition = made.get(key)
                if edition is None:
                    edition = made[key] = make(facts)
                else:
                    for k, v in facts.items():
                        edition.setdefault(k, v)
                rest['ed'] = edition['id']
            reviews.append(rest)
        work['reviews'] = reviews

    # 3. The book's own facts.
    reads = by_date(reviews)
    if not editions:
        home = make(own)
    elif book.get('boekenState'):
        if is_open(book.get('lists')) and reads:
            # Another read planned or running: the facts are those of that read's edition.
            home = made.get(identity(own))
            if home is not None:
                for k, v in own.items():
                    home.setdefault(k, v)
            else:
                home = make(own)
        else:
            # The facts came from the booklog, which has them per read; only what was changed in
            # the app and not published yet (what differs from boekenState) is the app's own.
            home = next((e for e in editions if reads and e['id'] == reads[-1].get('ed')), editions[0])
            state = book['boekenState'] if isinstance(book['boekenState'], dict) else {}
            for key in TRACKED.get(state.get('tracks'), TRACKED[1]):
                now = tidy_people(own.get('people')) if key == 'people' else own.get(key)
                was = state.get(key)
                if (None if empty(now) else now) == (None if empty(was) else was):
                    continue
                for k in (COVER if key == 'cover' else (key,)):
                    if k in own:
                        home[k] = copy.deepcopy(own[k])
                    else:
                        home.pop(k, None)
            for k in ('thumb', 'coverFull', 'coverRatio'):
                if k not in home and k in own:
                    home[k] = own[k]
    else:
        # Only in the app: its facts are the truth. A read's edition of the same format and ISBN
        # is a stale copy of them.
        home = next((e for e in editions if (e.get('format') or '') == (own.get('format') or '')
                     and (e.get('isbn') or '') == (own.get('isbn') or '')), None)
        if home is not None:
            for k in MOVED:
                home.pop(k, None)
            home.update(own)
        else:
            home = make(own)

    # 4. A read that doesn't say which edition was of the book's own.
    for review in reviews or []:
        if isinstance(review, dict) and not review.get('ed'):
            review['ed'] = home['id']

    # 5. Reading status is the book's; every other list is of the copy the book stood for.
    lists = book['lists'] if isinstance(book.get('lists'), dict) else {'library': {'at': book.get('added')}}
    work['lists'] = {}
    for key, entry in lists.items():
        if key in statuses:
            work['lists'][key] = copy.deepcopy(entry)
        else:
            home.setdefault('lists', {})[key] = copy.deepcopy(entry)
    if book.get('added'):
        for edition in editions:
            edition['added'] = book['added']
    work['editions'] = editions
    # 6. `main` while a read of it is planned or running.
    if is_open(work['lists']):
        work['main'] = home['id']
    else:
        work.pop('main', None)
    work['v'] = 2
    return settle(work, status)


def titled(edition):
    """An edition's facts as a read of it is published: with its own title, when it has one (a translation)."""
    facts = facts_of(edition)
    if isinstance(edition, dict) and not empty(edition.get('title')):
        facts['title'] = edition['title']
    return facts


def flat(data):
    """A new record in the old shape, for publishing: the main edition's facts at the top level,
    `lists` as the union of the book's and its editions', each review with the edition it was
    of (`edition`, next to `ed`). A record without editions is returned as it is. The book's
    `title` stays the book's; the main edition's own title, if it has one, is `editionTitle`."""
    if not isinstance(data.get('editions'), list) or not data['editions']:
        return data
    out = {k: v for k, v in data.items() if k not in ('editions', 'main', 'v')}
    main = main_edition(data) or {}
    out.update(facts_of(main))
    if not empty(main.get('title')):
        out['editionTitle'] = main['title']
    lists = dict(data.get('lists') or {})
    for edition in data['editions']:
        for key, entry in (edition.get('lists') or {}).items():
            if key not in lists or ((entry or {}).get('at') or '') < ((lists[key] or {}).get('at') or ''):
                lists[key] = entry
    out['lists'] = lists
    if isinstance(data.get('reviews'), list):
        out['reviews'] = [{**r, 'edition': titled(edition_of(data, r.get('ed')))} if isinstance(r, dict) else r
                          for r in data['reviews']]
    return out


def status_lists(user):
    """The ids of a user's reading-status lists: the app's, and any of the user's own in that set."""
    from .models import List
    return status_set(l.uid for l in List.objects.filter(user=user, deleted=False) if (l.data or {}).get('group') == 'Reading status')


PROGRESS = ('pagesRead', 'durationLeft', 'percentRead', 'progressUnit')


def main_title(title):
    """A title as it is compared: folded, without what follows a colon or a dash (as works.js)."""
    return fold(re.split(r'\s*[:—–]\s*|\s+-\s+', str(title or ''))[0])


def same_title(a, b):
    fa, fb = fold(a or ''), fold(b or '')
    if not fa or not fb:
        return False
    return fa == fb or main_title(a) == fb or fa == main_title(b)


def tidy_titles(work):
    """An edition's own title is dropped where it is the book's."""
    for edition in work.get('editions') or []:
        if edition.get('title') and fold(edition['title']) == fold(work.get('title') or ''):
            del edition['title']


def combine(survivor, absorbed, title='mine'):
    """`absorbed`'s editions and reads in `survivor` (in place; → survivor), as works.js does it:
    with different titles (a translation) each edition keeps its book's title, and the combined
    book goes by the survivor's title, or with title='theirs' by the absorbed book's."""
    ids = {}
    differ = bool(absorbed.get('title')) and not same_title(survivor.get('title'), absorbed.get('title'))
    if differ and title == 'theirs':
        for edition in survivor['editions']:
            edition.setdefault('title', survivor.get('title'))
        survivor['title'] = absorbed['title']
        for key in ('series', 'seriesNumber', 'seriesLabel', 'olid'):
            if not empty(absorbed.get(key)):
                survivor[key] = copy.deepcopy(absorbed[key])
    for edition in absorbed.get('editions') or []:
        new = copy.deepcopy(edition)
        if edition_of(survivor, edition['id']) or edition['id'] in ids.values():
            new['id'] = next_edition_id(survivor)
        if differ and not new.get('title'):
            new['title'] = absorbed['title']
        ids[edition['id']] = new['id']
        survivor['editions'].append(new)
    tidy_titles(survivor)
    for review in absorbed.get('reviews') or []:
        if isinstance(review, dict):
            survivor.setdefault('reviews', []).append({**copy.deepcopy(review), 'ed': ids.get(review.get('ed')) or main_edition(survivor)['id']})
    theirs = absorbed.get('lists') if isinstance(absorbed.get('lists'), dict) else {}
    mine = survivor.get('lists') if isinstance(survivor.get('lists'), dict) else {}
    if (is_open(theirs) and not is_open(mine)) or (not mine and theirs):
        survivor['lists'] = copy.deepcopy(theirs)
        main = main_edition(absorbed)
        if is_open(theirs) and main:
            survivor['main'] = ids[main['id']]
        for key in PROGRESS:
            if key in absorbed:
                survivor[key] = copy.deepcopy(absorbed[key])
            else:
                survivor.pop(key, None)
    for key in ('olid', 'series', 'seriesNumber', 'seriesLabel', 'issues', 'originalLanguage', 'originalTitle'):
        if empty(survivor.get(key)) and not empty(absorbed.get(key)):
            survivor[key] = copy.deepcopy(absorbed[key])
    for key in ('categories', 'tags'):
        every = [*(survivor.get(key) or []), *(absorbed.get(key) or [])]
        if every:
            seen = set()
            survivor[key] = [v for v in every if not (fold(v) in seen or seen.add(fold(v)))]
    if absorbed.get('dropReads'):
        survivor['dropReads'] = list(dict.fromkeys([*(survivor.get('dropReads') or []), *absorbed['dropReads']]))
    # What either was said not to be (works.js setApart), the combined book is not either.
    apart = [i for i in dict.fromkeys([*(survivor.get('apart') or []), *(absorbed.get('apart') or [])])
             if i not in (survivor.get('id'), absorbed.get('id'))]
    if apart:
        survivor['apart'] = apart
    else:
        survivor.pop('apart', None)
    return survivor
