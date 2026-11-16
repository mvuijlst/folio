"""Publishing from the app to the booklog, against a throwaway booklog with a remote of its own."""
import copy
import json
import subprocess
import tempfile
from datetime import timedelta
from io import StringIO
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone

from shelf import boeken, publish, works
from shelf.models import Book
from shelf.test_boeken import POSTS, make_repo, png


def edited(stored, edit):
    """A book (as it is stored) changed as `edit` changes it in the old shape (works.flat), as a
    test says it shortest: the book's own facts are its main edition's, and a review's edition
    is the edition that read was of (a new review's, a new edition)."""
    data = copy.deepcopy(stored)
    view = works.flat(data)
    view.setdefault('reviews', [])
    before = copy.deepcopy(view)
    edit(view)
    main = works.main_edition(data)
    for key in set(view) | set(before):
        if key in ('editions', 'reviews', 'lists') or view.get(key) == before.get(key):
            continue
        place = main if key in works.MOVED else data
        if view.get(key) in (None, '', []) and key in works.MOVED or key not in view:
            place.pop(key, None)
        else:
            place[key] = view[key]
    if view.get('lists') != before.get('lists'):
        statuses = works.status_set()
        data['lists'] = {k: v for k, v in view['lists'].items() if k in statuses}
        for edition in data['editions']:
            edition.pop('lists', None)
        main['lists'] = {k: v for k, v in view['lists'].items() if k not in statuses}
    prior = {r.get('id'): r for r in before.get('reviews') or []}
    reviews = []
    for review in view.get('reviews') or []:
        review = dict(review)
        edition = review.pop('edition', None)
        was = prior.get(review.get('id'))
        if was and edition is not None and edition != was.get('edition'):
            target = works.edition_of(data, review.get('ed'))
            for key in works.MOVED:
                if edition.get(key) not in (None, '', []):
                    target[key] = edition[key]
                else:
                    target.pop(key, None)
        elif not was and edition:
            review['ed'] = works.next_edition_id(data)
            data['editions'].append({'id': review['ed'], **works.facts_of(edition)})
        reviews.append(review)
    data['reviews'] = reviews
    if not reviews:
        data.pop('reviews')
    return works.settle(data)


def git(folder, *args):
    done = subprocess.run(['git', *args], cwd=folder, capture_output=True, text=True, encoding='utf-8')
    assert done.returncode == 0, done.stderr
    return done.stdout


class BooklogCase(TestCase):
    """A booklog in a git repository with a remote, imported into a user's shelf."""

    def setUp(self):
        self.user = get_user_model().objects.create_user('reader', password='x')
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.repo, self.origin = root / 'booklog', root / 'origin.git'
        make_repo(self.repo)
        git(root, 'init', '--quiet', '--bare', '-b', 'main', str(self.origin))
        git(self.repo, 'init', '--quiet', '-b', 'main')
        git(self.repo, 'config', 'core.autocrlf', 'false')
        git(self.repo, 'add', '.')
        git(self.repo, '-c', 'user.name=T', '-c', 'user.email=t@example.org', 'commit', '--quiet', '-m', 'The booklog')
        git(self.repo, 'remote', 'add', 'origin', str(self.origin))
        git(self.repo, 'push', '--quiet', '-u', 'origin', 'main')
        settings = override_settings(BOEKEN_REPO=str(self.repo), COVERS_DIR=root / 'covers', BOEKEN_PUSH=True,
                                     BOEKEN_GIT_AUTHOR='Folio <folio@example.org>')
        settings.enable()
        self.addCleanup(settings.disable)
        self.import_booklog()

    # ── helpers

    def import_booklog(self):
        out = StringIO()
        call_command('import_boeken', str(self.repo), '--user', 'reader', '--covers', str(Path(self.tmp.name, 'thumbs')), stdout=out)
        return out.getvalue()

    def book(self, key):
        return Book.objects.get(user=self.user, data__boeken=key)

    def flat(self, key):
        return works.flat(self.book(key).data)

    def change(self, key, edit, flat=True):
        """Change a book as the app would, long enough ago to be published. `edit` changes it in
        the old shape (see edited), or, with flat=False, as it is stored."""
        row = self.book(key)
        if flat:
            data = edited(row.data, edit)
        else:
            data = copy.deepcopy(row.data)
            edit(data)
            works.settle(data)
        row.data, row.modified = data, timezone.now() - timedelta(hours=1)
        row.save()

    def publish(self, **options):
        said = []
        counts = publish.run(self.user, str(self.repo), say=said.append, **options)
        return counts, said

    def post(self, slug):
        return (self.repo / 'site' / 'content' / 'posts' / f'{slug}.md').read_text(encoding='utf-8')

    def log(self):
        return git(self.repo, 'log', '--format=%s').splitlines()

    def changed_lines(self, slug):
        """The lines of a post that the last commit added or removed."""
        diff = git(self.repo, 'show', '--format=', '--unified=0', 'HEAD', '--', f'site/content/posts/{slug}.md')
        return sorted(line for line in diff.splitlines() if line[:1] in '+-' and not line.startswith(('+++', '---')))


class PublishTests(BooklogCase):

    def test_a_shelf_nobody_touched_publishes_nothing(self):
        counts, said = self.publish()
        self.assertEqual((counts, said), ({'published': 0, 'settled': 0, 'failed': 0, 'waiting': 0}, []))
        self.assertEqual(self.log(), ['The booklog'])
        self.assertTrue(all('boekenState' in b.data for b in Book.objects.all()))

    def test_an_edited_review_changes_only_those_lines_of_its_post(self):
        def edit(data):
            data['reviews'][0].update(text=data['reviews'][0]['text'].replace('A long review', 'A much longer review'), rating=8)
        self.change('dune', edit)
        counts, said = self.publish()
        self.assertEqual(counts['published'], 1)
        self.assertEqual(self.log()[0], 'Bewerkt: Dune')
        self.assertEqual(self.changed_lines('dune'), ['+A much longer review, with *emphasis*.', '+rating: 8',
                                                      '-A long review, with *emphasis*.', '-rating: 9'])
        # The picture and the video are shortcodes again, and the link is site-relative as it was.
        self.assertIn('{{< bookimg src="uploads/2010/03/worm.jpg" alt="A worm" >}}', self.post('dune'))
        self.assertIn('[the sequel](/2011/02/dune-messiah/) and {{< youtube VRaoHi_xcWk >}}', self.post('dune'))
        self.assertEqual(git(self.repo, 'log', '-1', '--format=%an <%ae>').strip(), 'Folio <folio@example.org>')
        # In step again: a second run has nothing to do, and the import changes nothing.
        self.assertEqual(self.publish()[0]['published'], 0)
        self.assertIn('3 unchanged', self.import_booklog())

    def test_a_reading_date_in_another_month_moves_the_post_and_keeps_its_old_address(self):
        self.change('dune', lambda data: data['reviews'][0].update(date='2010-04-02'))
        self.publish()
        self.assertEqual(self.changed_lines('dune'), ['+aliases: ["/2010/03/dune/"]', '+date: 2010-04-02T23:30:00+02:00',
                                                      '-date: 2010-03-31T23:30:00+02:00'])

    def test_to_read_becomes_reading(self):
        def edit(data):
            del data['lists']['to-read']
            data['lists']['reading'] = {'at': '2026-11-14T10:00:00.000Z'}
        self.change('gilgamesh', edit)
        self.publish()
        self.assertEqual(self.log()[0], 'Lezende: Gilgamesh')
        self.assertEqual(self.changed_lines('gilgamesh'), ['+pagesRead: 1', '+status: "reading"', '-status: "to-read"'])

    def test_progress_is_logged(self):
        self.change('katabasis', lambda data: data.update(pagesRead=200))
        self.publish()
        today = timezone.now().astimezone(boeken.BRUSSELS).date().isoformat()
        self.assertEqual(self.log()[0], 'Voortgang Katabasis (p. 200)')
        self.assertEqual(self.changed_lines('katabasis'), [f'+  - "{today} p200"', '+pagesRead: 200', '+progressLog:', '-pagesRead: 95'])

    def test_a_dated_review_finishes_the_book_being_read(self):
        self.change('katabasis', lambda data: data['reviews'].append(
            {'id': 'r1', 'date': '2026-11-10', 'rating': 8, 'text': 'Down they went. ' * 20}))
        self.publish()
        self.assertEqual(self.log()[0], 'Uitgelezen: Katabasis')
        post = self.post('katabasis')
        self.assertNotIn('status:', post)
        self.assertNotIn('pagesRead:', post)
        self.assertIn('date: 2026-11-10T20:00:00+01:00\n', post)
        self.assertIn('rating: 8\nreview: true\n', post)
        self.assertTrue(post.endswith('Down they went. ' * 19 + 'Down they went.\n'))
        # The review now belongs to that post, and the import puts the book on Read.
        self.assertEqual(self.book('katabasis').data['reviews'][0]['boeken'], 'katabasis')
        self.import_booklog()
        book = self.flat('katabasis')
        self.assertEqual(list(book['lists']), ['read'])
        self.assertEqual([(r['id'], r['date'], r['rating']) for r in book['reviews']], [('boeken-katabasis', '2026-11-10', 8)])
        self.assertFalse(publish.is_pending(book))

    def test_another_review_of_a_read_book_is_a_reread(self):
        self.change('gilgamesh', lambda data: None)   # (untouched books stay out of it)
        self.change('dune', lambda data: data['reviews'].append({'id': 'r2', 'date': '2026-06-01', 'rating': 10, 'text': 'Third time.'}))
        self.publish()
        self.assertEqual(self.log()[0], 'Herlezen: Dune')
        new = self.post('dune-herlezing-2')                      # dune-herlezing was the second read
        self.assertIn('rereadOf: "dune"\n', new)
        self.assertIn('title: "Dune"\nseries: ["Dune"]\nseries_number: 1\ndate: 2026-06-01T20:00:00+02:00\nslug: "dune-herlezing-2"\n', new)
        self.assertIn('rating: 10\n', new)
        self.assertTrue(new.endswith('---\nThird time.\n'))
        self.import_booklog()
        self.assertEqual([r['boeken'] for r in self.book('dune').data['reviews']], ['dune', 'dune-herlezing', 'dune-herlezing-2'])
        self.assertEqual(self.publish()[0]['published'], 0)

    def test_title_and_series_are_the_books_and_change_on_every_read(self):
        self.change('dune', lambda data: data.update(title='Dune!', series='Dune Chronicles', seriesNumber=1.5, seriesLabel='1/2', pages=600))
        self.publish()
        for slug in ('dune', 'dune-herlezing'):
            self.assertIn('title: "Dune!"\nseries: ["Dune Chronicles"]\nseries_number: 1.5\nseries_number_label: "1/2"\n', self.post(slug))
        self.assertIn('pages: 600\n', self.post('dune-herlezing'))           # the edition read last
        self.assertIn('pages: 535\n', self.post('dune'))
        term = self.repo / 'site' / 'content' / 'series' / 'dune-chronicles' / '_index.md'
        self.assertEqual(term.read_text(encoding='utf-8'), '---\ntitle: "Dune Chronicles"\nslug: "dune-chronicles"\n---\n')
        self.import_booklog()   # the latest read's edition now says 600 pages too
        self.assertIn('3 unchanged', self.import_booklog())
        self.assertEqual(self.publish()[0]['published'], 0)

    def test_language_categories_and_tags_are_published(self):
        page = self.repo / 'site' / 'content' / 'categories'
        for name in ('sf', 'roman'):
            (page / name).mkdir(parents=True)
            (page / name / '_index.md').write_text(f'---\ntitle: "{name}"\n---\n', encoding='utf-8', newline='')
        git(self.repo, 'add', '.')
        git(self.repo, '-c', 'user.name=T', '-c', 'user.email=t@example.org', 'commit', '--quiet', '-m', 'Categories')
        self.change('dune', lambda data: data.update(language='nl', categories=['sf', 'roman'], tags=['desert', 'Spice Trade']))
        self.publish()
        self.assertEqual(self.log()[0], 'Bewerkt: Dune')
        # The language is the edition's: the read last. Categories and tags are the book's.
        self.assertEqual(self.changed_lines('dune'), ['+categories: ["sf", "roman"]', '+tags: ["desert", "spice-trade"]',
                                                      '-categories: ["sf"]', '-tags: ["desert"]'])
        self.assertEqual(self.changed_lines('dune-herlezing'), ['+categories: ["sf", "roman"]', '+language: "nl"',
                                                                '+tags: ["desert", "spice-trade"]'])
        term = self.repo / 'site' / 'content' / 'tags' / 'spice-trade' / '_index.md'
        self.assertEqual(term.read_text(encoding='utf-8'), '---\ntitle: "Spice Trade"\nslug: "spice-trade"\n---\n')
        self.import_booklog()
        book = self.flat('dune')
        self.assertEqual((book['language'], book['categories'], book['tags']), ('nl', ['sf', 'roman'], ['desert', 'spice-trade']))
        self.assertEqual(self.publish()[0]['published'], 0)
        # Taken off every read, a tag stays off.
        self.change('dune', lambda data: data.update(tags=[]))
        self.publish()
        self.assertNotIn('tags:', self.post('dune') + self.post('dune-herlezing'))
        self.import_booklog()
        self.assertFalse(self.book('dune').data.get('tags'))
        self.assertEqual(self.publish()[0]['published'], 0)

    def test_a_category_the_booklog_lacks_is_refused(self):
        self.change('dune', lambda data: data.update(categories=['nonsense']))
        counts, said = self.publish()
        self.assertEqual(counts['failed'], 1)
        self.assertEqual(self.book('dune').data['boekenError'], 'The booklog has no category "nonsense".')
        self.assertEqual(self.log(), ['The booklog'])

    def test_a_state_from_before_categories_were_published_has_no_change_in_them(self):
        row = self.book('dune')
        older = {k: v for k, v in row.data['boekenState'].items() if k not in ('language', 'categories', 'tags')}
        row.data = {**row.data, 'categories': ['other'], 'boekenState': {**older, 'tracks': 2}}
        row.save()
        self.assertEqual(publish.changed_keys(works.flat(row.data)), set())

    def test_every_read_has_its_own_edition(self):
        first, second = self.flat('dune')['reviews']
        self.assertEqual(first['edition'], {'publisher': 'Ace', 'date': '1990', 'pages': 535, 'isbn': '9780441172719', 'language': 'en',
                                            'cover': 'https://boeken.tsuk.org/wp-content/uploads/2010/03/dune.jpg',
                                            'people': [{'name': 'Frank Herbert', 'role': 'auteur'}, {'name': 'Some Translator', 'role': 'vertaling'}]})
        # what the reread's own post says, no more: it names the author alone
        self.assertEqual(second['edition'], {'date': '1990', 'pages': 535, 'people': [{'name': 'Frank Herbert', 'role': ''}]})
        self.assertTrue(first['sum'].startswith(f'{boeken.SUM_VERSION}:'))

    # ── people: who wrote, drew, translated or read it, per read

    def test_a_voice_added_to_one_read_goes_to_that_reads_post(self):
        def narrated(data):
            data['reviews'][1]['edition'] = {**data['reviews'][1]['edition'], 'duration': '21u 2m',
                                             'people': [{'name': 'Frank Herbert', 'role': ''}, {'name': 'Ned Narrator', 'role': 'stem'}]}
        self.change('dune', narrated)
        self.publish()
        self.assertEqual(self.changed_lines('dune-herlezing'), [
            '+  narrator-ned: "stem"', '+authors: ["herbert-frank", "narrator-ned"]', '+duration: "21u 2m"', '+roles:',
            '-authors: ["herbert-frank"]', '-pages: 535'])
        page = self.repo / 'site' / 'content' / 'authors' / 'narrator-ned' / '_index.md'
        self.assertEqual(page.read_text(encoding='utf-8'), '---\ntitle: "Ned Narrator"\nslug: "narrator-ned"\nwpName: "Narrator - Ned"\n---\n')
        self.assertEqual(git(self.repo, 'show', '--stat', '--format=', 'HEAD').count('posts/'), 1)   # the first read's post is left alone
        self.import_booklog()
        book = self.flat('dune')
        self.assertEqual(book['people'], [{'name': 'Frank Herbert', 'role': ''}, {'name': 'Ned Narrator', 'role': 'stem'}])
        self.assertEqual(book['author'], 'Frank Herbert')   # a voice is not an author
        self.assertEqual(self.publish()[0]['published'], 0)

    # ── format: paper, e-book or audiobook, per read

    def test_a_read_said_to_be_an_audiobook_gets_its_length_and_no_category(self):
        def listened(data):
            data['reviews'][1]['edition'] = {**data['reviews'][1]['edition'], 'format': 'audiobook', 'duration': '21u 2m'}
        self.change('dune', listened)
        self.publish()
        self.assertEqual(self.changed_lines('dune-herlezing'), [
            '+duration: "21u 2m"', '+format: "audiobook"', '-pages: 535'])   # `format` says it: no audiobook category
        self.import_booklog()
        book = self.flat('dune')
        self.assertEqual((book['format'], book['reviews'][1]['edition']['format']), ('audiobook', 'audiobook'))
        self.assertEqual(self.publish()[0]['published'], 0)

    def test_an_e_book_is_said_in_the_post_and_keeps_its_pages(self):
        self.change('katabasis', lambda data: data.update(format='ebook'))
        self.publish()
        self.assertEqual(self.changed_lines('katabasis'), ['+format: "ebook"'])
        self.import_booklog()
        self.assertEqual(self.flat('katabasis')['format'], 'ebook')
        self.assertEqual(self.publish()[0]['published'], 0)

    def test_the_book_turned_audiobook_trades_pages_for_a_length(self):
        def audio(data):
            data.update(format='audiobook', duration='18u 30m')
            data.pop('pages')
        self.change('katabasis', audio)
        self.publish()
        self.assertEqual(self.changed_lines('katabasis'), [
            '+duration: "18u 30m"', '+format: "audiobook"', '-pages: 559'])
        self.import_booklog()
        self.assertEqual(self.publish()[0]['published'], 0)

    def test_the_books_own_people_go_to_its_latest_read(self):
        self.change('katabasis', lambda data: data.update(people=[{'name': 'R.F. Kuang', 'role': ''}, {'name': 'Some Translator', 'role': 'vertaling'}]))
        self.publish()
        self.assertEqual(self.changed_lines('katabasis'), [
            '+  someone-else: "vertaling"', '+authors: ["kuang-r-f", "someone-else"]', '+roles:', '-authors: ["kuang-r-f"]'])
        self.import_booklog()
        self.assertIn('3 unchanged', self.import_booklog())
        self.assertEqual(self.publish()[0]['published'], 0)

    def test_people_that_did_not_change_are_not_published(self):
        # Saved in the app as it was: the same people in other words is no change.
        self.change('dune', lambda data: data.update(people=[{'name': ' Frank  Herbert ', 'role': '', 'extra': 1}]))
        self.assertEqual(self.publish()[0]['published'], 0)

    def test_an_edition_changed_on_an_earlier_read_goes_to_that_reads_post(self):
        def edit(data):
            data['reviews'][0]['edition'] = {**data['reviews'][0]['edition'], 'publisher': 'Gollancz', 'date': '2007', 'pages': 577}
        self.change('dune', edit)
        self.publish()
        self.assertEqual(self.changed_lines('dune'), ['+pages: 577', '+publisher: "Gollancz"', '+year: 2007',
                                                      '-pages: 535', '-publisher: "Ace"', '-year: 1990'])
        self.assertEqual(git(self.repo, 'show', '--stat', '--format=', 'HEAD').count('.md'), 1)   # the reread's post is left alone
        self.import_booklog()   # the book's own publisher follows: the reread's post names none
        self.assertIn('3 unchanged', self.import_booklog())
        self.assertEqual(self.publish()[0]['published'], 0)

    def test_a_reread_in_another_edition_gets_that_editions_facts_and_cover(self):
        own = Path(self.tmp.name, 'covers', 'own')
        own.mkdir(parents=True)
        (own / 'audio.jpg').write_bytes(png(500, 500))
        self.change('dune', lambda data: data['reviews'].append({
            'id': 'r3', 'date': '2026-06-01', 'rating': 9, 'text': 'Listened to it.',
            'edition': {'publisher': 'Macmillan Audio', 'date': '2007', 'duration': '21u 2m', 'language': 'en',
                        'pages': 535, 'cover': 'covers/own/audio-320.webp', 'coverFull': 'covers/own/audio.jpg'}}))
        self.publish()
        self.assertEqual(self.log()[0], 'Herlezen: Dune')
        new = self.post('dune-herlezing-2')
        self.assertIn('publisher: "Macmillan Audio"\nyear: 2007\nduration: "21u 2m"\n', new)
        self.assertNotIn('pages:', new)                                # an audiobook has a length, not pages
        self.assertIn('cover: "/wp-content/uploads/2026/06/dune-herlezing-2.jpg"\n', new)
        self.assertEqual((self.repo / 'media/wp-content/uploads/2026/06/dune-herlezing-2.jpg').read_bytes(), png(500, 500))
        self.assertNotIn('Macmillan', self.post('dune'))               # the earlier reads keep their own edition
        self.import_booklog()
        editions = [r['edition'] for r in self.flat('dune')['reviews']]
        self.assertEqual(editions[2]['duration'], '21u 2m')
        self.assertRegex(editions[2]['cover'], r'^covers/boeken/[0-9a-f]{16}-320[.]webp$')   # its own thumbnail
        self.assertEqual(self.publish()[0]['published'], 0)

    def test_a_review_from_before_editions_is_not_mistaken_for_an_edited_one(self):
        import hashlib
        row = self.book('dune')
        old = dict(row.data['reviews'][0])
        old['sum'] = hashlib.sha1(json.dumps([old['date'], old['rating'], old['text']], ensure_ascii=False).encode()).hexdigest()[:12]
        row.data = {**row.data, 'reviews': [old, row.data['reviews'][1]]}
        row.save()
        self.assertFalse(publish.is_pending(self.flat('dune')))
        self.assertIn('0 reviews kept as edited in the app', self.import_booklog())
        self.assertTrue(self.book('dune').data['reviews'][0]['sum'].startswith(f'{boeken.SUM_VERSION}:'))   # and the import gives it the new fingerprint

    def test_a_new_cover_goes_into_the_media_folder(self):
        own = Path(self.tmp.name, 'covers', 'own')
        own.mkdir(parents=True)
        (own / 'abc.jpg').write_bytes(png(300, 450))
        self.change('gilgamesh', lambda data: data.update(cover='covers/own/abc-320.webp', coverFull='covers/own/abc.jpg'))
        self.publish()
        self.assertIn('cover: "/wp-content/uploads/2026/11/gilgamesh.jpg"\n', self.post('gilgamesh'))
        self.assertEqual((self.repo / 'media/wp-content/uploads/2026/11/gilgamesh.jpg').read_bytes(), png(300, 450))

    def test_a_catalogue_cover_goes_into_the_media_folder_at_full_size(self):
        from unittest import mock
        from shelf import covers
        self.change('gilgamesh', lambda data: data.update(cover='covers/web/abc-320.webp', coverSource='https://covers.openlibrary.org/b/id/9-M.jpg'))
        with mock.patch.object(covers, 'download', return_value=png(600, 900)) as download:
            self.publish()
        self.assertEqual(download.call_args.args[0], 'https://covers.openlibrary.org/b/id/9-L.jpg?default=false')
        self.assertIn('cover: "/wp-content/uploads/2026/11/gilgamesh.jpg"' + chr(10), self.post('gilgamesh'))

    def test_a_cover_that_has_not_reached_the_server_waits(self):
        # The read last (whose edition is the book's face) has a cover in the booklog.
        post = self.repo / 'site' / 'content' / 'posts' / 'dune-herlezing.md'
        post.write_text(self.post('dune-herlezing').replace('authors:', 'cover: "/wp-content/uploads/2024/05/x.jpg"\nauthors:'), encoding='utf-8', newline='')
        git(self.repo, '-c', 'user.name=T', '-c', 'user.email=t@example.org', 'commit', '--quiet', '-am', 'A cover')
        self.import_booklog()
        self.change('dune', lambda data: data.update(cover='', thumb='data:image/jpeg;base64,xxxx'))
        # Nothing is written; the read of that edition is in step with it (nothing to say yet).
        self.assertEqual(self.publish()[0], {'published': 0, 'settled': 1, 'failed': 0, 'waiting': 0})
        self.assertEqual(self.log()[0], 'A cover')
        self.assertTrue(publish.is_pending(self.flat('dune')))    # still to come
        self.assertIn('1 waiting to be published', self.import_booklog())
        self.assertFalse(self.flat('dune').get('cover'))               # the import left the app's choice alone

    def test_what_the_booklog_check_turns_down_leaves_no_trace(self):
        check = self.repo / 'scripts' / 'check_books.py'
        check.parent.mkdir()
        check.write_text('import sys, pathlib\nslug = sys.argv[sys.argv.index("--post") + 1]\n'
                         'bad = "FORBIDDEN" in pathlib.Path("site/content/posts", slug + ".md").read_text(encoding="utf-8")\n'
                         'print("ERROR: forbidden word" if bad else "fine")\nsys.exit(1 if bad else 0)\n', encoding='utf-8')
        git(self.repo, 'add', '.')
        git(self.repo, '-c', 'user.name=T', '-c', 'user.email=t@example.org', 'commit', '--quiet', '-m', 'A check')
        before = self.post('dune')
        self.change('dune', lambda data: data['reviews'][0].update(text='FORBIDDEN'))
        counts, said = self.publish()
        self.assertEqual(counts['failed'], 1)
        self.assertEqual(self.post('dune'), before)
        self.assertTrue(publish.is_clean(str(self.repo)))
        self.assertEqual(self.log()[0], 'A check')
        self.assertIn('forbidden word', self.book('dune').data['boekenError'])
        # Put right, it goes through and the complaint is gone.
        self.change('dune', lambda data: data['reviews'][0].update(text='Allowed.'))
        self.assertEqual(self.publish()[0]['published'], 1)
        self.assertNotIn('boekenError', self.book('dune').data)

    def test_a_change_made_a_moment_ago_waits(self):
        self.change('dune', lambda data: data['reviews'][0].update(rating=1))
        Book.objects.filter(pk=self.book('dune').pk).update(modified=timezone.now())
        self.assertEqual(self.publish(delay=120)[0], {'published': 0, 'settled': 0, 'failed': 0, 'waiting': 1})
        self.assertEqual(self.publish(delay=0)[0]['published'], 1)

    def test_the_import_leaves_alone_what_is_waiting_to_be_published(self):
        def edit(data):
            del data['lists']['to-read']
            data['lists']['reading'] = {'at': '2026-11-14T10:00:00.000Z'}
            data['title'] = 'Gilgamesj'
        self.change('gilgamesh', edit)
        self.assertIn('1 waiting to be published', self.import_booklog())
        book = self.flat('gilgamesh')
        self.assertEqual((list(book['lists']), book['title']), (['reading'], 'Gilgamesj'))

    def test_a_dry_run_says_what_it_would_do_and_does_nothing(self):
        self.change('dune', lambda data: data['reviews'][0].update(rating=1))
        counts, said = self.publish(dry_run=True)
        self.assertEqual(counts['published'], 1)
        self.assertEqual(said, ['Bewerkt: Dune', '    site/content/posts/dune.md'])
        self.assertEqual(self.log(), ['The booklog'])
        self.assertTrue(publish.is_pending(self.flat('dune')))

    def test_sync_boeken_publishes_pushes_and_imports(self):
        # Someone else pushes to the booklog meanwhile (as boeggn does).
        other = Path(self.tmp.name, 'elsewhere')
        git(self.tmp.name, 'clone', '--quiet', str(self.origin), str(other))
        git(other, 'config', 'core.autocrlf', 'false')
        path = other / 'site' / 'content' / 'posts' / 'gilgamesh.md'
        path.write_text(path.read_text(encoding='utf-8').replace('Why this is on the pile.', 'Because.'), encoding='utf-8', newline='\n')
        git(other, '-c', 'user.name=B', '-c', 'user.email=b@example.org', 'commit', '--quiet', '-am', 'Bewerkt: Gilgamesh')
        git(other, 'push', '--quiet')

        self.change('dune', lambda data: data['reviews'][0].update(rating=7))
        out = StringIO()
        call_command('sync_boeken', '--user', 'reader', '--delay', '0', stdout=out)
        self.assertIn('Bewerkt: Dune', out.getvalue())
        self.assertIn('pushed 1 commit(s)', out.getvalue())
        self.assertEqual(git(self.origin, 'log', '--format=%s', 'main').splitlines()[:2], ['Bewerkt: Dune', 'Bewerkt: Gilgamesh'])
        self.assertEqual(self.book('gilgamesh').data['reviews'][0]['text'], 'Because.')   # the other's change reached the app
        self.assertEqual(self.flat('dune')['rating'], 10)   # the book's rating is still its latest read's

    def test_a_quiet_run_says_nothing_and_does_not_import_again(self):
        from unittest import mock
        from django.core.management import call_command as real
        call_command('sync_boeken', '--user', 'reader', '--delay', '0', stdout=StringIO())   # the first run imports
        out = StringIO()
        with mock.patch('shelf.management.commands.sync_boeken.call_command', wraps=real) as imported:
            call_command('sync_boeken', '--user', 'reader', '--delay', '0', stdout=out)
        imported.assert_not_called()
        self.assertEqual(out.getvalue(), '')


class AddToBooklogTests(BooklogCase):
    """A book that is only in the app is added to the booklog when it is asked for."""

    def setUp(self):
        super().setUp()
        for kind, slug in (('categories', 'sf'), ('categories', 'fictie'), ('tags', 'desert')):
            page = self.repo / 'site' / 'content' / kind / slug / '_index.md'
            page.parent.mkdir(parents=True)
            page.write_text(f'---\ntitle: "{slug}"\nslug: "{slug}"\n---\n', encoding='utf-8', newline='')
        git(self.repo, 'add', '.')
        git(self.repo, '-c', 'user.name=T', '-c', 'user.email=t@example.org', 'commit', '--quiet', '-m', 'Categories')

    def scan(self, uid='s1', **data):
        """A scanned book, as the app keeps it, changed long enough ago to be published."""
        when = timezone.now() - timedelta(hours=1)
        book = {'id': uid, 'added': '2026-11-01T10:00:00.000Z', 'title': 'Children of Dune', 'author': 'Frank Herbert',
                'publisher': 'Ace', 'date': '1987', 'pages': 408, 'isbn': '9780441104024',
                'lists': {'library': {'at': '2026-11-01T10:00:00.000Z'}, 'to-read': {'at': '2026-11-01T10:00:00.000Z'}},
                'language': 'en', 'categories': ['sf'], 'tags': ['desert', 'Space opera'], 'boekenWanted': True, **data}
        return Book.objects.create(user=self.user, uid=uid, data=works.upgrade(book), title=book['title'], modified=when, changed=when)

    def test_a_new_book_names_everyone_with_what_they_did(self):
        self.scan(people=[{'name': 'Frank Herbert', 'role': 'tekst'}, {'name': 'Ann Artist', 'role': 'beeld'}, {'name': 'Plain Co-writer', 'role': ''}])
        self.publish()
        post = self.post('children-of-dune')
        self.assertIn('roles:\n  herbert-frank: "tekst"\n  artist-ann: "beeld"\n', post)
        self.assertIn('authors: ["herbert-frank", "artist-ann", "co-writer-plain"]\n', post)

    def test_a_new_audiobook_has_a_length_no_pages_and_no_category(self):
        self.scan(format='audiobook', duration='16u 5m')
        self.publish()
        post = self.post('children-of-dune')
        self.assertIn('format: "audiobook"\nduration: "16u 5m"\n', post)
        self.assertNotIn('pages:', post)
        self.assertIn('categories: ["sf"]\n', post)   # `format` says it is one

    def test_surnames_first(self):
        self.assertEqual(publish.author_slug('Rebecca Yarros'), ('yarros-rebecca', 'Yarros - Rebecca'))
        self.assertEqual(publish.author_slug('Ursula K. Le Guin'), ('le-guin-ursula-k', 'Le Guin - Ursula K.'))
        self.assertEqual(publish.author_slug('Jan van der Meer'), ('van-der-meer-jan', 'van der Meer - Jan'))
        self.assertEqual(publish.author_slug('Plato'), ('plato', 'Plato'))

    def test_a_book_to_read_becomes_a_post_with_its_pages(self):
        self.scan(author='Frank Herbert, Jane Q. Newcomer', series='Dune', seriesNumber=3)
        counts, said = self.publish()
        self.assertEqual(counts['published'], 1)
        self.assertEqual(self.log()[0], 'Te lezen: Children of Dune')
        post = self.post('children-of-dune')
        self.assertTrue(post.startswith('---\ntitle: "Children of Dune"\nseries: ["Dune"]\nseries_number: 3\ndate: '))
        self.assertTrue(post.endswith('slug: "children-of-dune"\npublisher: "Ace"\nyear: 1987\npages: 408\nisbn: "9780441104024"\n'
                                      'language: "en"\nstatus: "to-read"\ncategories: ["sf"]\ntags: ["desert", "space-opera"]\n'
                                      'authors: ["herbert-frank", "newcomer-jane-q"]\n---\n'))
        content = self.repo / 'site' / 'content'
        self.assertEqual((content / 'authors' / 'newcomer-jane-q' / '_index.md').read_text(encoding='utf-8'),
                         '---\ntitle: "Jane Q. Newcomer"\nslug: "newcomer-jane-q"\nwpName: "Newcomer - Jane Q."\n---\n')
        self.assertEqual((content / 'tags' / 'space-opera' / '_index.md').read_text(encoding='utf-8'),
                         '---\ntitle: "Space opera"\nslug: "space-opera"\n---\n')
        self.assertIn('    site/content/posts/children-of-dune.md', said)
        # The book in the app now belongs to that post; importing it back changes nothing that matters.
        book = Book.objects.get(uid='s1').data
        self.assertEqual((book['boeken'], 'boekenWanted' in book), ('children-of-dune', False))
        self.assertRegex(book['url'], r'^https://boeken.tsuk.org/\d{4}/\d{2}/children-of-dune/$')
        self.import_booklog()
        book = works.flat(Book.objects.get(uid='s1').data)
        self.assertEqual(set(book['lists']), {'library', 'to-read'})
        self.assertEqual(book['author'], 'Frank Herbert, Jane Q. Newcomer')
        self.assertEqual(len(Book.objects.get(uid='s1').data['editions']), 1)   # the post is of the copy scanned
        self.assertEqual(Book.objects.filter(user=self.user, deleted=False).count(), 4)
        self.assertEqual(self.publish()[0], {'published': 0, 'settled': 0, 'failed': 0, 'waiting': 0})

    def test_a_book_with_one_edition_and_no_main_keeps_one_edition(self):
        # As the app adds a book (works.js newWork): with one edition it names no main one.
        row = self.scan()
        row.data = {k: v for k, v in row.data.items() if k != 'main'}
        row.save()
        self.publish()
        self.import_booklog()
        data = Book.objects.get(uid='s1').data
        self.assertEqual([e['id'] for e in data['editions']], ['e1'])
        self.assertEqual(works.edition_of(data, 'e1')['people'], [{'name': 'Frank Herbert', 'role': ''}])
        self.assertEqual(self.publish()[0]['published'], 0)

    def test_a_read_book_is_added_with_its_review_and_cover(self):
        own = Path(self.tmp.name, 'covers', 'own')
        own.mkdir(parents=True)
        (own / 'abc.jpg').write_bytes(png(300, 450))
        self.scan(lists={'read': {'at': '2026-11-05T10:00:00.000Z'}}, cover='covers/own/abc-320.webp', coverFull='covers/own/abc.jpg',
                  reviews=[{'id': 'r1', 'date': '2026-11-05', 'rating': 7, 'text': 'The twins. ' * 30}])
        self.publish()
        self.assertEqual(self.log()[0], 'Uitgelezen: Children of Dune')
        post = self.post('children-of-dune')
        self.assertIn('date: 2026-11-05T20:00:00+01:00\nslug: "children-of-dune"\nrating: 7\nreview: true\n', post)
        self.assertNotIn('status:', post)
        self.assertIn('cover: "/wp-content/uploads/2026/11/children-of-dune.jpg"\n', post)
        self.assertTrue((self.repo / 'media/wp-content/uploads/2026/11/children-of-dune.jpg').is_file())
        self.assertTrue(post.rstrip().endswith('The twins.'))
        self.assertEqual(Book.objects.get(uid='s1').data['reviews'][0]['boeken'], 'children-of-dune')

    def test_a_book_being_read_starts_with_its_progress(self):
        self.scan(lists={'reading': {'at': '2026-11-05T10:00:00.000Z'}}, pagesRead=40)
        self.publish()
        self.assertEqual(self.log()[0], 'Lezende: Children of Dune')
        self.assertIn('pages: 408\npagesRead: 40\n', self.post('children-of-dune'))

    def test_a_book_that_lacks_something_waits_and_says_what(self):
        self.scan(language='', categories=[])
        counts, said = self.publish()
        self.assertEqual(counts['failed'], 1)
        self.assertEqual(Book.objects.get(uid='s1').data['boekenError'], 'It needs a language, a category.')
        self.assertFalse((self.repo / 'site/content/posts/children-of-dune.md').exists())
        self.assertEqual(self.log()[0], 'Categories')

    def test_only_what_was_asked_for_is_added(self):
        row = self.scan()
        row.data = {k: v for k, v in row.data.items() if k != 'boekenWanted'}
        row.save()
        self.assertEqual(self.publish()[0], {'published': 0, 'settled': 0, 'failed': 0, 'waiting': 0})

    def test_a_book_that_is_in_the_booklog_and_on_the_shelf_is_not_added_again(self):
        self.scan(title='Dune', isbn='9780441172719')
        counts, said = self.publish()
        self.assertEqual((counts['published'], counts['settled'], counts['failed']), (0, 0, 1))
        self.assertFalse((self.repo / 'site/content/posts/dune-2.md').exists())
        book = Book.objects.get(uid='s1').data
        self.assertEqual(book['boekenError'], 'The booklog already has this book: it is "Dune" on your shelf.')
        self.assertNotIn('boekenWanted', book)      # said once; not tried again
        self.assertNotIn('boeken', book)
        self.assertEqual(self.publish()[0]['failed'], 0)

    def audiobook(self, lists, main=True):
        """Dune (in the booklog, read twice) gets an audiobook edition, and goes on `lists`."""
        def listen(data):
            data['editions'].append({'id': 'audio', 'publisher': 'Macmillan Audio', 'format': 'audiobook', 'duration': '21u 2m',
                                     'people': [{'name': 'Frank Herbert', 'role': ''}, {'name': 'Simon Vance', 'role': 'stem'}]})
            data['lists'] = lists
            if main:
                data['main'] = 'audio'
        self.change('dune', listen, flat=False)

    def test_another_edition_to_read_is_a_reread_in_the_booklog_and_the_same_book_on_the_shelf(self):
        # You read Dune (in the booklog, twice); now you are listening to its audiobook.
        before = {slug: self.post(slug) for slug in ('dune', 'dune-herlezing')}
        self.audiobook({'reading': {'at': '2026-11-14T10:00:00.000Z'}})
        counts, said = self.publish()
        self.assertEqual(counts['published'], 1, said)
        self.assertEqual(self.log()[0], 'Herlezen: Dune')
        post = self.post('dune-herlezing-2')
        self.assertIn('slug: "dune-herlezing-2"\nrereadOf: "dune"\n', post)
        self.assertIn('publisher: "Macmillan Audio"\nformat: "audiobook"\nduration: "21u 2m"\ndurationLeft: "21u 1m"\n', post)
        self.assertIn('roles:\n  simon-vance: "stem"\n'.replace('simon-vance', 'vance-simon'), post)
        self.assertIn('status: "reading"\n', post)
        self.assertNotIn('pagesRead', post)
        self.assertNotIn('pages:', post)
        # The reads before keep their own edition, byte for byte.
        self.assertEqual({slug: self.post(slug) for slug in before}, before)
        # Back from the booklog: one book, its reads, and the audiobook as the edition being read.
        self.import_booklog()
        data = self.book('dune').data
        self.assertEqual(sorted(r['boeken'] for r in data['reviews']), ['dune', 'dune-herlezing'])
        self.assertEqual((data['main'], set(data['lists'])), ('audio', {'reading'}))
        self.assertEqual(works.edition_of(data, 'audio')['duration'], '21u 2m')
        self.assertEqual(Book.objects.filter(user=self.user, deleted=False, title='Dune').count(), 1)
        self.assertEqual(self.publish()[0], {'published': 0, 'settled': 0, 'failed': 0, 'waiting': 0})
        # Finished: its own post is finished, not the e-book's.
        def finish(data):
            data['lists'] = {'read': {'at': '2026-11-20T10:00:00.000Z'}}
            data['reviews'].append({'id': 'r9', 'date': '2026-11-20', 'rating': 8, 'text': 'Vance!', 'ed': 'audio'})
        self.change('dune', finish, flat=False)
        self.publish()
        post = self.post('dune-herlezing-2')
        self.assertNotIn('status:', post)
        self.assertIn('rating: 8\n', post)
        self.assertIn('rating: 10\n', self.post('dune-herlezing'))
        self.import_booklog()
        data = self.book('dune').data
        self.assertEqual([r['ed'] for r in data['reviews']], ['ed-dune', 'ed-dune-herlezing', 'audio'])
        self.assertEqual(self.publish()[0]['published'], 0)

    def test_another_edition_to_read_later(self):
        self.audiobook({'to-read': {'at': '2026-11-14T10:00:00.000Z'}})
        before = self.post('dune-herlezing')
        self.publish()
        self.assertEqual(self.log()[0], 'Herlezen: Dune')
        post = self.post('dune-herlezing-2')
        self.assertIn('status: "to-read"\n', post)
        self.assertIn('format: "audiobook"\n', post)
        self.assertEqual(self.post('dune-herlezing'), before)   # the audiobook's publisher is not written onto the paperback's read
        self.import_booklog()
        self.assertEqual(self.publish()[0]['published'], 0)

    def test_a_dated_read_of_a_new_edition_is_a_reread_in_it(self):
        def listened(data):
            data['editions'].append({'id': 'audio', 'publisher': 'Macmillan Audio', 'format': 'audiobook', 'duration': '21u 2m'})
            data['reviews'].append({'id': 'r3', 'date': '2026-06-01', 'rating': 9, 'text': '', 'ed': 'audio'})
        before = {slug: self.post(slug) for slug in ('dune', 'dune-herlezing')}
        self.change('dune', listened, flat=False)
        self.publish()
        self.assertEqual({slug: self.post(slug) for slug in before}, before)   # the reads before keep their own edition
        post = self.post('dune-herlezing-2')
        self.assertIn('publisher: "Macmillan Audio"\nformat: "audiobook"\nduration: "21u 2m"\n', post)
        self.import_booklog()
        self.assertEqual(self.publish()[0]['published'], 0)

    def test_an_edition_read_twice_changes_on_both_its_posts(self):
        def same(data):   # both reads were of the first read's edition
            data['reviews'][1]['ed'] = data['reviews'][0]['ed']
        self.change('dune', same, flat=False)
        self.publish()
        self.import_booklog()
        self.assertEqual(self.publish()[0]['published'], 0)
        def corrected(data):
            data['editions'][0]['publisher'] = 'Chilton'
        self.change('dune', corrected, flat=False)
        self.publish()
        self.assertIn('publisher: "Chilton"\n', self.post('dune'))
        self.assertIn('publisher: "Chilton"\n', self.post('dune-herlezing'))

    def test_an_edition_nobody_read_publishes_nothing(self):
        self.audiobook({'read': {'at': '2024-05-02T08:00:00.000Z'}}, main=False)
        self.change('dune', lambda data: works.edition_of(data, 'audio').update(publisher='Audible', lists={'library': {'at': 'x'}}), flat=False)
        self.assertEqual(self.publish()[0], {'published': 0, 'settled': 0, 'failed': 0, 'waiting': 0})
        self.assertEqual(self.log()[0], 'Categories')

    def test_deleting_the_reads_of_one_edition_leaves_the_others_first(self):
        self.audiobook({'reading': {'at': '2026-11-14T10:00:00.000Z'}})
        self.publish()
        self.import_booklog()
        def forget_paper(data):
            data['reviews'] = [r for r in data['reviews'] if r['boeken'] not in ('dune', 'dune-herlezing')]
            data['dropReads'] = ['dune', 'dune-herlezing']
            data['editions'] = [e for e in data['editions'] if e['id'] == 'audio']
        self.change('dune', forget_paper, flat=False)
        counts, said = self.publish()
        self.assertEqual(counts['published'], 1, said)
        for slug in ('dune', 'dune-herlezing'):
            self.assertFalse((self.repo / f'site/content/posts/{slug}.md').exists())
        self.assertNotIn('rereadOf', self.post('dune-herlezing-2'))   # the audiobook is the first read now
        self.import_booklog()
        self.assertEqual(Book.objects.filter(user=self.user, deleted=False, title='Dune').count(), 1)
        self.assertEqual(self.book('dune-herlezing-2').data['boeken'], 'dune-herlezing-2')

    def test_a_book_in_another_format_on_the_shelf_twice_is_not_added_again(self):
        # The audiobook was added as a book of its own: that is Dune twice. It is said once, to combine them in the app.
        self.scan(title='Dune', isbn='', format='audiobook', duration='21u 2m')
        counts, said = self.publish()
        self.assertEqual((counts['published'], counts['failed']), (0, 1), said)
        self.assertFalse((self.repo / 'site/content/posts/dune-herlezing-2.md').exists())

    def test_a_book_the_booklog_has_but_the_shelf_lost_is_tied_to_its_post(self):
        # Dune is in the booklog as read, but was deleted from the shelf; the scanned copy is being read again.
        Book.objects.filter(uid='boeken-dune').update(deleted=True, data={})
        self.scan(title='Dune', isbn='9780441172719', lists={'reading': {'at': '2026-11-14T10:00:00.000Z'}})
        counts, said = self.publish()
        self.assertFalse((self.repo / 'site/content/posts/dune-2.md').exists())
        self.assertEqual(Book.objects.get(uid='s1').data['boeken'], 'dune')
        # That it is on Reading now is a change like any other: a reread begins, in the same run.
        self.assertEqual((counts['published'], counts['settled']), (1, 1))
        self.assertEqual(self.log()[0], 'Herlezen: Dune')

    def test_a_second_book_with_the_same_title_gets_its_own_address(self):
        self.scan(title='Dune', author='Another Writer', isbn='9780000000002')
        self.publish()
        self.assertIn('title: "Dune"\n', self.post('dune-2'))


class DropAndFinishTests(BooklogCase):
    """Giving up a book that was to be read, and reviewing one after marking it as read."""

    def drop(self, key, **change):
        """Delete a book as the app does when it is dropped, long enough ago to be published."""
        self.client.force_login(self.user)
        row = self.book(key)
        res = self.client.post('/api/sync', json.dumps({'schema': 2, 'since': None, 'changes': [
            {'id': row.uid, 'modified': timezone.now().isoformat(), 'deleted': True, 'book': None, **change}]}), content_type='application/json')
        self.assertEqual(res.status_code, 200, res.content)
        Book.objects.filter(pk=row.pk).update(modified=timezone.now() - timedelta(hours=1))
        return Book.objects.get(pk=row.pk)

    def test_a_dropped_book_leaves_the_booklog_with_what_only_it_used(self):
        content = self.repo / 'site' / 'content'
        for kind, slug in (('authors', 'unknown-slug'), ('tags', 'only-here')):
            (content / kind / slug).mkdir(parents=True, exist_ok=True)
            (content / kind / slug / '_index.md').write_text(f'---\ntitle: "{slug}"\nslug: "{slug}"\n---\n', encoding='utf-8', newline='')
        post = content / 'posts' / 'gilgamesh.md'
        post.write_text(post.read_text(encoding='utf-8').replace('authors: ["unknown-slug"]', 'tags: ["only-here"]\nauthors: ["unknown-slug", "herbert-frank"]'), encoding='utf-8', newline='')
        git(self.repo, 'add', '.')
        git(self.repo, '-c', 'user.name=T', '-c', 'user.email=t@example.org', 'commit', '--quiet', '-m', 'Pages')
        self.import_booklog()

        row = self.drop('gilgamesh', drop=True)
        self.assertEqual(row.data, {'drop': {'boeken': 'gilgamesh', 'title': 'Gilgamesh', 'posts': ['gilgamesh']}})
        counts, said = self.publish()
        self.assertEqual(counts['published'], 1)
        self.assertEqual(self.log()[0], 'Verwijderd: Gilgamesh')
        self.assertFalse(post.exists())
        self.assertFalse((content / 'authors' / 'unknown-slug').exists())       # nobody else is by this author
        self.assertFalse((content / 'tags' / 'only-here').exists())
        self.assertTrue((content / 'authors' / 'herbert-frank' / '_index.md').exists())   # Dune still is
        self.assertTrue(publish.is_clean(str(self.repo)))
        self.assertEqual(Book.objects.get(pk=row.pk).data, {})                  # done; not tried again
        self.assertEqual(self.publish()[0]['published'], 0)
        self.assertIn('2 books in the booklog', self.import_booklog())          # and the import doesn't bring it back

    def test_deleting_a_book_without_dropping_it_leaves_the_booklog_alone(self):
        row = self.drop('gilgamesh')
        self.assertEqual(row.data, {})
        self.assertEqual(self.publish()[0]['published'], 0)
        self.assertTrue((self.repo / 'site/content/posts/gilgamesh.md').exists())

    def test_a_book_that_was_read_leaves_the_booklog_with_all_its_reads(self):
        row = self.drop('dune', drop=True)
        self.assertEqual(row.data['drop']['posts'], ['dune', 'dune-herlezing'])
        counts, said = self.publish()
        self.assertEqual((counts['published'], counts['failed']), (1, 0), said)
        for slug in ('dune', 'dune-herlezing'):
            self.assertFalse((self.repo / f'site/content/posts/{slug}.md').exists())
        self.assertFalse((self.repo / 'media/wp-content/uploads/2010/03/dune.jpg').exists())
        self.assertEqual(self.log()[0], 'Verwijderd: Dune')
        self.assertTrue(publish.is_clean(str(self.repo)))
        self.assertEqual(Book.objects.get(pk=row.pk).data, {})
        self.assertIn('2 books in the booklog', self.import_booklog())

    def test_a_read_deleted_in_the_app_leaves_the_booklog(self):
        def forget_second(data):
            data['reviews'] = [r for r in data['reviews'] if r['boeken'] != 'dune-herlezing']
            data['dropReads'] = ['dune-herlezing']
        self.change('dune', forget_second)
        self.import_booklog()   # before it is published, the import doesn't bring it back
        self.assertEqual([r['boeken'] for r in self.book('dune').data['reviews']], ['dune'])
        counts, said = self.publish()
        self.assertEqual(counts['published'], 1, said)
        self.assertEqual(self.log()[0], 'Verwijderd: Dune (een lezing)')
        self.assertFalse((self.repo / 'site/content/posts/dune-herlezing.md').exists())
        self.assertTrue((self.repo / 'site/content/posts/dune.md').exists())
        book = self.book('dune').data
        self.assertNotIn('dropReads', book)
        self.assertEqual(book['boeken'], 'dune')
        self.assertEqual(self.publish()[0]['published'], 0)
        self.import_booklog()
        self.assertEqual([r['boeken'] for r in self.book('dune').data['reviews']], ['dune'])

    def test_when_the_first_read_goes_the_next_one_is_the_first(self):
        def forget_first(data):
            data['reviews'] = [r for r in data['reviews'] if r['boeken'] != 'dune']
            data['dropReads'] = ['dune']
            data['title'] = 'Dune!'   # and something else that waits to be published
        self.change('dune', forget_first)
        counts, said = self.publish()
        self.assertEqual(counts['published'], 2, said)
        self.assertEqual(self.log()[:2], ['Bewerkt: Dune!', 'Verwijderd: Dune! (een lezing)'])
        self.assertFalse((self.repo / 'site/content/posts/dune.md').exists())
        post = self.post('dune-herlezing')
        self.assertNotIn('rereadOf', post)
        self.assertIn('title: "Dune!"', post)
        book = self.book('dune-herlezing').data
        self.assertEqual(book['boeken'], 'dune-herlezing')
        self.assertTrue(book['url'].endswith('/dune-herlezing/'))
        self.assertEqual(self.publish()[0]['published'], 0)
        self.import_booklog()
        self.assertEqual(Book.objects.filter(user=self.user, deleted=False, title__startswith='Dune').count(), 1)
        self.assertEqual([r['boeken'] for r in self.book('dune-herlezing').data['reviews']], ['dune-herlezing'])

    def test_a_drop_made_a_moment_ago_can_still_be_undone(self):
        row = self.drop('gilgamesh', drop=True)
        Book.objects.filter(pk=row.pk).update(modified=timezone.now())
        self.assertEqual(self.publish(delay=120)[0], {'published': 0, 'settled': 0, 'failed': 0, 'waiting': 1})
        self.assertTrue((self.repo / 'site/content/posts/gilgamesh.md').exists())

    def test_did_not_finish(self):
        def edit(data):
            del data['lists']['reading']
            data['lists']['abandoned'] = {'at': '2026-11-14T10:00:00.000Z'}
        self.change('katabasis', edit)
        self.publish()
        self.assertEqual(self.log()[0], 'Niet uit: Katabasis')
        self.assertEqual(self.changed_lines('katabasis'), ['+status: "abandoned"', '-status: "reading"'])

    def test_a_review_written_after_marking_as_read_is_of_that_read(self):
        def finish(data):
            del data['lists']['reading']
            data['lists']['read'] = {'at': '2026-11-14T10:00:00.000Z'}
        self.change('katabasis', finish)
        self.publish()
        self.assertEqual(self.log()[0], 'Uitgelezen: Katabasis')
        self.import_booklog()
        placeholder = self.book('katabasis').data['reviews']
        self.assertEqual([(bool(r['date']), r['rating'], r['text']) for r in placeholder], [(True, None, '')])

        # Later the same day: what was thought of it.
        today = placeholder[0]['date']
        self.change('katabasis', lambda data: data['reviews'].append({'id': 'r9', 'date': today, 'rating': 8, 'text': 'Worth the descent.'}))
        counts, said = self.publish()
        self.assertEqual(self.log()[0], 'Bewerkt: Katabasis')                    # not "Herlezen"
        self.assertFalse((self.repo / 'site/content/posts/katabasis-herlezing.md').exists())
        post = self.post('katabasis')
        self.assertIn('rating: 8\n', post)
        self.assertTrue(post.endswith('---\nWorth the descent.\n'))
        self.import_booklog()
        self.assertEqual([(r['id'], r['rating'], r['text']) for r in self.book('katabasis').data['reviews']],
                         [('boeken-katabasis', 8, 'Worth the descent.')])
        self.assertEqual(self.publish()[0]['published'], 0)
