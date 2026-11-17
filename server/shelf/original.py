"""The language a book was first written in, and its title in that language (`originalLanguage`,
`originalTitle` on a book: the work's, not an edition's).

Where they come from, most trusted first:
  1. Wikidata, by the book's Open Library work id (P648): the language of the work (P407) and its
     title (P1476) in that language. Known for about four in ten works on the shelf.
  2. Open Library's record of an edition, when it says it is a translation (`translated_from`,
     `translation_of`). Rarely filled in.
  3. The assistant, from the title, the writers and the edition's language. Only with an account
     and an OpenAI key; it is told to say nothing rather than guess.

The app asks Wikidata and Open Library itself when a book is added (that works without an
account) and the assistant through /api/original; `manage.py fill_original` does all three for
books already on the shelf.
"""
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings

from . import intake

AGENT = {'User-Agent': 'Folio/2 (original language of a book)', 'Accept': 'application/sparql-results+json'}
OLID = re.compile(r'OL\d+W')
CODE = re.compile(r'[a-z]{2,3}')   # ISO 639-1, or 639-2 for a language without (grc: Ancient Greek)
# Open Library names a language by its MARC code; the shelf by two letters.
MARC = {'eng': 'en', 'dut': 'nl', 'fre': 'fr', 'ger': 'de', 'spa': 'es', 'ita': 'it', 'por': 'pt', 'swe': 'sv', 'dan': 'da',
        'nor': 'no', 'fin': 'fi', 'pol': 'pl', 'rus': 'ru', 'lat': 'la', 'gre': 'el', 'grc': 'el', 'jpn': 'ja', 'chi': 'zh',
        'afr': 'af', 'fry': 'fy', 'ara': 'ar', 'heb': 'he', 'kor': 'ko', 'cze': 'cs', 'hun': 'hu', 'tur': 'tr', 'ice': 'is',
        'rum': 'ro', 'ukr': 'uk', 'baq': 'eu', 'cat': 'ca', 'per': 'fa'}


def get_json(url, timeout=30, tries=6):
    """A JSON answer; told to slow down (429, as Wikidata's query service is when it is busy), it waits as long as it is asked and tries again."""
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=AGENT), timeout=timeout) as res:
                return json.loads(res.read().decode('utf-8'))
        except urllib.error.HTTPError as err:
            if err.code not in (429, 503) or attempt == tries - 1:
                raise
            wait = err.headers.get('Retry-After') or ''
            time.sleep(min(int(wait) if wait.isdigit() else 61, 300))


def same_title(a, b):
    return intake.plain(a) == intake.plain(b)


def found(language, title='', known_as=()):
    """{'language', 'title'}: the title only when it isn't one the book is already known by."""
    language = language if CODE.fullmatch(str(language or '')) else ''
    title = ' '.join(str(title or '').split())[:300]
    if not language:
        return None
    if not title or any(same_title(title, other) for other in known_as if other):
        title = ''
    return {'language': language, 'title': title}


def from_wikidata(olids, pause=0.2):
    """Open Library work ids → {olid: {'language', 'title'}} for those Wikidata knows the language of.
    Its query service answers for two hundred at a time; while it is down or rate-limited (as it
    was in November 2026), Wikidata's own API is asked instead, one work at a time."""
    olids = sorted({o for o in olids if OLID.fullmatch(str(o or ''))})
    try:
        return by_query(olids)
    except (urllib.error.URLError, OSError, ValueError, KeyError):
        return by_api(olids, pause)


API = 'https://www.wikidata.org/w/api.php?format=json'
# Wikidata's languages by their item; any other is asked once (its ISO 639-1 code, else 639-2).
LANGUAGE_ITEMS = {'Q1860': 'en', 'Q150': 'fr', 'Q7411': 'nl', 'Q188': 'de', 'Q1321': 'es', 'Q652': 'it', 'Q5146': 'pt',
                  'Q5287': 'ja', 'Q7737': 'ru', 'Q7850': 'zh', 'Q9176': 'ko', 'Q13955': 'ar', 'Q9288': 'he', 'Q9027': 'sv',
                  'Q9035': 'da', 'Q25167': 'no', 'Q9043': 'no', 'Q1412': 'fi', 'Q809': 'pl', 'Q9056': 'cs', 'Q9067': 'hu',
                  'Q256': 'tr', 'Q36510': 'grc', 'Q397': 'la', 'Q8798': 'uk', 'Q8752': 'eu', 'Q7026': 'ca', 'Q9168': 'fa'}


def claim(claims, prop):
    return [((c.get('mainsnak') or {}).get('datavalue') or {}).get('value') for c in claims.get(prop) or []]


def language_code(qid):
    if qid not in LANGUAGE_ITEMS:
        claims = get_json(f'{API}&action=wbgetentities&props=claims&ids={qid}')['entities'][qid].get('claims') or {}
        code = next((v for v in claim(claims, 'P218') + claim(claims, 'P219') if isinstance(v, str) and CODE.fullmatch(v)), '')
        LANGUAGE_ITEMS[qid] = code
    return LANGUAGE_ITEMS[qid]


def by_api(olids, pause=0.2):
    out = {}
    for olid in olids:
        try:
            hits = get_json(f'{API}&action=query&list=search&srlimit=3&srsearch='
                            + urllib.parse.quote(f'haswbstatement:P648={olid}'))['query']['search']
            if hits:
                ids = '|'.join(h['title'] for h in hits)
                entities = get_json(f'{API}&action=wbgetentities&props=claims&ids={ids}')['entities']
                for h in hits:
                    claims = entities.get(h['title'], {}).get('claims') or {}
                    item = next((v.get('id') for v in claim(claims, 'P407') if isinstance(v, dict)), '')
                    code = item and language_code(item)
                    if code:
                        title = next((v['text'] for v in claim(claims, 'P1476')
                                      if isinstance(v, dict) and str(v.get('language', '')).split('-')[0] == code), '')
                        out[olid] = {'language': code, 'title': title}
                        break
        except (urllib.error.URLError, OSError, ValueError, KeyError):
            pass
        time.sleep(pause)
    return out


def by_query(olids):
    out = {}
    for i in range(0, len(olids), 200):
        query = ('SELECT ?ol ?code ?title WHERE { VALUES ?ol { %s } ?item wdt:P648 ?ol . '
                 'OPTIONAL { ?item wdt:P407 ?l . OPTIONAL { ?l wdt:P218 ?two } OPTIONAL { ?l wdt:P219 ?three } BIND(COALESCE(?two, ?three) AS ?code) } '
                 'OPTIONAL { ?item wdt:P1476 ?title } }'
                 % ' '.join(f'"{o}"' for o in olids[i:i + 200]))
        rows = get_json('https://query.wikidata.org/sparql?format=json&query=' + urllib.parse.quote(query), 60, tries=2)['results']['bindings']
        seen = {}
        for row in rows:
            entry = seen.setdefault(row['ol']['value'], {'codes': [], 'titles': []})
            if 'code' in row and row['code']['value'] not in entry['codes']:
                entry['codes'].append(row['code']['value'])
            if 'title' in row:
                entry['titles'].append((row['title'].get('xml:lang', ''), row['title']['value']))
        for olid, entry in seen.items():
            if not entry['codes']:
                continue
            code = entry['codes'][0]
            title = next((text for tag, text in entry['titles'] if tag.split('-')[0] == code), '')
            out[olid] = {'language': code, 'title': title}
    return out


def from_open_library(isbn):
    """An edition's ISBN → (its work's Open Library id, {'language', 'title'} when the edition says it is a translation)."""
    try:
        edition = get_json(f'https://openlibrary.org/isbn/{isbn}.json', 15)
    except (urllib.error.URLError, OSError, ValueError):
        return '', None
    work = str(((edition.get('works') or [{}])[0] or {}).get('key') or '').rsplit('/', 1)[-1]
    source = str(((edition.get('translated_from') or [{}])[0] or {}).get('key') or '').rsplit('/', 1)[-1]
    said = {'language': MARC[source], 'title': str(edition.get('translation_of') or '')} if source in MARC else None
    return (work if OLID.fullmatch(work) else ''), said


# ───────────────────────── The assistant ─────────────────────────

SCHEMA = {
    'type': 'object', 'additionalProperties': False, 'required': ['books'],
    'properties': {'books': {'type': 'array', 'items': {
        'type': 'object', 'additionalProperties': False, 'required': ['id', 'original_language', 'original_title'],
        'properties': {
            'id': {'type': 'string'},
            'original_language': {'type': ['string', 'null'], 'description': 'ISO 639-1 code of the language the work was first written in; null if you do not know the book'},
            'original_title': {'type': ['string', 'null'], 'description': 'its title in that language, in that script; null if unknown'},
        }}}},
}
PROMPT = ('For each book, say in which language the work was first written (ISO 639-1: en, fr, ja, ru…) and its title in '
          'that language, in its own script. The edition named may be a translation: a Murakami read in English was '
          'written in Japanese. A comic, a manga or a bande dessinée counts as written in the language of its first '
          'publication. If you do not know the book itself, answer null for both: never guess from the title alone.')


def ask(books):
    """[{'id', 'title', 'author', 'language'}] → {id: {'language', 'title'}} for the books the model knows."""
    if not settings.OPENAI_API_KEY:
        raise intake.NotSetUp('The assistant is not set up on this server.')
    said = '\n'.join(f"{b['id']}: {b['title']}" + (f" — {b['author']}" if b.get('author') else '')
                     + (f" (edition in: {b['language']})" if b.get('language') else '') for b in books)
    question = {
        'model': settings.OPENAI_MODEL,
        'messages': [{'role': 'system', 'content': PROMPT}, {'role': 'user', 'content': said}],
        'response_format': {'type': 'json_schema', 'json_schema': {'name': 'books', 'strict': True, 'schema': SCHEMA}},
    }
    try:
        answer = intake.post_json('https://api.openai.com/v1/chat/completions', question,
                                  {'Authorization': f'Bearer {settings.OPENAI_API_KEY}'})
        got = json.loads(answer['choices'][0]['message']['content'])['books']
    except urllib.error.HTTPError as err:
        raise intake.IntakeError(f'The assistant answered with an error ({err.code}).')
    except (urllib.error.URLError, OSError) as err:
        raise intake.IntakeError(f'The assistant could not be reached: {err}')
    except (ValueError, KeyError, IndexError, TypeError) as err:
        raise intake.IntakeError(f'The assistant gave an answer that could not be read: {err}')
    asked = {b['id']: b for b in books}
    out = {}
    for row in got if isinstance(got, list) else []:
        book = asked.get(str(row.get('id')))
        result = book and found(str(row.get('original_language') or '').lower(), row.get('original_title'), [book['title']])
        if result:
            out[book['id']] = result
    return out
