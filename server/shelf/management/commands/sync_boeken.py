"""Keeps the app and the booklog in step, both ways.

    manage.py sync_boeken --user NAME [--dry-run] [--delay SECONDS] [--no-pull]

In this order, in the server's own clone of the booklog (BOEKEN_REPO_PATH):

  1. fetch what others pushed (boeggn, an edit at a desk);
  2. publish what was changed in the app: one commit per book (shelf/publish.py);
  3. push, if BOEKEN_PUSH=1, which is what makes boeken.tsuk.org rebuild;
  4. import the booklog, so what others changed reaches the app (import_boeken) — skipped
     when the booklog is at the commit that was imported last and nothing was published,
     which is nearly every run: the import reads every post and every cover.

Meant to be run every few minutes by a timer. It says nothing when there was nothing to do.
"""
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError

from shelf import publish


class Command(BaseCommand):
    help = 'Publish app changes to the booklog and import the booklog\'s changes (repeatable).'

    def add_arguments(self, parser):
        parser.add_argument('--user', required=True, help='whose shelf is the booklog')
        parser.add_argument('--dry-run', action='store_true', help='say what would be published; change nothing')
        parser.add_argument('--delay', type=int, default=120,
                            help='leave a book alone until it has been unchanged for this many seconds (default 120)')
        parser.add_argument('--no-pull', action='store_true', help='don\'t fetch from the booklog first (for a clone without a remote)')
        parser.add_argument('--verbose', action='store_true', help='report even when nothing happened')

    def handle(self, user, dry_run, delay, no_pull, verbose, **options):
        repo = settings.BOEKEN_REPO
        if not repo:
            raise CommandError('BOEKEN_REPO_PATH is not set: there is no booklog to publish to.')
        try:
            account = get_user_model().objects.get(username=user)
        except get_user_model().DoesNotExist:
            raise CommandError(f'There is no user "{user}".')

        try:
            if not publish.is_clean(repo):
                raise CommandError(f'{repo} has uncommitted changes; not touching it.')
            if not no_pull:
                publish.pull(repo)
            lines = []
            counts = publish.run(account, repo, delay=delay, dry_run=dry_run, say=lines.append)
            unpushed = publish.ahead(repo) if not no_pull else 0
            pushed = False
            if unpushed and settings.BOEKEN_PUSH and not dry_run:
                publish.push(repo)
                pushed = True
        except publish.RepoError as err:
            raise CommandError(str(err))

        happened = any(counts[key] for key in ('published', 'settled', 'failed')) or pushed
        if happened or verbose or dry_run:
            for line in lines:
                self.stdout.write(line)
            self.stdout.write(('Would be: ' if dry_run else 'Done: ')
                              + ', '.join(f'{n} {what}' for what, n in counts.items())
                              + (f'; pushed {unpushed} commit(s)' if pushed
                                 else f'; {unpushed} commit(s) not pushed (BOEKEN_PUSH is off)' if unpushed and not dry_run else ''))

        # The booklog as it now is, with whatever others changed, back into the app.
        head = publish.git(repo, 'rev-parse', 'HEAD').strip()
        seen = f'boeken-imported:{account.pk}'
        if happened or dry_run or cache.get(seen) != head:
            import_out = self.stdout if (happened or verbose or dry_run) else open_null()
            call_command('import_boeken', repo, user=user, dry_run=dry_run, stdout=import_out, stderr=self.stderr)
            if not dry_run:
                cache.set(seen, head, None)


def open_null():
    import io
    return io.StringIO()
