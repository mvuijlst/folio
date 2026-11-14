import json

from django.contrib.auth import get_user_model
from django.test import TestCase


def change(uid, modified, title='A book', deleted=False):
    return {'id': uid, 'modified': modified, 'deleted': deleted,
            'book': None if deleted else {'id': uid, 'title': title, 'added': modified}}


def list_change(uid, modified, name='A list', deleted=False, **extra):
    return {'id': uid, 'modified': modified, 'deleted': deleted,
            'list': None if deleted else {'id': uid, 'name': name, 'group': '', 'order': 0, **extra}}


class SyncTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user('reader', password='correct horse battery')
        self.client.force_login(self.user)

    def sync(self, since=None, changes=(), lists=(), lists_since=None):
        res = self.client.post('/api/sync', json.dumps({'since': since, 'changes': list(changes),
                                                        'listsSince': lists_since, 'lists': list(lists)}),
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

    def test_the_lists_a_book_is_on_travel_with_it(self):
        book = change('b1', '2026-11-14T10:00:00Z', 'Dune')
        book['book']['lists'] = {'read': {'at': '2026-11-14T10:00:00Z'}, 'lent': {'at': '2026-11-14T10:00:00Z', 'note': 'Jan'}}
        self.sync(changes=[book])
        self.assertEqual(self.sync()['changes'][0]['book']['lists'], book['book']['lists'])

    def test_lists_round_trip_between_devices(self):
        a = self.sync(lists=[list_change('wishlist', '2026-11-14T10:00:00Z', 'Wishlist', group='Buying')])
        self.assertEqual(a['lists'], [])             # no echo of what we just sent
        b = self.sync()
        self.assertEqual([(c['list']['name'], c['list']['group']) for c in b['lists']], [('Wishlist', 'Buying')])
        self.assertEqual(self.sync(lists_since=a['cursor'])['lists'], [])

    def test_newer_list_wins_and_older_is_answered(self):
        self.sync(lists=[list_change('read', '2026-11-14T10:00:00Z', 'Gelezen')])
        res = self.sync(lists=[list_change('read', '1970-01-01T00:00:00.000Z', 'Read')])
        self.assertEqual(res['lists'][0]['list']['name'], 'Gelezen')

    def test_fresh_device_hears_about_deleted_lists(self):
        # Every device starts with the standard lists, so a new one must learn which are gone.
        self.sync(lists=[list_change('lent', '2026-11-14T10:00:00Z', 'Lent out')])
        self.sync(lists=[list_change('lent', '2026-11-14T11:00:00Z', deleted=True)])
        res = self.sync()
        self.assertEqual(res['lists'], [{'id': 'lent', 'modified': '2026-11-14T11:00:00Z', 'deleted': True, 'list': None}])

    def test_a_device_that_predates_lists_still_syncs(self):
        res = self.client.post('/api/sync', json.dumps({'since': None, 'changes': [change('b1', '2026-11-14T10:00:00Z')]}),
                               content_type='application/json')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()['lists'], [])

    def test_other_users_lists_are_private(self):
        self.sync(lists=[list_change('wishlist', '2026-11-14T10:00:00Z')])
        other = get_user_model().objects.create_user('someone', password='x')
        self.client.force_login(other)
        self.assertEqual(self.sync()['lists'], [])


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
