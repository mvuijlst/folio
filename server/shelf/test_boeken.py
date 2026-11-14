import tempfile
from datetime import timezone as dt_timezone
from io import StringIO
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from shelf import boeken
from shelf.models import Book, List

POSTS = {
    'dune': '''---
title: "Dune"
series: ["Dune"]
series_number: 1
date: 2010-03-31T23:30:00+02:00
slug: "dune"
rating: 9
review: true
publisher: "Ace"
year: 1990
pages: 535
isbn: "9780441172719"
olid: "OL893415W"
language: "en"
roles:
  herbert-frank: "auteur"
  someone-else: "vertaling"
cover: "/wp-content/uploads/2010/03/dune.jpg"
categories: ["sf"]
tags: ["desert"]
authors: ["herbert-frank", "someone-else"]
---
A long review.
''',
    'dune-herlezing': '''---
title: "Dune"
series: ["Dune"]
series_number: 1
date: 2024-05-02T10:00:00+02:00
slug: "dune-herlezing"
rereadOf: "dune"
rating: 10
year: 1990
pages: 535
authors: ["herbert-frank"]
---
''',
    'katabasis': '''---
title: "Katabasis"
date: 2026-10-11T16:37:13+02:00
slug: "katabasis"
pages: 559
pagesRead: 95
isbn: "9780063021471"
status: "reading"
authors: ["kuang-r-f"]
---
''',
    'gilgamesh': '''---
title: "Gilgamesh"
date: 2026-11-01T09:00:00+01:00
slug: "gilgamesh"
status: "to-read"
authors: ["unknown-slug"]
---
''',
}
AUTHORS = {'herbert-frank': 'Frank Herbert', 'kuang-r-f': 'R.F. Kuang', 'someone-else': 'Some Translator'}


def make_repo(root, posts=POSTS):
    folder = Path(root, 'site', 'content', 'posts')
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob('*.md'):
        old.unlink()
    for slug, text in posts.items():
        (folder / f'{slug}.md').write_text(text, encoding='utf-8')
    for slug, name in AUTHORS.items():
        term = Path(root, 'site', 'content', 'authors', slug)
        term.mkdir(parents=True, exist_ok=True)
        (term / '_index.md').write_text(f'---\ntitle: "{name}"\nslug: "{slug}"\n---\n', encoding='utf-8')


class ImportTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user('reader', password='x')
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        make_repo(self.tmp.name)

    def run_import(self, *args):
        out = StringIO()
        call_command('import_boeken', *([self.tmp.name] if '--remove' not in args else []), '--user', 'reader',
                     '--covers', str(Path(self.tmp.name, 'thumbs')), *args, stdout=out)
        return out.getvalue()

    def test_covers_become_small_local_images(self):
        from PIL import Image
        original = Path(self.tmp.name, 'media', 'wp-content', 'uploads', '2010', '03', 'dune.jpg')
        original.parent.mkdir(parents=True)
        Image.new('RGB', (1000, 1500), 'navy').save(original)
        self.assertIn('1 cover thumbnails made', self.run_import('--dry-run'))
        self.assertFalse(Path(self.tmp.name, 'thumbs').exists())
        self.assertIn('1 cover thumbnails made', self.run_import())
        cover = self.book('dune')['cover']
        self.assertRegex(cover, r'^covers/boeken/[0-9a-f]{16}[.]webp$')
        with Image.open(Path(self.tmp.name, 'thumbs', cover.rsplit('/', 1)[1])) as thumb:
            self.assertEqual(thumb.size, (240, 360))
        self.assertIn('3 unchanged, 0 left deleted, 0 cover thumbnails made', self.run_import())

    def book(self, key):
        return Book.objects.get(user=self.user, data__boeken=key).data

    def test_posts_become_books_on_the_right_lists(self):
        self.assertIn('3 added', self.run_import())
        dune = self.book('dune')
        self.assertEqual(dune['id'], 'boeken-dune')
        self.assertEqual(dune['author'], 'Frank Herbert')            # the translator is not an author
        self.assertEqual(dune['cover'], 'https://boeken.tsuk.org/wp-content/uploads/2010/03/dune.jpg')
        self.assertEqual((dune['series'], dune['seriesNumber'], dune['date'], dune['pages']), ('Dune', '1', '1990', 535))
        self.assertEqual(self.book('katabasis')['lists'], {'reading': {'at': '2026-10-11T14:37:13.000Z'}})
        self.assertEqual(list(self.book('gilgamesh')['lists']), ['to-read'])
        self.assertEqual(self.book('gilgamesh')['author'], 'unknown-slug')

    def test_a_reread_is_the_same_book(self):
        self.run_import()
        dune = self.book('dune')
        self.assertEqual(dune['rating'], 10)                           # of the latest read
        self.assertEqual(dune['added'], '2010-03-31T21:30:00.000Z')    # when it was first read
        self.assertEqual(dune['lists'], {'read': {'at': '2024-05-02T08:00:00.000Z'}})
        self.assertEqual([r['url'] for r in dune['reads']],
                         ['https://boeken.tsuk.org/2010/03/dune/', 'https://boeken.tsuk.org/2024/05/dune-herlezing/'])
        self.assertTrue(dune['isbn'])                                   # the first read knew it; the reread did not
        self.assertEqual(dune['url'], 'https://boeken.tsuk.org/2024/05/dune-herlezing/')

    def test_month_in_the_address_is_the_one_written_in_the_file(self):
        # The address follows the date as written in the file, not that moment in another time zone.
        self.assertEqual({p['slug']: p['_url'] for p in boeken.read_posts(self.tmp.name)}['dune'],
                         'https://boeken.tsuk.org/2010/03/dune/')

    def test_running_it_again_changes_nothing(self):
        self.run_import()
        before = {b.uid: b.changed for b in Book.objects.all()}
        self.assertIn('3 unchanged', self.run_import())
        self.assertEqual(before, {b.uid: b.changed for b in Book.objects.all()})

    def test_a_scanned_book_is_joined_not_doubled(self):
        when = parse_datetime('2026-11-01T10:00:00Z')
        scanned = {'id': 'abc', 'added': '2026-11-01T10:00:00.000Z', 'title': 'KATABASIS', 'author': 'Kuang', 'isbn': '9780063021471',
                   'thumb': 'data:…', 'lists': {'library': {'at': '2026-11-01T10:00:00.000Z'},
                                                 'lent': {'at': '2026-11-02T10:00:00.000Z', 'note': 'Jan'},
                                                 'to-read': {'at': '2026-11-01T10:00:00.000Z'}}}
        Book.objects.create(user=self.user, uid='abc', data=scanned, title='KATABASIS', modified=when, changed=when)
        self.assertIn('1 joined with a scanned book', self.run_import())
        book = Book.objects.get(user=self.user, uid='abc')
        self.assertEqual(Book.objects.filter(user=self.user).count(), 3)
        self.assertEqual(book.data['title'], 'Katabasis')
        self.assertEqual(book.data['thumb'], 'data:…')
        self.assertEqual(set(book.data['lists']), {'library', 'lent', 'reading'})    # to-read gave way to reading
        self.assertEqual(book.data['lists']['lent']['note'], 'Jan')
        self.assertGreater(book.changed, when)                                        # so every device hears of it

    def test_a_book_from_before_lists_keeps_its_place_in_the_library(self):
        when = timezone.now()
        Book.objects.create(user=self.user, uid='old', modified=when, changed=when, title='Katabasis',
                            data={'id': 'old', 'added': '2026-01-01T00:00:00.000Z', 'title': 'Katabasis', 'isbn': '9780063021471'})
        self.run_import()
        self.assertEqual(set(Book.objects.get(uid='old').data['lists']), {'library', 'reading'})

    def test_status_change_in_the_booklog_moves_the_book(self):
        self.run_import()
        make_repo(self.tmp.name, {**POSTS, 'katabasis': POSTS['katabasis'].replace('status: "reading"\n', 'rating: 8\n')})
        self.assertIn('1 updated', self.run_import())
        self.assertEqual(list(self.book('katabasis')['lists']), ['read'])
        self.assertEqual(self.book('katabasis')['rating'], 8)

    def test_a_book_deleted_in_the_app_stays_deleted(self):
        self.run_import()
        Book.objects.filter(uid='boeken-gilgamesh').update(deleted=True, data={})
        self.assertIn('1 left deleted', self.run_import())
        self.assertTrue(Book.objects.get(uid='boeken-gilgamesh').deleted)

    def test_abandoned_books_get_their_list(self):
        make_repo(self.tmp.name, {'gilgamesh': POSTS['gilgamesh'].replace('to-read', 'abandoned')})
        self.run_import()
        self.assertEqual(list(self.book('gilgamesh')['lists']), ['abandoned'])
        self.assertEqual(List.objects.get(user=self.user, uid='abandoned').data['group'], 'Reading status')

    def test_dry_run_changes_nothing(self):
        self.assertIn('Would be: 3 books in the booklog, 3 added', self.run_import('--dry-run'))
        self.assertEqual(Book.objects.count(), 0)

    def test_remove_undoes_the_import(self):
        when = timezone.now()
        Book.objects.create(user=self.user, uid='abc', modified=when, changed=when, title='Katabasis',
                            data={'id': 'abc', 'added': '2026-01-01T00:00:00.000Z', 'title': 'Katabasis', 'isbn': '9780063021471',
                                  'lists': {'library': {'at': '2026-01-01T00:00:00.000Z'}}})
        self.run_import()
        self.assertIn('2 deleted, 1 separated from a scanned book', self.run_import('--remove'))
        self.assertEqual(Book.objects.filter(deleted=False).count(), 1)
        kept = Book.objects.get(uid='abc').data
        self.assertEqual(list(kept['lists']), ['library'])
        self.assertNotIn('boeken', kept)
        self.assertEqual(Book.objects.get(uid='boeken-dune').modified.tzinfo, dt_timezone.utc)

    def test_other_users_are_untouched(self):
        other = get_user_model().objects.create_user('someone', password='x')
        self.run_import()
        self.assertFalse(Book.objects.filter(user=other).exists())
