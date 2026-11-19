"""Gives books that are only on the shelf the tags a list says, beside the ones they have.

    manage.py add_tags FILE --user NAME [--write]

FILE is JSON: {book id: [tags it gets]}. Only books not in the booklog are changed: the
booklog's books take their tags from its posts, by the import. A tag a book has already is
left as it is, and nothing is ever taken away. A changed book keeps its `modified` (an edit
made on a device since still wins) and gets a new `changed`, so every device fetches it.
Without --write it only says what it would do. Made for the tag young-adult of D-057
(2026-11-19); see set_categories for the categories.
"""
import json

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from shelf.models import Book


class Command(BaseCommand):
    help = "Add tags to books only on the shelf from a JSON list (dry run unless --write)."

    def add_arguments(self, parser):
        parser.add_argument('file', help='JSON: {book id: [tags]}')
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
        for uid, tags in wanted.items():
            row = Book.objects.filter(user=account, uid=uid, deleted=False).first()
            if row is None:
                skipped.append(f'{uid}: not on the shelf')
                continue
            data = row.data
            if data.get('boeken'):
                skipped.append(f'{row.title}: in the booklog')
                continue
            has = list(data.get('tags') or [])
            new = [str(tag) for tag in tags or [] if str(tag) not in has]
            if not new:
                continue
            done += 1
            if write:
                data['tags'] = has + list(dict.fromkeys(new))
                row.data = data
                row.changed = now
                row.save(update_fields=['data', 'changed'])
        self.stdout.write(f'{"Changed" if write else "Would change"} {done} books.')
        for line in skipped:
            self.stdout.write(f'  skipped {line}')
