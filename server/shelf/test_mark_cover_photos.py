"""manage.py mark_cover_photos: covers shaped like the scanner's viewfinder are its photographs."""
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.utils.dateparse import parse_datetime

from shelf import works
from shelf.models import Book

WHEN = parse_datetime('2026-11-15T10:00:00Z')


class MarkCoverPhotosTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user('reader', password='x')

    def put(self, uid, **edition):
        book = works.upgrade({'id': uid, 'added': '2026-11-15T10:00:00.000Z', 'title': uid, **edition})
        return Book.objects.create(user=self.user, uid=uid, data=book, title=uid, modified=WHEN, changed=WHEN)

    def run_it(self, *args):
        out = StringIO()
        call_command('mark_cover_photos', '--user', 'reader', *args, stdout=out)
        return out.getvalue()

    def test_photographs_are_marked_and_nothing_else(self):
        self.put('photo', cover='covers/own/a-320.webp', coverFull='covers/own/a.jpg', thumb='data:image/jpeg;base64,x', coverRatio=0.687)
        self.put('waiting', thumb='data:image/jpeg;base64,y', coverRatio=0.6875)          # not kept by the server yet
        self.put('chosen', cover='covers/own/b-320.webp', thumb='data:image/jpeg;base64,z', coverRatio=0.786)
        self.put('catalogue', cover='covers/web/c-320.webp', coverSource='https://covers.openlibrary.org/b/id/1-L.jpg', coverRatio=0.687)
        self.put('booklog', cover='covers/boeken/d-320.webp', coverSource='https://boeken.tsuk.org/d.jpg', coverRatio=0.687)
        self.assertIn('Would be: 2 books', self.run_it('--dry-run'))
        self.assertNotIn('coverPhoto', Book.objects.get(uid='photo').data['editions'][0])
        self.run_it()
        marked = {b.uid for b in Book.objects.all() if b.data['editions'][0].get('coverPhoto')}
        self.assertEqual(marked, {'photo', 'waiting'})
        row = Book.objects.get(uid='photo')
        self.assertEqual((row.modified, row.changed > WHEN), (WHEN, True))   # devices fetch it; an edit made since still wins
        self.assertIn('Done: 0 books', self.run_it())

    def test_the_flat_view_and_an_upgrade_keep_the_mark(self):
        data = works.upgrade({'id': 'x', 'title': 'x', 'cover': 'covers/own/a-320.webp', 'coverPhoto': True, 'coverRatio': 0.687})
        self.assertIs(data['editions'][0]['coverPhoto'], True)
        self.assertIs(works.flat(data)['coverPhoto'], True)
