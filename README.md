# Folio

A personal book catalogue and reading log, as an installable web app (PWA). It keeps your
books on lists, follows what you are reading and how far along you are, holds a review and an
edition for every time you read a book. What you have read can go to a free reading site
(StoryGraph, BookWyrm, Hardcover, LibraryThing, Goodreads); on the author's own server it is
also published to their booklog website.

It runs at [folio.yusupov.cloud](https://folio.yusupov.cloud).

## Status

Folio is a personal project, used every day by its author, with one deployment. The app itself
works for anyone: it needs no account and keeps your shelf on your device. The optional server
is built for that one deployment: accounts are made by hand in the Django admin (there is no
sign-up), and publishing goes to one particular Hugo booklog,
[boeken.tsuk.org](https://boeken.tsuk.org). Every push to the default branch deploys. There are no
releases; the server and the app's book logic have automated tests, the interface has not.

## What it does

- **Adding books.** Scan the ISBN barcode with the phone's camera (older paperbacks with only a
  shop barcode work too), photograph the cover, describe the book in a few words, share a page
  to it from another app (a bookshop, Goodreads, Audible), type an ISBN, or fill it in by hand.
  Books are looked up in Open Library, Google Books and Audible's catalogue; where the server
  has an assistant (a language model), it reads photographed covers and descriptions.
- **Lists.** *To read*, *Reading*, *Read* and *Did not finish* are built in, with progress in
  pages, time left or a percentage. Any other lists you like (*Library*, *Lent out*, a
  wishlist, where the books stand), some of them either-or, some with a note per book.
- **Books and their editions.** A book holds the editions of it you have or read: the
  hardcover, the paperback, the audiobook with its voice, the translation, each with its own
  facts, cover, people and the lists of where that copy is. A second edition found by scanning
  or describing is added to the book it is an edition of, without asking (*Keep separate* if
  not). A book can be read more than once, each read of one edition, with its date, rating and
  a review in Markdown. Series, authors and others with their roles, language, categories, tags.
- **Finding and changing.** Filters, orders, four views (list, covers, cards, statistics that
  follow the filters), and editing many books at once.
- **Covers.** Taken from the catalogues, photographed and straightened, pasted or shared in.
- **Offline** once installed, in English or Dutch.
- **Your reading, public.** An export in the CSV layout of Goodreads, which StoryGraph,
  BookWyrm, Hardcover, LibraryThing and Goodreads import, all of them free: a public page of
  what you read, with ratings and reviews, without running anything yourself. There is a JSON
  export of the whole shelf too.
- **With the server (optional):** accounts and sync between devices, covers kept on the
  server, the assistant, and two-way sync with a Hugo booklog: its books are imported, and what
  changes in the app is published back to it as commits. This is built for the author's own
  [boeken.tsuk.org](https://boeken.tsuk.org) and is not yet usable with another site; the CSV
  export above is the way to put your reading online.

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

Fonts: Fraunces and Instrument Sans (SIL Open Font License). Reading printed ISBNs:
[tesseract.js](https://github.com/naptha/tesseract.js) (Apache-2.0). Barcode fallback:
[barcode-detector](https://github.com/Sec-ant/barcode-detector) / zxing-wasm (MIT). Interface
icons: [Lucide](https://lucide.dev) (ISC).

Folio began as *Bookscan*, which is why a few internal names still say so.

## Privacy

Folio collects nothing about you: no analytics, no advertising, no cookies but those that
keep you signed in. Without an account your shelf never leaves your device; book lookups go
from your device to Open Library and Google Books, which see what is looked up. With an account
on the author's server, your shelf is kept there too, what you describe or photograph for the
assistant goes through it to OpenAI, and it keeps the usual log of visits.

## License

[MIT](LICENSE). Folio is free and comes as is, without guarantees: keep an export of your shelf.
The fonts and libraries in `fonts/` and `vendor/` keep their own licenses,
listed above.
