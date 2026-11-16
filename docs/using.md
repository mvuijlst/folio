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

Adding never asks whether it is a book you already have:

- **The same ISBN is the same edition.** The card says it is already on your shelf (and puts
  it on the lists you are scanning to), with *Another copy* for a second copy of that edition
  in the same book.
- **Another edition of a book you have** (the same Open Library work, or the same title by the
  same first author, unless both say where they stand in a series and that differs) becomes an
  edition of that book: *Added to “Equal Rites” as another edition*, with *Undo*, *Edit* and
  **Keep separate**, which makes it a book of its own after all. A title with a subtitle is
  the same as the title without (*Ash* and *Ash: A Secret History*). Put on *To read* or
  *Reading* while adding, the book goes there and that edition is the one to be read.
- **Anything else** is a new book.

A translation is never recognised by its title: add it from its book's page with *Add another
edition* (every way of adding then puts what is found into that book, without matching), or
join two books afterwards (*Combine with another book…*, see [Books and their
editions](#books-and-their-editions)).

## Lists

Every book can be on any number of lists. The app starts with *Library*, *To read*, *Reading*,
*Read*, *Did not finish* and *Lent out*; *Edit lists* adds, renames, reorders and deletes them.

- **The reading lists are part of the app.** *To read*, *Reading*, *Read* and *Did not finish*
  are always there, always one either-or set, and cannot be renamed or removed (they can be
  moved). That is what lets a book offer what comes next, on its page:
  - on *To read*: **Start reading**, or **Drop** it. Dropping removes the book for good and is
    asked first; for a book in the booklog its page there is deleted too (any book can be
    deleted from the booklog: see *Deleting from the booklog*). A book you have read before
    and mean to read again offers **Not after all** instead, which puts it back on *Read*;
  - on *Reading*: how far along you are, **Mark as read** (which asks for the reading date, a
    rating and a review, all optional) or **Did not finish**. Progress is the page reached (for
    an audiobook: the time left) or a percentage. The two fields follow each other through the
    book's length, and the one you typed in is the one that read goes by from then on: it comes
    first, and its figure is kept exactly as typed. The booklog always gets pages or time left;
    a percentage for a book without a page count stays in Folio.

- **Either-or sets.** Lists in the same set exclude each other: putting a book on *Read* takes
  it off *To read* and *Reading*. A list on its own (*Library*, *Lent out*) can hold any book,
  whatever else it is on. Which set a list belongs to, if any, is chosen when editing the list.
- **Reading status is the book's; every other list is an edition's.** *To read*, *Reading*,
  *Read*, *Did not finish* (and any list of yours in that set) say where you are with the book.
  *Library*, *Lent out* and your own lists say where a copy is, so with more than one edition
  each edition has its own (the paperback in the library, the e-book nowhere). A book shows on
  a list when it, or one of its editions, is on it.
- **A book you have read stays under *Read*** while you plan or do another read of it: it is on
  *To read* (or *Reading*) and still under *Read*, shown there as the edition you read.
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

Books scanned before lists existed count as being in the *Library* (their edition is).

**A row is always a book**, shown as the edition that fits where you are: in *Library* the
edition that is in the library, under a filter on format the edition in that format, on *Read*
the edition you read last, elsewhere the edition the book is about (see *main edition* below).
Filters on where a copy is, its format, its language and its cover test the editions: a book
passes when one edition is there and passes all of them. Filters on reading status, category,
year read and rating test the book. Counts are always books. *Filter → Other → Possibly the
same book* shows books that share an Open Library work or a title and first author with
another: the way to find books that should be one (*Combine with another book…*).

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
  Reading status, series, authors, categories and tags change the book; lists of where a copy
  is, publisher, format and language change the edition each selected row shows.
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
- **Paper, e-book or audiobook.** Each edition says what format it is in: *Format* in a book's
  details, or on an edition's sheet. An audiobook is measured in time (a length such as
  `11u 36m`, and its progress in time left); the others in pages. A book scanned or
  photographed is a paper book. In the booklog a post says so under `format`; a post that
  doesn't is an audiobook if it has a length, and otherwise isn't said to be anything.
- **Authors and others.** A book's writers are the book's own; everyone else (who drew,
  coloured, lettered, translated or read it, each with what they did: *beeld*, *kleur*,
  *stem*, *vertaling*, the booklog's own free words) is on an edition. No role means an author.
  A book's page shows its writers, then those who are on every edition by role (a comic's
  artist); a voice or a translator of one edition is named with that edition. They are edited
  as rows of name and role, in a book's details and on an edition's sheet. Any name leads to
  all of that person's books (`#/author/<name>`), whatever they did on them.
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
- **Series.** Books that share a series name form a series: *Series* in the navigation lists
  them all, and a series page shows its books in order. Set the series and its number in a
  book's details; a number such as 4.5 sorts between 4 and 5.
- **The cover, large.** Tap a cover (on a book's page, in its details, or on an edition's
  sheet) and it opens over everything at the best size there is: the picture you supplied,
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

## Books and their editions

A book is the work you know by its title and writers; its **editions** are the copies of it you
have or read: the hardcover, two softcovers, the audiobook with its voice, the e-book, the
translation. Almost every book has one edition, and then there is nothing to see of this: the
book looks and works as it always did, and its details hold everything, field for field. The
only addition is *Add another edition*, quietly beside *Edit details*.

With more than one edition:

- **The book's page** shows the book (its title, writers, series, reading status, progress)
  with the cover and details of its **main edition**, and a section **Editions**: a row per
  edition with its cover, a line about it (*Audiobook · 11u 36m · Audible · 2018 · stem: Roy
  Dotrice*; its own title and language first when it has another title), the lists it is on
  and when it was read. While the book is on *To read* or *Reading*, the edition being read
  says *reading this one*. Each read on the page shows its edition's cover and line.
- **The main edition** is the one the book is about: the edition you are reading or mean to
  read while the book is on *To read* or *Reading*; otherwise the one you read last. *Start
  reading* reads it; the progress box names it, with *Another one* to say you are reading
  another; an edition's sheet has *I'm reading this one*.
- **Edit details** holds what is the book's: title, writers (and whoever is on every
  edition), series, categories, tags and reading status. Changing the writers changes them on
  every edition; a voice or translator of one edition stays.
- **An edition's sheet** (tap its row) has its facts: format, publisher, year, pages or
  length, ISBN, language, cover, everyone on it, a title of its own when it has one (a
  translation), and the lists of where that copy is. At the bottom, quietly: *Make it a book of
  its own* (it goes with its reads; *Undo* in the message), and the bin, when the book has
  another edition. An edition that was read says first that its reads go with it, and for
  reads in the booklog their pages there too.
- **A read is of one edition.** In a review, *Edition read* chooses among the book's editions
  (a new read starts with the main one), or *Another edition…* adds one and comes back to the
  read with it chosen. Its facts are changed on its sheet (*Edit this edition*), so correcting a
  publisher changes it for every read of that edition.
- **Combine with another book…** at the bottom of a book's details moves another book's
  editions and reads into this one, and that book goes (*Undo* in the message). The one in the
  booklog stays, if only one of them is.
- **Not possible yet:** combining two books that are both in the booklog, and making an
  edition whose reads are in the booklog a book of its own. The app says so and does nothing.
  (In the booklog a book is one group of posts, one per read: a book's reads in other editions
  are rereads of its first post, each with its own edition's facts. Splitting and joining those
  groups there is for later.)

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

- **A picture** becomes a cover: you pick the book it belongs to, and for a book with more
  than one edition which edition.
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

- One row per read, with the edition that was read: its format, publisher, pages, ISBN, the
  date read, that read's rating and review. A book not read yet (or being read again) has a
  row for where it stands, as its main edition.
- *To read*, *Reading*, *Read* and *Did not finish* become the shelves `to-read`,
  `currently-reading`, `read` and `did-not-finish`. A book on none of them goes on `to-read`,
  as every book on Goodreads is on one of its shelves. The other lists become shelves of their
  own (`library`, `lent-out`), and their notes private notes.
- Ratings go from 0–10 to 1–5 stars (half up: 7 is four stars). The series goes in the title,
  *A Wizard of Earthsea (Earthsea, #1)*, as Goodreads writes it. Translators, voices and
  others go under *Additional Authors*, without their role.
- Reviews go as they were written, in Markdown.

**Export as JSON** saves the whole shelf as JSON: each book with its reading status, its
editions (each with its facts and the lists it is on) and its reviews (each saying which
edition it was of):

```json
[
  {
    "title": "The Name of the Rose",
    "author": "Umberto Eco",
    "added": "2026-11-14T12:27:54.748Z",
    "lists": [{ "list": "Read", "since": "2026-11-30T20:00:00.000Z" }],
    "rating": 9,
    "editions": [
      {
        "id": "e1", "format": "paper", "publisher": "Harcourt Brace", "date": "1994",
        "pages": 536, "isbn": "9780156001311", "language": "en",
        "cover": "https://folio.example.org/covers/web/….webp",
        "lists": [
          { "list": "Library", "since": "2026-11-14T12:27:54.748Z" },
          { "list": "Lent out", "since": "2026-11-20T18:02:11.000Z", "note": "Jan" }
        ]
      }
    ],
    "reviews": [
      { "date": "2026-11-30", "rating": 9, "text": "Markdown, *as written*.", "edition": "e1" }
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
  sent it; a book's editions, and the lists it and its editions are on, travel inside the book.
  A copy of the app from before editions (before 2.0) can no longer sync: it says it is out of
  date under Settings, and updates itself the next time it is opened.
  Export now and then to keep a copy of your own.
- Google Books' keyless quota is shared and often exhausted. Open Library still answers, but
  for the best hit rate add a free Google Books API key under the settings icon.
- Cover reading supports English, Dutch, French and German; pick the ones you need in settings.
  The reader (about 10 MB) is downloaded the first time it is used and cached after that.
- Barcode scanning uses the browser's built-in detector on Android and falls back to a
  bundled WebAssembly one elsewhere.
