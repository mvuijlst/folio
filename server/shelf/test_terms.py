import json
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from . import intake


def term_change(uid, modified, nl='voetnoten', en='', deleted=False):
    return {'id': uid, 'modified': modified, 'deleted': deleted,
            'term': None if deleted else {'id': uid, 'kind': 'role', 'nl': nl, 'en': en, 'aliases': [], 'value': nl}}


class TermSyncTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user('reader', password='correct horse battery')
        self.client.force_login(self.user)

    def sync(self, **extra):
        res = self.client.post('/api/sync', json.dumps({'schema': 2, 'since': None, 'changes': [], 'lists': [], **extra}),
                               content_type='application/json')
        self.assertEqual(res.status_code, 200, res.content)
        return res.json()

    def test_terms_travel_between_devices(self):
        first = self.sync(terms=[term_change('t1', '2026-11-17T10:00:00Z')], termsSince=None)
        self.assertEqual(first['terms'], [])
        other = self.sync(terms=[], termsSince=None)
        self.assertEqual([c['term']['nl'] for c in other['terms']], ['voetnoten'])
        from shelf.models import Term
        self.assertEqual(Term.objects.get(uid='t1').value, 'voetnoten')

    def test_a_hidden_standard_role_reaches_a_fresh_device(self):
        self.sync(terms=[term_change('role-voorwoord', '2026-11-17T10:00:00Z')], termsSince=None)
        self.sync(terms=[term_change('role-voorwoord', '2026-11-17T11:00:00Z', deleted=True)], termsSince=None)
        fresh = self.sync(terms=[], termsSince=None)
        self.assertEqual([(c['id'], c['deleted']) for c in fresh['terms']], [('role-voorwoord', True)])

    def test_a_copy_of_the_app_from_before_terms_gets_none(self):
        self.sync(terms=[term_change('t1', '2026-11-17T10:00:00Z')], termsSince=None)
        self.assertNotIn('terms', self.sync())


def model_says(words):
    return {'choices': [{'message': {'content': json.dumps({'words': words})}}]}


@override_settings(OPENAI_API_KEY='test-key')
class TranslateTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user('reader', password='correct horse battery')
        self.client.force_login(self.user)

    def ask(self, payload):
        return self.client.post('/api/translate', json.dumps(payload), content_type='application/json')

    def test_proposals_come_back_for_the_words_asked_only(self):
        said = [{'word': 'voetnoten', 'translation': 'footnotes'}, {'word': 'made up', 'translation': 'x'},
                {'word': 'DEATH', 'translation': ' DEATH '}]
        with mock.patch.object(intake, 'post_json', return_value=model_says(said)) as asked:
            res = self.ask({'kind': 'role', 'to': 'en', 'words': [{'word': 'voetnoten', 'books': ['Snuff']}, {'word': 'DEATH'}]})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()['words'], [{'word': 'voetnoten', 'translation': 'footnotes'}, {'word': 'DEATH', 'translation': 'DEATH'}])
        self.assertIn('voetnoten (on: Snuff)', asked.call_args[0][1]['messages'][1]['content'])

    def test_needs_an_account_and_a_known_kind(self):
        self.assertEqual(self.ask({'kind': 'spell', 'to': 'en', 'words': [{'word': 'x'}]}).status_code, 400)
        self.client.logout()
        self.assertEqual(self.ask({'kind': 'role', 'to': 'en', 'words': [{'word': 'x'}]}).status_code, 401)

    @override_settings(OPENAI_API_KEY='')
    def test_without_the_assistant_it_says_so(self):
        self.assertEqual(self.ask({'kind': 'role', 'to': 'en', 'words': [{'word': 'x'}]}).status_code, 503)
