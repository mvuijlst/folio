"""Stage 5: titles of their own (a translation), and books combined or split in the app, in the booklog."""
import copy
from datetime import timedelta

from django.utils import timezone

from shelf import publish, works
from shelf.models import Book
from shelf.test_publish import BooklogCase


class TitlesTests(BooklogCase):

    def test_a_read_of_a_translation_is_a_reread_with_its_own_title(self):
        def read_in_dutch(data):
            data['editions'].append({'id': 'nl', 'title': 'Duin', 'language': 'nl', 'publisher': 'Meulenhoff', 'format': 'paper'})
            data['reviews'].append({'id': 'r9', 'date': '2026-06-01', 'rating': 8, 'text': 'Nu in het Nederlands.', 'ed': 'nl'})
        before = {slug: self.post(slug) for slug in ('dune', 'dune-herlezing')}
        self.change('dune', read_in_dutch, flat=False)
        counts, said = self.publish()
        self.assertEqual(counts['published'], 1, said)
        post = self.post('dune-herlezing-2')
        self.assertTrue(post.startswith('---\ntitle: "Duin"\n'))
        self.assertIn('rereadOf: "dune"\n', post)
        self.assertIn('language: "nl"\n', post)
        self.assertEqual({slug: self.post(slug) for slug in before}, before)   # the other reads keep the book's title
        # Back from the booklog: one book, still Dune, with an edition titled Duin.
        self.import_booklog()
        data = self.book('dune').data
        self.assertEqual(data['title'], 'Dune')
        self.assertEqual(works.edition_of(data, 'nl')['title'], 'Duin')
        self.assertEqual([e.get('title') for e in data['editions']], [None, None, 'Duin'])
        self.assertEqual(self.publish()[0]['published'], 0)
        self.assertIn('3 unchanged', self.import_booklog())
        # The edition's title changes: its post follows, the others don't.
        self.change('dune', lambda d: works.edition_of(d, 'nl').update(title='Duin (vertaling)'), flat=False)
        self.publish()
        self.assertTrue(self.post('dune-herlezing-2').startswith('---\ntitle: "Duin (vertaling)"\n'))
        self.assertEqual({slug: self.post(slug) for slug in before}, before)
        self.import_booklog()
        self.assertEqual(self.publish()[0]['published'], 0)

    def test_the_books_title_changes_on_every_post_but_a_translations(self):
        def read_in_dutch(data):
            data['editions'].append({'id': 'nl', 'title': 'Duin', 'language': 'nl'})
            data['reviews'].append({'id': 'r9', 'date': '2026-06-01', 'rating': 8, 'text': '', 'ed': 'nl'})
        self.change('dune', read_in_dutch, flat=False)
        self.publish()
        self.import_booklog()
        self.change('dune', lambda d: d.update(title='Dune (Book One)'), flat=False)
        self.publish()
        self.assertIn('title: "Dune (Book One)"', self.post('dune'))
        self.assertIn('title: "Dune (Book One)"', self.post('dune-herlezing'))
        self.assertIn('title: "Duin"', self.post('dune-herlezing-2'))


class RegroupTests(BooklogCase):

    def combine(self, survivor, absorbed):
        """As the app's Combine with another book does it."""
        keep, other = self.book(survivor), self.book(absorbed)
        data = works.combine(copy.deepcopy(keep.data), copy.deepcopy(other.data))
        data['regroup'] = True
        data['joined'] = [other.data['boeken']]
        works.settle(data)
        when = timezone.now() - timedelta(hours=1)
        keep.data, keep.modified = data, when
        keep.save()
        Book.objects.filter(pk=other.pk).update(deleted=True, data={}, modified=when, changed=when)

    def split_off(self, key, ed_id, uid='split'):
        """As the app's Make it a book of its own does it (works.js split), for a read edition."""
        row = self.book(key)
        data = copy.deepcopy(row.data)
        edition = works.edition_of(data, ed_id)
        mine = [r for r in data['reviews'] if r['ed'] == ed_id]
        data['reviews'] = [r for r in data['reviews'] if r['ed'] != ed_id]
        data['editions'] = [e for e in data['editions'] if e['id'] != ed_id]
        latest = max(r['date'] for r in mine)
        piece = {'id': uid, 'added': row.data['added'], 'title': data['title'], 'author': data['author'], 'v': 2,
                 'editions': [{**edition, 'id': 'e1'}], 'reviews': [{**r, 'ed': 'e1'} for r in mine],
                 'lists': {'read': {'at': f'{latest}T12:00:00.000Z'}}, 'regroup': True}
        data['regroup'] = True
        works.settle(data)
        works.settle(piece)
        when = timezone.now() - timedelta(hours=1)
        row.data, row.modified = data, when
        row.save()
        Book.objects.create(user=self.user, uid=uid, data=piece, title=piece['title'], modified=when, changed=when)

    def test_two_books_of_the_booklog_combined_are_one_group(self):
        self.combine('dune', 'gilgamesh')
        self.assertEqual(self.import_booklog().count('waiting to be published'), 1)   # the import leaves it alone meanwhile
        self.assertEqual(len(self.book('dune').data['reviews']), 3)
        counts, said = self.publish()
        self.assertEqual(self.log()[0], 'Samengevoegd: Dune', said)
        self.assertIn('rereadOf: "dune"\n', self.post('gilgamesh'))
        self.assertNotIn('rereadOf', self.post('dune'))
        data = self.book('dune').data
        self.assertNotIn('regroup', data)
        self.assertEqual(data['boeken'], 'dune')
        self.assertTrue(data['url'].endswith('/gilgamesh/'))
        # Back from the booklog: one book with all three reads, the other stays gone.
        self.import_booklog()
        self.assertEqual(Book.objects.filter(user=self.user, deleted=False).count(), 2)
        self.assertEqual(sorted(r['boeken'] for r in self.book('dune').data['reviews']), ['dune', 'dune-herlezing', 'gilgamesh'])
        self.assertEqual(self.publish()[0]['published'], 0)

    def test_a_first_read_split_off_leaves_the_next_read_first(self):
        self.split_off('dune', 'ed-dune')
        counts, said = self.publish()
        self.assertEqual(self.log()[0], 'Gesplitst: Dune', said)
        self.assertNotIn('rereadOf', self.post('dune-herlezing'))
        self.assertNotIn('rereadOf', self.post('dune'))
        left = Book.objects.get(uid='boeken-dune').data
        piece = Book.objects.get(uid='split').data
        self.assertEqual((left['boeken'], piece['boeken']), ('dune-herlezing', 'dune'))
        self.assertTrue(piece['url'].endswith('/dune/'))
        self.import_booklog()
        self.assertEqual(Book.objects.filter(user=self.user, deleted=False, title='Dune').count(), 2)
        self.assertEqual([r['boeken'] for r in Book.objects.get(uid='split').data['reviews']], ['dune'])
        self.assertEqual([r['boeken'] for r in Book.objects.get(uid='boeken-dune').data['reviews']], ['dune-herlezing'])
        self.assertEqual(self.publish()[0]['published'], 0)

    def test_a_reread_split_off_is_a_first_read_of_its_own(self):
        self.split_off('dune', 'ed-dune-herlezing')
        self.publish()
        self.assertNotIn('rereadOf', self.post('dune-herlezing'))
        self.assertEqual(Book.objects.get(uid='split').data['boeken'], 'dune-herlezing')
        self.assertEqual(Book.objects.get(uid='boeken-dune').data['boeken'], 'dune')
        self.import_booklog()
        self.assertEqual(self.publish()[0]['published'], 0)

    def test_two_books_waiting_to_be_read_keep_one_post_waiting(self):
        self.combine('katabasis', 'gilgamesh')
        counts, said = self.publish()
        self.assertEqual(self.log()[0], 'Samengevoegd: Katabasis', said)
        self.assertFalse((self.repo / 'site/content/posts/gilgamesh.md').exists())
        self.assertIn('status: "reading"', self.post('katabasis'))
        data = self.book('katabasis').data
        self.assertNotIn('reviews', data)   # the note of the post that went, went with it
        self.import_booklog()
        self.assertEqual(Book.objects.filter(user=self.user, deleted=False).count(), 2)
        self.assertEqual(self.publish()[0]['published'], 0)

    def test_a_device_that_had_not_heard_of_the_regroup_does_not_ask_for_it_again(self):
        from shelf.views import kept_from_publishing
        self.combine('dune', 'gilgamesh')
        stale = copy.deepcopy(self.book('dune').data)
        self.publish()
        now = self.book('dune').data
        kept = kept_from_publishing(now, {**stale, 'rating': 3})
        self.assertNotIn('regroup', kept)
        self.assertEqual((kept['rating'], kept['url']), (3, now['url']))
        self.assertTrue(publish.is_pending(works.flat(kept)) is False or 'regroup' not in kept)
