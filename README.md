# Bookscan

A small installable web app (PWA) for cataloguing books with your phone.

1. **Scan** the ISBN barcode on the back cover. The book is looked up in Open Library and
   Google Books and added to your shelf with title, author, publication date, publisher and
   page count. Keep scanning — each hit is added straight away, with *Undo* and *Edit* on the card.
2. **No match?** Photograph the front cover. The text on it is read on the phone and searched
   for in the same catalogues; tap the right result to add it.
3. **Still nothing?** The title and author read from the cover are put in a form for you to
   correct. Every line of text found on the cover is a chip you can tap to fill a field.

Older paperbacks (mostly American) carry a shop barcode (UPC) instead of an ISBN one, with the
ISBN only printed above or below it. The scanner notices this and reads the printed number instead.
Photographing a back cover or copyright page that shows an ISBN works the same way.

You can also type an ISBN or enter a book entirely by hand. Books scanned without a connection
are saved by ISBN and completed automatically once you are back online.

**Export** (the download icon) saves, shares or copies the whole shelf as JSON:

```json
[
  {
    "title": "The Name of the Rose",
    "author": "Umberto Eco",
    "date": "1994-09-28",
    "publisher": "Harcourt Brace",
    "pages": 536,
    "isbn": "9780156001311",
    "cover": "https://covers.openlibrary.org/b/id/…-M.jpg",
    "added": "2026-11-14T12:27:54.748Z"
  }
]
```

## Putting it on your phone

The app is plain static files with no build step. It has to be served over HTTPS for the
camera and for installing.

- **GitHub Pages:** repository *Settings → Pages → Deploy from a branch*, pick the branch and
  `/ (root)`. Open the resulting URL in Chrome on Android and choose *Install app* (also offered
  under the settings icon in the app).
- **Locally:** `python3 -m http.server` in this folder, then open `http://localhost:8000`.

## Accounts and sync (optional)

Without an account everything stays on the phone. With one (settings → *Account*), the shelf is
also kept on the server and can be opened on any other device by signing in there. Changes sync
a moment after you make them, when the app comes back to the foreground, and when you're back
online; if two devices change the same book, the newest change wins. *Sign out & clear* removes
the shelf from that device only.

The server is a small Django app in [`server/`](server): a JSON API (`/api/session`, `/api/login`,
`/api/logout`, `/api/sync`) plus the Django admin at `/admin/`, where accounts are made. There
is no public sign-up.

```bash
cd server
python -m venv venv && venv/bin/pip install -r requirements.txt
export DJANGO_DEBUG=1
venv/bin/python manage.py migrate && venv/bin/python manage.py createcachetable
venv/bin/python manage.py createsuperuser
venv/bin/python manage.py runserver   # serves the app too, at http://localhost:8000
venv/bin/python manage.py test
```

### Production (bookscan.yusupov.cloud)

nginx serves the static app from `/home/django/bookscan-yusupov` and passes `/api/` and
`/admin/` to gunicorn on `127.0.0.1:8030` (systemd unit `bookscan-yusupov`). Settings come from
`server/.env` (`DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`). To deploy the working tree:

```bash
git ls-files -co --exclude-standard | tar -cf - -T - | ssh -p 2708 yusupov 'tar -x -C /home/django/bookscan-yusupov && chown -R django:django /home/django/bookscan-yusupov'
ssh -p 2708 yusupov 'cd /home/django/bookscan-yusupov/server && sudo -u django bash -c "set -a; . ./.env; set +a; venv/bin/pip install -q -r requirements.txt && venv/bin/python manage.py migrate --noinput && venv/bin/python manage.py collectstatic --noinput" && systemctl restart bookscan-yusupov'
```

Bump `SHELL` in `sw.js` whenever the app files change, so installed copies update.

## Good to know

- Your shelf is stored on the device (IndexedDB), and on the server while you're signed in.
  Export now and then to keep a copy of your own.
- Google Books' keyless quota is shared and often exhausted. Open Library still answers, but
  for the best hit rate add a free Google Books API key under the settings icon.
- Cover reading supports English, Dutch, French and German; pick the ones you need in settings.
  The reader (about 10 MB) is downloaded the first time it is used and cached after that.
- Barcode scanning uses the browser's built-in detector on Android and falls back to a
  bundled WebAssembly one elsewhere.

## Layout

| Path | What |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | the whole app |
| `sw.js`, `manifest.webmanifest`, `icons/` | offline support and install metadata |
| `server/` | optional Django sync server (accounts, a copy of each shelf) |
| `fonts/` | Fraunces and Instrument Sans (SIL Open Font License) |
| `vendor/tesseract/` | [tesseract.js](https://github.com/naptha/tesseract.js) 7.0.0 and language data (Apache-2.0) |
| `vendor/barcode/` | [barcode-detector](https://github.com/Sec-ant/barcode-detector) 3.2.3 / zxing-wasm (MIT) |

Icons are from [Lucide](https://lucide.dev) (ISC).
