"""Says of covers photographed in the scanner before 2.2.4 that they are photographs.

    manage.py mark_cover_photos --user NAME [--dry-run]

Since 2.2.4 an edition whose cover is the photograph taken of it in the scanner says so
(`coverPhoto`), and its page offers to find a better cover. Before, nothing said so. Those
photographs have the shape of the scanner's viewfinder, 2:3 with a twentieth of its width added
on every side: 1.1 / 1.6 = 0.6875 wide to high. A picture of your own (kept by the server, or only
its small copy) of that shape, that came from no catalogue (`coverSource`), is taken to be one.
A changed book keeps its `modified` (an edit made on a device since still wins) and gets a new
`changed`, so every device fetches it. Repeatable.
"""
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from shelf.models import Book

FINDER = 1.1 / 1.6


def photographed(edition):
    """Is this edition's cover, by its shape and where it came from, a photograph from the scanner?"""
    if edition.get('coverPhoto') or edition.get('coverSource'):
        return False
    cover = str(edition.get('cover') or '')
    own = cover.startswith('covers/own/') or (not cover and str(edition.get('thumb') or '').startswith('data:image/'))
    try:
        ratio = float(edition.get('coverRatio'))
    except (TypeError, ValueError):
        return False
    return own and abs(ratio - FINDER) <= 0.002


class Command(BaseCommand):
    help = 'Mark covers photographed in the scanner before 2.2.4 as photographs (repeatable).'

    def add_arguments(self, parser):
        parser.add_argument('--user', required=True, help='whose shelf')
        parser.add_argument('--dry-run', action='store_true', help='say what would be marked; change nothing')

    def handle(self, user, dry_run, **options):
        try:
            account = get_user_model().objects.get(username=user)
        except get_user_model().DoesNotExist:
            raise CommandError(f'There is no user "{user}".')
        marked = []
        for row in Book.objects.filter(user=account, deleted=False).order_by('pk'):
            data = row.data
            editions = [e for e in data.get('editions') or [] if isinstance(e, dict)] if isinstance(data, dict) else []
            found = [e for e in editions if photographed(e)]
            if not found:
                continue
            for edition in found:
                edition['coverPhoto'] = True
            marked.append(row.title or row.uid)
            if not dry_run:
                row.data = data
                row.changed = timezone.now()
                row.save(update_fields=['data', 'changed'])
        self.stdout.write(('Would be: ' if dry_run else 'Done: ') + f'{len(marked)} books with a cover photographed in the scanner')
        for title in marked:
            self.stdout.write(f'  {title}')
