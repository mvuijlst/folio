"""Gives books the language they were first written in, and their title in that language.

    manage.py fill_original --user NAME [--assistant] [--report FILE] [--write] [--limit N]
    manage.py fill_original --user NAME --apply FILE

For each book without `originalLanguage` (shelf/original.py says where it comes from):
  1. Open Library's record of its ISBN: its work, when the book has no `olid` yet (a booklog
     book's olid is the booklog's: it isn't set here, only used), and whether the edition says it
     is a translation;
  2. its Open Library work on Wikidata;
  3. with --assistant, the assistant, forty books a question, about every book, also those a
     catalogue knows: where both answer and differ, the report says so. Each question costs a
     little on the server's OpenAI account.
What a catalogue says goes first; else what the assistant says; else nothing.

Without --write nothing is stored. --report writes every book asked about to a tab-separated
file: its id, title, writers, the language it was read in, its format, whether it is in the
booklog, what the catalogue and the assistant said, the `language` and `original title` that
would be stored, a new olid, and why it may need a look (`doubt`: translated, unknown,
disagree). That file, read and corrected, is what --apply stores: its `language` and `original
title` columns, as they are, for every row that has a language (the rest is left alone).

The booklog doesn't hear of these fields (publishing only compares the facts it tracks), so
nothing is published. A changed book keeps its `modified` (an edit made on a device since still
wins) and gets a new `changed`, so every device fetches it. A book that has a language by then
is left alone.
"""
import csv
import time
from concurrent.futures import ThreadPoolExecutor

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from shelf import intake, original, works
from shelf.models import Book

BATCH = 40
COLUMNS = ['id', 'title', 'author', 'read in', 'format', 'booklog', 'catalogue', 'assistant', 'language', 'original title', 'new olid', 'doubt']


class Command(BaseCommand):
    help = 'Fill in the language books were first written in (and their title then), from Wikidata, Open Library and optionally the assistant.'

    def add_arguments(self, parser):
        parser.add_argument('--user', required=True)
        parser.add_argument('--write', action='store_true', help='store what was found (default: only say it)')
        parser.add_argument('--assistant', action='store_true', help='also ask the assistant, about every book')
        parser.add_argument('--no-catalogues', action='store_true',
                            help="don't ask Open Library and Wikidata (slow: seconds a book, and Wikidata's query service may be down)")
        parser.add_argument('--limit', type=int, default=0, help='at most this many books (for a trial)')
        parser.add_argument('--pause', type=float, default=0.3, help='seconds between Open Library requests')
        parser.add_argument('--report', help='write what was found to this file')
        parser.add_argument('--apply', help='store the language and original title of each row of this file (a report, corrected)')

    def handle(self, *args, **opts):
        try:
            self.user = get_user_model().objects.get(username=opts['user'])
        except get_user_model().DoesNotExist:
            raise CommandError(f'No user {opts["user"]}')
        if opts['apply']:
            return self.apply(opts['apply'])
        rows = [r for r in Book.objects.filter(user=self.user, deleted=False).order_by('id') if not r.data.get('originalLanguage')]
        if opts['limit']:
            rows = rows[:opts['limit']]
        self.stdout.write(f'{len(rows)} books without an original language')

        def facts(row):
            main = works.main_edition(row.data) or {}
            return {'title': row.data.get('title') or '', 'author': row.data.get('author') or '',
                    'language': main.get('language') or '', 'isbn': main.get('isbn') or '', 'format': main.get('format') or '',
                    'known_as': [row.data.get('title')] + [e.get('title') for e in row.data.get('editions') or []]}

        info = {r.uid: facts(r) for r in rows}
        olids = {r.uid: r.data.get('olid') for r in rows if original.OLID.fullmatch(str(r.data.get('olid') or ''))}
        catalogue, said_by_assistant, new_olids = {}, {}, {}

        # Open Library: the work of an ISBN, and whether the edition says it is a translation. A
        # few at a time: it is slow to answer, and sometimes doesn't.
        asking = [] if opts['no_catalogues'] else [r for r in rows if r.uid not in olids and info[r.uid]['isbn']]
        self.stdout.write(f'Asking Open Library about {len(asking)} ISBNs')

        def ask_open_library(r):
            answer = original.from_open_library(info[r.uid]['isbn'])
            time.sleep(opts['pause'])
            return r, answer
        with ThreadPoolExecutor(4) as pool:
            answers = list(pool.map(ask_open_library, asking))
        for r, (work, said) in answers:
            if work:
                olids[r.uid] = work
                if not r.data.get('boeken'):
                    new_olids[r.uid] = work
            if said and (hit := original.found(said['language'], said['title'], info[r.uid]['known_as'])):
                catalogue[r.uid] = ('open library', hit)
        self.stdout.write(f'{len(olids)} with an Open Library work id ({len(new_olids)} found now)')

        self.stdout.write('Asking Wikidata')
        known = {} if opts['no_catalogues'] else original.from_wikidata(olids.values())
        for uid, olid in olids.items():
            if uid not in catalogue and olid in known:
                hit = original.found(known[olid]['language'], known[olid]['title'], info[uid]['known_as'])
                if hit:
                    catalogue[uid] = ('wikidata', hit)
        self.stdout.write(f'Wikidata and Open Library know {len(catalogue)}')

        if opts['assistant']:
            # Four questions at a time: each takes the model a while.
            batches = [[{'id': r.uid, **{k: info[r.uid][k] for k in ('title', 'author', 'language')}} for r in rows[i:i + BATCH]]
                       for i in range(0, len(rows), BATCH)]

            def ask(batch):
                try:
                    return batch, original.ask(batch), None
                except intake.IntakeError as err:
                    return batch, {}, err
            done = 0
            with ThreadPoolExecutor(4) as pool:
                for batch, said, err in pool.map(ask, batches):
                    done += len(batch)
                    if err:
                        self.stderr.write(f'The assistant failed for {len(batch)} books: {err}')
                    for uid, hit in said.items():
                        hit = original.found(hit['language'], hit['title'], info[uid]['known_as'])
                        if hit:
                            said_by_assistant[uid] = hit
                    self.stdout.write(f'  asked the assistant about {done} of {len(rows)}')

        results, report, counts = {}, [], {'translated': 0, 'unknown': 0, 'disagree': 0}
        for r in rows:
            cat, ai = catalogue.get(r.uid), said_by_assistant.get(r.uid)
            chosen = cat[1] if cat else ai
            if chosen:
                results[r.uid] = chosen
            doubt = []
            if not chosen:
                doubt.append('unknown')
            elif chosen['language'] != info[r.uid]['language']:
                doubt.append('translated')
            if cat and ai and cat[1]['language'] != ai['language']:
                doubt.append('disagree')
            for d in doubt:
                counts[d] += 1
            report.append({
                'id': r.uid, 'title': info[r.uid]['title'], 'author': info[r.uid]['author'], 'read in': info[r.uid]['language'],
                'format': info[r.uid]['format'], 'booklog': 'yes' if r.data.get('boeken') else '',
                'catalogue': f"{cat[1]['language']} ({cat[0]})" if cat else '', 'assistant': ai['language'] if ai else '',
                'language': chosen['language'] if chosen else '', 'original title': chosen['title'] if chosen else '',
                'new olid': new_olids.get(r.uid, ''), 'doubt': ', '.join(doubt)})
        self.stdout.write(f'Found for {len(results)} of {len(rows)}: {counts["translated"]} read in another language than '
                          f'they were written in, {counts["disagree"]} where the catalogue and the assistant differ, '
                          f'{counts["unknown"]} nobody knows')
        if opts['report']:
            with open(opts['report'], 'w', encoding='utf-8', newline='') as out:
                writer = csv.DictWriter(out, COLUMNS, delimiter='\t')
                writer.writeheader()
                writer.writerows(report)
            self.stdout.write(f'Written to {opts["report"]}')

        if not opts['write']:
            self.stdout.write('Nothing stored (dry run; --write to store, or --apply a corrected report).')
            return
        self.store({uid: (hit['language'], hit['title'], new_olids.get(uid, '')) for uid, hit in results.items()}
                   | {uid: ('', '', olid) for uid, olid in new_olids.items() if uid not in results})

    def apply(self, path):
        with open(path, encoding='utf-8-sig', newline='') as f:
            rows = list(csv.DictReader(f, delimiter='\t'))
        missing = {'id', 'language', 'original title'} - set(rows[0] if rows else {})
        if missing:
            raise CommandError(f'{path} lacks the columns {", ".join(sorted(missing))}')
        wanted = {}
        for row in rows:
            language = str(row.get('language') or '').strip().lower()
            if language and not original.CODE.fullmatch(language):
                raise CommandError(f'“{language}” (for {row.get("title")}) is no language code')
            if language or (row.get('new olid') or '').strip():
                wanted[row['id']] = (language, ' '.join(str(row.get('original title') or '').split()), (row.get('new olid') or '').strip())
        self.stdout.write(f'{len(wanted)} rows to store')
        self.store(wanted)

    def store(self, wanted):
        """uid → (language, original title, new olid): stored on books that have no language yet."""
        now, stored = timezone.now(), 0
        for row in Book.objects.filter(user=self.user, uid__in=list(wanted), deleted=False):
            if row.data.get('originalLanguage'):
                continue   # set meanwhile, on a device or by hand: that stays
            language, title, olid = wanted[row.uid]
            data = dict(row.data)
            if language:
                data['originalLanguage'] = language
                known = [data.get('title')] + [e.get('title') for e in data.get('editions') or []]
                if title and not any(original.same_title(title, k) for k in known if k):
                    data['originalTitle'] = title
            if olid and original.OLID.fullmatch(olid) and not data.get('olid') and not data.get('boeken'):
                data['olid'] = olid
            if data != row.data:
                row.data, row.changed = data, now
                row.save(update_fields=['data', 'changed'])
                stored += 1
        self.stdout.write(f'Stored for {stored} books.')
