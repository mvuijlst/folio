import json
from datetime import timedelta
from io import StringIO
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone

from . import pages
from .models import Book

ANSWER = {'data': {'editions': [
    {'isbn_13': '9780752877327', 'isbn_10': '0752877321', 'pages': 694},
    {'isbn_13': None, 'isbn_10': '0141439513', 'pages': 480},          # known by its ISBN-10 only
    {'isbn_13': '9780000000002', 'isbn_10': None, 'pages': None},     # an edition without a page count
]}}


class ReadingHardcover(SimpleTestCase):
    def test_pages_by_isbn13_and_isbn10(self):
        got = pages.from_hardcover(ANSWER, ['9780752877327', '9780141439518', '9780000000002'])
        self.assertEqual(got, {'9780752877327': 694, '9780141439518': 480})

    def test_errors_are_raised(self):
        with self.assertRaises(RuntimeError):
            pages.from_hardcover({'errors': [{'message': 'invalid token'}]}, ['9780752877327'])

    @override_settings(HARDCOVER_API_TOKEN='')
    def test_without_a_token(self):
        with self.assertRaises(pages.NotSetUp):
            pages.hardcover(['9780752877327'])

    @override_settings(HARDCOVER_API_TOKEN='abc')
    def test_the_request(self):
        with mock.patch.object(pages, 'post_json', return_value=ANSWER) as asked:
            self.assertEqual(pages.hardcover(['9780752877327']), {'9780752877327': 694})
        _, payload, headers = asked.call_args.args
        self.assertEqual(headers, {'Authorization': 'Bearer abc'})
        self.assertEqual(payload['variables'], {'isbns': ['9780752877327', '0752877321']})

    @override_settings(HARDCOVER_API_TOKEN='Bearer abc')
    def test_a_token_with_bearer_in_front(self):
        self.assertEqual(pages.token(), 'Bearer abc')

    def test_median(self):
        with mock.patch.object(pages, 'get_json', return_value={'docs': [{'number_of_pages_median': 712}]}):
            self.assertEqual(pages.median('9780752877327'), 712)
        with mock.patch.object(pages, 'get_json', return_value={'docs': []}):
            self.assertIsNone(pages.median('9780752877327'))

    @override_settings(HARDCOVER_API_TOKEN='abc')
    def test_one_falls_back_on_the_median(self):
        with mock.patch.object(pages, 'post_json', return_value={'data': {'editions': []}}), \
             mock.patch.object(pages, 'median', return_value=712):
            self.assertEqual(pages.one('9780752877327'), 712)


@override_settings(HARDCOVER_API_TOKEN='abc')
class AskingTheServer(TestCase):
    def setUp(self):
        cache.clear()
        self.user = get_user_model().objects.create_user('reader', password='pw')

    def ask(self, isbn):
        return self.client.post('/api/pages', json.dumps({'isbn': isbn}), content_type='application/json')

    def test_signed_out(self):
        self.assertEqual(self.ask('9780752877327').status_code, 401)

    def test_found_and_remembered(self):
        self.client.force_login(self.user)
        with mock.patch.object(pages, 'post_json', return_value=ANSWER) as asked:
            self.assertEqual(self.ask('9780752877327').json(), {'pages': 694})
            self.assertEqual(self.ask('9780752877327').json(), {'pages': 694})
        self.assertEqual(asked.call_count, 1)

    def test_bad_isbn(self):
        self.client.force_login(self.user)
        self.assertEqual(self.ask('12').status_code, 400)

    @override_settings(HARDCOVER_API_TOKEN='')
    def test_not_set_up(self):
        self.client.force_login(self.user)
        self.assertEqual(self.ask('9780752877327').status_code, 503)


@override_settings(HARDCOVER_API_TOKEN='abc')
class FillPages(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user('reader')
        t = timezone.now() - timedelta(days=1)

        def book(uid, edition, **extra):
            return Book.objects.create(user=self.user, uid=uid, title=uid, modified=t, changed=t,
                                       data={'id': uid, 'title': uid, 'v': 2, 'lists': {}, 'editions': [edition], **extra})
        self.empty = book('empty', {'id': 'e1', 'format': 'paper', 'isbn': '9780752877327'})
        self.other = book('other', {'id': 'e1', 'format': 'paper', 'isbn': '9780141439518'})
        self.known = book('known', {'id': 'e1', 'format': 'paper', 'isbn': '9780000000002', 'pages': 100})
        self.audio = book('audio', {'id': 'e1', 'format': 'audiobook', 'isbn': '9780000000019', 'duration': '10u'})
        self.linked = book('linked', {'id': 'e1', 'format': 'paper', 'isbn': '9780000000026'}, boeken='linked')
        self.median = book('median', {'id': 'e1', 'format': 'ebook', 'isbn': '9780000000033'})

    def run_command(self, *args):
        out = StringIO()
        with mock.patch.object(pages, 'post_json', return_value=ANSWER) as asked, \
             mock.patch.object(pages, 'median', side_effect=lambda isbn: 300 if isbn == '9780000000033' else None), \
             mock.patch('time.sleep'):
            call_command('fill_pages', '--user', 'reader', *args, stdout=out, stderr=StringIO())
        self.asked = asked.call_args.args[1]['variables']['isbns']
        return out.getvalue()

    def test_dry_run(self):
        said = self.run_command()
        self.assertIn('Asked about 3 ISBNs: 2 from Hardcover, 1 from the Open Library median, 0 without.', said)
        self.assertIn('Would fill the pages of 3 editions, in 3 books.', said)
        self.assertIn('3 ISBNs without pages to look up (1 editions on the booklog left out).', said)
        self.assertIn('  Hardcover: 3 of 3 asked, 2 found', said)
        self.assertIn('1 editions of books on the booklog were left out', said)
        self.assertNotIn('9780000000002', self.asked)      # has pages
        self.assertNotIn('9780000000019', self.asked)      # an audiobook
        self.empty.refresh_from_db()
        self.assertNotIn('pages', self.empty.data['editions'][0])

    def test_write(self):
        self.run_command('--write')
        for row, n in ((self.empty, 694), (self.other, 480), (self.median, 300)):
            row.refresh_from_db()
            self.assertEqual(row.data['editions'][0]['pages'], n)
            self.assertGreater(row.changed, row.modified)
        self.known.refresh_from_db()
        self.assertEqual(self.known.data['editions'][0]['pages'], 100)

    def test_no_median(self):
        self.run_command('--write', '--no-median')
        self.median.refresh_from_db()
        self.assertNotIn('pages', self.median.data['editions'][0])
