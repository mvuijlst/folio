"""Gives books scanned before the app asked for it the language of their edition.

    manage.py fill_languages --user NAME [--dry-run] [--pause SECONDS]

For each edition of a book that is only on the shelf (not in the booklog, which says its own
languages) with an ISBN and no language: Open Library's record of that edition is asked, and
where it says none, Google Books; where neither does, the ISBN's registration group (where the
edition was published: 978-90 is Dutch, 978-0 English). What one of them says becomes the
edition's language. A changed
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


# ISBN registration groups that publish in one language, after 978 (979-10 is French too).
GROUPS = [('0', 'en'), ('1', 'en'), ('2', 'fr'), ('3', 'de'), ('90', 'nl'), ('94', 'nl'), ('84', 'es'), ('88', 'it'),
          ('85', 'pt'), ('972', 'pt'), ('989', 'pt'), ('91', 'sv'), ('87', 'da'), ('82', 'no'), ('951', 'fi'), ('952', 'fi'),
          ('83', 'pl'), ('5', 'ru')]


def from_group(isbn):
    if isbn.startswith('97910'):
        return 'fr'
    if not isbn.startswith('978'):
        return ''
    return next((code for prefix, code in sorted(GROUPS, key=lambda g: -len(g[0])) if isbn[3:].startswith(prefix)), '')


def language_of(isbn):
    """→ (language, where it was found: 'catalogue' or 'isbn'), or ('', '')"""
    code = from_open_library(isbn) or from_google(isbn)
    if code:
        return code, 'catalogue'
    code = from_group(isbn)
    return (code, 'isbn') if code else ('', '')


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
        found, unknown, books, by_group = {}, [], 0, 0
        for row in Book.objects.filter(user=account, deleted=False).order_by('pk'):
            data = row.data
            if data.get('boeken') or not isinstance(data.get('editions'), list):
                continue
            changed = False
            for edition in data['editions']:
                isbn = str(edition.get('isbn') or '')
                if edition.get('language') or not isbn:
                    continue
                code, source = language_of(isbn)
                if pause:
                    time.sleep(pause)
                by_group += source == 'isbn'
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
                          f"{by_group} of them only by the ISBN's registration group; "
                          f'{len(unknown)} editions whose language is not known')
        for line in unknown:
            self.stdout.write(f'  not known: {line}')
