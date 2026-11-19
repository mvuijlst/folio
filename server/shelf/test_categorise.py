"""The assistant's categories for books that have none (/api/categories)."""
import json
import urllib.error
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from . import categorise, intake
from .models import Book


def model_says(rows):
    return {'choices': [{'message': {'content': json.dumps({'books': rows})}}]}


@override_settings(OPENAI_API_KEY='test-key', BOEKEN_REPO='')
class CategoriseTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user('reader', password='correct horse battery')
        self.client.force_login(self.user)
        now = timezone.now()
        for uid, cats in (('a', ['fantasy']), ('b', ['koken', 'biografie']), ('c', ['comic'])):
            Book.objects.create(user=self.user, uid=uid, modified=now, changed=now, title=uid, data={'id': uid, 'categories': cats})

    def post(self, books):
        return self.client.post('/api/categories', json.dumps({'books': books}), content_type='application/json')

    def test_only_categories_the_shelf_has_come_back_two_at_most(self):
        said = [{'id': '1', 'known': True, 'categories': ['fantasy', 'romance']},              # romance is not one of the shelf's
                {'id': '2', 'known': True, 'categories': ['comic', 'fantasy', 'koken', 'comic']},
                {'id': '3', 'known': False, 'categories': ['koken']},
                {'id': '4', 'known': False, 'categories': []},
                {'id': 'not asked', 'known': True, 'categories': ['fantasy']}]
        with mock.patch.object(intake, 'post_json', return_value=model_says(said)) as posted:
            res = self.post([{'id': '1', 'title': 'Mort', 'author': 'Terry Pratchett', 'series': 'Discworld', 'year': '1987', 'language': 'en'},
                             {'id': '2', 'title': 'Bone'}, {'id': '3', 'title': 'Ons kookboek'}, {'id': '4', 'title': 'Unknown'}])
        self.assertEqual(res.json(), {'books': {'1': {'categories': ['fantasy'], 'known': True},
                                                '2': {'categories': ['comic', 'fantasy'], 'known': True},
                                                '3': {'categories': ['koken'], 'known': False}}})
        question = posted.call_args.args[1]
        self.assertIn('1: Mort — Terry Pratchett (series: Discworld) (1987) [en]', question['messages'][1]['content'])
        self.assertIn('- koken: cookbooks', question['messages'][0]['content'])
        self.assertNotIn('- romance', question['messages'][0]['content'])   # the shelf's categories only

    def test_a_model_that_does_not_take_the_effort_setting_is_asked_without(self):
        refused = urllib.error.HTTPError('u', 400, 'Bad Request', {}, None)
        with mock.patch.object(intake, 'post_json', side_effect=[refused, model_says([{'id': '1', 'known': True, 'categories': ['comic']}])]) as posted:
            got = categorise.ask([{'id': '1', 'title': 'Bone'}], ['comic'])
        self.assertEqual(got, {'1': {'categories': ['comic'], 'known': True}})
        self.assertNotIn('reasoning_effort', posted.call_args.args[1])

    def test_bad_requests_and_a_server_without_an_assistant(self):
        self.assertEqual(self.post([]).status_code, 400)
        self.assertEqual(self.post([{'id': str(i), 'title': 'x'} for i in range(categorise.MOST + 1)]).status_code, 400)
        self.assertEqual(self.post([{'id': '1'}]).status_code, 400)   # nothing to go by
        with override_settings(OPENAI_API_KEY=''):
            self.assertEqual(self.post([{'id': '1', 'title': 'Mort'}]).status_code, 503)
        with mock.patch.object(intake, 'post_json', side_effect=urllib.error.URLError('down')):
            self.assertEqual(self.post([{'id': '1', 'title': 'Mort'}]).status_code, 502)
        self.client.logout()
        self.assertEqual(self.post([{'id': '1', 'title': 'Mort'}]).status_code, 401)
