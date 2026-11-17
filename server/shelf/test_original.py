import json
from io import StringIO
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone

from . import intake, original
from .models import Book


def sparql(*rows):
    return {'results': {'bindings': [
        {'ol': {'value': ol}, **({'code': {'value': code}} if code else {}),
         **({'title': {'value': title, 'xml:lang': tag}} if title else {})} for ol, code, title, tag in rows]}}


class WikidataTests(TestCase):
    def test_the_title_in_the_language_of_the_work(self):
        rows = sparql(('OL1W', 'ar', 'Frankenstein in Baghdad', 'en'), ('OL1W', 'ar', 'فرانكشتاين في بغداد', 'ar'),
                      ('OL2W', 'ja', '1Q84', 'ja'), ('OL3W', None, 'No language', 'en'))
        with mock.patch.object(original, 'get_json', return_value=rows):
            got = original.from_wikidata(['OL1W', 'OL2W', 'OL3W', 'not an id'])
        self.assertEqual(got, {'OL1W': {'language': 'ar', 'title': 'فرانكشتاين في بغداد'}, 'OL2W': {'language': 'ja', 'title': '1Q84'}})

    def test_a_title_the_book_already_has_is_not_an_original_title(self):
        self.assertEqual(original.found('ja', '1Q84', ['1Q84']), {'language': 'ja', 'title': ''})
        self.assertEqual(original.found('ru', 'Мастер и Маргарита', ['The Master and Margarita']),
                         {'language': 'ru', 'title': 'Мастер и Маргарита'})
        self.assertIsNone(original.found('Japanese', 'x', []))
        self.assertEqual(original.found('grc', '', ['The Odyssey']), {'language': 'grc', 'title': ''})


def model_says(rows):
    return {'choices': [{'message': {'content': json.dumps({'books': rows})}}]}


@override_settings(OPENAI_API_KEY='test-key')
class AssistantTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user('reader', password='correct horse battery')
        self.client.force_login(self.user)

    def test_the_endpoint_says_what_the_model_knows(self):
        said = [{'id': '1', 'original_language': 'JA', 'original_title': '色彩を持たない多崎つくると、彼の巡礼の年'}]
        with mock.patch.object(intake, 'post_json', return_value=model_says(said)):
            res = self.client.post('/api/original', json.dumps({'title': 'Colorless Tsukuru Tazaki', 'author': 'Haruki Murakami', 'language': 'en'}),
                                   content_type='application/json')
        self.assertEqual(res.json(), {'language': 'ja', 'title': '色彩を持たない多崎つくると、彼の巡礼の年'})

    def test_a_book_the_model_does_not_know_gets_nothing(self):
        with mock.patch.object(intake, 'post_json', return_value=model_says([{'id': '1', 'original_language': None, 'original_title': None}])):
            res = self.client.post('/api/original', json.dumps({'title': 'Obscure'}), content_type='application/json')
        self.assertEqual(res.json(), {})

    def test_a_proposal_carries_the_original_language(self):
        proposal = {'title': 'The Master and Margarita', 'authors': [{'name': 'Mikhail Bulgakov', 'role': None}], 'known': True,
                    'publisher': None, 'year': None, 'pages': None, 'duration': None, 'series': None, 'series_number': None,
                    'language': 'en', 'original_language': 'ru', 'original_title': 'Мастер и Маргарита',
                    'categories': [], 'tags': [], 'note': 'Een roman.'}
        with mock.patch.object(intake, 'analyse', return_value=[proposal]), mock.patch.object(intake, 'enrich', side_effect=lambda p: p):
            book = intake.propose('The Master and Margarita')[0]
        self.assertEqual((book['originalLanguage'], book['originalTitle']), ('ru', 'Мастер и Маргарита'))


class FillOriginalTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user('reader', password='x')
        now = timezone.now()
        def add(uid, **data):
            Book.objects.create(user=self.user, uid=uid, modified=now, changed=now, title=data.get('title', ''),
                                data={'id': uid, 'v': 2, 'lists': {}, **data})
        add('a', title='1Q84', olid='OL15029001W', boeken='1q84', editions=[{'id': 'e1', 'language': 'en'}])
        add('b', title='Scanned', editions=[{'id': 'e1', 'language': 'nl', 'isbn': '9789000000001'}])
        add('c', title='Known', originalLanguage='en', editions=[{'id': 'e1', 'language': 'en'}])

    def run_it(self, *args):
        out = StringIO()
        with mock.patch.object(original, 'from_open_library', return_value=('OL9W', None)), \
                mock.patch.object(original, 'from_wikidata', return_value={'OL15029001W': {'language': 'ja', 'title': '1Q84'},
                                                                            'OL9W': {'language': 'nl', 'title': ''}}):
            call_command('fill_original', '--user', 'reader', '--pause', '0', *args, stdout=out)
        return out.getvalue()

    def test_a_dry_run_stores_nothing(self):
        self.assertIn('Found for 2', self.run_it())
        self.assertNotIn('originalLanguage', Book.objects.get(uid='a').data)

    def test_writing_fills_in_language_and_a_new_olid_only_for_a_book_only_in_the_app(self):
        before = Book.objects.get(uid='a').modified
        self.run_it('--write')
        a, b = Book.objects.get(uid='a'), Book.objects.get(uid='b')
        self.assertEqual((a.data['originalLanguage'], a.data.get('originalTitle')), ('ja', None))
        self.assertEqual(a.modified, before)
        self.assertEqual((b.data['originalLanguage'], b.data['olid']), ('nl', 'OL9W'))
        self.assertEqual(Book.objects.get(uid='c').data['originalLanguage'], 'en')
