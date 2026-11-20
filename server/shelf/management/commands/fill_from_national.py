"""Fills empty facts of editions on the shelf from their national catalogue (shelf/national.py).

    manage.py fill_from_national --user NAME [--write] [--booklog] [--pause SECONDS]

For each edition with an ISBN whose group has a national catalogue (978-90/94: the KB; 978-2,
979-10: the BnF) and that lacks a publisher, a year, a page count or a language: what the catalogue
says fills those, and only those. What is said already is never changed. The KB is asked 50 ISBNs at
a time, the BnF one at a time; `--pause` seconds between requests.

The year is that of the printing the catalogue has for the ISBN, which may be a later one than the
copy on the shelf (measured 2026-11-20: where both said a year, 86 agreed and 68 differed).

Books on the booklog are left out unless `--booklog`: their publisher, year and pages are on their
pages there, and filling them publishes those pages again.

Without --write it only says what it would do. A changed book keeps its `modified` (an edit made on a
device since still wins) and gets a new `changed`, so every device fetches it. Repeatable.
"""
import time

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from shelf import national
from shelf.models import Book

KEYS = ('publisher', 'date', 'pages', 'language')


def wanted(edition):
    return [key for key in KEYS if edition.get(key) in (None, '', 0)]


class Command(BaseCommand):
    help = 'Fill empty publisher, year, pages and language of editions from the KB and the BnF (repeatable).'

    def add_arguments(self, parser):
        parser.add_argument('--user', required=True, help='whose shelf')
        parser.add_argument('--write', action='store_true', help='change the shelf (without it: only say what would change)')
        parser.add_argument('--booklog', action='store_true', help='also books on the booklog (their pages are published again)')
        parser.add_argument('--pause', type=float, default=1.0, help='seconds between requests (default 1)')

    def handle(self, user, write, booklog, pause, **options):
        try:
            account = get_user_model().objects.get(username=user)
        except get_user_model().DoesNotExist:
            raise CommandError(f'There is no user "{user}".')

        # Which editions want what, by ISBN.
        rows, asks, skipped = {}, {}, 0
        for row in Book.shelf(account).order_by('pk'):
            for edition in row.data.get('editions') or []:
                isbn = str(edition.get('isbn') or '')
                if not national.national_for(isbn) or not wanted(edition):
                    continue
                if row.data.get('boeken') and not booklog:
                    skipped += 1
                    continue
                rows[row.pk] = row
                asks.setdefault(isbn, []).append((row.pk, edition.get('id')))

        # Ask: the KB in fifties, the BnF one by one.
        found, failed = {}, 0
        kb = [isbn for isbn in asks if national.national_for(isbn) == 'kb']
        bnf = [isbn for isbn in asks if national.national_for(isbn) == 'bnf']
        for start in range(0, len(kb), 50):
            try:
                found.update(national.kb_many(kb[start:start + 50]))
            except Exception as err:
                failed += len(kb[start:start + 50])
                self.stderr.write(f'The KB did not answer: {err}')
            time.sleep(pause)
        for isbn in bnf:
            try:
                book = national.lookup(isbn)
                if book:
                    found[isbn] = book
            except Exception as err:
                failed += 1
                self.stderr.write(f'The BnF did not answer for {isbn}: {err}')
            time.sleep(pause)

        # Fill what is empty.
        filled = {key: 0 for key in KEYS}
        changed = set()
        for isbn, places in asks.items():
            theirs = found.get(isbn)
            if not theirs:
                continue
            for pk, ed_id in places:
                edition = next((e for e in rows[pk].data['editions'] if e.get('id') == ed_id), None)
                for key in wanted(edition or {}):
                    if theirs.get(key):
                        edition[key] = theirs[key]
                        filled[key] += 1
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
        self.stdout.write(f'Asked about {len(asks)} ISBNs ({len(kb)} KB, {len(bnf)} BnF): {len(found)} known, '
                          f'{len(asks) - len(found) - failed} not known, {failed} not answered.')
        self.stdout.write(f'{verb}: ' + ', '.join(f'{n} {key}' for key, n in filled.items()) + f', in {len(changed)} books'
                          + (f' ({written} written)' if write else '') + '.')
        if skipped:
            self.stdout.write(f'{skipped} editions of books on the booklog were left out (--booklog to include them).')
        if not write:
            self.stdout.write('Nothing was changed. Run again with --write.')
