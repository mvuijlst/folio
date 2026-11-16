"""Gives books scanned before the app asked for it the language of their edition.

    manage.py fill_languages --user NAME [--dry-run] [--pause SECONDS]

For each edition of a book that is only on the shelf (not in the booklog, which says its own
languages) with an ISBN and no language: Open Library's record of that edition is asked, and
where it says none, Google Books. What either says becomes the edition's language. A changed
book keeps its `modified` (an edit made on a device since still wins) and gets a new `changed`,
so every device fetches it. Repeatable: what has a language is not asked again, and what no
catalogue knows is reported.
"""
import json
import time
import urllib.parse
import urllib.request

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from shelf.models import Book

# Open Library names a language by its MARC code; the shelf, like the booklog, by two letters.
MARC = {'eng': 'en', 'dut': 'nl', 'fre': 'fr', 'ger': 'de', 'spa': 'es', 'ita': 'it', 'por': 'pt', 'swe': 'sv', 'dan': 'da',
        'nor': 'no', 'fin': 'fi', 'pol': 'pl', 'rus': 'ru', 'lat': 'la', 'gre': 'el', 'jpn': 'ja', 'chi': 'zh', 'afr': 'af', 'fry': 'fy'}
AGENT = {'User-Agent': 'Folio/2 (language of a scanned book)'}


def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=AGENT), timeout=10) as res:
        return json.loads(res.read().decode('utf-8'))


def from_open_library(isbn):
    try:
        data = fetch(f'https://openlibrary.org/isbn/{isbn}.json')
    except Exception:
        return ''
    key = str(((data.get('languages') or [{}])[0] or {}).get('key') or '').rsplit('/', 1)[-1]
    return MARC.get(key, '')


def from_google(isbn):
    query = urllib.parse.urlencode({'q': f'isbn:{isbn}', 'maxResults': 1, 'fields': 'items(volumeInfo(language))'})
    try:
        data = fetch(f'https://www.googleapis.com/books/v1/volumes?{query}')
    except Exception:
        return ''
    code = str((((data.get('items') or [{}])[0] or {}).get('volumeInfo') or {}).get('language') or '')
    return code if len(code) == 2 and code.isalpha() and code.islower() else ''


def language_of(isbn):
    return from_open_library(isbn) or from_google(isbn)


class Command(BaseCommand):
    help = 'Fill in the language of scanned editions that have none, from Open Library or Google Books (repeatable).'

    def add_arguments(self, parser):
        parser.add_argument('--user', required=True, help='whose shelf')
        parser.add_argument('--dry-run', action='store_true', help='look the languages up and say what would change; change nothing')
        parser.add_argument('--pause', type=float, default=0.5, help='seconds between lookups (default 0.5), to be kind to the catalogues')

    def handle(self, user, dry_run, pause, **options):
        try:
            account = get_user_model().objects.get(username=user)
        except get_user_model().DoesNotExist:
            raise CommandError(f'There is no user "{user}".')
        found, unknown, books = {}, [], 0
        for row in Book.objects.filter(user=account, deleted=False).order_by('pk'):
            data = row.data
            if data.get('boeken') or not isinstance(data.get('editions'), list):
                continue
            changed = False
            for edition in data['editions']:
                isbn = str(edition.get('isbn') or '')
                if edition.get('language') or not isbn:
                    continue
                code = language_of(isbn)
                if pause:
                    time.sleep(pause)
                if not code:
                    unknown.append(f'{row.title or isbn} ({isbn})')
                    continue
                edition['language'] = code
                found[code] = found.get(code, 0) + 1
                changed = True
            if changed:
                books += 1
                if not dry_run:
                    # The record as it is now, in case a device saved it while the lookups ran.
                    fresh = Book.objects.get(pk=row.pk)
                    if fresh.deleted or fresh.modified != row.modified:
                        continue
                    fresh.data = data
                    fresh.changed = timezone.now()
                    fresh.save(update_fields=['data', 'changed'])
        said = ', '.join(f'{n} {code}' for code, n in sorted(found.items(), key=lambda kv: -kv[1])) or 'none'
        self.stdout.write(('Would be: ' if dry_run else 'Done: ') + f'{books} books given a language ({said}); '
                          f'{len(unknown)} editions no catalogue knows the language of')
        for line in unknown:
            self.stdout.write(f'  not known: {line}')
