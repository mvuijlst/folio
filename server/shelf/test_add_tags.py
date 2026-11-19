"""manage.py add_tags: books only on the shelf get the tags a list gives them, beside their own."""
import json
import tempfile
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.utils.dateparse import parse_datetime

from shelf.models import Book

WHEN = parse_datetime('2026-11-01T10:00:00Z')


class AddTagsTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user('reader', password='x')

    def put(self, uid, **data):
        return Book.objects.create(user=self.user, uid=uid, data={'id': uid, 'title': uid, **data}, title=uid,
                                   modified=WHEN, changed=WHEN)

    def run_it(self, wanted, *args):
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as f:
            json.dump(wanted, f)
        out = StringIO()
        call_command('add_tags', f.name, '--user', 'reader', *args, stdout=out)
        return out.getvalue()

    def test_only_shelf_books_get_the_tags_they_lack(self):
        self.put('games', tags=['arena'])
        self.put('maze')
        self.put('tagged', tags=['young-adult', 'draken'])
        self.put('posted', tags=['arena'], boeken='posted')
        wanted = {'games': ['young-adult'], 'maze': ['young-adult', 'young-adult'], 'tagged': ['young-adult'],
                  'posted': ['young-adult'], 'gone': ['young-adult']}

        said = self.run_it(wanted)
        self.assertIn('Would change 2 books.', said)
        self.assertEqual(Book.objects.get(uid='games').data['tags'], ['arena'])

        said = self.run_it(wanted, '--write')
        self.assertIn('Changed 2 books.', said)
        games, maze = Book.objects.get(uid='games'), Book.objects.get(uid='maze')
        self.assertEqual(games.data['tags'], ['arena', 'young-adult'])   # beside what it had
        self.assertEqual(maze.data['tags'], ['young-adult'])
        self.assertEqual(games.modified, WHEN)   # a device's later edit still wins
        self.assertGreater(games.changed, WHEN)  # and every device fetches it
        tagged = Book.objects.get(uid='tagged')
        self.assertEqual(tagged.data['tags'], ['young-adult', 'draken'])
        self.assertEqual(tagged.changed, WHEN)   # nothing to do, so not touched
        self.assertEqual(Book.objects.get(uid='posted').data['tags'], ['arena'])
        for name in ('posted: in the booklog', 'gone: not on the shelf'):
            self.assertIn(name, said)

        self.assertIn('Changed 0 books.', self.run_it(wanted, '--write'))   # a second run changes nothing
