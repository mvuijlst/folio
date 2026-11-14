"""The assistant: a few words about a book (or several, or a series) → proposed books.

This is boeggn's intake (apps/core/services/ai.py, isbn_lookup.py, reconcile.py), which
added books to the booklog before the app did. One call to a language model with a strict
answer format; then, for each book it names:

  * Open Library is asked for the ISBN and the cover, and only believed when title and
    author really match: a wrong identifier is worse than none;
  * the series, the tags and the authors are matched with what the booklog already has,
    so "Peter F. Hamilton" is the author it knows and "SF" the tag it uses.

The model is told the booklog's categories and may only choose from those. What comes back
is a proposal: nothing is added until the user says so in the app.
"""
import json
import re
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import yaml
from django.conf import settings

from . import boeken

TIMEOUT = 90


class IntakeError(Exception):
    """The assistant couldn't answer; str() can be shown to the user."""


SCHEMA = {
    'type': 'object',
    'additionalProperties': False,
    'required': ['books'],
    'properties': {
        'books': {
            'type': 'array',
            'items': {
                'type': 'object',
                'additionalProperties': False,
                'required': ['title', 'authors', 'publisher', 'year', 'pages', 'duration', 'series',
                             'series_number', 'language', 'categories', 'tags', 'note'],
                'properties': {
                    'title': {'type': 'string', 'description': 'kale titel, zonder reeksprefix'},
                    'authors': {
                        'type': 'array',
                        'items': {
                            'type': 'object',
                            'additionalProperties': False,
                            'required': ['name', 'role'],
                            'properties': {
                                'name': {'type': 'string', 'description': 'volledige naam, Voornaam Achternaam'},
                                'role': {'type': ['string', 'null'],
                                         'description': 'alleen bij niet-schrijvers: vertaling, stem, redactie, voorwoord…'},
                            },
                        },
                    },
                    'publisher': {'type': ['string', 'null']},
                    'year': {'type': ['integer', 'null'], 'description': 'jaar van de editie, anders eerste publicatie'},
                    'pages': {'type': ['integer', 'null'], 'description': 'alleen voor papier/ebook'},
                    'duration': {'type': ['string', 'null'], 'description': "alleen audioboek, formaat '12u 34m'"},
                    'series': {'type': ['string', 'null'], 'description': 'weergavenaam van de reeks'},
                    'series_number': {'type': ['number', 'null']},
                    'language': {'type': ['string', 'null'],
                                 'description': 'ISO 639-1 van de editie zoals de titel gegeven is (en, nl, fr, de…)'},
                    'categories': {'type': 'array', 'items': {'type': 'string'}},
                    'tags': {'type': 'array', 'items': {'type': 'string'},
                             'description': 'kleine-letter-slugs, alleen echt informatieve'},
                    'note': {'type': 'string', 'description': 'één droge NL-zin over het boek'},
                },
            },
        },
    },
}


def system_prompt(categories):
    return (
        'Je zet vrije tekst van de gebruiker om in boek-entries voor zijn Nederlandstalige '
        'booklog. De tekst kan één of meer boeken beschrijven, in het Nederlands of '
        'Engels, soms alleen een titel of auteur. Gebruik je boekenkennis om de '
        'bibliografische velden in te vullen; laat een veld null als je het echt niet '
        'weet — liever leeg dan gegokt.\n'
        "Verwijst de tekst naar een REEKS — expliciet ('series', 'saga', 'trilogie', "
        "'reeks', 'de hele …') of omdat de naam alleen als reeks bestaat (bv. "
        "'Commonwealth Saga' → Pandora's Star + Judas Unchained) — geef dan één entry "
        'per hoofddeel, in leesvolgorde, elk met series en series_number; laat '
        'novelles en zijverhalen weg. Kan de naam zowel het eerste boek als de reeks '
        "zijn (bv. 'Ringworld') en zegt de tekst niet duidelijk dat het om de reeks "
        'gaat, geef dan alleen dat ene boek. Een reeks die je niet kent verzin je '
        'niet: geef dan één entry met de tekst als titel en de rest null.\n'
        f'Categorieën komen UITSLUITEND uit deze lijst: {", ".join(sorted(categories))}. Kies er minstens één '
        "(meestal is dat genoeg); 'audiobook' alleen als de tekst zegt dat het om een "
        'audioboek gaat, en geef dan duration in plaats van pages.\n'
        "Tags: hooguit een paar, kleine-letter-slugs (bv. 'space-opera', "
        "'alternate-history'), alleen als ze echt iets toevoegen.\n"
        "Series: weergavenaam (bv. 'Malazan Book of the Fallen') plus volgnummer.\n"
        'Language: de taal van de editie zoals de titel gegeven is, als ISO 639-1-code.\n'
        'De note is één droge, feitelijke Nederlandse zin (geen reclametaal).'
    )


def post_json(url, payload, headers):
    request = urllib.request.Request(url, data=json.dumps(payload).encode(), method='POST',
                                     headers={'Content-Type': 'application/json', **headers})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return json.load(response)


def get_json(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'Folio/1 (book lookup)'})
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)


def analyse(text, categories):
    """What the model makes of `text`: a list of proposed books, as SCHEMA describes them."""
    if not settings.OPENAI_API_KEY:
        raise IntakeError('The assistant is not set up on this server.')
    try:
        answer = post_json('https://api.openai.com/v1/chat/completions', {
            'model': settings.OPENAI_MODEL,
            'messages': [{'role': 'system', 'content': system_prompt(categories)},
                         {'role': 'user', 'content': text}],
            'response_format': {'type': 'json_schema', 'json_schema': {'name': 'books', 'strict': True, 'schema': SCHEMA}},
        }, {'Authorization': f'Bearer {settings.OPENAI_API_KEY}'})
    except urllib.error.HTTPError as err:
        try:
            detail = json.load(err)['error']['message']
        except Exception:
            detail = err.reason
        raise IntakeError(f'The assistant answered with an error ({err.code}): {detail}')
    except (urllib.error.URLError, OSError, ValueError) as err:
        raise IntakeError(f'The assistant could not be reached: {err}')
    try:
        return json.loads(answer['choices'][0]['message']['content'])['books']
    except (ValueError, KeyError, IndexError, TypeError) as err:
        raise IntakeError(f'The assistant gave an answer that could not be read: {err}')


# ───────────────────────── Open Library: ISBN and cover, when it really is that book ─────────────────────────

def plain(text):
    text = unicodedata.normalize('NFKD', str(text or ''))
    return re.sub(r'[^a-z0-9]+', ' ', ''.join(c for c in text if not unicodedata.combining(c)).lower()).strip()


def enrich(proposal):
    """Add isbn, olid and cover from Open Library, when a hit is verifiably the same book:
    the same title (or its part before a colon), no volume number the proposal doesn't
    have, and the author's surname. Never raises."""
    title = proposal.get('title') or ''
    authors = proposal.get('authors') or []
    surname = (authors[0].get('name', '').split() or [''])[-1] if authors else ''
    query = {'title': title, 'fields': 'key,title,author_name,isbn,cover_i', 'limit': '3'}
    if surname:
        query['author'] = surname
    try:
        docs = get_json('https://openlibrary.org/search.json?' + urllib.parse.urlencode(query)).get('docs', [])
    except Exception:
        return proposal
    wanted = plain(title)
    for doc in docs:
        found = plain(doc.get('title', ''))
        if wanted != found and wanted != plain(doc.get('title', '').split(':')[0]) and plain(title.split(':')[0]) != found:
            continue
        if set(re.findall(r'\d+', found)) - set(re.findall(r'\d+', wanted)):
            continue
        if surname and plain(surname) not in plain(' '.join(doc.get('author_name', []))):
            continue
        work = re.match(r'^/works/(OL\d+W)$', doc.get('key', ''))
        if work:
            proposal['olid'] = work.group(1)
        isbns = [i for i in doc.get('isbn', []) if len(i) == 13] or doc.get('isbn', [])
        if isbns:
            proposal['isbn'] = isbns[0]
        if doc.get('cover_i'):
            proposal['cover'] = f'https://covers.openlibrary.org/b/id/{doc["cover_i"]}-L.jpg'
        break
    return proposal


# ───────────────────────── What the booklog already has ─────────────────────────

def name_key(parts):
    """The same whatever the order or the punctuation: "Hamilton, Peter F." is "Peter F. Hamilton"
    is hamilton-peter-f."""
    return ' '.join(sorted(key for key in (re.sub(r'[^a-z0-9]', '', plain(part)) for part in parts if part) if key))


def known_terms(repo, kind):
    folder = Path(repo, 'site', 'content', kind)
    return {page.parent.name for page in folder.glob('*/_index.md')} if folder.is_dir() else set()


class Booklog:
    """The authors, series, tags and categories of a booklog, for matching proposals with."""

    def __init__(self, repo):
        self.categories = known_terms(repo, 'categories')
        self.tags = known_terms(repo, 'tags')
        self.authors = {}   # name key → name as the booklog shows it
        for slug, title in boeken.author_names(repo).items():
            self.authors[name_key(title.split())] = title
            self.authors.setdefault(name_key(slug.split('-')), title)
        self.series = {}    # folded name → name as the booklog shows it
        for page in Path(repo, 'site', 'content', 'series').glob('*/_index.md'):
            match = boeken.FRONT_MATTER.match(page.read_text(encoding='utf-8'))
            title = ((yaml.safe_load(match.group(1)) if match else None) or {}).get('title')
            if title:
                self.series[plain(title)] = str(title)

    def author(self, name):
        return self.authors.get(name_key(str(name).split()), str(name).strip())

    def tag(self, tag):
        """The booklog's own spelling of a tag ("SF" → "sf", "spaceopera" → "space-opera")."""
        slug = re.sub(r'[^a-z0-9]+', '-', plain(tag)).strip('-')
        if slug in self.tags:
            return slug
        return next((known for known in self.tags if known.replace('-', '') == slug.replace('-', '')), slug)


def propose(text, booklog=None, categories=()):
    """`text` → books as the app keeps them, ready to be shown as proposals."""
    categories = set(booklog.categories if booklog else categories)
    out = []
    for proposal in analyse(text, categories):
        enrich(proposal)
        writers = [a.get('name', '') for a in proposal.get('authors') or [] if a.get('name') and not a.get('role')]
        writers = writers or [a.get('name', '') for a in proposal.get('authors') or [] if a.get('name')]
        series = str(proposal.get('series') or '').strip()
        number = proposal.get('series_number')
        if isinstance(number, float) and number.is_integer():
            number = int(number)
        tags = [(booklog.tag(tag) if booklog else str(tag)) for tag in proposal.get('tags') or []]
        book = {
            'title': str(proposal.get('title') or '').strip(),
            'author': ', '.join(booklog.author(name) if booklog else name for name in writers),
            'publisher': str(proposal.get('publisher') or ''),
            'date': str(proposal.get('year') or ''),
            'pages': proposal.get('pages') if isinstance(proposal.get('pages'), int) else None,
            'duration': str(proposal.get('duration') or ''),
            'series': (booklog.series.get(plain(series), series) if booklog else series),
            'seriesNumber': number if series and isinstance(number, (int, float)) else None,
            'language': proposal['language'] if re.fullmatch(r'[a-z]{2}', str(proposal.get('language') or '')) else '',
            'categories': [c for c in proposal.get('categories') or [] if c in categories],
            'tags': list(dict.fromkeys(tag for tag in tags if tag)),
            'note': str(proposal.get('note') or '').strip(),
            'isbn': str(proposal.get('isbn') or ''),
            'olid': str(proposal.get('olid') or ''),
            'cover': str(proposal.get('cover') or ''),
        }
        if book['title']:
            out.append({k: v for k, v in book.items() if v not in ('', None, [])})
    return out
