"""manage.py to_works: a shelf in the old shape becomes books with editions."""
import json
from io import StringIO
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.utils.dateparse import parse_datetime

from shelf import boeken, publish, works
from shelf.models import Book

FIXTURES = Path(__file__).resolve().parents[2] / 'tests' / 'fixtures' / 'works'
WHEN = parse_datetime('2026-11-15T10:00:00Z')


class ToWorksTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user('reader', password='x')

    def put(self, data, uid=None):
        uid = uid or data['id']
        return Book.objects.create(user=self.user, uid=uid, data=data, title=data.get('title', ''), modified=WHEN, changed=WHEN)

    def run_it(self, *args):
        out = StringIO()
        call_command('to_works', '--user', 'reader', *args, stdout=out)
        return out.getvalue()

    def fixture(self, name):
        return json.loads((FIXTURES / f'{name}.json').read_text(encoding='utf-8'))

    def test_every_book_is_upgraded_and_a_second_run_changes_nothing(self):
        for name in ('paper-then-audiobook', 'scanned-paper-book', 'lent-out-with-a-note'):
            self.put(self.fixture(name)['before'])
        self.assertIn('3 books, 3 upgraded, 4 editions, 1 books with more than one edition', self.run_it('--dry-run'))
        self.assertFalse(Book.objects.get(uid='scan-1').data.get('editions'))   # a dry run writes nothing
        said = self.run_it()
        self.assertIn('3 records written', said)
        self.assertEqual(Book.objects.get(uid='scan-1').data, self.fixture('scanned-paper-book')['after'])
        row = Book.objects.get(uid='scan-1')
        self.assertEqual((row.modified, row.changed > WHEN), (WHEN, True))   # every device fetches it; an edit made since still wins
        changed = {b.uid: b.changed for b in Book.objects.all()}
        self.assertIn('0 records written', self.run_it())
        self.assertEqual(changed, {b.uid: b.changed for b in Book.objects.all()})

    def test_what_was_in_step_with_the_booklog_stays_in_step(self):
        old = self.fixture('paper-then-audiobook')['before']
        # Its fingerprints as the import made them, so nothing waits to be published.
        for review in old['reviews']:
            review['sum'] = boeken.review_sum(review)
        old['boekenState'] = boeken.state_of(old)
        self.assertFalse(publish.is_pending(old))
        self.put(old)
        self.run_it()
        data = Book.objects.get(uid=old['id']).data
        # The audiobook no longer carries the paperback's pages, and that is not a change to publish.
        self.assertNotIn('pages', works.flat(data))
        self.assertFalse(publish.is_pending(works.flat(data)))

    def test_what_waited_to_be_published_still_waits_and_nothing_else(self):
        old = self.fixture('booklog-change-waiting')['before']
        for review in old['reviews']:
            review['sum'] = boeken.review_sum(review)
        self.assertEqual(publish.changed_keys(old), {'publisher'})
        self.put(old)
        said = self.run_it()
        self.assertIn('waiting: "Solaris" (boeken-solaris)', said)
        data = Book.objects.get(uid=old['id']).data
        self.assertEqual(publish.changed_keys(works.flat(data)), {'publisher'})

    def test_another_version_becomes_an_edition_of_its_book(self):
        dune = {'id': 'boeken-dune', 'added': '2010-03-31T21:30:00.000Z', 'title': 'Dune', 'author': 'Frank Herbert', 'format': 'ebook',
                'publisher': 'Ace', 'isbn': '9780441172719', 'boeken': 'dune', 'lists': {'read': {'at': '2024-05-02T08:00:00.000Z'}},
                'reviews': [{'id': 'boeken-dune', 'date': '2010-03-31', 'rating': 9, 'text': '', 'boeken': 'dune',
                             'edition': {'publisher': 'Ace', 'isbn': '9780441172719', 'format': 'ebook'}}]}
        audio = {'id': 's1', 'added': '2026-11-14T10:00:00.000Z', 'title': 'Dune', 'author': 'Frank Herbert', 'versionOf': 'boeken-dune',
                 'format': 'audiobook', 'duration': '21u 2m', 'publisher': 'Macmillan Audio', 'pagesRead': None, 'durationLeft': '20u',
                 'boeken': 'dune-herlezing-2', 'lists': {'reading': {'at': '2026-11-14T10:00:00.000Z'}, 'library': {'at': '2026-11-14T10:00:00.000Z'}},
                 'people': [{'name': 'Frank Herbert', 'role': ''}, {'name': 'Simon Vance', 'role': 'stem'}]}
        self.put(dune)
        self.put(audio)
        said = self.run_it()
        self.assertIn('merged, another version: "Dune" (s1) into "Dune" (boeken-dune)', said)
        merged = Book.objects.get(uid='boeken-dune').data
        self.assertEqual([e.get('format') for e in merged['editions']], ['ebook', 'audiobook'])
        self.assertEqual((merged['lists'], merged['main'], merged['durationLeft']), (audio['lists'] and {'reading': audio['lists']['reading']}, 'e2', '20u'))
        self.assertEqual(merged['editions'][1]['lists'], {'library': {'at': '2026-11-14T10:00:00.000Z'}})
        self.assertNotIn('versionOf', json.dumps(merged))
        gone = Book.objects.get(uid='s1')
        self.assertEqual((gone.deleted, gone.data), (True, {}))
        self.assertIn('0 records written', self.run_it())

    def test_books_with_one_isbn_are_one_book(self):
        lotr = self.fixture('scanned-paper-book')['before']
        self.put(lotr)
        self.put({**lotr, 'id': 'scan-2', 'added': '2026-11-15T10:00:00.000Z', 'lists': {'lent': {'at': 'x', 'note': 'Ann'}}})
        said = self.run_it()
        self.assertIn('same ISBN 9780261103252: "The Lord of the Rings" (scan-2) into "The Lord of the Rings" (scan-1)', said)
        data = Book.objects.get(uid='scan-1').data
        self.assertEqual([sorted(e.get('lists') or {}) for e in data['editions']], [['library'], ['lent']])
        self.assertTrue(Book.objects.get(uid='scan-2').deleted)

    def test_books_that_only_look_alike_are_listed(self):
        self.put({'id': 'a', 'title': 'Ash', 'author': 'Mary Gentle'})
        self.put({'id': 'b', 'title': 'Ash: A Secret History', 'author': 'Mary Gentle'})
        self.put({'id': 'c', 'title': 'Ash: Another Book', 'author': 'Mary Gentle'})
        said = self.run_it()
        self.assertIn('possibly the same book: "Ash" (a) / "Ash: A Secret History" (b)', said)
        self.assertNotIn('"Ash: A Secret History" (b) / "Ash: Another Book" (c)', said)
        self.assertIn('0 merged', said)
