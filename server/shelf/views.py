"""JSON API used by the Folio PWA.

  GET  /api/session  → {"user": name | null}; also sets the CSRF cookie
  POST /api/login    {"username", "password"} → {"user": name}
  POST /api/logout
  POST /api/cover    an image as the request body, or {"url"} of a catalogue cover → {"cover", "coverFull", "coverRatio"}
  POST /api/suggest  {"text", "url"} → {"books": [proposal…]}: the book(s) a description or a
                     shared page is about (by ISBN where there is one, else the assistant)
  POST /api/sync     {"schema": 2, "since": cursor | null, "changes": [change…],
                      "listsSince": cursor | null, "lists": [change…]}
                     → {"cursor", "changes": [change…], "lists": [change…]}

Books travel in "changes" and the user's lists in "lists". A change is {"id", "modified",
"deleted", "book"} (or "list"). The server keeps the newest change for each record (by
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
import time
from datetime import timezone as dt_timezone

from django.contrib.auth import authenticate, login, logout
from django.core.cache import cache
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

from django.conf import settings

from . import covers, intake, works
from .models import Book, List

logger = logging.getLogger(__name__)

MAX_BOOK_BYTES = 300_000      # a book with a cover thumbnail is ~30 kB
MAX_CHANGES = 5000
SCHEMA = 2                    # the shape of a book the app must speak (works.py)
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
            used = {c for b in Book.objects.filter(user=request.user, deleted=False) for c in b.data.get('categories') or []}
            books = intake.propose(text, categories=used, url=url, image=image)
    except intake.NotSetUp as err:
        return error(str(err), 503)
    except intake.IntakeError as err:
        return error(str(err), 502)
    return JsonResponse({'books': books})


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
    raw_books, raw_lists = data.get('changes') or [], data.get('lists') or []
    if not all(isinstance(raw, list) and len(raw) <= MAX_CHANGES for raw in (raw_books, raw_lists)):
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
        'user': user.get_username(),
        'assistant': bool(settings.OPENAI_API_KEY),   # whether /api/suggest will answer
    })
