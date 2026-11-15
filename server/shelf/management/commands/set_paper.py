"""Books that are only in the app and don't say what they are read as become paper books.

    manage.py set_paper --user NAME [--write]

Without --write it only counts. A book of the booklog is left alone (the booklog says its
format), and so is one with a length: that is an audiobook already. A changed book counts as
edited now, so every device fetches it on its next sync.
"""
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from shelf import boeken
from shelf.models import Book


class Command(BaseCommand):
    help = 'Say "paper" for every app-only book that has no format (repeatable).'

    def add_arguments(self, parser):
        parser.add_argument('--user', required=True)
        parser.add_argument('--write', action='store_true', help='change them; without it, only count')

    def handle(self, user, write, **options):
        try:
            account = get_user_model().objects.get(username=user)
        except get_user_model().DoesNotExist:
            raise CommandError(f'There is no user "{user}".')
        changed, audio, booklog = [], 0, 0
        with transaction.atomic():
            for row in Book.objects.select_for_update().filter(user=account, deleted=False):
                data = row.data or {}
                if data.get('format') in boeken.FORMATS:
                    continue
                if data.get('boeken'):
                    booklog += 1
                elif data.get('duration'):
                    audio += 1
                else:
                    changed.append(row)
            if write:
                now = timezone.now()
                for row in changed:
                    row.data = {**row.data, 'format': 'paper'}
                    row.modified = row.changed = now
                    row.save(update_fields=['data', 'modified', 'changed'])
        self.stdout.write(f'{"Set" if write else "Would set"} paper on {len(changed)} book(s) only in the app; '
                          f'left alone: {audio} with a length, {booklog} of the booklog without a format.')
        for row in changed[:15]:
            self.stdout.write(f'  {row.title or row.uid}')
        if len(changed) > 15:
            self.stdout.write(f'  … and {len(changed) - 15} more')
