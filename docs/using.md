# Using Folio

What the app does and how, screen by screen. For running it yourself see
[server.md](server.md); for the booklog at boeken.tsuk.org see [booklog.md](booklog.md).

## Adding books

1. **Scan** the ISBN barcode on the back cover. The book is looked up in Open Library and
   Google Books and added to your shelf with title, author, publication date, publisher and
   page count. Keep scanning — each hit is added straight away, with *Undo* and *Edit* on the card.
2. **No match?** Photograph the front cover. Where the server has an assistant (see [The assistant](#the-assistant)) it
   looks at the photograph and names the book, for you to confirm. Without one, or when it
   cannot tell, the text on the cover is read on the phone and searched for in the same
   catalogues; tap the right result to add it.
3. **Still nothing?** The title and author read from the cover are put in a form for you to
   correct. Every line of text found on the cover is a chip you can tap to fill a field.

Older paperbacks (mostly American) carry a shop barcode (UPC) instead of an ISBN one, with the
ISBN only printed above or below it. The scanner notices this and reads the printed number instead.
Photographing a back cover or copyright page that shows an ISBN works the same way.

You can also type an ISBN or enter a book entirely by hand. Books scanned without a connection
are saved by ISBN and completed automatically once you are back online.

## Lists

Every book can be on any number of lists. The app starts with *Library*, *To read*, *Reading*,
*Read*, *Did not finish* and *Lent out*; *Edit lists* adds, renames, reorders and deletes them.

- **The reading lists are part of the app.** *To read*, *Reading*, *Read* and *Did not finish*
  are always there, always one either-or set, and cannot be renamed or removed (they can be
  moved). That is what lets a book offer what comes next, on its page:
  - on *To read*: **Start reading**, or **Drop** it. Dropping removes the book for good and is
    asked first; for a book in the booklog its page there is deleted too (any book can be
    deleted from the booklog: see *Deleting from the booklog*);
  - on *Reading*: how far along you are, **Mark as read** (which asks for the reading date, a
    rating and a review, all optional) or **Did not finish**. Progress is the page reached (for
    an audiobook: the time left) or a percentage. The two fields follow each other through the
    book's length, and the one you typed in is the one that read goes by from then on: it comes
    first, and its figure is kept exactly as typed. The booklog always gets pages or time left;
    a percentage for a book without a page count stays in Folio.

- **Either-or sets.** Lists in the same set exclude each other: putting a book on *Read* takes
  it off *To read* and *Reading*. A list on its own (*Library*, *Lent out*) can hold any book,
  whatever else it is on. Which set a list belongs to, if any, is chosen when editing the list.
- **Notes.** A list can ask for a note per book. *Lent out* asks who it was lent to; the note
  shows on the book and is searchable.
- **Putting books on lists.** Open a book and tap its lists. Or scan: the pill at the top of
  the scanner says which lists scanned books go on. A new book, however it is added (scanned,
  photographed, described, typed in), starts on the lists the last book added went on, since a
  pile of books mostly goes to the same place. Scanning a book you already have puts it on
  those lists too, so scanning onto *Lent out* or *Read* is the quick way to move a pile of
  books.
- Each list has its own address (`#/list/read`), so it can be bookmarked or opened directly.
  Every list or series you open is a step in the browser's history: Back returns to the one
  before.

## Finding your way: places, filters, order

What you see is decided in three steps.

1. **Where you are.** The reading lists (*Reading*, *To read*, *Read*), *All books*, the
   *Series*, and the lists you keep by hand (*Lent out*, a wishlist). On a wide screen they are
   a menu beside the books; on a phone a bar under the thumb with the four you go to most, and
   the rest behind *More*.
2. **Narrowed by filters.** *Filter* opens what the books of that place can be told apart by,
   each with how many it would leave: reading status, read as (paper, e-book, audiobook),
   category, language, year read, rating, the lists you keep, and a few odd ones (no cover,
   not on the booklog). A set of lists of your own is a filter too: lists that share a set
   (the places your books stand in, say: *Bureau*, *Bibliotheek*) are not in the menu but
   narrow whatever you are looking at. Within one filter any chosen value will do; between
   filters all must hold. What is chosen shows under the search box, to be taken off again,
   and is in the address (`#/list/read?format=audiobook&year=2024`).
3. **In an order.** The button beside *Filter* names it and changes it: date added, date read,
   last changed, author (by surname), title (without its article), rating, year published,
   length, series. Choosing the same one again turns it round. Each place keeps its own, and
   starts with the one that suits it: *Reading* by what you last touched, *Read* by when you
   read it, *Lent out* by who has had a book longest, an author's books by series. Books that
   share what they are ordered by share a heading (a month, a letter, a rating), and books
   without it come last.

Books scanned before lists existed count as being in the *Library*.

## Changing many books at once

*Select* (the square beside the order) starts selecting books: a tap then selects a book
instead of opening it, and Shift-click takes in every book in between. A Ctrl-click (⌘ on a
Mac) on a book, or a long press on a phone, starts selecting with that book. While you select,
*Add a book* makes way for a bar: how many are selected, *All* (every book the view shows) or
*None*, and *Edit*. What is selected stays selected while you search and filter, so books can
be picked from all over the shelf. Back, Escape or the × end it, and so does going elsewhere.

*Edit* opens one sheet for all of them:

- **Reading status**, and every set of lists of your own (*Bureau*, *Bibliotheek*): choose one
  and they all go on it (and off the others of that set); a set of your own also has *None*.
- **Lists** you keep by hand, **authors**, **categories** and **tags** can be *added* to what
  each book has, *removed* from it, or *replace* it. *Replace* leaves translators, voices and
  others with a role where they are. Authors and tags are typed, a comma between them; those
  the selected books already have are offered beneath, to tap.
- **Series** and **publisher**: what they share is filled in; where they differ the field says
  how ("Earthsea, on 2 of them"). ⊘ empties it for all of them. A series can number the books
  1, 2, 3… in the order they are shown.
- **Format** and **language**: choose one for all of them.

Each part starts out changing nothing and shows, with a count on each choice, how many of the
books have it now. A part that would change something says so (its name lit, with *Reset*),
and only those parts are applied. *Undo* in the message afterwards puts every book back.

## Views, covers and reviews

- **Three views** of every list, chosen with the buttons beside the search box: the *list*
  (as it always was), *covers* (a shelf of covers with their ratings, grouped by year) and
  *cards* (larger cover, details, lists and the start of the latest review, grouped by month).
- **Covers keep their own proportions**: a square audiobook cover is square, everywhere.
- **Tapping a book opens its page**: cover, details, the lists it is on and its reviews.
  *Edit details* leads to the form with its fields and lists. From there, swiping left or
  right (on a desktop: the arrow keys, or the two arrows on the page) goes to the next or previous book
  of the list it was opened from.
- **A book's page takes a little of its cover's colour**, as its page in the booklog does: the
  first of the cover's main colours that is neither nearly white nor nearly black. Only that
  sheet is tinted.
- **Paper, e-book or audiobook.** A book says what format it is in, and each read's edition for
  itself: *Format* in a book's details (what you have, read or not) and under *Edition read* in a review. An audiobook is
  measured in time (a length such as `11u 36m`, and its progress in time left); the others in
  pages. A book scanned or photographed is a paper book. In the booklog a post says so under
  `format`; a post that doesn't is an audiobook if it has a length, and otherwise isn't said
  to be anything. (The booklog's audiobook and kindle categories, which said this before, are
  gone.)
- **Another version of a book you have** (its audiobook, where you have the e-book) is a book
  of its own: its own format, lists, progress and reads. Adding it from a description or a
  shared link, when the shelf has the book in another format, offers it as *Another version*.
  It takes the series of the book you have (not the store's name for it), and what the find
  leaves out (language, categories, tags) comes from that book too. In the booklog it is a
  reread of that book (`rereadOf`) in its own format; the book remembers which one it is
  another version of (`versionOf`), so publishing changes only its own posts and the import
  gives it back only its own reads. (A device that changes a book before it has heard the book
  was published sends it back without its post; the server keeps what publishing added, so it
  isn't published a second time.) A book added some other way that the booklog already has in
  another format is taken for another version when it is published.
- **Authors and others.** A book has people: those who wrote it, and those who drew, coloured,
  lettered, translated or read it, each with what they did (*beeld*, *kleur*, *stem*,
  *vertaling*: the booklog's own free words). No role means an author. A book shows its
  writers, then the others by role; each read's edition has its own people, so the audiobook
  has a voice and the paperback read before it has not. They are edited as rows of name and
  role, in a book's details (for the book, which is its latest read) and under *Edition read*
  in a review (for that read). Any name leads to all of that person's books
  (`#/author/<name>`), whatever they did on them.
- **Language, categories and tags.** A book's details say what language its edition is in,
  which of the booklog's categories it belongs to, and its tags (a comma between them). Its
  page shows them quietly under the other details. For a book in the booklog they are
  published like the rest.
- **A book without a cover**, or with only the photograph you took when adding it, offers
  *Find a (better) cover*, which opens the cover (see *The cover, large*).
- **The menu shows the lists that have books on them.** An empty list is still there to put
  books on, and under *Edit lists*.
- **In the covers view the covers stand on one base line**, whether or not a book has a rating
  or a date under it.
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
- **The cover, large.** Tap a cover (on a book's page, in its details, or an edition's in a
  review) and it opens over everything at the best size there is: the picture you supplied,
  the booklog's own original, or the catalogue's large size. Tap it again for its real size.
  Everything to replace it with is right there: the covers Open Library and Google Books have
  of its ISBN and of its other editions (by title and author), *Take a photo*, *Choose a
  picture*, *Paste* (also Ctrl+V, or drop one), and *Search the web* (large pictures, in a new
  tab: copy one and paste it). A photo can be **straightened**: drag the four corners onto the
  book's corners and it is pulled out into an upright rectangle. *Use this cover* sets it (on
  a book's page at once, with Undo; in a form when you save). Whatever is chosen, the server
  keeps a large copy (it fetches a catalogue's cover itself) and a small one, and the large
  one is what goes to the booklog. A cover photographed in the scanner is kept at 1500 pixels,
  so it can be straightened later.
- **Deleting from the booklog.** Deleting a book that is in the booklog asks first, with
  *Also delete it from boeken.tsuk.org* ticked: then all its pages there go (one per read),
  with covers and author, tag and series pages nothing else uses. Deleting a review of a read
  that is in the booklog deletes that read's page. When the first read of a book goes, the
  next one becomes the first (the others become rereads of it). The booklog's history keeps a
  copy of everything.
- **Covers are kept on the server.** For signed-in users the server fetches a copy of each
  cover that comes from a book catalogue (Open Library, Google Books), a few per sync, as a
  320-pixel WebP in `covers/web/`, and the book then points at that copy. `manage.py
  fetch_covers` does a whole shelf at once. Covers you photographed yourself already travel
  with the book.

## The assistant

*Add a book* offers the ways there are: scan the barcode, photograph the cover, describe the
book, type its ISBN, or fill it in by hand. In the scanner, *No barcode?* offers the same
without the barcode.

Where the server has an assistant (see [Running Folio](server.md#accounts-and-sync-optional)), *Describe it* adds
books from a description: a title, an author, a series, in your own words (*the new Kuang*,
*Commonwealth Saga*, *Piranesi van Susanna Clarke*). The assistant answers with proposals:
title, authors, series and number, publisher, year, pages, the language, categories from the
booklog's own list, a few tags and one dry sentence about the book. For each, Open Library is
asked for the ISBN and cover, and only believed when title and author really match; series,
tags and authors are matched with what the booklog already has. You tick the ones you want,
choose the lists they go on, and they are added like any scanned book; with a reading status
they can go to the booklog in the same move.

A photographed cover goes the same way: the photograph (made no larger than 1024 pixels) is
shown to the assistant, which names the book or books on it, and its proposals open as *Is
this the book?*, with a field to say it in words if it got it wrong. `manage.py try_covers
/path/to/boeken` tries this on covers of books the booklog knows and reports how many it got
right, how long it took and what it cost in tokens, per model (`--models a,b`) and per
thinking effort (`--effort low`). On 30 covers made to look like phone photographs, the
server's model named 27 exactly and none wrongly, whether it thought long (7.7 s a cover) or
briefly (2.6 s); so covers are read with little thinking (`OPENAI_COVER_EFFORT`, default `low`).

The same assistant sits behind *Suggest* in
[*Add to boeken.tsuk.org*](booklog.md#adding-a-book-to-the-booklog): it fills in language,
categories, tags and the sentence for a book you already have. Nothing it proposes is saved
or published until you say so. This is boeggn's intake, with its prompt.

## Sharing to the app

Installed, the app is in the phone's share menu:

- **A picture** becomes a cover: you pick the book it belongs to, and for a book read in
  several editions which read.
- **A page of the booklog** opens that book.
- **An Audible page** (from the Audible app's share menu, or its address pasted into *Describe
  it*) is that audiobook: Audible's catalogue is asked for it by the number in the address (the
  ASIN), without the assistant. It comes with its author, its narrator (as `stem`), publisher,
  year, length, series, language and the square audiobook cover, as an audiobook. The
  assistant, where there is one, adds categories, tags and the one sentence, as it does for a
  book found by its ISBN. Each Audible store has its own numbers, so the link's own store is
  asked first and then the American one (audible.nl is the German store).
- **Anything else** (a bookshop's page, a Goodreads link, a line of text) is looked up and
  proposed for adding, like a description. An ISBN in the text or on the shared page settles
  which book and edition it is, with Open Library; the assistant then only adds categories,
  tags and the sentence. Without an ISBN the assistant is asked for the whole book. The
  server fetches a shared page only over https from the public internet.

The service worker receives what is shared (`share_target` in the manifest posts it to
`share`, which no server answers) and opens the app with it, so sharing works offline up to
the point where something has to be looked up. A phone may need the app reinstalled, or a
day, before it shows up in the share menu.

## Export

Settings → *Your shelf, as a file* has two exports. Each can be saved, shared or copied.

**Export for Goodreads, StoryGraph…** writes a CSV file laid out like a Goodreads export,
which other reading sites import: [StoryGraph](https://app.thestorygraph.com),
[BookWyrm](https://joinbookwyrm.com) (open source; pick any instance),
[Hardcover](https://hardcover.app), [LibraryThing](https://www.librarything.com) and Goodreads
itself, all free. It is the way to give your reading a public page without running a server.

- One row per book. A book read more than once comes with its latest read: the date read, the
  number of reads, and the latest review that has text.
- *To read*, *Reading*, *Read* and *Did not finish* become the shelves `to-read`,
  `currently-reading`, `read` and `did-not-finish`. A book on none of them goes on `to-read`,
  as every book on Goodreads is on one of its shelves. The other lists become shelves of their
  own (`library`, `lent-out`), and their notes private notes.
- Ratings go from 0–10 to 1–5 stars (half up: 7 is four stars). The series goes in the title,
  *A Wizard of Earthsea (Earthsea, #1)*, as Goodreads writes it. Translators, voices and
  others go under *Additional Authors*, without their role.
- Reviews go as they were written, in Markdown.

**Export as JSON** saves the whole shelf as JSON:

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
rename them.

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
