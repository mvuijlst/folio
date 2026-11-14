# Folio

A small installable web app (PWA) for keeping your books on lists (your library, to read,
reading, read, lent out, and any others you make) and adding them by scanning with your phone.
It lives at [folio.yusupov.cloud](https://folio.yusupov.cloud) and began as *Bookscan*, which
is why the repository and a few internal names are still called that.

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

## Lists

Every book can be on any number of lists. The app starts with *Library*, *To read*, *Reading*,
*Read* and *Lent out*; *Edit lists* adds, renames, reorders and deletes them.

- **Either-or sets.** Lists in the same set exclude each other: putting a book on *Read* takes
  it off *To read* and *Reading*. A list on its own (*Library*, *Lent out*) can hold any book,
  whatever else it is on. Which set a list belongs to, if any, is chosen when editing the list.
- **Notes.** A list can ask for a note per book. *Lent out* asks who it was lent to; the note
  shows on the book and is searchable.
- **Putting books on lists.** Open a book and tap its lists. Or scan: the pill at the top of
  the scanner says which lists scanned books go on (the open list, or the ones you picked last
  time). Scanning a book you already have puts it on those lists too, so scanning onto
  *Lent out* or *Read* is the quick way to move a pile of books.
- Each list has its own address (`#/list/read`), so it can be bookmarked or opened directly.
  On a wide screen the lists sit in a sidebar; on a phone they are a row of tabs.

Books scanned before lists existed count as being in the *Library*.

## Views, covers and reviews

- **Three views** of every list, chosen with the buttons beside the search box: the *list*
  (as it always was), *covers* (a shelf of covers with their ratings, grouped by year) and
  *cards* (larger cover, details, lists and the start of the latest review, grouped by month).
- **Covers keep their own proportions**: a square audiobook cover is square, everywhere.
- **Tapping a book opens its page**: cover, details, the lists it is on and its reviews.
  *Edit details* leads to the form with its fields and lists.
- **Reviews.** A book can have any number, each with an optional reading date and an optional
  rating from 0 to 10, written in Markdown (emphasis, links, quotes, lists, images). The rating
  shown in lists is that of the latest review that gives one. Reviews are searched too.
- **Covers are kept on the server.** For signed-in users the server fetches a copy of each
  cover that comes from a book catalogue (Open Library, Google Books), a few per sync, as a
  320-pixel WebP in `covers/web/`, and the book then points at that copy. `manage.py
  fetch_covers` does a whole shelf at once. Covers you photographed yourself already travel
  with the book.

## Export

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
    "added": "2026-11-14T12:27:54.748Z",
    "lists": [
      { "list": "Library", "since": "2026-11-14T12:27:54.748Z" },
      { "list": "Lent out", "since": "2026-11-20T18:02:11.000Z", "note": "Jan" }
    ],
    "rating": 9,
    "reviews": [
      { "date": "2026-11-30", "rating": 9, "text": "Markdown, *as written*." }
    ]
  }
]
```

## Language

The app is in English or Dutch: settings → *Language*. By default it follows the device. The
standard lists are shown in that language too (*Te lezen*, *Lezende*, *Gelezen*, …) until you
rename them. Dutch lives in [`lang-nl.js`](lang-nl.js), a dictionary from the English sentences
in the code; another language is another such file plus a line in `LANGS` and `DICTIONARIES`
in `app.js`.

## Putting it on your phone

The app is plain static files with no build step. It has to be served over HTTPS for the
camera and for installing.

- **GitHub Pages:** repository *Settings → Pages → Deploy from a branch*, pick the branch and
  `/ (root)`. Open the resulting URL in Chrome on Android and choose *Install app* (also offered
  under the settings icon in the app).
- **Locally:** `python3 -m http.server` in this folder, then open `http://localhost:8000`.

## Accounts and sync (optional)

Without an account everything stays on the phone. With one (settings → *Account*), the shelf
and its lists are also kept on the server and can be opened on any other device by signing in
there. Changes sync a moment after you make them, when the app comes back to the foreground,
and when you're back online; if two devices change the same book or the same list, the newest
change wins. *Sign out & clear* removes the shelf from that device only.

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

### Production (folio.yusupov.cloud)

nginx serves the static app from `/home/django/folio-yusupov` and passes `/api/` and
`/admin/` to gunicorn on `127.0.0.1:8030` (systemd unit `folio-yusupov`). Settings come from
`server/.env` (`DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`). A push deploys both the app and the
sync server (see *Updating*); the deploy user `django` may restart only that unit
(`/etc/sudoers.d/folio-deploy`).

The old address, bookscan.yusupov.cloud, serves the same files and the same accounts, with a
notice at the top that points to the new one (`MOVED` in `app.js`). A shelf lives in the
browser per address, so it only comes along by signing in at the new address. Once nobody
opens the old address any more, its nginx site can become a redirect.

## The booklog (boeken.tsuk.org)

The books of the booklog at [boeken.tsuk.org](https://boeken.tsuk.org) (the
[mvuijlst/boeken](https://github.com/mvuijlst/boeken) repository) can be brought into an
account's shelf:

```bash
cd server
venv/bin/python manage.py import_boeken /path/to/boeken --user NAME --dry-run   # what would happen
venv/bin/python manage.py import_boeken /path/to/boeken --user NAME
venv/bin/python manage.py import_boeken --user NAME --remove                    # undo
```

- Each post becomes a book on *To read*, *Reading* or *Read* (or *Abandoned*, a list that is
  made when first needed), dated as in the booklog. A reread is the same book, not a second one.
- A book comes with its rating, series, how far along it is, and a link to its page in the
  booklog. Every read becomes a **review** of the book: the day it was read, the rating and the
  text (Hugo shortcodes for images and videos become plain Markdown). A book that is not read
  yet gets its note as a review without a date.
- A booklog book that is already on the shelf (same ISBN) is joined with it and keeps its other
  lists and notes. A booklog book deleted in the app stays deleted.
- Covers are written as small images to `covers/boeken/` next to the app (the booklog's own are
  full-size) and served as plain files.
- **For now the booklog is the source**: run the import again and titles, ratings and reading
  status are set from it once more, overwriting changes made to those in the app. Other lists,
  notes and scanned books are never touched, and neither are reviews written in the app or
  booklog reviews that were edited in the app. On the server the booklog's checkout is the one
  boeggn keeps, `/home/django/boeggn-yusupov/repo`.

## Updating

Pushing to the repository deploys to the server (`.github/workflows/deploy.yml`, which lists the
secrets it needs): it copies the files whose content changed and, where the sync server is set up,
installs its requirements, migrates and restarts it. Otherwise replace the files on the server by
hand; nothing else is needed for the app. An installed copy compares its cached
files with the server each time it is opened (and when it returns to the foreground), and
restarts itself into the new version within a few seconds. If you are in the middle of
something it shows *A new version is ready · Reload* instead. The running version is shown at
the bottom of the settings sheet; bump `APP_VERSION` in `app.js` when you release.

Do not uninstall the app to update it: Android offers to clear the site's data along with it,
and that deletes the shelf.

## Good to know

- Your shelf is stored on the device (IndexedDB: one database for books, one for lists), and
  on the server while you're signed in. The server keeps each book and each list as the app
  sent it; the lists a book is on travel inside the book.
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
| `lang-nl.js` | the app's text in Dutch |
| `sw.js`, `manifest.webmanifest`, `icons/` | offline support and install metadata |
| `server/` | optional Django sync server (accounts, a copy of each shelf and its lists), and the booklog import |
| `covers/` | cover images kept by the server: `boeken/` from the import, `web/` from the catalogues (not in the repository) |
| `fonts/` | Fraunces and Instrument Sans (SIL Open Font License) |
| `vendor/tesseract/` | [tesseract.js](https://github.com/naptha/tesseract.js) 7.0.0 and language data (Apache-2.0) |
| `vendor/barcode/` | [barcode-detector](https://github.com/Sec-ant/barcode-detector) 3.2.3 / zxing-wasm (MIT) |

Icons are from [Lucide](https://lucide.dev) (ISC).
