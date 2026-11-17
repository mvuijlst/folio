"""manage.py set_categories: books only on the shelf get the categories a list gives them."""
import json
import tempfile
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.utils.dateparse import parse_datetime

from shelf.models import Book

WHEN = parse_datetime('2026-11-01T10:00:00Z')


class SetCategoriesTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user('reader', password='x')

    def put(self, uid, **data):
        return Book.objects.create(user=self.user, uid=uid, data={'id': uid, 'title': uid, **data}, title=uid,
                                   modified=WHEN, changed=WHEN)

    def run_it(self, wanted, *args):
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as f:
            json.dump(wanted, f)
        out = StringIO()
        call_command('set_categories', f.name, '--user', 'reader', *args, stdout=out)
        return out.getvalue()

    def test_only_shelf_books_that_still_have_the_old_categories_change(self):
        self.put('dune', categories=['fictie', 'science-fiction'])
        self.put('steel')
        self.put('posted', categories=['fictie'], boeken='posted')
        self.put('edited', categories=['horror'])
        wanted = {'dune': {'from': ['fictie', 'science-fiction'], 'to': ['science-fiction']},
                  'steel': {'from': [], 'to': ['romance']},
                  'posted': {'from': ['fictie'], 'to': ['literatuur']},
                  'edited': {'from': [], 'to': ['crime']},
                  'gone': {'from': [], 'to': ['taal']}}

        said = self.run_it(wanted)
        self.assertIn('Would change 2 books.', said)
        self.assertEqual(Book.objects.get(uid='dune').data['categories'], ['fictie', 'science-fiction'])

        said = self.run_it(wanted, '--write')
        self.assertIn('Changed 2 books.', said)
        dune, steel = Book.objects.get(uid='dune'), Book.objects.get(uid='steel')
        self.assertEqual(dune.data['categories'], ['science-fiction'])
        self.assertEqual(steel.data['categories'], ['romance'])
        self.assertEqual(dune.modified, WHEN)   # a device's later edit still wins
        self.assertGreater(dune.changed, WHEN)  # and every device fetches it
        self.assertEqual(Book.objects.get(uid='posted').data['categories'], ['fictie'])
        self.assertEqual(Book.objects.get(uid='edited').data['categories'], ['horror'])
        self.assertEqual(Book.objects.get(uid='edited').changed, WHEN)
        for name in ('posted: in the booklog', 'edited: has', 'gone: not on the shelf'):
            self.assertIn(name, said)

        self.assertIn('Changed 0 books.', self.run_it({'dune': {'from': ['science-fiction'], 'to': ['science-fiction']}}, '--write'))
