"""JSON API used by the Bookscan PWA.

  GET  /api/session  → {"user": name | null}; also sets the CSRF cookie
  POST /api/login    {"username", "password"} → {"user": name}
  POST /api/logout
  POST /api/sync     {"since": cursor | null, "changes": [change…]} → {"cursor", "changes": [change…]}

A change is {"id", "modified", "deleted", "book"}. The server keeps the newest change for
each book (by "modified") and answers with everything stored after `since` that the device
doesn't already have, so every device converges on the same shelf.
"""
import json
from datetime import timezone as dt_timezone

from django.contrib.auth import authenticate, login, logout
from django.core.cache import cache
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

from .models import Book

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

def clean_change(raw):
    """Validate one change from the client; returns a dict or None."""
    if not isinstance(raw, dict):
        return None
    uid = raw.get('id')
    modified = when(raw.get('modified'))
    if not isinstance(uid, str) or not 0 < len(uid) <= 64 or modified is None:
        return None
    deleted = bool(raw.get('deleted'))
    book = raw.get('book')
    if deleted:
        book = {}
    else:
        if not isinstance(book, dict) or len(json.dumps(book)) > MAX_BOOK_BYTES:
            return None
        book = {k: v for k, v in book.items() if k not in ('modified', 'deleted')}
        book['id'] = uid
    return {'uid': uid, 'modified': modified, 'deleted': deleted, 'book': book}


@require_POST
def sync(request):
    if not request.user.is_authenticated:
        return error('Not signed in', 401)
    data = body(request)
    if data is None:
        return error('Bad request')
    since = when(data.get('since'))
    raw_changes = data.get('changes') or []
    if not isinstance(raw_changes, list) or len(raw_changes) > MAX_CHANGES:
        return error('Bad request')
    changes = [c for c in map(clean_change, raw_changes) if c]

    user = request.user
    # SQLite is opened in IMMEDIATE mode, so syncs run one at a time and timestamps
    # handed out here are strictly ordered.
    with transaction.atomic():
        now = timezone.now()
        existing = {b.uid: b for b in Book.objects.filter(user=user, uid__in=[c['uid'] for c in changes])}
        accepted, stale = set(), set()
        for c in changes:
            row = existing.get(c['uid'])
            if row and row.modified >= c['modified']:
                stale.add(c['uid'])   # the server has a newer version: send it back
                continue
            title = str(c['book'].get('title') or '')[:300]
            if row:
                if not c['deleted']:
                    row.title = title   # a tombstone keeps its title for the admin
                row.data, row.deleted, row.modified, row.changed = c['book'], c['deleted'], c['modified'], now
                row.save()
            else:
                row = Book.objects.create(user=user, uid=c['uid'], data=c['book'], deleted=c['deleted'],
                                          modified=c['modified'], changed=now, title=title)
                existing[c['uid']] = row
            accepted.add(c['uid'])

        outgoing = Book.objects.filter(user=user)
        if since:
            outgoing = outgoing.filter(changed__gt=since)
        else:
            outgoing = outgoing.filter(deleted=False)   # a fresh device needs no tombstones
        out = {b.uid: b for b in outgoing if b.uid not in accepted}
        for uid in stale - out.keys():
            out[uid] = existing[uid]

    return JsonResponse({
        'cursor': now.isoformat().replace('+00:00', 'Z'),
        'changes': [b.as_change() for b in out.values()],
        'user': user.get_username(),
    })
