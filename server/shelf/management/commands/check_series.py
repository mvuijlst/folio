"""Asks Hardcover again about the series still running, and keeps what is new.

    manage.py check_series --user NAME [--write]

A series' record (a term of kind "series", app.js seriesFacts) holds what Hardcover said of it
(`hardcover`: id, volumes, checked, running, news). For each one `running` (the app sets it while the
series is marked neither `complete` nor `doneWith`; those are skipped here too), the volumes are
asked again (shelf/hardcover.py); a volume Hardcover didn't have before is added to `news` (its ids),
which the app shows quietly on the series page and at the head of Series until the page is seen. The
record keeps its `modified` and gets a new `changed`, so every device fetches it. Run monthly by
folio-series-check.timer (setup-series-check.sh). Without --write it only says what it found.
"""
import time

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from shelf import hardcover
from shelf.models import Term


class Command(BaseCommand):
    help = 'Ask Hardcover again about the series marked still running; keep their new volumes.'

    def add_arguments(self, parser):
        parser.add_argument('--user', required=True, help='whose series')
        parser.add_argument('--write', action='store_true', help='keep what was found (without it: only say)')

    def handle(self, user, write, **options):
        try:
            account = get_user_model().objects.get(username=user)
        except get_user_model().DoesNotExist:
            raise CommandError(f'There is no user "{user}".')
        checked = news_total = 0
        for term in Term.objects.filter(user=account, deleted=False).order_by('pk'):
            data = term.data or {}
            hc = data.get('hardcover') if data.get('kind') == 'series' else None
            if not isinstance(hc, dict) or not hc.get('running') or not hc.get('id') or data.get('complete') or data.get('doneWith'):
                continue
            try:
                fresh = hardcover.series(hc['id'])
            except hardcover.Unavailable as err:
                self.stderr.write(f'{data.get("value")}: Hardcover did not answer ({err})')
                continue
            time.sleep(1)
            checked += 1
            if not fresh:
                self.stdout.write(f'{data.get("value")}: Hardcover no longer has series {hc["id"]}')
                continue
            known = {v.get('id') for v in hc.get('volumes') or []}
            new = [v for v in fresh['volumes'] if v['id'] not in known]
            news_total += len(new)
            for v in new:
                self.stdout.write(f'{data.get("value")}: new, #{v["n"]} {v["title"]} ({v.get("year") or "no date"})')
            if write:
                hc = {**hc, 'volumes': fresh['volumes'], 'count': fresh['books_count'], 'completed': fresh['completed'],
                      'checked': timezone.now().date().isoformat(),
                      'news': list(dict.fromkeys([*(hc.get('news') or []), *(v['id'] for v in new)]))}
                data = {**data, 'hardcover': hc}
                # Its length grows with what is new (one marked complete isn't asked).
                highest = max((v['n'] for v in fresh['volumes'] if isinstance(v.get('n'), int)), default=0)
                if highest > (data.get('total') or 0):
                    data['total'] = highest
                term.data = data
                term.changed = timezone.now()
                term.save(update_fields=['data', 'changed'])
        self.stdout.write(f'Checked {checked} series: {news_total} new volumes.' + ('' if write else ' Nothing was kept (--write).'))
