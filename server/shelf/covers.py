"""Cover images kept on the server, as small WebP files next to the app.

Book catalogues hand out cover addresses that are slow, sometimes vanish, and come in any
size; the booklog's covers are full-size originals. So the server keeps a copy of its own
of every cover, 320 pixels wide and in its original proportions, in covers/ (served as
plain files). An edition's `cover` then points at that copy ("covers/web/….webp"), `coverRatio`
says how wide it is for its height, and `coverSource` remembers where it came from.

It keeps a large copy too (`coverFull`, a JPEG of at most FULL on its longest side), so a cover
can always be seen large from the server itself: in the app, in a public library, and for the
booklog. A cover the user supplied has had one from the start; a catalogue's or the booklog's
gets one when it is fetched, and the ones from before that are fetched again a few at a time
(adopt) or all at once (manage.py fetch_covers).
"""
import base64
import hashlib
import io
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

WIDTH = 320            # shown at up to about 110 px wide, on screens of up to three device pixels per pixel
FULL = 1600            # longest side of the large copy kept of every cover
MAX_BYTES = 8_000_000
TIMEOUT = 6            # seconds, per download
RETRY_AFTER = 7 * 24 * 3600   # a cover that couldn't be fetched is left alone for a week

# Only these are ever asked for an image: the catalogues the app looks books up in, and the booklog.
HOSTS = {'books.google.com', 'books.googleusercontent.com', 'covers.openlibrary.org', 'boeken.tsuk.org', 'm.media-amazon.com'}


def folder(kind):
    return Path(settings.COVERS_DIR, kind)


def write_thumbnail(source, target):
    """Save `source` (a path or the bytes of an image) as a WebP of at most WIDTH wide.

    Returns its width divided by its height. Never enlarges and never crops.
    """
    from PIL import Image, ImageOps

    with Image.open(io.BytesIO(source) if isinstance(source, bytes) else source) as image:
        image = ImageOps.exif_transpose(image).convert('RGB')
        if image.width < 20 or image.height < 20:
            raise ValueError('not a cover (a placeholder pixel)')
        image.thumbnail((WIDTH, WIDTH * 4))
        target.parent.mkdir(parents=True, exist_ok=True)
        partial = target.with_suffix('.part')
        image.save(partial, 'WEBP', quality=78)
        partial.replace(target)
        return round(image.width / image.height, 3)


def write_full(data, target):
    """Save the bytes of an image as a JPEG of at most FULL on its longest side. Never enlarges."""
    from PIL import Image, ImageOps

    with Image.open(io.BytesIO(data)) as image:
        image = ImageOps.exif_transpose(image).convert('RGB')
        if image.width < 20 or image.height < 20:
            raise ValueError('not a cover (a placeholder pixel)')
        image.thumbnail((FULL, FULL))
        target.parent.mkdir(parents=True, exist_ok=True)
        partial = target.with_suffix('.part')
        image.save(partial, 'JPEG', quality=90)
        partial.replace(target)


def ratio_of(path):
    from PIL import Image

    with Image.open(path) as image:
        return round(image.width / image.height, 3)


def wanted(url):
    """Is this a cover address the server should fetch a copy of?"""
    if not isinstance(url, str) or not url.startswith('https://'):
        return False
    return urlsplit(url).hostname in HOSTS


def candidates(url):
    """The addresses to try for a cover, best first."""
    if urlsplit(url).hostname == 'covers.openlibrary.org':
        # Ask for the large size, and for a 404 rather than a blank pixel when there is none.
        base = url.split('?')[0]
        large = base.replace('-M.jpg', '-L.jpg').replace('-S.jpg', '-L.jpg')
        return [f'{u}?default=false' for u in dict.fromkeys([large, base])]
    if urlsplit(url).hostname in ('books.google.com', 'books.googleusercontent.com') and 'fife=' not in url:
        # Google hands out small thumbnails; the same address gives a larger one when asked.
        return [f'{url}&fife=w1200' if '?' in url else f'{url}?fife=w1200', url]
    return [url]


def download(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'Folio/1 (cover thumbnails)'})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError('too large')
    return data


def keep(url):
    """Fetch the cover at `url` unless we already have it, small and large.
    → ('covers/web/….webp', ratio, 'covers/web/….jpg') or None."""
    stem = hashlib.sha1(url.encode()).hexdigest()[:16]
    target, big = folder('web') / f'{stem}-{WIDTH}.webp', folder('web') / f'{stem}.jpg'
    small, large = f'covers/web/{target.name}', f'covers/web/{big.name}'
    if target.exists() and big.exists():
        return small, ratio_of(target), large
    failed = 'cover-failed:' + target.name
    if cache.get(failed):
        return None
    for address in candidates(url):   # the large size first
        try:
            data = download(address)
            ratio = ratio_of(target) if target.exists() else write_thumbnail(data, target)
            write_full(data, big)
            return small, ratio, large
        except (urllib.error.URLError, OSError, ValueError):
            continue
    cache.set(failed, 1, RETRY_AFTER)
    return None


def keep_upload(data):
    """A cover the user supplied (pasted, dropped, chosen or photographed), as image bytes.

    It is re-encoded, never stored as sent: a JPEG of at most FULL on its longest side, and
    the usual small WebP. → {'cover', 'coverFull', 'coverRatio'}; ValueError if it isn't a picture.
    """
    name = hashlib.sha1(data).hexdigest()[:16]
    full, small = folder('own') / f'{name}.jpg', folder('own') / f'{name}-{WIDTH}.webp'
    try:
        if not full.exists():
            write_full(data, full)
        ratio = ratio_of(small) if small.exists() else write_thumbnail(full, small)
    except ValueError:
        raise
    except Exception as err:   # not an image, a truncated one, one too large to open safely, …
        raise ValueError('not a picture') from err
    return {'cover': f'covers/own/{small.name}', 'coverFull': f'covers/own/{full.name}', 'coverRatio': ratio}


def keep_from(url):
    """A cover from a book catalogue that the user picked, kept as one they supplied: large, for
    the booklog, and small. → keep_upload's dict with `coverSource`; ValueError when it can't be had."""
    if not wanted(url):
        raise ValueError('not a cover address')
    for address in candidates(url):
        try:
            return {**keep_upload(download(address)), 'coverSource': url}
        except (urllib.error.URLError, OSError, ValueError):
            continue
    raise ValueError('that cover could not be fetched')


def original(book):
    """The best picture the server can get of a book's cover, for the booklog. → (bytes, '.jpg') or None

    A cover the user supplied is kept large already. One that came from a book catalogue is
    only kept small, so it is fetched once more at its full size; failing that, the small
    copy has to do.
    """
    from PIL import Image

    base = Path(settings.COVERS_DIR).parent
    full = base / str(book.get('coverFull') or '-')
    if book.get('coverFull') and full.is_file():
        return full.read_bytes(), '.jpg'
    data = None
    if wanted(book.get('coverSource')):
        for address in candidates(book['coverSource']):
            try:
                data = download(address)
                break
            except (urllib.error.URLError, OSError, ValueError):
                continue
    small = base / str(book.get('cover') or '-')
    if data is None and str(book.get('cover') or '').startswith('covers/') and small.is_file():
        data = small.read_bytes()
    if data is None:
        return None
    try:
        with Image.open(io.BytesIO(data)) as image:
            image = image.convert('RGB')
            if image.width < 20 or image.height < 20:
                return None
            image.thumbnail((FULL, FULL))
            out = io.BytesIO()
            image.save(out, 'JPEG', quality=90)
            return out.getvalue(), '.jpg'
    except Exception:
        return None


def places(data):
    """Where a book keeps covers: each of its editions (a book in the old shape: the book itself)."""
    editions = data.get('editions')
    return [e for e in editions if isinstance(e, dict)] if isinstance(editions, list) and editions else [data]


def adopt(user, limit=4):
    """Give up to `limit` of this user's editions a server-kept cover. Returns the books changed.

    Called after each sync, so a shelf's covers come over a few at a time without anyone
    waiting for them, and by the fetch_covers command for all of them at once.
    """
    from django.db.models import TextField
    from django.db.models.functions import Cast

    from .models import Book   # models import nothing from here, but keep this module importable without Django's app registry

    changed = {}
    # Narrowed in SQL to books whose text has such a cover somewhere; decided per edition here.
    books = Book.shelf(user).annotate(text=Cast('data', TextField()))

    def save(fresh):
        fresh.changed = timezone.now()   # `modified` stays: nobody edited the book
        fresh.save(update_fields=['data', 'changed'])
        changed[fresh.pk] = fresh

    # A few at random each time, so covers that can't be fetched never hold up the rest.
    pending = books.filter(text__contains='"cover": "https://')
    done = 0
    for book in (pending.order_by('?')[:limit * 3] if limit else pending):
        for i, place in enumerate(places(book.data)):
            url = place.get('cover')
            if not str(url or '').startswith('https://') or not wanted(url):
                continue
            if limit and done >= limit:
                break
            kept = keep(url)
            if not kept:
                continue
            done += 1
            # The book may have been synced again while the image was on its way.
            fresh = Book.objects.get(pk=book.pk)
            spots = places(fresh.data)
            if fresh.deleted or i >= len(spots) or spots[i].get('cover') != url:
                continue
            spots[i].update(cover=kept[0], coverRatio=kept[1], coverSource=url, coverFull=kept[2])
            save(fresh)

    # A cover set in the app while offline (or photographed in the scanner) travels inside the
    # edition as a small picture, `thumb`. Those get a file of their own as well.
    inside = books.filter(text__contains='"thumb": "data:image/')
    for book in inside:
        if limit and done >= limit:
            break
        for i, place in enumerate(places(book.data)):
            thumb = place.get('thumb')
            if place.get('cover') or not str(thumb or '').startswith('data:image/'):
                continue
            if limit and done >= limit:
                break
            try:
                kept = keep_upload(base64.b64decode(thumb.split(',', 1)[1]))
            except (ValueError, IndexError):
                continue
            done += 1
            fresh = changed.get(book.pk) or Book.objects.get(pk=book.pk)
            spots = places(fresh.data)
            if fresh.deleted or i >= len(spots) or spots[i].get('cover') or spots[i].get('thumb') != thumb:
                continue
            spots[i].update(kept)
            save(fresh)
    # A cover kept here from before the server kept large ones too (or one the booklog import
    # made small): its large copy, fetched once more from where it came from.
    # Once nothing is left, that is remembered for an hour: no going through the whole shelf at
    # every sync for nothing (a new catalogue cover gets its large copy as it is fetched, above).
    later, more, caught_up = 0, False, f'covers-large-done:{user.pk}'
    smallonly = books.filter(text__contains='"coverSource": "https://')
    for book in ([] if limit and cache.get(caught_up) else smallonly.order_by('?') if limit else smallonly):
        if more:
            break
        for i, place in enumerate(places((changed.get(book.pk) or book).data)):
            url = place.get('coverSource')
            if place.get('coverFull') or not str(place.get('cover') or '').startswith('covers/') or not wanted(url):
                continue
            if limit and later >= limit:
                more = True   # left for the next sync (one that can't be fetched now doesn't count)
                break
            kept = keep(url)
            if not kept:
                continue
            later += 1
            fresh = changed.get(book.pk) or Book.objects.get(pk=book.pk)
            spots = places(fresh.data)
            if fresh.deleted or i >= len(spots) or spots[i].get('coverSource') != url or spots[i].get('coverFull'):
                continue
            spots[i]['coverFull'] = kept[2]
            save(fresh)
    if limit and not more:
        cache.set(caught_up, 1, 3600)
    return list(changed.values())
