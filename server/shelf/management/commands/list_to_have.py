"""Turns a list of copies into whether they are still here (app.js: haveOf), and removes the list.

    manage.py list_to_have --user NAME --list ID --have go|gone [--write]

Every paper copy on list ID gets `have` (go: can go; gone: gone, and off the lists of where it
stands, as the app does) and comes off the list. A copy on it that isn't paper (an e-book on
Mag weg) only comes off the list, and is named. Then the list itself is deleted, as a device
deletes one. A changed book keeps its `modified` (an edit made on a device since still wins) and
gets a new `changed`, so every device fetches it.

Without --write it only says what it would do. Made for Mag weg, the renamed standard list
`library`, which became "can go" on 2026-11-20.
"""
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from shelf.models import Book, List

READING = 'Reading status'


def is_paper(edition, book):
    return edition.get('format') == 'paper'


class Command(BaseCommand):
    help = 'Give the paper copies on a list a status (can go / gone) and delete the list.'

    def add_arguments(self, parser):
        parser.add_argument('--user', required=True, help='whose shelf')
        parser.add_argument('--list', required=True, help='the id of the list (Mag weg: library)')
        parser.add_argument('--have', required=True, choices=['go', 'gone'], help='what its copies become')
        parser.add_argument('--write', action='store_true', help='change the shelf (without it: only say what would change)')

    def handle(self, user, list, have, write, **options):
        list_id = list
        try:
            account = get_user_model().objects.get(username=user)
        except get_user_model().DoesNotExist:
            raise CommandError(f'There is no user "{user}".')
        try:
            the_list = List.objects.get(user=account, uid=list_id, deleted=False)
        except List.DoesNotExist:
            raise CommandError(f'{user} has no list "{list_id}".')
        name = the_list.data.get('name') or list_id
        # The lists of where a copy stands: any either-or set but reading status.
        places = {row.uid for row in List.objects.filter(user=account, deleted=False)
                  if row.data.get('group') and row.data.get('group') != READING}

        marked, other, books = 0, [], []
        with transaction.atomic():
            for row in Book.objects.filter(user=account, deleted=False).order_by('pk'):
                data = row.data
                changed = False
                for edition in data.get('editions') or []:
                    on = edition.get('lists')
                    if not isinstance(on, dict) or list_id not in on:
                        continue
                    del on[list_id]
                    if is_paper(edition, data):
                        edition['have'] = have
                        if have == 'gone':
                            for place in [key for key in on if key in places]:
                                del on[place]
                        marked += 1
                    else:
                        other.append(f'{row.title or row.uid} ({edition.get("format") or "no format"})')
                    if not on:
                        edition.pop('lists', None)
                    changed = True
                if changed:
                    books.append(row.pk)
                    if write:
                        row.data = data
                        row.changed = timezone.now()
                        row.save(update_fields=['data', 'changed'])
            if write:
                now = timezone.now()
                the_list.data, the_list.deleted, the_list.modified, the_list.changed = {}, True, now, now
                the_list.save()

        verb = 'Changed' if write else 'Would change'
        self.stdout.write(f'{verb} {len(books)} books: {marked} paper copies on "{name}" {"are" if write else "would be"} marked {have}.')
        if other:
            self.stdout.write(f'{len(other)} copies on it that are not paper {"came" if write else "would come"} off it, unmarked:')
            for line in other:
                self.stdout.write(f'  {line}')
        self.stdout.write(f'The list "{name}" {"is deleted" if write else "would be deleted"}.')
        if not write:
            self.stdout.write('Nothing was changed. Run again with --write.')
