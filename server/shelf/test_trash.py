"""The Trash on the server (docs/using.md, "Trash"): a trashed book is a record with `trashed`,
left out of everything that reads the shelf; dropping a book on To read takes its posts off the
booklog while it is in the Trash; a book or a read can be taken off the booklog and stay in the
app (`unpublish`, its reads then `local`)."""
import json
import re
from datetime import timedelta
from pathlib import Path

from django.utils import timezone

from . import works
from .models import Book
from .test_publish import BooklogCase, git

SHELF = Path(__file__).resolve().parent


class EveryReaderLeavesTheTrashOut(BooklogCase):
    def test_no_reader_asks_for_books_not_deleted_itself(self):
        # Every reader goes through Book.shelf (the Trash left out) or Book.kept (the Trash in, on
        # purpose). One that filters on deleted=False itself would show trashed books.
        offenders = []
        for path in [*SHELF.glob('*.py'), *SHELF.glob('management/commands/*.py')]:
            if path.name.startswith('test') or path.name == 'models.py':
                continue
            text = path.read_text(encoding='utf-8')
            for m in re.finditer(r'Book\.objects\.filter\([^)]*deleted=False', text):
                offenders.append(f'{path.name}:{text[:m.start()].count(chr(10)) + 1}')
        self.assertEqual(offenders, [], 'use Book.shelf(user) (or Book.kept(user) where the Trash belongs)')

    def test_shelf_leaves_trashed_books_out_and_kept_has_them(self):
        row = self.book('gilgamesh')
        row.data = {**row.data, 'trashed': '2026-11-20T10:00:00Z'}
        row.save()
        self.assertNotIn(row.pk, Book.shelf(self.user).values_list('pk', flat=True))
        self.assertIn(row.pk, Book.kept(self.user).values_list('pk', flat=True))

    def test_an_older_copy_of_the_app_is_told_to_update(self):
        self.client.force_login(self.user)
        res = self.client.post('/api/sync', json.dumps({'schema': 2, 'since': None, 'changes': []}), content_type='application/json')
        self.assertEqual(res.status_code, 409)


class TrashAndTheBooklog(BooklogCase):
    def trash(self, key, **extra):
        def go(data):
            data['trashed'] = (timezone.now() - timedelta(hours=1)).isoformat()
            data.update(extra)
        self.change(key, go, flat=False)

    def test_a_book_deleted_by_mistake_keeps_its_page_and_is_not_published(self):
        self.trash('gilgamesh')
        self.change('gilgamesh', lambda data: data.update(title='Gilgamesh!'), flat=False)
        counts, said = self.publish()
        self.assertEqual(counts['published'], 0, said)
        self.assertNotIn('Gilgamesh!', self.post('gilgamesh'))
        self.import_booklog()
        self.assertIn('trashed', self.book('gilgamesh').data)   # the import leaves it in the Trash

    def test_a_dropped_book_leaves_the_booklog_and_comes_back_when_put_back(self):
        self.trash('gilgamesh', dropped=True)
        row = self.book('gilgamesh')
        counts, said = self.publish()
        self.assertEqual((counts['published'], counts['failed']), (1, 0), said)
        self.assertEqual(self.log()[0], 'Verwijderd: Gilgamesh')
        self.assertFalse((self.repo / 'site/content/posts/gilgamesh.md').exists())
        row = Book.objects.get(pk=row.pk)
        self.assertFalse(row.deleted)
        self.assertIn('trashed', row.data)
        self.assertNotIn('boeken', row.data)                     # unlinked, still in the Trash
        self.assertEqual(self.publish()[0]['published'], 0)

        # Put back: off the Trash, and asked to be published again (as the app does).
        data = {k: v for k, v in row.data.items() if k not in ('trashed', 'dropped')}
        data['boekenWanted'] = True
        page = self.repo / 'site' / 'content' / 'categories' / 'roman'   # what a new post needs (the fixture has none)
        page.mkdir(parents=True)
        (page / '_index.md').write_text('---\ntitle: "roman"\n---\n', encoding='utf-8', newline='')
        git(self.repo, 'add', '.')
        git(self.repo, '-c', 'user.name=T', '-c', 'user.email=t@example.org', 'commit', '--quiet', '-m', 'Category')
        data['categories'] = ['roman']
        data['editions'][0]['language'] = 'en'
        row.data, row.modified = data, timezone.now() - timedelta(hours=1)
        row.save()
        counts, said = self.publish()
        self.assertEqual(counts['published'], 1, said)
        self.assertTrue(Book.objects.get(pk=row.pk).data.get('boeken'))

    def test_a_read_taken_off_the_booklog_stays_and_is_not_published_again(self):
        self.change('dune', lambda data: data.update(unpublish=['dune-herlezing']), flat=False)
        self.import_booklog()   # before it is published, the import leaves the read as it is
        self.assertEqual(len(self.book('dune').data['reviews']), 2)
        counts, said = self.publish()
        self.assertEqual(counts['published'], 1, said)
        self.assertFalse((self.repo / 'site/content/posts/dune-herlezing.md').exists())
        self.assertTrue((self.repo / 'site/content/posts/dune.md').exists())
        book = self.book('dune').data
        self.assertNotIn('unpublish', book)
        second = [r for r in book['reviews'] if r.get('local')]
        self.assertEqual(len(second), 1)
        self.assertNotIn('boeken', second[0])
        self.assertEqual(self.publish()[0]['published'], 0)       # never published again
        self.import_booklog()
        self.assertEqual(len(self.book('dune').data['reviews']), 2)

    def test_a_whole_book_taken_off_the_booklog_stays_on_the_shelf(self):
        row = self.book('dune')
        self.change('dune', lambda data: data.update(unpublish=['dune', 'dune-herlezing']), flat=False)
        counts, said = self.publish()
        self.assertEqual(counts['failed'], 0, said)
        for slug in ('dune', 'dune-herlezing'):
            self.assertFalse((self.repo / f'site/content/posts/{slug}.md').exists())
        data = Book.objects.get(pk=row.pk).data
        self.assertNotIn('boeken', data)
        self.assertTrue(all(r.get('local') for r in data['reviews']))
        self.assertEqual(len(works.flat(data)['reviews']), 2)
        self.assertEqual(self.publish()[0]['published'], 0)
