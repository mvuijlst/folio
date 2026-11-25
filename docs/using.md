# Using Folio

What the app does and how, screen by screen. For running it yourself see
[server.md](server.md); for the booklog at boeken.tsuk.org see [booklog.md](booklog.md).

## Adding books

1. **Scan** the ISBN barcode on the back cover. The book is looked up in Open Library and
   Google Books and added to your shelf with title, author, publication date, publisher, language and
   page count. Keep scanning — each hit is added straight away, with *Undo* and *Edit* on the card.
   A Dutch or Flemish ISBN (978-90, 978-94) is also looked up in the Dutch national library, the
   KB, and a French one (978-2, 979-10) in the BnF; what they say of the publisher, year, page
   count and language wins. Title and writers stay as Open Library and Google Books write them
   (the national catalogues write names in full), unless those don't know the book. Their year
   is that of the printing they have for the ISBN, sometimes a later one than yours. Flemish
   publishers are thinner at the KB (on 2026-11-20 it knew 53 of 77 of yours).
   No catalogue says what kind of book it is, but your shelf often does: when you have at least
   three other books by its writer and three in four of them have the same categories, the
   scan gets those too. The card says them; *Edit* puts them right.
   When a catalogue doesn't answer, the card says which; a book found without it is asked again
   later, for what it still lacks. When neither says how many pages the edition has, the app
   asks Hardcover (signed in, where the server has its token), then takes the median of the
   Open Library work's editions (which is the work's figure, not the edition's own).
2. **No match?** The card says which catalogues don't know the ISBN, and which didn't answer
   (then *Try again*). Photograph the front cover. Where the server has an assistant (see [The assistant](#the-assistant)) it
   looks at the photograph and names the book, for you to confirm.
3. **Still nothing?** Without an assistant (no account, or offline), or when it cannot tell,
   the photograph becomes the cover of a book you fill in by hand.

Older paperbacks (mostly American) carry a shop barcode (UPC) instead of an ISBN one, with the
ISBN only printed above or below it. The scanner notices this and reads the printed number
instead, on the phone (the only text recognition the app does; about 7 MB, fetched the first
time it is needed).

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

A translation is never recognised by its title: add it with *Add another edition*, at the
bottom of its book's details or in its *Editions* (every way of adding then puts what is found into that book, without matching), or
join two books afterwards (*Combine with another book…*, see [Books and their
editions](#books-and-their-editions)).

## Lists

Every book can be on any number of lists. The app starts with *Library*, *To read*, *Reading*,
*Read*, *Did not finish* and *Lent out*; *Edit lists* adds, renames, reorders and deletes them.

- **The reading lists are part of the app.** *To read*, *Reading*, *Read* and *Did not finish*
  are always there, always one either-or set, and cannot be renamed or removed (they can be
  moved). That is what lets a book offer what comes next, on its page:
  - on *To read*: **Start reading**, or **Drop** it. Dropping puts the book in the
    [Trash](#trash) and is asked first; for a book in the booklog its page there is deleted
    too, the one deletion that touches the booklog (put back, it is published again). A book you have read before
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
- **Moving books is scanning them onto where they go.** Lists in one set exclude each other, so
  scanning a book onto *Bibliotheek* takes that copy off *Bureau* or *Te klasseren*. Put *Lent
  out* in the same set as the places and lending is a move too: a book scanned back onto its
  shelf comes off *Lent out*. (There is no scanning *off* a list, on purpose.)
- Each list has its own address (`#/list/read`), so it can be bookmarked or opened directly.
  Every list or series you open is a step in the browser's history: Back returns to the one
  before, as you left it: each view keeps its search, its filters, its order, its layout
  (list, covers, cards) and how far down it was. Back from an author or series reached from a
  book's page returns to the view the book was opened from, not to the book's page.
  *All series* and the other links open a view afresh.

## Keep, can go, gone

A paper copy is one of three things (e-books and audiobooks are none of them):

- **Keep**, as every copy is until you say otherwise. Nothing is shown.
- **Can go**: you mean to give it away or sell it. In the covers view a small amber bookmark
  hangs over the top left of its cover, and when the book is open over its page's; in the list
  and cards views it is a tag, *Can go*, beside the lists it is on.
- **Gone**: given away, sold or lost. Its cover is faded, with a small ghost on it. Marking a
  copy gone takes it off where it stood (the lists of any set but reading status: Bibliotheek,
  Bureau…); *Lent out* and lists on their own stay.

A copy that is gone stays on your shelf, with its reads and its page on the booklog: a book you
read is a book you once had. Deleting a book is for a mistake, or for a book on *To read* you no
longer want.

It is set under *This copy*: on a book's *Edit details* when it has one copy, on a copy's own
sheet (under *Editions*) when it has more, and for many at once in [bulk
edit](#changing-many-books-at-once). The filter *This copy* finds them; *Format: paper* with a
place set to *None* finds the paper copies that stand nowhere, to sort out. In the JSON export a
copy says `"have": "go"` or `"gone"`.

A list that meant the same, such as *Mag weg* (the standard list *Library*, renamed), becomes the
mark with `manage.py list_to_have --user NAME --list library --have go --write`: its paper copies
get *Can go* and the list is deleted ([server.md](server.md)).

## Finding your way: places, filters, order

What you see is decided in three steps.

1. **Where you are.** The reading lists (*Reading*, *To read*, *Read*), *All books*, the
   *Series*, and the lists you keep by hand (*Lent out*, a wishlist). On a wide screen they are
   a menu beside the books; on a phone a bar under the thumb with the four you go to most, and
   the rest behind *More*.
2. **Narrowed by filters.** *Filter* opens what the books of that place can be told apart by,
   each with how many it would leave: reading status, read as (paper, e-book, audiobook),
   category, language, year read, rating, the lists you keep, and a few odd ones (no cover,
   on the booklog). A set of lists of your own is a filter too: lists that share a set
   (the places your books stand in, say: *Bureau*, *Bibliotheek*) are not in the menu but
   narrow whatever you are looking at. A tap on a choice shows only the books that have it; a
   second tap leaves those books out instead (the choice is struck through, with ⊘), and a
   third lets it go. Within one filter any wanted value will do and no left-out one may hold
   (on *Library* and not on *Mag weg* or *Van Sandra*); between filters all must hold. For
   where a copy is, its format and language, it is a copy that must pass: a book with one copy
   on *Mag weg* and another not is shown as the other. *Year read* is a span instead, from one
   year to another: a slider with a handle at each end, over a small column per year of how
   many books were read in it. Reading status, lists, category, language and original
   language each also have a choice for books that have none of it (*No category*, *No
   language*, *Not known*…), shown while some book has none. What is chosen shows under the
   search box ("Lists: not Mag weg"), to be taken off again; more than three values of one
   filter are one chip (*Category: 17 left out*, *Category: 5 selected*), which names them when
   you point at it and takes them all off at once. It is all in the address
   (`#/list/read?format=audiobook&on=-magweg&year=2015-2024`; a single year is `year=2024`;
   none is `category=none`).
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
year read and rating test the book; a book is within a span of years read when it was read in
any year of it, so a book read in 2015 and again in 2020 is among the books of both. Counts
are always books. *Filter → Other → Possibly the
same book* shows books that share an Open Library work or a title and first author with
another: the way to find books that should be one (*Combine with another book…*). A book's
page lists the books it may be the same as, each with *Combine* and **Not the same book**
(with *Undo*): the two then stay apart and are no longer proposed to each other.

On a phone, and on a tablet up to the width where the lists become a sidebar, the header,
search and filter stay at the top of the window: they slide away while you scroll down through
the books and come back as soon as you scroll up, or reach the top, or type in the search.

## Changing many books at once

*Select* (the square beside the order) starts selecting books: a tap then selects a book
instead of opening it, and Shift-click takes in every book in between. A Ctrl-click (⌘ on a
Mac) on a book, or a long press on a phone, starts selecting with that book. While you select,
*Add a book* makes way for a bar: how many are selected, *All* (every book the view shows) or
*None*, and *Edit*. What is selected stays selected while you search and filter, so books can
be picked from all over the shelf. When the search or a filter hides some of what is selected,
the bar says so (*2 not shown*, an eye and the number on a phone), and a tap on it shows only
the selected books under a *Selected* chip; taking the chip off, or searching or filtering again,
returns to the view as it was. Back, Escape or the × end it, and so does going elsewhere.

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

With books selected, the bar also has *Categories* (the sparkles). It looks up what kind of
book each of them is and shows what it would get, the
surest way first:

1. your shelf: the categories of its series, or the ones the other books of its writer agree
   on (as a scan gets them);
2. the assistant, with an account and where the server has one (see
   [The assistant](#the-assistant)), twenty books at a time;
3. your shelf again, less strictly (two other books by the writer, most of them alike);
4. what Open Library and Google Books say the book is about.

Each book says which of these it goes by. A book is ticked where that is clear (your shelf,
or the assistant where it knows the book) and unticked where it is a guess to check; a tap
ticks or unticks it. *Categorise* gives the ticked books their categories and leaves the
others as they are; *Undo* takes them back. Nothing is published by it: a book only goes to
the booklog when you say so.

A book that has categories already is shown with them (*Now: …*) and is never ticked by itself:
it keeps them unless you tick it, and then the proposal replaces them; where the proposal is what
it has, it says *As it is now*. *Undo* gives them back what they had.

## Views, covers and reviews

- **Four views** of every list, chosen with the buttons beside the search box: the *list*
  (as it always was), *covers* (a shelf of covers with their ratings, grouped by year),
  *cards* (larger cover, details, lists and the start of the latest review, grouped by month)
  and *statistics*.
- **Statistics** count what the place shows with its filters and search on, so an author's
  books, *Read* in Dutch or one year each get their own: how many books and reads, pages read,
  hours listened, writers and the average rating; reads per year by format, in books or in
  pages (an audiobook counts forty pages an hour, as the booklog reckons), as columns or as a
  stream (each format a band flowing through the years); a dot per read of
  the year the edition came out against when it was read (a dot opens the book); the books by
  the year their edition came out, paper above the line and e-books and audiobooks below it;
  the books in translation, as ribbons from the language each was written in to the language
  of its edition; categories,
  languages and ratings. Tapping a year read, a category, a
  language (also at either side of the translations) or a rating narrows the place by it, as the filter would (tapping it again lets it
  go; a span of years is chosen with the filter's slider). A read counts in the year it is dated, of the edition it was of: with a filter
  on copies (format, language) only reads of an edition that passes it count, and with a span
  of years only the reads within it. Reads given up are counted apart and are in no chart.
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
  doesn't is an audiobook if it has a length, and otherwise isn't said to be anything. A comic
  run in the booklog that gives its `issues` (*84 × 28 blz.*) is counted as the issues times the
  pages of one (*84 × 28 pp*): it sorts by *Length* at its whole length and adds that to the pages
  read in the statistics.
- **Authors and others.** A book's writers are the book's own; everyone else (who drew,
  coloured, lettered, translated or read it, each with what they did: *beeld*, *kleur*,
  *stem*, *vertaling*, the booklog's own free words) is on an edition. No role means an author.
  A book's page shows its writers, then those who are on every edition by role (a comic's
  artist); a voice or a translator of one edition is named with that edition. They are edited
  as rows of name and role, in a book's details and on an edition's sheet. Any name leads to
  all of that person's books (`#/author/<name>`), whatever they did on them.
- **Original language, and the original title.** A book (not an edition) can say which
  language it was first written in and what it was called then: *Kafka on the Shore*, written in
  Japanese, 海辺のカフカ. Its page then says *English, translated from Japanese*, with the
  original title under its own; the filters have *Original language*. When a book is added, the app looks it up by
  itself: Open Library's record of the edition (when it says it is a translation) and Wikidata,
  through the Open Library work, which knows it for many well-known books. With an account and
  the assistant, the server is asked for the rest, and a book the assistant proposes comes with
  it. What nobody knows stays empty; it is set under *Edit details* (*Original language*, *Original
  title*). These stay in Folio: the booklog doesn't have them. `manage.py fill_original` (see
  [server.md](server.md)) fills them in for books already on the shelf.
- **Settings** is a short list: *Account*, *Language*, then *Words* (*Categories*, *Tags*,
  *Roles*), then *Your shelf* (*Lookups*, *As a file*, *About*). Each row opens a page of its
  own with Back (and Escape, and a phone's back gesture) to the list, and Close.
- **Lists, in two languages.** Settings → *Words* → *Lists* (or *Edit lists* beside them) has every
  list, in its order. A list's form has its name, the name of its either-or set and the label of
  its note each in English and in Dutch, the app's language first; with an account and the
  assistant, *Suggest the other* fills in the second from the first, and the page can suggest
  every missing name at once. A list keeps the name it was made with (its other devices and an
  older copy of the app show that one); the names are shown in the app's language wherever the
  list, its set or its note appears. The reading lists are part of the app and named by it.
- **Categories and tags, in two languages.** Both stay on books as the booklog writes them
  (`geschiedenis`, `belgie`); what is shown is a name in the language of the app: in Dutch the
  title of its page in the booklog (*België*), in English a name of its own (*Belgium*).
  *Categories* lists the booklog's categories (D-055, D-057) with both names; they can be named, not
  added or merged, which is the booklog's business. *Tags* lists every tag with how many books
  have it, to search and order by use or name, and *To tidy*: tags spelled two ways
  (*vampiers*, *vampieren*), tags that say what a category or a series says, and, with an
  account and the assistant, tags that mean the same thing in two languages. Each group has
  one button for the lot and the items folded inside, each to merge, remove or leave. A tag's
  page has its names, *Merge into another tag*, its books, and the bin to take it off every
  book. Every merge and removal says how many books it changes, how many of them are in the
  booklog, and can be undone from its toast. Tags are typed by name, in either language, and
  stored as the booklog writes them. In the booklog a merged tag's page goes and its address
  leads to the one it was merged into, a tag taken off every book loses its page, and a Dutch
  name changed here becomes its page's title: one commit, *Woorden uit Folio*, once no post
  has the old tag any more.
- **Roles, in two languages.** Settings → *Words* → *Roles* lists every role with its English
  and its Dutch name; a book shows a role in the language of the app, and a role can be typed
  in either (*narrator* or *stem*). Books keep the Dutch word, as the booklog has it, so
  several roles are written *tekst, beeld*, whatever was typed (*tekst en beeld*, *tekst &
  beeld*). The page shows what the shelf writes otherwise (*Written differently*, with one
  button to write them all the same way) and the words on books that are no role yet: tap one
  to make it the same as a role (it is then remembered as another way of writing it) or a role
  of its own. Renaming a role's Dutch word changes the books that have it. Each of these says
  how many books it changes, and how many of them are in the booklog, where it is published;
  its toast can undo it. Roles of your own sync like lists. With an account and the assistant,
  a missing name can be suggested (in a role's form, or for all missing names at once); a
  suggestion is kept only when you save or accept it. Without them everything else works the
  same.
- **Language, categories and tags.** A book's details say what language its edition is in,
  which of the booklog's categories it belongs to, and its tags (a comma between them). Its
  page shows them quietly under the other details. For a book in the booklog they are
  published like the rest.
- **A book without a cover**, or whose cover is the photograph you took of it in the scanner,
  offers *Find a (better) cover*, which opens the cover (see *The cover, large*). So does a
  picture you chose while it is only on this device. Once you choose another cover, the
  link goes. (Photographs taken before 2.2.4 are recognised by the viewfinder's shape:
  `manage.py mark_cover_photos --user NAME [--dry-run]`.)
- **Going through the copies without a cover.** Filter on *No cover* (under *Other*) and
  **Go through them** shows them one at a time on the cover's own page, in the order of the
  view, so a shelf can be done at a time: *3 of 120*, the book and its copy, the covers the
  catalogues have (Amazon's by ISBN among them), and *Take a photo*, *Paste*. Then *Use this
  cover* (on to the next), *Skip*, or **No cover exists**, which is kept on the copy: it leaves
  the queue and the *No cover* filter for good, so the count can reach zero, and is found again
  under *Other: No cover exists*. Closing the page ends the queue. Settings → *Paper copies* has
  the same for the paper copies listed there. A chosen cover is copied to the server at once
  (signed in), whatever catalogue it came from: no book points at another site for its cover.
- **The menu shows the lists that have books on them.** An empty list is still there to put
  books on, and under *Edit lists*.
- **In the covers view the covers stand on one base line**, whether or not a book has a rating
  or a date under it.
- **Reviews.** A book can have any number, each with an optional reading date and an optional
  rating from 0 to 10, written in Markdown (emphasis, links, quotes, lists, images). The rating
  shown in lists is that of the latest review that gives one. Reviews are searched too.
- **Series.** Books that share a series name form a series: *Series* in the navigation lists
  them all, and a series page shows its books in order. Set the series and its number in a
  book's details; a number such as 4.5 sorts between 4 and 5. Under the head of a series page,
  and under each series' title on a person's page (in the order of their series), the series is
  drawn book by book: a square per book at its number, bluer the better you rated it (orange for
  a 4 or lower, grey without a rating), a dot for a number that isn't on the shelf and "+n" for a
  longer run of them, also before your first book, and after your last one when the series'
  length is known. A square opens its book; on a person's page the books of the series that
  aren't theirs are outlines.
- **Look up a series.** Beside the count on a series page, **Look up** asks Hardcover (signed
  in, where the server has a Hardcover token) and Wikidata (always, from the device) what the
  series has, and opens it number by number: your books in their places, the rest as the
  sources name them (a title in the language of your books where Wikidata has one, else
  Hardcover's; Hardcover's cover). **What I lack** and **All** switch between the missing ones
  and the whole series; a long series comes 40 at a time (*Show 40 more*), covers as they come
  into view. **To read** puts a volume on *To read*, in no place, with the series and its
  number; *All on To read* does them all with one *Undo* (above 10 it asks once more). Beside a
  book of yours, **Take this cover** gives your copy Hardcover's cover, if you want it: book by
  book. At the top: **Length** (found as the highest number anyone knows, yours included, and
  never shown below your own highest; *n in the series* counts a #0, a prequel, too), **Finished**
  (no more volumes are coming) and **Done with it** (what you lack isn't offered any more: the
  strip's dots stay plain). The page then says *finished* or *done with it* (done with it wins:
  whether it is finished no longer matters) in place of *Look up*; the word looks it up all the
  same. A series that is neither is asked again on Hardcover once a
  month; what is new is said quietly, at the head of *Series* (*New on Hardcover: Discworld (1)*)
  and on the series page, until you have seen it. No notifications. **Your numbers win**: where a
  source numbers a book you have differently, that is said (*Hardcover has it as #3*); nothing is
  renumbered. A book of yours with no number that a source places by its title says so (*No
  number yet; Wikidata has it as #1*) with **Make it #1**. A title is recognised with or without
  what is in brackets after it or a subtitle (*Wit'ch Fire (Banned & the Banished)* is *Wit'ch
  Fire*), and by any of its editions' titles. A volume you seem to lack whose title looks much like
  one of your books' (*Witch Storm* for *Wit'ch Storm*: of the series and not yet placed, or in no
  series and by the same writer) asks *Maybe your Witch Storm?*: **Yes, make it #2** gives your
  book the number and the series, with *Undo*; **No** is remembered for the series. Such a volume
  is left out of *All on To read* until you have answered, and **Number them (n)** above the
  books does all of them at once, with one *Undo*; a book in another series is left alone. Where Hardcover names the series otherwise (*Kiekeboe* for *De Kiekeboes*), *Choose
  on Hardcover* (or *Another series on Hardcover*) searches it, and your name stays; *None of
  these* stops asking Hardcover about it. Wikidata takes, of the items the series' name finds,
  the one with most works numbered in it; where that is the wrong one (a franchise, a
  character), *Another item on Wikidata* lists what the name (or another you search) finds,
  each with how many works are numbered in it, to choose the series; *None of these* stops
  asking Wikidata about it. After a source chosen or dropped by hand, its length is worked out
  again from what is left (unless the series is marked finished). Measured on 2026-11-20/21: Hardcover is strong on
  English novel series and weak on Flemish comics (Thorgal in French, half of Suske en Wiske, 7
  Jommeke albums, 4 Kiekeboes); Wikidata has Dutch titles and years for novels and Thorgal (41)
  but numbers few Flemish albums (Suske 39 of 400, Jommeke 4, Kiekeboes 1). Covers are copied to
  the server, like every other.
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
  so it can be straightened later. The straightened cover keeps the photo it was made from and the
  frame it was made with, so *Straighten* opens again on the whole photo, to put a frame that
  was too tight right. The frame starts on the book's edges, found by itself (`corners.js`), and
  the cover comes out in the book's own proportions, also when it was photographed at a slant.
  With books selected, **Straighten covers** (in the selection bar) does a pile at once: each
  photographed cover is shown first, ticked where the edges were clearly found, and *Undo*
  puts them back.
- **The booklog holds what you read.** Deleting a book in Folio leaves its pages on the booklog
  (see [Trash](#trash)); only dropping a book on *To read* takes its page off. A page published
  by mistake is taken off on purpose, quietly at the bottom of the book's *Edit details*:
  **Remove from boeken.tsuk.org** takes all its pages (one per read), with covers and author,
  tag and series pages nothing else uses; on a read's own form, **Remove this read from
  boeken.tsuk.org** takes that read's page. The book and its reads stay in Folio, and those
  reads are never published again. When the first read of a book goes, the next one becomes
  the first (the others become rereads of it). The booklog's history keeps a copy of everything.
- **Covers are kept on the server.** For signed-in users the server keeps a copy of every
  cover, wherever it came from (a book catalogue, a bookshop, a picture on the web): at once
  when you choose it, otherwise a few per sync and every hour (`setup-cover-fetch.sh`), as a
  320-pixel WebP and a large JPEG in `covers/web/`, and the book then points at that copy.
  `manage.py fetch_covers` does a whole shelf at once. Covers you photographed yourself already
  travel with the book.

## Books and their editions

A book is the work you know by its title and writers; its **editions** are the copies of it you
have or read: the hardcover, two softcovers, the audiobook with its voice, the e-book, the
translation. Almost every book has one edition, and then there is nothing to see of this: the
book looks and works as it always did, and its details hold everything, field for field. The
only addition is *Add another edition*, quietly at the bottom of its details.

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
  booklog stays, if only one of them is; otherwise the one whose page was open.
- **In the booklog** a book is one group of posts, one per read: a book's reads in other
  editions are rereads of its first post, each with its own edition's facts. Combining two
  books, or making an edition with reads there a book of its own, regroups those posts with the
  next publish (*Samengevoegd: …*, *Gesplitst: …*): the earliest post is the first read. Two
  books that were both waiting to be read keep one post waiting.
- **A translation** is an edition with a title of its own (*Title of this edition* on its
  sheet). A read of it is a reread of the book in the booklog, a second page there and not a
  second book, under that title; the book itself keeps its own.

## The assistant

*Add a book* offers the ways there are: scan the barcode, photograph the cover, describe the
book, type its ISBN, or fill it in by hand. In the scanner, *No barcode?* offers the same
without the barcode.

Where the server has an assistant (see [Running Folio](server.md#accounts-and-sync-optional)), *Describe it* adds
books from a description: a title, an author, a series, in your own words (*the new Kuang*,
*Commonwealth Saga*, *Piranesi van Susanna Clarke*). The assistant answers with proposals:
title, authors, series and number, publisher, year, pages, the language, categories from the
booklog's own list, a few tags and one dry sentence about the book. A book it doesn't know,
only the title and author of (read off a cover, or in your words), gets no sentence and no tags,
rather than ones guessed from the title; the proposal says so. For each, Open Library is
asked for the ISBN and cover, and only believed when title and author really match; series,
tags and authors are matched with what the booklog already has. You tick the ones you want,
choose the lists they go on, and they are added like any scanned book; with a reading status
they can go to the booklog in the same move.

A photographed cover goes the same way: the photograph (made no larger than 1024 pixels) is
shown to the assistant, which names the book or books on it, and its proposals open as *Is
this the book?*, with a field to say it in words if it got it wrong. When it is nearly right
(the number in the series, say), *Edit before adding* under a proposal opens it in the book form
with everything filled in, to put right and add; Cancel goes back to the proposals. `manage.py try_covers
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

## A public library

With an account, and once the person who runs the server allows it, you can show your library
to anyone, read-only: **Settings → Public library**. Choose which lists are public, tap *Share
my library*, and send the address (`/u/<name>`). The name in it, a title and a line of
introduction (each in English and Dutch) are yours to choose on the same page.

Visitors see a book when it, or one of its copies, is on a public list, and only what public
lists say: reviews, ratings and read dates when *Read* or *Did not finish* is public, progress
when *Reading* is. A list that is not public does not exist for them, a copy that is only on
private lists is left out, and the notes on lists ("lent to …") never go along. They can search,
filter, order, see the statistics and the series and author pages, and with *Add to my own
Folio* a book is proposed for their own shelf. Tapping a book's cover shows it large.

Search engines are asked not to list a public library, but it is not secret: anyone with the
address can open it. *Stop sharing* takes it offline at once. Visitors see what the server has,
so a change shows once it has synced.

## Trash

Deleting a book (the bin on *Edit details*), a copy (on its sheet) or a review puts it in the
Trash, with everything it had: lists, notes, reads, covers, its links to the booklog. Settings →
*Trash* shows what is there and when it went, newest first, each with **Put back** and **Delete
for good**; **Empty the Trash** deletes them all, and when some are older than 90 days, *Empty
what is older than 90 days* only those. Nothing goes by itself. Deleting for good asks first.

- **What deleting is for:** a mistake, or a book on *To read* you no longer want (*Drop*). A
  copy you gave away, sold or lost is not deleted but marked [Gone](#keep-can-go-gone): it stays,
  with its reads.
- **The booklog keeps its pages.** A book you delete keeps its page on boeken.tsuk.org, in the
  Trash and after it is deleted for good; the import leaves it deleted. Only a dropped book's
  page goes, while it is in the Trash, and it is published again when it is put back.
- **A read with a page on the booklog can't be deleted** until that page is taken off (*Remove
  this read from boeken.tsuk.org*, on the read; a few minutes later it can be deleted). Folio
  says so when you try.
- It syncs: a book deleted on one device is in the Trash on the others, and can be put back
  from any of them. A copy of the app from before the Trash can't sync any more until it updates.
- Scanning a book that is in the Trash says so and offers *Put back*; adding it again some other
  way puts it back and adds to it, rather than making a second one.
- A backup file holds the Trash too.

## Backup and restore

Settings → *Your shelf, as a file* → **Back up** saves one file
(`folio-backup-<date>.json`) holding everything this device has, as it keeps it: every book
with its editions, reads, reviews, notes and the lists it is on; every list; every word you
named in two languages (roles, categories, tags, lists) and what you said about a series (how
many books it has). The file says which version of Folio made it and when.

Covers go as the books hold them: an address (Folio's own server, or a catalogue's), or a small
copy of a picture taken on this device. The large cover files the server keeps are not in the
file.

**Restore** reads a backup back. Nothing is written until you have seen what it would do:

- for books, lists and words, how many are new, the same, different, deleted since the file
  was made, and only on this device;
- of those that differ, which to keep: *the newer one* (changed last, the default), *this
  device's* or *the file's*; *Which books differ* lists them;
- what was deleted after the file was made, here or (signed in) on another device, stays
  deleted unless you tick *Bring them back too*. Signed in, the server says what was deleted;
  if it can't be reached, everything not on this device counts as deleted since.

Restoring adds and replaces; it never deletes what is only on this device. One *Undo* (in the
toast, and on the page for as long as it is open) puts everything back as it was. What it writes
syncs like any other change: a book taken from the file keeps its own date when that is the
newer, so a later change on another device still wins; one chosen over a newer copy, or brought
back after it was deleted, counts as changed now.

A file made by a newer Folio than this one is refused, with a word to update first. The JSON
export below can't be read back; only a backup can.

## Export

Settings → *Your shelf, as a file* has two exports of data and three of a website. Each asks
which lists go in, and whether the text of reviews does; the file can then be saved or shared
(the data ones copied too).

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

### As a website

**Export as web pages (HTML)**, **Export for Hugo** and **Export for Eleventy (11ty)** make a
zip with a page for every read: a book read twice has two, the second saying it is a reread of
the first. A book not read yet, being read or given up has one for where it stands.

- **HTML** is a finished site that needs nothing: `index.html` (what you read, newest first,
  under the year), `reading.html`, `to-read.html`, `did-not-finish.html` (and `other.html` for
  books on none of those), each with the others linked at the top, and `style.css`, plain and
  light or dark as the reader's device is. Each book: its cover, title, who wrote it (and
  translated or read it), the series, the day read, the rating in stars, the edition (format,
  publisher, year, pages or length) and the review. Put the folder on any web server, or open
  `index.html` straight from the disk. It speaks the app's language.
- **Hugo** and **Eleventy** get the content only, to go into a site of your own: a Markdown page
  per read (`content/books/` for Hugo, `books/` for Eleventy), the review as its text and
  everything else in YAML front matter: `title`, `date` (the day read; for a book not read, the
  day it was put where it is), `authors`, `contributors` (name and role), `series`,
  `series_number`, `original_title`, `original_language`, `status` (`read`, `reading`,
  `to-read`, `did-not-finish`), `reread_of` (the page of the first read), `rating` (0–10),
  `stars` (0–5, halves), `format`, `publisher`, `year`, `pages` or `duration` and `minutes`,
  `isbn`, `language`, `categories`, `tags`, `lists` (your other lists) and `cover`. Hugo pages
  also get their `slug`; on Eleventy every page is tagged `books`, so `collections.books` holds
  them all. A `README.txt` in the zip says how to switch on author and series pages in Hugo,
  and the covers in Eleventy.
- **Covers**, asked each time: *In the archive* puts the pictures in the zip (`covers/`, for
  Hugo `static/covers/`) and the pages point at them there; *Only linked* leaves them out and
  the pages point at where they are. Signed in, that is always the copy on the server: before
  the zip is made, every cover still at a catalogue or elsewhere is fetched by the server
  first. For Hugo and Eleventy it is the large copy, for HTML the small one. Without an account,
  a cover is linked at its catalogue (a cover you photographed, at its small copy inside the
  page, as a `data:` address); one a catalogue won't hand over to the app is linked even when
  the pictures go in the zip, and the export says how many.

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
  Back it up now and then to keep a copy of your own ([Backup and restore](#backup-and-restore)). Once there is a shelf, Folio asks the browser
  to keep it when space runs low (Chrome and Safari decide by themselves, Firefox asks you);
  settings → *About* says whether it agreed. Without that, a browser may clear it, and Safari
  does after a few weeks unused unless Folio is installed on the home screen.
- Google Books' keyless quota is shared and often exhausted. Open Library still answers, but
  for the best hit rate add a free Google Books API key under the settings icon.
- Nothing about you is collected: no analytics, no advertising, no cookies but those that
  keep you signed in. Lookups go from your device to Open Library and Google Books (and for a
  Dutch or French ISBN the KB or the BnF), which see what is looked up. With an account, what you describe or photograph for the assistant goes
  through the server to OpenAI, and the server keeps the usual log of visits (address, time,
  page).
- Barcode scanning uses the browser's built-in detector on Android and falls back to a
  bundled WebAssembly one elsewhere.
