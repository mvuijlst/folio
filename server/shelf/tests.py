import json
import time
from unittest import mock

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
        res = self.client.post('/api/sync', json.dumps({'schema': 2, 'since': since, 'changes': list(changes),
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

    def test_a_copy_of_the_app_from_before_editions_is_told_to_update(self):
        res = self.client.post('/api/sync', json.dumps({'since': None, 'changes': [change('b1', '2026-11-14T10:00:00Z', 'Dune')]}),
                               content_type='application/json')
        self.assertEqual((res.status_code, res.json()['error']), (409, 'This version of Folio is out of date. Close and reopen it to update.'))
        self.assertEqual(self.sync()['changes'], [])   # and nothing it sent was stored

    def test_a_book_in_the_old_shape_is_stored_in_the_new_one(self):
        from shelf.models import Book
        self.sync(changes=[{**change('b1', '2026-11-14T10:00:00Z', 'Dune'), 'book': {
            'id': 'b1', 'title': 'Dune', 'added': '2026-11-14T10:00:00Z', 'publisher': 'Ace', 'format': 'paper',
            'lists': {'library': {'at': '2026-11-14T10:00:00Z'}, 'read': {'at': '2026-11-14T10:00:00Z'}}}}])
        data = Book.objects.get(uid='b1').data
        self.assertEqual((data['v'], data['lists']), (2, {'read': {'at': '2026-11-14T10:00:00Z'}}))
        self.assertEqual(data['editions'], [{'id': 'e1', 'publisher': 'Ace', 'format': 'paper',
                                             'lists': {'library': {'at': '2026-11-14T10:00:00Z'}}, 'added': '2026-11-14T10:00:00Z'}])

    def test_the_lists_a_book_is_on_travel_with_it(self):
        book = change('b1', '2026-11-14T10:00:00Z', 'Dune')
        book['book'].update(v=2, lists={'read': {'at': '2026-11-14T10:00:00Z'}},
                            editions=[{'id': 'e1', 'lists': {'lent': {'at': '2026-11-14T10:00:00Z', 'note': 'Jan'}}}])
        self.sync(changes=[book])
        self.assertEqual(self.sync()['changes'][0]['book'], book['book'])

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

    def test_other_users_lists_are_private(self):
        self.sync(lists=[list_change('wishlist', '2026-11-14T10:00:00Z')])
        other = get_user_model().objects.create_user('someone', password='x')
        self.client.force_login(other)
        self.assertEqual(self.sync()['lists'], [])

    def test_gone_says_which_records_were_deleted_and_when(self):
        # Restoring a backup asks, so a book deleted on purpose elsewhere is not quietly brought back.
        self.sync(changes=[change('b1', '2026-11-14T10:00:00Z'), change('b2', '2026-11-14T10:00:00Z')],
                  lists=[list_change('x1', '2026-11-14T10:00:00Z')])
        self.sync(changes=[change('b1', '2026-11-15T10:00:00Z', deleted=True)],
                  lists=[list_change('x1', '2026-11-15T11:00:00Z', deleted=True)])
        res = self.client.post('/api/gone', json.dumps({'books': ['b1', 'b2', 'b9'], 'lists': ['x1'], 'terms': []}),
                               content_type='application/json')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json(), {'books': {'b1': '2026-11-15T10:00:00Z'}, 'lists': {'x1': '2026-11-15T11:00:00Z'}, 'terms': {}})
        other = get_user_model().objects.create_user('someone', password='x')
        self.client.force_login(other)
        res = self.client.post('/api/gone', json.dumps({'books': ['b1']}), content_type='application/json')
        self.assertEqual(res.json()['books'], {})
        self.client.logout()
        self.assertEqual(self.client.post('/api/gone', '{}', content_type='application/json').status_code, 401)

    def test_staff_hear_when_the_nightly_copy_last_ran(self):
        import tempfile, os
        from django.test import override_settings
        with tempfile.TemporaryDirectory() as d:
            stamp = os.path.join(d, 'last-copy.json')
            with override_settings(BACKUP_STAMP=stamp):
                self.assertNotIn('backup', self.sync())          # not staff: not said
                self.user.is_staff = True
                self.user.save()
                self.assertIsNone(self.sync()['backup'])         # never ran
                with open(stamp, 'w') as f:
                    json.dump({'made': '2026-11-20T03:30:00Z', 'checked': '2026-11-21T03:31:00Z', 'file': 'x', 'bytes': 1}, f)
                self.assertEqual(self.sync()['backup'], {'made': '2026-11-20T03:30:00Z', 'checked': '2026-11-21T03:31:00Z'})


class PublishedWhileEditedTests(TestCase):
    """A book is published while a device, not knowing yet, changes it."""
    setUp, sync = SyncTests.setUp, SyncTests.sync

    def test_the_post_is_not_forgotten(self):
        from shelf.models import Book
        book = {'id': 'b1', 'title': 'Fire & Blood', 'boekenWanted': True, 'lists': {'read': {'at': '2026-11-15T16:51:00Z'}},
                'reviews': [{'id': 'r1', 'date': '', 'text': ''}]}
        self.sync(changes=[{'id': 'b1', 'modified': '2026-11-15T16:51:00Z', 'deleted': False, 'book': book}])
        row = Book.objects.get(uid='b1')   # what publishing does
        row.data = {**{k: v for k, v in row.data.items() if k != 'boekenWanted'}, 'boeken': 'fire-blood-herlezing',
                    'url': 'https://x/fire-blood-herlezing/', 'boekenState': {'list': 'read'},
                    'reviews': [{'id': 'r1', 'date': '', 'text': '', 'boeken': 'fire-blood-herlezing', 'sum': 's'}]}
        row.save()
        edited = {**book, 'rating': 8, 'reviews': [{'id': 'r1', 'date': '2026-04-06', 'text': ''}, {'id': 'r2', 'date': '2026-11-01'}]}
        res = self.sync(since='2026-11-15T16:52:00Z', changes=[{'id': 'b1', 'modified': '2026-11-15T16:55:00Z', 'deleted': False, 'book': edited}])
        self.assertEqual([c['book']['boeken'] for c in res['changes']], ['fire-blood-herlezing'])   # the device hears of its post
        data = Book.objects.get(uid='b1').data
        self.assertEqual((data['boeken'], data['rating'], 'boekenWanted' in data), ('fire-blood-herlezing', 8, False))
        self.assertEqual(data['boekenState'], {'list': 'read'})
        self.assertEqual([(r['id'], r['date'], r.get('boeken')) for r in data['reviews']],
                         [('r1', '2026-04-06', 'fire-blood-herlezing'), ('r2', '2026-11-01', None)])

    def test_a_book_taken_off_the_booklog_on_purpose_is_left_alone(self):
        from shelf.models import Book
        self.sync(changes=[{'id': 'b1', 'modified': '2026-11-15T16:51:00Z', 'deleted': False, 'book': {'id': 'b1', 'title': 'X'}}])
        Book.objects.filter(uid='b1').update(data={'id': 'b1', 'title': 'X', 'boeken': 'x'})
        self.sync(changes=[{'id': 'b1', 'modified': '2026-11-15T16:55:00Z', 'deleted': False, 'book': {'id': 'b1', 'title': 'Y'}}])
        self.assertNotIn('boeken', Book.objects.get(uid='b1').data)   # no boekenWanted: not a stale copy


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

    def test_the_lockout_lifts_a_quarter_of_an_hour_after_the_first_failure(self):
        start = time.time()
        with mock.patch('shelf.views.time.time', return_value=start):
            for _ in range(10):
                self.post('/api/login', {'username': 'reader', 'password': 'nope'})
        with mock.patch('shelf.views.time.time', return_value=start + 14 * 60):
            self.assertEqual(self.post('/api/login', {'username': 'reader', 'password': 'nope'}).status_code, 429)
        with mock.patch('shelf.views.time.time', return_value=start + 15 * 60 + 1):
            res = self.post('/api/login', {'username': 'reader', 'password': 'correct horse battery'})
            self.assertEqual(res.status_code, 200)

    def test_csrf_is_enforced(self):
        client = self.client_class(enforce_csrf_checks=True)
        res = client.post('/api/login', json.dumps({'username': 'reader', 'password': 'correct horse battery'}),
                          content_type='application/json')
        self.assertEqual(res.status_code, 403)
