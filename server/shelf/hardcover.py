"""Series from Hardcover (docs/shelf-ideas-plan.md, stage 6): the volumes of a series, to name the
numbers the shelf doesn't have (the app's series strip) and to say when a series gets a new one.

Hardcover is a GraphQL API (api.hardcover.app) asked with a personal token: HARDCOVER_API_TOKEN in
the server's .env (shared with shelf/pages.py). The free plan allows 5,000 requests a day and 60
a minute; every top-level field of a query is one. Answers are kept a day in the cache.

What a series' raw list holds needs sorting (measured 2026-11-20 on ten of Michel's series):
- many series share a name, most of them empty: by name, the one with the most books is taken;
- a number can have several books (the original, translations, a two-part edition): the one most
  people have shelved is that number's, whichever is marked a copy of which (dropping every book
  marked a copy dropped real volumes: The Shadow Rising, Midnight Tides);
- box sets (`compilation`) are left out, and books without a number (a collection) too;
- in a widely read series, a book under 1% of the most-read one's readers is noise and left out,
  unless it isn't out yet; a small series (comics: 0 to 5 readers each) keeps everything.
"""
import json
import time
import urllib.request

from django.conf import settings
from django.core.cache import cache

ENDPOINT = 'https://api.hardcover.app/v1/graphql'
AGENT = 'Folio/2 (personal library; series volumes)'
DAY = 24 * 3600


class Unavailable(Exception):
    """No token, or Hardcover didn't answer."""


def ask(query, variables=None):
    token = str(getattr(settings, 'HARDCOVER_API_TOKEN', '') or '').strip()
    if not token:
        raise Unavailable('No Hardcover token')
    if not token.lower().startswith('bearer '):   # pasted with or without the word
        token = 'Bearer ' + token
    req = urllib.request.Request(ENDPOINT, data=json.dumps({'query': query, 'variables': variables or {}}).encode(),
                                 headers={'Content-Type': 'application/json', 'Authorization': token, 'User-Agent': AGENT})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            data = json.loads(res.read().decode())
    except Exception as err:
        raise Unavailable(str(err)) from err
    if data.get('errors'):
        raise Unavailable(json.dumps(data['errors'])[:300])
    return data['data']


FIND = """query($name: String!) {
  series(where: {name: {_eq: $name}}, order_by: {books_count: desc}, limit: 5) {
    id name books_count author { name }
  }
}"""
SEARCH = """query($q: String!) { search(query: $q, query_type: "Series", per_page: 8, page: 1) { results } }"""
VOLUMES = """query($id: Int!) {
  series(where: {id: {_eq: $id}}) {
    id name books_count is_completed author { name }
    book_series(order_by: {position: asc_nulls_last}) {
      position compilation
      book { id title release_year release_date users_count compilation image { url }
             contributions(limit: 3) { author { name } } }
    }
  }
}"""


def find(name):
    """Series by this name, the fullest first; else what Hardcover's search proposes.
    → [{id, name, books_count, author}]"""
    key = f'hardcover:find:{name.lower()}'
    if (hit := cache.get(key)) is not None:
        return hit
    found = [{'id': s['id'], 'name': s['name'], 'books_count': s['books_count'] or 0, 'author': (s.get('author') or {}).get('name') or ''}
             for s in ask(FIND, {'name': name})['series'] if (s['books_count'] or 0) > 0]
    if not found:
        results = (ask(SEARCH, {'q': name})['search'] or {}).get('results') or {}
        for hit in results.get('hits', []):
            d = hit.get('document') or {}
            if d.get('id') and (d.get('books_count') or 0) > 0:
                found.append({'id': int(d['id']), 'name': d.get('name') or '', 'books_count': d.get('books_count') or 0,
                              'author': d.get('author_name') or (d.get('author') or {}).get('name') or ''})
    cache.set(key, found, DAY)
    return found


def volumes_of(rows, today=None):
    """The book_series rows of a series → its volumes, one per number (see the top of this file)."""
    today = today or time.strftime('%Y-%m-%d')
    best = {}
    for r in rows:
        b = r.get('book')
        if not b or r.get('compilation') or b.get('compilation') or r.get('position') is None:
            continue
        pos = float(r['position'])
        key = int(pos) if pos.is_integer() else pos
        if key not in best or (b.get('users_count') or 0) > (best[key]['book'].get('users_count') or 0):
            best[key] = r
    top = max([(r['book'].get('users_count') or 0) for r in best.values()] or [0])
    out = []
    for key, r in sorted(best.items()):
        b = r['book']
        out_yet = bool(b.get('release_date')) and b['release_date'] <= today
        if top >= 100 and out_yet and (b.get('users_count') or 0) < top * 0.01:
            continue
        out.append({
            'n': key, 'id': b['id'], 'title': b.get('title') or '',
            'year': b.get('release_year') or (int(b['release_date'][:4]) if b.get('release_date') else None),
            'date': b.get('release_date') or '',
            'authors': [c['author']['name'] for c in b.get('contributions') or [] if c.get('author') and c['author'].get('name')],
            'cover': ((b.get('image') or {}).get('url') or ''),
        })
    return out


def series(series_id):
    """A series and its volumes: {id, name, books_count, completed, author, volumes}, or None."""
    key = f'hardcover:series:{series_id}'
    if (hit := cache.get(key)) is not None:
        return hit
    found = ask(VOLUMES, {'id': int(series_id)})['series']
    if not found:
        return None
    s = found[0]
    out = {'id': s['id'], 'name': s['name'], 'books_count': s['books_count'] or 0, 'completed': bool(s.get('is_completed')),
           'author': (s.get('author') or {}).get('name') or '', 'volumes': volumes_of(s.get('book_series') or [])}
    cache.set(key, out, DAY)
    return out
