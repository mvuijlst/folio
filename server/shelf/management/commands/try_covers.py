"""How well does the assistant recognise a book from its cover? A trial on covers whose book is known.

    manage.py try_covers /path/to/boeken [--n 30] [--seed 1] [--models a,b] [--as photo|file|both]
    manage.py try_covers --list-models

It takes books from the booklog that have a cover, shows the model the cover alone, and
compares the title and author it names with the booklog's. `--as photo` first makes the
cover look like a phone photograph (turned a little, on a table, blurred, compressed), which
is what the app sends; `file` sends the clean image. `--models` tries several models on the
same covers (default: the one the server is set up with). It asks the model once per cover
and per model, so it costs what that many questions cost; nothing is stored.
"""
import io
import json
import random
import time
import urllib.request
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from shelf import boeken, intake


def words(text):
    return [w for w in intake.plain(str(text or '')).split() if w]


def same_title(expected, got):
    """The same title, give or take a subtitle, an article or a series prefix."""
    want, have = words(str(expected).split(':')[0]), words(got)
    if not want or not have:
        return False
    if ' '.join(want) in ' '.join(have) or ' '.join(words(str(got).split(':')[0])) in ' '.join(words(expected)):
        return True
    small = {'the', 'a', 'an', 'de', 'het', 'een', 'of', 'and', 'en', 'van'}
    a, b = set(want) - small, set(have) - small
    return bool(a) and len(a & b) / len(a | b) >= 0.6


def same_author(expected, got):
    """One of the booklog's authors is among those the model named (by surname)."""
    named = {words(name)[-1] for name in got if words(name)}
    return any(words(name) and words(name)[-1] in named for name in expected)


def as_photo(source, seed):
    """The cover as a phone would photograph it: turned, on a table, soft, compressed."""
    from PIL import Image, ImageEnhance, ImageFilter
    rng = random.Random(seed)
    cover = Image.open(source).convert('RGB')
    cover.thumbnail((900, 900))
    table = Image.new('RGB', (int(cover.width * 1.5), int(cover.height * 1.35)), (rng.randint(90, 150), rng.randint(70, 120), rng.randint(50, 90)))
    turned = cover.convert('RGBA').rotate(rng.uniform(-9, 9), expand=True, resample=Image.BICUBIC)
    table.paste(turned, ((table.width - turned.width) // 2, (table.height - turned.height) // 2), turned)
    table = ImageEnhance.Brightness(table).enhance(rng.uniform(0.75, 1.1)).filter(ImageFilter.GaussianBlur(rng.uniform(0.6, 1.4)))
    out = io.BytesIO()
    table.save(out, 'JPEG', quality=62)
    return out.getvalue()


class Command(BaseCommand):
    help = 'Try the assistant on covers of known books (asks the model: costs a little).'

    def add_arguments(self, parser):
        parser.add_argument('repo', nargs='?', help='path of a checkout of mvuijlst/boeken')
        parser.add_argument('--n', type=int, default=30, help='how many covers')
        parser.add_argument('--seed', type=int, default=1, help='which covers: the same seed picks the same ones')
        parser.add_argument('--models', default='', help='comma-separated; default: the configured model')
        parser.add_argument('--as', dest='shape', choices=('photo', 'file', 'both'), default='photo')
        parser.add_argument('--effort', default='', help="how long the model may think: 'low', 'medium', … (default: its own)")
        parser.add_argument('--list-models', action='store_true', help='list the models this key can ask, and stop')
        parser.add_argument('--save', help='folder to write the photographs that were sent, to look at')

    def handle(self, repo, n, seed, models, shape, effort, list_models, save, **options):
        if not settings.OPENAI_API_KEY:
            raise CommandError('The assistant is not set up here (no OPENAI_API_KEY).')
        if list_models:
            request = urllib.request.Request('https://api.openai.com/v1/models', headers={'Authorization': f'Bearer {settings.OPENAI_API_KEY}'})
            with urllib.request.urlopen(request, timeout=30) as response:
                names = sorted(m['id'] for m in json.load(response)['data'])
            self.stdout.write(f'configured: {settings.OPENAI_MODEL}\n' + '\n'.join(names))
            return
        if not repo:
            raise CommandError('Give the path of the boeken repository.')

        booklog = intake.Booklog(repo)
        books = [b for b in boeken.books(repo) if b['cover_file'] and b['fields'].get('author')]
        random.Random(seed).shuffle(books)
        books = books[:n]
        models = [m.strip() for m in models.split(',') if m.strip()] or [settings.OPENAI_MODEL]
        shapes = ['photo', 'file'] if shape == 'both' else [shape]
        if save:
            Path(save).mkdir(parents=True, exist_ok=True)

        for model in models:
            for how in shapes:
                right = title_only = wrong = nothing = failed = 0
                tokens_in = tokens_out = 0
                seconds = []
                thinking = f', effort {effort}' if effort else ''
                self.stdout.write(f'\n== {model}{thinking}, covers as {how} ({len(books)}) ==')
                for i, book in enumerate(books):
                    fields = book['fields']
                    expected = [a.strip() for a in fields['author'].split(',')]
                    image = as_photo(book['cover_file'], seed * 1000 + i) if how == 'photo' else book['cover_file'].read_bytes()
                    if save and how == 'photo' and model == models[0]:
                        Path(save, f'{i:02d}.jpg').write_bytes(image)
                    started = time.monotonic()
                    try:
                        answer, usage = intake.ask('', booklog.categories, image, model=model, effort=effort or None)
                    except intake.IntakeError as err:
                        failed += 1
                        self.stdout.write(f'  ERROR  {fields["title"]!r}: {err}')
                        if failed >= 3 and failed == i + 1:
                            self.stdout.write('  (giving up on this model)')
                            break
                        continue
                    seconds.append(time.monotonic() - started)
                    tokens_in += usage.get('prompt_tokens', 0)
                    tokens_out += usage.get('completion_tokens', 0)
                    first = answer[0] if answer else None
                    got_title = first['title'] if first else ''
                    got_authors = [a.get('name', '') for a in (first or {}).get('authors') or []]
                    title_ok = bool(first) and same_title(fields['title'], got_title)
                    author_ok = bool(first) and same_author(expected, got_authors)
                    if not first:
                        nothing += 1
                        mark = 'NONE  '
                    elif title_ok and author_ok:
                        right += 1
                        mark = 'ok    '
                    elif title_ok or author_ok:
                        title_only += 1
                        mark = 'HALF  '
                    else:
                        wrong += 1
                        mark = 'WRONG '
                    line = f'  {mark} {fields["title"]!r} / {fields["author"]!r}'
                    if mark.strip() != 'ok':
                        line += f'  →  {got_title!r} / {", ".join(got_authors)!r}'
                    self.stdout.write(line)
                asked = len(seconds)
                if asked:
                    seconds.sort()
                    self.stdout.write(
                        f'  -- {right}/{asked} right, {title_only} half (title or author only), {wrong} wrong, {nothing} not recognised, {failed} errors'
                        f' | median {seconds[asked // 2]:.1f}s, slowest {seconds[-1]:.1f}s'
                        f' | tokens per cover: {tokens_in // asked} in, {tokens_out // asked} out')
