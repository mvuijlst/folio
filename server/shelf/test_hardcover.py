import json
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import SimpleTestCase, TestCase, override_settings

from . import hardcover


def row(pos, title, readers, date='2000-01-01', compilation=False, book_id=None, part_of_set=False):
    return {'position': pos, 'compilation': part_of_set,
            'book': {'id': book_id or abs(hash(title)) % 10**6, 'title': title, 'release_year': int(date[:4]) if date else None, 'release_date': date,
                     'users_count': readers, 'compilation': compilation, 'image': {'url': f'https://assets.hardcover.app/{title}.jpg'},
                     'contributions': [{'author': {'name': 'Robert Jordan'}}]}}


class Volumes(SimpleTestCase):
    def test_one_per_number_the_most_read_whichever_is_marked_a_copy(self):
        got = hardcover.volumes_of([
            row(1, 'Cada corazón, un umbral', 13), row(1, 'Every Heart a Doorway', 1500),
            row(2, 'Down Among the Sticks and Bones', 675), row(4.5, 'Juice Like Wounds', 109),
            row(None, 'A collection', 300), row(3, 'Box set', 900, compilation=True), row(3, 'Beneath the Sugar Sky', 545, part_of_set=False),
            row(5, 'The set, in the series', 800, part_of_set=True),
        ])
        self.assertEqual([(v['n'], v['title']) for v in got], [(1, 'Every Heart a Doorway'), (2, 'Down Among the Sticks and Bones'),
                                                              (3, 'Beneath the Sugar Sky'), (4.5, 'Juice Like Wounds')])
        self.assertEqual(got[0]['authors'], ['Robert Jordan'])
        self.assertTrue(got[0]['cover'].startswith('https://assets.hardcover.app/'))

    def test_a_widely_read_series_drops_noise_but_keeps_what_is_not_out_yet(self):
        got = hardcover.volumes_of([row(1, 'The Eye of the World', 6403), row(2, 'A fan edition', 3),
                                    row(15, 'Announced', 0, date='2099-01-01'), row(16, 'No date yet', 0, date='')], today='2026-11-20')
        self.assertEqual([v['n'] for v in got], [1, 15, 16])

    def test_a_small_series_keeps_everything(self):   # Flemish comics: 0 to 5 readers each
        got = hardcover.volumes_of([row(1, 'De zaak Krimson #1', 4), row(5, 'De killerbacterie', 0)], today='2026-11-20')
        self.assertEqual([v['n'] for v in got], [1, 5])


@override_settings(HARDCOVER_API_TOKEN='secret', CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}})
class Finding(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def test_by_name_the_fullest_and_no_empty_ones(self):
        answer = {'series': [{'id': 1018, 'name': 'Discworld', 'books_count': 51, 'author': {'name': 'Terry Pratchett'}},
                             {'id': 1906, 'name': 'Discworld', 'books_count': 0, 'author': None}]}
        with mock.patch.object(hardcover, 'ask', return_value=answer) as asked:
            self.assertEqual(hardcover.find('Discworld'), [{'id': 1018, 'name': 'Discworld', 'books_count': 51, 'author': 'Terry Pratchett'}])
            hardcover.find('Discworld')                                   # a day in the cache
        self.assertEqual(asked.call_count, 1)

    def test_else_the_search(self):
        answers = [{'series': []}, {'search': {'results': {'hits': [{'document': {'id': '76872', 'name': 'Thorgal', 'books_count': 40, 'author_name': 'Jean Van Hamme'}}]}}}]
        with mock.patch.object(hardcover, 'ask', side_effect=answers):
            self.assertEqual(hardcover.find('Thorgal NL'), [{'id': 76872, 'name': 'Thorgal', 'books_count': 40, 'author': 'Jean Van Hamme'}])

    def test_the_token_is_sent_with_bearer_once(self):
        with mock.patch('urllib.request.urlopen') as opened:
            opened.return_value.__enter__.return_value.read.return_value = b'{"data": {"series": []}}'
            hardcover.ask('{ x }')
        self.assertEqual(opened.call_args[0][0].get_header('Authorization'), 'Bearer secret')


@override_settings(HARDCOVER_API_TOKEN='secret', CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}})
class TheApi(TestCase):
    def setUp(self):
        cache.clear()
        self.user = get_user_model().objects.create_user('owner', password='x', is_staff=True)
        self.client.force_login(self.user)

    def post(self, **data):
        return self.client.post('/api/hardcover', json.dumps(data), content_type='application/json')

    def test_staff_only_and_only_with_a_token(self):
        get_user_model().objects.filter(pk=self.user.pk).update(is_staff=False)
        self.assertEqual(self.post(name='Discworld').status_code, 503)
        get_user_model().objects.filter(pk=self.user.pk).update(is_staff=True)
        with override_settings(HARDCOVER_API_TOKEN=''):
            self.assertEqual(self.post(name='Discworld').status_code, 503)

    def test_a_series_and_its_volumes(self):
        with mock.patch.object(hardcover, 'ask', return_value={'series': [{'id': 4968, 'name': 'Cradle', 'books_count': 13, 'is_completed': True,
                                                                           'author': {'name': 'Will Wight'}, 'book_series': [row(1, 'Unsouled', 2125)]}]}):
            got = self.post(id=4968).json()['series']
        self.assertEqual((got['name'], got['completed'], [v['title'] for v in got['volumes']]), ('Cradle', True, ['Unsouled']))

    def test_hardcover_not_answering_is_said(self):
        with mock.patch.object(hardcover, 'ask', side_effect=hardcover.Unavailable('down')):
            self.assertEqual(self.post(name='Discworld').status_code, 503)

    def test_the_sync_says_whether_hardcover_is_there(self):
        res = self.client.post('/api/sync', json.dumps({'schema': 3, 'since': None, 'changes': []}), content_type='application/json')
        self.assertTrue(res.json()['hardcover'])


@override_settings(HARDCOVER_API_TOKEN='secret', CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}})
class MonthlyCheck(TestCase):
    def test_new_volumes_of_running_series_are_kept_and_others_left_alone(self):
        from io import StringIO
        from django.core.management import call_command
        from django.utils.dateparse import parse_datetime
        from .models import Term
        user = get_user_model().objects.create_user('owner')
        t0 = parse_datetime('2026-11-01T10:00:00Z')
        old = [{'n': 1, 'id': 11, 'title': 'One'}]
        running = Term.objects.create(user=user, uid='series:Wayward Children', value='Wayward Children', modified=t0, changed=t0,
                                      data={'id': 'series:Wayward Children', 'kind': 'series', 'value': 'Wayward Children',
                                            'hardcover': {'id': 1638, 'running': True, 'volumes': old}})
        done = Term.objects.create(user=user, uid='series:Cradle', value='Cradle', modified=t0, changed=t0,
                                   data={'id': 'series:Cradle', 'kind': 'series', 'value': 'Cradle', 'hardcover': {'id': 4968, 'volumes': old}})
        fresh = {'id': 1638, 'name': 'Wayward Children', 'books_count': 2, 'completed': False, 'author': '',
                 'volumes': [*old, {'n': 2, 'id': 22, 'title': 'Two', 'year': 2027}]}
        out = StringIO()
        with mock.patch.object(hardcover, 'series', return_value=fresh) as asked, mock.patch('time.sleep'):
            call_command('check_series', '--user', 'owner', '--write', stdout=out)
        self.assertEqual(asked.call_count, 1)                            # only the running one
        self.assertIn('new, #2 Two (2027)', out.getvalue())
        running.refresh_from_db()
        self.assertEqual(running.data['hardcover']['news'], [22])
        self.assertEqual(len(running.data['hardcover']['volumes']), 2)
        self.assertEqual(running.modified, t0)
        self.assertGreater(running.changed, t0)
        done.refresh_from_db()
        self.assertEqual(done.changed, t0)
