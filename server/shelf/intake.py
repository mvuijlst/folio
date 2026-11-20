"""The assistant: a few words about a book (or several, or a series) → proposed books.

This is boeggn's intake (apps/core/services/ai.py, isbn_lookup.py, reconcile.py), which
added books to the booklog before the app did. One call to a language model with a strict
answer format; then, for each book it names:

  * Open Library is asked for the ISBN and the cover, and only believed when title and
    author really match: a wrong identifier is worse than none;
  * the series, the tags and the authors are matched with what the booklog already has,
    so "Peter F. Hamilton" is the author it knows and "SF" the tag it uses.

The model is told the booklog's categories and may only choose from those. It also says
whether it knows the book at all: a title it can read (on a cover, in a few words) is not a book
it knows, and then it gives no sentence and no tags, rather than ones made up from the title.
What comes back is a proposal: nothing is added until the user says so in the app.

What is shared to the app from another app (a page of a bookshop, a line of text) comes
here too. An ISBN in the text, or on the shared page, settles which book it is without
asking the model: Open Library is asked for that edition. An Audible page settles it the same
way: Audible's catalogue is asked for that audiobook.

A photograph of a cover comes here as well (the scanner's "no barcode" path): the model
looks at it and names the book, which reads stylised cover lettering far better than
character recognition does. The rest is the same.
"""
import base64
import io
import ipaddress
import json
import re
import socket
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import yaml
from django.conf import settings

from . import boeken, original

TIMEOUT = 90
PHOTO_SIDE = 1024     # px: a cover photo is sent no larger than this
PHOTO_BYTES = 6_000_000


class IntakeError(Exception):
    """The assistant couldn't answer; str() can be shown to the user."""


class NotSetUp(IntakeError):
    """There is no language model to ask on this server."""


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
                'required': ['title', 'authors', 'known', 'publisher', 'year', 'pages', 'duration', 'series',
                             'series_number', 'language', 'original_language', 'original_title', 'categories', 'tags', 'note'],
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
                    'known': {'type': 'boolean',
                              'description': 'kent je dit boek zelf (waar het over gaat), of heb je alleen titel en auteur gelezen?'},
                    'publisher': {'type': ['string', 'null']},
                    'year': {'type': ['integer', 'null'], 'description': 'jaar van de editie, anders eerste publicatie'},
                    'pages': {'type': ['integer', 'null'], 'description': 'alleen voor papier/ebook'},
                    'duration': {'type': ['string', 'null'], 'description': "alleen audioboek, formaat '12u 34m'"},
                    'series': {'type': ['string', 'null'], 'description': 'weergavenaam van de reeks'},
                    'series_number': {'type': ['number', 'null']},
                    'language': {'type': ['string', 'null'],
                                 'description': 'ISO 639-1 van de editie zoals de titel gegeven is (en, nl, fr, de…)'},
                    'original_language': {'type': ['string', 'null'],
                                          'description': 'ISO 639-1 van de taal waarin het werk oorspronkelijk geschreven is '
                                                         '(een Murakami: ja); null als je het boek niet kent'},
                    'original_title': {'type': ['string', 'null'],
                                       'description': 'de oorspronkelijke titel, in die taal en dat schrift; null als je hem niet kent'},
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
        'Known: true alleen als je dit boek zelf kent en weet waar het over gaat. Heb je alleen '
        'een titel en een auteur (uit de tekst of van de cover) en ken je het boek niet, zet known '
        'dan op false en verzin niets: geen note (lege string), geen tags, en publisher, year, pages '
        'en series alleen als ze in de tekst of op de cover staan. Leid het onderwerp nooit af uit '
        'de woorden van de titel: die zeggen vaak iets anders dan je denkt.\n'
        f'Categorieën komen UITSLUITEND uit deze lijst: {", ".join(sorted(categories))}. Kies er minstens één '
        '(meestal is dat genoeg) als je het boek kent; ken je het niet, kies er dan alleen een waar '
        'de tekst of de cover zelf onmiskenbaar naar wijst, en anders geen.\n'
        'Zegt de tekst dat het om een audioboek gaat, geef dan duration in plaats van pages.\n'
        "Tags: hooguit een paar, kleine-letter-slugs (bv. 'space-opera', "
        "'alternate-history'), alleen als ze echt iets toevoegen.\n"
        "Series: weergavenaam (bv. 'Malazan Book of the Fallen') plus volgnummer.\n"
        'Language: de taal van de editie zoals de titel gegeven is, als ISO 639-1-code.\n'
        'De note is één droge, feitelijke Nederlandse zin (geen reclametaal) over wat je van het '
        'boek weet, of leeg als je het niet kent.'
    )


PHOTO_PROMPT = (
    'Op de foto staat de voorkant van een boek, zoals iemand het in de hand of op tafel '
    'fotografeerde (soms meerdere boeken). Lees titel, auteur en eventuele reeks van de cover '
    'af en geef per boek één entry; vul de rest aan uit je boekenkennis, maar alleen als je het boek '
    'echt kent (anders known false, en alleen wat op de cover staat of te zien is). De taal is die van '
    'de editie op de foto. Kun je op de foto geen boek herkennen, of titel noch auteur lezen, '
    'geef dan een lege lijst: verzin niets.'
)


def photo_url(image):
    """A photograph from the app (bytes) → a data: address the model accepts, no larger than needed."""
    from PIL import Image, ImageOps
    if not image or len(image) > PHOTO_BYTES:
        raise IntakeError('That photograph is too large.')
    try:
        picture = ImageOps.exif_transpose(Image.open(io.BytesIO(image)))
        picture = picture.convert('RGB')
        picture.thumbnail((PHOTO_SIDE, PHOTO_SIDE))
        out = io.BytesIO()
        picture.save(out, 'JPEG', quality=85)
    except Exception as err:
        raise IntakeError(f'That photograph could not be read: {err}')
    return 'data:image/jpeg;base64,' + base64.b64encode(out.getvalue()).decode()


def post_json(url, payload, headers):
    request = urllib.request.Request(url, data=json.dumps(payload).encode(), method='POST',
                                     headers={'Content-Type': 'application/json', **headers})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return json.load(response)


def get_json(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'Folio/1 (book lookup)'})
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)


def analyse(text, categories, image=None):
    """What the model makes of `text` (and of a photographed cover): proposed books, as SCHEMA describes them."""
    # Reading a cover takes no deep thought: with little of it the answer is as good and comes
    # three times sooner (try_covers, 30 covers: 27 right either way, 2.6 s against 7.7 s).
    return ask(text, categories, image, effort=settings.OPENAI_COVER_EFFORT if image else None)[0]


def ask(text, categories, image=None, model=None, effort=None):
    """→ (books, usage): the model's proposals, and what the question cost in tokens.
    `effort`: how long the model may think ('low', 'medium', …), where it takes that."""
    if not settings.OPENAI_API_KEY:
        raise NotSetUp('The assistant is not set up on this server.')
    said = text
    if image:
        said = [{'type': 'text', 'text': '\n'.join(filter(None, [PHOTO_PROMPT, text]))},
                {'type': 'image_url', 'image_url': {'url': photo_url(image), 'detail': 'high'}}]
    question = {
        'model': model or settings.OPENAI_MODEL,
        'messages': [{'role': 'system', 'content': system_prompt(categories)},
                     {'role': 'user', 'content': said}],
        'response_format': {'type': 'json_schema', 'json_schema': {'name': 'books', 'strict': True, 'schema': SCHEMA}},
        **({'reasoning_effort': effort} if effort else {}),
    }
    try:
        answer = post_json('https://api.openai.com/v1/chat/completions', question, {'Authorization': f'Bearer {settings.OPENAI_API_KEY}'})
    except urllib.error.HTTPError as err:
        try:
            detail = json.load(err)['error']['message']
        except Exception:
            detail = err.reason
        if effort and err.code == 400 and 'reasoning_effort' in str(detail):
            return ask(text, categories, image, model)   # a model that doesn't take the setting: ask without it
        raise IntakeError(f'The assistant answered with an error ({err.code}): {detail}')
    except (urllib.error.URLError, OSError, ValueError) as err:
        raise IntakeError(f'The assistant could not be reached: {err}')
    try:
        return json.loads(answer['choices'][0]['message']['content'])['books'], answer.get('usage') or {}
    except (ValueError, KeyError, IndexError, TypeError) as err:
        raise IntakeError(f'The assistant gave an answer that could not be read: {err}')


# ───────────────────────── Words in two languages ─────────────────────────

# What the app keeps in two languages (terms.js), and how to tell the model what they are.
TRANSLATABLE = {
    'role': 'roles of people credited on a book: who wrote, drew, inked, coloured or lettered a comic, '
            'who translated a book, who read an audiobook aloud, who edited an anthology. A role can also be '
            'a part an actor voices in an audiobook (a character, the footnotes); keep such a name as it is.',
    'category': 'the categories of a personal library (genres such as fantasy and crime, and kinds of non-fiction '
                'such as history, biography, religion, design, art).',
    'list': 'names in a reading app: of lists of books (Library, To read, Wishlist), of sets of lists that are '
            'either-or, and of the note a book on a list can carry (Lent to).',
    'tag': 'tags on books in a personal library: subjects, places, periods, themes and sub-genres (vampieren, '
           'space-opera, tweede-wereldoorlog, belgie). A name (a person, a series, a fictional world, a brand) stays as it is.',
}
LANGUAGE = {'en': 'English', 'nl': 'Dutch (as spoken in Flanders)'}
STYLE = {
    'role': {'en': 'a short lowercase noun for the person, as in comics and audiobook credits (writer, artist, '
                   'colourist, letterer, narrator, translator), British spelling',
             'nl': 'a short lowercase noun for the work, as Dutch comics credits have it (tekst, beeld, kleur, '
                   'inkt, letters, stem, vertaling, redactie)'},
    'category': {'en': 'a short lowercase name, as a bookshop shelf would say it (history, science fiction)',
                 'nl': 'a short lowercase Dutch name, as a Flemish bookshop shelf would say it (geschiedenis)'},
    'list': {'en': 'a short name, capitalised like a heading (To buy, Lent to)',
             'nl': 'a short Dutch name, capitalised like a heading (Te kopen, Uitgeleend aan)'},
    'tag': {'en': 'a short name as a tag in English, lowercase unless it is a name (vampires, Belgium, space opera)',
            'nl': 'a short name as a tag in Dutch, lowercase unless it is a name (vampieren, België, ruimteopera)'},
}
TRANSLATION_SCHEMA = {
    'type': 'object', 'additionalProperties': False, 'required': ['words'],
    'properties': {'words': {'type': 'array', 'items': {
        'type': 'object', 'additionalProperties': False, 'required': ['word', 'translation'],
        'properties': {'word': {'type': 'string'}, 'translation': {'type': 'string'}}}}},
}


MERGE_SCHEMA = {
    'type': 'object', 'additionalProperties': False, 'required': ['groups'],
    'properties': {'groups': {'type': 'array', 'items': {
        'type': 'object', 'additionalProperties': False, 'required': ['keep', 'merge', 'why'],
        'properties': {'keep': {'type': 'string'}, 'merge': {'type': 'array', 'items': {'type': 'string'}},
                       'why': {'type': 'string'}}}}},
}
MERGE_PROMPT = ('These are the tags of a personal library (mostly Dutch, some English), each with how many books have it. '
                'Find tags that mean the same thing and should be one tag: the same word in Dutch and English (draken, '
                'dragons), a synonym (misdaad, crime), or two spellings. Not a broader and a narrower tag (fantasy and '
                'epic-fantasy stay apart), not related subjects. For each group: which tag to keep (the most used, unless '
                'another is clearly the better word), which to merge into it, and a few words why, in English. Use the '
                'slugs exactly as given. Few, sure groups are better than many doubtful ones.')


def tag_merges(tags):
    """[{slug, name, books}] → [{keep, merge: [slug], why}]: tags that say the same thing, in one language or
    two (misdaad, crime-fiction), as the model sees it. Only proposals, for the user to take or leave."""
    if not settings.OPENAI_API_KEY:
        raise NotSetUp('The assistant is not set up on this server.')
    lines = []
    for t in tags:
        line = f"{t['slug']} ({t.get('books', 0)})"
        if t.get('name') and t['name'] != t['slug']:
            line += f" = {t['name']}"
        lines.append(line)
    # A few hundred tags take the model minutes to think through at its own pace; on low effort it
    # answers in about twenty seconds (measured on 658 tags, 2026-11-17), within a request's minute.
    question = {
        'model': settings.OPENAI_MODEL,
        'messages': [{'role': 'system', 'content': MERGE_PROMPT}, {'role': 'user', 'content': '\n'.join(lines)}],
        'response_format': {'type': 'json_schema', 'json_schema': {'name': 'groups', 'strict': True, 'schema': MERGE_SCHEMA}},
        'reasoning_effort': 'low',
    }
    try:
        try:
            answer = post_json('https://api.openai.com/v1/chat/completions', question, {'Authorization': f'Bearer {settings.OPENAI_API_KEY}'})
        except urllib.error.HTTPError as err:
            if err.code != 400:
                raise
            # A model that doesn't take the setting: ask without it.
            question.pop('reasoning_effort')
            answer = post_json('https://api.openai.com/v1/chat/completions', question, {'Authorization': f'Bearer {settings.OPENAI_API_KEY}'})
        got = json.loads(answer['choices'][0]['message']['content'])['groups']
    except urllib.error.HTTPError as err:
        raise IntakeError(f'The assistant answered with an error ({err.code}).')
    except (urllib.error.URLError, OSError) as err:
        raise IntakeError(f'The assistant could not be reached: {err}')
    except (ValueError, KeyError, IndexError, TypeError) as err:
        raise IntakeError(f'The assistant gave an answer that could not be read: {err}')
    # What is kept is the tag on most books (the model doesn't always keep to that), and a tag is in
    # one group at most: a chain (mythology → mythologie → mythe) is left at its first link.
    books = {t['slug']: int(t.get('books') or 0) for t in tags}
    out, taken = [], set()
    for g in got if isinstance(got, list) else []:
        slugs = [s for s in dict.fromkeys([str(g.get('keep') or ''), *(str(m) for m in g.get('merge') or [])]) if s in books and s not in taken]
        if len(slugs) < 2:
            continue
        keep = max(slugs, key=lambda s: (books[s], s == str(g.get('keep'))))
        taken.update(slugs)
        out.append({'keep': keep, 'merge': [s for s in slugs if s != keep], 'why': ' '.join(str(g.get('why') or '').split())[:200]})
    return out


def translate(kind, to, words):
    """[{word, books}] → [{word, translation}]: the model's proposal for each word in language `to`.
    Only proposals: the app shows them, and keeps none the user doesn't accept."""
    if not settings.OPENAI_API_KEY:
        raise NotSetUp('The assistant is not set up on this server.')
    system = (f'You translate {TRANSLATABLE[kind]} Translate each word into {LANGUAGE[to]}: {STYLE[kind][to]}. '
              'A word may already be in that language, or be a name: then give it back unchanged. '
              'Answer with every word you were given, in the same order, spelled exactly as given.')
    said = '\n'.join(f"- {w['word']}" + (f" (on: {'; '.join(w['books'])})" if w.get('books') else '') for w in words)
    question = {
        'model': settings.OPENAI_MODEL,
        'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': said}],
        'response_format': {'type': 'json_schema', 'json_schema': {'name': 'words', 'strict': True, 'schema': TRANSLATION_SCHEMA}},
    }
    try:
        answer = post_json('https://api.openai.com/v1/chat/completions', question, {'Authorization': f'Bearer {settings.OPENAI_API_KEY}'})
        got = json.loads(answer['choices'][0]['message']['content'])['words']
    except urllib.error.HTTPError as err:
        raise IntakeError(f'The assistant answered with an error ({err.code}).')
    except (urllib.error.URLError, OSError) as err:
        raise IntakeError(f'The assistant could not be reached: {err}')
    except (ValueError, KeyError, IndexError, TypeError) as err:
        raise IntakeError(f'The assistant gave an answer that could not be read: {err}')
    asked = {w['word'] for w in words}
    out = []
    for w in got if isinstance(got, list) else []:
        word, translation = str(w.get('word') or ''), ' '.join(str(w.get('translation') or '').split())[:100]
        if word in asked and translation:
            out.append({'word': word, 'translation': translation})
    return out


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


# ───────────────────────── An ISBN: in the text, or on a shared page ─────────────────────────

ISBN13 = re.compile(r'97[89](?:[-\s]?\d){10}')
LABELLED = re.compile(r'"isbn(?:13)?"\s*[:=]\s*"?(97[89]\d{10})', re.I)
OPEN_LIBRARY = re.compile(r'openlibrary\.org/(?:isbn/(\d{10,13})|books/(OL\d+M))')
AMAZON = re.compile(r'/(?:dp|gp/product)/(\d{9}[\dXx])(?:[/?]|$)')


def isbn13(raw):
    """A 10- or 13-digit ISBN as 13 digits, or '' if it isn't one."""
    digits = re.sub(r'[^0-9Xx]', '', str(raw or '')).upper()
    if len(digits) == 10 and re.fullmatch(r'\d{9}[\dX]', digits):
        if sum((10 if c == 'X' else int(c)) * (10 - i) for i, c in enumerate(digits)) % 11:
            return ''
        digits = '978' + digits[:9]
        digits += str((10 - sum(int(c) * (3 if i % 2 else 1) for i, c in enumerate(digits)) % 10) % 10)
    if len(digits) != 13 or not digits.isdigit() or not digits.startswith(('978', '979')):
        return ''
    check = (10 - sum(int(c) * (3 if i % 2 else 1) for i, c in enumerate(digits[:12])) % 10) % 10
    return digits if check == int(digits[12]) else ''


def find_isbn(text):
    """The first ISBN-13 in a text (hyphens and spaces allowed), or ''."""
    for match in ISBN13.finditer(text or ''):
        found = isbn13(match.group(0))
        if found:
            return found
    return ''


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None   # each hop is checked before it is followed (public_page)


def public_page(url, limit=1_000_000):
    """The start of a page someone shared, as text.

    The address comes from outside, so it is only fetched over https from a host on the
    public internet, and every redirect is held to the same rule: this server must not be
    made to fetch things on its own network.
    """
    for _ in range(4):
        parts = urllib.parse.urlsplit(url)
        if parts.scheme != 'https' or not parts.hostname:
            raise ValueError('only https pages are fetched')
        for info in socket.getaddrinfo(parts.hostname, parts.port or 443, proto=socket.IPPROTO_TCP):
            if not ipaddress.ip_address(info[4][0]).is_global:
                raise ValueError('not a public address')
        request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (compatible; Folio book lookup)'})
        try:
            with urllib.request.build_opener(NoRedirect).open(request, timeout=10) as response:
                return response.read(limit).decode('utf-8', errors='replace')
        except urllib.error.HTTPError as err:
            if err.code in (301, 302, 303, 307, 308) and err.headers.get('Location'):
                url = urllib.parse.urljoin(url, err.headers['Location'])
                continue
            raise
    raise ValueError('too many redirects')


def isbn_from_url(url):
    """The ISBN a shared page is about, or ''. Open Library and Amazon addresses say it
    themselves; other pages (Goodreads, a bookshop) are fetched and searched."""
    match = OPEN_LIBRARY.search(url)
    if match:
        if match.group(1):
            return isbn13(match.group(1))
        try:
            edition = get_json(f'https://openlibrary.org/books/{match.group(2)}.json')
        except Exception:
            return ''
        return next((isbn13(i) for i in edition.get('isbn_13', []) + edition.get('isbn_10', []) if isbn13(i)), '')
    match = AMAZON.search(urllib.parse.urlsplit(url).path)
    if match and isbn13(match.group(1)):
        return isbn13(match.group(1))   # a book's Amazon number is its ISBN-10
    try:
        page = public_page(url)
    except Exception:
        return ''
    match = LABELLED.search(page)
    return (isbn13(match.group(1)) if match else '') or find_isbn(page)


# ───────────────────────── An Audible page: the audiobook itself ─────────────────────────

AUDIBLE_HOST = re.compile(r'(?:^|\.)audible\.(com|co\.uk|de|fr|it|es|ca|com\.au|co\.jp|in|com\.br|nl)$')
AUDIBLE_ASIN = re.compile(r'/pd/(?:[^/]+/)?([0-9A-Z]{10})/?$')
AUDIBLE_ROLES = {'translator': 'vertaling', 'editor': 'redactie', 'foreword': 'voorwoord',
                 'introduction': 'inleiding', 'afterword': 'nawoord', 'illustrator': 'beeld'}
AUDIBLE_LANGUAGES = {'english': 'en', 'dutch': 'nl', 'german': 'de', 'french': 'fr', 'spanish': 'es', 'italian': 'it'}


def audible_asin(url):
    """(store, ASIN) of an Audible page (…/pd/Fire-Blood-Audiobook/B07CL3F5H2?…), or None.
    The store is the API's own host: each store has its own ASINs. audible.nl is the German store."""
    try:
        parts = urllib.parse.urlsplit(url)
    except ValueError:
        return None
    store = AUDIBLE_HOST.search((parts.hostname or '').lower())
    asin = AUDIBLE_ASIN.search(parts.path)
    if not (store and asin):
        return None
    return ('de' if store.group(1) == 'nl' else store.group(1)), asin.group(1)


def duration(minutes):
    """1584 → '26u 24m', 540 → '9u', 724 → '12u 4m': as publishing writes a length in the booklog."""
    hours, rest = divmod(int(minutes), 60)
    return f'{hours}u {rest}m' if hours and rest else f'{hours}u' if hours else f'{rest}m'


def lookup_audible(url):
    """The audiobook an Audible page is about, from Audible's catalogue, as the model would have
    proposed it; None if the address isn't one or the catalogue doesn't know it. Its people are
    who wrote it and who read it (stem); its cover is the square audiobook one. No ISBN: the
    ones Open Library knows are of the printed book."""
    found = audible_asin(url)
    if not found:
        return None
    store, asin = found
    product = {}
    for host in dict.fromkeys([store, 'com']):
        try:
            product = get_json(f'https://api.audible.{host}/1.0/catalog/products/{asin}?' + urllib.parse.urlencode({
                'response_groups': 'contributors,product_attrs,media,series', 'image_sizes': '1000,500'})).get('product') or {}
        except Exception:
            product = {}
        if product.get('title'):
            break
    if not product.get('title'):
        return None
    people = []
    for author in product.get('authors') or []:
        # Audible lists translators and the like among the authors: "Jan Jansen - translator".
        name, _, role = str(author.get('name') or '').partition(' - ')
        role = role.strip().lower()
        if name.strip():
            people.append({'name': name.strip(), 'role': AUDIBLE_ROLES.get(role, role) or None})
    people += [{'name': n['name'].strip(), 'role': 'stem'} for n in product.get('narrators') or [] if (n.get('name') or '').strip()]
    series = (product.get('series') or [{}])[0]
    try:
        number = float(series.get('sequence'))
    except (TypeError, ValueError):
        number = None
    year = re.match(r'(\d{4})', product.get('release_date') or '')
    images = product.get('product_images') or {}
    title = re.sub(r'\s*\([^)]*\b(?:[Ee]dition|[Ee]ditie|Ausgabe|[Uu]nabridged|[Dd]ramatized)\b[^)]*\)\s*$', '', product['title']).strip()
    proposal = {
        'title': title or product['title'], 'authors': people,
        'publisher': product.get('publisher_name') or None, 'year': int(year.group(1)) if year else None,
        'pages': None, 'duration': duration(product['runtime_length_min']) if product.get('runtime_length_min') else None,
        'series': series.get('title') or None, 'series_number': number,
        'language': AUDIBLE_LANGUAGES.get(str(product.get('language') or '').lower()),
        'categories': [], 'tags': [], 'note': '',
    }
    cover = images.get('1000') or images.get('500') or next(iter(images.values()), '')
    if cover:
        proposal['cover'] = cover
    return proposal


def lookup_isbn(isbn):
    """Open Library's edition with this ISBN, as the model would have proposed it, with what its
    national catalogue says (with_national); None if neither has it."""
    try:
        edition = get_json(f'https://openlibrary.org/isbn/{isbn}.json')
    except Exception:
        edition = {}   # the national catalogue may still know it
    olid, work = '', {}
    for entry in edition.get('works') or []:
        key = re.match(r'^/works/(OL\d+W)$', entry.get('key', ''))
        if key:
            olid = key.group(1)
            try:
                work = get_json(f'https://openlibrary.org/works/{olid}.json')
            except Exception:
                work = {}
            break
    keys = [a.get('key') for a in edition.get('authors') or []] or [a.get('author', {}).get('key') for a in work.get('authors') or []]
    authors = []
    for key in filter(None, keys):
        try:
            name = get_json(f'https://openlibrary.org{key}.json').get('name')
        except Exception:
            name = None
        if name:
            authors.append({'name': name, 'role': None})
    year = re.search(r'\b(1[5-9]\d\d|20\d\d)\b', edition.get('publish_date', '') or '')
    language = (((edition.get('languages') or [{}])[0].get('key') or '').rsplit('/', 1)[-1])
    proposal = {
        'title': edition.get('title', ''), 'authors': authors,
        'publisher': (edition.get('publishers') or [''])[0], 'year': int(year.group(0)) if year else None,
        'pages': edition.get('number_of_pages'), 'duration': None, 'series': None, 'series_number': None,
        'language': {'eng': 'en', 'dut': 'nl', 'fre': 'fr', 'ger': 'de', 'spa': 'es', 'ita': 'it'}.get(language),
        'categories': [], 'tags': [], 'note': '', 'isbn': isbn, 'olid': olid,
    }
    if edition.get('covers'):
        proposal['cover'] = f'https://covers.openlibrary.org/b/id/{edition["covers"][0]}-L.jpg'
    return with_national(proposal, isbn)


def with_national(proposal, isbn):
    """A proposal with what the ISBN's national catalogue says (national.py): its publisher, year,
    pages and language win; its title and writers only where Open Library had none."""
    from . import national
    try:
        found = national.lookup(isbn)
    except Exception:
        found = None
    if found:
        for key, theirs in (('publisher', found['publisher']), ('year', int(found['date']) if found['date'] else None),
                            ('pages', found['pages']), ('language', found['language'])):
            if theirs:
                proposal[key] = theirs
        if not proposal['title'] and found['title']:
            proposal['title'] = found['title']
        if not proposal['authors'] and found['author']:
            proposal['authors'] = [{'name': name.strip(), 'role': None} for name in found['author'].split(',') if name.strip()]
    return proposal if proposal['title'] else None


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


def classify(proposal, categories):
    """A book found exactly (by its ISBN, on Audible) gets what only the assistant gives: categories
    from the booklog's list, tags and the one dry sentence, and the language if the catalogue didn't
    say. The rest stays as the catalogue has it. Without an assistant, or when it fails, the book
    comes as it is."""
    writers = [a['name'] for a in proposal.get('authors') or [] if a.get('name') and not a.get('role')]
    series = proposal.get('series')
    number = proposal.get('series_number')
    number = int(number) if isinstance(number, float) and number.is_integer() else number
    said = '\n'.join(filter(None, [
        f'Titel: {proposal["title"]}',
        writers and 'Auteur: ' + ', '.join(writers),
        series and f'Reeks: {series}' + (f' #{number}' if number else ''),
        proposal.get('year') and f'Jaar: {proposal["year"]}',
        proposal.get('duration') and 'Audioboek',
        'Dit is precies één boek: geef één entry.']))
    try:
        answer = analyse(said, categories)
    except IntakeError:
        return proposal
    if not answer:
        return proposal
    first = answer[0]
    if first.get('known') is False:
        # The catalogue knows which book it is, but the model doesn't know what it is about: a
        # sentence or tags would be made up from the title.
        return {**proposal, 'known': False, 'categories': first.get('categories') or [],
                'language': proposal.get('language') or first.get('language')}
    return {**proposal, 'categories': first.get('categories') or [], 'tags': first.get('tags') or [],
            'note': first.get('note') or '', 'language': proposal.get('language') or first.get('language'),
            'original_language': proposal.get('original_language') or first.get('original_language'),
            'original_title': proposal.get('original_title') or first.get('original_title')}


def propose(text, booklog=None, categories=(), url='', image=None):
    """`text` (and a shared `url`, or a photographed cover) → books as the app keeps them, ready to be shown as proposals."""
    categories = set(booklog.categories if booklog else categories)
    # An Audible page or an ISBN says exactly which book and which edition; only without one is the model asked.
    known = lookup_audible(url) if url else None
    if not known:
        isbn = find_isbn(text) or (isbn_from_url(url) if url else '')
        known = lookup_isbn(isbn) if isbn else None
    if known:
        proposals = [classify(known, categories)]
    else:
        proposals = analyse('\n'.join(filter(None, [text, url])), categories, image)
        for proposal in proposals:
            enrich(proposal)
    out = []
    for proposal in proposals:
        # A book the model only read the title and author of: what it would say about it is made
        # up (and the sentence becomes the book's review), so it says nothing, and the app says so.
        unknown = proposal.get('known') is False
        if unknown:
            proposal = {**proposal, 'note': '', 'tags': []}
        writers = [a.get('name', '') for a in proposal.get('authors') or [] if a.get('name') and not a.get('role')]
        writers = writers or [a.get('name', '') for a in proposal.get('authors') or [] if a.get('name')]
        series = str(proposal.get('series') or '').strip()
        number = proposal.get('series_number')
        if isinstance(number, float) and number.is_integer():
            number = int(number)
        tags = [(booklog.tag(tag) if booklog else str(tag)) for tag in proposal.get('tags') or []]
        # Everyone who did something else (read it: stem; translated it…) is kept as the book's people.
        named = [a for a in proposal.get('authors') or [] if str(a.get('name') or '').strip()]
        people = [{'name': booklog.author(a['name']) if booklog else str(a['name']).strip(), 'role': str(a.get('role') or '').strip()}
                  for a in named] if any(a.get('role') for a in named) else []
        book = {
            'title': str(proposal.get('title') or '').strip(),
            'author': ', '.join(booklog.author(name) if booklog else name for name in writers),
            'people': people,
            'publisher': str(proposal.get('publisher') or ''),
            'date': str(proposal.get('year') or ''),
            'pages': proposal.get('pages') if isinstance(proposal.get('pages'), int) else None,
            'duration': str(proposal.get('duration') or ''),
            'format': 'audiobook' if proposal.get('duration') else '',
            'series': (booklog.series.get(plain(series), series) if booklog else series),
            'seriesNumber': number if series and isinstance(number, (int, float)) else None,
            'language': proposal['language'] if re.fullmatch(r'[a-z]{2}', str(proposal.get('language') or '')) else '',
            'categories': [c for c in proposal.get('categories') or [] if c in categories],
            'tags': list(dict.fromkeys(tag for tag in tags if tag)),
            'note': str(proposal.get('note') or '').strip(),
            'isbn': str(proposal.get('isbn') or ''),
            'olid': str(proposal.get('olid') or ''),
            'cover': str(proposal.get('cover') or ''),
            'unknown': unknown or None,
        }
        # The language it was first written in, and its title then: only from a model that knows the book.
        first = not unknown and original.found(str(proposal.get('original_language') or '').lower(), proposal.get('original_title'), [book['title']])
        if first:
            book['originalLanguage'] = first['language']
            book['originalTitle'] = first['title']
        if book['title']:
            out.append({k: v for k, v in book.items() if v not in ('', None, [])})
    return out
