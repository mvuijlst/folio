import io
import json
import tempfile
from datetime import timezone as dt_timezone
from io import StringIO
from pathlib import Path
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from django.test import override_settings

from shelf import boeken, covers, publish
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
A long review, with *emphasis*.

{{< bookimg src="uploads/2010/03/worm.jpg" alt="A worm" >}}

See [the sequel](/2011/02/dune-messiah/) and {{< youtube VRaoHi_xcWk >}}.
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
Why this is on the pile.
''',
}
AUTHORS = {'herbert-frank': 'Frank Herbert', 'kuang-r-f': 'R.F. Kuang', 'someone-else': 'Some Translator'}


def make_repo(root, posts=POSTS):
    folder = Path(root, 'site', 'content', 'posts')
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob('*.md'):
        old.unlink()
    for slug, text in posts.items():
        (folder / f'{slug}.md').write_text(text, encoding='utf-8', newline='')   # as the booklog has them: LF
    for slug, name in AUTHORS.items():
        term = Path(root, 'site', 'content', 'authors', slug)
        term.mkdir(parents=True, exist_ok=True)
        (term / '_index.md').write_text(f'---\ntitle: "{name}"\nslug: "{slug}"\n---\n', encoding='utf-8', newline='')


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
        self.assertRegex(cover, r'^covers/boeken/[0-9a-f]{16}-320[.]webp$')
        with Image.open(Path(self.tmp.name, 'thumbs', cover.rsplit('/', 1)[1])) as thumb:
            self.assertEqual(thumb.size, (320, 480))
        self.assertEqual(self.book('dune')['coverRatio'], 0.667)     # its own proportions, known before it loads
        self.assertIn('3 unchanged', self.run_import())
        self.assertIn('0 cover thumbnails made', self.run_import())

    def book(self, key):
        return Book.objects.get(user=self.user, data__boeken=key).data

    def test_posts_become_books_on_the_right_lists(self):
        self.assertIn('3 added', self.run_import())
        dune = self.book('dune')
        self.assertEqual(dune['id'], 'boeken-dune')
        self.assertEqual(dune['author'], 'Frank Herbert')            # the translator is not an author
        self.assertEqual(dune['cover'], 'https://boeken.tsuk.org/wp-content/uploads/2010/03/dune.jpg')
        self.assertEqual((dune['series'], dune['seriesNumber'], dune['date'], dune['pages']), ('Dune', 1, '1990', 535))
        self.assertEqual(self.book('katabasis')['lists'], {'reading': {'at': '2026-10-11T14:37:13.000Z'}})
        self.assertEqual(list(self.book('gilgamesh')['lists']), ['to-read'])
        self.assertEqual(self.book('gilgamesh')['author'], 'unknown-slug')

    def test_people_come_with_what_they_did(self):
        self.run_import()
        dune = self.book('dune')
        # The book has the people of its latest read; each read's edition has its own.
        self.assertEqual(dune['people'], [{'name': 'Frank Herbert', 'role': 'auteur'}])
        self.assertEqual([r['edition']['people'] for r in dune['reviews']], [
            [{'name': 'Frank Herbert', 'role': 'auteur'}, {'name': 'Some Translator', 'role': 'vertaling'}],
            [{'name': 'Frank Herbert', 'role': ''}]])
        self.assertEqual(self.book('katabasis')['people'], [{'name': 'R.F. Kuang', 'role': ''}])

    def test_reviews_from_before_people_get_them(self):
        self.run_import()
        row = Book.objects.get(uid='boeken-dune')
        # As the import left them before editions had people: no people, and the older fingerprint.
        old = []
        for review in row.data['reviews']:
            review = {**review, 'edition': {k: v for k, v in review['edition'].items() if k != 'people'}}
            old.append({**review, 'sum': boeken.review_sum(review, version=2)})
        row.data = {**{k: v for k, v in row.data.items() if k != 'people'}, 'reviews': old,
                    'boekenState': {k: v for k, v in row.data['boekenState'].items() if k != 'people'}}
        row.save()
        self.assertTrue(all(boeken.in_step(r) for r in old))
        self.assertFalse(publish.is_pending(row.data))
        # People said in the app on such a review are a change, though its fingerprint knows nothing of them.
        said = {**old[1], 'edition': {**old[1]['edition'], 'people': [{'name': 'Frank Herbert', 'role': ''}, {'name': 'A Voice', 'role': 'stem'}]}}
        self.assertFalse(boeken.in_step(said))
        self.assertIn('1 updated', self.run_import())
        dune = self.book('dune')
        self.assertEqual(len(dune['reviews'][0]['edition']['people']), 2)
        self.assertTrue(all(r['sum'].startswith(f'{boeken.SUM_VERSION}:') for r in dune['reviews']))
        self.assertEqual(dune['boekenState']['people'], [{'name': 'Frank Herbert', 'role': 'auteur'}])

    def test_what_a_read_was_read_as(self):
        audio = POSTS['dune-herlezing'].replace('pages: 535', 'duration: "21u 2m"')
        make_repo(self.tmp.name, {**POSTS, 'dune-herlezing': audio,
                                  'katabasis': POSTS['katabasis'].replace('pages: 559', 'format: "ebook"\npages: 559')})
        self.run_import()
        dune = self.book('dune')
        self.assertEqual(dune['format'], 'audiobook')                  # the book is as its latest read was
        self.assertEqual([r['edition'].get('format') for r in dune['reviews']], [None, 'audiobook'])   # the first read doesn't say
        self.assertEqual(self.book('katabasis')['format'], 'ebook')    # said in so many words
        self.assertNotIn('format', self.book('gilgamesh'))

    def test_a_format_said_in_the_app_is_a_change_an_older_fingerprint_cannot_vouch_for(self):
        self.run_import()
        review = self.book('dune')['reviews'][0]
        older = {**review, 'sum': boeken.review_sum(review, version=3)}
        self.assertTrue(boeken.in_step(older))
        self.assertFalse(boeken.in_step({**older, 'edition': {**older['edition'], 'format': 'paper'}}))

    def test_what_was_not_tracked_before_is_not_a_change(self):
        self.run_import()
        row = Book.objects.get(uid='boeken-dune')
        # As it was left before lengths and formats were published: the state says nothing of them.
        older = {k: v for k, v in row.data['boekenState'].items() if k not in ('format', 'duration', 'tracks')}
        row.data = {**row.data, 'duration': '21u 2m', 'format': 'audiobook', 'boekenState': older}
        row.save()
        self.assertEqual(publish.changed_keys(row.data), set())
        self.assertIn('0 waiting to be published', self.run_import())
        self.assertEqual(self.book('dune')['boekenState']['tracks'], boeken.TRACKS)
        # From then on they are tracked.
        self.assertEqual(publish.changed_keys({**self.book('dune'), 'format': 'ebook'}), {'format'})

    def test_a_reread_is_the_same_book(self):
        self.run_import()
        dune = self.book('dune')
        self.assertEqual(dune['rating'], 10)                           # of the latest read
        self.assertEqual(dune['added'], '2010-03-31T21:30:00.000Z')    # when it was first read
        self.assertEqual(dune['lists'], {'read': {'at': '2024-05-02T08:00:00.000Z'}})
        self.assertEqual([(r['date'], r['rating'], r['url']) for r in dune['reviews']],
                         [('2010-03-31', 9, 'https://boeken.tsuk.org/2010/03/dune/'),
                          ('2024-05-02', 10, 'https://boeken.tsuk.org/2024/05/dune-herlezing/')])
        self.assertTrue(dune['isbn'])                                   # the first read knew it; the reread did not
        self.assertEqual(dune['url'], 'https://boeken.tsuk.org/2024/05/dune-herlezing/')

    def test_month_in_the_address_is_the_one_written_in_the_file(self):
        # The address follows the date as written in the file, not that moment in another time zone.
        self.assertEqual({p['slug']: p['_url'] for p in boeken.read_posts(self.tmp.name)}['dune'],
                         'https://boeken.tsuk.org/2010/03/dune/')

    def test_an_omnibus_sorts_by_its_number_and_shows_its_label(self):
        make_repo(self.tmp.name, {'dune': POSTS['dune'].replace('series_number: 1\n', 'series_number: 4.5\nseries_number_label: "4/5"\n')})
        self.run_import()
        self.assertEqual((self.book('dune')['seriesNumber'], self.book('dune')['seriesLabel']), (4.5, '4/5'))

    def test_reads_become_reviews(self):
        self.assertIn('3 reviews', self.run_import())
        first = self.book('dune')['reviews'][0]
        self.assertEqual(first['id'], 'boeken-dune')
        self.assertEqual(first['text'], 'A long review, with *emphasis*.\n\n'
                         '![A worm](https://boeken.tsuk.org/wp-content/uploads/2010/03/worm.jpg)\n\n'
                         'See [the sequel](https://boeken.tsuk.org/2011/02/dune-messiah/) and '
                         '[YouTube](https://www.youtube.com/watch?v=VRaoHi_xcWk).')
        self.assertEqual(self.book('dune')['reviews'][1]['text'], '')            # a read without a write-up
        # Not read yet: what was written is kept, without a reading date. Nothing written, no review.
        self.assertEqual([(r['date'], r['rating'], r['text']) for r in self.book('gilgamesh')['reviews']],
                         [('', None, 'Why this is on the pile.')])
        self.assertNotIn('reviews', self.book('katabasis'))

    def test_reviews_changed_or_written_in_the_app_are_kept(self):
        self.run_import()
        row = Book.objects.get(uid='boeken-dune')
        edited = {**row.data['reviews'][0], 'text': 'My better words.'}
        own = {'id': 'x1', 'date': '2025-01-01', 'rating': 7, 'text': 'Listened to it this time.'}
        row.data = {**row.data, 'reviews': [edited, row.data['reviews'][1], own]}
        row.save()
        # The booklog changes both of its reviews; only the one left alone in the app follows.
        make_repo(self.tmp.name, {**POSTS, 'dune': POSTS['dune'].replace('A long review', 'A longer review'),
                                  'dune-herlezing': POSTS['dune-herlezing'].replace('rating: 10', 'rating: 9')})
        self.assertIn('1 reviews kept as edited in the app', self.run_import())
        self.assertEqual([(r['date'], r['rating'], r['text'][:16]) for r in self.book('dune')['reviews']],
                         [('2010-03-31', 9, 'My better words.'), ('2024-05-02', 9, ''), ('2025-01-01', 7, 'Listened to it t')])

    def test_how_progress_is_said_lasts_as_long_as_the_read(self):
        self.run_import()
        row = Book.objects.get(uid='boeken-katabasis')
        row.data = {**row.data, 'progressUnit': 'percent', 'percentRead': 17}
        row.save()
        self.run_import()
        self.assertEqual((self.book('katabasis')['progressUnit'], self.book('katabasis')['percentRead']), ('percent', 17))
        # Finished in the booklog: the choice was for that read.
        done = POSTS['katabasis'].replace('pagesRead: 95\n', '').replace('status: "reading"\n', 'rating: 8\n')
        make_repo(self.tmp.name, {**POSTS, 'katabasis': done})
        self.run_import()
        self.assertNotIn('progressUnit', self.book('katabasis'))
        self.assertNotIn('percentRead', self.book('katabasis'))

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
        self.assertNotIn('reviews', kept)
        self.assertEqual(Book.objects.get(uid='boeken-dune').modified.tzinfo, dt_timezone.utc)

    def test_other_users_are_untouched(self):
        other = get_user_model().objects.create_user('someone', password='x')
        self.run_import()
        self.assertFalse(Book.objects.filter(user=other).exists())


def png(width, height):
    from PIL import Image
    out = io.BytesIO()
    Image.new('RGB', (width, height), 'teal').save(out, 'PNG')
    return out.getvalue()


class CoverTests(TestCase):
    """Covers that live at a book catalogue get a copy on the server."""

    def setUp(self):
        self.user = get_user_model().objects.create_user('reader', password='x')
        self.client.force_login(self.user)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        settings = override_settings(COVERS_DIR=Path(self.tmp.name))
        settings.enable()
        self.addCleanup(settings.disable)

    def sync(self, *books):
        changes = [{'id': b['id'], 'modified': '2026-11-14T10:00:00Z', 'deleted': False, 'book': b} for b in books]
        res = self.client.post('/api/sync', json.dumps({'since': None, 'changes': changes}), content_type='application/json')
        self.assertEqual(res.status_code, 200, res.content)
        return res.json()

    def test_a_scanned_books_cover_is_copied_and_the_book_comes_back_pointing_at_it(self):
        url = 'https://covers.openlibrary.org/b/id/123-M.jpg'
        with mock.patch.object(covers, 'download', return_value=png(320, 400)) as download:
            answer = self.sync({'id': 'b1', 'title': 'Dune', 'cover': url})
        self.assertEqual(download.call_args.args[0], 'https://covers.openlibrary.org/b/id/123-L.jpg?default=false')
        book = answer['changes'][0]['book']
        self.assertRegex(book['cover'], r'^covers/web/[0-9a-f]{16}-320[.]webp$')
        self.assertEqual((book['coverRatio'], book['coverSource']), (0.8, url))
        self.assertTrue(Path(self.tmp.name, 'web', book['cover'].rsplit('/', 1)[1]).is_file())
        self.assertEqual(answer['changes'][0]['modified'], '2026-11-14T10:00:00Z')   # nobody edited the book

    def test_only_the_catalogues_are_asked(self):
        with mock.patch.object(covers, 'download') as download:
            answer = self.sync({'id': 'b1', 'title': 'A', 'cover': 'https://example.org/internal.jpg'},
                               {'id': 'b2', 'title': 'B', 'cover': 'http://books.google.com/x'},
                               {'id': 'b3', 'title': 'C', 'cover': 'covers/web/already.webp'})
        download.assert_not_called()
        self.assertEqual(answer['changes'], [])

    def test_a_cover_that_cannot_be_fetched_is_left_and_not_asked_for_again(self):
        url = 'https://books.google.com/books/content?id=x&img=1'
        with mock.patch.object(covers, 'download', side_effect=OSError('gone')) as download:
            self.assertEqual(self.sync({'id': 'b1', 'title': 'Dune', 'cover': url})['changes'], [])
            self.sync({'id': 'b1', 'title': 'Dune', 'cover': url})
        self.assertEqual(download.call_count, 1)
        self.assertEqual(Book.objects.get(uid='b1').data['cover'], url)

    def test_a_blank_pixel_is_not_a_cover(self):
        with mock.patch.object(covers, 'download', return_value=png(1, 1)):
            self.assertEqual(self.sync({'id': 'b1', 'title': 'Dune', 'cover': 'https://covers.openlibrary.org/b/id/1-M.jpg'})['changes'], [])

    def test_fetch_covers_does_a_whole_shelf(self):
        when = timezone.now()
        for n in range(7):
            Book.objects.create(user=self.user, uid=f'b{n}', modified=when, changed=when,
                                data={'id': f'b{n}', 'title': str(n), 'cover': f'https://books.google.com/books/content?id={n}'})
        out = StringIO()
        with mock.patch.object(covers, 'download', return_value=png(300, 450)):
            call_command('fetch_covers', stdout=out)
        self.assertIn('reader: 7 covers kept, 0 could not be fetched', out.getvalue())
        self.assertTrue(all(b.data['cover'].startswith('covers/web/') for b in Book.objects.all()))

    def test_a_cover_handed_in_is_kept_large_and_small(self):
        res = self.client.post('/api/cover', png(2400, 3600), content_type='image/png')
        self.assertEqual(res.status_code, 200, res.content)
        kept = res.json()
        self.assertRegex(kept['cover'], r'^covers/own/[0-9a-f]{16}-320[.]webp$')
        self.assertEqual(kept['coverRatio'], 0.667)
        from PIL import Image
        with Image.open(Path(self.tmp.name, 'own', kept['coverFull'].rsplit('/', 1)[1])) as full:
            self.assertEqual((full.format, full.size), ('JPEG', (1067, 1600)))

    def test_only_pictures_and_only_when_signed_in(self):
        self.assertEqual(self.client.post('/api/cover', b'<html>not a picture</html>', content_type='image/png').status_code, 400)
        self.assertFalse(Path(self.tmp.name, 'own').exists() and any(Path(self.tmp.name, 'own').iterdir()))
        self.client.logout()
        self.assertEqual(self.client.post('/api/cover', png(300, 450), content_type='image/png').status_code, 401)

    def test_a_cover_that_travels_inside_the_book_gets_a_file(self):
        import base64
        thumb = 'data:image/png;base64,' + base64.b64encode(png(200, 300)).decode()
        answer = self.sync({'id': 'b1', 'title': 'Dune', 'cover': '', 'thumb': thumb})
        book = answer['changes'][0]['book']
        self.assertRegex(book['cover'], r'^covers/own/[0-9a-f]{16}-320[.]webp$')
        self.assertEqual(book['thumb'], thumb)       # still there, for when the device is offline
        self.assertEqual(self.sync()['changes'][0]['book']['cover'], book['cover'])
