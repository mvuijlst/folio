"""What a public library shows of a shelf (docs/public-library-plan.md, 3.1 and 3.3).

The rule: what a private list says stays private. A visitor sees a book when it, or one of its
editions, is on a public list, and of it only what public lists say. Reviews, ratings and read
dates are what the reading lists say, so they go along only when the list the book is on there
is public; progress only when that list is Reading.

This module is the security boundary, so it is an allow-list: every field that may leave is
named here, and a field nobody named stays home. A field added to books next year is private
until someone decides otherwise. Notes on a list (“lent to Jan”), the booklog's bookkeeping and
anything the server adds never leave.
"""
import re

from .works import PROGRESS

# A book's own facts.
BOOK_FIELDS = ('id', 'v', 'title', 'author', 'series', 'seriesNumber', 'seriesLabel', 'originalTitle',
               'originalLanguage', 'categories', 'tags', 'olid', 'added')
# What the reading lists say: only when the reading list the book is on is public.
REVIEW_FIELDS = ('id', 'date', 'rating', 'text', 'dnf', 'ed')
# An edition's facts. Covers are public files already; a photographed one is public with the rest.
EDITION_FIELDS = ('id', 'title', 'format', 'language', 'publisher', 'date', 'pages', 'duration', 'isbn', 'asin',
                  'people', 'cover', 'coverRatio', 'coverFull', 'thumb', 'added')
PERSON_FIELDS = ('name', 'role')
# What a book's place on a list says: when it went there. Never the note.
ENTRY_FIELDS = ('at', 'again')
LIST_FIELDS = ('id', 'name', 'group', 'order')
TERM_FIELDS = ('id', 'kind', 'value', 'nl', 'en', 'aliases', 'gone')
VOCABULARY = ('role', 'category', 'tag')   # words that say nothing of a list; list words only for public lists

READING = 'reading'

SLUG = re.compile(r'^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$')
RESERVED = {'admin', 'api', 'u', 'static', 'django-static', 'covers', 'fonts', 'icons', 'vendor', 'folio',
            'settings', 'login', 'logout', 'new', 'about', 'help', 'www', 'public', 'library'}


def slug_ok(slug):
    return isinstance(slug, str) and bool(SLUG.match(slug)) and slug not in RESERVED


def free_slug(name, taken=None):
    """A slug from `name` (a username) that no library has yet."""
    from .models import Library
    base = re.sub(r'[^a-z0-9]+', '-', str(name).lower()).strip('-')[:36] or 'library'
    if base in RESERVED or not SLUG.match(base):
        base = f'{base}-library'.strip('-')[:36]
    slug, n = base, 1
    while Library.objects.filter(slug=slug).exclude(user__username=taken).exists():
        n += 1
        slug = f'{base}-{n}'
    return slug


def pick(data, fields):
    return {key: data[key] for key in fields if isinstance(data, dict) and key in data and data[key] is not None}


def public_entries(lists, public):
    """A {listId: entry} map with only the public lists, and of each only when."""
    if not isinstance(lists, dict):
        return {}
    return {lid: pick(entry, ENTRY_FIELDS) for lid, entry in lists.items() if lid in public and isinstance(entry, dict)}


def edition(e, public):
    out = pick(e, EDITION_FIELDS)
    if isinstance(out.get('people'), list):
        out['people'] = [pick(p, PERSON_FIELDS) for p in out['people'] if isinstance(p, dict)]
    on = public_entries(e.get('lists'), public)
    if on:
        out['lists'] = on
    return out


def book(data, public):
    """A book as a visitor sees it, or None when no public list has it."""
    if not isinstance(data, dict):
        return None
    editions = [e for e in data.get('editions') or [] if isinstance(e, dict)]
    status = public_entries(data.get('lists'), public)
    on_public = bool(status) or any(public_entries(e.get('lists'), public) for e in editions)
    if not on_public:
        return None

    out = pick(data, BOOK_FIELDS)
    out['lists'] = status

    # Editions on lists, none of them public, stay home; one on no list at all says nothing private.
    shown = [e for e in editions if not e.get('lists') or public_entries(e.get('lists'), public)]
    if not shown and editions:
        # Every edition is somewhere private: the book keeps one face, without where it is.
        from .works import main_edition
        main = main_edition(data) or editions[0]
        shown = [{k: v for k, v in main.items() if k != 'lists'}]
    out['editions'] = [edition(e, public) for e in shown]
    ids = {e.get('id') for e in shown}
    if data.get('main') in ids:
        out['main'] = data['main']

    if status:
        # The reading list the book is on is public: what it says goes along.
        if data.get('rating') is not None:
            out['rating'] = data['rating']
        reviews = []
        for r in data.get('reviews') or []:
            if not isinstance(r, dict):
                continue
            review = pick(r, REVIEW_FIELDS)
            if review.get('ed') not in ids:
                review.pop('ed', None)
            reviews.append(review)
        if reviews:
            out['reviews'] = reviews
        if READING in status:
            out.update(pick(data, PROGRESS))
    return out


def library(lib):
    """The whole public library of `lib` (a Library): {"library", "lists", "books", "terms"}, or
    None when nothing of it is public."""
    from .models import Book, List, Term
    user = lib.user
    lists = [row.data for row in List.objects.filter(user=user, deleted=False) if isinstance(row.data, dict)]
    shared = sorted((l for l in lists if l.get('public') is True and l.get('id')),
                    key=lambda l: (l.get('order') if isinstance(l.get('order'), (int, float)) else 0, str(l.get('name') or '')))
    if not shared:
        return None
    public = {l['id'] for l in shared}

    books = []
    for row in Book.objects.filter(user=user, deleted=False).order_by('id'):
        shown = book({**row.data, 'id': row.uid}, public)
        if shown:
            books.append(shown)

    # The words of the public lists (their names and sets), not those of private ones or notes.
    words = {l.get('name') for l in shared} | {l.get('group') for l in shared}
    terms = []
    for row in Term.objects.filter(user=user, deleted=False):
        data = row.data if isinstance(row.data, dict) else {}
        kind = data.get('kind')
        if kind in VOCABULARY or (kind == 'list' and (data.get('value') or row.value) in words):
            terms.append({**pick(data, TERM_FIELDS), 'id': row.uid})

    return {
        'library': {
            'slug': lib.slug,
            'title': {'en': lib.title_en, 'nl': lib.title_nl},
            'about': {'en': lib.about_en, 'nl': lib.about_nl},
        },
        'lists': [pick(l, LIST_FIELDS) for l in shared],
        'books': books,
        'terms': terms,
    }


def shared(slug):
    """The Library at `slug` when it is shared, else None."""
    from .models import Library
    if not slug_ok(slug):
        return None
    return Library.objects.select_related('user').filter(slug=slug, allowed=True, enabled=True, user__is_active=True).first()

