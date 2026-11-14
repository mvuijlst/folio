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
# What the import owns in a book: on every run these are set from the booklog, or removed.
FIELDS = ['title', 'author', 'publisher', 'date', 'pages', 'isbn', 'cover', 'coverRatio', 'coverSource', 'rating',
          'series', 'seriesNumber', 'language', 'olid', 'duration', 'durationLeft', 'issues', 'pagesRead',
          'categories', 'tags', 'boeken', 'url', 'reviewed', 'reads']
# The reads of a book also become its reviews (`reviews` in a book), which the app can add to
# and edit; see review_sum for how the import tells its own text from an edited one.

FRONT_MATTER = re.compile(r'^---\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n(.*))?$', re.S)


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
        return ''
    text = SHORTCODE.sub(shortcode, body)
    text = re.sub(r'\]\((/[^)\s]*)', lambda m: f']({SITE}{m.group(1)}', text)   # [link](/2020/01/slug/)
    return re.sub(r'\n{3,}', '\n\n', text).strip()


def review_sum(review):
    """Fingerprint of a review as the import wrote it. A review whose text, date or rating no
    longer matches its `sum` was edited in the app, and the import leaves it alone."""
    told = json.dumps([review.get('date') or '', review.get('rating'), review.get('text') or ''], ensure_ascii=False)
    return hashlib.sha1(told.encode()).hexdigest()[:12]


def read_posts(repo):
    """Every post as a dict of its front matter, plus `_url`, `_when`, `_day` and `_text`."""
    posts = []
    for path in sorted(Path(repo, 'site', 'content', 'posts').glob('*.md')):
        match = FRONT_MATTER.match(path.read_text(encoding='utf-8'))
        if not match:
            continue
        raw = match.group(1)
        post = yaml.safe_load(raw) or {}
        if not post.get('title') or not post.get('date') or post.get('draft'):
            continue
        post.setdefault('slug', path.stem)
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


def books(repo):
    """The booklog as Folio books: [{'key', 'list', 'at', 'added', 'isbns', 'cover_file', 'reviews', 'fields'}], oldest first.

    `fields` holds the FIELDS that have a value; `list` is the reading list the book is on
    and `at` since when (both taken from the latest read).
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
        number = fact('series_number_label') or fact('series_number')
        year = fact('year')
        cover = str(fact('cover') or '')
        cover_file = Path(repo, 'media', cover.lstrip('/')) if cover.startswith('/') else None
        fields = {
            'title': str(latest['title']),
            'author': ', '.join(names.get(s, s) for s in writers),
            'publisher': str(fact('publisher') or ''),
            'date': f'{year}–{fact("year_until")}' if year and fact('year_until') else str(year or ''),
            'pages': fact('pages') if isinstance(fact('pages'), int) else None,
            'isbn': str(fact('isbn') or ''),
            'cover': SITE + cover if cover.startswith('/') else '',
            'rating': rated[-1]['rating'] if rated else None,
            'series': str(series[0]) if series else '',
            'seriesNumber': '' if number is None else f'{number:g}' if isinstance(number, float) else str(number),
            'language': str(fact('language') or ''),
            'olid': str(fact('olid') or ''),
            'duration': str(fact('duration') or ''),
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
        reviews = []
        for post in reads:
            was_read = str(post.get('status') or 'read') in ('read', 'abandoned')
            review = {
                'id': uid_for(post['slug']),
                'date': post['_day'] if was_read else '',
                'rating': post['rating'] if isinstance(post.get('rating'), int) else None,
                'text': post['_text'],
                'boeken': str(post['slug']),
                'url': post['_url'],
            }
            if was_read or review['text']:
                reviews.append({**review, 'sum': review_sum(review)})
        status = str(latest.get('status') or 'read')
        out.append({
            'key': key,
            'list': STATUS_LISTS.get(status, 'read'),
            'at': latest['_when'],
            'added': reads[0]['_when'],
            'isbns': {str(p['isbn']) for p in reads if p.get('isbn')},
            # The original image, when the repository has it (covers live in its media/ folder).
            'cover_file': cover_file if cover_file and cover_file.is_file() else None,
            'reviews': reviews,
            'fields': {k: v for k, v in fields.items() if v not in ('', None, [])},
        })
    out.sort(key=lambda b: b['added'])
    return out
