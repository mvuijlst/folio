import json

from django.contrib.auth import get_user_model
from django.test import TestCase


def change(uid, modified, title='A book', deleted=False):
    return {'id': uid, 'modified': modified, 'deleted': deleted,
            'book': None if deleted else {'id': uid, 'title': title, 'added': modified}}


class SyncTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user('reader', password='correct horse battery')
        self.client.force_login(self.user)

    def sync(self, since=None, changes=()):
        res = self.client.post('/api/sync', json.dumps({'since': since, 'changes': list(changes)}),
                               content_type='application/json')
        self.assertEqual(res.status_code, 200, res.content)
        return res.json()

    def test_round_trip_between_devices(self):
        a = self.sync(changes=[change('b1', '2026-11-14T10:00:00Z', 'Dune')])
        self.assertEqual(a['changes'], [])          # no echo of what we just sent
        b = self.sync()                              # second device, first sync
        self.assertEqual([c['book']['title'] for c in b['changes']], ['Dune'])
        again = self.sync(since=a['cursor'])
        self.assertEqual(again['changes'], [])       # device A already has it

    def test_newer_change_wins_and_older_is_answered(self):
        self.sync(changes=[change('b1', '2026-11-14T10:00:00Z', 'New')])
        res = self.sync(since=None, changes=[change('b1', '2026-11-14T09:00:00Z', 'Old')])
        self.assertEqual(res['changes'][0]['book']['title'], 'New')

    def test_deletion_reaches_other_devices(self):
        first = self.sync(changes=[change('b1', '2026-11-14T10:00:00Z')])
        other = self.sync()
        self.sync(changes=[change('b1', '2026-11-14T11:00:00Z', deleted=True)])
        res = self.sync(since=other['cursor'])
        self.assertEqual(res['changes'], [{'id': 'b1', 'modified': '2026-11-14T11:00:00Z', 'deleted': True, 'book': None}])
        self.assertEqual(self.sync()['changes'], [])  # fresh devices get no tombstones
        self.assertTrue(first['cursor'])

    def test_requires_login(self):
        self.client.logout()
        res = self.client.post('/api/sync', '{}', content_type='application/json')
        self.assertEqual(res.status_code, 401)

    def test_other_users_books_are_private(self):
        self.sync(changes=[change('b1', '2026-11-14T10:00:00Z')])
        other = get_user_model().objects.create_user('someone', password='x')
        self.client.force_login(other)
        self.assertEqual(self.sync()['changes'], [])


class LoginTests(TestCase):
    def setUp(self):
        get_user_model().objects.create_user('reader', password='correct horse battery')

    def post(self, path, data):
        return self.client.post(path, json.dumps(data), content_type='application/json')

    def test_login_and_logout(self):
        self.assertIsNone(self.client.get('/api/session').json()['user'])
        res = self.post('/api/login', {'username': 'reader', 'password': 'correct horse battery'})
        self.assertEqual(res.json(), {'user': 'reader'})
        self.assertEqual(self.client.get('/api/session').json()['user'], 'reader')
        self.post('/api/logout', {})
        self.assertIsNone(self.client.get('/api/session').json()['user'])

    def test_wrong_password_and_lockout(self):
        for _ in range(10):
            self.assertEqual(self.post('/api/login', {'username': 'reader', 'password': 'nope'}).status_code, 401)
        res = self.post('/api/login', {'username': 'reader', 'password': 'correct horse battery'})
        self.assertEqual(res.status_code, 429)

    def test_csrf_is_enforced(self):
        client = self.client_class(enforce_csrf_checks=True)
        res = client.post('/api/login', json.dumps({'username': 'reader', 'password': 'correct horse battery'}),
                          content_type='application/json')
        self.assertEqual(res.status_code, 403)
