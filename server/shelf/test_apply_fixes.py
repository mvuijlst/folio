"""manage.py apply_fixes: audited corrections and combines on books only on the shelf."""
import json
import tempfile
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.utils.dateparse import parse_datetime

from shelf import works
from shelf.models import Book

WHEN = parse_datetime('2026-11-01T10:00:00Z')


class ApplyFixesTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user('reader', password='x')

    def put(self, uid, **data):
        book = works.upgrade({'id': uid, 'added': '2026-11-01T10:00:00.000Z', 'title': uid, **data})
        return Book.objects.create(user=self.user, uid=uid, data=book, title=uid, modified=WHEN, changed=WHEN)

    def run_it(self, plan, *args):
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as f:
            json.dump(plan, f)
        out = StringIO()
        call_command('apply_fixes', f.name, '--user', 'reader', *args, stdout=out)
        return out.getvalue()

    def test_changes_only_what_still_holds_the_old_value(self):
        self.put('rigby', author='DOUGLAS COUPLAND', format='paper', language='es', isbn='979')
        self.put('edited', author='Ikke')
        self.put('posted', author='Ikke', boeken='posted')
        plan = {'change': {
            'rigby': {'book': {'author': ['DOUGLAS COUPLAND', 'Douglas Coupland'], 'title': ['rigby', 'Eleanor Rigby']},
                      'editions': {'e1': {'language': ['es', 'en'], 'isbn': ['979', None]}}},
            'edited': {'book': {'author': ['Someone else', 'Marc Legendre']}},
            'posted': {'book': {'author': ['Ikke', 'Marc Legendre']}}}}
        self.assertIn('Would change 1 books', self.run_it(plan))
        self.assertEqual(Book.objects.get(uid='rigby').data['author'], 'DOUGLAS COUPLAND')
        said = self.run_it(plan, '--write')
        rigby = Book.objects.get(uid='rigby')
        self.assertEqual((rigby.data['author'], rigby.data['title'], rigby.title), ('Douglas Coupland', 'Eleanor Rigby', 'Eleanor Rigby'))
        edition = rigby.data['editions'][0]
        self.assertEqual(edition['language'], 'en')
        self.assertNotIn('isbn', edition)
        self.assertEqual(rigby.modified, WHEN)
        self.assertGreater(rigby.changed, WHEN)
        self.assertEqual(Book.objects.get(uid='edited').data['author'], 'Ikke')
        self.assertIn('edited: changed since (author)', said)
        self.assertIn('posted: in the booklog', said)

    def test_combine_keeps_a_translation_title_and_deletes_the_absorbed_book(self):
        self.put('eclipse', title='Eclipse', format='paper', language='en')
        self.put('eclips', title='Eclips', format='paper', language='nl', lists={'library': {'at': '2026-11-01'}})
        self.put('daggers', title='The Path of Daggers', format='ebook', boeken='the-path-of-daggers')
        self.assertIn('combine 1 pairs', self.run_it({'combine': [{'absorbed': 'eclips', 'survivor': 'eclipse'}]}))
        self.assertFalse(Book.objects.get(uid='eclips').deleted)
        said = self.run_it({'combine': [{'absorbed': 'eclips', 'survivor': 'eclipse'}, {'absorbed': 'daggers', 'survivor': 'eclipse'}]}, '--write')
        self.assertIn('combine daggers: it is in the booklog', said)
        eclipse = Book.objects.get(uid='eclipse')
        self.assertEqual([(e['language'], e.get('title')) for e in eclipse.data['editions']], [('en', None), ('nl', 'Eclips')])
        self.assertTrue(Book.objects.get(uid='eclips').deleted)
        self.assertGreater(eclipse.modified, WHEN)
        self.assertFalse(Book.objects.get(uid='daggers').deleted)
