"""The assistant: what it asks, what it believes, and how it fits proposals to the booklog."""
import json
import tempfile
from pathlib import Path
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings

from shelf import intake
from shelf.test_boeken import make_repo

PIRANESI = {
    'title': 'Children of Dune', 'authors': [{'name': 'Herbert, Frank', 'role': None}, {'name': 'Jan Vertaler', 'role': 'vertaling'}],
    'publisher': 'Ace', 'year': 1987, 'pages': 408, 'duration': None, 'series': 'dune', 'series_number': 3.0,
    'language': 'en', 'categories': ['sf', 'made-up'], 'tags': ['Space Opera', 'DESERT'], 'note': 'Derde deel van de Dune-reeks.',
}
OPEN_LIBRARY = {'docs': [
    {'key': '/works/OL1W', 'title': 'Children of Dune 2', 'author_name': ['Frank Herbert'], 'isbn': ['9780000000001'], 'cover_i': 1},
    {'key': '/works/OL2W', 'title': 'Children of Dune', 'author_name': ['Somebody Else'], 'isbn': ['9780000000002'], 'cover_i': 2},
    {'key': '/works/OL893502W', 'title': 'Children of Dune', 'author_name': ['Frank Herbert'], 'isbn': ['0441104029', '9780441104024'], 'cover_i': 77},
]}


def model_says(*books):
    return {'choices': [{'message': {'content': json.dumps({'books': list(books)})}}]}


@override_settings(OPENAI_API_KEY='test-key', OPENAI_MODEL='test-model')
class IntakeTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = get_user_model().objects.create_user('reader', password='x')
        self.client.force_login(self.user)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        make_repo(self.tmp.name)
        for kind, slug, title in (('categories', 'sf', 'sf'), ('tags', 'space-opera', 'space-opera'), ('tags', 'desert', 'desert'), ('series', 'dune', 'Dune')):
            page = Path(self.tmp.name, 'site', 'content', kind, slug, '_index.md')
            page.parent.mkdir(parents=True)
            page.write_text(f'---\ntitle: "{title}"\nslug: "{slug}"\n---\n', encoding='utf-8', newline='')

    def ask(self, text='the third Dune'):
        return self.client.post('/api/suggest', json.dumps({'text': text}), content_type='application/json')

    def test_a_description_becomes_a_proposal_fitted_to_the_booklog(self):
        with override_settings(BOEKEN_REPO=self.tmp.name), \
                mock.patch.object(intake, 'post_json', return_value=model_says(PIRANESI)) as asked, \
                mock.patch.object(intake, 'get_json', return_value=OPEN_LIBRARY):
            res = self.ask()
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()['books'], [{
            'title': 'Children of Dune',
            'author': 'Frank Herbert',            # as the booklog writes him; the translator is not an author
            'publisher': 'Ace', 'date': '1987', 'pages': 408,
            'series': 'Dune', 'seriesNumber': 3,  # the booklog's spelling of the series
            'language': 'en',
            'categories': ['sf'],                 # only categories the booklog has
            'tags': ['space-opera', 'desert'],    # its own tags
            'note': 'Derde deel van de Dune-reeks.',
            'isbn': '9780441104024', 'olid': 'OL893502W',   # the hit with the same title and author, not the others
            'cover': 'https://covers.openlibrary.org/b/id/77-L.jpg',
        }])
        url, payload, headers = asked.call_args.args
        self.assertEqual((url, payload['model'], headers), ('https://api.openai.com/v1/chat/completions', 'test-model', {'Authorization': 'Bearer test-key'}))
        self.assertIn('UITSLUITEND uit deze lijst: sf.', payload['messages'][0]['content'])
        self.assertEqual(payload['messages'][1], {'role': 'user', 'content': 'the third Dune'})
        self.assertTrue(payload['response_format']['json_schema']['strict'])

    def test_open_library_is_not_believed_when_it_is_another_book(self):
        with mock.patch.object(intake, 'post_json', return_value=model_says({**PIRANESI, 'title': 'Something Else Entirely'})), \
                mock.patch.object(intake, 'get_json', return_value=OPEN_LIBRARY):
            book = self.ask().json()['books'][0]
        self.assertNotIn('isbn', book)
        self.assertNotIn('cover', book)

    def test_a_proposal_survives_open_library_being_down(self):
        with mock.patch.object(intake, 'post_json', return_value=model_says(PIRANESI)), \
                mock.patch.object(intake, 'get_json', side_effect=OSError('down')):
            self.assertEqual(self.ask().json()['books'][0]['title'], 'Children of Dune')

    def test_what_goes_wrong_is_said_plainly(self):
        with mock.patch.object(intake, 'post_json', side_effect=OSError('no route')):
            res = self.ask()
        self.assertEqual(res.status_code, 502)
        self.assertIn('could not be reached', res.json()['error'])
        with mock.patch.object(intake, 'post_json', return_value={'unexpected': True}):
            self.assertIn('could not be read', self.ask().json()['error'])

    def test_it_needs_an_account_a_key_and_some_words(self):
        self.assertEqual(self.ask('').status_code, 400)
        with override_settings(OPENAI_API_KEY=''):
            self.assertEqual(self.ask().status_code, 503)
        self.client.logout()
        self.assertEqual(self.ask().status_code, 401)

    def test_it_is_not_asked_without_end(self):
        with mock.patch.object(intake, 'post_json', return_value=model_says()), mock.patch.object(intake, 'get_json', return_value={'docs': []}):
            answers = [self.ask().status_code for _ in range(42)]
        self.assertEqual((answers[39], answers[40]), (200, 429))

    def test_sync_says_whether_there_is_an_assistant(self):
        ask = lambda: self.client.post('/api/sync', json.dumps({'since': None, 'changes': []}), content_type='application/json').json()
        self.assertTrue(ask()['assistant'])
        with override_settings(OPENAI_API_KEY=''):
            self.assertFalse(ask()['assistant'])

    def test_names_match_in_any_order(self):
        self.assertEqual(intake.name_key('Hamilton, Peter F.'.split()), intake.name_key('Peter F. Hamilton'.split()))
        self.assertEqual(intake.name_key('hamilton-peter-f'.split('-')), intake.name_key('Peter F. Hamilton'.split()))


@override_settings(OPENAI_API_KEY='')
class SharedTests(TestCase):
    """What is shared from another app: an ISBN settles it, without a language model."""

    EDITION = {'title': 'Katabasis', 'publishers': ['Harper Voyager'], 'publish_date': 'August 26, 2025', 'number_of_pages': 560,
               'works': [{'key': '/works/OL42397860W'}], 'authors': [{'key': '/authors/OL1A'}], 'covers': [99],
               'languages': [{'key': '/languages/eng'}]}

    def setUp(self):
        cache.clear()
        self.client.force_login(get_user_model().objects.create_user('reader', password='x'))

    def open_library(self, url):
        if '/isbn/' in url:
            return self.EDITION
        return {'name': 'R.F. Kuang'} if '/authors/' in url else {}

    def ask(self, **said):
        return self.client.post('/api/suggest', json.dumps(said), content_type='application/json')

    def test_an_isbn_in_what_was_shared_is_looked_up(self):
        with mock.patch.object(intake, 'get_json', side_effect=self.open_library), mock.patch.object(intake, 'post_json') as model:
            res = self.ask(text='Katabasis (ISBN 978-0-06-302147-1) looks good')
        model.assert_not_called()
        self.assertEqual(res.json()['books'], [{
            'title': 'Katabasis', 'author': 'R.F. Kuang', 'publisher': 'Harper Voyager', 'date': '2025', 'pages': 560,
            'language': 'en', 'isbn': '9780063021471', 'olid': 'OL42397860W',
            'cover': 'https://covers.openlibrary.org/b/id/99-L.jpg'}])

    def test_a_shared_page_is_searched_for_its_isbn(self):
        page = '<script type="application/ld+json">{"@type": "Book", "isbn": "9780063021471"}</script>'
        with mock.patch.object(intake, 'public_page', return_value=page) as fetched, \
                mock.patch.object(intake, 'get_json', side_effect=self.open_library):
            res = self.ask(text='Katabasis by R.F. Kuang', url='https://www.goodreads.com/book/show/1-katabasis')
        fetched.assert_called_once_with('https://www.goodreads.com/book/show/1-katabasis')
        self.assertEqual(res.json()['books'][0]['isbn'], '9780063021471')

    def test_an_amazon_address_names_the_book_itself(self):
        with mock.patch.object(intake, 'public_page') as fetched:
            self.assertEqual(intake.isbn_from_url('https://www.amazon.com/Dune-Frank-Herbert/dp/0441172717/ref=x'), '9780441172719')
        fetched.assert_not_called()

    def test_without_an_isbn_and_without_a_model_it_says_so(self):
        with mock.patch.object(intake, 'public_page', return_value='<html>nothing here</html>'):
            res = self.ask(text='that new Kuang', url='https://example.org/a-page')
        self.assertEqual(res.status_code, 503)

    def test_only_public_https_pages_are_fetched(self):
        with self.assertRaises(ValueError):
            intake.public_page('http://example.org/')
        for address in ('127.0.0.1', '10.0.0.5', '192.168.1.10', '169.254.169.254', '::1'):
            with mock.patch('socket.getaddrinfo', return_value=[(0, 0, 0, '', (address, 443))]), \
                    mock.patch.object(intake.urllib.request, 'build_opener') as opened:
                with self.assertRaises(ValueError):
                    intake.public_page('https://looks-harmless.example/')
                opened.assert_not_called()

    def test_isbn_checks(self):
        self.assertEqual(intake.isbn13('0-441-17271-7'), '9780441172719')
        self.assertEqual(intake.isbn13('9780441172718'), '')        # wrong check digit
        self.assertEqual(intake.find_isbn('order 9781234567890 or 978-0-441-17271-9'), '9780441172719')
