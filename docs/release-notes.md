# Release notes

What each version of Folio changed, newest first, written from the commit history. A version is
what `APP_VERSION` in `app.js` says (shown at the bottom of Settings); every push to `main`
deploys one. The first number changes when the shape of the data does (2.0: books hold editions),
the second when something is added, the third for a fix or a touch-up. Versions that share a
minor number are folded into one entry. Folio was *Bookscan* until 1.4.

**Old copies can't sync.** The server refuses a sync from an app older than the data it holds:
from before 2.0 (editions) and from before 2.33.0 (the Trash, sync schema 3). Such a copy says
so under Settings and updates itself the next time it is opened. See [server.md](server.md#updating).

Add an entry here with each release (see [development.md](development.md#releasing)).

## 2.44.1 · 2026-11-21

- **Back returns to the list, not to the book.** From a book's page to its author or series,
  and Back: the list you opened the book from, with its filters, order, layout and place on
  the page, rather than the book's page again. A layout chosen on the author's page (covers,
  say) is not carried back to it.

## 2.44.0 · 2026-11-21

- **A series asks about books that look like a volume.** A volume you seem to lack whose title
  is much like one of your books' (*Witch Storm* for *Wit'ch Storm*) asks *Maybe your Witch
  Storm?*: *Yes, make it #2* numbers your book, with *Undo*; *No* is remembered. *All on To read*
  leaves such a volume out until you have answered.

## 2.43.0–2.43.1 · 2026-11-21

- **Back returns to the screen you left, as you left it.** Each view keeps its search, how far
  down it was and the book whose page was open; Back from an author or series reached from a
  book's page opens that book again.
- **A series knows your books by more of their titles.** A volume Hardcover or Wikidata names
  *Wit'ch Fire* is your *Wit'ch Fire (Banned & the Banished)*: what is in brackets is left out
  when titles are compared, and your editions' titles count too.

## 2.42.0 · 2026-11-21

- **Numbers for books in a series that have none.** Where Hardcover or Wikidata places a book of
  yours in a series by its title, the series' window says so (*No number yet; Wikidata has it as
  #1*) with *Make it #1*, and *Number them (n)* does all of them at once, with one *Undo*.

## 2.41.0–2.41.3 · 2026-11-21

- **Filters with many values are one chip.** More than three values of a filter, chosen or left
  out, show as one chip under the search box (*Category: 17 left out*) that names them when
  pointed at and takes them all off at once.
- **Another Wikidata item for a series.** When Wikidata's match for a series is the wrong item (a
  franchise, a character), *Another item on Wikidata* lists what the name finds, each with the
  number of works numbered in it, to choose from.
- **The header stays within reach on phones and tablets.** Header, search and filter slide away
  while you scroll down and come back when you scroll up.

## 2.40.0–2.40.2 · 2026-11-21

- **Look up a series.** One quiet *Look up* on a series page asks Hardcover and Wikidata what the
  series has and opens it number by number: your books in their places, the rest as the sources
  name them, to put on *To read* one by one or all at once. The series' length never shows below
  your own highest number, and can be marked *Finished* or *Done with it*.
- A series page counts a `#0` (a prequel) in *n in the series*.
- **Propose categories** is back: it comes with any selection of books, those without a category
  first, instead of only books that have none (every book has a category now).

## 2.39.0–2.39.1 · 2026-11-20 / 21

- **Series from Hardcover.** A series page can look itself up on Hardcover (by name, or chosen
  among what it proposes, your name staying); the strip's dots get names and open the volume
  with *Want it*. Checked monthly for series not marked finished, with what is new said quietly
  at the head of *Series*. Needs `HARDCOVER_API_TOKEN` on the server.
- 2.39.1: a series' books are asked from their side, most-read first, so box-set flags no longer
  hide volume 1 of a series (*Every Heart a Doorway*) and long series aren't cut short.

## 2.38.0 · 2026-11-20

- **The cover queue.** With the *No cover* filter on, *Go through them* shows the copies without a
  cover one at a time, in the view's order, with the catalogues' covers, *Take a photo* and
  *Paste*; *No cover exists* takes a copy out of the queue for good.

## 2.37.0–2.37.3 · 2026-11-20

- **Page counts where the catalogues have none.** After a scan, if Google Books and Open Library
  give no pages, the app asks Hardcover through the server, then takes the median of the Open
  Library work. `manage.py fill_pages` does the same for a shelf (2.37.1 and 2.37.2 make it say
  what it is doing and fix a crash on a book Open Library has no median for).
- A typed ISBN has an *X* key beside the field, for ten-digit ISBNs ending in X.
- 2.37.3: selecting on a wide screen no longer makes the toolbar jump; the selection bar has a
  row of its own.

## 2.36.0–2.36.1 · 2026-11-20

- **A publication line in words.** An edition can say its publication in a line of its own, for
  what publisher, year and pages can't say (a run spread over publishers and volumes, who drew
  which issues). Published to the booklog as `publication:` and imported back.
- 2.36.1: a new cover in the booklog is named apart whatever the case (`bone-2.jpg` instead of
  `bone.jpg` next to `Bone.jpg`, which are one file on Windows and a Mac).

## 2.35.0–2.35.1 · 2026-11-20

- **National catalogues.** A Dutch or Flemish ISBN (978-90, 978-94) is also looked up in the KB,
  a French one (978-2, 979-10) in the BnF, on the device and on the server; their publisher, year,
  pages and language win. A scan says which catalogues don't know the ISBN or didn't answer,
  with *Try again*. `manage.py fill_from_national` fills what a shelf lacks.
- 2.35.1: a comic run from the booklog (`issues`) counts as its issues times the pages of one, in
  *Length* and in the statistics.

## 2.34.0 · 2026-11-20

- **Selecting across searches.** The selection bar says how many selected books the search or a
  filter hides, and a tap shows only the selected ones under a *Selected* chip.

## 2.33.0–2.33.2 · 2026-11-20

- **Trash.** Deleting a book, a copy or a review puts it in the Trash with all it had, kept until
  emptied (Settings → Trash: *Put back*, *Delete for good*, *Empty*, *Empty what is older than 90
  days*). Deleting no longer touches the booklog, except dropping a book on *To read*, whose page
  goes while it is in the Trash. A read that has a booklog page must have it taken off first.
  Sync schema 3.
- 2.33.1: *Straighten* gives a cover photographed at a slant its own shape instead of one too
  wide.
- 2.33.2: on a wide screen *Add a book* is a quiet row at the top of the sidebar, not a gradient
  button over the covers.

## 2.32.0–2.32.1 · 2026-11-20

- **Keep, can go, gone.** A paper copy says whether it is still here. *Can go* shows a soft amber
  bookmark (a tag in the list and cards views); *gone* fades the cover with a small ghost and
  takes the copy off its places. A gone copy keeps its reads and its page in the booklog.

## 2.31.0–2.31.8 · 2026-11-20

- **A screensaver** of the covers on the shelf (the place, filters and search as they are), as a
  wall seen from above that the camera drifts over, with covers turning over to other books. Full
  screen where possible, keeps the screen awake, ended by a key, a click or a touch. It is hidden;
  nothing in the interface points to it.

## 2.30.0 · 2026-11-20

- **Nightly copies on the server.** The database is copied every night (checked, compressed, 14
  kept; none on a night when nothing worth keeping changed) together with the photographed covers;
  Settings → About says when the last copy was made. A script on a PC fetches them.

## 2.29.0 · 2026-11-20

- **Backup and restore.** Settings → *As a file*: *Back up* saves every book, list and word on
  the device; *Restore* shows what it would add, replace or leave before writing anything, lets
  you choose between the newer, this device's or the file's, keeps what was deleted since deleted
  unless asked, and has one *Undo*.

## 2.28.0–2.28.2 · 2026-11-19

- **Settings → Paper copies.** Paper copies without a cover whose book has another copy with
  one, with those covers to choose from; and paper copies read in the booklog that have no ISBN,
  grouped by where they are, to scan again.

## 2.27.0 · 2026-11-19

- A barcode scan fills in a copy of that format that said nothing yet (the paperback added from
  an order) instead of adding a second one. In a bulk edit, a list of where a copy is goes on
  the edition each row shows.

## 2.26.0 · 2026-11-19

- **Propose categories.** For selected books it looks up what kind of book each is (your shelf,
  the assistant, your shelf less strictly, the catalogues' subjects), says which way it went,
  ticks the sure ones, and gives the ticked books their categories with *Undo*.

## 2.25.0 · 2026-11-19

- A scanned book gets its categories from the shelf where it is clear: those of the other books of
  its writer, when at least three share them and three in four agree.

## 2.23.0–2.24.0 · 2026-11-19

- **The series strip.** A series is drawn book by book on its page and on a person's page: a
  square per book at its number, bluer the better it was rated, a dot for a number you lack.
- 2.24.0: it shows what you lack before your first book and after your last, once you say how many
  books the series has.

## 2.22.0–2.22.3 · 2026-11-19

- **Two more statistics**: *Published per year* (paper above the line, e-books and audiobooks
  below) and *In translation* (ribbons from the language written in to the language of the
  edition). The list of writers with the most books is gone.
- 2.22.1: the selection bar no longer cuts its count beside the Dutch labels.
- 2.22.3: two categories more, *koken* and *informatica*; `manage.py add_tags`.

## 2.21.0–2.21.2 · 2026-11-19

- **Straighten covers.** A photo's frame starts on the book's edges, found by itself
  (`corners.js`); selected books with photographed covers can be straightened at once, each shown
  first, with *Undo*. The straightened cover keeps the photo it was made from and the frame, so
  a frame too tight can be put right (2.21.1). 2.21.2 finds the faint edges of a pale cover.

## 2.20.0–2.20.3 · 2026-11-18 / 19

- *Written in* becomes **Original language**: one dropdown on the edit screen and checkboxes in
  the filter; languages are named in the language of the app everywhere (2.20.1).
- 2.20.2: started at *Photograph the cover*, the scanner stays there for the next book.
- 2.20.3: a book the assistant sees on a cover that is already on your shelf can be ticked after
  all, as another copy of that edition.

## 2.19.0–2.19.4 · 2026-11-18

- The three-pane layout (2.17, 2.18) is gone again. Instead, a book's dialog on a wide screen keeps
  its top at one height, so turning from one book to the next doesn't make it jump.
- 2.19.1: opening a sheet no longer shifts the books behind it sideways.
- 2.19.3–2.19.4: every cover is kept large on the server too; a visitor of a public library taps
  a cover to see it large, in a lightbox.

## 2.16.0–2.18.1 · 2026-11-18

- **A public library.** With an account, allowed in the admin, Settings → *Public library* shares
  a read-only page of the lists you choose at `/u/<name>`, with a name, title and introduction in
  two languages. Visitors see only what the public lists say (never the notes). Search engines are
  asked not to list it.
- 2.17.0 and 2.18.0 tried three panes on desktop, for a public library and then for your own
  shelf; both were reverted in 2.19.0.
- 2.18.1: a title with one very long word wraps instead of pushing Close off a phone's screen.

## 2.15.0 · 2026-11-18

- The open book is in the address (`book=…`): a reload comes back to it, a link opens it, Back
  closes it and turning to the next book replaces the step.

## 2.14.0 · 2026-11-18

- On a wide screen a sheet is a dialog in the middle of the window, not a sheet from the bottom.

## 2.13.0 · 2026-11-18

- **ISBN / ASIN**: one field for an edition's ISBN or Amazon number (Audible, Kindle), kept apart
  as `isbn` and `asin`.

## 2.12.0 · 2026-11-18

- **By author** puts a writer's series together and in their own order, series by their first book
  and books on their own by date, after any series still running when they came out.

## 2.11.0 · 2026-11-17

- **Not the same book.** A possible duplicate can be told apart, on the book's page or in
  *Combine*, and stays apart.

## 2.10.0–2.10.1 · 2026-11-17

- **Lists in two languages**: a list's name, its set's and its note's, each in English and Dutch.
- 2.10.1: a tag merge or removal shows at once; a tag that repeats a category or series comes off
  only the books that have it.

## 2.9.0–2.9.2 · 2026-11-17

- **Settings as a list of pages**; categories and tags in two languages; tags to tidy: merge,
  take off, name.
- 2.9.1: a barcode is a paper copy, so an audiobook or e-book with the same ISBN becomes another
  edition; two volumes of a set are never one book. 2.9.2: two different Open Library works are
  two books, even with one title.

## 2.8.0–2.8.1 · 2026-11-17

- **Original language and original title**: a book says which language it was first written in
  and what it was called then, looked up when it is added (Open Library, Wikidata, the assistant).
  Kept in Folio, not published. `manage.py fill_original` fills a shelf.
- 2.8.1: on a phone the shelf starts higher, with the name, count, filter, order and views each on
  one line and adding a book as a plus in the corner.

## 2.7.0–2.7.2 · 2026-11-17

- **Filters can leave books out**: a second tap on a choice is *not* (struck through), a third lets
  it go. 2.7.1: the filter sheet holds still while it is open.

## 2.6.0 · 2026-11-17

- *Year read* is one span, from–to, chosen with a slider over a column per year.

## 2.5.0 · 2026-11-17

- Reads per year in clearly different format colours, and as a stream beside the columns.

## 2.4.0 · 2026-11-17

- **Roles in two languages**: Settings → *Words* → *Roles* tidies how roles are written, sorts out
  words that are no role, and shows each role in the app's language.

## 2.3.0–2.3.1 · 2026-11-17

- **Statistics**, a fourth view, counting what a place shows with its filters and search.

## 2.2.0–2.2.6 · 2026-11-16 / 17

- A content security policy, a privacy note and an as-is line; text recognition reads only the ISBN
  printed beside a shop barcode (2.2.0).
- A page loaded as an old copy next to a newer script reloads once, so a new service worker taking
  over no longer leaves the app blank (2.2.1).
- The assistant gives a book it only read the title of no made-up sentence or tags (2.2.2), and a
  proposal can be put right with *Edit before adding* (2.2.3).
- *Find a better cover* is offered for a cover photographed in the scanner (2.2.4); combining a
  translation keeps each copy's title (2.2.5); *Also add to the booklog* starts unticked (2.2.6).

## 2.1.0–2.1.2 · 2026-11-16

- A translation is a reread with a title of its own; books combined or split in the app are
  regrouped in the booklog.
- A scanned or typed ISBN brings the edition's language along, from the catalogue or else from the
  ISBN's registration group.

## 2.0.0 · 2026-11-16

- **Books and their editions.** A book holds the editions of it you have or read (hardcover,
  paperback, audiobook with its voice, translation), each with its own facts, cover, people and
  the lists of where that copy is. A read is of one edition. Reading status belongs to the book,
  every other list to an edition. A second edition found by scanning is added to the book it
  belongs to (*Keep separate* if not). The app and the server upgrade old records the same way,
  tested against shared fixtures; the shelf was converted once with `manage.py to_works`. This
  replaces 1.26's "another version is a book of its own". See
  [work-edition-plan.md](work-edition-plan.md) and [cutover-2.0.md](cutover-2.0.md).

## 1.29.0 · 2026-11-16

- **Export for Goodreads, StoryGraph and the like**: a CSV in Goodreads' layout that StoryGraph,
  BookWyrm, Hardcover, LibraryThing and Goodreads import. A free way to put your reading online.
- On a wide screen the search, filter and view controls stay at the top while the books scroll;
  Escape is Cancel everywhere; series sort without their article (*The Expanse* under E).

## 1.28.0–1.28.1 · 2026-11-16

- **Bulk edit.** *Select* books (Shift-click for a range), then one sheet changes reading status,
  lists, authors, series, publisher, format, language, categories and tags for all of them, with
  *Undo*. Language, categories and tags are published to the booklog.
- A short README, `server/.env.example`, the MIT license.

## 1.27.0 · 2026-11-15

- A cover opens large, with every way to replace it in one place; deleting a book reaches the
  booklog.

## 1.26.0–1.26.2 · 2026-11-15

- **An Audible link adds that audiobook**, from Audible's catalogue, without the assistant.
- Another version of a book you have is a book of its own (replaced by editions in 2.0); books
  found by the assistant get categories.

## 1.25.0–1.25.3 · 2026-11-15

- A book has a *Format* instead of "Read as": you may have it and not have read it. A review's
  edition says its format too. Install is offered only on a phone or tablet.

## 1.24.0 · 2026-11-15

- A new book starts on the lists the last book added went on. The assistant has no hourly limit;
  the spending cap on its key is enough. Another copy of a book you have is a book of its own
  (replaced by editions in 2.0).

## 1.23.0–1.23.1 · 2026-11-15

- **Places, filters, order**: a new way round the shelf. The booklog's *audiobook* and *kindle*
  categories are gone: format says it.

## 1.22.0 · 2026-11-15

- Each book is paper, e-book or audiobook; covers stand on one base line.

## 1.21.0–1.21.3 · 2026-11-15

- **People with roles**: writers, voices, artists, translators, each per read. A book edited in
  the app loses the booklog's last refusal; a book taken off its reading list is no longer on its
  way to the booklog.

## 1.20.0 · 2026-11-15

- The assistant reads a photographed cover; authors are matched to the booklog's; a cover tint;
  cover search.

## 1.19.0 · 2026-11-15

- Add a book in whichever way (scan, photograph, describe, type, by hand); a calmer, squarer look.

## 1.18.0 · 2026-11-14

- A new look and icon, from one picture: indigo ground, amber for the main button, a deeper dark
  mode.

## 1.12.0–1.17.0 · 2026-11-14

- Every read has its own edition and cover (1.12). Folio is in the phone's share menu: a cover, a
  booklog page, a book to add (1.13). The reading lists are part of the app and each offers the
  book's next step (1.14). A book opens by the slug of its page in the booklog (1.15). Turn from
  one book to the next; empty lists leave the menu (1.16). Progress as a percentage too (1.17).

## 1.9.0–1.11.0 · 2026-11-14

- **Publishing to the booklog**: what changes in the app is written back to boeken.tsuk.org as
  commits (1.9), and a book can be added to it from the app (1.10). **The assistant**
  (boeggn's intake, behind an OpenAI key) proposes books from a description; Back works the same
  everywhere (1.11).

## 1.3.0–1.8.0 · 2026-11-14

- **Lists** of books: library, to read, reading, read, lent out, and your own (1.3). Renamed
  **Folio**, in English or Dutch (1.4). **Import of the boeken.tsuk.org booklog** (1.5). Reviews, three
  views, covers in their own shape and kept on the server (1.6). Series (1.7). A cover replaced by
  pasting, dropping or choosing a picture (1.8).

## 1.2.0 · 2026-11-14

- **Optional accounts** that sync the shelf to a Django server; deploys to the VPS from GitHub
  Actions on every push.

## 1.0–1.1.0 · 2026-11-14

- **Bookscan**: a PWA that catalogues books by the ISBN barcode on the back cover, looked up in
  Open Library and Google Books. Older paperbacks with only a shop barcode work too: the printed
  ISBN beside it is read with text recognition (tuned for OCR-A and OCR-B), looking above and
  below the barcode.
- 1.1.0: installed copies pick up a new deploy by themselves.
