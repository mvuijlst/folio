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
  On a wide screen the lists sit in a sidebar; on a phone they are a row of tabs. Every list or
  series you open is a step in the browser's history: Back returns to the one before.

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
- **Editions.** A read is of an edition: the paperback the first time, the audiobook the
  next. Each review carries the edition that was read (publisher, year, pages or length, ISBN,
  language and its own cover), under *Edition read* in the review's form; a new read starts
  from the book's own edition, so only what differs needs saying. A book's page shows each
  read with its cover and edition. In the covers view a book read in several editions shows
  their covers standing together, the latest in front, with its rating in stars; on a series'
  page also its number and when it was read.
- **Series.** Books that share a series name form a series: *Series* in the navigation lists
  them all, and a series page shows its books in order. Set the series and its number in a
  book's details; a number such as 4.5 sorts between 4 and 5.
- **Changing a cover.** In a book's details, tap the cover to choose a picture (on a phone:
  camera or gallery), or paste or drop one while no text field has the cursor; *Paste* reads
  the clipboard where there is no Ctrl+V. The server keeps a large copy and a small one.
- **Covers are kept on the server.** For signed-in users the server fetches a copy of each
  cover that comes from a book catalogue (Open Library, Google Books), a few per sync, as a
  320-pixel WebP in `covers/web/`, and the book then points at that copy. `manage.py
  fetch_covers` does a whole shelf at once. Covers you photographed yourself already travel
  with the book.

## The assistant

Where the server has one (see *Accounts and sync*), a second button beside *Scan a book* adds
books from a description: a title, an author, a series, in your own words (*the new Kuang*,
*Commonwealth Saga*, *Piranesi van Susanna Clarke*). The assistant answers with proposals:
title, authors, series and number, publisher, year, pages, the language, categories from the
booklog's own list, a few tags and one dry sentence about the book. For each, Open Library is
asked for the ISBN and cover, and only believed when title and author really match; series,
tags and authors are matched with what the booklog already has. You tick the ones you want,
choose the lists they go on, and they are added like any scanned book; with a reading status
they can go to the booklog in the same move.

The same assistant sits behind *Suggest* in *Add to boeken.tsuk.org*: it fills in language,
categories, tags and the sentence for a book you already have. Nothing it proposes is saved
or published until you say so. This is boeggn's intake, with its prompt.

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
  booklog. Every read becomes a **review** of the book: the day it was read, the rating, the
  text (Hugo shortcodes for images and videos become plain Markdown) and the **edition** that
  read's post describes, with that post's own cover. A book that is not read
  yet gets its note as a review without a date.
- A booklog book that is already on the shelf (same ISBN) is joined with it and keeps its other
  lists and notes. A booklog book deleted in the app stays deleted.
- Covers are written as small images to `covers/boeken/` next to the app (the booklog's own are
  full-size) and served as plain files.
- The import and publishing (below) keep out of each other's way: whatever was changed in the
  app and is not published yet is left as the app has it; everything else follows the booklog.
  Other lists, notes and scanned books are never touched.

### Publishing back to the booklog

What is changed in the app about a booklog book is written back to the booklog, so
boeken.tsuk.org follows without anyone editing Markdown:

```bash
venv/bin/python manage.py sync_boeken --user NAME --dry-run   # say what would be published
venv/bin/python manage.py sync_boeken --user NAME             # fetch, publish, push, import
```

| In the app | In the booklog |
| --- | --- |
| a review is edited | its post gets the new text, rating and reading date (a date in another month keeps the old address as an alias) |
| the edition of a read is changed | that read's own post gets the publisher, year, pages or length, ISBN, language and cover |
| *To read* → *Reading* | the post's status, with progress started |
| the page reached changes (on the book's page) | `pagesRead` and a line in `progressLog` |
| a book being read gets a dated review, or moves to *Read* | the post is finished: no status, the reading date, rating and text |
| a read book gets another dated review, or moves back to *Reading* | a new post, a reread of the first, with the edition read that time |
| title, series, publisher, year, pages or ISBN change | the front matter (title and series on every read of the book) |
| the cover is replaced | the picture goes into `media/` and the post points at it |

- **Only what changed is written.** Posts are edited line by line, as boeggn did, never
  re-serialised; a post nobody touched in the app stays byte for byte as it was. Each book is
  one commit, worded as the booklog's always were (*Uitgelezen: …*, *Voortgang … (p. 210)*).
- **Checked first.** Every post touched goes through the booklog's own `scripts/check_books.py`;
  what it turns down is not committed, and the book's page in the app says why.
- **Not at once.** A book is published once it has been left alone for two minutes
  (`--delay`), so a tap on the wrong list can be undone before it is public.
- **Not yet:** a review without a reading date on a book that is already read stays in the app.

### Adding a book to the booklog

A book that is only in the app (scanned, typed in) is never published by itself. Its page has
*Add to boeken.tsuk.org*, which asks what a post there needs: where you are with it (*To read*,
*Reading* or *Read*), the language of the edition, one or more of the booklog's categories, and
optionally tags. Saying yes there is what makes the book public; a few minutes later it has a
post of its own, and from then on it is a booklog book like the others.

- The post gets the book's title, authors, series, publisher, year, pages, ISBN and cover. A
  read book takes its first dated review along: reading date, rating and text. A book being
  read starts at the page the app has for it.
- Authors are matched to the booklog's author pages by name; an author it doesn't have yet
  gets a page, filed by surname (*Ursula K. Le Guin* → `le-guin-ursula-k`). New tags and a new
  series get their pages too. Categories are the booklog's own, fixed set.
- The cover is the picture you gave the book, or the catalogue's cover fetched once more at
  full size.
- A book the booklog already has (same ISBN, or the same title by the same author) is not
  added a second time: the app says which book on your shelf it is.

Settings, in `server/.env`: `BOEKEN_REPO_PATH` (a clone of the booklog that only this server
writes to, outside the web root), `BOEKEN_GIT_AUTHOR` (`Name <address>` for its commits) and
`BOEKEN_PUSH=1` (without it commits are made but not pushed, so nothing is public). For the
assistant: `OPENAI_API_KEY` and `OPENAI_MODEL`; without a key the app does not offer it. On the
server a systemd timer runs `sync_boeken` every two minutes.

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
