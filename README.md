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
[boeken.tsuk.org](https://boeken.tsuk.org). Every push to the default branch deploys, and every
deploy is a numbered version (shown under Settings), listed in the
[release notes](docs/release-notes.md). The server, the book logic, backups, the catalogue
lookups, the website export and the cover straightening have automated tests; the interface
has not.

## What it does

- **Adding books.** Scan the ISBN barcode with the phone's camera (older paperbacks with only a
  shop barcode work too), photograph the cover, describe the book in a few words, share a page
  to it from another app (a bookshop, Goodreads, Audible), type an ISBN, or fill it in by hand.
  Books are looked up in Open Library and Google Books, a Dutch, Flemish or French ISBN also in
  the national library (KB, BnF), an Audible link in Audible's catalogue; where the server has
  an assistant (a language model), it reads photographed covers and descriptions.
- **Lists.** *To read*, *Reading*, *Read* and *Did not finish* are built in, with progress in
  pages, time left or a percentage. Any other lists you like (*Library*, *Lent out*, a
  wishlist, where the books stand), some of them either-or, some with a note per book.
- **Books and their editions.** A book holds the editions of it you have or read: the
  hardcover, the paperback, the audiobook with its voice, the translation, each with its own
  facts, cover, people and the lists of where that copy is. A second edition found by scanning
  or describing is added to the book it is an edition of, without asking (*Keep separate* if
  not). A book can be read more than once, each read of one edition, with its date, rating and
  a review in Markdown. Series, authors and others with their roles, language and original
  language, categories, tags. A paper copy can be marked *can go* or *gone* without losing the
  book.
- **Series.** Drawn book by book, with what you lack; one *Look up* asks Hardcover and Wikidata
  what the series has and puts the missing volumes on *To read*.
- **Finding and changing.** Filters (a choice can also be left out), orders, four views (list,
  covers, cards, statistics that follow the filters), and editing many books at once.
- **Covers.** Taken from the catalogues, photographed and straightened, pasted or shared in;
  a queue goes through the books that have none.
- **Safe.** Deleting puts a book in the Trash; a backup file of the whole shelf can be saved
  and restored; on the author's server the database is also copied every night.
- **Offline** once installed, in English or Dutch.
- **Your reading, public.** An export in the CSV layout of Goodreads, which StoryGraph,
  BookWyrm, Hardcover, LibraryThing and Goodreads import, all of them free: a public page of
  what you read, with ratings and reviews, without running anything yourself. Or as a website
  of your own: a zip of a finished website to put on any web server (pages of covers for all
  books and each list, a page for every book, author, series, category and tag), or a Markdown
  page per read, with front matter, for a Hugo or Eleventy site. There is a JSON export of the whole
  shelf too. Each export asks which lists go in, and whether the text of reviews does.
- **A public library (optional):** with an account, a read-only page of the lists you choose,
  at an address of your own.
- **With the server (optional):** accounts and sync between devices, covers kept on the
  server, the assistant, and two-way sync with a Hugo booklog: its books are imported, and what
  changes in the app is published back to it as commits. This is built for the author's own
  [boeken.tsuk.org](https://boeken.tsuk.org) and is not yet usable with another site; the
  exports above are the way to put your reading online.

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
- [Release notes](docs/release-notes.md): what each version changed, from 1.0 on
- Design notes, written before and during the work and kept as a record, not kept up to date:
  [books and their editions](docs/work-edition-plan.md) and
  [its cut-over](docs/cutover-2.0.md), [a public library](docs/public-library-plan.md),
  [ideas from Shelf](docs/shelf-ideas-plan.md)

## Credits

Fonts: Fraunces and Instrument Sans (SIL Open Font License). Reading printed ISBNs:
[tesseract.js](https://github.com/naptha/tesseract.js) (Apache-2.0). Barcode fallback:
[barcode-detector](https://github.com/Sec-ant/barcode-detector) / zxing-wasm (MIT). Interface
icons: [Lucide](https://lucide.dev) (ISC).

Folio began as *Bookscan*, which is why a few internal names still say so.

## Privacy

Folio collects nothing about you: no analytics, no advertising, no cookies but those that
keep you signed in. Without an account your shelf never leaves your device; book lookups go
from your device to Open Library and Google Books (for a Dutch, Flemish or French ISBN also the
KB or the BnF, and Wikidata for a series or an original language), which see what is looked up.
With an account on the author's server, your shelf and its covers are kept there too, what you
describe or photograph for the assistant goes through it to OpenAI, what is asked of Hardcover
(a series, a page count) goes through it as well, and it keeps the usual log of visits.

A public library is off until you turn it on (and the person who runs the server allows it
for your account). Then anyone with its address can read the books on the lists you chose,
with only what those lists say, never the notes on them; search engines are asked not to list
it.

## License

[MIT](LICENSE). Folio is free and comes as is, without guarantees: keep an export of your shelf.
The fonts and libraries in `fonts/` and `vendor/` keep their own licenses,
listed above.
