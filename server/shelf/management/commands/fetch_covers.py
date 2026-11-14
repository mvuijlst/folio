"""Gives every book whose cover still lives at a book catalogue a copy on this server.

    manage.py fetch_covers [--user NAME]

Syncing does this by itself, a few covers at a time (see shelf/covers.py); this does a
whole shelf in one go, for instance right after the server learned to keep covers.
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
            left = sum(1 for b in Book.objects.filter(user=account, deleted=False, data__cover__startswith='https://')
                       if covers.wanted(b.data.get('cover')))
            self.stdout.write(f'{account.get_username()}: {done} covers kept, {left} could not be fetched')
