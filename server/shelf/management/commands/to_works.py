"""Turns a shelf into books with editions (docs/work-edition-plan.md, stage 1).

    manage.py to_works [--user NAME] [--dry-run]

Run by hand at the cut-over, after the new app is deployed and before the booklog timer runs
again (docs/booklog.md). Repeatable: a second run changes nothing.

  - Every book in the old shape is upgraded (shelf/works.py: `upgrade`).
  - A book that was another version of a book (`versionOf`: the audiobook of an e-book you
    have) becomes an edition of that book, with its reads. Its reading status wins when it is
    To read or Reading and the other's is not; its edition is then the one being read.
  - Books that share an ISBN become one book with an edition entry for each, when at most one
    of them is in the booklog (that one stays; otherwise the oldest).
  - Books that only look alike (the same Open Library work, or the same title by the same first
    writer) are listed, not merged: that is for you to decide in the app.
  - For a booklog book that had nothing waiting to be published, what the booklog has
    (`boekenState`, each read's `sum`) is said afresh from the new shape, so nothing becomes
    waiting by the change of shape alone. A book that had something waiting stays waiting, for
    that and nothing else, and is named.

A changed book keeps its `modified` and gets a new `changed`, so every device fetches it and an
edit made on a device since still wins. A merged-away book becomes a tombstone.
"""
import copy

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from shelf import boeken, publish, works
from shelf.models import Book


def first_writer(author):
    return boeken.fold(str(author or '').split(',')[0])


def main_title(title):
    import re
    return boeken.fold(re.split(r'\s*[:—–]\s*|\s+-\s+', str(title or ''))[0])


class Command(BaseCommand):
    help = 'Turn every book into a book with editions (repeatable).'

    def add_arguments(self, parser):
        parser.add_argument('--user', help='only this user\'s shelf')
        parser.add_argument('--dry-run', action='store_true', help='report what would happen, change nothing')

    def handle(self, user, dry_run, **options):
        users = get_user_model().objects.all()
        if user:
            users = users.filter(username=user)
            if not users.exists():
                raise CommandError(f'There is no user "{user}".')
        for account in users:
            with transaction.atomic():
                lines = self.convert(account)
                if dry_run:
                    transaction.set_rollback(True)
            self.stdout.write(f'{account.get_username()}' + (' (dry run, nothing written)' if dry_run else '') + ':')
            for line in lines:
                self.stdout.write('  ' + line)

    def convert(self, user):
        now = timezone.now()
        statuses = works.status_lists(user)
        rows = list(Book.objects.filter(user=user, deleted=False).order_by('pk'))
        old = {row.pk: row.data for row in rows}
        new = {row.pk: works.upgrade(row.data, statuses) for row in rows}
        by_uid = {row.uid: row for row in rows}
        # What waited to be published before, per book: the keys of its own facts, and whether anything did.
        waited = {row.pk: publish.changed_keys(works.flat(row.data)) for row in rows if row.data.get('boeken')}
        pending = {row.pk for row in rows if row.data.get('boeken') and publish.is_pending(works.flat(row.data))}
        upgraded = sum(1 for row in rows if not row.data.get('editions'))
        gone, merged, notes = {}, [], []
        absorbed_into = {}   # survivor pk → [absorbed pks]

        def title_of(row):
            return new[row.pk].get('title') or row.title or row.uid

        def combine(survivor, other, why):
            works.combine(new[survivor.pk], new[other.pk])   # what was the other's alone (its post, its error) goes with it
            gone[other.pk] = survivor
            absorbed_into.setdefault(survivor.pk, []).append(other.pk)
            if other.pk in pending:
                pending.add(survivor.pk)
            merged.append(f'{why}: "{title_of(other)}" ({other.uid}) into "{title_of(survivor)}" ({survivor.uid})')

        # Another version of a book becomes an edition of it.
        for row in rows:
            target = new[row.pk].pop('versionOf', None)
            if not target:
                continue
            into = by_uid.get(target)
            while into is not None and into.pk in gone:
                into = gone[into.pk]
            if into is None or into.pk == row.pk:
                notes.append(f'"{title_of(row)}" was another version of a book that is gone: it stays a book of its own')
                continue
            combine(into, row, 'another version')

        # Books that share an ISBN are one book, when the booklog doesn't have them twice.
        groups = {}
        for row in rows:
            if row.pk in gone:
                continue
            for edition in new[row.pk]['editions']:
                if edition.get('isbn'):
                    groups.setdefault(edition['isbn'], [])
                    if row not in groups[edition['isbn']]:
                        groups[edition['isbn']].append(row)
        for isbn, members in groups.items():
            members = [m for m in members if m.pk not in gone]
            if len(members) < 2:
                continue
            in_booklog = [m for m in members if new[m.pk].get('boeken')]
            if len(in_booklog) > 1:
                notes.append(f'not merged, both in the booklog (ISBN {isbn}): ' + ', '.join(f'"{title_of(m)}" ({m.uid})' for m in members))
                continue
            survivor = in_booklog[0] if in_booklog else min(members, key=lambda m: (str(new[m.pk].get('added') or ''), m.pk))
            for other in members:
                if other is not survivor:
                    combine(survivor, other, f'same ISBN {isbn}')

        # What the booklog has of each book, said afresh where nothing was waiting.
        waiting = []
        for row in rows:
            data = new[row.pk]
            if row.pk in gone or not data.get('boeken') or 'boekenState' not in data:
                continue
            flat = works.flat(data)
            if row.pk not in pending:
                data['boekenState'] = boeken.state_of(flat)
                for review, seen in zip(data.get('reviews') or [], flat.get('reviews') or []):
                    if isinstance(review, dict) and review.get('boeken') and review.get('sum'):
                        review['sum'] = boeken.review_sum(seen)
                continue
            # Still waiting: for what waited before, and nothing else.
            state = boeken.state_of(flat)
            for pk in [row.pk, *absorbed_into.get(row.pk, [])]:
                before = (old[pk].get('boekenState') or {}) if old[pk].get('boeken') else {}
                for key in waited.get(pk, ()):
                    if key in before:
                        state[key] = copy.deepcopy(before[key])
                    else:
                        state.pop(key, None)
            data['boekenState'] = state
            waiting.append(f'"{title_of(row)}" ({row.uid})')

        # Books that only look alike (as the app's Filter → Other → Possibly the same book finds
        # them): the same olid, or one's title is the other's, perhaps with a subtitle after it.
        live = [row for row in rows if row.pk not in gone]
        index = {}

        def titles(row):
            return [t for t in {new[row.pk].get('title'), *(e.get('title') for e in new[row.pk]['editions'])} if t]

        def number(row):
            value = new[row.pk].get('seriesNumber')
            return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None

        for row in live:
            data = new[row.pk]
            if data.get('olid'):
                index.setdefault(f'olid:{data["olid"]}', []).append(row)
            writer = first_writer(data.get('author'))
            for title in titles(row) if writer else ():
                if boeken.fold(title):
                    index.setdefault(f'title:{boeken.fold(title)}|{writer}', []).append(row)
        pairs = set()
        for row in live:
            data, writer = new[row.pk], first_writer(new[row.pk].get('author'))
            keys = {f'olid:{data["olid"]}'} if data.get('olid') else set()
            keys |= {f'title:{key}|{writer}' for title in (titles(row) if writer else ()) for key in (boeken.fold(title), main_title(title)) if key}
            for other in {o.pk: o for key in keys for o in index.get(key, [])}.values():
                if other.pk == row.pk or (number(row) is not None and number(other) is not None and number(row) != number(other)):
                    continue
                pairs.add(tuple(sorted(f'"{title_of(m)}" ({m.uid})' for m in (row, other))))
        pairs = sorted(pairs)

        # Written: `modified` stays, `changed` tells every device.
        written = 0
        for row in rows:
            if row.pk in gone:
                row.data, row.deleted, row.modified, row.changed = {}, True, now, now
                row.save()
                written += 1
            elif new[row.pk] != row.data:
                row.data, row.changed = new[row.pk], now
                row.title = str(row.data.get('title') or '')[:300]
                row.save()
                written += 1

        multi = sum(1 for row in rows if row.pk not in gone and len(new[row.pk]['editions']) > 1)
        editions = sum(len(new[row.pk]['editions']) for row in rows if row.pk not in gone)
        lines = [
            f'{len(rows)} books, {upgraded} upgraded, {editions} editions, {multi} books with more than one edition',
            f'{len(merged)} merged, {len(waiting)} left waiting to be published, {len(pairs)} possibly the same book',
            f'{written} records written',
        ]
        lines += [f'merged, {line}' for line in merged]
        lines += [f'waiting: {line}' for line in waiting]
        lines += [f'possibly the same book: {" / ".join(pair)}' for pair in pairs]
        lines += notes
        return lines
