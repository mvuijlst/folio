"""Fills the page count of editions on the shelf that have none (shelf/pages.py).

    manage.py fill_pages --user NAME [--write] [--booklog] [--no-median] [--pause SECONDS]

For each paper or e-book edition with an ISBN-13 and no pages: Hardcover's page count for that ISBN
(25 ISBNs a request; it needs HARDCOVER_API_TOKEN), and for those it has none of, the median page
count of the Open Library work (one request each; `--no-median` leaves them empty instead). The
median is the work's, not the edition's own: near it for most books, further off for an omnibus or
a large-print edition. A page count already said is never changed. `--pause` seconds between
requests (Hardcover allows about 60 a minute).

Books on the booklog are left out unless `--booklog`: their pages are published there, and filling
them publishes those pages again.

Without --write it only says what it would do. A changed book keeps its `modified` (an edit made on a
device since still wins) and gets a new `changed`, so every device fetches it. Repeatable.
"""
import re
import time

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from shelf import pages
from shelf.models import Book


def wants_pages(edition):
    if edition.get('pages') or edition.get('publication') or not re.fullmatch(r'\d{13}', str(edition.get('isbn') or '')):
        return False
    return edition.get('format') != 'audiobook' and not (edition.get('duration') and not edition.get('format'))


class Command(BaseCommand):
    help = 'Fill empty page counts of editions from Hardcover and Open Library (repeatable).'

    def add_arguments(self, parser):
        parser.add_argument('--user', required=True, help='whose shelf')
        parser.add_argument('--write', action='store_true', help='change the shelf (without it: only say what would change)')
        parser.add_argument('--booklog', action='store_true', help='also books on the booklog (their pages are published again)')
        parser.add_argument('--no-median', action='store_true', help="don't fall back on Open Library's median page count")
        parser.add_argument('--pause', type=float, default=1.0, help='seconds between requests (default 1)')

    def say(self, line):
        self.stdout.write(line)
        self.stdout.flush()

    def handle(self, user, write, booklog, no_median, pause, **options):
        try:
            account = get_user_model().objects.get(username=user)
        except get_user_model().DoesNotExist:
            raise CommandError(f'There is no user "{user}".')

        rows, asks, skipped = {}, {}, 0
        for row in Book.shelf(account).order_by('pk'):
            for edition in row.data.get('editions') or []:
                if not wants_pages(edition):
                    continue
                if row.data.get('boeken') and not booklog:
                    skipped += 1
                    continue
                rows[row.pk] = row
                asks.setdefault(edition['isbn'], []).append((row.pk, edition.get('id')))

        found, by, failed = {}, {'Hardcover': 0, 'Open Library median': 0}, 0
        isbns = list(asks)
        self.say(f'{len(isbns)} ISBNs without pages to look up' + (f' ({skipped} editions on the booklog left out).' if skipped else '.'))
        if pages.token():
            self.say(f'Asking Hardcover, {pages.BATCH} at a time…')
            for start in range(0, len(isbns), pages.BATCH):
                part = isbns[start:start + pages.BATCH]
                try:
                    got = pages.hardcover(part)
                    found.update(got)
                    by['Hardcover'] += len(got)
                except Exception as err:
                    failed += len(part)
                    self.stderr.write(f'Hardcover did not answer: {err}')
                self.say(f'  Hardcover: {min(start + pages.BATCH, len(isbns))} of {len(isbns)} asked, {by["Hardcover"]} found')
                time.sleep(pause)
        else:
            self.stderr.write('No HARDCOVER_API_TOKEN: Hardcover is not asked (is server/.env loaded? set -a; . ./.env; set +a).')
            self.stderr.flush()
        if not no_median:
            rest = [i for i in isbns if i not in found]
            if rest:
                self.say(f'Asking Open Library for the median of {len(rest)}, one at a time (about {round(len(rest) * (pause + 0.5) / 60) or 1} min)…')
            for n, isbn in enumerate(rest, 1):
                try:
                    n = pages.median(isbn)
                    if n:
                        found[isbn] = n
                        by['Open Library median'] += 1
                except Exception as err:
                    self.stderr.write(f'Open Library did not answer for {isbn}: {err}')
                if n % 20 == 0 or n == len(rest):
                    self.say(f'  Open Library: {n} of {len(rest)} asked, {by["Open Library median"]} found')
                time.sleep(pause)

        changed, filled = set(), 0
        for isbn, places in asks.items():
            if not found.get(isbn):
                continue
            for pk, ed_id in places:
                edition = next((e for e in rows[pk].data['editions'] if e.get('id') == ed_id), None)
                if edition is not None and not edition.get('pages'):
                    edition['pages'] = found[isbn]
                    filled += 1
                    changed.add(pk)

        written = 0
        if write:
            for pk in changed:
                row = rows[pk]
                fresh = Book.objects.get(pk=pk)
                if fresh.deleted or fresh.modified != row.modified:
                    continue   # changed on a device meanwhile: left for another run
                fresh.data = row.data
                fresh.changed = timezone.now()
                fresh.save(update_fields=['data', 'changed'])
                written += 1

        verb = 'Filled' if write else 'Would fill'
        self.stdout.write(f'Asked about {len(asks)} ISBNs: {by["Hardcover"]} from Hardcover, {by["Open Library median"]} from '
                          f'the Open Library median, {len(asks) - len(found)} without{f" ({failed} not answered by Hardcover)" if failed else ""}.')
        self.stdout.write(f'{verb} the pages of {filled} editions, in {len(changed)} books' + (f' ({written} written)' if write else '') + '.')
        if skipped:
            self.stdout.write(f'{skipped} editions of books on the booklog were left out (--booklog to include them).')
        if not write:
            self.stdout.write('Nothing was changed. Run again with --write.')
