"""Reads the booklog at boeken.tsuk.org (the mvuijlst/boeken repository) as Folio books.

The booklog keeps one Markdown file per *read* of a book in site/content/posts/, with the
facts in YAML front matter. A reread is a post of its own that names the first read in
`rereadOf`; together they are one book here. `status` says which shelf the post is on, and
becomes one of Folio's reading lists.
"""
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import yaml

SITE = 'https://boeken.tsuk.org'
BRUSSELS = ZoneInfo('Europe/Brussels')

# status in the booklog → id of the list here ("read" is what a post without status is)
STATUS_LISTS = {'read': 'read', 'reading': 'reading', 'to-read': 'to-read', 'abandoned': 'abandoned'}
# People with one of these roles (or none) wrote the book; anyone else contributed to it.
AUTHOR_ROLES = {'auteur', 'auteurs', 'author', 'schrijver', 'tekst', 'writer'}
# What the import owns in a book (the work): on every run these are set from the booklog, or
# removed. What it owns in an edition is EDITION (below), with the cover's proportions and source.
FIELDS = ['title', 'author', 'rating', 'series', 'seriesNumber', 'seriesLabel', 'olid', 'durationLeft', 'issues', 'pagesRead',
          'categories', 'tags', 'boeken', 'url', 'reviewed', 'reads']
# The reads of a book also become its reviews (`reviews` in a book), which the app can add to
# and edit; see review_sum for how the import tells its own text from an edited one. Each read
# is of an edition of the book (`ed` in a review: see shelf/works.py).

FRONT_MATTER = re.compile(r'^---\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n(.*))?$', re.S)


def fold(text):
    """For comparing names and titles: no case, no accents, no punctuation."""
    import unicodedata
    plain = ''.join(c for c in unicodedata.normalize('NFKD', str(text or '')) if not unicodedata.combining(c))
    return ' '.join(re.findall(r'[a-z0-9]+', plain.lower()))


def stamp(value):
    """A date from front matter as the app writes timestamps: UTC, to the millisecond."""
    if not isinstance(value, datetime):
        value = datetime(value.year, value.month, value.day, 12)
    if value.tzinfo is None:
        value = value.replace(tzinfo=BRUSSELS)
    return value.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')


def uid_for(slug):
    uid = f'boeken-{slug}'
    if len(uid) <= 64:
        return uid
    return f'boeken-{slug[:40]}-{hashlib.sha1(slug.encode()).hexdigest()[:12]}'


SHORTCODE = re.compile(r'\{\{[<%]\s*(/?\w+)([^>%]*?)[>%]\}\}')


def review_text(body):
    """A post's body as plain Markdown: Hugo shortcodes and site-relative addresses resolved."""
    def shortcode(match):
        name, rest = match.group(1), match.group(2)
        args = dict(re.findall(r'(\w+)="([^"]*)"', rest))
        if name == 'bookimg' and args.get('src', '').startswith('uploads/'):
            return f'![{args.get("alt", "")}]({SITE}/wp-content/{args["src"]})'
        if name == 'youtube':
            video = args.get('id') or rest.strip().strip('"')
            return f'[YouTube]({"https://www.youtube.com/watch?v=" + video})' if video else ''
        return match.group(0)   # one the app has no words for: kept as it is, so nothing is lost on the way back
    text = SHORTCODE.sub(shortcode, body.replace('\r\n', '\n').replace('\r', '\n'))
    text = re.sub(r'\]\((/[^)\s]*)', lambda m: f']({SITE}{m.group(1)}', text)   # [link](/2020/01/slug/)
    return re.sub(r'\n{3,}', '\n\n', text).strip()


def site_links(body):
    """The addresses a post's body gives without the site in front ("/2020/01/slug/")."""
    return set(re.findall(r'\]\((/[^)\s]*)', body or ''))


def body_text(text, relative=()):
    """A review as the booklog writes a post's body: review_text the other way round.

    `relative` are the addresses the post gave without the site in front; those are written
    that way again, and every other link stays exactly as it is in the review.
    """
    def image(match):
        alt, src = match.group(1), match.group(2)
        return '{{< bookimg src="uploads/' + src + '"' + (f' alt="{alt}"' if alt else '') + ' >}}'
    site = re.escape(SITE)
    text = re.sub(r'!\[([^\]]*)\]\(' + site + r'/wp-content/uploads/([^)\s]+)\)', image, str(text or ''))
    text = re.sub(r'\[YouTube\]\(https://www\.youtube\.com/watch\?v=([\w-]+)\)', r'{{< youtube \1 >}}', text)
    text = re.sub(r'\]\(' + site + r'(/[^)\s]*)', lambda m: f']({m.group(1)}' if m.group(1) in relative else m.group(0), text)
    return re.sub(r'\n{3,}', '\n\n', text.replace('\r\n', '\n').replace('\r', '\n')).strip()


# What of a book can be changed in the app and is then published to the booklog (shelf/publish.py).
PUBLISHED = ('title', 'publisher', 'date', 'pages', 'isbn', 'series', 'seriesNumber', 'seriesLabel',
             'pagesRead', 'durationLeft', 'cover', 'people', 'format', 'duration', 'language', 'categories', 'tags')
# What is published grew over time. A book's `boekenState` says under 'tracks' how far it
# goes, and is only compared that far: a fact that wasn't tracked when the state was written
# (a length the book already had) is not a change made in the app.
TRACKED = {1: PUBLISHED[:12], 2: PUBLISHED[:14], 3: PUBLISHED}
TRACKS = 3

# What a read was read as. A post says so under `format`; one that doesn't is an audiobook if
# it has a length, and otherwise it isn't said. (The booklog's audiobook and kindle categories
# said this before `format` did; they were retired once the posts said it themselves.)
FORMATS = ('paper', 'ebook', 'audiobook')


def format_of(post):
    said = str(post.get('format') or '').strip().lower()
    if said in FORMATS:
        return said
    return 'audiobook' if post.get('duration') else ''


# The people of a book: who wrote it, and who drew, coloured, lettered, translated or read it.
# In the booklog a post lists them all under `authors` (their slugs) and says under `roles`
# what each did, where that is worth saying. Here they are `people`: [{'name', 'role'}], in
# the same order, the role '' for someone who simply wrote it. Each edition of a book has its
# own (the audiobook has a voice, the paperback not); the book itself names its writers (`author`).

def tidy_people(people):
    """`people` as it is compared and published: names and roles as plain text, no one twice or nameless."""
    out, seen = [], set()
    for person in people if isinstance(people, list) else []:
        name = ' '.join(str((person or {}).get('name') or '').split()) if isinstance(person, dict) else ''
        if name and fold(name) not in seen:
            seen.add(fold(name))
            out.append({'name': name, 'role': ' '.join(str(person.get('role') or '').split())})
    return out


def people_of(slugs, roles, names):
    """The `authors` and `roles` of a post, as people."""
    roles = roles if isinstance(roles, dict) else {}
    return [{'name': names.get(str(slug), str(slug)), 'role': str(roles.get(slug) or '').strip()} for slug in slugs or []]


def state_of(book):
    """Those facts of a book, and the reading list it is on. Kept in the book as `boekenState`
    whenever the app and the booklog agree; a difference later on is a change made in the app."""
    state = {key: book[key] for key in PUBLISHED if book.get(key) not in (None, '', [])}
    state.pop('people', None)
    if tidy_people(book.get('people')):
        state['people'] = tidy_people(book['people'])
    state['tracks'] = TRACKS
    state['list'] = next((name for name in STATUS_LISTS.values() if name in (book.get('lists') or {})), None)
    return state


# A read is of an edition: the paperback the first time, the audiobook the next. Each review
# carries the edition that was read in `edition` (in the flat view, shelf/works.py), with these
# facts (and `coverRatio`). `title` only for an edition titled otherwise than the book (a
# translation): its posts carry that title.
EDITION = ('publisher', 'date', 'pages', 'duration', 'isbn', 'language', 'cover', 'people', 'format', 'title')
# What a review's fingerprint covered, by its version: editions came to say more over time.
EDITION_AT = {2: EDITION[:7], 3: EDITION[:8], 4: EDITION[:9], 5: EDITION}
SUM_VERSION = 4   # 5 for a read of an edition with a title of its own: other fingerprints stay as they were


def edition_of(post, names=None):
    """The edition a post says was read, as a review keeps it. `names`: author slug → name;
    with it the edition also says who made it."""
    year = post.get('year')
    cover = str(post.get('cover') or '')
    edition = {
        'publisher': str(post.get('publisher') or ''),
        'date': f'{year}–{post["year_until"]}' if year and post.get('year_until') else str(year or ''),
        'pages': post.get('pages') if isinstance(post.get('pages'), int) else None,
        'duration': str(post.get('duration') or ''),
        'isbn': str(post.get('isbn') or ''),
        'language': str(post.get('language') or ''),
        'cover': SITE + cover if cover.startswith('/') else '',
    }
    if names is not None:
        edition['people'] = people_of(post.get('authors'), post.get('roles'), names)
        edition['format'] = format_of(post)
    return {key: value for key, value in edition.items() if value not in ('', None, [])}


def review_sum(review, version=None):
    """Fingerprint of a review as the import (or the last publish) left it. A review that no
    longer matches its `sum` was edited in the app: the import leaves it alone, and it is
    published. Covers the reading date, the rating, the text and the edition read, as far as
    editions went at that version (EDITION_AT)."""
    edition = dict(review.get('edition') or {})
    if version is None:
        version = 5 if edition.get('title') else SUM_VERSION
    if 'people' in edition:
        edition['people'] = tidy_people(edition['people'])
    keys = EDITION_AT[version]
    told = json.dumps([review.get('date') or '', review.get('rating'), review.get('text') or '',
                       {key: edition[key] for key in keys if edition.get(key) not in ('', None, [])}],
                      ensure_ascii=False, sort_keys=True)
    return f'{version}:' + hashlib.sha1(told.encode()).hexdigest()[:12]


def in_step(review):
    """Is the review as its `sum` says it was left? (Older sums cover less: before reviews had
    editions the date, rating and text only; then the edition without its people.)"""
    left = str(review.get('sum') or '')
    version = int(left[0]) if left[:2] in ('2:', '3:', '4:', '5:') else 1
    edition = review.get('edition') or {}
    # (A fingerprint from before editions can't tell: every read has an edition now, the book's own.)
    if version > 1 and any(key in edition for key in EDITION if key not in EDITION_AT.get(version, EDITION_AT[2])):
        return False   # something the fingerprint knows nothing of was said in the app since
    if version > 1:
        return review_sum(review, version=version) == left
    told = json.dumps([review.get('date') or '', review.get('rating'), review.get('text') or ''], ensure_ascii=False)
    return hashlib.sha1(told.encode()).hexdigest()[:12] == review.get('sum')


def read_posts(repo):
    """Every post as a dict of its front matter, plus `_url`, `_when`, `_day` and `_text`
    (and the file itself: `_path`, `_file`, its front matter `_raw` and its body `_body`)."""
    posts = []
    for path in sorted(Path(repo, 'site', 'content', 'posts').glob('*.md')):
        with open(path, encoding='utf-8', newline='') as file:   # as it is on disk, line endings included
            content = file.read()
        match = FRONT_MATTER.match(content)
        if not match:
            continue
        raw = match.group(1)
        post = yaml.safe_load(raw) or {}
        if not post.get('title') or not post.get('date') or post.get('draft'):
            continue
        post.setdefault('slug', path.stem)
        post.update(_path=path, _file=content, _raw=raw, _body=match.group(2) or '')
        # The public address is /year/month/slug/, with year and month as written in the file.
        written = re.search(r'^date:\s*["\']?(\d{4})-(\d{2})', raw, re.M)
        year, month = written.groups() if written else (f'{post["date"].year:04}', f'{post["date"].month:02}')
        post['_url'] = f'{SITE}/{year}/{month}/{post["slug"]}/'
        post['_when'] = stamp(post['date'])
        day = re.search(r'^date:\s*["\']?(\d{4}-\d{2}-\d{2})', raw, re.M)
        post['_day'] = day.group(1) if day else post['_when'][:10]   # the day as written, whatever the time zone
        post['_text'] = review_text(match.group(2) or '')
        posts.append(post)
    return posts


def author_names(repo):
    """Author slug → name as the booklog shows it."""
    names = {}
    for path in Path(repo, 'site', 'content', 'authors').glob('*/_index.md'):
        match = FRONT_MATTER.match(path.read_text(encoding='utf-8'))
        term = (yaml.safe_load(match.group(1)) if match else None) or {}
        if term.get('title'):
            names[path.parent.name] = str(term['title'])
    return names


def term_titles(repo, kind):
    """Slug → title of the booklog's pages of `kind` ('categories', 'tags', 'series'): how it names them."""
    titles = {}
    for path in Path(repo, 'site', 'content', kind).glob('*/_index.md'):
        match = FRONT_MATTER.match(path.read_text(encoding='utf-8'))
        term = (yaml.safe_load(match.group(1)) if match else None) or {}
        titles[path.parent.name] = str(term.get('title') or path.parent.name)
    return titles


def books(repo):
    """The booklog as Folio books, one per `rereadOf` group, oldest first: [{'key', 'list', 'at',
    'added', 'isbns', 'titles', 'open', 'posts', 'fields'}].

    `fields` holds the work's FIELDS that have a value; `list` is the reading list the book is
    on and `at` since when (both taken from the latest read). `posts` are the group's posts,
    oldest first, each as {'slug', 'edition', 'cover_file', 'review'}: the edition it says was
    read (its own facts, no gaps filled from other posts), the original of its cover when the
    repository has it, and its review (None for a post with neither a reading date nor a text).
    `open` is the post of a read that is planned or running (the latest, when its status is
    to-read or reading), or None. `titles` are the titles the posts have.
    """
    names = author_names(repo)
    groups = {}
    for post in read_posts(repo):
        groups.setdefault(str(post.get('rereadOf') or post['slug']), []).append(post)

    out = []
    for key, reads in groups.items():
        reads.sort(key=lambda p: p['_when'])
        latest = reads[-1]

        def fact(name):
            """From the latest read that states it: a reread need not repeat what the first read said."""
            return next((p[name] for p in reversed(reads) if p.get(name) not in (None, '', [], {})), None)

        roles = {slug: str(role).strip().lower() for slug, role in (fact('roles') or {}).items()}
        slugs = [str(s) for s in fact('authors') or []]
        writers = [s for s in slugs if roles.get(s, 'auteur') in AUTHOR_ROLES] or slugs
        rated = [p for p in reads if isinstance(p.get('rating'), int)]
        series = fact('series') or []
        number = fact('series_number')
        if isinstance(number, bool) or not isinstance(number, (int, float)):
            number = None
        elif float(number).is_integer():
            number = int(number)
        status = str(latest.get('status') or 'read')
        fields = {
            'title': str(reads[0]['title']),   # the import keeps the one the app has while any read has it
            'author': ', '.join(names.get(s, s) for s in writers),
            'rating': rated[-1]['rating'] if rated else None,
            'series': str(series[0]) if series else '',
            # Where the book stands in its series: the number sorts (4.5 comes between 4 and 5),
            # the label, if any, is what is shown instead ("4/5" for an omnibus).
            'seriesNumber': number,
            'seriesLabel': str(fact('series_number_label') or ''),
            'olid': str(fact('olid') or ''),
            'durationLeft': str(latest.get('durationLeft') or ''),
            'issues': fact('issues'),
            'pagesRead': latest.get('pagesRead'),
            'categories': [str(c) for c in fact('categories') or []],
            'tags': [str(tag) for tag in fact('tags') or []],
            'boeken': key,
            'url': latest['_url'],
        }
        # One review per read: when it was read, the rating, and what was written about it. A
        # book not read yet has no reading date, and only an entry if something was written.
        posts = []
        for post in reads:
            said = str(post.get('status') or 'read')
            was_read = said in ('read', 'abandoned')
            review = {
                'id': uid_for(post['slug']),
                'date': post['_day'] if was_read else '',
                'rating': post['rating'] if isinstance(post.get('rating'), int) else None,
                'text': post['_text'],
                'boeken': str(post['slug']),
                'url': post['_url'],
            }
            if said == 'abandoned':
                review['dnf'] = True
            own = str(post.get('cover') or '')
            picture = Path(repo, 'media', own.lstrip('/')) if own.startswith('/') else None
            posts.append({
                'slug': str(post['slug']),
                'title': str(post['title']),
                'edition': edition_of(post, names),   # what was read that time: its own publisher, length, cover, people
                'cover_file': picture if picture and picture.is_file() else None,
                'review': review if was_read or review['text'] else None,
            })
        out.append({
            'key': key,
            'list': STATUS_LISTS.get(status, 'read'),
            'at': latest['_when'],
            'added': reads[0]['_when'],
            'isbns': {str(p['isbn']) for p in reads if p.get('isbn')},
            'titles': {str(p['title']) for p in reads},
            'open': str(latest['slug']) if status in ('to-read', 'reading') else None,
            'posts': posts,
            'fields': {k: v for k, v in fields.items() if v not in ('', None, [])},
        })
    out.sort(key=lambda b: b['added'])
    return out
