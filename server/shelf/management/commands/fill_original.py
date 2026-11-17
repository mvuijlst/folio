"""Gives books the language they were first written in, and their title in that language.

    manage.py fill_original --user NAME [--write] [--assistant] [--limit N] [--report FILE]

Without --write nothing is stored: it says what it found, and with --report writes every book it
found something for to a file (tab-separated: source, edition language, original language,
title, original title), to read before writing.

For each book without `originalLanguage` (shelf/original.py says where it comes from):
  1. its Open Library work id (`olid`) is looked up on Wikidata. A book that only the app has
     and has no olid, but an ISBN, gets its olid from Open Library first (a booklog book's olid
     is the booklog's: it isn't set here, only used);
  2. Open Library's record of its ISBN, when it says the edition is a translation;
  3. with --assistant, the assistant, forty books at a time (each question costs a little on the
     server's OpenAI account). What it doesn't know stays empty.
The booklog doesn't hear of these fields (publishing only compares the facts it tracks), so
nothing is published. A changed book keeps its `modified` (an edit made on a device since still
wins) and gets a new `changed`, so every device fetches it. Repeatable: a book that has a
language is left alone.
"""
import time

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from shelf import intake, original, works
from shelf.models import Book

BATCH = 40


class Command(BaseCommand):
    help = 'Fill in the language books were first written in (and their title then), from Wikidata, Open Library and optionally the assistant.'

    def add_arguments(self, parser):
        parser.add_argument('--user', required=True)
        parser.add_argument('--write', action='store_true', help='store what was found (default: only say it)')
        parser.add_argument('--assistant', action='store_true', help='ask the assistant for books no catalogue knows')
        parser.add_argument('--limit', type=int, default=0, help='at most this many books (for a trial)')
        parser.add_argument('--pause', type=float, default=0.3, help='seconds between Open Library requests')
        parser.add_argument('--report', help='write what was found to this file')

    def handle(self, *args, **opts):
        try:
            user = get_user_model().objects.get(username=opts['user'])
        except get_user_model().DoesNotExist:
            raise CommandError(f'No user {opts["user"]}')
        rows = [r for r in Book.objects.filter(user=user, deleted=False).order_by('id') if not r.data.get('originalLanguage')]
        if opts['limit']:
            rows = rows[:opts['limit']]
        self.stdout.write(f'{len(rows)} books without an original language')

        def facts(row):
            main = works.main_edition(row.data) or {}
            return {'title': row.data.get('title') or '', 'author': row.data.get('author') or '',
                    'language': main.get('language') or '', 'isbn': main.get('isbn') or '',
                    'known_as': [row.data.get('title')] + [e.get('title') for e in row.data.get('editions') or []]}

        info = {r.uid: facts(r) for r in rows}
        olids = {r.uid: r.data.get('olid') for r in rows if original.OLID.fullmatch(str(r.data.get('olid') or ''))}
        results, new_olids = {}, {}

        # Open Library: the work of an ISBN, and whether the edition says it is a translation.
        for r in rows:
            if r.uid in olids or not info[r.uid]['isbn']:
                continue
            work, said = original.from_open_library(info[r.uid]['isbn'])
            time.sleep(opts['pause'])
            if work:
                olids[r.uid] = work
                if not r.data.get('boeken'):
                    new_olids[r.uid] = work
            if said and (hit := original.found(said['language'], said['title'], info[r.uid]['known_as'])):
                results[r.uid] = ('open library', hit)
        self.stdout.write(f'{len(olids)} with an Open Library work id ({len(new_olids)} found now)')

        known = original.from_wikidata(olids.values())
        for uid, olid in olids.items():
            if uid not in results and olid in known:
                hit = original.found(known[olid]['language'], known[olid]['title'], info[uid]['known_as'])
                if hit:
                    results[uid] = ('wikidata', hit)

        if opts['assistant']:
            left = [r for r in rows if r.uid not in results]
            for i in range(0, len(left), BATCH):
                batch = [{'id': r.uid, **{k: info[r.uid][k] for k in ('title', 'author', 'language')}} for r in left[i:i + BATCH]]
                try:
                    said = original.ask(batch)
                except intake.IntakeError as err:
                    self.stderr.write(f'The assistant failed for books {i + 1}–{i + len(batch)}: {err}')
                    continue
                for uid, hit in said.items():
                    hit = original.found(hit['language'], hit['title'], info[uid]['known_as'])
                    if hit:
                        results[uid] = ('assistant', hit)
                self.stdout.write(f'  asked about {min(i + BATCH, len(left))} of {len(left)}')

        by_source, translated = {}, 0
        lines = []
        for r in rows:
            if r.uid not in results:
                continue
            source, hit = results[r.uid]
            by_source[source] = by_source.get(source, 0) + 1
            other = hit['language'] != info[r.uid]['language']
            translated += other
            lines.append('\t'.join([source, info[r.uid]['language'] or '-', hit['language'], info[r.uid]['title'], hit['title']]))
        self.stdout.write(f'Found for {len(results)}: ' + ', '.join(f'{n} from {s}' for s, n in sorted(by_source.items()))
                          + f'; {translated} read in another language than they were written in; '
                          + f'{len(rows) - len(results)} left without')
        if opts['report']:
            with open(opts['report'], 'w', encoding='utf-8') as out:
                out.write('source\tedition\toriginal\ttitle\toriginal title\n' + '\n'.join(lines) + '\n')
            self.stdout.write(f'Written to {opts["report"]}')

        if not opts['write']:
            self.stdout.write('Nothing stored (dry run; --write to store).')
            return
        now = timezone.now()
        stored = 0
        for r in rows:
            if r.uid not in results and r.uid not in new_olids:
                continue
            fresh = Book.objects.get(pk=r.pk)   # as it is now: a device may have synced meanwhile
            if fresh.deleted or fresh.data.get('originalLanguage'):
                continue
            data = dict(fresh.data)
            if r.uid in results:
                hit = results[r.uid][1]
                data['originalLanguage'] = hit['language']
                if hit['title']:
                    data['originalTitle'] = hit['title']
            if r.uid in new_olids and not data.get('olid') and not data.get('boeken'):
                data['olid'] = new_olids[r.uid]
            fresh.data, fresh.changed = data, now
            fresh.save(update_fields=['data', 'changed'])
            stored += 1
        self.stdout.write(f'Stored for {stored} books.')
