"""Covers kept on the server (shelf/covers.py): every one small and large."""
import io
import tempfile
from pathlib import Path
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from . import covers
from .models import Book

OL = 'https://covers.openlibrary.org/b/id/9-M.jpg'
BOEKEN = 'https://boeken.tsuk.org/wp-content/uploads/2012/01/the-hobbit.jpg'


def jpeg(width=900, height=1400):
    from PIL import Image
    out = io.BytesIO()
    Image.new('RGB', (width, height), (120, 40, 60)).save(out, 'JPEG')
    return out.getvalue()


class CoverTests(TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        settings = override_settings(COVERS_DIR=self.root / 'covers')
        settings.enable()
        self.addCleanup(settings.disable)
        cache.clear()
        self.user = get_user_model().objects.create_user('reader', password='x')
        self.download = mock.patch.object(covers, 'download', side_effect=lambda url: jpeg()).start()
        self.addCleanup(mock.patch.stopall)

    def book(self, uid, **edition):
        now = timezone.now()
        return Book.objects.create(user=self.user, uid=uid, modified=now, changed=now,
                                   data={'id': uid, 'v': 2, 'title': uid, 'editions': [{'id': 'e1', **edition}]})

    def edition(self, uid):
        return Book.objects.get(user=self.user, uid=uid).data['editions'][0]

    def file(self, path):
        return self.root / path

    def test_a_catalogue_cover_is_kept_small_and_large(self):
        self.download.side_effect = lambda url: jpeg(2000, 3000)
        self.book('b1', cover=OL)
        covers.adopt(self.user)
        e = self.edition('b1')
        self.assertEqual(e['coverSource'], OL)
        self.assertTrue(e['cover'].startswith('covers/web/') and e['cover'].endswith('-320.webp'))
        self.assertTrue(e['coverFull'].startswith('covers/web/') and e['coverFull'].endswith('.jpg'))
        from PIL import Image
        with Image.open(self.file(e['coverFull'])) as large:
            self.assertEqual(large.size, (1067, covers.FULL))   # 2000 × 3000, brought down to at most FULL
        with Image.open(self.file(e['cover'])) as small:
            self.assertEqual(small.width, covers.WIDTH)
        # Asked for the large size first.
        self.assertEqual(self.download.call_args_list[0].args[0], 'https://covers.openlibrary.org/b/id/9-L.jpg?default=false')

    def test_a_cover_kept_small_before_gets_its_large_copy(self):
        self.book('old', cover='covers/web/0123456789abcdef-320.webp', coverSource=OL, coverRatio=0.64)
        self.book('boeken', cover='covers/boeken/feedfacefeedface-320.webp', coverSource=BOEKEN, coverRatio=0.62)
        self.book('own', cover='covers/own/aa-320.webp', coverFull='covers/own/aa.jpg')
        self.book('nowhere', cover='covers/web/bb-320.webp')   # no source to fetch it from
        before = Book.objects.get(uid='old').modified
        changed = covers.adopt(self.user)
        self.assertEqual(sorted(b.uid for b in changed), ['boeken', 'old'])
        for uid in ('old', 'boeken'):
            e = self.edition(uid)
            self.assertTrue(self.file(e['coverFull']).is_file(), uid)
            self.assertEqual(e['cover'], {'old': 'covers/web/0123456789abcdef-320.webp', 'boeken': 'covers/boeken/feedfacefeedface-320.webp'}[uid])
        self.assertEqual(self.edition('own')['coverFull'], 'covers/own/aa.jpg')
        self.assertNotIn('coverFull', self.edition('nowhere'))
        self.assertEqual(Book.objects.get(uid='old').modified, before)   # nobody edited it: only `changed` moves

    def test_a_few_at_a_time_then_nothing_until_there_is_something(self):
        for n in range(6):
            self.book(f'b{n}', cover=f'covers/web/{n:016x}-320.webp', coverSource=f'{OL}?{n}')
        self.assertEqual(len(covers.adopt(self.user, limit=4)), 4)
        self.assertEqual(len(covers.adopt(self.user, limit=4)), 2)
        self.assertEqual(covers.adopt(self.user, limit=4), [])
        calls = self.download.call_count
        self.book('late', cover='covers/web/ffffffffffffffff-320.webp', coverSource=f'{OL}?late')
        self.assertEqual(covers.adopt(self.user, limit=4), [])   # caught up: not looked for again within the hour
        self.assertEqual(self.download.call_count, calls)
        cache.clear()
        self.assertEqual([b.uid for b in covers.adopt(self.user, limit=4)], ['late'])

    def test_one_that_cannot_be_fetched_does_not_keep_it_searching(self):
        self.book('gone', cover='covers/web/eeeeeeeeeeeeeeee-320.webp', coverSource=f'{OL}?gone')
        self.download.side_effect = OSError('404')
        self.assertEqual(covers.adopt(self.user, limit=4), [])
        self.download.side_effect = lambda url: jpeg()
        self.assertEqual(covers.adopt(self.user, limit=4), [])   # failed: left alone for a week, and caught up meanwhile
        self.assertNotIn('coverFull', self.edition('gone'))

    def test_the_command_does_a_whole_shelf(self):
        from django.core.management import call_command
        for n in range(7):
            self.book(f'b{n}', cover=f'covers/web/{n:016x}-320.webp', coverSource=f'{OL}?{n}')
        out = io.StringIO()
        call_command('fetch_covers', stdout=out)
        self.assertIn('0 covers still only small', out.getvalue())
        self.assertTrue(all(self.edition(f'b{n}').get('coverFull') for n in range(7)))
