"""Brings the booklog (mvuijlst/boeken) into one user's shelf.

    manage.py import_boeken /path/to/boeken --user NAME [--dry-run]
    manage.py import_boeken --user NAME --remove [--dry-run]

Safe to run again: the booklog is the source for what it knows (title, author, rating,
reading status, …), so those are set afresh each time, and a book is only stored when
something changed. Everything else about a book is left alone: the other lists it is on,
its notes, its cover thumbnail.

Reviews: every read in the booklog is a review of the book, with the day it was read, the
rating and the text. Reviews written in the app are kept, and so is a booklog review that
was edited in the app (until publishing back to the booklog exists, the app's text would
otherwise be lost).

A booklog book that is already on the shelf (same ISBN, scanned earlier) is joined with it
instead of added a second time. A booklog book that was deleted in the app stays deleted.

Covers: the booklog's images are full-size, far too heavy for a list of thumbnails. For
each cover found in the repository's media/ folder a small WebP is written to covers/boeken/
next to the app (see shelf/covers.py), named after the image's content, and the book points
at that. Where the image is missing, the book points at the booklog's own copy.
"""
import hashlib
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from shelf import boeken, covers, publish
from shelf.models import Book, List

READING_GROUP = 'Reading status'
READING_LISTS = set(boeken.STATUS_LISTS.values())


def merged_reviews(old, incoming):
    """The booklog's reviews next to the ones made or edited in the app. → (reviews, how many were kept as edited)"""
    old = [r for r in old or [] if isinstance(r, dict)]
    previous = {r['boeken']: r for r in old if r.get('boeken')}
    out, kept = [r for r in old if not r.get('boeken')], 0
    for review in incoming:
        before = previous.get(review['boeken'])
        if before and before.get('sum') and not boeken.in_step(before):
            out.append(before)
            kept += 1
        else:
            out.append(review)
    # Oldest read first; what has no reading date comes last.
    return sorted(out, key=lambda r: (not r.get('date'), r.get('date') or '', r.get('id') or '')), kept


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
        """Point each book, and each read's edition, at a small copy of its cover, making the
        copies that don't exist yet. Then every review gets its fingerprint."""
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
                except Exception as err:   # the book keeps pointing at the booklog's own
                    self.stderr.write(f'No thumbnail for {source.name}: {err}')
                    seen[source] = None
            return seen[source]

        for book in incoming:
            kept = book['cover_file'] and small(book['cover_file'])
            if kept:
                book['fields'].update(cover=kept[0], coverRatio=kept[1])
            for review in book['reviews']:
                source = book['review_covers'].get(review['id'])
                kept = source and small(source)
                if kept:
                    review['edition'].update(cover=kept[0], coverRatio=kept[1])
                review['sum'] = boeken.review_sum(review)
        return made

    def merge(self, user, incoming):
        now = timezone.now()
        rows = list(Book.objects.filter(user=user))
        by_key = {r.data['boeken']: r for r in rows if not r.deleted and r.data.get('boeken')}
        by_uid = {r.uid: r for r in rows}
        by_isbn = {}
        for row in rows:
            if not row.deleted and not row.data.get('boeken') and row.data.get('isbn'):
                by_isbn.setdefault(row.data['isbn'], row)

        # Lists the user made in the same either-or set leave a book too when its status is set.
        either_or = READING_LISTS | {l.uid for l in List.objects.filter(user=user, deleted=False)
                                     if l.data.get('group') == READING_GROUP}
        counts = {'books in the booklog': len(incoming), 'added': 0, 'joined with a scanned book': 0,
                  'updated': 0, 'unchanged': 0, 'left deleted': 0,
                  'waiting to be published': 0,
                  'reviews': sum(len(b['reviews']) for b in incoming), 'reviews kept as edited in the app': 0}

        for book in incoming:
            row = by_key.get(book['key'])
            joined = False
            if row is None:
                uid = boeken.uid_for(book['key'])
                if uid in by_uid and by_uid[uid].deleted:
                    counts['left deleted'] += 1   # removed in the app: that stands
                    continue
                row = next((by_isbn.pop(isbn) for isbn in sorted(book['isbns']) if isbn in by_isbn), None)
                joined = row is not None

            old = row.data if row else {'id': boeken.uid_for(book['key']), 'added': book['added'], 'thumb': ''}
            data = {k: v for k, v in old.items() if k not in boeken.FIELDS}
            data.update(book['fields'])
            if joined and old.get('isbn'):
                data['isbn'] = old['isbn']   # keep the edition that is on the shelf
            # A book from before lists existed counts as in the library; say so now that it gets lists.
            on = dict(old['lists']) if isinstance(old.get('lists'), dict) else ({'library': {'at': old['added']}} if row else {})
            on = {k: v for k, v in on.items() if k not in either_or}
            on[book['list']] = {'at': book['at']}
            data['lists'] = on
            # What was changed in the app and not published yet stays as the app has it;
            # everything else is, from here on, what the app and the booklog agree on.
            waiting = publish.changed_keys(old) if row else set()
            for key in waiting:
                for name in {'list': [], 'cover': ['cover', 'coverRatio', 'coverSource']}.get(key, [key]):
                    data.pop(name, None)
                    if name in old:
                        data[name] = old[name]
            if 'list' in waiting:
                data['lists'] = old.get('lists') or {}
            # How progress is said (page or percentage) is chosen in the app, per read.
            if 'reading' not in data['lists']:
                data.pop('progressUnit', None)
                data.pop('percentRead', None)
            if waiting:
                counts['waiting to be published'] += 1
                data['boekenState'] = old['boekenState']
            else:
                data['boekenState'] = boeken.state_of(data)
            data['reviews'], kept = merged_reviews(old.get('reviews'), book['reviews'])
            counts['reviews kept as edited in the app'] += kept
            if not data['reviews']:
                del data['reviews']

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

    def ensure_abandoned_list(self, user, now):
        """The app's standard lists have no "abandoned"; the booklog does."""
        if List.objects.filter(user=user, uid='abandoned').exists():
            return
        data = {'id': 'abandoned', 'name': 'Abandoned', 'group': READING_GROUP, 'noteLabel': '', 'order': 3.5}
        List.objects.create(user=user, uid='abandoned', data=data, name=data['name'], modified=now, changed=now)

    def remove(self, user):
        now = timezone.now()
        counts = {'deleted': 0, 'separated from a scanned book': 0}
        scanned = ('title', 'author', 'publisher', 'date', 'pages', 'isbn', 'cover', 'coverRatio', 'coverSource')
        for row in Book.objects.filter(user=user, deleted=False):
            if not row.data.get('boeken'):
                continue
            if row.uid == boeken.uid_for(row.data['boeken']):
                row.data, row.deleted = {}, True   # a tombstone, so it leaves every device
                counts['deleted'] += 1
            else:
                keep = {k: v for k, v in row.data.items() if (k not in boeken.FIELDS and k not in ('boekenState', 'boekenError')) or k in scanned}
                keep['lists'] = {k: v for k, v in (keep.get('lists') or {}).items() if k not in READING_LISTS}
                keep['reviews'] = [r for r in keep.get('reviews') or [] if not r.get('boeken')]
                if not keep['reviews']:
                    del keep['reviews']
                row.data = keep
                counts['separated from a scanned book'] += 1
            row.modified = row.changed = now
            row.save()
        return counts
