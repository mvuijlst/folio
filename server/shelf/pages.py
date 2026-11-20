"""Page counts for editions the catalogues leave without one.

Google Books and Open Library often know an edition but not its length (a UK paperback whose
Open Library record never had its pages entered). Two more places are asked, in this order:

  1. Hardcover (hardcover.app), by ISBN: the edition's own page count. Its GraphQL API wants a
     personal token (HARDCOVER_API_TOKEN), which must not reach a browser, so only the server asks.
     It allows about 60 requests a minute; one request carries up to 25 ISBNs.
  2. Open Library's work for the ISBN: the median page count of the work's editions. Not this
     edition's own, but near it for most books; a last resort, only where nothing else says one.

Used by the app after a scan (POST /api/pages) and by `manage.py fill_pages` for the shelf.
"""
import json
import re
import urllib.parse
import urllib.request

from django.conf import settings

AGENT = 'Folio/2 (page counts)'
HARDCOVER = 'https://api.hardcover.app/v1/graphql'
BATCH = 25

QUERY = """query Pages($isbns: [String!]) {
  editions(where: {_or: [{isbn_13: {_in: $isbns}}, {isbn_10: {_in: $isbns}}]}, limit: 100) {
    isbn_13
    isbn_10
    pages
  }
}"""


class NotSetUp(Exception):
    pass


def isbn10(isbn13):
    if not re.fullmatch(r'978\d{10}', isbn13 or ''):
        return ''
    core = isbn13[3:12]
    check = (11 - sum(int(d) * (10 - i) for i, d in enumerate(core)) % 11) % 11
    return core + ('X' if check == 10 else str(check))


def token():
    """The Authorization header for Hardcover. Its settings page shows the token with "Bearer " in front; either way works."""
    raw = (getattr(settings, 'HARDCOVER_API_TOKEN', '') or '').strip()
    if not raw:
        return ''
    return raw if raw.lower().startswith('bearer ') else 'Bearer ' + raw


def post_json(url, payload, headers, timeout=20):
    request = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), method='POST',
                                     headers={'Content-Type': 'application/json', 'User-Agent': AGENT, **headers})
    with urllib.request.urlopen(request, timeout=timeout) as res:
        return json.loads(res.read().decode('utf-8'))


def get_json(url, timeout=10):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': AGENT}), timeout=timeout) as res:
        return json.loads(res.read().decode('utf-8'))


def from_hardcover(data, isbns):
    """Hardcover's answer → {isbn13: pages} for the asked ISBN-13s it has a page count of."""
    if data.get('errors'):
        raise RuntimeError('; '.join(str(e.get('message', e)) for e in data['errors'])[:300])
    back = {}
    for isbn in isbns:
        back[isbn] = isbn
        if isbn10(isbn):
            back[isbn10(isbn)] = isbn
    found = {}
    for edition in (data.get('data') or {}).get('editions') or []:
        try:
            pages = int(edition.get('pages') or 0)
        except (TypeError, ValueError):
            pages = 0
        isbn = back.get(edition.get('isbn_13') or '') or back.get(edition.get('isbn_10') or '')
        if isbn and 0 < pages < 20000 and isbn not in found:
            found[isbn] = pages
    return found


def hardcover(isbns):
    """{isbn13: pages} for those of these ISBN-13s Hardcover has a page count of, BATCH a request.
    NotSetUp without a token; an exception when Hardcover doesn't answer."""
    auth = token()
    if not auth:
        raise NotSetUp('Hardcover is not set up on the server')
    isbns = list(dict.fromkeys(i for i in isbns if re.fullmatch(r'\d{13}', i or '')))
    found = {}
    for start in range(0, len(isbns), BATCH):
        part = isbns[start:start + BATCH]
        forms = [f for isbn in part for f in (isbn, isbn10(isbn)) if f]
        found.update(from_hardcover(post_json(HARDCOVER, {'query': QUERY, 'variables': {'isbns': forms}}, {'Authorization': auth}), part))
    return found


def median(isbn):
    """The median page count of the Open Library work this ISBN is an edition of, or None."""
    url = 'https://openlibrary.org/search.json?' + urllib.parse.urlencode({'isbn': isbn, 'fields': 'number_of_pages_median', 'limit': 1})
    docs = get_json(url).get('docs') or []
    n = docs[0].get('number_of_pages_median') if docs else None
    return n if isinstance(n, int) and n > 0 else None


def one(isbn):
    """The page count of one ISBN-13 from Hardcover, else Open Library's median; None when neither says one or answers."""
    try:
        found = hardcover([isbn]).get(isbn)
        if found:
            return found
    except Exception:
        pass
    try:
        return median(isbn)
    except Exception:
        return None
