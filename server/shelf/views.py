"""JSON API used by the Folio PWA.

  GET  /api/session  → {"user": name | null}; also sets the CSRF cookie
  POST /api/login    {"username", "password"} → {"user": name}
  POST /api/logout
  POST /api/cover    an image as the request body, or {"url"} of a catalogue cover → {"cover", "coverFull", "coverRatio"}
  POST /api/suggest  {"text", "url"} → {"books": [proposal…]}: the book(s) a description or a
                     shared page is about (by ISBN where there is one, else the assistant)
  POST /api/sync     {"schema": 3, "since": cursor | null, "changes": [change…],
                      "listsSince": cursor | null, "lists": [change…]}
                      "termsSince": cursor | null, "terms": [change…]}
                     → {"cursor", "changes": [change…], "lists": [change…], "terms": [change…]}
  POST /api/original {"title", "author", "language"} → {"language", "title"}: the language the
                     book was first written in and its title then, as far as the assistant knows
                     ({} when it doesn't); the app asks Wikidata and Open Library itself first
  POST /api/pages    {"isbn"} → {"pages": n | null}: the edition's page count as Hardcover has it
                     (shelf/pages.py), for a scan the other catalogues gave none; 503 without a token
  GET  /api/booklog-names → {"categories": {slug: title}, "tags": {slug: title}, "series": [name]}: how the
                     booklog names its pages, for the app to show (nulls when there is no booklog here)
  POST /api/tag-merges {"tags": [{"slug", "name", "books"}…]} → {"groups": [{"keep", "merge", "why"}…]}:
                     tags the assistant sees as one, for the user to take or leave
  GET  /api/library → {"allowed", "enabled", "slug", "title": {"en", "nl"}, "about": {"en", "nl"}}:
                     whether and as what this account's library is public (shelf/public.py)
  POST /api/library  {"enabled", "slug", "title", "about"} → the same, changed
  GET  /api/public/<slug> → {"library", "lists", "books", "terms"}: a public library, for anyone;
                     404 alike for a name nobody has and a library that isn't shared
  POST /api/translate {"kind": "role", "to": "en" | "nl", "words": [{"word", "books"}…]}
                     → {"words": [{"word", "translation"}…]}: the assistant's proposals, which
                     the app shows for the user to accept or not

Books travel in "changes", the user's lists in "lists" and the words they keep in two
languages (roles, terms.js) in "terms". A change is {"id", "modified", "deleted", "book"} (or
"list", "term"). The server keeps the newest change for each record (by
"modified") and answers with everything stored after the cursor that the device doesn't
already have, so every device converges on the same shelf.

A book is a work with its editions (shelf/works.py, `schema` 2). A copy of the app from before
editions would write books in the old shape over new ones, so its syncs are refused (409) with
a sentence it shows under Settings; it updates itself the next time it is opened.
"""
import base64
import json
import logging
import math
import re
import time
from datetime import timezone as dt_timezone

from django.contrib.auth import authenticate, login, logout
from django.core.cache import cache
from django.db import transaction
from django.db.models import Max
from django.http import Http404, HttpResponse, HttpResponseNotModified, JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

from django.conf import settings

from . import categorise, covers, intake, original, pages, works
from . import public
from .models import Book, Library, List, Term

logger = logging.getLogger(__name__)

MAX_BOOK_BYTES = 300_000      # a book with a cover thumbnail is ~30 kB
MAX_CHANGES = 5000
SCHEMA = 3                    # the shape of a book the app must speak (works.py); 3: books in the Trash (`trashed`)
OUT_OF_DATE = 'This version of Folio is out of date. Close and reopen it to update.'
LOGIN_LIMIT = 10              # failed attempts …
LOGIN_WINDOW = 15 * 60        # … per this many seconds, per address and per username


def error(message, status=400):
    return JsonResponse({'error': message}, status=status)


def body(request):
    try:
        data = json.loads(request.body or b'{}')
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def when(value):
    """An ISO timestamp from the client, as an aware datetime (or None)."""
    if not isinstance(value, str):
        return None
    try:
        dt = parse_datetime(value)
    except ValueError:
        return None
    if dt is None:
        return None
    return dt if timezone.is_aware(dt) else timezone.make_aware(dt, dt_timezone.utc)


def counted(key):
    """How many times key was counted in its current window, and the seconds that window has left."""
    count, until = cache.get(key) or (0, 0)
    left = until - time.time()
    return (count, left) if left > 0 else (0, 0)


def count(key, window):
    """Count key once more. Its window runs from the first count, so more counts don't extend it.

    (The cache's own incr() would: it stores the new value with the default timeout of five
    minutes, so a lockout only lifted after five quiet minutes, however long it was meant to be.)"""
    n, left = counted(key)
    if not left:
        left = window
    cache.set(key, (n + 1, time.time() + left), math.ceil(left))


def client_ip(request):
    return request.META.get('HTTP_X_REAL_IP') or request.META.get('REMOTE_ADDR', '')


# ───────────────────────── Accounts ─────────────────────────

@require_GET
@ensure_csrf_cookie
def session(request):
    user = request.user.get_username() if request.user.is_authenticated else None
    return JsonResponse({'user': user})


@require_POST
def login_view(request):
    data = body(request)
    if data is None:
        return error('Bad request')
    username = str(data.get('username', '')).strip()[:150]
    password = str(data.get('password', ''))[:1000]
    if not username or not password:
        return error('Enter your username and password.')

    keys = [f'login-failed:ip:{client_ip(request)}', f'login-failed:user:{username.lower()}']
    if any(counted(k)[0] >= LOGIN_LIMIT for k in keys):
        return error('Too many attempts. Try again in a quarter of an hour.', 429)

    user = authenticate(request, username=username, password=password)
    if user is None:
        for k in keys:
            count(k, LOGIN_WINDOW)
        return error('That username and password don’t match.', 401)

    login(request, user)
    return JsonResponse({'user': user.get_username()})


@require_POST
def logout_view(request):
    logout(request)
    return JsonResponse({'user': None})


# ───────────────────────── Covers ─────────────────────────

@require_POST
def cover(request):
    """Keep a cover the user pasted, dropped or chose; the app then points the book at it.
    A cover picked from a book catalogue comes as {"url": …}: the server fetches it itself."""
    if not request.user.is_authenticated:
        return error('Not signed in', 401)
    if request.content_type == 'application/json':
        url = (body(request) or {}).get('url')
        try:
            return JsonResponse(covers.keep_from(url))
        except ValueError:
            return error('That cover couldn’t be fetched.')
    data = request.body
    if not data or len(data) > covers.MAX_BYTES:
        return error('That picture is too large.', 413)
    try:
        return JsonResponse(covers.keep_upload(data))
    except ValueError:
        return error('That file isn’t a picture.')


# ───────────────────────── The assistant ─────────────────────────

@require_POST
def suggest(request):
    """A few words about a book, a few books or a series, or a photographed cover → proposals for the app to show."""
    if not request.user.is_authenticated:
        return error('Not signed in', 401)
    data = body(request) or {}
    text = str(data.get('text') or '').strip()
    url = str(data.get('url') or '').strip()
    if not url.startswith('https://') or len(url) > 2000:
        url = ''
    image = None
    if isinstance(data.get('image'), str) and data['image']:
        # A photograph of a cover, as base64 (with or without the data: prefix).
        try:
            image = base64.b64decode(data['image'].split(',')[-1], validate=True)
        except ValueError:
            return error('That photograph could not be read.')
        if len(image) > intake.PHOTO_BYTES:
            return error('That photograph is too large.', 413)
    if (not text and not url and not image) or len(text) > 2000:
        return error('Describe the book in a few words.')

    try:
        if settings.BOEKEN_REPO:
            books = intake.propose(text, booklog=intake.Booklog(settings.BOEKEN_REPO), url=url, image=image)
        else:
            used = {c for b in Book.shelf(request.user) for c in b.data.get('categories') or []}
            books = intake.propose(text, categories=used, url=url, image=image)
    except intake.NotSetUp as err:
        return error(str(err), 503)
    except intake.IntakeError as err:
        return error(str(err), 502)
    return JsonResponse({'books': books})


@require_GET
def booklog_names(request):
    """The booklog's own names for its categories and tags (their pages' titles), and its series."""
    if not request.user.is_authenticated:
        return error('Not signed in', 401)
    if not settings.BOEKEN_REPO:
        return JsonResponse({'categories': None, 'tags': None, 'series': None})
    from . import boeken
    return JsonResponse({'categories': boeken.term_titles(settings.BOEKEN_REPO, 'categories'),
                         'tags': boeken.term_titles(settings.BOEKEN_REPO, 'tags'),
                         'series': sorted(boeken.term_titles(settings.BOEKEN_REPO, 'series').values())})


@require_POST
def tag_merges(request):
    """The shelf's tags → groups the assistant sees as one tag."""
    if not request.user.is_authenticated:
        return error('Not signed in', 401)
    tags = (body(request) or {}).get('tags')
    if not isinstance(tags, list) or not 0 < len(tags) <= 2000:
        return error('Bad request')
    asked = [{'slug': str(t.get('slug'))[:100], 'name': str(t.get('name') or '')[:100], 'books': int(t.get('books') or 0)}
             for t in tags if isinstance(t, dict) and t.get('slug')]
    try:
        return JsonResponse({'groups': intake.tag_merges(asked)})
    except intake.NotSetUp as err:
        return error(str(err), 503)
    except intake.IntakeError as err:
        return error(str(err), 502)


@require_POST
def original_of(request):
    """A book → the language it was first written in, and its title in that language, as the assistant knows it."""
    if not request.user.is_authenticated:
        return error('Not signed in', 401)
    data = body(request) or {}
    title = str(data.get('title') or '').strip()[:300]
    if not title:
        return error('Bad request')
    book = {'id': '1', 'title': title, 'author': str(data.get('author') or '').strip()[:300],
            'language': str(data.get('language') or '').strip()[:5]}
    try:
        return JsonResponse(original.ask([book]).get('1') or {})
    except intake.NotSetUp as err:
        return error(str(err), 503)
    except intake.IntakeError as err:
        return error(str(err), 502)


@require_POST
def pages_of(request):
    """An ISBN-13 → its page count as Hardcover has it (null when it has none)."""
    if not request.user.is_authenticated:
        return error('Not signed in', 401)
    isbn = str((body(request) or {}).get('isbn') or '')
    if not re.fullmatch(r'\d{13}', isbn):
        return error('Bad request')
    key = 'pages:' + isbn
    if (cached := cache.get(key)) is not None:
        return JsonResponse({'pages': cached or None})
    try:
        found = pages.hardcover([isbn]).get(isbn)
    except pages.NotSetUp as err:
        return error(str(err), 503)
    except Exception as err:
        logger.warning('Hardcover did not answer for %s: %s', isbn, err)
        return error('Hardcover did not answer', 502)
    cache.set(key, found or 0, 60 * 60 * 24)
    return JsonResponse({'pages': found})


@require_POST
def categories_of(request):
    """Books without a category → the categories the assistant would give each, for the app to propose."""
    if not request.user.is_authenticated:
        return error('Not signed in', 401)
    books = (body(request) or {}).get('books')
    if not isinstance(books, list) or not 0 < len(books) <= categorise.MOST:
        return error('Bad request')
    asked = []
    for b in books:
        if not isinstance(b, dict):
            continue
        uid, title = str(b.get('id') or '')[:64], ' '.join(str(b.get('title') or '').split())[:300]
        if uid and title:
            asked.append({'id': uid, 'title': title, 'author': ' '.join(str(b.get('author') or '').split())[:300],
                          'series': ' '.join(str(b.get('series') or '').split())[:200],
                          'year': str(b.get('year') or '')[:4], 'language': str(b.get('language') or '')[:5]})
    if not asked:
        return error('Bad request')
    if settings.BOEKEN_REPO:
        allowed = intake.known_terms(settings.BOEKEN_REPO, 'categories')
    else:
        allowed = {c for b in Book.shelf(request.user) for c in b.data.get('categories') or []}
    try:
        return JsonResponse({'books': categorise.ask(asked, allowed)})
    except intake.NotSetUp as err:
        return error(str(err), 503)
    except intake.IntakeError as err:
        return error(str(err), 502)


@require_POST
def translate(request):
    """Words the user keeps in two languages → the assistant's proposal for the missing language."""
    if not request.user.is_authenticated:
        return error('Not signed in', 401)
    data = body(request) or {}
    kind, to = data.get('kind'), data.get('to')
    words = data.get('words')
    if kind not in intake.TRANSLATABLE or to not in ('en', 'nl') or not isinstance(words, list) or not 0 < len(words) <= 100:
        return error('Bad request')
    asked = []
    for w in words:
        word = str((w or {}).get('word') or '').strip()[:100] if isinstance(w, dict) else ''
        if word:
            seen_in = [str(b)[:100] for b in (w.get('books') or [])[:3] if b]
            asked.append({'word': word, 'books': seen_in})
    if not asked:
        return error('Bad request')
    try:
        return JsonResponse({'words': intake.translate(kind, to, asked)})
    except intake.NotSetUp as err:
        return error(str(err), 503)
    except intake.IntakeError as err:
        return error(str(err), 502)


# ───────────────────────── A public library ─────────────────────────

def library_state(lib):
    return {
        'allowed': bool(lib and lib.allowed),
        'enabled': bool(lib and lib.allowed and lib.enabled),
        'slug': lib.slug if lib else '',
        'title': {'en': lib.title_en, 'nl': lib.title_nl} if lib else {'en': '', 'nl': ''},
        'about': {'en': lib.about_en, 'nl': lib.about_nl} if lib else {'en': '', 'nl': ''},
    }


def two_languages(value, limit):
    value = value if isinstance(value, dict) else {}
    return {code: str(value.get(code) or '').strip()[:limit] for code in ('en', 'nl')}


def library_settings(request):
    """The owner's side: whether their library is public, under which name, with what title.
    Sharing is a permission the admin grants (`allowed`); without it nothing can be turned on."""
    if not request.user.is_authenticated:
        return error('Not signed in', 401)
    lib = Library.objects.filter(user=request.user).first()
    if request.method == 'GET':
        return JsonResponse(library_state(lib))
    if request.method != 'POST':
        return error('Method not allowed', 405)
    if not lib or not lib.allowed:
        return error('Sharing a library isn’t possible for this account. Ask the person who runs this site.', 403)
    data = body(request)
    if data is None:
        return error('Bad request')
    if 'slug' in data:
        slug = str(data.get('slug') or '').strip().lower()
        if not public.slug_ok(slug):
            return error('A name of lowercase letters, digits and hyphens, please, at most 40.')
        if Library.objects.filter(slug=slug).exclude(pk=lib.pk).exists():
            return error('That name is taken.', 409)
        lib.slug = slug
    if 'enabled' in data:
        lib.enabled = bool(data['enabled'])
    if 'title' in data:
        title = two_languages(data['title'], 120)
        lib.title_en, lib.title_nl = title['en'], title['nl']
    if 'about' in data:
        about = two_languages(data['about'], 1000)
        lib.about_en, lib.about_nl = about['en'], about['nl']
    lib.save()
    return JsonResponse(library_state(lib))


def shared_version(lib):
    """What changes whenever the public library might: the newest stored change of the owner's
    books, lists and terms, and of the library itself."""
    stamps = [lib.changed] + [model.objects.filter(user=lib.user).aggregate(m=Max('changed'))['m'] for model in (Book, List, Term)]
    newest = max(s for s in stamps if s)
    return f'"{lib.pk}-{int(newest.timestamp() * 1000)}"'


NOT_SHARED = 'There is no library at this address.'


@require_GET
def public_library(request, slug):
    """A shared library, read-only, for anyone (shelf/public.py says what of it). Not for search
    engines. Unknown name, sharing off, nothing public: the same 404."""
    lib = public.shared(slug)
    if not lib:
        return error(NOT_SHARED, 404)
    tag = shared_version(lib)
    if tag in [t.strip() for t in request.headers.get('If-None-Match', '').split(',')]:
        response = HttpResponseNotModified()
    else:
        key = f'public-library:{tag}'
        content = cache.get(key)
        if content is None:
            built = public.library(lib)
            if built is None:
                return error(NOT_SHARED, 404)
            content = json.dumps(built, ensure_ascii=False, separators=(',', ':'))
            cache.set(key, content, 60 * 60 * 24)
        response = HttpResponse(content, content_type='application/json')
    response['ETag'] = tag
    response['Cache-Control'] = 'no-cache'
    response['X-Robots-Tag'] = 'noindex'
    return response


@require_GET
def public_page(request, slug):
    """/u/<slug>: the app's own page, to open as a visitor of that library. Its addresses are
    relative, so the page gets a <base> at the site's root; and it asks not to be indexed."""
    lib = public.shared(slug)
    page = (settings.BASE_DIR.parent / 'index.html').read_text(encoding='utf-8')
    if lib:
        from django.utils.html import escape
        title = escape(lib.title_en or lib.title_nl or lib.slug)
        page = re.sub(r'<title>.*?</title>', f'<title>{title}</title>', page, count=1, flags=re.S)
    page = re.sub(r'(<head>\s*(?:<meta charset[^>]*>)?)', r'\1\n  <base href="/">\n  <meta name="robots" content="noindex">', page, count=1)
    response = HttpResponse(page, status=200 if lib else 404)
    response['X-Robots-Tag'] = 'noindex'
    response['Cache-Control'] = 'no-cache'
    return response


# ───────────────────────── Sync ─────────────────────────

def clean_change(raw, key):
    """Validate one change from the client; returns a dict or None."""
    if not isinstance(raw, dict):
        return None
    uid = raw.get('id')
    modified = when(raw.get('modified'))
    if not isinstance(uid, str) or not 0 < len(uid) <= 64 or modified is None:
        return None
    deleted = bool(raw.get('deleted'))
    data = raw.get(key)
    if deleted:
        data = {}
    else:
        if not isinstance(data, dict) or len(json.dumps(data)) > MAX_BOOK_BYTES:
            return None
        data = {k: v for k, v in data.items() if k not in ('modified', 'deleted')}
        data['id'] = uid
    return {'uid': uid, 'modified': modified, 'deleted': deleted, 'data': data, 'drop': deleted and bool(raw.get('drop'))}


# What publishing to the booklog adds to a book and to its reads (shelf/publish.py).
PUBLISHED_KEYS = ('boeken', 'url', 'boekenState')
PUBLISHED_REVIEW_KEYS = ('boeken', 'url', 'sum')


def kept_from_publishing(old, new):
    """A device that changed a book before it heard the book was published sends it back as it
    knew it: still waiting to go to the booklog, without its post. Taken as it comes, that
    would forget the post, and the book would be published a second time. What publishing
    added stays, so the device's change becomes a change of that post."""
    if old.get('regrouped') and new.get('regroup') and new.get('regrouped') != old.get('regrouped'):
        # Regrouped meanwhile (a book combined or split, publish.py): the device's copy, from
        # before that, still says to. What publishing settled stays.
        new = {k: v for k, v in new.items() if k not in ('regroup', 'joined')}
        for key in PUBLISHED_KEYS:
            if key in old:
                new[key] = old[key]
        return new
    if not old.get('boeken') or new.get('boeken') or not new.get('boekenWanted'):
        return new
    new = {k: v for k, v in new.items() if k != 'boekenWanted'}
    for key in PUBLISHED_KEYS:
        if key in old and key not in new:
            new[key] = old[key]
    linked = {r['id']: r for r in old.get('reviews') or [] if isinstance(r, dict) and r.get('id') and r.get('boeken')}
    if isinstance(new.get('reviews'), list):
        new['reviews'] = [{**r, **{k: linked[r['id']][k] for k in PUBLISHED_REVIEW_KEYS if k in linked[r['id']]}}
                          if isinstance(r, dict) and r.get('id') in linked and not r.get('boeken') else r
                          for r in new['reviews']]
    return new


def merge(model, user, raw_changes, since, now, tombstones_when_fresh=False):
    """Store the client's changes that are newer than ours; return the rows the client lacks, by uid."""
    changes = [c for c in (clean_change(raw, model.KEY) for raw in raw_changes) if c]
    existing = {r.uid: r for r in model.objects.filter(user=user, uid__in=[c['uid'] for c in changes])}
    statuses = works.status_lists(user) if model.KEY == 'book' and changes else None
    accepted, stale = set(), set()
    for c in changes:
        row = existing.get(c['uid'])
        if row and row.modified >= c['modified']:
            stale.add(c['uid'])   # the server has a newer version: send it back
            continue
        label = str(c['data'].get(model.LABEL) or '')[:300]
        if c['drop'] and row and not row.deleted and row.data.get('boeken'):
            # A book given up for good that is in the booklog: its tombstone remembers which,
            # so the page there can go too (shelf/publish.py). Clients never see this.
            # Which posts are its own: those of its reads, whichever edition they were of.
            posts = [row.data['boeken'], *(r['boeken'] for r in row.data.get('reviews') or [] if isinstance(r, dict) and r.get('boeken'))]
            c['data'] = {'drop': {'boeken': row.data['boeken'], 'title': row.title, 'posts': list(dict.fromkeys(posts))}}
        if model.KEY == 'book' and not c['deleted']:
            # As works.py has a book: in the old shape it is made new first. When that changes
            # anything the device gets the book back.
            kept = works.upgrade(c['data'], statuses)
            if kept != c['data']:
                c['data'] = kept
        sent = c['data']
        if row and not c['deleted'] and not row.deleted and model.KEY == 'book':
            c['data'] = kept_from_publishing(row.data, c['data'])
        if row:
            if not c['deleted']:
                setattr(row, model.LABEL, label)   # a tombstone keeps its label for the admin
            row.data, row.deleted, row.modified, row.changed = c['data'], c['deleted'], c['modified'], now
            row.save()
        else:
            row = model.objects.create(user=user, uid=c['uid'], data=c['data'], deleted=c['deleted'],
                                       modified=c['modified'], changed=now, **{model.LABEL: label})
            existing[c['uid']] = row
        if c['data'] is sent:
            accepted.add(c['uid'])   # else the device gets the book back as it is kept now

    outgoing = model.objects.filter(user=user)
    if since:
        outgoing = outgoing.filter(changed__gt=since)
    elif not tombstones_when_fresh:
        outgoing = outgoing.filter(deleted=False)   # a fresh device needs no tombstones
    out = {r.uid: r for r in outgoing if r.uid not in accepted}
    for uid in stale - out.keys():
        out[uid] = existing[uid]
    return out


@require_POST
def sync(request):
    if not request.user.is_authenticated:
        return error('Not signed in', 401)
    data = body(request)
    if data is None:
        return error('Bad request')
    if data.get('schema') != SCHEMA:
        return error(OUT_OF_DATE, 409)
    raw_books, raw_lists, raw_terms = data.get('changes') or [], data.get('lists') or [], data.get('terms') or []
    if not all(isinstance(raw, list) and len(raw) <= MAX_CHANGES for raw in (raw_books, raw_lists, raw_terms)):
        return error('Bad request')

    user = request.user
    # SQLite is opened in IMMEDIATE mode, so syncs run one at a time and timestamps
    # handed out here are strictly ordered.
    with transaction.atomic():
        now = timezone.now()
        books = merge(Book, user, raw_books, when(data.get('since')), now)
        # Every device starts with the same standard lists, so a fresh one must also hear
        # which of them were deleted elsewhere.
        lists = merge(List, user, raw_lists, when(data.get('listsSince')), now, tombstones_when_fresh=True)
        # A copy of the app from before terms sends none and asks for none.
        terms = merge(Term, user, raw_terms, when(data.get('termsSince')), now, tombstones_when_fresh=True) if 'terms' in data else {}

    # Covers from the book catalogues get a copy on this server, a few per sync. Those books go
    # back in this answer, so the device that scanned them points at the copy straight away.
    try:
        for book in covers.adopt(user):
            books[book.uid] = book
    except Exception:   # a cover is never worth failing a sync for
        logger.exception('Could not fetch covers')

    return JsonResponse({
        'cursor': now.isoformat().replace('+00:00', 'Z'),
        'changes': [b.as_change() for b in books.values()],
        'lists': [l.as_change() for l in lists.values()],
        **({'terms': [t.as_change() for t in terms.values()]} if 'terms' in data else {}),
        'user': user.get_username(),
        'assistant': bool(settings.OPENAI_API_KEY),   # whether /api/suggest will answer
        **({'backup': last_backup()} if user.is_staff else {}),
    })


def last_backup():
    """When the server's nightly copy (folio-backup.sh) last made a copy, and last found nothing
    new to copy: {"made", "checked"}, or None where it never ran (or can't be read)."""
    try:
        with open(settings.BACKUP_STAMP, encoding='utf-8') as f:
            stamp = json.load(f)
    except (OSError, ValueError):
        return None
    if not isinstance(stamp, dict) or not isinstance(stamp.get('made'), str):
        return None
    return {'made': stamp['made'], 'checked': stamp.get('checked') if isinstance(stamp.get('checked'), str) else stamp['made']}

MAX_GONE = 50_000             # ids asked about at once


@require_POST
def gone(request):
    """Which of these records were deleted, and when: {"books": {uid: modified}, "lists": …, "terms": …}.

    Restoring a backup asks, so a book deleted on purpose on another device is not quietly
    brought back by a file made before (docs/shelf-ideas-plan.md, stage 1). Only tombstones are
    answered: a record the server has alive, or never had, is not in the answer."""
    if not request.user.is_authenticated:
        return error('Not signed in', 401)
    data = body(request)
    if data is None:
        return error('Bad request')
    out = {}
    for key, model in (('books', Book), ('lists', List), ('terms', Term)):
        ids = data.get(key) or []
        if not isinstance(ids, list) or len(ids) > MAX_GONE or not all(isinstance(i, str) for i in ids):
            return error('Bad request')
        # Every tombstone, filtered here: an `uid__in` of thousands is more than SQLite takes.
        asked = set(ids)
        rows = model.objects.filter(user=request.user, deleted=True).values_list('uid', 'modified')
        out[key] = {uid: modified.isoformat().replace('+00:00', 'Z') for uid, modified in rows if uid in asked}
    return JsonResponse(out)
