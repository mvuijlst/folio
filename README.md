# Folio

A personal book catalogue and reading log, as an installable web app (PWA). It keeps your
books on lists, follows what you are reading and how far along you are, holds a review and an
edition for every time you read a book, and can publish all of that to a booklog website.

It runs at [folio.yusupov.cloud](https://folio.yusupov.cloud).

## Status

Folio is a personal project, used every day by its author, with one deployment. The app itself
works for anyone: it needs no account and keeps your shelf on your device. The optional server
is built for that one deployment: accounts are made by hand in the Django admin (there is no
sign-up), and publishing goes to one particular Hugo booklog,
[boeken.tsuk.org](https://boeken.tsuk.org). Every push to `main` deploys. There are no
releases, the app has no automated tests (the server has), and no license has been chosen yet.

## What it does

- **Adding books.** Scan the ISBN barcode with the phone's camera (older paperbacks with only a
  shop barcode work too), photograph the cover, describe the book in a few words, share a page
  to it from another app (a bookshop, Goodreads, Audible), type an ISBN, or fill it in by hand.
  Books are looked up in Open Library, Google Books and Audible's catalogue; where the server
  has an assistant (a language model), it reads photographed covers and descriptions.
- **Lists.** *To read*, *Reading*, *Read* and *Did not finish* are built in, with progress in
  pages, time left or a percentage. Any other lists you like (*Library*, *Lent out*, a
  wishlist, where the books stand), some of them either-or, some with a note per book.
- **Reads, reviews and editions.** A book can be read more than once, each read with its date,
  rating, a review in Markdown and the edition read (paper, e-book or audiobook, with its own
  cover and people). Series, authors and others with their roles, language, categories, tags.
- **Finding and changing.** Filters, orders, three views (list, covers, cards), and editing
  many books at once.
- **Covers.** Taken from the catalogues, photographed and straightened, pasted or shared in.
- **Offline** once installed, in English or Dutch, with an export of the whole shelf as JSON.
- **With the server (optional):** accounts and sync between devices, covers kept on the
  server, the assistant, and two-way sync with the booklog: its books are imported, and what
  changes in the app is published back to it as commits.

## Trying it

The app is plain static files with no build step:

```bash
python3 -m http.server
```

then open <http://localhost:8000>. For the camera and for installing it has to be served over
HTTPS. The sync server is a small Django app in [`server/`](server).

## Documentation

- [Using Folio](docs/using.md): everything the app does, screen by screen
- [Running Folio](docs/server.md): hosting, the sync server, production and updates
- [The booklog](docs/booklog.md): importing from and publishing to boeken.tsuk.org
- [Working on Folio](docs/development.md): layout of the repository, translations, the icon and
  its colours, releasing

## Credits

Fonts: Fraunces and Instrument Sans (SIL Open Font License). Cover reading:
[tesseract.js](https://github.com/naptha/tesseract.js) (Apache-2.0). Barcode fallback:
[barcode-detector](https://github.com/Sec-ant/barcode-detector) / zxing-wasm (MIT). Interface
icons: [Lucide](https://lucide.dev) (ISC).

Folio began as *Bookscan*, which is why a few internal names still say so.
