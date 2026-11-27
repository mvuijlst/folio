from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from . import hardcover_sync as hs
from .models import Book, HardcoverLink


def work(lists=None, reviews=(), editions=None, rating=None, added='2020-05-01T10:00:00.000Z'):
    data = {'id': 'b', 'title': 'Solaris', 'added': added, 'lists': lists or {},
            'reviews': list(reviews), 'editions': editions or [{'id': 'e1', 'isbn': '9780571219780', 'format': 'paper'}]}
    if rating is not None:
        data['rating'] = rating
    return data


class Wanted(SimpleTestCase):
    def test_no_status_is_not_sent(self):
        self.assertIsNone(hs.wanted(work()))   # unlogged is not unread

    def test_status_rating_and_dated_reads(self):
        w = hs.wanted(work({'read': {}}, [{'date': '2015-02-01', 'rating': 7, 'ed': 'e1'}, {'date': '2019', 'ed': 'e1'},
                                         {'date': '2020-03-04', 'dnf': True, 'ed': 'e1'}]))
        self.assertEqual(w['status'], 3)
        self.assertEqual(w['rating'], 3.5)
        self.assertEqual(w['reads'], [{'date': '2015-02-01', 'ed': 'e1'}])
        self.assertEqual(w['partial'], 1)
        self.assertEqual(w['added'], '2020-05-01')

    def test_the_latest_rated_read_wins_then_the_book(self):
        self.assertEqual(hs.wanted(work({'read': {}}, [{'date': '2001-01-01', 'rating': 4}, {'date': '2010-01-01', 'rating': 10}]))['rating'], 5.0)
        self.assertEqual(hs.wanted(work({'to-read': {}}, rating=6))['rating'], 3.0)
        self.assertIsNone(hs.wanted(work({'to-read': {}}, rating=0))['rating'])

    def test_the_edition_read_last_is_looked_for_first(self):
        eds = [{'id': 'e1', 'isbn': '0571219780'}, {'id': 'e2', 'asin': 'b0abc'}]
        w = hs.wanted(work({'read': {}}, [{'date': '2001-01-01', 'ed': 'e2'}], editions=eds))
        self.assertEqual(w['editions'], [{'id': 'e2', 'keys': [('asin', 'B0ABC')]}, {'id': 'e1', 'keys': [('isbn13', '9780571219780')]}])

    def test_isbns(self):
        self.assertEqual(hs.isbn13('90-5333-152-X'), '9789053331521')
        self.assertEqual(hs.isbn10('9780571219780'), '0571219780')
        self.assertEqual(hs.isbn10('9791032305690'), '')
        self.assertEqual(hs.isbn13('12345'), '')


class Changes(SimpleTestCase):
    want = {'status': 3, 'rating': 4.0, 'added': '2020-01-01', 'reads': [{'date': '2015-02-01', 'ed': 'e1'}],
            'partial': 0, 'editions': [{'id': 'e1', 'keys': [('isbn13', '9780571219780')]}]}

    def test_a_rating_folio_lacks_is_left_alone(self):
        self.assertEqual(hs.entry_changes({**self.want, 'rating': None}, {}, {'status_id': 3, 'rating': 2.5}), {})

    def test_only_what_differs(self):
        self.assertEqual(hs.entry_changes(self.want, {'e1': 9}, {'status_id': 1, 'rating': '4.0', 'edition_id': 9}), {'status_id': 3})

    def test_reads_fill_a_blank_one_and_keep_theirs(self):
        reads = [{'id': 1, 'finished_at': None, 'started_at': None}, {'id': 2, 'finished_at': '2009-09-09'}]
        self.assertEqual(hs.read_changes(self.want, {'e1': 9}, reads, []), [('set', 1, {'finished_at': '2015-02-01', 'edition_id': 9})])

    def test_only_the_syncs_own_reads_are_dropped(self):
        reads = [{'id': 1, 'finished_at': '2015-02-01'}, {'id': 2, 'finished_at': '2009-09-09'}, {'id': 3, 'finished_at': '2011-01-01'}]
        self.assertEqual(hs.read_changes(self.want, {}, reads, [3]), [('drop', 3)])


class Fake:
    """Just enough of Hardcover: editions by number, one user's library, and the mutations."""

    def __init__(self, editions, library=()):
        self.editions = editions
        self.books = {ub['id']: ub for ub in library}
        self.reads = {r['id']: (ub['id'], r) for ub in library for r in ub.get('user_book_reads', [])}
        self.next = 1000
        self.calls = []

    def __call__(self, query, v=None):
        v = v or {}
        name = next(n for n in ('EDITIONS', 'ME', 'LIBRARY', 'READS', 'INSERT', 'UPDATE', 'DELETE', 'READ_ADD', 'READ_SET', 'READ_DROP')
                    if getattr(hs, n) == query)
        self.calls.append((name, v))
        new = lambda: setattr(self, 'next', self.next + 1) or self.next
        if name == 'EDITIONS':
            return {'a': [e for e in self.editions if e.get('isbn_13') in v['i13']], 'b': [],
                    'c': [e for e in self.editions if e.get('asin') in v['asin']]}
        if name == 'ME':
            return {'me': [{'id': 7}]}
        if name == 'LIBRARY':
            rows = [dict(ub, user_book_reads=[r for b, r in self.reads.values() if b == ub['id']]) for ub in self.books.values()]
            return {'user_books': rows[v['off']:v['off'] + 500]}
        if name == 'READS':
            return {'user_books_by_pk': {'id': v['id'], 'user_book_reads': [r for b, r in self.reads.values() if b == v['id']]}}
        if name == 'INSERT':
            i = new()
            self.books[i] = {'id': i, 'edition_id': None, 'rating': None, **v['o']}
            if v['o'].get('status_id') == 3:   # as Hardcover may: a read with no dates
                r = new()
                self.reads[r] = (i, {'id': r, 'started_at': None, 'finished_at': None, 'edition_id': None})
            return {'insert_user_book': {'id': i, 'error': None}}
        if name == 'UPDATE':
            self.books[v['id']].update(v['o'])
            return {'update_user_book': {'id': v['id'], 'error': None}}
        if name == 'DELETE':
            self.books.pop(v['id'])
            return {'delete_user_book': {'id': v['id']}}
        if name == 'READ_ADD':
            r = new()
            self.reads[r] = (v['id'], {'id': r, 'started_at': None, 'edition_id': None, **v['r']})
            return {'insert_user_book_read': {'id': r, 'error': None}}
        if name == 'READ_SET':
            self.reads[v['id']][1].update(v['r'])
            return {'update_user_book_read': {'id': v['id'], 'error': None}}
        if name == 'READ_DROP':
            self.reads.pop(v['id'])
            return {'delete_user_book_read': {'id': v['id']}}


class Run(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create(username='michel')
        self.n = 0

    def book(self, data, uid=None):
        self.n += 1
        now = timezone.now()
        return Book.objects.create(user=self.user, uid=uid or f'b{self.n}', title=data.get('title', ''), data=data, modified=now, changed=now)

    def sync(self, fake, **kw):
        return hs.run(self.user, hs.Client(ask=fake, sleep=lambda s: None), **kw)

    def test_adds_a_book_fills_its_read_and_then_costs_nothing(self):
        self.book(work({'read': {}}, [{'date': '2015-02-01', 'rating': 8, 'ed': 'e1'}]))
        fake = Fake([{'id': 50, 'book_id': 5, 'isbn_13': '9780571219780', 'users_count': 3}])
        counts, _ = self.sync(fake)
        self.assertEqual(counts['added'], 1)
        ub = next(iter(fake.books.values()))
        self.assertEqual((ub['book_id'], ub['status_id'], ub['rating'], ub['edition_id'], ub['date_added']), (5, 3, 4.0, 50, '2020-05-01'))
        self.assertEqual([r for _, r in fake.reads.values()], [{'id': 1002, 'started_at': None, 'finished_at': '2015-02-01', 'edition_id': 50}])
        link = HardcoverLink.objects.get()
        self.assertTrue(link.created)
        self.assertEqual(link.reads, [1002])
        fake.calls.clear()
        counts, _ = self.sync(fake)
        self.assertEqual((counts['unchanged'], fake.calls), (1, []))

    def test_adopts_what_is_there_and_never_deletes_it(self):
        b = self.book(work({'read': {}}, [{'date': '2015-02-01', 'ed': 'e1'}]))
        fake = Fake([{'id': 50, 'book_id': 5, 'isbn_13': '9780571219780'}],
                    [{'id': 9, 'book_id': 5, 'edition_id': 51, 'status_id': 1, 'rating': '2.5',
                      'user_book_reads': [{'id': 90, 'started_at': None, 'finished_at': '2015-02-01', 'edition_id': None}]}])
        counts, fields = self.sync(fake)
        self.assertEqual((counts['adopted'], counts['updated']), (1, 1))
        self.assertEqual(fields, {'edition_id': 1, 'status_id': 1})
        self.assertEqual((fake.books[9]['status_id'], fake.books[9]['rating']), (3, '2.5'))   # no rating in Folio: theirs stays
        self.assertEqual(len(fake.reads), 1)
        self.assertFalse(HardcoverLink.objects.get().created)
        b.data = {**b.data, 'trashed': '2026-11-27'}
        b.save()
        counts, _ = self.sync(fake)
        self.assertEqual((counts['let go'], counts['removed']), (1, 0))
        self.assertIn(9, fake.books)
        self.assertFalse(HardcoverLink.objects.exists())

    def test_removes_what_it_added_when_the_status_goes(self):
        b = self.book(work({'to-read': {}}))
        fake = Fake([{'id': 50, 'book_id': 5, 'isbn_13': '9780571219780'}])
        self.sync(fake)
        self.assertEqual(len(fake.books), 1)
        b.data = {**b.data, 'lists': {}}
        b.save()
        counts, _ = self.sync(fake)
        self.assertEqual(counts['removed'], 1)
        self.assertEqual(fake.books, {})

    def test_unmatched_is_counted_and_not_asked_again_for_a_week(self):
        self.book(work({'read': {}}, editions=[{'id': 'e1', 'isbn': '9789053331524'}]))
        self.book(work({'read': {}}, editions=[{'id': 'e1', 'format': 'paper'}]))
        fake = Fake([])
        counts, _ = self.sync(fake)
        self.assertEqual(counts['unmatched'], 2)
        fake.calls.clear()
        counts, _ = self.sync(fake)
        self.assertEqual((counts['unmatched'], fake.calls), (2, []))

    def test_dry_run_writes_nothing(self):
        self.book(work({'reading': {}}))
        fake = Fake([{'id': 50, 'book_id': 5, 'isbn_13': '9780571219780'}])
        counts, _ = self.sync(fake, dry_run=True)
        self.assertEqual(counts['added'], 1)
        self.assertEqual((fake.books, HardcoverLink.objects.count()), ({}, 0))

    def test_two_books_on_one_hardcover_book(self):
        self.book(work({'read': {}}))
        self.book(work({'to-read': {}}))
        counts, _ = self.sync(Fake([{'id': 50, 'book_id': 5, 'isbn_13': '9780571219780'}]))
        self.assertEqual((counts['added'], counts['shared']), (1, 1))

    def test_stops_at_the_budget_and_carries_on(self):
        for _ in range(3):
            self.book(work({'to-read': {}}, editions=[{'id': 'e1', 'isbn': '9780571219780'}]) | {'title': 'x'})
        fake = Fake([{'id': 50, 'book_id': 5, 'isbn_13': '9780571219780'}])
        counts, _ = hs.run(self.user, hs.Client(ask=fake, budget=4, sleep=lambda s: None))
        self.assertEqual(counts['left for later'], 3)


def mine(ub_id, book_id, title, author, status=3):
    return {'id': ub_id, 'book_id': book_id, 'edition_id': None, 'status_id': status, 'rating': None, 'user_book_reads': [],
            'book': {'title': title, 'cached_contributors': [{'author': {'name': author}, 'contribution': None}]}}


class ByTitle(TestCase):
    """A book no number finds is looked for in the user's own library: one title, one writer."""

    def setUp(self):
        self.user = get_user_model().objects.create(username='michel')

    def book(self, uid, title, author, isbn=None, lists=None):
        now = timezone.now()
        ed = {'id': 'e1', 'people': [{'name': author, 'role': ''}]} | ({'isbn': isbn} if isbn else {})
        Book.objects.create(user=self.user, uid=uid, title=title, modified=now, changed=now,
                            data={'title': title, 'lists': lists or {'read': {}}, 'editions': [ed]})

    def sync(self, fake):
        return hs.run(self.user, hs.Client(ask=fake, sleep=lambda s: None))[0]

    def test_adopts_the_one_book_of_that_title_and_writer(self):
        self.book('a', "Death's Master (Tales from the Flat Earth #2)", 'Tanith Lee')
        fake = Fake([], [mine(9, 5, "Death's Master", 'Tanith Lee', status=1)])
        counts = self.sync(fake)
        self.assertEqual((counts['by title'], counts['updated'], counts['added']), (1, 1, 0))
        self.assertEqual(fake.books[9]['status_id'], 3)
        self.assertFalse(HardcoverLink.objects.get().created)

    def test_never_adds_by_title_nor_guesses_between_two(self):
        self.book('a', 'Rogues', 'George R. R. Martin')
        self.book('b', 'Kull', 'Robert E. Howard')
        fake = Fake([], [mine(9, 5, 'Rogues', 'Gardner Dozois'), mine(10, 6, 'Kull', 'Robert E. Howard'), mine(11, 7, 'Kull: Exile', 'R. Howard')])
        counts = self.sync(fake)
        self.assertEqual((counts['by title'], counts['unmatched'], counts['added']), (0, 2, 0))

    def test_a_number_match_keeps_its_book_from_a_title_match(self):
        self.book('a', 'Wool', 'Hugh Howey', isbn='9781476733951')
        self.book('b', 'Wool', 'Hugh Howey', lists={'to-read': {}})
        fake = Fake([{'id': 50, 'book_id': 5, 'isbn_13': '9781476733951'}], [mine(9, 5, 'Wool', 'Hugh Howey')])
        counts = self.sync(fake)
        self.assertEqual((counts['adopted'], counts['by title'], counts['unmatched']), (1, 0, 1))

    def test_numbers_must_agree(self):
        self.book('a', 'The League of Extraordinary Gentlemen, Vol. 3: Century - 1969', 'Alan Moore')
        self.book('b', 'The Books of Magic, vol. 2', 'Neil Gaiman')
        fake = Fake([], [mine(9, 5, 'The League of Extraordinary Gentlemen, Vol. 3 - Century, Part 1: 1910', 'Alan Moore'),
                         mine(10, 6, 'The Books of Magic', 'Neil Gaiman')])
        self.assertEqual(self.sync(fake)['by title'], 0)

    def test_two_subtitles_after_one_colon_are_two_books(self):
        self.book('a', 'The Mongoliad: Book One', 'Neal Stephenson')
        self.book('b', 'Mother Night: A Novel', 'Kurt Vonnegut')
        fake = Fake([], [mine(9, 5, 'The Mongoliad: Book Three', 'Neal Stephenson'), mine(10, 6, 'Mother Night', 'Kurt Vonnegut')])
        counts = self.sync(fake)
        self.assertEqual((counts['by title'], counts['unmatched']), (1, 1))


class Reads(SimpleTestCase):
    def want(self, *days):
        return {'reads': [{'date': d, 'ed': 'e1'} for d in days]}

    def test_a_read_within_a_month_is_the_same_read(self):
        reads = [{'id': 1, 'finished_at': '2007-06-01'}, {'id': 2, 'finished_at': '2007-06-28'}]
        # the user's own read takes the date before the sync's near duplicate, which goes
        self.assertEqual(hs.read_changes(self.want('2007-06-29'), {}, reads, [2]), [('drop', 2)])
        self.assertEqual(hs.read_changes(self.want('2007-06-28'), {}, reads, [2]), [('drop', 2)])   # even on its exact day
        self.assertEqual(hs.read_changes(self.want('2007-06-20'), {}, [{'id': 1, 'finished_at': '2007-06-01'}], []), [])
        self.assertEqual(hs.read_changes(self.want('2007-09-15'), {}, [{'id': 1, 'finished_at': '2007-06-01'}], []),
                         [('add', {'finished_at': '2007-09-15'})])

    def test_the_read_hardcover_adds_for_read_is_filled_or_removed(self):
        today = [{'id': 5, 'finished_at': '2026-11-27', 'started_at': None}, {'id': 1, 'finished_at': '2014-10-01'}]
        self.assertEqual(hs.read_changes(self.want('2025-06-13'), {}, today, [], fresh=[5]), [('set', 5, {'finished_at': '2025-06-13'})])
        self.assertEqual(hs.read_changes(self.want('2014-10-02'), {}, today, [], fresh=[5]), [('drop', 5)])

    def test_a_started_read_for_reading_stays(self):
        started = [{'id': 5, 'finished_at': None, 'started_at': '2026-11-27'}]
        self.assertEqual(hs.read_changes(self.want('2001-01-01'), {}, started, [], fresh=[5]), [('add', {'finished_at': '2001-01-01'})])
