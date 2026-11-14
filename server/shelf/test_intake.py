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
