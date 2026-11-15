"""Publishes what was changed in the app back to the booklog (mvuijlst/boeken).

The booklog is a git repository of Markdown posts, one per read of a book; pushing to it
rebuilds boeken.tsuk.org. This module works in a clone of its own (settings.BOEKEN_REPO):
for every book that was changed in the app since it was last in step with the booklog, it
edits the posts concerned, checks them with the booklog's own linter, and commits, one
commit per book, worded as the booklog's commits always were ("Uitgelezen: …").

What counts as changed is decided per book, by comparing with what the import (or the last
publish) left behind: `boekenState` for the book's own facts and the list it is on, and
`sum` on each review. Nothing else is ever written, so a post nobody touched in the app
stays byte for byte as it was, and so does every line of a touched post that didn't change.

What a change in the app means in the booklog:

  a review of a read is edited       its post gets the new text, rating and reading date
  the book moves To read → Reading   the post's status, with progress started
  a book being read gets a dated     the post is finished: no status, the date of reading,
    review, or moves to Read           the rating and the text
  a read book gets another dated     a new post, a reread of the first (rereadOf)
    review, or moves back to Reading
  the page reached changes           pagesRead and a line in progressLog
  title, series, publisher, year,    the post's (for title and series: every read's) front matter
    pages, ISBN change
  the cover is replaced              the picture goes into media/ and the post points at it
  a book that is not in the booklog  a new post, with its cover and whatever author, tag and
    is added to it (`boekenWanted`)    series pages do not exist yet (see plan_new)
  a book to read is dropped          its post is deleted, with its cover and the author, tag
                                       and series pages nothing else uses (see plan_drop)

The front-matter editing is boeggn's (apps/core/services/books.py), which wrote these posts
before: changes are made line by line, never by re-serialising the YAML.
"""
import re
import subprocess
import sys
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, time, timedelta
from pathlib import Path

from django.conf import settings
from django.utils import timezone

from . import boeken, covers
from .boeken import BRUSSELS

FRONT = re.compile(r'\A---\r?\n(.*?)\r?\n---\r?\n?', re.S)

# ───────────────────────── Front matter, line by line (after boeggn) ─────────────────────────

CANON_ORDER = [
    'title', 'series', 'series_number', 'series_number_label', 'date', 'slug',
    'rereadOf', 'wpId', 'rating', 'review', 'publisher', 'year', 'year_until', 'format',
    'pages', 'pagesRead', 'duration', 'durationLeft', 'progressLog', 'isbn',
    'olid', 'language', 'issues', 'roles', 'cover', 'status', 'categories',
    'tags', 'authors', 'draft', 'aliases',
]
QUOTED_KEYS = {'title', 'publisher', 'duration', 'durationLeft', 'series_number_label', 'status',
               'cover', 'slug', 'isbn', 'olid', 'rereadOf', 'language', 'format'}
LIST_KEYS = {'categories', 'tags', 'authors', 'series', 'aliases'}
# What a reread copies from the read before it: the facts of the book and of the edition.
BOOK_FACTS = ('title', 'series', 'series_number', 'series_number_label', 'publisher', 'year', 'format', 'pages',
              'duration', 'isbn', 'olid', 'language', 'roles', 'cover', 'categories', 'tags', 'authors')


def quote(value):
    return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"') + '"'


def render_lines(key, value):
    """A front-matter entry as one or more lines."""
    if key == 'roles':
        return ['roles:'] + [f'  {slug}: {quote(role)}' for slug, role in value.items()]
    if key == 'progressLog':
        return ['progressLog:'] + [f'  - {quote(v)}' for v in value]
    if key in LIST_KEYS:
        return [f'{key}: [{", ".join(quote(v) for v in value)}]']
    if key in QUOTED_KEYS:
        return [f'{key}: {quote(value)}']
    if isinstance(value, bool):
        return [f'{key}: {"true" if value else "false"}']
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return [f'{key}: {value}']   # numbers, the date


def apply_front_matter(text, changes):
    """Apply {key: value} to a post's front matter; None removes the key.

    Lines that don't change stay byte-identical; a new key goes where the booklog's posts
    have it. Returns the whole new file text.
    """
    match = FRONT.match(text)
    if not match:
        raise ValueError('The post has no front matter.')
    lines = match.group(1).split('\n')

    def spans():
        found, i = {}, 0
        while i < len(lines):
            key = re.match(r'^([A-Za-z_][A-Za-z0-9_]*):', lines[i])
            j = i + 1
            while j < len(lines) and lines[j].startswith((' ', '\t')):
                j += 1
            if key:
                found[key.group(1)] = (i, j)
                i = j
            else:
                i += 1
        return found

    rank = lambda key: CANON_ORDER.index(key) if key in CANON_ORDER else len(CANON_ORDER)
    for key, value in changes.items():
        where = spans()
        new = render_lines(key, value) if value is not None else []
        if key in where:
            start, end = where[key]
            lines[start:end] = new
        elif new:
            at = next((s for other, (s, e) in sorted(where.items(), key=lambda kv: kv[1][0]) if rank(other) > rank(key)), len(lines))
            lines[at:at] = new
    return '---\n' + '\n'.join(lines) + '\n---\n' + text[match.end():]


def new_post_text(fields, body):
    lines = []
    for key in CANON_ORDER:
        if fields.get(key) not in (None, '', [], {}):
            lines += render_lines(key, fields[key])
    body = body.strip()
    return '---\n' + '\n'.join(lines) + '\n---\n' + (body + '\n' if body else '')


def slugify(value):
    """As Hugo (and the booklog's linter) turns a series name into its address."""
    s = unicodedata.normalize('NFKD', str(value))
    s = ''.join(c for c in s if not unicodedata.combining(c))
    s = s.replace("'", '').replace('’', '')
    return re.sub(r'[^a-zA-Z0-9]+', '-', s).strip('-').lower()


def parse_duration(text):
    """Minutes from the booklog's "43u 57m", "3u" or "45m"; None if it isn't one."""
    match = re.fullmatch(r'(?:(\d+)\s*u)?\s*(?:(\d+)\s*m)?', str(text or '').strip())
    if not match or (match.group(1) is None and match.group(2) is None):
        return None
    return int(match.group(1) or 0) * 60 + int(match.group(2) or 0)


def format_duration(minutes):
    hours, rest = divmod(max(0, int(minutes)), 60)
    return f'{hours}u {rest}m' if hours and rest else f'{hours}u' if hours else f'{rest}m'


# ───────────────────────── What a book's changes come to ─────────────────────────

@dataclass
class Plan:
    """What publishing one book would do."""
    message: str = ''
    files: dict = field(default_factory=dict)      # path → new text (posts, term pages)
    removals: list = field(default_factory=list)   # paths to delete (a dropped book's post and what only it used)
    forget: list = field(default_factory=list)     # ids of reviews another review has taken the place of
    pictures: dict = field(default_factory=dict)   # path → bytes (a new cover)
    slugs: set = field(default_factory=set)        # posts to run the linter on
    links: list = field(default_factory=list)      # (review id, post slug, post address): these are now in step
    deferred: set = field(default_factory=set)     # changes that can't be published yet (a cover still on its way)
    notes: list = field(default_factory=list)      # what it does, in words
    url: str = ''                                  # for a book new to the booklog: where its post will be

    @property
    def writes(self):
        return bool(self.files or self.pictures or self.removals)


def local(moment):
    """A moment as the booklog writes dates: Brussels time, to the second, with its offset."""
    return moment.astimezone(BRUSSELS).replace(microsecond=0).isoformat()


def on_day(day, at):
    """Day "2026-11-14" at the time of day `at` (a time), in Brussels."""
    year, month, date = (int(part) for part in day.split('-'))
    return datetime(year, month, date, at.hour, at.minute, at.second, tzinfo=BRUSSELS).isoformat()


def changed_keys(data):
    """Which of the book's own facts (and the list it is on) differ from the booklog's."""
    if 'boekenState' not in data:
        return set()
    before, now = data['boekenState'] or {}, boeken.state_of(data)
    tracked = boeken.TRACKED.get(before.get('tracks'), boeken.TRACKED[1])   # as far as that state went
    return {key for key in (*tracked, 'list') if before.get(key) != now.get(key)}


def is_pending(data):
    reviews = [r for r in data.get('reviews') or [] if isinstance(r, dict)]
    return bool(changed_keys(data)
                or any(not r.get('boeken') and r.get('date') for r in reviews)
                or any(r.get('boeken') and r.get('sum') and not boeken.in_step(r) for r in reviews))


def known_authors(repo):
    """Every way a name may be written → the slug of that author's page in the booklog."""
    from .intake import name_key   # "Hamilton, Peter F." is "Peter F. Hamilton" is hamilton-peter-f
    known = {}
    for slug, display in boeken.author_names(repo).items():
        known[name_key(display.split())] = slug
        known.setdefault(name_key(slug.split('-')), slug)
    return known


def people_front(repo, people, plan, known=None):
    """People as the app has them → (authors, roles) as a post has them. Someone the booklog
    doesn't know yet gets an author page, added to the plan."""
    from .intake import name_key
    known = known_authors(repo) if known is None else known
    authors, roles = [], {}
    for person in boeken.tidy_people(people):
        slug = known.get(name_key(person['name'].split()))
        if not slug:
            slug, filed = author_slug(person['name'])
            page = Path(repo, 'site', 'content', 'authors', slug, '_index.md')
            if not page.exists():
                plan.files[page] = f'---\ntitle: {quote(person["name"])}\nslug: {quote(slug)}\nwpName: {quote(filed)}\n---\n'
            known[name_key(person['name'].split())] = slug
        if slug not in authors:
            authors.append(slug)
            if person['role']:
                roles[slug] = person['role']
    return authors, roles


def plan_book(repo, data, group, taken, now):
    """→ the Plan for one book, or None when the booklog already has everything.

    `group` is the book's posts in the booklog, oldest first; `taken` every slug in use
    (new posts are added to it).
    """
    plan = Plan()
    edits = {}      # slug → {'post', 'front': {...}, 'body': str | None}
    kinds = []      # what happened, for the commit message
    by_slug = {post['slug']: post for post in group}
    root = group[0].get('rereadOf') or group[0]['slug']
    latest = group[-1]
    status = str(latest.get('status') or 'read')
    reviews = [r for r in data.get('reviews') or [] if isinstance(r, dict)]
    state, changed = boeken.state_of(data), changed_keys(data)
    today = now.astimezone(BRUSSELS).date().isoformat()
    title = str(data.get('title') or latest['title'])

    def edit(post):
        return edits.setdefault(post['slug'], {'post': post, 'front': {}, 'body': None})

    def set_text(post, text):
        old = post['_body']
        body = boeken.body_text(text, boeken.site_links(old))
        if boeken.review_text(old) == boeken.review_text(body):
            return   # the same words: leave the post's own spacing alone
        lead = old[:len(old) - len(old.lstrip('\n'))]
        edit(post)['body'] = lead + (body + '\n' if body else '')

    def set_rating(post, rating):
        if rating != (post['rating'] if isinstance(post.get('rating'), int) else None):
            edit(post)['front']['rating'] = rating

    def edition_fields(edition):
        """An edition as front matter: {key: value}, None where the edition doesn't say."""
        years = re.fullmatch(r'(\d{4})(?:\s*[–-]\s*(\d{4}))?', str(edition.get('date') or '').strip())
        # An audiobook has a length and no pages; anything else pages and no length.
        audio = edition.get('format') == 'audiobook' or (not edition.get('format') and bool(edition.get('duration')))
        return {
            'publisher': str(edition.get('publisher') or '').strip() or None,
            'year': int(years.group(1)) if years else None,
            'year_until': int(years.group(2)) if years and years.group(2) else None,
            'pages': edition['pages'] if isinstance(edition.get('pages'), int) and not audio else None,
            'duration': (str(edition.get('duration') or '').strip() or None) if audio else None,
            'isbn': str(edition.get('isbn') or '').strip() or None,
            'language': str(edition.get('language') or '').strip() or None,
        }

    def edition_picture(edition, slug, day):
        """A cover the user gave this edition, filed in the booklog's media folder. → its address there, or None"""
        picture = Path(settings.COVERS_DIR).parent / str(edition.get('coverFull') or '-')
        if not edition.get('coverFull') or not picture.is_file():
            return None
        folder = f'wp-content/uploads/{str(day)[:4]}/{str(day)[5:7]}'
        name, n = f'{slug}.jpg', 1
        while Path(repo, 'media', folder, name).exists() or Path(repo, 'media', folder, name) in plan.pictures:
            n += 1
            name = f'{slug}-{n}.jpg'
        plan.pictures[Path(repo, 'media', folder, name)] = picture.read_bytes()
        plan.notes.append('new cover')
        return f'/{folder}/{name}'

    def set_people(post, people):
        """Who made the book as that post has it: its authors, and the role of each who has one."""
        people = boeken.tidy_people(people)
        names = boeken.author_names(repo)
        if not people or people == boeken.tidy_people(boeken.people_of(post.get('authors'), post.get('roles'), names)):
            return False
        authors, roles = people_front(repo, people, plan, known_with(post, names))
        edit(post)['front'].update(authors=authors, roles=roles or None)
        return True

    def known_with(post, names):
        """The booklog's authors, where the people this post already names keep the page they have
        (a few authors have two pages, and a name alone doesn't say which)."""
        from .intake import name_key
        known = known_authors(repo)
        for slug in post.get('authors') or []:
            known[name_key(str(names.get(str(slug), slug)).split())] = str(slug)
        return known

    def set_format(post, wanted):
        """What that read was read as. Said in the post only where it differs from what the post
        already amounts to. (The booklog's audiobook and kindle categories said this once; `format` replaced them.)"""
        wanted = wanted if wanted in boeken.FORMATS else ''
        if wanted == boeken.format_of(post):
            return False
        edit(post)['front']['format'] = wanted or None
        return True

    def set_edition(post, review):
        """The edition read that time, on that read's own post."""
        if not isinstance(review.get('edition'), dict):
            return   # a review from before reviews had editions
        for key, value in edition_fields(review['edition']).items():
            if value != (post.get(key) or None):
                edit(post)['front'][key] = value
        if 'people' in review['edition']:
            set_people(post, review['edition']['people'])
        set_format(post, review['edition'].get('format'))
        cover = edition_picture(review['edition'], post['slug'], post['_day'])
        if cover:
            edit(post)['front']['cover'] = cover

    def move_date(post, day):
        """A read was on another day than the post says. The post's address has its month in it,
        so when that changes the old address is kept as an alias."""
        written = re.search(r'^date:\s*["\']?\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})(?::(\d{2}))?', post['_raw'], re.M)
        at = time(*(int(part or 0) for part in written.groups())) if written else time(20)
        front = edit(post)['front']
        front['date'] = on_day(day, at)
        if day[:7] != post['_day'][:7]:
            old = f'/{post["_day"][:4]}/{post["_day"][5:7]}/{post["slug"]}/'
            front['aliases'] = list(dict.fromkeys([*(post.get('aliases') or []), old]))

    def address(slug, day):
        return f'{boeken.SITE}/{day[:4]}/{day[5:7]}/{slug}/'

    def reread(review=None, shelf=None):
        """A new post for another read of the book: finished (with its review) or just begun."""
        slug, n = f'{slugify(root)}-herlezing', 1
        while slug in taken:
            n += 1
            slug = f'{slugify(root)}-herlezing-{n}'
        taken.add(slug)
        fields = {k: latest.get(k) for k in BOOK_FACTS}
        fields.update(slug=slug, rereadOf=root)
        text = ''
        if review and isinstance(review.get('edition'), dict) and review['edition']:
            # Read in another edition this time: its own publisher, length and cover.
            own = edition_fields(review['edition'])
            if any(own.values()):
                fields.update(own)
            if boeken.tidy_people(review['edition'].get('people')):
                authors, roles = people_front(repo, review['edition']['people'], plan, known_with(latest, boeken.author_names(repo)))
                fields.update(authors=authors, roles=roles or None)
            fields['cover'] = edition_picture(review['edition'], slug, review['date']) or fields.get('cover')
        if review:
            day = review['date']
            fields['date'] = local(now) if day == today else on_day(day, time(20))
            fields['rating'] = review.get('rating')
            text = boeken.body_text(review.get('text') or '')
            fields['review'] = len(text.strip()) > 200 or None
            plan.links.append((review.get('id'), slug, address(slug, day)))
        else:
            day = today
            fields.update(date=local(now), status=shelf)
            if shelf == 'reading':
                minutes = parse_duration(latest.get('duration'))
                if minutes:
                    fields['durationLeft'] = format_duration(minutes - 1)
                else:
                    fields['pagesRead'] = 1
        plan.files[Path(repo, 'site', 'content', 'posts', f'{slug}.md')] = new_post_text(fields, text)
        plan.slugs.add(slug)
        plan.notes.append(f'new post {slug} (a reread)')
        kinds.append('reread')

    # 1. Reviews that belong to a post and were edited.
    for review in reviews:
        post = by_slug.get(review.get('boeken'))
        if not post or not review.get('sum') or boeken.in_step(review):
            continue
        set_text(post, review.get('text') or '')
        set_rating(post, review.get('rating'))
        set_edition(post, review)
        if review.get('date') and review['date'] != post['_day'] and str(post.get('status') or 'read') in ('read', 'abandoned'):
            move_date(post, review['date'])
        plan.links.append((review.get('id'), post['slug'], None))
        kinds.append('edit')

    # 2. Reviews written in the app, and the list the book is on.
    fresh = sorted((r for r in reviews if not r.get('boeken') and r.get('date')), key=lambda r: r['date'])
    target = state.get('list') if 'list' in changed else None
    if status in ('to-read', 'reading'):
        closing = fresh[-1] if fresh else None
        if closing or target == 'read':
            front = edit(latest)['front']
            front.update(status=None, pagesRead=None, durationLeft=None)
            day = closing['date'] if closing else today
            front['date'] = local(now) if day == today else on_day(day, time(20))
            if closing:
                set_text(latest, closing.get('text') or '')
                set_rating(latest, closing.get('rating'))
                set_edition(latest, closing)
                plan.links.append((closing.get('id'), latest['slug'], address(latest['slug'], day)))
            kinds.append('read')
        elif target == 'abandoned':
            edit(latest)['front']['status'] = 'abandoned'
            kinds.append('abandoned')
        elif target in ('to-read', 'reading') and target != status:
            front = edit(latest)['front']
            front['status'] = target
            if target == 'reading' and not latest.get('pagesRead') and not latest.get('durationLeft'):
                minutes = parse_duration(latest.get('duration'))
                if minutes:
                    front['durationLeft'] = format_duration(minutes - 1)
                else:
                    front['pagesRead'] = 1
            kinds.append(target)
    else:
        # Marked as read first and reviewed later: the latest read has nothing but its date yet,
        # so the review is of that read, not of another one.
        mine = next((r for r in reviews if r.get('boeken') == latest['slug']), None)
        bare = not latest['_text'] and not isinstance(latest.get('rating'), int)
        if fresh and status == 'read' and bare and (mine is None or (not mine.get('text') and mine.get('rating') is None)):
            first = fresh.pop(0)
            set_text(latest, first.get('text') or '')
            set_rating(latest, first.get('rating'))
            set_edition(latest, first)
            if first['date'] != latest['_day']:
                move_date(latest, first['date'])
            plan.links.append((first.get('id'), latest['slug'], None))
            if mine is not None:
                plan.forget.append(mine.get('id'))
            kinds.append('edit')
        for review in fresh:
            reread(review=review)
        if not fresh and target in ('to-read', 'reading'):
            reread(shelf=target)

    # 3. How far along: only for a book that is (still) being read.
    current = edits.get(latest['slug'], {}).get('front', {})
    reading = current.get('status', status) == 'reading' and 'date' not in current
    log = list(latest.get('progressLog') or [])
    if reading and 'pagesRead' in changed and isinstance(state.get('pagesRead'), int) and state['pagesRead'] > 0:
        edit(latest)['front'].update(pagesRead=state['pagesRead'], progressLog=log + [f'{today} p{state["pagesRead"]}'])
        kinds.append('progress')
        plan.notes.append(f'p. {state["pagesRead"]}')
    elif reading and 'durationLeft' in changed and parse_duration(state.get('durationLeft')) is not None:
        left = format_duration(parse_duration(state['durationLeft']))
        edit(latest)['front'].update(durationLeft=left, progressLog=log + [f'{today} {left} te gaan'])
        kinds.append('progress')
        plan.notes.append(f'{left} te gaan')

    # 4. The book's own facts. Title and series are the book's, so every read says the same;
    #    publisher, year, pages and ISBN are the edition's, and go on the latest read.
    if 'title' in changed and state.get('title'):
        for post in group:
            edit(post)['front']['title'] = state['title']
    if changed & {'series', 'seriesNumber', 'seriesLabel'}:
        name = state.get('series')
        for post in group:
            edit(post)['front'].update(series=[name] if name else None,
                                       series_number=state.get('seriesNumber') if name else None,
                                       series_number_label=(state.get('seriesLabel') or None) if name else None)
        term = Path(repo, 'site', 'content', 'series', slugify(name or ''), '_index.md')
        if name and not term.exists():
            plan.files[term] = f'---\ntitle: {quote(name)}\nslug: {quote(slugify(name))}\n---\n'
    if 'publisher' in changed:
        edit(latest)['front']['publisher'] = state.get('publisher')
    if 'pages' in changed and (state.get('pages') is None or isinstance(state.get('pages'), int)):
        edit(latest)['front']['pages'] = state.get('pages')
    if 'isbn' in changed:
        edit(latest)['front']['isbn'] = state.get('isbn')
    if 'date' in changed:
        years = re.fullmatch(r'(\d{4})(?:\s*[–-]\s*(\d{4}))?', str(state.get('date') or ''))
        if years:
            edit(latest)['front'].update(year=int(years.group(1)), year_until=int(years.group(2)) if years.group(2) else None)
    if 'people' in changed and set_people(latest, state.get('people')):
        kinds.append('edit')
    if 'format' in changed and set_format(latest, state.get('format')):
        kinds.append('edit')
    if 'duration' in changed:
        # The app keeps the two apart: an audiobook has a length and no pages, anything else pages.
        minutes = parse_duration(state.get('duration'))
        if minutes != parse_duration(latest.get('duration')):
            edit(latest)['front']['duration'] = format_duration(minutes) if minutes is not None else None
            kinds.append('edit')
    if changed & {'title', 'series', 'seriesNumber', 'seriesLabel', 'publisher', 'pages', 'isbn', 'date'}:
        kinds.append('edit')

    # 5. A new cover: the picture the server kept goes into the booklog's media folder.
    if 'cover' in changed:
        picture = Path(settings.COVERS_DIR).parent / str(data.get('coverFull') or '-')
        if data.get('coverFull') and picture.is_file():
            day = current.get('date') or latest['_day']
            folder = f'wp-content/uploads/{str(day)[:4]}/{str(day)[5:7]}'
            name, n = f'{latest["slug"]}.jpg', 1
            while Path(repo, 'media', folder, name).exists():
                n += 1
                name = f'{latest["slug"]}-{n}.jpg'
            plan.pictures[Path(repo, 'media', folder, name)] = picture.read_bytes()
            edit(latest)['front']['cover'] = f'/{folder}/{name}'
            kinds.append('edit')
            plan.notes.append('new cover')
        elif str(data.get('cover') or '').startswith('covers/boeken/'):
            pass   # back to the booklog's own cover: nothing to publish
        else:
            plan.deferred.add('cover')   # the larger picture hasn't reached the server yet

    # Turn the edits into file texts.
    for slug, change in edits.items():
        post, front, body = change['post'], dict(change['front']), change['body']
        text = post['_file']
        final_status = front.get('status', post.get('status')) or 'read'
        if final_status == 'read' and (body is not None or 'status' in front):
            # The booklog flags a read as reviewed when it has a real text: more than 200
            # characters sets the flag; a flag that is there (set by hand, for a short review)
            # only goes when no text is left at all.
            words = (body if body is not None else post['_body']).strip()
            if len(words) > 200 and not post.get('review'):
                front['review'] = True
            elif not words and post.get('review'):
                front['review'] = None
        front = {k: v for k, v in front.items() if not (v is None and k not in post)}
        if front:
            text = apply_front_matter(text, front)
        if body is not None:
            text = text[:FRONT.match(text).end()] + body
        if text != post['_file']:
            plan.files[post['_path']] = text
            plan.slugs.add(slug)

    if not plan.writes:
        # Nothing for the booklog, but the app's changes are dealt with (a list it doesn't know, say).
        return plan if (changed - plan.deferred or plan.links) else None

    if 'reread' in kinds:
        plan.message = f'Herlezen: {title}'
    elif 'read' in kinds:
        plan.message = f'Uitgelezen: {title}'
    elif 'abandoned' in kinds:
        plan.message = f'Niet uit: {title}'
    elif 'reading' in kinds:
        plan.message = f'Lezende: {title}'
    elif 'to-read' in kinds:
        plan.message = f'Te lezen: {title}'
    elif kinds and all(kind == 'progress' for kind in kinds):
        plan.message = f'Voortgang {title} ({plan.notes[-1]})'
    else:
        plan.message = f'Bewerkt: {title}'
    return plan


# ───────────────────────── A book the booklog doesn't have yet ─────────────────────────

PARTICLES = {'van', 'de', 'der', 'den', 'ter', 'ten', 'te', 'von', 'zu', 'du', 'des', 'le', 'la', 'di', 'da', 'del', 'della', 'el', 'al'}


def author_slug(name):
    """"Rebecca Yarros" → ("yarros-rebecca", "Yarros - Rebecca"): the booklog files authors by surname.

    The surname is the last word, with the particles before it ("Ursula K. Le Guin" →
    le-guin-ursula-k); a single name stays as it is.
    """
    words = str(name).split()
    if len(words) < 2:
        return slugify(name), str(name).strip()
    cut = len(words) - 1
    while cut > 1 and words[cut - 1].lower() in PARTICLES:
        cut -= 1
    first, last = ' '.join(words[:cut]), ' '.join(words[cut:])
    return slugify(f'{last} {first}'), f'{last} - {first}'


def needs(data):
    """What a book still lacks before it can be a post in the booklog; empty when it is ready."""
    lacking = []
    if not str(data.get('title') or '').strip():
        lacking.append('a title')
    if not str(data.get('author') or '').strip():
        lacking.append('an author')
    if not boeken.state_of(data).get('list'):
        lacking.append('a place on To read, Reading or Read')
    if not re.fullmatch(r'[a-z]{2}', str(data.get('language') or '')):
        lacking.append('a language')
    if not data.get('categories'):
        lacking.append('a category')
    return lacking


def plan_new(repo, data, posts, taken, now):
    """The Plan that adds a book to the booklog: its post, its cover, and the author, tag and
    series pages that don't exist yet. → (plan, slug of the post it is or becomes)

    If the booklog already has the book (the same ISBN, or the same title by the same
    author), nothing is added: the book is tied to that post instead, and what differs is
    then a change like any other.
    """
    lacking = needs(data)
    if lacking:
        raise ValueError('It needs ' + ', '.join(lacking) + '.')
    plan = Plan()
    content = Path(repo, 'site', 'content')
    title = str(data['title']).strip()
    # Everyone who made it, with what each did; for a book that only names its writers, those.
    people = boeken.tidy_people(data.get('people')) or [
        {'name': name.strip(), 'role': ''} for name in re.split(r',| & | and | en ', str(data['author'])) if name.strip()]
    authors, roles = people_front(repo, people, plan)

    # Already there?
    isbn = str(data.get('isbn') or '')
    for post in posts:
        same_isbn = isbn and str(post.get('isbn') or '') == isbn
        same_book = boeken.fold(post['title']) == boeken.fold(title) and set(post.get('authors') or []) & set(authors)
        if same_isbn or same_book:
            plan.files.clear()
            plan.notes.append(f'already in the booklog as {post["slug"]}')
            return plan, str(post.get('rereadOf') or post['slug'])

    state = boeken.state_of(data)
    shelf = state['list']
    today = now.astimezone(BRUSSELS).date().isoformat()
    reviews = [r for r in data.get('reviews') or [] if isinstance(r, dict) and not r.get('boeken')]
    dated = sorted((r for r in reviews if r.get('date')), key=lambda r: r['date'])
    # A read book's post is its first read; a book not read yet can carry a note.
    review = dated[0] if shelf in ('read', 'abandoned') and dated else next((r for r in reviews if not r.get('date')), None)
    day = review['date'] if review and review.get('date') else today

    slug, n = slugify(title), 1
    while slug in taken or not slug:
        n += 1
        slug = f'{slugify(title) or "boek"}-{n}'
    taken.add(slug)

    categories = [str(c) for c in data['categories']]
    for category in categories:
        if not (content / 'categories' / category / '_index.md').exists():
            raise ValueError(f'The booklog has no category "{category}".')
    tags = []
    for tag in data.get('tags') or []:
        tag_slug = slugify(tag)
        if not tag_slug:
            continue
        tags.append(tag_slug)
        page = content / 'tags' / tag_slug / '_index.md'
        if not page.exists():
            plan.files[page] = f'---\ntitle: {quote(str(tag).strip())}\nslug: {quote(tag_slug)}\n---\n'
    series = str(data.get('series') or '').strip()
    if series:
        page = content / 'series' / slugify(series) / '_index.md'
        if not page.exists():
            plan.files[page] = f'---\ntitle: {quote(series)}\nslug: {quote(slugify(series))}\n---\n'

    years = re.fullmatch(r'(\d{4})(?:\s*[–-]\s*(\d{4}))?', str(data.get('date') or '').strip())
    text = boeken.body_text(review.get('text') or '') if review else ''
    fields = {
        'title': title,
        'series': [series] if series else None,
        'series_number': data.get('seriesNumber') if series else None,
        'series_number_label': (data.get('seriesLabel') or None) if series else None,
        'date': local(now) if day == today else on_day(day, time(20)),
        'slug': slug,
        'rating': review.get('rating') if review and shelf in ('read', 'abandoned') else None,
        'review': (shelf == 'read' and len(text) > 200) or None,
        'publisher': str(data.get('publisher') or '').strip(),
        'year': int(years.group(1)) if years else None,
        'year_until': int(years.group(2)) if years and years.group(2) else None,
        'format': data.get('format') if data.get('format') in boeken.FORMATS else None,
        'pages': data.get('pages') if isinstance(data.get('pages'), int) and data.get('format') != 'audiobook' else None,
        'duration': format_duration(parse_duration(data['duration'])) if data.get('format') == 'audiobook' and parse_duration(data.get('duration')) is not None else None,
        'isbn': isbn if re.fullmatch(r'\d{9}[\dXx]|\d{13}', isbn) else None,
        'language': data['language'],
        'roles': roles or None,
        'status': None if shelf == 'read' else shelf,
        'categories': categories,
        'tags': tags,
        'authors': authors,
    }
    if shelf == 'reading':
        page = data.get('pagesRead')
        fields['pagesRead'] = page if isinstance(page, int) and page > 0 else 1

    picture = covers.original(data)
    if picture:
        folder = f'wp-content/uploads/{day[:4]}/{day[5:7]}'
        name, n = f'{slug}{picture[1]}', 1
        while Path(repo, 'media', folder, name).exists():
            n += 1
            name = f'{slug}-{n}{picture[1]}'
        plan.pictures[Path(repo, 'media', folder, name)] = picture[0]
        fields['cover'] = f'/{folder}/{name}'

    plan.files[content / 'posts' / f'{slug}.md'] = new_post_text(fields, text)
    plan.slugs.add(slug)
    if review:
        plan.links.append((review.get('id'), slug, f'{boeken.SITE}/{day[:4]}/{day[5:7]}/{slug}/'))
    plan.url = f'{boeken.SITE}/{day[:4]}/{day[5:7]}/{slug}/'
    plan.message = {'to-read': 'Te lezen', 'reading': 'Lezende', 'abandoned': 'Niet uit'}.get(shelf, 'Uitgelezen') + f': {title}'
    plan.notes.append('new in the booklog')
    return plan, slug


# ───────────────────────── A book that is dropped ─────────────────────────

def plan_drop(repo, drop, groups):
    """The Plan that takes a dropped book out of the booklog: its post, its cover, and the
    author, tag and series pages nothing else uses. Only ever a book that was never read:
    one post, still to read. Anything else is refused, whatever the app asked."""
    group = groups.get(str(drop.get('boeken')))
    if not group:
        return None   # not in the booklog (any more)
    if len(group) != 1 or str(group[0].get('status') or 'read') != 'to-read':
        raise ValueError('Only a book that is still to read can be dropped from the booklog.')
    post = group[0]
    plan = Plan(message=f'Verwijderd: {post["title"]}')
    plan.removals.append(post['_path'])
    others = [p for g in groups.values() for p in g if p is not post]

    cover = str(post.get('cover') or '')
    picture = Path(repo, 'media', cover.lstrip('/'))
    if cover.startswith('/') and picture.is_file() and not any(str(p.get('cover') or '') == cover for p in others):
        plan.removals.append(picture)
    content = Path(repo, 'site', 'content')
    for kind, own, used in (
        ('authors', set(post.get('authors') or []), {a for p in others for a in p.get('authors') or []}),
        ('tags', set(post.get('tags') or []), {t for p in others for t in p.get('tags') or []}),
        ('series', {slugify(s) for s in post.get('series') or []}, {slugify(s) for p in others for s in p.get('series') or []}),
    ):
        for term in sorted(own - used):
            page = content / kind / str(term) / '_index.md'
            if page.is_file():
                plan.removals.append(page)
    plan.notes.append('removed from the booklog')
    return plan


# ───────────────────────── Git ─────────────────────────

class RepoError(Exception):
    pass


def git(repo, *args, check=True):
    done = subprocess.run(['git', *args], cwd=repo, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if check and done.returncode != 0:
        raise RepoError(f'git {" ".join(args)} failed:\n{done.stdout}{done.stderr}'.strip())
    return done.stdout


def is_clean(repo):
    return not git(repo, 'status', '--porcelain', '--untracked-files=no').strip()


def pull(repo):
    try:
        git(repo, 'pull', '--rebase', 'origin', 'main')
    except RepoError:
        git(repo, 'rebase', '--abort', check=False)   # never leave the clone mid-rebase
        raise


def ahead(repo):
    """Commits made here that the booklog doesn't have yet."""
    try:
        return int(git(repo, 'rev-list', '--count', 'origin/main..HEAD', check=False).strip() or 0)
    except ValueError:
        return 0


def push(repo):
    try:
        git(repo, 'push', 'origin', 'HEAD:main')
    except RepoError:
        pull(repo)   # someone else (boeggn, a desk) pushed in between
        git(repo, 'push', 'origin', 'HEAD:main')


def lint(repo, slug):
    """The booklog's own check of one post. → (fine?, what it said)"""
    script = Path(repo, 'scripts', 'check_books.py')
    if not script.is_file():
        return True, ''
    done = subprocess.run([sys.executable, str(script), '--post', slug], cwd=repo,
                          capture_output=True, text=True, encoding='utf-8', errors='replace')
    return done.returncode == 0, (done.stdout + done.stderr).strip()


def commit(repo, plan):
    """Write a plan's files, have them checked, and commit. Leaves no trace if anything fails."""
    before = {path: (path.read_bytes() if path.exists() else None) for path in [*plan.files, *plan.pictures, *plan.removals]}

    def undo():
        for path, content in before.items():
            if content is None:
                path.unlink(missing_ok=True)
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content)

    try:
        for path, text in plan.files.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding='utf-8', newline='')
        for path, picture in plan.pictures.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(picture)
        for path in plan.removals:
            path.unlink()
            if path.name == '_index.md' and not any(path.parent.iterdir()):
                path.parent.rmdir()   # a term page lives in a folder of its own
        for slug in sorted(plan.slugs):
            fine, said = lint(repo, slug)
            if not fine:
                raise RepoError(f'The booklog\'s check turned it down:\n{said}')
        relative = [str(path.relative_to(repo)) for path in before]
        git(repo, 'add', '--all', '--', *relative)
        name, _, email = settings.BOEKEN_GIT_AUTHOR.partition('<')
        git(repo, '-c', f'user.name={name.strip()}', '-c', f'user.email={email.strip(" >")}', 'commit', '-m', plan.message)
    except Exception:
        git(repo, 'reset', '--quiet', '--', *[str(path.relative_to(repo)) for path in before], check=False)
        undo()
        raise


# ───────────────────────── All of a shelf ─────────────────────────

def stamp(data, plan):
    """The book as it is once its plan is published: its reviews and facts are in step again."""
    data = dict(data)
    links = {review_id: (slug, url) for review_id, slug, url in plan.links}
    reviews = []
    for review in data.get('reviews') or []:
        if isinstance(review, dict) and review.get('id') in plan.forget:
            continue
        if isinstance(review, dict) and review.get('id') in links:
            slug, url = links[review['id']]
            review = {**review, 'boeken': slug, **({'url': url} if url else {})}
            review['sum'] = boeken.review_sum(review)
            if isinstance(review.get('edition'), dict):
                # The picture is in the booklog now; the import brings its thumbnail.
                review['edition'] = {k: v for k, v in review['edition'].items() if k != 'coverFull'}
                review['sum'] = boeken.review_sum(review)
        reviews.append(review)
    if reviews:
        data['reviews'] = reviews
    state, before = boeken.state_of(data), data.get('boekenState') or {}
    for key in plan.deferred:   # still to come: keep saying it differs
        state.pop(key, None)
        if key in before:
            state[key] = before[key]
    data['boekenState'] = state
    data.pop('boekenError', None)
    return data


def run(user, repo, *, delay=120, dry_run=False, now=None, say=lambda line: None):
    """Publish every book of `user` that was changed in the app. → {'published', 'settled', 'failed', 'waiting'}

    A book is left for the next run while it was changed less than `delay` seconds ago: a
    tap on the wrong list should be undoable before the world sees it.
    """
    from .models import Book

    now = now or timezone.now()
    groups, taken = {}, set()
    for post in boeken.read_posts(repo):
        groups.setdefault(str(post.get('rereadOf') or post['slug']), []).append(post)
        taken.add(post['slug'])
    for group in groups.values():
        group.sort(key=lambda p: p['_when'])

    counts = {'published': 0, 'settled': 0, 'failed': 0, 'waiting': 0}

    def failed(row, err):
        counts['failed'] += 1
        message = str(err).strip()[:500] or err.__class__.__name__
        say(f'NOT published: {row.title}: {message}')
        if not dry_run and row.data.get('boekenError') != message:
            row.data = {**row.data, 'boekenError': message}
            row.changed = timezone.now()
            row.save(update_fields=['data', 'changed'])

    # Books that were dropped: their page in the booklog goes too.
    for row in Book.objects.filter(user=user, deleted=True, data__drop__isnull=False):
        if row.modified > now - timedelta(seconds=delay):
            counts['waiting'] += 1
            continue
        try:
            plan = plan_drop(repo, row.data['drop'], groups)
            if plan:
                say(f'{plan.message}  [{", ".join(plan.notes)}]')
                for path in plan.removals:
                    say(f'    {path.relative_to(repo).as_posix()}')
                if not dry_run:
                    commit(repo, plan)
                counts['published'] += 1
                gone = plan.removals[0]
                groups.pop(str(row.data['drop'].get('boeken')), None)
                taken.discard(gone.stem)
            if not dry_run:
                row.data = {}
                row.save(update_fields=['data'])
        except Exception as err:
            counts['failed'] += 1
            say(f'NOT removed: {row.data["drop"].get("title")}: {str(err).strip()[:300]}')
            if not dry_run:
                row.data = {}   # said once; the book is gone from the shelf either way
                row.save(update_fields=['data'])

    # Books that are to be added to the booklog.
    every = [post for group in groups.values() for post in group]
    for row in Book.objects.filter(user=user, deleted=False, data__boekenWanted=True):
        if row.data.get('boeken'):
            continue
        if row.modified > now - timedelta(seconds=delay):
            counts['waiting'] += 1
            continue
        try:
            plan, key = plan_new(repo, row.data, every, taken, now)
            twin = None if plan.writes else Book.objects.filter(user=user, deleted=False, data__boeken=key).exclude(pk=row.pk).first()
            if twin:
                # The booklog has this book and so does the shelf, as another entry: adding it
                # again would make two of one book. Say so once, and stop asking.
                counts['failed'] += 1
                message = f'The booklog already has this book: it is "{twin.title}" on your shelf.'
                say(f'NOT added: {row.title}: {message}')
                if not dry_run:
                    row.data = {**{k: v for k, v in row.data.items() if k != 'boekenWanted'}, 'boekenError': message}
                    row.changed = timezone.now()
                    row.save(update_fields=['data', 'changed'])
                continue
            say((plan.message or f'{row.title}:') + f'  [{", ".join(plan.notes)}]')
            for path in [*plan.files, *plan.pictures]:
                say(f'    {path.relative_to(repo).as_posix()}')
            if plan.writes and not dry_run:
                commit(repo, plan)
            counts['published' if plan.writes else 'settled'] += 1
            if not dry_run:
                data = {k: v for k, v in row.data.items() if k not in ('boekenWanted', 'boekenError')}
                data['boeken'] = key
                if plan.writes:
                    data['url'] = plan.url
                    data = stamp(data, plan)
                else:
                    # Tied to a post that was there already. What the booklog says about it comes
                    # with the import; the list the app has it on counts as a change to publish.
                    there = groups.get(key, [{}])[-1]
                    data['url'] = there.get('_url', '')
                    data['boekenState'] = {**boeken.state_of(data), 'list': boeken.STATUS_LISTS.get(str(there.get('status') or 'read'))}
                row.data = data
                row.changed = timezone.now()
                row.save(update_fields=['data', 'changed'])
        except Exception as err:
            failed(row, err)

    for row in Book.objects.filter(user=user, deleted=False, data__boeken__isnull=False):
        group = groups.get(str(row.data.get('boeken')))
        if not group or not is_pending(row.data):
            continue
        if row.modified > now - timedelta(seconds=delay):
            counts['waiting'] += 1
            continue
        try:
            plan = plan_book(repo, row.data, group, taken, now)
            if plan is None:
                continue
            if plan.writes:
                say(f'{plan.message}' + (f'  [{", ".join(plan.notes)}]' if plan.notes else ''))
                for path in [*plan.files, *plan.pictures]:
                    say(f'    {path.relative_to(repo).as_posix()}')
                if not dry_run:
                    commit(repo, plan)
            counts['published' if plan.writes else 'settled'] += 1
            if not dry_run:
                row.data = stamp(row.data, plan)
                row.changed = timezone.now()   # `modified` stays: nobody edited the book
                row.save(update_fields=['data', 'changed'])
        except Exception as err:   # one book that can't be published doesn't stop the others
            failed(row, err)
    return counts
