# Books and their editions: design and build plan

Written 2026-11-16 for Michel, to be built by a later session (Opus 5.5). Nothing in this
document is built yet. It was written against app version 1.28.0 (commit `fa2ecfa`, the one
that added bulk edit); the branch had reached 1.29.0 by the time it was pushed. It names
functions, never line numbers, because the files keep moving. "As today" means: as in the
build the work starts from.

**How to use it.** Read sections 1 to 6 before touching code: they are the design. Section 7
is the build, in stages; each stage ends with a "done when" list that must hold before the
next one starts. Section 8 is the cut-over on production, which only Michel starts. Section 9
lists what Michel has not confirmed yet: ask him those before building the part they decide.

---

## 1. The problem

Folio keeps one record per book. "The same book in another form" exists today in three
unrelated ways, depending on how the book arrived:

| Situation | How it is kept today | Where |
| --- | --- | --- |
| A reread in another form (paperback first, audiobook later) | an `edition` object embedded in the review of that read | `openReviewForm`, `mainEdition`, `editionCovers` in `app.js`; `edition_of`, `review_sum` in `server/shelf/boeken.py` |
| The audiobook of an e-book you have, not read yet | a second book record that points at the first with `versionOf` | `versionOfShelf` and `openDescribe` in `app.js`; `split_versions`, `version_claims` in `boeken.py`; `is_version`, `plan_new(reread_of=…)` in `publish.py` |
| A second copy | a second book record with no link at all | `addCopy`, `OF_ONE_COPY`, `onIsbn` in `app.js` |

On top of that, a book's own publisher, pages, format, cover and people are silently "those
of its latest read" (the import in `boeken.books()` builds them that way), so what a book
*is* changes with what was read last.

Michel's request: separate the work (*Equal Rites*) from the copy (a hardcover, two softcover
editions, an audiobook with extra people, an e-book); translations must fit (*The Painted
Bird* and *De geverfde vogel*); and it "would need to be very carefully executed so we keep
excellent UX".

## 2. What the data looks like (measured 2026-11-16)

From the booklog repository (`origin/main` of mvuijlst/boeken, 1,477 posts):

- 1,458 books. 1,441 have one read; 15 have two; 2 have three.
- All 17 books with more than one read were read in editions that differ (15 in another
  format, 14 with another cover and publisher, 13 with other people, 12 with another ISBN).
- 1,037 posts carry `olid`, and it is always an Open Library **work** id (`OL…W`). The
  booklog's own checker already treats it as the identity of a work.
- One unlinked duplicate: *The Blacktongue Thief* is two posts on *To read* with the same
  `olid`.
- Languages: 1,223 English, 113 French, 40 Dutch, 2 German. 18 posts name a translator.

From a local copy of Folio's database (older than production, same shape): in 1,435 of 1,447
booklog books the book's own facts equal its latest read's edition exactly. The other 12
differ only because the import fills a gap from an earlier read (11 audiobooks that carry the
paperback's page count, one cover).

Not measured: the books that are only in Folio (about 250, mostly scanned paper books, and
growing: Michel has only just started scanning his library). He expects more multi-edition
books from that, "but not hundreds". Reading production's database was not permitted from
the design session; stage 1's migration command reports these numbers in its dry run.

**What follows from the numbers.** Almost every book has one edition and must look and
behave exactly as it does today. The design is for a few dozen multi-edition books, growing
slowly, and it must cost the other 1,400 nothing.

## 3. Decisions

Each is settled for this plan. Those marked *(Michel to confirm)* are Claude's choice on a
point he was not asked about, or asked and has not answered; see section 9.

1. **Two levels: a book and its editions.** No third "copy" level. Two identical paperbacks
   are two edition entries of one book. In the interface the words are *book* and *edition*
   (Dutch: *boek*, *editie*); "work" is a word for this document and the code only.
2. **The existing book record becomes the work, and its editions nest inside it.** Records
   keep their ids, their place in sync, their link to the booklog. A separate record per
   edition was considered and rejected: every list, count, filter, order and "next book"
   would have to group records first, and facts of the work would be duplicated across them.
3. **A read is of one edition** and points at it by id. Editions exist without a read (the
   audiobook you bought and have not started).
4. **Reading status belongs to the book; every other list belongs to an edition.**
   *To read*, *Reading*, *Read*, *Did not finish* (and any list a user put in that either-or
   set) say something about you and the work. *Library*, *Lent out* and lists of your own say
   where a physical or digital copy is. *(Michel to confirm.)*
5. **A row on the shelf is always a book.** Where you are and what you filter on decides
   which of its editions the row shows. *(Michel to confirm: the first opinion said rows in
   Library would be editions; one kind of row everywhere is simpler and counts stay honest.)*
6. **A book you have finished stays under *Read* while you plan or do another read of it.**
   Today it leaves *Read* for *To read* or *Reading*; with a second edition that case becomes
   common, and since 1.26 the "other version" kept both visible. *(Michel to confirm.)*
7. **Adding never asks.** The same ISBN is the same edition: "already on your shelf", with
   *Another copy*. The same work (same `olid`, or same title by the same first author) is
   added as another edition of that book, and the card that says so has *Keep separate*.
   A translation is not recognised by title: it is added from the book's page
   (*Add another edition*) or joined afterwards (*Combine with another book*).
8. **The booklog does not change shape.** A book is still one `rereadOf` group, one post per
   read. `versionOf` and everything built around it goes away, because a version is now an
   ordinary edition of the same record.
9. **Every edition-level change is reversible from where it was made**: adding as an edition
   (Keep separate), combining (Undo), splitting (Undo), deleting an edition (Undo).

What survives from 2026-11-15 ("another version is a book of its own"): a version keeps its
own format, cover, people, lists of where it is, and reads. What changes: it is no longer a
second row with its own reading status; it is an edition inside the book.

## 4. The model

### 4.1 One record

The `Book` model, its table, the sync protocol and `book.id` stay. A record in the new shape
(`v: 2`) looks like this; a comment says where each part came from.

```js
{
  id, added, modified,
  v: 2,                                   // new: the shape of this record

  // The work
  title,                                  // the title you know it by
  author,                                 // who wrote it, "A, B": as today
  series, seriesNumber, seriesLabel,      // as today
  categories, tags, olid, issues,         // as today
  rating,                                 // as today: of the latest read that gives one

  // You and the work
  lists: { 'to-read': { at } },           // ONLY lists of the reading-status set
  main: 'e2',                             // optional: the edition the open read is of (see 4.3)
  pagesRead, durationLeft, percentRead, progressUnit,   // as today: progress of the open read
  reviews: [
    { id, date, rating, text,
      ed: 'e1',                           // was: an embedded `edition` object
      dnf: true,                          // optional, new: this read was given up (see stage 3)
      boeken, url, sum }                  // as today
  ],

  // Its editions: at least one, always
  editions: [
    { id: 'e1',
      title,                              // optional: only when this edition is titled differently
      format, language, publisher, date, pages, duration, isbn,
      cover, coverRatio, coverSource, coverFull, thumb,
      people,                             // optional [{name, role}]: everyone on this edition, as today
      lists: { library: { at }, lent: { at, note } },   // every list NOT in the reading-status set
      added }
  ],

  // The booklog: as today, minus versionOf
  boeken, url, boekenState, boekenWanted, boekenError, dropReads,
  pending, unresolved                     // as today
}
```

Fields that **move** from the top level into an edition: `format`, `language`, `publisher`,
`date`, `pages`, `duration`, `isbn`, `cover`, `coverRatio`, `coverSource`, `coverFull`,
`thumb`, `people`, and every entry of `lists` that is not in the reading-status set.
Fields that are **removed**: `versionOf`, and `edition` inside a review.

People stay as they are stored today: `author` names the writers; an edition's `people`,
where present, is everyone on that edition with what they did. Nothing is split into
"people of the work" and "people of the edition" in storage; the split is made when showing
(section 5.1).

### 4.2 Invariants

These hold for every stored `v: 2` record. One function on each side enforces them on every
save (`settle` in the client, its counterpart in `server/shelf/works.py`), and tests check
them on fixtures.

1. `editions` has at least one entry; edition ids are unique within the record.
2. Every review has `ed`, and it names an existing edition.
3. `main`, when present, names an existing edition.
4. None of the moved fields exists at the top level.
5. `lists` at the top level holds only reading-status lists; an edition's `lists` holds none
   of them. (A list is in the reading-status set when its `group` is `READING`.) If code
   writes a list in the wrong place, `settle` moves it: a possession list found on the work
   goes to the main edition, a status list found on an edition goes to the work.
6. No `versionOf`, no `review.edition`.

### 4.3 Which edition a book "is" at a given moment

Three small pure functions; everything else goes through them.

- `mainEdition(work)`: `work.main` if it names an edition; otherwise the edition of the
  latest dated read; otherwise `editions[0]`. This is the edition the reading status and the
  progress are about, the one a new read starts from, and the face of the book where nothing
  else decides.
- `work.main` is **set** when a planned or running read is of a particular edition (start
  reading, choose "I'm reading this one", add an edition while the book is on *To read* or
  *Reading*) and **removed** when that read finishes or the book leaves *To read* and
  *Reading*. For a finished book the face then follows from its latest read.
- `faceEdition(work, place, filters)`: the edition a row shows. Among the editions that are
  on the place (when the place is an edition list such as *Library*) and that pass every
  edition-level filter (format, language, lists of your own, "no cover"), the main edition
  if it is among them, else the first. When none qualifies the book is not in that place.
  On *Read* and *Did not finish* the starting point is the edition of the latest dated read
  instead of the main edition: a book finished as an e-book shows the e-book there, even
  while its audiobook waits on *To read*.

`shelves(work)` keeps its meaning for everything that only asks "is this book on that list":
it is the union of the work's lists and all its editions' lists (earliest `at`; notes of
several editions joined). Writing goes through one helper that knows which level a list
belongs to (`putOn(work, edition, listId, entry)` / `takeOff(…)`), never by assigning
`book.lists` directly.

### 4.4 Sameness

- **Same edition**: the same ISBN.
- **Same work** (`findWork(candidate)` in the client): the same `olid` when both have one; or
  the same title (compared with the work's title *and* each edition's title) by the same
  first writer, unless both say where they stand in a series and that differs. Titles are
  compared without case, accents or punctuation, and one may be the other with a subtitle
  after it (*Ash* and *Ash: A Secret History*): catalogues add subtitles, the booklog mostly
  does not. A differing `olid` does not veto a title match: Open Library has duplicate work
  records.
- Anything else, translations included, is the same work only when Michel says so.

## 5. What Michel sees

The rule for all of it: **a book with one edition looks and works exactly as today.** Put a
screenshot of the build you started from next to the new build for a one-edition book; any difference is a bug,
with one exception named in 5.1.

Design constraints that are his and apply to every new element: no rounded boxes with one
coloured edge; small radii; deep dark mode with bright text; one quiet main button per
screen; rarely used actions stay out of permanent view. Reuse what exists (`.way` rows,
`.review-head`, chips, `sheetHead`, `card`, toasts with Undo). No new visual language.
Every new sentence needs its Dutch in `lang-nl.js` (*editie*, *audioboek*, never
*luisterboek*).

### 5.1 A book's page (`openBook`)

One edition: as today, plus one quiet link beside *Edit details*: **Add another edition**.
(That link is the exception to "no difference".)

More than one edition:

- The head is the work: title, writers, series, reading status, progress and actions as
  today. The cover is the main edition's. The line under the title (`metaLine`) describes
  the main edition.
- People in the head: the writers, then anyone who is on *every* edition (a comic's artist
  and colourist). People who are on some editions only (a narrator, a translator) are named
  with their edition.
- A section **Editions**, between the actions and the reviews: one compact row per edition.
  Small cover; one line built like today's `editionLine` (*Audiobook · 11u 36m · Audible ·
  2018 · stem: Roy Dotrice*); its own title and language first when it has another title
  (*De geverfde vogel · NL*); the lists it is on, as the usual tags (*Library*, *Lent to:
  Jan*); when it was read, short (*May 2013 · Apr 2018*). While the book is on *To read* or
  *Reading*, the main edition's row says so (*reading this one*).
- Tapping a row opens that edition's sheet (5.3).
- Reviews: each read shows its edition's small cover and line, as multi-read books already
  do.

### 5.2 *Edit details* (`openBookForm`)

One edition: the form as it is today, field for field. Saving writes the work's fields to
the work and the rest to the one edition. Nobody can tell there are two levels.

More than one edition: the form holds what is the work's: title, authors (the writers),
series and number, categories, tags, reading status. Format, publisher, year, pages or
length, ISBN, language, cover, other people and the lists of where a copy is are on each
edition's sheet. Changing the writers changes them on every edition; people with a role
that an edition has stay.

### 5.3 An edition's sheet (new)

Opened from its row. The same fields the book form has for an edition, with the same
controls (`formatPicker`, `coverControl`, `peopleEditor`, `listPicker` limited to
non-status lists), plus an optional *Title of this edition* that is empty unless it differs.

Actions, quiet, at the bottom:

- *I'm reading this one* (only while the book is on *To read* or *Reading* and this is not
  the main edition): sets `main`.
- *Make it a book of its own*: splits the edition, with its reads, into a new book. Undo in
  the toast.
- Delete (trash icon, as elsewhere): only offered when the book has another edition. An
  edition that was read says first that its reads go with it (for booklog reads: their pages
  too, through the existing `dropReads`).

### 5.4 A read (`openReviewForm`)

The *Edition read* box stays collapsed with its summary line. Opened, it is a choice instead
of a form:

- the book's editions, the main one chosen for a new read;
- *Another edition…*, which opens a new edition's sheet (starting from the chosen edition's
  facts, format first) and then returns to the read with it chosen.

Editing an edition's facts is done on the edition's sheet, reachable from the box
(*Edit this edition*). This removes the old trap where correcting the publisher inside a
review silently made a second, slightly different edition.

### 5.5 Adding (scanner, cover photo, description, shared link, Audible link, ISBN, by hand)

One function decides, for every way of adding: `findWork(candidate)`.

| What comes in | What happens | What is said |
| --- | --- | --- |
| An ISBN that an edition on the shelf has | nothing is added; the lists being scanned to are applied to that edition (status lists to its book), as today | today's card (*Already on…* / *Put on…*), with *Another copy*: a second entry of the same edition in the same book |
| The same work, another edition | added as an edition of that book, on the lists being added to; if the book is on *To read* or *Reading* the new edition becomes `main` only when a status list was among them | *Added to “Equal Rites” as another edition*, with *Undo*, *Edit*, **Keep separate** (which makes it a book of its own) |
| Anything else | a new book with one edition | as today |

In *Describe it* and for shared links, a proposal that is another edition of a book on the
shelf says so on its row (today's *Another version: you have it as e-book* line) and stays
ticked. What it lacks (series, language, categories, tags) is no longer copied from the
other book: it is the same record now.

A book saved offline by ISBN alone (`pending`) is a book of its own until it is looked up;
`retryPending` then applies the same rule, and says so in a toast with *Keep separate*.

From a book's page, *Add another edition* opens the same ways of adding with that book as
the target: whatever is found becomes an edition of it without matching. This is the way in
for translations.

A scanned book should carry the Open Library work id as `olid`, so it matches by work and
not only by title. The lookup the scanner uses (`api/books?…&jscmd=data`, read by
`fromOpenLibraryEdition`) may not return it; `https://openlibrary.org/isbn/<isbn>.json`
does, under `works[0].key`. Check what the first call really returns before adding a second
one, and never let a failed second call hold up the scan.

### 5.6 Combining and finding twins

- *Combine with another book…* (at the bottom of *Edit details*): pick the other book from a
  search list; its editions and reads move into this one, its record is deleted. The toast
  has Undo. The survivor is the one in the booklog if only one is; otherwise the one whose
  page was open.
- Until stage 5: when both are in the booklog, or when splitting an edition whose reads are
  in the booklog, the app says plainly that this is not possible yet, and does nothing.
- *Filter → Other → Possibly the same book*: books that share an `olid` or a title and first
  writer with another book. This is how Michel reviews what the migration did not dare to
  merge, inside the places → filters → order structure he already has. No banners, no
  nagging.

### 5.7 Lists, filters, order, search

- Counts are books. A place lists the books that have an edition there (or, for reading
  lists, are there themselves).
- Filters on format, language, lists of your own and cover test editions; a book passes when
  **one** edition is on the place and passes all of them, and that edition is the row's
  face. Filters on status, category, year read and rating test the book.
- List and cards: the row's cover and `metaLine` are the face edition's; a book with more
  editions adds *· 3 editions* to that line. Covers view: the existing stack of covers, now
  built from the editions (the face in front, at most three).
- Order by year published and by length use the main edition. Search covers every edition's
  title, publisher, ISBN and people.
- A person's page (`everyoneIn`) finds a book through any edition.
- Sharing a picture as a cover asks which edition (it asked which read).
- Export: the nested shape, with list names resolved as today.

## 6. The booklog

### 6.1 The flat view

`publish.py` is 1,200 lines of careful, tested logic written against the old shape, and the
old shape is exactly "the work plus its main edition at the top, each review with its
edition embedded". So the server gets a small module, `server/shelf/works.py`, with:

- `flat(data)`: a `v: 2` record as the old shape: the main edition's facts at the top level
  (the moved fields of 4.1), `lists` as the union, each review with `edition` filled in from
  the edition it points at. A record without `editions` is returned as it is.
- `upgrade(data)`: an old record as `v: 2` (6.4). Idempotent.
- `settle(data)`: enforces the invariants of 4.2.
- helpers to find an edition, the main edition, and to write booklog bookkeeping back.

Planning (`plan_book`, `plan_new`, `plan_drop`, `plan_reads_gone`, `changed_keys`,
`is_pending`, `needs`, `state_of`, `review_sum`, `in_step`) reads `flat(row.data)`. What
publishing writes back to a record (`stamp`, `settle_reads_gone`, the `boeken`/`url`/`sum`
links, `boekenState`, `boekenError`) is written to the stored `v: 2` record, with sums and
state computed from its flat view. `kept_from_publishing` in `views.py` works on the stored
shape and only loses `versionOf` from its key list.

### 6.2 Publishing: what changes

- **Removed**: `split_versions`, `version_claims`, `is_version`, the `reread_of` argument of
  `plan_new`, the "twin is another version" branch in `run`, and `versionOf` everywhere.
- **A new post takes the main edition's facts.** `reread(shelf=…)` (a finished book goes
  back to *To read* or *Reading*) today copies `BOOK_FACTS` from the latest post. It must
  apply the main edition over that, as `reread(review=…)` does for a review's edition:
  publisher, year, pages or length, ISBN, language, format, people, and the edition's own
  cover (through `covers.original` / `edition_picture`).
- **Edition facts never land on an older post.** `plan_book` steps 4 and 5 write changed
  edition facts (publisher, year, pages, ISBN, language, format, length, people, cover) to
  `latest`. When the same plan creates a new post for the main edition's read, those facts
  are already in the new post and must not also be written to `latest`: drop the
  edition-level keys from `changed` in that case. Without this, putting the new audiobook
  on *To read* would write the audiobook's publisher onto the 2013 paperback's post.
- **An edition's change reaches every read of it.** This needs no code: every review of that
  edition is out of step with its `sum`, so each of their posts is edited.
- Titles: until stage 5 every post of a group carries the work's title, as today.

The tests in `test_publish.py` that describe versions (`test_another_version_is_a_reread…`,
`test_deleting_a_book_leaves_its_other_version…`, `test_a_book_in_another_format_is_taken…`)
are the specification of what the booklog should receive. Port them: the same posts must
come out of one record with two editions as came out of two records with `versionOf`.

### 6.3 Importing: what changes

`boeken.books()` produces, per `rereadOf` group, the work's fields, one edition candidate per
post (`edition_of(post, names)`, without filling gaps from other posts), the reviews, and
which post is the open one (the latest, when its status is `to-read` or `reading`).
`import_boeken`'s `merge` maps each post onto an edition of the stored record:

1. the edition its review already points at (matched by the review's `boeken` slug);
2. for the open post without a review: the stored `main`;
3. an edition of the record with equal booklog facts that no differing post has claimed;
4. otherwise a new edition, id `ed-<slug>` (shortened like `uid_for` when too long).

Two posts that map to one edition but state different facts are two editions: the later
post falls through to rule 3. An edition's booklog-owned facts are overwritten from its
post; what only Folio knows about it (its lists, `thumb`, `coverFull`, `added`) is kept.
Editions that no post describes (a library copy never read) are left alone. `main` is the
open post's edition, or removed. A work's title stays as it is while any post of the group
has that title; otherwise it becomes the first post's. The existing rules stay: what was
changed in the app and not published yet is kept as the app has it (now also: the facts of
an edition that an out-of-step review points at), reviews written in the app are kept, a
booklog book that was deleted in the app stays deleted, and a scanned book with the same
ISBN is joined (the ISBN is now looked for in editions).

Reviews of posts with status `abandoned` get `dnf: true` (not part of `sum`).

Two properties to test, because they are what keeps the timer quiet:

- importing twice in a row changes nothing the second time;
- after an import, `sync_boeken --dry-run` has nothing to publish.

### 6.4 `upgrade`: an old record as a new one

The same algorithm in `works.js` and `works.py`, proven equal by shared fixtures
(`tests/fixtures/works/*.json`, each an old record and the expected new one). It must be
deterministic, because a device and the server upgrade the same record independently and
reviews point at editions by id.

1. `own` = the moved fields found at the top level.
2. Walk the reviews in stored order. A review with an `edition`: find an edition already
   made whose facts are equal (format, ISBN, publisher, date, pages, length, language,
   people tidied, and the cover's identity: `coverSource`, else `cover`, else `thumb`);
   otherwise make the next one (`e1`, `e2`, …). Point the review at it; drop `edition`.
3. Place `own`:
   - **No edition was made** (no read carried one): `own` is `e1`.
   - **A booklog book** (`boekenState` present): the edition the book stands for is `main`
     as defined in 4.3, computed from the reviews (latest dated read; for a book on
     *To read*/*Reading* whose latest post has no review, see the next bullet). Of `own`,
     only what differs from `boekenState` is applied to that edition: that is an edit made
     in the app and not yet published. Everything else in `own` came from the booklog and
     is dropped in favour of the read's own edition. (This removes the 11 audiobooks with a
     paperback's page count.) Folio-only fields (`thumb`, `coverFull`, `coverRatio`) are
     kept when the edition lacks them.
   - **A booklog book on *To read* or *Reading* with dated reads** (a reread planned or
     running): `own` is the edition of the open read. If it equals an edition already made,
     that one is `main`; otherwise it is a new edition and `main`.
   - **A book that is only in Folio**: `own` is the truth. An edition made from a review
     that has the same format and the same ISBN as `own` (or neither has an ISBN) is the
     same edition and takes `own`'s facts; otherwise `own` is a further edition.
4. A review without an `edition` (from before reviews had them) points at the main edition.
5. Split `lists`: reading-status lists stay; the rest goes to the main edition. A book
   without `lists` (from before lists existed) has its main edition in the library, as
   `shelves` assumes today.
6. Set `main` only where 4.3 says it is stored (the book is on *To read* or *Reading*).
   Remove `versionOf` only on the server, after merging (stage 1); the client leaves it.
7. `v: 2`, then `settle`.

## 7. The build

### Working rules for whoever builds this

- **Never push to `main` while building.** A push there deploys the
  app and restarts the server (`.github/workflows/deploy.yml`). Work on a branch
  `works-and-editions`; the cut-over in section 8 is the only moment it reaches the deploy
  branch, and Michel starts it.
- **Start from a clean tree, and keep up.** Other sessions work in this checkout and on the
  deploy branch (bulk edit arrived while this plan was being written). Branch from the
  deploy branch's tip, rebase on it at the start of every stage, and if `git status` shows
  changes you did not make, stop and ask.
- **Bulk edit** (`openBulkEdit`, `saveBooks`, in 1.28.0) changes many books at once and
  writes `lists`, format and language straight onto each book. In stage 2 it must go
  through the helpers of 4.3: reading status to the book; lists of where a copy is, format
  and language to the edition each selected row shows (its face). `saveBooks` must enforce
  the invariants of 4.2 as `saveBook` does. Its publishing of language, categories and tags
  (`TRACKS = 3` in `boeken.py`) reads the flat view like the rest.
- **Production is Michel's.** Do not open an SSH session, read the production database or
  run a command on the server unless he asks for that step. Prepare commands; he runs or
  approves them. The rehearsal in stage 1 needs a copy of the production database: ask him
  for it.
- **Never write to `M:\dev\boeken`** (his checkout of the booklog). For tests and rehearsals
  clone it to a temporary folder and leave `BOEKEN_PUSH` unset, so nothing can be pushed.
- **Not a Django migration.** The data change is a management command run by hand
  (stage 1). The deploy runs `migrate` by itself, with no backup and the timer running.
- Tests: `python manage.py test` in `server/` (use `server/venv`); `node --test tests/` for
  the client's pure functions (Node 22 is installed). The interface is checked in the
  browser pane against the local server (`.claude/launch.json`), with real clicks.
- The deploy copies the whole repository to the web root except what it excludes. `docs/`
  and `tests/` are excluded (`tests/` was added with this plan). Anything else new at the top level that
  is not part of the app needs its own `--exclude`.
- Keep the documentation true: `docs/using.md` is the manual, `docs/booklog.md` says what
  publishing and importing do, `docs/server.md` how it runs. Each stage updates what it
  changes.
- Commit messages in the repository's style: one sentence saying what is now true.

### Stage 0. Ground

1. Branch `works-and-editions` from the tip of the deploy branch.
2. Add `tests/` with a first passing `node --test` file, and `tests/fixtures/works/`.
3. Write the fixtures before any code: old records and the `v: 2` record each must become.
   At least: a scanned paper book with only `author`; a booklog book read once; a comic with
   roles; a book read as paper then audiobook (two editions, people differ); one read three
   times in two editions; an audiobook carrying a paperback's `pages`; a booklog book on
   *Reading* that was read before; a Folio-only book with a review whose embedded edition is
   a stale copy of the book's; a book with a pending in-app change of publisher; a book
   without `lists`; a `pending` ISBN-only book; a book on *Lent out* with a note; a
   `versionOf` pair (for the server merge, as input and expected output of two records).
   Take real shapes from the local `server/db.sqlite3`, with texts shortened.

*Done when:* both test runners run and the fixtures exist and have been read once more
against section 6.4.

### Stage 1. The server speaks both shapes; the migration exists

Files: `server/shelf/works.py` (new), `publish.py`, `boeken.py`, `views.py`, `covers.py`,
`management/commands/import_boeken.py`, `management/commands/to_works.py` (new),
`management/commands/set_paper.py` (delete: it did its job), tests.

1. `works.py`: `upgrade`, `flat`, `settle`, lookups. Tests from the fixtures.
2. Publishing through the flat view, with the changes of 6.2. Port the version tests. Add:
   a read e-book gets an audiobook edition and goes to *To read* → one new post with the
   audiobook's facts and the old post byte for byte unchanged; the same for *Reading*; a
   dated read of a new edition → a reread post with that edition's facts; changing an
   edition read twice → both posts edited; changing an edition nobody read → nothing.
3. Importing as in 6.3, with the two properties as tests.
4. `covers.adopt` looks for covers to keep in every edition (and writes the kept cover back
   to that edition). The JSON lookups it uses today (`data__cover__startswith`) cannot see
   inside `editions`; narrow in SQL if useful, decide in Python.
5. `views.py`: the sync request carries `schema: 2`. A request without it is answered with
   409 and *This version of Folio is out of date. Close and reopen it to update.* An old
   copy of the app shows that under Settings and updates itself when next opened; it can no
   longer write old records over new ones. A change that arrives without `editions` is
   upgraded before it is stored. `PUBLISHED_KEYS` loses `versionOf`.
6. A guard: `sync_boeken` and `import_boeken` refuse to run while the user has a book
   without `editions`, saying *run to_works first*. This makes a wrong order at the cut-over
   harmless.
7. `manage.py to_works [--user NAME] [--dry-run]`:
   - upgrades every record that is not `v: 2`;
   - merges each `versionOf` book into the book it names: its editions and reads are added,
     its reading status wins when it is *To read* or *Reading* and the other is not (and its
     edition becomes `main`, its progress the book's); the version's record becomes a
     tombstone;
   - merges books that share an ISBN when at most one of them is in the booklog (that one
     survives; otherwise the oldest): two entries of the same edition in one book;
   - **does not** merge on title or `olid`; it lists those pairs;
   - for every booklog book that had nothing waiting to be published before, sets
     `boekenState` and each linked review's `sum` afresh from the flat view, so that
     whatever was in step is in step; a book that had something waiting is left waiting and
     named in the report;
   - keeps each record's `modified` and sets `changed`, so every device fetches it and an
     edit made on a device since still wins; tombstones get the time of the run;
   - reports: books, editions made, books with more than one edition, merges done,
     candidate pairs, books left waiting, and for a dry run the same without writing.
   It can be run again without effect.

*Done when:*
- all server tests pass, old and new;
- **rehearsal on a copy of production's database** (ask Michel for the file) against a
  temporary clone of the booklog: `sync_boeken --dry-run` before `to_works` and after it
  list the same books (ideally none); `import_boeken` after `to_works` reports nothing
  updated that cannot be explained line by line; a second `to_works` changes nothing;
- the dry-run report has been shown to Michel, with the candidate pairs.

### Stage 2. The client reads and writes the new shape, and nothing looks different

Files: `works.js` (new: pure functions, no DOM), `app.js`, `sw.js`, `lang-nl.js`, `tests/`.

1. `works.js`: `upgrade`, `settle`, `mainEdition`, `faceEdition`, `shelves`, `putOn`,
   `takeOff`, `newWork(flat)`, `addEdition(work, flat)`, `findWork`, `combine`, `split`.
   Tested with the same fixtures as the server, plus unit tests of each function. `app.js`
   imports it; `sw.js` lists it in `SHELL_FILES`. Read how `sw.js` and `initUpdates` replace
   the shell and make sure `app.js` and `works.js` can never be served from two versions.
2. On start every stored record is upgraded and, if that changed it, written back to
   IndexedDB **without** touching `modified` or `sync.dirty`. `applyRemote` upgrades what
   arrives. `runSync` sends `schema: 2`. Everything that makes a book (`addBook` and its
   callers, `addCopy`) goes through `newWork`; `saveBook`'s `settle` enforces 4.2.
3. Move every read and write of a moved field to an edition. Find them with a search for
   `\.(cover|thumb|coverRatio|coverSource|coverFull|format|pages|duration|isbn|publisher|date|language|people)\b`
   and for `\.lists\b`, and decide each site: it is given a work (use `mainEdition` or the
   face), an edition, or a proposal that is still flat (lookups, the assistant's proposals,
   OCR results stay flat until `newWork`). Functions that take "a book or an edition"
   (`coverEl`, `formatOf`, `extentOf`, `metaLine`, `peopleOf`, `editionLine`) keep taking a
   flat thing; their callers pass the edition.
   While developing, load the app with a guard that throws when a moved field is read or
   written on a work (a `Proxy` around records behind `?guard=1`); it finds the sites a
   search misses. Remove nothing of it from the build path that costs at run time.
4. The pieces that depended on the old shape: `mainEdition`/`editionCovers` (now from
   `editions`), `progressOf` (totals from the main edition), `facetsOf`/`passes` (5.7),
   `searchText`, `everyoneIn`, `peopleEditor`'s known names, `exportJson`, `exportGoodreads`
   (one line per read, with the edition that was read), `openCoverFor`,
   `keepCover` targets, `openBooklogForm`, `confirmDelete`, `retryPending`.
5. Forms at parity only: `openBookForm` as in 5.2; `openReviewForm` with the choice of 5.4;
   the Editions section and the edition sheet of 5.1 and 5.3 without *Make it a book of its
   own*. This is the least that keeps everything possible that was possible before (a
   version book had its own form and lists).
6. `versionOfShelf` and the `versionOf` branch of `openDescribe` go: a proposal that is
   another edition is added with `addEdition` (the full adding rules come in stage 4).

*Done when:*
- `node --test` passes; the guard finds nothing on a tour of every screen;
- with the local database (upgraded by the client), a one-edition book is identical to
  the build you started from on its page, in its form, in all three views, in the scanner card and in the
  review form (compare screenshots, light and dark, phone width and desktop);
- a two-edition book shows its editions, each can be edited, each read names its edition;
- two browser profiles signed in to the local server converge after edits on both;
- an old build (check out the starting commit in a second folder) pointed at the new server gets the
  out-of-date message and loses nothing.

### Stage 3. Reading status with editions

1. `bookActions`, `progressBox`: *Start reading* uses the main edition; with more than one
   edition the progress box names which one is being read and lets it be changed (sets
   `main`). *Mark as read* opens the read with the main edition chosen; saving removes
   `main`.
2. Decision 6: `shelves(work).read` also holds when the book has a dated read without `dnf`
   and is on *To read* or *Reading* (`at`: the day of that read). The *Reading status*
   filter follows. Publishing is not affected: it reads the stored lists.
3. Marking *Did not finish* in the app does not make a review today (the import does, after
   publishing). Nothing to change; `dnf` comes with the import.

*Done when:* a finished e-book whose new audiobook is put on *To read* is under both *Read*
and *To read*, shows the audiobook's cover on *To read* and the e-book's on *Read*, and
publishes one new post (checked against the temporary clone).

### Stage 4. Adding, combining, splitting, twins

1. Every way of adding goes through `findWork` and behaves as the table in 5.5: `onIsbn`
   (and *Another copy*), `processCover`/`openDescribe`, shared links, Audible, the ISBN
   sheet, `manualEntry`, `retryPending`. `fromOpenLibraryEdition` keeps `olid`.
2. *Add another edition* on a book's page; *Keep separate* on the card and the toast.
3. *Combine with another book…* and *Make it a book of its own*, with Undo, refusing the
   booklog cases named in 5.6 in a plain sentence.
4. *Possibly the same book* under *Filter → Other*.
5. `docs/using.md`: rewrite *Editions*, *Another version of a book you have*, *Authors and
   others*, the lists section and *Good to know* for the new model; `docs/booklog.md`: what
   a version was; the README's short list of what Folio does. `APP_VERSION` becomes `2.0.0`.

*Done when:* the scanner adds a second edition of a book on the shelf in one scan with no
question asked, and *Keep separate* undoes exactly that; a translation is added from its
book's page; combining and undoing leaves both records as they were (compare the JSON);
everything in sections 5.1 to 5.7 can be shown in the browser pane.

**Stages 1 to 4 go to production together** (section 8).

### Stage 5. Later: joining and splitting in the booklog; translated titles

Not needed for the cut-over. Until it is built the app refuses the cases that need it.

1. In the booklog repository (mvuijlst/boeken), with Michel: `scripts/check_books.py` warns
   when a reread's title differs from its first read's (decision D-048 there: "book facts
   must match across a reread group"). Allow another title when the two posts' `language`
   differs; record it as a decision in `docs/decisions.md`; look at how the templates show
   a reread group whose posts have different titles and covers.
2. `publish.py`: a post's title is its edition's title when it has one, else the work's
   (step 4 of `plan_book`, `reread`, `plan_new`). The import gives an edition a `title`
   when its post's title differs from the work's.
3. `plan_regroup`: bring the booklog's groups in line with the shelf. Each record owns the
   posts its reviews name, plus the group of its `boeken` post as far as no other record
   claims those. For a record marked by the app as combined or split: its first post has no
   `rereadOf`, every other post of it names that first post; posts left behind in a group
   that lost its first post are re-rooted with the existing `reroot`. One commit per record
   (*Samengevoegd: …*, *Gesplitst: …*). When two books that are both waiting to be read are
   combined, the absorbed one's open post is deleted through `dropReads`.
4. Lift the refusals of 5.6.

## 8. Cut-over on production

Michel starts this; whoever built the stages prepares it and stays for it. The server's
layout is in `docs/server.md` under *Production*. `NAME` below is his account.

Before:

1. Open Folio on every device and let it sync (Settings → Account shows no waiting changes).
   An edit still waiting on a device is kept, except on a book the migration merges away.
2. Stop the systemd timer that runs `sync_boeken` (`docs/booklog.md`).
3. `manage.py sync_boeken --user NAME --dry-run`: nothing may be waiting. If something
   is, start the timer again, let it publish, and begin again.
4. Copy the database: `db.sqlite3.before-works-<date>-<time>` beside the others.

Then:

5. Merge `works-and-editions` into the deploy branch and push. The deploy copies the app and
   restarts the server. From here old copies of the app are told to update.
6. `manage.py to_works --dry-run`; read the report with Michel; then `manage.py to_works`.
7. `manage.py import_boeken <the server's clone of the booklog> --user NAME` and then
   `manage.py sync_boeken --user NAME --dry-run`. Expected: the import changes nothing
   that the rehearsal did not predict, and nothing is waiting to be published.
8. Start the timer. Watch its first two runs in the journal: no
   commit to the booklog should appear.
9. On each device: open the app, see that it updated (Settings shows 2.0.0), open a
   one-edition book, a multi-edition book and what used to be a version.

Going back, if it must be: stop the timer; put the database copy back; deploy the previous
commit; on each device *Sign out & clear* and sign in again (a device has upgraded its own
copy of the shelf and an old build cannot read it). Edits made in between are lost. This is
why the rehearsal in stage 1 is not optional.

## 9. For Michel to confirm

Each has a default this plan builds unless he says otherwise.

1. **Lists** (decision 4): reading status is the book's; *Library*, *Lent out* and his own
   lists are an edition's. A wishlist is then of a particular edition.
2. **Rows** (decision 5): always books, in *Library* too; two editions in the library are
   one row that says so.
3. **Read stays Read** (decision 6) while another read is planned or running.
4. **Automatic attaching** (decision 7): a scan that is another edition of a book on the
   shelf is attached without asking, on a title-and-author match too, with *Keep separate*
   to undo. The cautious alternative: attach only on the same `olid`, and offer it
   (*Same book as …?*) on a title match.
5. **The migration merges** `versionOf` pairs and books with the same ISBN, and only lists
   same-title pairs for him to decide (*The Blacktongue Thief* twice, *The Lord of the
   Rings*).
6. **Words**: *edition* / *editie*; *Add another edition* / *Nog een editie toevoegen*;
   *Keep separate* / *Apart houden*; *Combine with another book* / *Samenvoegen met een
   ander boek*; *Make it a book of its own* / *Er een eigen boek van maken*.
7. **Stage 5** changes a rule of the booklog (D-048) so a translation can be a read of the
   same book there. Until then a translation is one book in Folio, and its reads appear in
   the booklog under the work's title.
