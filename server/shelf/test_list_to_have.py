from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.utils.dateparse import parse_datetime

from .models import Book, List

T = parse_datetime('2026-11-01T10:00:00Z')


class ListToHaveTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user('reader')
        for uid, name, group in [('library', 'Mag weg', ''), ('shelf', 'Bibliotheek', 'Plaats'), ('lent', 'Lent out', '')]:
            List.objects.create(user=self.user, uid=uid, data={'id': uid, 'name': name, 'group': group}, modified=T, changed=T)

        def book(uid, *editions):
            return Book.objects.create(user=self.user, uid=uid, title=uid, modified=T, changed=T,
                                       data={'id': uid, 'title': uid, 'v': 2, 'lists': {'read': {'at': '2026'}}, 'editions': list(editions)})
        self.paper = book('paper', {'id': 'e1', 'format': 'paper', 'lists': {'library': {'at': '2026'}, 'shelf': {'at': '2026'}, 'lent': {'at': '2026', 'note': 'Jan'}}})
        self.ebook = book('ebook', {'id': 'e1', 'format': 'ebook', 'lists': {'library': {'at': '2026'}}})
        self.other = book('other', {'id': 'e1', 'format': 'paper', 'lists': {'shelf': {'at': '2026'}}})

    def run_command(self, *args):
        out = StringIO()
        call_command('list_to_have', '--user', 'reader', '--list', 'library', *args, stdout=out)
        return out.getvalue()

    def test_dry_run_changes_nothing(self):
        said = self.run_command('--have', 'go')
        self.assertIn('Would change 2 books: 1 paper copies', said)
        self.assertIn('ebook (ebook)', said)
        self.paper.refresh_from_db()
        self.assertIn('library', self.paper.data['editions'][0]['lists'])
        self.assertFalse(List.objects.get(uid='library').deleted)

    def test_can_go_keeps_its_place_and_the_list_goes(self):
        self.run_command('--have', 'go', '--write')
        self.paper.refresh_from_db()
        e = self.paper.data['editions'][0]
        self.assertEqual(e['have'], 'go')
        self.assertEqual(set(e['lists']), {'shelf', 'lent'})
        self.assertEqual(self.paper.modified, T)          # a later edit on a device still wins
        self.assertGreater(self.paper.changed, T)         # every device fetches it
        self.ebook.refresh_from_db()
        self.assertNotIn('have', self.ebook.data['editions'][0])
        self.assertNotIn('lists', self.ebook.data['editions'][0])
        self.other.refresh_from_db()
        self.assertEqual(self.other.changed, T)           # not on the list: untouched
        gone = List.objects.get(uid='library')
        self.assertTrue(gone.deleted)
        self.assertGreater(gone.modified, T)

    def test_gone_also_leaves_its_place(self):
        self.run_command('--have', 'gone', '--write')
        self.paper.refresh_from_db()
        e = self.paper.data['editions'][0]
        self.assertEqual(e['have'], 'gone')
        self.assertEqual(set(e['lists']), {'lent'})        # lent out is not a place
