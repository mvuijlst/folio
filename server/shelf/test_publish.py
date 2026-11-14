"""Publishing from the app to the booklog, against a throwaway booklog with a remote of its own."""
import subprocess
import tempfile
from datetime import timedelta
from io import StringIO
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone

from shelf import boeken, publish
from shelf.models import Book
from shelf.test_boeken import POSTS, make_repo, png


def git(folder, *args):
    done = subprocess.run(['git', *args], cwd=folder, capture_output=True, text=True, encoding='utf-8')
    assert done.returncode == 0, done.stderr
    return done.stdout


class PublishTests(TestCase):
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

    def change(self, key, edit):
        """Change a book as the app would, long enough ago to be published."""
        row = self.book(key)
        data = {**row.data, 'reviews': [dict(r) for r in row.data.get('reviews') or []], 'lists': dict(row.data['lists'])}
        edit(data)
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

    # ── tests

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
        book = self.book('katabasis').data
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
        self.assertIn('3 unchanged', self.import_booklog())

    def test_a_new_cover_goes_into_the_media_folder(self):
        own = Path(self.tmp.name, 'covers', 'own')
        own.mkdir(parents=True)
        (own / 'abc.jpg').write_bytes(png(300, 450))
        self.change('gilgamesh', lambda data: data.update(cover='covers/own/abc-320.webp', coverFull='covers/own/abc.jpg'))
        self.publish()
        self.assertIn('cover: "/wp-content/uploads/2026/11/gilgamesh.jpg"\n', self.post('gilgamesh'))
        self.assertEqual((self.repo / 'media/wp-content/uploads/2026/11/gilgamesh.jpg').read_bytes(), png(300, 450))

    def test_a_cover_that_has_not_reached_the_server_waits(self):
        self.change('dune', lambda data: data.update(cover='', thumb='data:image/jpeg;base64,xxxx'))
        self.assertEqual(self.publish()[0], {'published': 0, 'settled': 0, 'failed': 0, 'waiting': 0})
        self.assertTrue(publish.is_pending(self.book('dune').data))    # still to come
        self.assertIn('1 waiting to be published', self.import_booklog())
        self.assertEqual(self.book('dune').data['cover'], '')          # the import left the app's choice alone

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
        book = self.book('gilgamesh').data
        self.assertEqual((list(book['lists']), book['title']), (['reading'], 'Gilgamesj'))

    def test_a_dry_run_says_what_it_would_do_and_does_nothing(self):
        self.change('dune', lambda data: data['reviews'][0].update(rating=1))
        counts, said = self.publish(dry_run=True)
        self.assertEqual(counts['published'], 1)
        self.assertEqual(said, ['Bewerkt: Dune', '    site/content/posts/dune.md'])
        self.assertEqual(self.log(), ['The booklog'])
        self.assertTrue(publish.is_pending(self.book('dune').data))

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
        self.assertEqual(self.book('dune').data['rating'], 10)   # the book's rating is still its latest read's
