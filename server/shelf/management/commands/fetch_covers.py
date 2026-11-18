"""Gives every edition whose cover still lives at a book catalogue a copy on this server, and
every cover kept here only small (a catalogue's or the booklog's) its large copy.

    manage.py fetch_covers [--user NAME]

Syncing does this by itself, a few covers at a time (see shelf/covers.py); this does a
whole shelf in one go, for instance right after the server learned to keep large covers.
"""
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from shelf import covers
from shelf.models import Book


class Command(BaseCommand):
    help = 'Fetch and keep the covers of books that still point at a book catalogue.'

    def add_arguments(self, parser):
        parser.add_argument('--user', help='only this user\'s shelf')

    def handle(self, user, **options):
        users = get_user_model().objects.all()
        if user:
            users = users.filter(username=user)
        for account in users:
            done = len(covers.adopt(account, limit=None))
            places = [place for b in Book.objects.filter(user=account, deleted=False) for place in covers.places(b.data)]
            left = sum(1 for place in places if str(place.get('cover') or '').startswith('https://') and covers.wanted(place.get('cover')))
            small = sum(1 for place in places if str(place.get('cover') or '').startswith('covers/') and not place.get('coverFull'))
            self.stdout.write(f'{account.get_username()}: {done} books given covers; {left} could not be fetched, '
                              f'{small} covers still only small (no source to fetch a large one from, or it failed)')
