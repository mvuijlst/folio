"""Cover images kept on the server, as small WebP files next to the app.

Book catalogues hand out cover addresses that are slow, sometimes vanish, and come in any
size; the booklog's covers are full-size originals. So the server keeps a copy of its own
of every cover, 320 pixels wide and in its original proportions, in covers/ (served as
plain files). A book's `cover` then points at that copy ("covers/web/….webp"), `coverRatio`
says how wide it is for its height, and `coverSource` remembers where it came from.
"""
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
MAX_BYTES = 8_000_000
TIMEOUT = 6            # seconds, per download
RETRY_AFTER = 7 * 24 * 3600   # a cover that couldn't be fetched is left alone for a week

# Only these are ever asked for an image: the catalogues the app looks books up in, and the booklog.
HOSTS = {'books.google.com', 'books.googleusercontent.com', 'covers.openlibrary.org', 'boeken.tsuk.org'}


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
    return [url]


def download(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'Folio/1 (cover thumbnails)'})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError('too large')
    return data


def keep(url):
    """Fetch the cover at `url` unless we already have it. → ('covers/web/….webp', ratio) or None."""
    name = hashlib.sha1(url.encode()).hexdigest()[:16] + f'-{WIDTH}.webp'
    target = folder('web') / name
    if target.exists():
        return f'covers/web/{name}', ratio_of(target)
    failed = 'cover-failed:' + name
    if cache.get(failed):
        return None
    for address in candidates(url):
        try:
            return f'covers/web/{name}', write_thumbnail(download(address), target)
        except (urllib.error.URLError, OSError, ValueError):
            continue
    cache.set(failed, 1, RETRY_AFTER)
    return None


def adopt(user, limit=4):
    """Give up to `limit` of this user's books a server-kept cover. Returns the books changed.

    Called after each sync, so a shelf's covers come over a few at a time without anyone
    waiting for them, and by the fetch_covers command for all of them at once.
    """
    from .models import Book   # models import nothing from here, but keep this module importable without Django's app registry

    changed = []
    # A few at random each time, so covers that can't be fetched never hold up the rest.
    pending = Book.objects.filter(user=user, deleted=False, data__cover__startswith='https://')
    for book in (pending.order_by('?')[:limit * 3] if limit else pending):
        url = book.data.get('cover')
        if not wanted(url):
            continue
        if limit and len(changed) >= limit:
            break
        kept = keep(url)
        if not kept:
            continue
        # The book may have been synced again while the image was on its way.
        fresh = Book.objects.get(pk=book.pk)
        if fresh.deleted or fresh.data.get('cover') != url:
            continue
        fresh.data = {**fresh.data, 'cover': kept[0], 'coverRatio': kept[1], 'coverSource': url}
        fresh.changed = timezone.now()   # `modified` stays: nobody edited the book
        fresh.save(update_fields=['data', 'changed'])
        changed.append(fresh)
    return changed
