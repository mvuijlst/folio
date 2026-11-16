"""manage.py fill_languages: scanned editions get the language the catalogues give them."""
from io import StringIO
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.utils.dateparse import parse_datetime

from shelf import works
from shelf.management.commands import fill_languages
from shelf.models import Book

WHEN = parse_datetime('2026-11-15T10:00:00Z')


class FillLanguagesTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user('reader', password='x')

    def put(self, uid, **data):
        book = works.upgrade({'id': uid, 'added': '2026-11-15T10:00:00.000Z', 'title': uid, **data})
        return Book.objects.create(user=self.user, uid=uid, data=book, title=uid, modified=WHEN, changed=WHEN)

    def run_it(self, *args):
        answers = {'9789022309032': {'languages': [{'key': '/languages/dut'}]}, '9780330450867': {}, '9782070331000': {},
                   '9789021015996': {}, '9790000000001': {}}
        google = {'9780330450867': {'items': [{'volumeInfo': {'language': 'en'}}]}, '9782070331000': {}, '9789021015996': {}, '9790000000001': {}}

        def fetch(url):
            isbn = url.rsplit('/', 1)[-1].removesuffix('.json') if 'openlibrary' in url else url.split('isbn%3A')[1].split('&')[0]
            return (answers if 'openlibrary' in url else google)[isbn]
        out = StringIO()
        with mock.patch.object(fill_languages, 'fetch', side_effect=fetch):
            call_command('fill_languages', '--user', 'reader', '--pause', '0', *args, stdout=out)
        return out.getvalue()

    def test_scanned_editions_get_their_language_and_the_rest_is_left(self):
        self.put('troost', isbn='9789022309032', format='paper')
        self.put('pillars', isbn='9780330450867', format='paper')
        self.put('prince', isbn='9782070331000', format='paper')
        self.put('known', isbn='9780000000001', language='fr')
        Book.objects.create(user=self.user, uid='boeken-x', title='x', modified=WHEN, changed=WHEN,
                            data={**works.upgrade({'id': 'boeken-x', 'title': 'x', 'isbn': '9789022309032'}), 'boeken': 'x'})
        self.put('unlisted', isbn='9789021015996')   # no catalogue says; 978-90 is Dutch
        self.put('nowhere', isbn='9790000000001')
        self.assertIn("Would be: 4 books given a language (2 nl, 1 en, 1 fr); 2 of them only by the ISBN's registration group; 1 editions whose language is not known",
                      self.run_it('--dry-run'))
        self.assertNotIn('language', Book.objects.get(uid='troost').data['editions'][0])
        said = self.run_it()
        self.assertIn('not known: nowhere (9790000000001)', said)
        langs = {b.uid: b.data['editions'][0].get('language') for b in Book.objects.all()}
        self.assertEqual(langs, {'troost': 'nl', 'pillars': 'en', 'prince': 'fr', 'known': 'fr', 'boeken-x': None,
                                 'unlisted': 'nl', 'nowhere': None})
        row = Book.objects.get(uid='troost')
        self.assertEqual((row.modified, row.changed > WHEN), (WHEN, True))   # devices fetch it; an edit made since still wins
        self.assertIn('Done: 0 books', self.run_it())
