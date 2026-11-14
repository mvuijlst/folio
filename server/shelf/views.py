"""JSON API used by the Folio PWA.

  GET  /api/session  → {"user": name | null}; also sets the CSRF cookie
  POST /api/login    {"username", "password"} → {"user": name}
  POST /api/logout
  POST /api/sync     {"since": cursor | null, "changes": [change…],
                      "listsSince": cursor | null, "lists": [change…]}
                     → {"cursor", "changes": [change…], "lists": [change…]}

Books travel in "changes" and the user's lists in "lists". A change is {"id", "modified",
"deleted", "book"} (or "list"). The server keeps the newest change for each record (by
"modified") and answers with everything stored after the cursor that the device doesn't
already have, so every device converges on the same shelf.
"""
import json
import logging
from datetime import timezone as dt_timezone

from django.contrib.auth import authenticate, login, logout
from django.core.cache import cache
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

from . import covers
from .models import Book, List

logger = logging.getLogger(__name__)

MAX_BOOK_BYTES = 300_000      # a book with a cover thumbnail is ~30 kB
MAX_CHANGES = 5000
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

    keys = [f'login-fail:ip:{client_ip(request)}', f'login-fail:user:{username.lower()}']
    if any((cache.get(k) or 0) >= LOGIN_LIMIT for k in keys):
        return error('Too many attempts. Try again in a quarter of an hour.', 429)

    user = authenticate(request, username=username, password=password)
    if user is None:
        for k in keys:
            cache.add(k, 0, LOGIN_WINDOW)
            try:
                cache.incr(k)
            except ValueError:
                cache.set(k, 1, LOGIN_WINDOW)
        return error('That username and password don’t match.', 401)

    login(request, user)
    return JsonResponse({'user': user.get_username()})


@require_POST
def logout_view(request):
    logout(request)
    return JsonResponse({'user': None})


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
    return {'uid': uid, 'modified': modified, 'deleted': deleted, 'data': data}


def merge(model, user, raw_changes, since, now, tombstones_when_fresh=False):
    """Store the client's changes that are newer than ours; return the rows the client lacks, by uid."""
    changes = [c for c in (clean_change(raw, model.KEY) for raw in raw_changes) if c]
    existing = {r.uid: r for r in model.objects.filter(user=user, uid__in=[c['uid'] for c in changes])}
    accepted, stale = set(), set()
    for c in changes:
        row = existing.get(c['uid'])
        if row and row.modified >= c['modified']:
            stale.add(c['uid'])   # the server has a newer version: send it back
            continue
        label = str(c['data'].get(model.LABEL) or '')[:300]
        if row:
            if not c['deleted']:
                setattr(row, model.LABEL, label)   # a tombstone keeps its label for the admin
            row.data, row.deleted, row.modified, row.changed = c['data'], c['deleted'], c['modified'], now
            row.save()
        else:
            row = model.objects.create(user=user, uid=c['uid'], data=c['data'], deleted=c['deleted'],
                                       modified=c['modified'], changed=now, **{model.LABEL: label})
            existing[c['uid']] = row
        accepted.add(c['uid'])

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
    })
