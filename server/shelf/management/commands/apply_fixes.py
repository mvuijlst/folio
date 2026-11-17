"""Applies a list of corrections to books only on the shelf, and combines duplicate copies.

    manage.py apply_fixes FILE --user NAME [--write]

FILE is JSON with two parts, either may be left out:

  "change":  {book id: {"book": {field: [old, new]}, "editions": {edition id: {field: [old, new]}}}}
  "combine": [{"absorbed": book id, "survivor": book id}]

A change is made only where the field still holds `old` (a book edited on a device since the list
was made is left alone and reported); a `new` of null removes the field. Booklog books are left
alone: the booklog says their facts. A changed book keeps its `modified` (an edit made on a device
since still wins) and gets a new `changed`, so every device fetches it.

A combine is the app's "Combine with another book" (shelf/works.py combine): the absorbed book,
which must be only on the shelf, gives its editions and reads to the survivor (which may be in the
booklog: an edition without reads publishes nothing) and is deleted. An absorbed edition whose book
had another title keeps that title, as a translation does. Both get a new `modified`.
Without --write it only says what it would do. Made for the audit of 2026-11-17.
"""
import copy
import json

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from shelf import works
from shelf.models import Book

MISSING = object()


def same(value, old):
    return value == old or (value in (None, '', []) and old in (None, '', []))


def put(target, field, new):
    if new is None:
        target.pop(field, None)
    else:
        target[field] = new


class Command(BaseCommand):
    help = 'Apply audited corrections to shelf-only books and combine duplicates (dry run unless --write).'

    def add_arguments(self, parser):
        parser.add_argument('file', help='JSON: {"change": {...}, "combine": [...]}')
        parser.add_argument('--user', required=True, help='whose shelf')
        parser.add_argument('--write', action='store_true', help='change the books (without it, only report)')

    def handle(self, file, user, write, **options):
        try:
            account = get_user_model().objects.get(username=user)
        except get_user_model().DoesNotExist:
            raise CommandError(f'There is no user "{user}".')
        with open(file, encoding='utf-8') as f:
            plan = json.load(f)
        now = timezone.now()
        changed, combined, skipped = 0, 0, []
        books = {row.uid: row for row in Book.objects.filter(user=account, deleted=False)}

        with transaction.atomic():
            for uid, spec in (plan.get('change') or {}).items():
                row = books.get(uid)
                if row is None:
                    skipped.append(f'{uid}: not on the shelf')
                    continue
                data = copy.deepcopy(row.data)
                if data.get('boeken'):
                    skipped.append(f'{row.title}: in the booklog')
                    continue
                stale = [f for f, (old, _) in (spec.get('book') or {}).items() if not same(data.get(f), old)]
                for ed, fields in (spec.get('editions') or {}).items():
                    edition = works.edition_of(data, ed)
                    if edition is None:
                        stale.append(f'edition {ed}')
                        continue
                    stale += [f'{f}@{ed}' for f, (old, _) in fields.items() if not same(edition.get(f), old)]
                if stale:
                    skipped.append(f'{row.title}: changed since ({", ".join(stale)})')
                    continue
                for field, (_, new) in (spec.get('book') or {}).items():
                    put(data, field, new)
                for ed, fields in (spec.get('editions') or {}).items():
                    for field, (_, new) in fields.items():
                        put(works.edition_of(data, ed), field, new)
                changed += 1
                if write:
                    row.data = data
                    if data.get('title'):
                        row.title = str(data['title'])[:300]
                    row.changed = now
                    row.save(update_fields=['data', 'title', 'changed'])

            for pair in plan.get('combine') or []:
                absorbed, survivor = books.get(pair['absorbed']), books.get(pair['survivor'])
                if absorbed is None or survivor is None:
                    skipped.append(f'combine {pair}: a book is not on the shelf')
                    continue
                if absorbed.data.get('boeken') or any(isinstance(r, dict) and r.get('boeken') for r in absorbed.data.get('reviews') or []):
                    skipped.append(f'combine {absorbed.title}: it is in the booklog')
                    continue
                theirs = copy.deepcopy(absorbed.data)
                if (theirs.get('title') or '') != (survivor.data.get('title') or ''):
                    for edition in theirs.get('editions') or []:
                        edition.setdefault('title', theirs.get('title'))
                data = works.combine(copy.deepcopy(survivor.data), theirs)
                combined += 1
                if write:
                    survivor.data = data
                    survivor.modified = survivor.changed = now
                    survivor.save(update_fields=['data', 'modified', 'changed'])
                    absorbed.deleted = True
                    absorbed.modified = absorbed.changed = now
                    absorbed.save(update_fields=['deleted', 'modified', 'changed'])

        verb = 'Changed' if write else 'Would change'
        self.stdout.write(f'{verb} {changed} books and {"combined" if write else "combine"} {combined} pairs.')
        for line in skipped:
            self.stdout.write(f'  skipped {line}')
