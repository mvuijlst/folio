"""Gives books that are only on the shelf the categories a list says.

    manage.py set_categories FILE --user NAME [--write]

FILE is JSON: {book id: {"from": [categories it has now], "to": [categories it gets]}}. Only
books not in the booklog are changed: the booklog's books take their categories from its posts,
by the import. A book whose categories are no longer "from" (changed on a device since the list
was made) is left alone and reported. A changed book keeps its `modified` (an edit made on a
device since still wins) and gets a new `changed`, so every device fetches it. Without --write
it only says what it would do. Made for the new categories of D-055 (2026-11-17).
"""
import json

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from shelf.models import Book


class Command(BaseCommand):
    help = "Set the categories of books only on the shelf from a JSON list (dry run unless --write)."

    def add_arguments(self, parser):
        parser.add_argument('file', help='JSON: {book id: {"from": [...], "to": [...]}}')
        parser.add_argument('--user', required=True, help='whose shelf')
        parser.add_argument('--write', action='store_true', help='change the books (without it, only report)')

    def handle(self, file, user, write, **options):
        try:
            account = get_user_model().objects.get(username=user)
        except get_user_model().DoesNotExist:
            raise CommandError(f'There is no user "{user}".')
        with open(file, encoding='utf-8') as f:
            wanted = json.load(f)
        done, skipped = 0, []
        now = timezone.now()
        for uid, change in wanted.items():
            row = Book.objects.filter(user=account, uid=uid, deleted=False).first()
            if row is None:
                skipped.append(f'{uid}: not on the shelf')
                continue
            data = row.data
            if data.get('boeken'):
                skipped.append(f'{row.title}: in the booklog')
                continue
            if list(data.get('categories') or []) != list(change.get('from') or []):
                skipped.append(f'{row.title}: has {data.get("categories")}, not {change.get("from")}')
                continue
            to = [str(c) for c in change.get('to') or []]
            if to == list(data.get('categories') or []):
                continue
            done += 1
            if write:
                if to:
                    data['categories'] = to
                else:
                    data.pop('categories', None)
                row.data = data
                row.changed = now
                row.save(update_fields=['data', 'changed'])
        self.stdout.write(f'{"Changed" if write else "Would change"} {done} books.')
        for line in skipped:
            self.stdout.write(f'  skipped {line}')
