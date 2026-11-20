"""National catalogues, as national.js has them in the app: an ISBN's registration group says which
national bibliography to ask beside Open Library. 978-90 and 978-94 the Dutch KB (a SPARQL endpoint
over the Nederlandse Bibliografie), 978-2 and 979-10 the French BnF (SRU in UNIMARC). For its own
group the national record wins on publisher, year, pages and language; title and writers are taken
only where nothing else says them (the national catalogues write names in full). Series are not read.

The KB answers 50 ISBNs in one request (kb_many), which the backfill uses (fill_from_national).
"""
import json
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

AGENT = {'User-Agent': 'Folio/2 (national catalogues)'}
KB_ENDPOINT = 'https://data.bibliotheken.nl/sparql'
MARC = {'eng': 'en', 'dut': 'nl', 'nld': 'nl', 'fre': 'fr', 'fra': 'fr', 'ger': 'de', 'deu': 'de', 'spa': 'es', 'ita': 'it',
        'por': 'pt', 'swe': 'sv', 'dan': 'da', 'nor': 'no', 'fin': 'fi', 'pol': 'pl', 'rus': 'ru', 'lat': 'la', 'gre': 'el',
        'jpn': 'ja', 'chi': 'zh', 'afr': 'af', 'fry': 'fy'}
NAMES = {'kb': 'KB', 'bnf': 'BnF'}


def national_for(isbn):
    """'kb', 'bnf' or '' for an ISBN-13."""
    s = str(isbn or '')
    if re.fullmatch(r'978(90|94)\d{8}', s):
        return 'kb'
    if re.fullmatch(r'9782\d{9}', s) or re.fullmatch(r'97910\d{8}', s):
        return 'bnf'
    return ''


def isbn10(isbn13):
    if not re.fullmatch(r'978\d{10}', isbn13 or ''):
        return ''
    core = isbn13[3:12]
    check = (11 - sum(int(d) * (10 - i) for i, d in enumerate(core)) % 11) % 11
    return core + ('X' if check == 10 else str(check))


def language(code):
    c = str(code or '').lower()
    return c if re.fullmatch(r'[a-z]{2}', c) else MARC.get(c, '')


def year_in(text):
    m = re.search(r'\b(1[5-9]\d\d|20\d\d)\b', str(text or ''))
    return m.group(1) if m else ''


def clean(text):
    return re.sub(r'^[\s\[(]+|[\s\])/:;,.]+$', '', re.sub(r'\s+', ' ', str(text or ''))).strip()


def fetch(url, accept=None, timeout=10):
    headers = dict(AGENT, **({'Accept': accept} if accept else {}))
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout) as res:
        return res.read().decode('utf-8')


# ── KB ──

KB_QUERY = """PREFIX schema: <http://schema.org/>
SELECT ?isbn ?name ?pages ?lang ?publisher ?year ?author WHERE {
  VALUES ?isbn { %s }
  ?b schema:isbn ?isbn .
  OPTIONAL { ?b schema:name ?name }
  OPTIONAL { ?b schema:numberOfPages ?pages }
  OPTIONAL { ?b schema:inLanguage ?lang }
  OPTIONAL { ?b schema:publication ?p . OPTIONAL { ?p schema:startDate ?year } OPTIONAL { ?p schema:publishedBy ?by . ?by schema:name ?publisher } }
  OPTIONAL { ?b schema:author ?a . ?a schema:name ?author }
}"""


def from_kb_rows(rows):
    """Rows of one ISBN from the KB's SPARQL answer → {title, author, publisher, date, pages, language}, or None."""
    if not rows:
        return None
    first = lambda key: next((r[key] for r in rows if r.get(key)), '')
    authors = list(dict.fromkeys(clean(r['author']) for r in rows if r.get('author')))
    try:
        pages = int(first('pages'))
    except ValueError:
        pages = 0
    return {'title': clean(first('name')), 'author': ', '.join(authors), 'publisher': clean(first('publisher')),
            'date': year_in(first('year')), 'pages': pages or None, 'language': language(first('lang'))}


def kb_many(isbns):
    """{isbn13: book} for those of these ISBN-13s the KB knows: one request (both forms of each)."""
    forms = {}
    for isbn in isbns:
        forms[isbn] = isbn
        if isbn10(isbn):
            forms[isbn10(isbn)] = isbn
    values = ' '.join(f'"{v}"' for v in forms)
    url = KB_ENDPOINT + '?' + urllib.parse.urlencode({'query': KB_QUERY % values})
    data = json.loads(fetch(url, 'application/sparql-results+json', timeout=30))
    rows = {}
    for b in data.get('results', {}).get('bindings', []):
        row = {k: v.get('value') for k, v in b.items()}
        rows.setdefault(forms.get(row.get('isbn')), []).append(row)
    return {isbn: book for isbn, found in rows.items() if isbn and (book := from_kb_rows(found))}


# ── BnF ──

def bnf_url(isbn):
    query = urllib.parse.quote(f'bib.isbn adj "{isbn}"')
    return f'https://catalogue.bnf.fr/api/SRU?version=1.2&operation=searchRetrieve&query={query}&recordSchema=unimarcxchange&maximumRecords=1'


def from_bnf(xml):
    """The BnF's SRU answer → a book, or None."""
    root = ET.fromstring(xml)
    local = lambda el: el.tag.rsplit('}', 1)[-1]
    if not any(local(el) == 'numberOfRecords' and (el.text or '0').strip() not in ('', '0') for el in root.iter()):
        return None
    record = next((el for el in root.iter() if local(el) == 'record' and any(local(c) == 'datafield' for c in el.iter())), None)
    if record is None:
        return None
    fields = {}
    for df in (el for el in record.iter() if local(el) == 'datafield'):
        subs = {}
        for sf in (el for el in df if local(el) == 'subfield'):
            subs.setdefault(sf.get('code'), []).append(sf.text or '')
        fields.setdefault(df.get('tag'), []).append(subs)
    one = lambda tag, code: next((x[code][0] for x in fields.get(tag, []) if x.get(code)), '')
    title = (fields.get('200') or [{}])[0]
    main = ': '.join(clean(v) for v in (title.get('a', [''])[0], title.get('e', [''])[0]) if v)
    part = ', '.join(clean(v) for v in (title.get('h', [''])[0], title.get('i', [''])[0]) if v)
    authors = [' '.join(clean(v) for v in (x.get('b', [''])[0], x.get('a', [''])[0]) if v) for x in [*fields.get('700', []), *fields.get('701', [])]]
    m = re.search(r'(\d+)\s*p\b', one('215', 'a'))
    return {'title': '. '.join(v for v in (main, part) if v), 'author': ', '.join(dict.fromkeys(a for a in authors if a)),
            'publisher': clean(one('210', 'c') or one('214', 'c')), 'date': year_in(one('210', 'd') or one('214', 'd')),
            'pages': int(m.group(1)) if m else None, 'language': language(one('101', 'a'))}


def lookup(isbn):
    """The national record of one ISBN: a book, None when it has none, or an exception when it didn't answer."""
    which = national_for(isbn)
    if which == 'kb':
        return kb_many([isbn]).get(isbn)
    if which == 'bnf':
        return from_bnf(fetch(bnf_url(isbn)))
    return None
