"""Sends the books with a reading status to the user's library on Hardcover (docs/server.md,
"Hardcover sync"; docs/hardcover-sync-plan.md).

    manage.py sync_hardcover --user NAME [--dry-run] [--limit N] [--budget N] [--verbose]

One way: Folio is the record. Each book's status, rating (when it has one) and dated reads go
over; reviews, categories, tags and places don't. A book already on Hardcover is adopted, never
deleted; one the sync added is removed again when it leaves the shelf or loses its status.
Books are matched by ISBN or ASIN only; the rest are counted as unmatched.

Meant for a nightly timer (setup-hardcover-sync.sh). An unchanged book costs no request; a run
stops at --budget requests (default 2,000 of the 5,000 a day the free plan allows) and the next
one carries on. It needs HARDCOVER_API_TOKEN in server/.env.
"""
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from shelf import hardcover, hardcover_sync


class Command(BaseCommand):
    help = 'Send the books with a reading status to Hardcover (one way, repeatable).'

    def add_arguments(self, parser):
        parser.add_argument('--user', required=True, help='whose shelf')
        parser.add_argument('--dry-run', action='store_true', help='say what would change; write nothing (it still asks Hardcover)')
        parser.add_argument('--limit', type=int, help='write at most this many books in this run')
        parser.add_argument('--budget', type=int, default=2000, help='requests this run may use (default 2000)')
        parser.add_argument('--verbose', action='store_true', help='a line per book written, unmatched or shared')

    def handle(self, user, dry_run, limit, budget, verbose, **options):
        try:
            account = get_user_model().objects.get(username=user)
        except get_user_model().DoesNotExist:
            raise CommandError(f'There is no user "{user}".')
        client = hardcover_sync.Client(budget=budget)
        lines = []
        try:
            counts, fields = hardcover_sync.run(account, client, dry_run=dry_run, limit=limit,
                                                say=(self.stdout.write if verbose else lines.append))
        except hardcover.Unavailable as err:
            raise CommandError(f'Hardcover: {err}')
        said = {k: v for k, v in counts.items() if v}
        busy = any(counts[k] for k in ('added', 'updated', 'removed', 'failed', 'left for later')) or verbose or dry_run
        if busy:
            prefix = 'Would change' if dry_run else 'Hardcover'
            self.stdout.write(f'{prefix}: ' + ', '.join(f'{v} {k}' for k, v in said.items()) + f' ({client.used} requests)')
            if fields:
                self.stdout.write('Fields that differ on adopted books: ' + ', '.join(f'{k} {v}' for k, v in sorted(fields.items())))
        if counts['failed']:
            for line in lines:
                if line.startswith('failed'):
                    self.stderr.write(line)
            raise CommandError(f'{counts["failed"]} books failed; they are tried again next run.')
