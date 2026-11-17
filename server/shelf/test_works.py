"""works.py against the fixtures the app's works.js is tested with (tests/fixtures/works/)."""
import copy
import json
from pathlib import Path

from django.test import SimpleTestCase

from shelf import works

FIXTURES = Path(__file__).resolve().parents[2] / 'tests' / 'fixtures' / 'works'


def fixtures():
    return {path.stem: json.loads(path.read_text(encoding='utf-8')) for path in sorted(FIXTURES.glob('*.json'))}


class UpgradeTests(SimpleTestCase):
    def test_every_fixture_becomes_what_the_app_makes_of_it(self):
        found = fixtures()
        self.assertGreater(len(found), 10)
        for name, f in found.items():
            if isinstance(f['before'], list):
                continue
            with self.subTest(name):
                before = copy.deepcopy(f['before'])
                self.assertEqual(works.upgrade(f['before'], f.get('status')), f['after'])
                self.assertEqual(f['before'], before)   # left as it was
                self.assertEqual(works.upgrade(f['after'], f.get('status')), f['after'])

    def test_the_flat_view_is_the_old_shape(self):
        after = fixtures()['paper-then-audiobook']['after']
        flat = works.flat(after)
        self.assertEqual(flat['format'], 'audiobook')
        self.assertNotIn('pages', flat)   # the paperback's pages are the paperback's
        self.assertEqual(flat['reviews'][0]['edition']['publisher'], 'Avon')
        self.assertEqual(flat['reviews'][1]['edition']['people'][1], {'name': 'William Dufris', 'role': 'stem'})
        self.assertNotIn('editions', flat)
        lent = works.flat(fixtures()['lent-out-with-a-note']['after'])
        self.assertEqual(set(lent['lists']), {'library', 'lent', 'read'})
        old = {'title': 'x', 'publisher': 'y'}
        self.assertIs(works.flat(old), old)

    def test_settle_puts_what_is_in_the_wrong_place_where_it_belongs(self):
        book = fixtures()['scanned-paper-book']['after']
        book['publisher'] = 'Del Rey'
        book['lists']['lent'] = {'at': 'x', 'note': 'Ann'}
        book['editions'][0]['lists']['read'] = {'at': 'y'}
        book['reviews'] = [{'id': 'r', 'date': '2026-01-01', 'edition': {'publisher': 'Old'}}]
        works.settle(book)
        self.assertNotIn('publisher', book)
        self.assertEqual(book['editions'][0]['publisher'], 'Del Rey')
        self.assertEqual(book['editions'][0]['lists']['lent'], {'at': 'x', 'note': 'Ann'})
        self.assertIn('read', book['lists'])
        self.assertEqual(book['reviews'][0], {'id': 'r', 'date': '2026-01-01', 'ed': 'e1'})
        book['lists'] = {'read': {'at': 'y'}}
        works.settle(book)
        self.assertNotIn('main', book)

    def test_combine_of_a_translation_keeps_each_title(self):
        def nl():
            return {'id': 'nl', 'title': 'Hoeksteen van de Foundation', 'seriesNumber': 2, 'lists': {}, 'editions': [{'id': 'e1', 'language': 'nl'}]}

        def en():
            return {'id': 'en', 'title': "Foundation's Edge", 'seriesNumber': 6, 'lists': {}, 'editions': [{'id': 'e1', 'language': 'en'}]}
        mine = works.combine(nl(), en())
        self.assertEqual(mine['title'], 'Hoeksteen van de Foundation')
        self.assertEqual([e.get('title') for e in mine['editions']], [None, "Foundation's Edge"])
        theirs = works.combine(nl(), en(), title='theirs')
        self.assertEqual((theirs['title'], theirs['seriesNumber']), ("Foundation's Edge", 6))
        self.assertEqual([e.get('title') for e in theirs['editions']], ['Hoeksteen van de Foundation', None])

    def test_combine_keeps_what_both_were_said_not_to_be(self):
        survivor = {'id': 'z', 'title': 'Channel Zero', 'lists': {}, 'apart': ['j', 'o'], 'editions': [{'id': 'e1'}]}
        absorbed = {'id': 'o', 'title': 'Channel Zero', 'lists': {}, 'apart': ['z', 'c'], 'editions': [{'id': 'e1'}]}
        self.assertEqual(works.combine(survivor, absorbed)['apart'], ['j', 'c'])

    def test_combine_as_the_app_does(self):
        read = fixtures()['folio-read-another-edition']['after']
        planned = fixtures()['scanned-paper-book']['after']
        planned['pagesRead'] = 10
        works.combine(read, planned)
        self.assertEqual(list(read['lists']), ['to-read'])
        self.assertEqual(read['main'], 'e3')
        self.assertEqual(read['editions'][2]['publisher'], 'HarperCollins')
        self.assertEqual(read['pagesRead'], 10)
