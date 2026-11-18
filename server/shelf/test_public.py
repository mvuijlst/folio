"""A public library (shelf/public.py): what a visitor sees, and above all what they don't."""
import json

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from .models import Book, Library, List, Term

NOTE = 'Lent to Jan'


def lists():
    return [
        {'id': 'library', 'name': 'Library', 'group': '', 'order': 0, 'public': True},
        {'id': 'to-read', 'name': 'To read', 'group': 'Reading status', 'order': 1},
        {'id': 'reading', 'name': 'Reading', 'group': 'Reading status', 'order': 2, 'public': True},
        {'id': 'read', 'name': 'Read', 'group': 'Reading status', 'order': 3, 'public': True},
        {'id': 'abandoned', 'name': 'Did not finish', 'group': 'Reading status', 'order': 4},
        {'id': 'lent', 'name': 'Lent out', 'group': '', 'order': 5, 'noteLabel': 'Lent to'},
        {'id': 'secret', 'name': 'Secret shelf', 'group': 'Rooms', 'order': 6, 'noteLabel': 'Behind'},
    ]


def edition(eid, **extra):
    return {'id': eid, 'format': 'paper', 'publisher': 'Pub', 'date': '2001', 'pages': 300, 'isbn': '9780000000001',
            'people': [{'name': 'A. Writer', 'role': '', 'private': 'x'}], 'cover': f'covers/web/{eid}.webp',
            'coverSource': 'https://example.com/source.jpg', 'coverPhoto': True, **extra}


BOOKLOG = {'boeken': 'a-slug', 'url': 'https://boeken.example/a', 'boekenState': {'title': 'x'}, 'boekenWanted': True,
           'boekenError': 'no', 'regroup': True, 'regrouped': '2026', 'pending': True, 'apart': ['b9'],
           'modified': '2026-01-01T00:00:00Z', 'unresolved': True, 'somethingNew': 'private by default'}


class PublicLibraryTests(TestCase):
    def setUp(self):
        self.owner = get_user_model().objects.create_user('owner-login', password='correct horse battery')
        self.lib = Library.objects.create(user=self.owner, allowed=True, enabled=True, slug='shelf',
                                          title_en='My books', title_nl='Mijn boeken', about_en='Hello', about_nl='Hallo')
        for data in lists():
            self.put(List, data, name=data['name'])

    def put(self, model, data, deleted=False, **columns):
        now = timezone.now()
        model.objects.update_or_create(user=self.owner, uid=data['id'], defaults=dict(
            data=data, deleted=deleted, modified=now, changed=now, **columns))

    def book(self, data, deleted=False):
        self.put(Book, {'v': 2, 'added': '2026-01-01T00:00:00Z', **data}, deleted=deleted, title=data.get('title', ''))

    def fetch(self, slug='shelf', status=200, **headers):
        res = self.client.get(f'/api/public/{slug}', **headers)
        self.assertEqual(res.status_code, status, res.content)
        return res.json() if status == 200 else res

    def by_id(self, data):
        return {b['id']: b for b in data['books']}

    # ── Who can see it ──

    def test_unknown_off_and_nothing_public_answer_alike(self):
        self.book({'id': 'b1', 'title': 'T', 'lists': {}, 'editions': [edition('e1', lists={'library': {'at': '2026'}})]})
        missing = self.fetch('nobody', status=404).content
        self.lib.enabled = False
        self.lib.save()
        self.assertEqual(self.fetch(status=404).content, missing)
        self.lib.enabled, self.lib.allowed = True, False
        self.lib.save()
        self.assertEqual(self.fetch(status=404).content, missing)
        self.lib.allowed = True
        self.lib.save()
        for data in lists():
            self.put(List, {**data, 'public': False})
        self.assertEqual(self.fetch(status=404).content, missing)

    def test_no_login_needed_and_not_indexed(self):
        self.book({'id': 'b1', 'title': 'T', 'lists': {}, 'editions': [edition('e1', lists={'library': {'at': '2026'}})]})
        res = self.fetch(status=200, HTTP_ACCEPT='application/json')
        self.assertEqual(self.client.get('/api/public/shelf')['X-Robots-Tag'], 'noindex')
        self.assertEqual(res['library'], {'slug': 'shelf', 'title': {'en': 'My books', 'nl': 'Mijn boeken'}, 'about': {'en': 'Hello', 'nl': 'Hallo'}})
        self.assertNotIn('owner-login', json.dumps(res))

    def test_repeat_visit_is_not_modified_until_something_changes(self):
        self.book({'id': 'b1', 'title': 'T', 'lists': {}, 'editions': [edition('e1', lists={'library': {'at': '2026'}})]})
        first = self.client.get('/api/public/shelf')
        again = self.client.get('/api/public/shelf', HTTP_IF_NONE_MATCH=first['ETag'])
        self.assertEqual(again.status_code, 304)
        self.book({'id': 'b2', 'title': 'U', 'lists': {}, 'editions': [edition('e1', lists={'library': {'at': '2026'}})]})
        later = self.client.get('/api/public/shelf', HTTP_IF_NONE_MATCH=first['ETag'])
        self.assertEqual(later.status_code, 200)
        self.assertEqual(len(later.json()['books']), 2)

    # ── Which books ──

    def test_only_books_on_a_public_list(self):
        self.book({'id': 'library', 'title': 'Owned', 'lists': {}, 'editions': [edition('e1', lists={'library': {'at': '2026'}})]})
        self.book({'id': 'read', 'title': 'Read', 'lists': {'read': {'at': '2026'}}, 'editions': [edition('e1')]})
        self.book({'id': 'wish', 'title': 'Wished', 'lists': {'to-read': {'at': '2026'}}, 'editions': [edition('e1')]})
        self.book({'id': 'hidden', 'title': 'Hidden', 'lists': {}, 'editions': [edition('e1', lists={'secret': {'at': '2026'}})]})
        self.book({'id': 'nowhere', 'title': 'Nowhere', 'lists': {}, 'editions': [edition('e1')]})
        self.book({'id': 'gone', 'title': 'Gone', 'lists': {'read': {'at': '2026'}}, 'editions': [edition('e1')]}, deleted=True)
        self.assertEqual(sorted(self.by_id(self.fetch())), ['library', 'read'])

    def test_private_lists_do_not_exist_for_a_visitor(self):
        self.book({'id': 'b1', 'title': 'T', 'lists': {'to-read': {'at': '2026'}},
                   'editions': [edition('e1', lists={'library': {'at': '2026', 'note': 'x'}, 'lent': {'at': '2026', 'note': NOTE}})]})
        data = self.fetch()
        self.assertEqual([l['id'] for l in data['lists']], ['library', 'reading', 'read'])
        self.assertEqual(data['lists'][0], {'id': 'library', 'name': 'Library', 'group': '', 'order': 0})
        b = data['books'][0]
        self.assertEqual(b['lists'], {})
        self.assertEqual(b['editions'][0]['lists'], {'library': {'at': '2026'}})
        text = json.dumps(data)
        for secret in (NOTE, 'lent', 'to-read', 'secret', 'Secret shelf', 'Rooms', 'Behind', 'noteLabel'):
            self.assertNotIn(secret, text)

    # ── What of a book ──

    def test_reviews_follow_the_reading_lists(self):
        reviews = [{'id': 'r1', 'date': '2025-01-01', 'rating': 8, 'text': 'Good', 'ed': 'e1', 'boeken': 'a', 'url': 'u', 'sum': 's'}]
        self.book({'id': 'read', 'title': 'Read', 'rating': 8, 'reviews': reviews, 'lists': {'read': {'at': '2026'}}, 'editions': [edition('e1')]})
        self.book({'id': 'dnf', 'title': 'Dnf', 'rating': 3, 'reviews': reviews, 'lists': {'abandoned': {'at': '2026'}},
                   'editions': [edition('e1', lists={'library': {'at': '2026'}})]})
        books = self.by_id(self.fetch())
        self.assertEqual(books['read']['rating'], 8)
        self.assertEqual(books['read']['reviews'], [{'id': 'r1', 'date': '2025-01-01', 'rating': 8, 'text': 'Good', 'ed': 'e1'}])
        # Public through Library alone: what it owns, not what was thought of it.
        self.assertNotIn('rating', books['dnf'])
        self.assertNotIn('reviews', books['dnf'])
        self.assertEqual(books['dnf']['lists'], {})

    def test_progress_only_while_reading_is_public(self):
        progress = {'pagesRead': 120, 'percentRead': 40, 'progressUnit': 'percent'}
        self.book({'id': 'now', 'title': 'Now', 'lists': {'reading': {'at': '2026'}}, 'editions': [edition('e1')], **progress})
        self.book({'id': 'done', 'title': 'Done', 'lists': {'read': {'at': '2026'}}, 'editions': [edition('e1')], **progress})
        books = self.by_id(self.fetch())
        self.assertEqual(books['now']['pagesRead'], 120)
        self.assertEqual(books['now']['progressUnit'], 'percent')
        self.assertNotIn('pagesRead', books['done'])
        self.list_private('reading')
        self.assertNotIn('now', self.by_id(self.fetch()))

    def list_private(self, lid):
        data = next(l for l in lists() if l['id'] == lid)
        self.put(List, {**data, 'public': False}, name=data['name'])

    def test_booklog_and_unknown_fields_stay_home(self):
        self.book({'id': 'b1', 'title': 'T', 'series': 'S', 'seriesNumber': 2, 'tags': ['t'], 'categories': ['c'],
                   'lists': {'read': {'at': '2026', 'note': NOTE}}, 'editions': [edition('e1', lists={'library': {'at': '2026'}})],
                   'reviews': [{'id': 'r1', 'date': '2025-01-01', 'text': 'x', 'ed': 'e1', 'boeken': 'post', 'url': 'https://boeken.example/r', 'sum': '4:aa', 'extra': 1}],
                   **BOOKLOG})
        b = self.fetch()['books'][0]
        for key in BOOKLOG:
            self.assertNotIn(key, b)
        self.assertEqual(b['lists'], {'read': {'at': '2026'}})
        self.assertEqual(set(b['reviews'][0]), {'id', 'date', 'text', 'ed'})
        e = b['editions'][0]
        for key in ('coverSource', 'coverPhoto'):
            self.assertNotIn(key, e)
        self.assertEqual(e['people'], [{'name': 'A. Writer', 'role': ''}])
        self.assertEqual((b['series'], b['seriesNumber'], b['tags'], b['categories']), ('S', 2, ['t'], ['c']))
        text = json.dumps(b)
        for secret in (NOTE, 'boeken.example', 'private by default', 'post'):
            self.assertNotIn(secret, text)

    def test_editions_only_on_private_lists_are_hidden(self):
        self.book({'id': 'b1', 'title': 'T', 'main': 'e2', 'lists': {'read': {'at': '2026'}},
                   'reviews': [{'id': 'r1', 'date': '2024-01-01', 'ed': 'e1'}, {'id': 'r2', 'date': '2025-01-01', 'ed': 'e2'}],
                   'editions': [edition('e1', lists={'library': {'at': '2026'}}), edition('e2', lists={'lent': {'at': '2026', 'note': NOTE}}),
                                edition('e3')]})
        b = self.fetch()['books'][0]
        self.assertEqual([e['id'] for e in b['editions']], ['e1', 'e3'])   # e3 is on no list: nothing private about it
        self.assertNotIn('main', b)
        self.assertEqual(b['reviews'], [{'id': 'r1', 'date': '2024-01-01', 'ed': 'e1'}, {'id': 'r2', 'date': '2025-01-01'}])
        self.assertNotIn(NOTE, json.dumps(b))

    def test_a_book_whose_every_edition_is_private_keeps_a_face(self):
        self.book({'id': 'b1', 'title': 'T', 'lists': {'read': {'at': '2026'}},
                   'editions': [edition('e1', lists={'lent': {'at': '2026', 'note': NOTE}})]})
        b = self.fetch()['books'][0]
        self.assertEqual(len(b['editions']), 1)
        self.assertNotIn('lists', b['editions'][0])
        self.assertNotIn(NOTE, json.dumps(b))

    # ── Words ──

    def test_vocabulary_goes_list_words_only_for_public_lists(self):
        for data in [{'id': 'role-stem', 'kind': 'role', 'nl': 'stem', 'en': 'voice'},
                     {'id': 'tag:x', 'kind': 'tag', 'value': 'x', 'nl': 'Iks', 'en': 'Ex', 'aliases': ['y']},
                     {'id': 'list:Library', 'kind': 'list', 'value': 'Library', 'nl': 'Bibliotheek', 'en': 'Library'},
                     {'id': 'list:Secret shelf', 'kind': 'list', 'value': 'Secret shelf', 'nl': 'Geheim', 'en': 'Secret shelf'},
                     {'id': 'list:Lent to', 'kind': 'list', 'value': 'Lent to', 'nl': 'Uitgeleend aan', 'en': 'Lent to'},
                     {'id': 'other', 'kind': 'whatever', 'value': 'v'}]:
            self.put(Term, {**data, 'secret': 1}, value=data.get('value', ''))
        self.book({'id': 'b1', 'title': 'T', 'lists': {}, 'editions': [edition('e1', lists={'library': {'at': '2026'}})]})
        terms = {t['id']: t for t in self.fetch()['terms']}
        self.assertEqual(sorted(terms), ['list:Library', 'role-stem', 'tag:x'])
        self.assertNotIn('secret', terms['tag:x'])
        self.assertEqual(terms['tag:x']['aliases'], ['y'])


class LibrarySettingsTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user('Some.One', password='correct horse battery')
        self.client.force_login(self.user)

    def post(self, data, status=200):
        res = self.client.post('/api/library', json.dumps(data), content_type='application/json')
        self.assertEqual(res.status_code, status, res.content)
        return res.json()

    def test_needs_sign_in(self):
        self.client.logout()
        self.assertEqual(self.client.get('/api/library').status_code, 401)

    def test_not_allowed_until_the_admin_says(self):
        self.assertEqual(self.client.get('/api/library').json()['allowed'], False)
        self.post({'enabled': True}, status=403)
        lib = Library.objects.create(user=self.user)
        self.assertEqual(lib.slug, 'some-one')   # from the username
        self.post({'enabled': True}, status=403)
        lib.allowed = True
        lib.save()
        state = self.post({'enabled': True, 'title': {'en': ' Books ', 'nl': 'Boeken', 'fr': 'Livres'}, 'about': {'nl': 'Hallo'}})
        self.assertEqual(state, {'allowed': True, 'enabled': True, 'slug': 'some-one',
                                 'title': {'en': 'Books', 'nl': 'Boeken'}, 'about': {'en': '', 'nl': 'Hallo'}})

    def test_names(self):
        Library.objects.create(user=self.user, allowed=True)
        other = get_user_model().objects.create_user('other', password='x')
        Library.objects.create(user=other, slug='taken')
        self.post({'slug': 'taken'}, status=409)
        for bad in ('Has Caps', 'a', '-x', 'x-', 'api', 'u', 'a' * 41, 'x/y', ''):
            self.post({'slug': bad}, status=400)
        self.assertEqual(self.post({'slug': 'Mine-2'})['slug'], 'mine-2')   # lowercased first

    def test_page(self):
        Library.objects.create(user=self.user, allowed=True, enabled=True, slug='mine', title_nl='Mijn <boeken>')
        page = self.client.get('/u/mine')
        self.assertEqual(page.status_code, 200)
        html = page.content.decode()
        self.assertIn('<base href="/">', html)
        self.assertIn('<meta name="robots" content="noindex">', html)
        self.assertIn('<title>Mijn &lt;boeken&gt;</title>', html)
        self.assertEqual(page['X-Robots-Tag'], 'noindex')
        self.assertEqual(self.client.get('/u/nobody').status_code, 404)
