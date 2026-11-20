"""Brings the booklog (mvuijlst/boeken) into one user's shelf.

    manage.py import_boeken /path/to/boeken --user NAME [--dry-run]
    manage.py import_boeken --user NAME --remove [--dry-run]

Safe to run again: the booklog is the source for what it knows (title, author, rating,
reading status, the facts of each edition read, …), so those are set afresh each time, and a
book is only stored when something changed. Everything else about a book is left alone: the
lists its editions are on, editions nobody read, its notes, its cover thumbnail.

A book is one `rereadOf` group of posts, one post per read. Each post is of an edition of the
book (docs/work-edition-plan.md, 6.3), found in this order:

  1. the edition its review already points at;
  2. for the post of a read not done yet (to read, reading), the book's `main` edition;
  3. an edition of the book with the same facts, that no post with other facts has claimed
     (or, for a book scanned before it was imported, the same ISBN);
  4. otherwise a new edition, `ed-<slug>`.

Reviews: every read in the booklog is a review of the book, with the day it was read, the
rating and the text. Reviews written in the app are kept, and so is a booklog review that
was edited in the app (until it is published, the app's text would otherwise be lost).

A booklog book that is already on the shelf (same ISBN, scanned earlier) is joined with it
instead of added a second time. A booklog book that was deleted in the app stays deleted.

Covers: the booklog's images are full-size, far too heavy for a list of thumbnails. For
each cover found in the repository's media/ folder a small WebP is written to covers/boeken/
next to the app (see shelf/covers.py), named after the image's content, and the edition points
at that. Where the image is missing, it points at the booklog's own copy.
"""
import copy
import hashlib
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from shelf import boeken, covers, publish, works
from shelf.models import Book, List

READING_GROUP = 'Reading status'
READING_LISTS = set(boeken.STATUS_LISTS.values())
# What the booklog owns in an edition: on every run set from its post, or removed.
EDITION_OWNED = (*boeken.EDITION, 'coverRatio', 'coverSource')


def merged_reviews(old, incoming, dropped=(), held=()):
    """The booklog's reviews next to the ones made or edited in the app. → (reviews, how many were kept as edited)
    `old` in the flat view (each with its `edition`). `dropped`: posts of reads deleted in the
    app, still to be deleted from the booklog. `held`: posts the app is taking off the booklog
    while keeping their reads (`unpublish`): those reads stay as the app has them."""
    old = [r for r in old or [] if isinstance(r, dict)]
    previous = {r['boeken']: r for r in old if r.get('boeken')}
    out, kept = [r for r in old if not r.get('boeken')], 0
    for review in incoming:
        if review['boeken'] in dropped:
            continue
        before = previous.get(review['boeken'])
        if review['boeken'] in held:
            if before:
                out.append(before)
            continue
        if before and before.get('sum') and not boeken.in_step(before):
            out.append(before)
            kept += 1
        else:
            out.append(review)
    # Oldest read first; what has no reading date comes last.
    out = sorted(out, key=lambda r: (not r.get('date'), r.get('date') or '', r.get('id') or ''))
    return [{k: v for k, v in r.items() if k != 'edition'} for r in out], kept


def booklog_facts(edition):
    """What a post says of an edition, for telling editions apart: its facts and its cover picture."""
    people = boeken.tidy_people(edition.get('people'))
    facts = {key: edition[key] for key in boeken.EDITION if key not in ('cover', 'people') and edition.get(key) not in (None, '', [])}
    facts.pop('title', None)   # the same edition whoever names it: a title is not what tells editions apart
    return facts, people, edition.get('coverSource') or edition.get('cover') or ''


def edition_uid(slug):
    uid = f'ed-{slug}'
    return uid if len(uid) <= 64 else f'ed-{slug[:40]}-{hashlib.sha1(slug.encode()).hexdigest()[:12]}'


def has_old_books(user):
    """Books stored in the shape from before editions (`manage.py to_works` upgrades them)."""
    return any(not b.data.get('editions') for b in Book.kept(user).only('data'))


class Command(BaseCommand):
    help = 'Import the boeken.tsuk.org booklog into a user\'s shelf (repeatable).'

    def add_arguments(self, parser):
        parser.add_argument('repo', nargs='?', help='path of a checkout of mvuijlst/boeken')
        parser.add_argument('--user', required=True, help='whose shelf to import into')
        parser.add_argument('--dry-run', action='store_true', help='report what would happen, change nothing')
        parser.add_argument('--covers', dest='covers_dir', default=None,
                            help='where cover thumbnails are written (default: covers/boeken/ next to the app)')
        parser.add_argument('--remove', action='store_true',
                            help='undo the import: delete the books it added, and take its data off books it joined')

    def handle(self, repo, user, dry_run, remove, covers_dir, **options):
        try:
            user = get_user_model().objects.get(username=user)
        except get_user_model().DoesNotExist:
            raise CommandError(f'There is no user "{user}".')
        if not remove and not repo:
            raise CommandError('Give the path of the boeken repository.')
        if has_old_books(user):
            raise CommandError('Some books are in the shape from before editions: run to_works first.')

        # Reading the booklog and making thumbnails takes minutes the first time. That happens
        # before the database is touched: a transaction here holds up every device's sync.
        if not remove:
            incoming = boeken.books(repo)
            made = self.thumbnails(incoming, Path(covers_dir) if covers_dir else covers.folder('boeken'), dry_run)
        with transaction.atomic():
            counts = self.remove(user) if remove else {**self.merge(user, incoming), 'cover thumbnails made': made}
            if dry_run:
                transaction.set_rollback(True)
        summary = ', '.join(f'{n} {what}' for what, n in counts.items())
        self.stdout.write(('Would be: ' if dry_run else 'Done: ') + summary)

    def thumbnails(self, incoming, folder, dry_run):
        """Point each post's edition at a small copy of its cover, making the copies that don't exist yet."""
        made, seen = 0, {}

        def small(source):
            """→ ('covers/boeken/….webp', ratio), or None for a picture that can't be read."""
            nonlocal made
            if source not in seen:
                target = folder / (hashlib.sha1(source.read_bytes()).hexdigest()[:16] + f'-{covers.WIDTH}.webp')
                try:
                    if target.exists():
                        ratio = covers.ratio_of(target)
                    else:
                        ratio = covers.ratio_of(source) if dry_run else covers.write_thumbnail(source, target)
                        made += 1
                    # Relative, so it is fetched from wherever the app is served.
                    seen[source] = (f'covers/boeken/{target.name}', ratio)
                except Exception as err:   # the edition keeps pointing at the booklog's own
                    self.stderr.write(f'No thumbnail for {source.name}: {err}')
                    seen[source] = None
            return seen[source]

        for book in incoming:
            for post in book['posts']:
                kept = post['cover_file'] and small(post['cover_file'])
                if kept:
                    # The booklog's own picture stays the source: the app shows it at full size.
                    post['edition'].update(cover=kept[0], coverRatio=kept[1], coverSource=post['edition']['cover'])
        return made

    def merge(self, user, incoming):
        now = timezone.now()
        rows = list(Book.objects.filter(user=user))
        by_key = {r.data['boeken']: r for r in rows if not r.deleted and r.data.get('boeken')}
        by_uid = {r.uid: r for r in rows}
        by_isbn = {}
        for row in rows:
            if not row.deleted and not row.data.get('boeken'):
                for edition in row.data.get('editions') or []:
                    if edition.get('isbn'):
                        by_isbn.setdefault(edition['isbn'], row)

        # Lists the user made in the same either-or set leave a book too when its status is set.
        either_or = READING_LISTS | {l.uid for l in List.objects.filter(user=user, deleted=False)
                                     if l.data.get('group') == READING_GROUP}
        counts = {'books in the booklog': len(incoming), 'added': 0, 'joined with a scanned book': 0,
                  'updated': 0, 'unchanged': 0, 'left deleted': 0,
                  'waiting to be published': 0,
                  'reviews': sum(1 for b in incoming for p in b['posts'] if p['review']), 'reviews kept as edited in the app': 0}

        # A book combined or split in the app waits for its posts to be regrouped (publish.py):
        # until then the booklog's groups are not its own, so it is left as the app has it, and
        # so are the groups of the books combined into it.
        waiting_regroup = {str(k) for r in rows if not r.deleted and r.data.get('regroup')
                           for k in [r.data.get('boeken'), *(r.data.get('joined') or [])] if k}
        for book in incoming:
            row = by_key.get(book['key'])
            joined = False
            if book['key'] in waiting_regroup or (row is not None and row.data.get('regroup')):
                counts['waiting to be published'] += 1
                continue
            if row is None:
                uid = boeken.uid_for(book['key'])
                if uid in by_uid and by_uid[uid].deleted:
                    counts['left deleted'] += 1   # removed in the app: that stands
                    continue
                row = next((by_isbn.pop(isbn) for isbn in sorted(book['isbns']) if isbn in by_isbn), None)
                if row is not None:
                    for isbn in [k for k, r in by_isbn.items() if r is row]:
                        by_isbn.pop(isbn)
                joined = row is not None

            data, waiting, kept = self.merged(row.data if row else None, book, either_or, joined)
            if waiting:
                counts['waiting to be published'] += 1
            counts['reviews kept as edited in the app'] += kept

            if row is None:
                Book.objects.create(user=user, uid=data['id'], data=data, title=data['title'][:300],
                                    modified=now, changed=now)
                counts['added'] += 1
            elif data != row.data:
                row.data, row.title, row.modified, row.changed = data, data['title'][:300], now, now
                row.save()
                counts['joined with a scanned book' if joined else 'updated'] += 1
            else:
                counts['unchanged'] += 1

        if any(b['list'] == 'abandoned' for b in incoming):
            self.ensure_abandoned_list(user, now)
        return counts

    def merged(self, old, book, either_or, joined):
        """A book as the booklog says it is, with what only the app knows of it kept. `old`: the
        book as it is on the shelf (None for a new one). → (book, what waits to be published, how
        many reviews were kept as edited in the app)"""
        flat = works.flat(old) if old else None
        waiting = publish.changed_keys(flat) if old else set()
        data = {k: copy.deepcopy(v) for k, v in (old or {}).items() if k not in boeken.FIELDS}
        if old is None:
            data.update(id=boeken.uid_for(book['key']), added=book['added'], editions=[])
        data.update(copy.deepcopy(book['fields']))
        # The title the app knows the book by stays while any read has it; else the first read's.
        if old and old.get('title') in book['titles']:
            data['title'] = old['title']
        editions = data['editions']

        # Each post is of an edition (see the top of this file).
        main = works.main_edition(old) if old else None
        previous = {r['boeken']: r for r in (flat or {}).get('reviews') or [] if isinstance(r, dict) and r.get('boeken')}
        edited = {r.get('ed') for r in previous.values() if r.get('sum') and not boeken.in_step(r)}
        claims, posts = {}, {}
        for post in book['posts']:
            # A post titled otherwise than the book (a translation read) is of an edition with that title.
            post['edition'].pop('title', None)
            if post['title'] != data['title']:
                post['edition']['title'] = post['title']
            said = booklog_facts(post['edition'])
            known = previous.get(post['slug'])
            ed = known.get('ed') if known and works.edition_of(data, known.get('ed')) else None
            # The read planned or running is of the main edition, whether the book names it (with
            # several editions) or not (one edition: the app leaves `main` out).
            if ed is None and post['slug'] == book['open'] and not post['review'] and main and works.edition_of(data, main['id']):
                ed = main['id']
            if ed is not None and ed in claims and claims[ed] != said:
                ed = None   # one edition, two different sets of facts: two editions
            if ed is None:
                ed = next((e['id'] for e in editions if booklog_facts(e) == said and claims.get(e['id'], said) == said), None)
            if ed is None and joined and post['edition'].get('isbn'):
                ed = next((e['id'] for e in editions if e.get('isbn') == post['edition']['isbn'] and e['id'] not in claims), None)
            if ed is None:
                ed = edition_uid(post['slug'])
                while works.edition_of(data, ed):
                    ed += '-2'
                editions.append({'id': ed, 'added': book['added']})
            claims.setdefault(ed, said)
            posts[post['slug']] = ed
            # The booklog's facts of the edition, except what the app changed and didn't publish yet.
            edition = works.edition_of(data, ed)
            if ed in edited:
                continue
            keep = set()
            if main and ed == main['id']:
                for key in waiting:
                    keep |= {'cover': {'cover', 'coverRatio', 'coverSource'}}.get(key, {key})
            for key in EDITION_OWNED:
                if key in keep:
                    continue
                if post['edition'].get(key) not in (None, '', []):
                    edition[key] = copy.deepcopy(post['edition'][key])
                else:
                    edition.pop(key, None)

        # Reading status is the book's: the latest read's, unless the app changed it.
        on = {k: v for k, v in (old or {}).get('lists', {}).items() if k not in either_or}
        on[book['list']] = {'at': book['at']}
        data['lists'] = on
        if book['open']:
            data['main'] = posts[book['open']]
        else:
            data.pop('main', None)
        for key in waiting:
            if key in boeken.FIELDS:
                if key in old:
                    data[key] = copy.deepcopy(old[key])
                else:
                    data.pop(key, None)
        if 'list' in waiting:
            data['lists'] = copy.deepcopy(old.get('lists') or {})
            if old.get('main'):
                data['main'] = old['main']
            else:
                data.pop('main', None)
        # How progress is said (page or percentage) is chosen in the app, per read.
        if 'reading' not in data['lists']:
            data.pop('progressUnit', None)
            data.pop('percentRead', None)

        incoming = []
        for post in book['posts']:
            if post['review']:
                review = {**post['review'], 'ed': posts[post['slug']]}
                review['sum'] = boeken.review_sum({**review, 'edition': post['edition']})
                incoming.append(review)
        reviews, kept = merged_reviews((flat or {}).get('reviews'), incoming, set((old or {}).get('dropReads') or []), set((old or {}).get('unpublish') or []))
        if reviews:
            data['reviews'] = reviews
        else:
            data.pop('reviews', None)
        works.settle(data)
        data['boekenState'] = old['boekenState'] if waiting else boeken.state_of(works.flat(data))
        return data, waiting, kept

    def ensure_abandoned_list(self, user, now):
        """The app's standard lists have no "abandoned"; the booklog does."""
        if List.objects.filter(user=user, uid='abandoned').exists():
            return
        data = {'id': 'abandoned', 'name': 'Abandoned', 'group': READING_GROUP, 'noteLabel': '', 'order': 3.5}
        List.objects.create(user=user, uid='abandoned', data=data, name=data['name'], modified=now, changed=now)

    def remove(self, user):
        now = timezone.now()
        counts = {'deleted': 0, 'separated from a scanned book': 0}
        for row in Book.kept(user):
            if not row.data.get('boeken'):
                continue
            if row.uid == boeken.uid_for(row.data['boeken']):
                row.data, row.deleted = {}, True   # a tombstone, so it leaves every device
                counts['deleted'] += 1
            else:
                keep = {k: v for k, v in row.data.items() if k not in boeken.FIELDS and k not in ('boekenState', 'boekenError', 'main')}
                keep['title'] = row.data.get('title', '')
                keep['author'] = row.data.get('author', '')
                keep['lists'] = {k: v for k, v in (keep.get('lists') or {}).items() if k not in READING_LISTS}
                keep['reviews'] = [r for r in keep.get('reviews') or [] if not r.get('boeken')]
                if not keep['reviews']:
                    del keep['reviews']
                # The editions the import made go; the one that was scanned stays.
                editions = [e for e in keep.get('editions') or [] if not str(e.get('id', '')).startswith('ed-')]
                keep['editions'] = editions or (keep.get('editions') or [])[:1]
                row.data = works.settle(keep)
                counts['separated from a scanned book'] += 1
            row.modified = row.changed = now
            row.save()
        return counts
