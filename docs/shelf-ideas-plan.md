# Ideas from Shelf: what to build in Folio

A brief for the model that implements this (Opus 5.5). Written 2026-11-20 after reading
[dgahagan/shelf](https://github.com/dgahagan/shelf) (a self-hosted home library catalogue,
FastAPI + SQLite + HTMX, one Docker container) beside Folio 2.28.2, and after Michel chose
what he wants from it.

Shelf's remit is not Folio's: it is offline in a container, multi-user, and catalogues films,
games and music too. None of that is wanted. What follows are the eight ideas Michel picked,
his decisions on each, what Folio has today, and what was checked. Build them one release at a
time, in the order under [Order of work](#order-of-work).

## Before you start

- **Take ideas, not code.** Shelf is AGPL-3.0 and Folio is MIT. Do not copy Shelf's source
  into Folio. The rules and request shapes described here are enough to write it afresh; read
  Shelf's files for understanding only.
- **Everything must work signed out.** Folio is a static app with the shelf in IndexedDB; the
  account, the server and the assistant are extras. A feature that needs the server (the
  assistant, Hardcover) simply does not show without it. The sync answer already says whether
  there is an assistant (`assistant` in `views.sync`, `server/shelf/views.py:574`); do the same
  for anything new.
- **Michel uses Folio in Dutch**, on a phone and a desktop, with about 3,400 books. Check every
  new screen in Dutch with four-digit counts. `lang-nl.js` has two-line entries (key line,
  value line).
- **Look.** No rounded boxes with one coloured edge, nothing that reads as generated. Dark mode
  is deep. The look comes from `icons/folio-art.jpg`.
- **Releases.** `CLAUDE.md` has the rule: bump `APP_VERSION` in `app.js` and `folio-version` in
  `index.html` together, run `node --test tests/*.test.mjs`, and push. Every stage below
  changes behaviour, so each goes to the session branch and Michel says when it goes to `main`
  (a push to `main` deploys). One go-ahead covers one release.
- **His data and his server are his.** Do not copy or query the production database, and do
  not change anything on the VPS, without his go-ahead for that step. Never read or print keys
  in `.env`; give him the line to add. The local `server/db.sqlite3` is an old snapshot and
  says nothing about his shelf today.
- **Keep `docs/using.md` true.** It describes the app screen by screen and is updated with
  every feature.
- **No "unread" statistics.** A book without a reading status is not unread: he has read most
  of the house and not logged it.

## What Michel decided

| Idea | Decision |
|---|---|
| Scanning off a list | Yes |
| A photo of a whole shelf, many books at once | Yes |
| National catalogues, and saying when a catalogue did not answer | Yes |
| Series: naming the volumes he lacks | Yes, from **Hardcover**, with a **monthly re-check**. He has an API key |
| A queue through the copies without a cover, plus Amazon as a cover source | Yes |
| Trash | Yes. Kept **until he empties it**; nothing goes by itself |
| Restore from a backup file, and a nightly copy of the server's database | Yes. Nightly copy on the server, 14 kept, **and pulled to his PC** |
| A picture of a month or a year | Yes |
| A wishlist | **No list of its own.** *To read* is the wishlist: a book he wants is on *To read* and on no list of where a copy is |
| A look-only "do I have this?" scan | No |
| Checking a place by scanning it (Shelf's audits) | No |
| When, where and for how much a copy was bought | No |
| Importing Goodreads, StoryGraph or LibraryThing exports | No |

On the booklog and deleting, in his words: *"boeken.tsuk.org holds what I read. Giving a book
away does not change that. Only deleting from 'to read' should remove the book from
boeken.tsuk.org."* This changes how deleting works today; see [Trash](#2-trash).

## Order of work

1. [A real backup](#1-a-real-backup): the full backup file and restore, then the nightly copy.
2. [Trash](#2-trash).
3. [National catalogues](#3-national-catalogues).
4. [Scanning off a list](#4-scanning-off-a-list).
5. [The cover queue](#5-the-cover-queue).
6. [Series from Hardcover](#6-series-from-hardcover).
7. [A photo of a shelf](#7-a-photo-of-a-shelf).
8. [The wrap-up picture](#8-the-wrap-up-picture).

The safety net comes first because 2, 3 and 6 change many records. 4 and 5 are small. 6 and 7
need the server and should each start with a measurement on his own books. 8 is mostly design.

---

## 1. A real backup

**In Shelf:** a portable archive (one zip with every record and the covers) that any instance
reads back, previewing what is new and what is already there before anything is written; and
database backups from Settings.

**In Folio today:** there is no backup.

- *Export as JSON* (`exportJson`, `app.js:6057`) leaves out a book's categories, tags, its
  Open Library work, the original language and title, the people on the book, reading
  progress, the booklog links and every id. Lists go out by name. Nothing reads it back.
- On the server a deleted book's data is overwritten by its tombstone (`merge`,
  `server/shelf/views.py:485`). The only database copies are the `db.sqlite3.before-*` files
  made by hand before bulk changes.

**Build, part A, in the app (no account needed):**

- Settings → *Your shelf* → *As a file* gets **Back up** and **Restore**. Leave the two
  exports as they are; they serve other sites and other tools.
- The backup is one file holding everything the device has, as stored: every book with its
  editions, reviews and lists; every list; every term (words in two languages, roles, what is
  known of a series); the Trash once stage 2 exists; a format version, the app version and
  the date. Covers go as what the records hold (addresses, and inline thumbnails of pictures
  that are only on this device). Say on the page what is not in the file: the large cover
  files the server keeps, which part B copies.
- **Restore previews before it writes**: how many books are new, how many are the same, how
  many differ, and the same for lists and terms. For those that differ, offer *keep the newer
  one* (by `modified`, the default), *keep mine* or *take the file's*. Nothing is written
  until he confirms, and one *Undo* puts everything back.
- A restored record must travel through sync like any other change. Check that the server
  takes a restored record as newer where it should, and that restoring on a device with an
  account cannot quietly bring back what was deleted on purpose elsewhere (say so in the
  preview: "12 books in this file were deleted since").
- A file made by a newer format than the app knows is refused with a plain message.

**Build, part B, on the server (his go-ahead for each step on the VPS):**

- A script in `server/` (as `setup-public-library.sh` is) that installs a systemd timer: every
  night `sqlite3 … ".backup …"` to a folder outside the web root, compressed, **14 kept**.
  The web root is `/home/django/folio-yusupov`; nothing in it may hold a backup.
- The covers he photographed (`covers/own`, and the originals of straightened covers) cannot
  be fetched again; catalogue covers can. Copy the first kind along. Check disk space first:
  one database copy was about 424 MB on 2026-11-19 (records hold inline thumbnails), so
  fourteen of them need room.
- **Pulled to his PC:** a PowerShell script in the repo and a scheduled task that fetches the
  newest copy each day over SSH (the VPS listens on port 2708; `bash` in PowerShell on his
  machine is a broken WSL, so write it in PowerShell with `ssh`/`scp`). He chooses the folder.
  The script must not fail silently: it writes a line to a log he can look at, and Settings →
  *About* could show when the server's last nightly copy was made.
- Document both in `docs/server.md`, with how to restore from a nightly copy.

**Status, 2026-11-20:** part A live as 2.29.0 (`backup.js`, `tests/backup.test.mjs`, the
server's `/api/gone`). Part B done the same day: the timer is installed on the server, the PC
pulls into `Z:\Backups\Folio` daily at 10:00, and no copy is made on a night when nothing
changed (Michel's wish). Trash is not in the file yet: add it in stage 2.

**Done when:** a backup made on one device, restored into an empty browser profile, gives the
same shelf (compare record for record in a test); the timer has run on the server; a copy has
arrived on his PC.

## 2. Trash

**In Shelf:** deleting moves an item to Trash with everything attached; restoring brings it
back exactly; nothing is deleted on a timer.

**In Folio today:** `removeBook` (`app.js:265`) deletes the book from the device and syncs a
tombstone; *Undo* in the toast is the only way back, and it is gone when the toast fades.
A deleted edition or review is likewise only undone from its toast.

**His decisions:**

- Trash keeps things **until he empties it**. Settings shows how many things are in it and
  offers to empty what is older than 90 days.
- **The booklog holds what he read, and deleting in Folio does not change it.** Today
  `confirmDelete` (`app.js:5382`) offers *Also delete it from boeken.tsuk.org*, ticked. That
  box goes. Only **Drop** on a *To read* book (`confirmDrop`, `app.js:5403`) removes a page
  from the booklog, as it does now.

**Build:**

- A deleted book, edition or review goes to Trash with all it had: lists, notes, reads,
  covers, booklog links. Trash is a page under Settings: what is there, when it went, *Put
  back*, *Delete for good*, and *Empty*.
- It must sync, and the server must keep the data. A tombstone cannot hold it (other devices
  delete on a tombstone), so a trashed book has to stay a record with a mark. That is the
  delicate part: **every place that reads books must leave trashed ones out**. On the device,
  keep them out of the `books` array at one choke point (load and sync) and in a list of their
  own, so no view, count, filter, statistic, export or series strip can see them. On the
  server, check every `Book.objects.filter(… deleted=False)`: `publish.py`, `public.py` (a
  trashed book must never show in a public library), `covers.py`, `works.py`, the management
  commands. Write a test that fails when a new reader forgets.
- An older copy of the app would show trashed books as ordinary ones. The server already
  turns away copies that speak an older shape (`SCHEMA`, `server/shelf/views.py:67`, answered
  with 409); use that.
- A dropped *To read* book goes to Trash too, and its booklog page goes with the next publish
  as today (`plan_drop`, `server/shelf/publish.py:875`). Putting it back returns it to *To
  read* and publishes it again.
- Scanning or adding a book that is in Trash says so and offers *Put back* instead of making a
  second one.

**Ask Michel before building (three things his rule leaves open):**

1. A book he read is deleted in Folio and stays in the booklog. The booklog import leaves
   such a book deleted today (`import_boeken.py` counts it as *left deleted*); make sure that
   holds for a book in Trash and for one deleted for good from it. Then ask what he wants
   Folio to show for a book that is in the booklog and no longer in Folio. Suggested answer:
   *giving a book away is not deleting it*. The copy comes off *Library* and the book stays
   under *Read*; deleting a book with reads in the booklog says plainly that the booklog
   keeps it.
2. Deleting one read, or an edition with reads, whose pages are in the booklog deletes those
   pages today (`dropReads`, `app.js:4444`). By his rule it probably should not. Ask.
3. With the box gone there is no way from Folio to take a wrongly published page off the
   booklog (this happened on 2026-11-17, four books). Ask whether an explicit, separate
   *Remove from boeken.tsuk.org* on a book's page is wanted for that.

**Status, 2026-11-20:** built as 2.33.0. His answers: a copy no longer owned is not deleted
but marked (keep / can go / gone, 2.32.0, which also replaced the Mag weg list); a read with a
page on the booklog can be deleted only after that page is taken off (`unpublish`, quiet actions
on the read and at the bottom of Edit details). Copies and reads go into their book's own
`trash`.

**Done when:** deleting anything can be undone a week later on another device; no trashed book
shows anywhere, the public library included; emptying deletes for good.

## 3. National catalogues

**In Shelf:** an ISBN's registration group decides which national bibliography is asked before
Open Library and Google Books (`app/services/national.py`): 978-90 and 978-94 the Dutch KB,
978-2 and 979-10 the French BnF, 978-3 the German DNB, and more. And a scan says *why* a
record is thin or missing: no match, a provider that did not answer, a spent quota.

**In Folio today:** `lookupIsbn` (`app.js:1235`) asks Google Books and Open Library from the
device and merges them. When one of them fails and the other knows nothing, the card says
*This ISBN isn't in the catalogues*, though one catalogue never answered. Google's keyless
quota is often spent. The server has its own `lookup_isbn` (`server/shelf/intake.py:559`) for
shared pages.

**Checked on 2026-11-20:**

- **KB** (`https://data.bibliotheken.nl/sparql`, a SPARQL endpoint over the Nederlandse
  Bibliografie Totaal) answers a browser: `access-control-allow-origin: *`. Asked for
  `schema:isbn`, it gave for 9789021015996: title *De historicus*, author *Kostova, Elizabeth
  Johnson (1964-)*, publication *Amsterdam : Poema Pocket. 2011*. So authors need turning
  round and their dates dropped, and publisher and year come out of one label. Older records
  hold only the ISBN-10; ask for both (`toIsbn10`, `app.js:6095`). Language is
  `schema:inLanguage`, pages `schema:numberOfPages`.
- It did **not** know 9789022309032 (a Flemish ISBN from the tests). One miss proves nothing,
  but Flemish publishers may be thin there, and much of his shelf is Flemish. Measure before
  promising anything.
- **BnF** (`https://catalogue.bnf.fr/api/SRU`, query `bib.isbn adj "<isbn>"`, schema
  `unimarcxchange`) also sends `Access-Control-Allow-Origin: *`. It answers in UNIMARC: 200 $a
  title and $e subtitle, 700/701 authors ($a surname, $b forename, $4 = 070 for an author),
  210 $c publisher and $d date, 215 $a extent ("1 vol. (687 p.)"), 101 $a language.
- **DNB** refused my test request (403), so whether it can be asked from a browser is not
  known. Find out; if it cannot, ask it through the server for signed-in users, or leave it.
- Shelf does not read series from these records, on purpose: a wrong series does more harm
  than none. Do the same.

**Build:**

- In `lookupIsbn`, a third source chosen by the ISBN's group, asked at the same time as the
  other two. For its own group the national record wins on title, authors, publisher, year,
  pages and language; Open Library still gives the work (`olid`) and both still give covers.
  Keep the server's `lookup_isbn` in step.
- **Say what happened.** `lookupIsbn` returns which sources answered. A scan that finds
  nothing says which catalogues do not know the ISBN and which did not answer, with *Try
  again*. A book added from one thin answer while another catalogue was silent is looked up
  again later, as books scanned offline already are.
- **Measure, with his go-ahead:** for his 978-90 and 978-94 ISBNs, how many KB knows, and for
  how many it would fill a publisher, year or page count that is empty now. Report the
  numbers before building the next point.
- A management command in the manner of `fill_languages`, with `--dry-run`, that fills
  **only empty fields** of books already on the shelf from these catalogues. He decides
  whether to run it, after a database copy.
- Be a polite client: one request per scan, a short timeout, never a burst (the backfill
  paces itself).

**Status, 2026-11-20:** measured (the KB knew 216 of his 254 978-90/94 ISBNs, Flemish
publishers 53 of 77; would fill 113 copies; its year is often a later printing), then built as
2.35.0. Deviation: title and writers stay as Open Library and Google Books have them (the national
catalogues write names in full), taken from the national record only when those know nothing.
Years are filled too (his choice). The DNB answered 403 and then 429 and is not asked.
bibliotheek.be and KBR could not be used (their robots.txt).

**Done when:** scanning a Dutch book whose record Open Library has thin gives publisher, year
and pages; switching the network off for one source gives a card that says so.

## 4. Scanning off a list

**In Shelf:** scan modes. *Return* checks a lent book back in by scanning it.

**In Folio today:** the pill at the top of the scanner says which lists scanned books go on
(`openTargetSheet`, `app.js:7440`), and `onIsbn` (`app.js:7534`) puts a known book on them.
Nothing takes a book off by scanning.

**Build:**

- The sheet behind the pill gets a second way of scanning: **onto** these lists (as now) or
  **off** them. The pill must show plainly which one is on, and the scanner goes back to
  *onto* each time it is opened.
- Scanning off works on lists of where a copy is and lists he keeps by hand (*Lent out*, *Mag
  weg*, *Bureau*). Reading status is not offered: nobody un-reads a pile by barcode.
- A scan of a book on the list takes that copy off it: *Off Lent out (Jan, since 3 November)*,
  with *Undo*, which puts back the note too. With several copies, the one that is on the list
  answers (`byIsbn` already prefers it).
- A book that is not on the list: the card says so and nothing changes. An ISBN that is not on
  the shelf: the card says so; nothing is looked up or added.
- Nothing here publishes.

**Status, 2026-11-20: dropped.** Built, then Michel changed his mind before it shipped: "it's
always going to be a change in location", and a mode for taking books off adds complexity.
Scanning onto a place already moves a copy (the places are one either-or set). The gap was *Lent
out*, a list on its own: made a member of the places' set (*Plaats*), lending and returning are
changes of place too, and scanning a returned book onto its shelf takes it off *Lent out*. Do
not build scanning off.

**Done when:** a pile of returned books can be scanned off *Lent out* in one go, in Dutch, on
a phone.

## 5. The cover queue

**In Shelf:** a review queue walks every item without a cover one at a time with the picker
inline; *Not available* is remembered, so the list ends at zero. Amazon's image by ISBN is one
more source.

**In Folio today:** the filter *No cover* (`app.js:1856`), *Find a (better) cover* on a book,
the cover's own page with candidates from Open Library and Google Books (`openCoverRoom`,
`app.js:3837`; `coverCandidates`, `app.js:3726`), and Settings → *Paper copies*, which lists
copies without a cover whose book has another copy with one.

**Build:**

- From the *No cover* filter and from Settings → *Paper copies*: **Go through them**. One copy
  at a time: what it is, the candidates, *Take a photo*, *Paste*; then *Use this cover*,
  *Skip*, or **No cover exists**. A count says how far along he is. The order follows the
  view he started from, so a shelf can be done at a time.
- *No cover exists* is kept on the copy. Such a copy is left out of the queue and is a third
  state of the *No cover* filter, so he can find them again.
- **Amazon as a source:** `https://images-na.ssl-images-amazon.com/images/P/<isbn10>.01._SCLZZZZZZZ_.jpg`,
  for 978 ISBNs only. Checked: a known ISBN gives a JPEG; an unknown one gives a 43-byte GIF
  with status 200, so a candidate counts only when the picture is wider than one pixel. The
  server keeps a copy of whatever is chosen; add the host where `covers.py` decides what it
  may fetch.

**Status, 2026-11-20:** built as 2.38.0 on the cover's own page (openCoverRoom with a queue),
from the No cover filter and Settings → Paper copies; `noCover` on the copy; Amazon's ISBN-10
picture is a candidate and its host is on the server's list. Michel: no book may point at another
site for its cover; every chosen cover is copied to the server.

**Done when:** the count of copies without a cover can reach zero, and stays there.

## 6. Series from Hardcover

**In Shelf:** with a Hardcover token, *Check completeness* lists the volumes of a series that
are not owned, each with a button to wishlist it; *Release radar* asks again daily for newly
announced volumes of watched series.

**In Folio today:** a series page and a person's page draw the series book by book
(`seriesStrip`, `app.js:2095`): a square per book at its number, a dot for a number that is not
on the shelf. He can say how many books a series has (`seriesTotal`, `app.js:2070`; kept as a
synced term record `{id: "series:…", kind: "series", value, total}`). A dot has no name.

**His decisions:** Hardcover, with his own key, and a **monthly** re-check. A volume he wants
goes on *To read* and on no list of where a copy is.

**Build:**

- **The key stays on the server**: `HARDCOVER_TOKEN` in the server's `.env`, read in
  `server/config/settings.py` beside `OPENAI_API_KEY`. Give Michel the line to add and the
  restart command; do not handle the key. The app shows none of this unless the server says
  it has one.
- Hardcover's API is GraphQL at `https://api.hardcover.app/v1/graphql` with a bearer token
  (people paste it with or without the word `Bearer`; accept both). **Read Hardcover's current
  API documentation for its rate limit, how long a token lasts and its terms** before
  writing the client; do not rely on this brief for those.
- A series is found by name (`series(where: {name: {_eq: …}})`, or `book_series` filtered by
  its series' name), and its books come as rows with a `position` and a `book` (title, release
  year and date, cover, contributors). The raw list is noisy. Shelf's experience, validated on
  three well-known series (24, 36 and 23 raw rows became 9, 8 and 10):
  1. leave out books with a `canonical_id` (translations and doubles of another row) and
     those marked `compilation` (box sets);
  2. where several share a whole-number position, keep the one most users have shelved;
  3. leave out books with under 1% of the readers of the series' most-read book, **except**
     books that are not out yet or have no date: an announced volume has no readers.
- **Names differ.** Folio's series names follow the covers and Wikipedia (*De Kiekeboes*).
  When the name finds nothing, let him search Hardcover and pick; remember Hardcover's series
  id on the series' term record, with the volumes found and when it was checked.
- **On the page:** a dot gets a name. Tapping it shows the volume (title, year, cover) and
  **Want it**, which adds the book on *To read*, in no place, with its series and number.
  *All I lack* does it for the lot. The series' length can be taken from Hardcover with one
  tap; it is never changed by itself.
- **His numbers win.** He has checked several series against Wikipedia by hand. Where
  Hardcover numbers a book differently, show it as a remark; never renumber.
- **Monthly:** a series can be marked *still running*. A management command asks Hardcover
  for those once a month (a systemd timer, his go-ahead to install), and what is new is kept
  on the term record. The app shows it quietly on the series page and at the head of
  *Series* ("2 new volumes"); there are no notifications.
- A series Hardcover does not know says so and stays as it is.

**Measure first:** Hardcover is strong on English novel series and probably weak on Flemish
comics (Suske en Wiske, Jommeke, De Kiekeboes, Jerom), which are a large part of his series.
Before building the screens, run the lookup for ten of his series, half of them comics, and
show him what comes back. If the comics come back empty, say so; he may want another source
for those (he was offered Wikipedia read by the assistant, and chose Hardcover).

**Status, 2026-11-20:** measured on ten of his series (novels strong; Flemish comics weak: Thorgal
in French, Suske half, Jommeke 7, Kiekeboes 4), then built as 2.39.0 on his "build it". The key is
`HARDCOVER_API_TOKEN` (shared with the page counts). The raw-list filters changed after the
measurement: of series with one name the fullest; per number the most-read book (dropping every
book marked a copy dropped real volumes); the 1% readers rule only for widely read series. The
monthly timer is installed with `setup-series-check.sh` (his go-ahead).

**Done when:** on a series Hardcover knows, every dot has a name and one tap puts the lacking
volumes on *To read*; a month later a newly announced volume shows without his asking.

## 7. A photo of a shelf

**In Shelf:** *Photo Intake*. A photo of a shelf, a stack or books laid face up goes to a
vision model, which returns a list to review: title, author, an ISBN only when one is printed
in the frame, and whether the book was *read* off the photo or *recognised* from its cover. A
photo much larger than the model takes in is cut into overlapping pieces, with the cost shown
first. Nothing is added until the list is confirmed, and the photo is not kept.

**In Folio today:** a photographed cover is made no larger than 1024 pixels (`app.js:7734`)
and sent to `/api/suggest`; the assistant names the book or books on it (`propose`,
`server/shelf/intake.py:673`) and they open as proposals to tick. `manage.py try_covers`
measures this on real covers. At 1024 pixels a shelf of spines is unreadable.

**Build:**

- *Add a book* → **Photograph a shelf**, where there is an assistant. It takes a
  full-resolution still (the phone's own camera, or a chosen picture), not a frame of the
  viewfinder.
- The device cuts the photo into overlapping pieces sized to what the server's model takes
  in. **Look that size up in the model's documentation; do not guess it.** Before anything is
  sent, say how many pieces it will be, and cap it. Each piece costs on his OpenAI key.
- The model is asked for every book it can see: title, author, the series and number when
  they are printed on the spine (comics have them), an ISBN only when its digits are printed
  and legible (never from memory; one that fails its check digit is dropped), and *read* or
  *recognised*.
- Books in the overlap come back twice. Merge them: the same title (near enough, about 0.85
  alike) with authors that do not contradict each other is one book; two different ISBNs are
  never the same book. Keep the fuller of the two.
- Each book is then matched against the shelf with the rule adding already uses (the same
  title by the same first author, `addFound`, `app.js:4641`):
  - **already on the shelf:** offered to go on the lists he is scanning onto. This is the way
    to say where a whole shelf stands in one photo;
  - **new:** looked up as a proposal is today, and offered to add.
- The list follows Folio's habit: ticked where it is clear (read off the spine, and matched
  or found), unticked where it is a guess (*recognised*, or not found in a catalogue), each
  saying which. He ticks, chooses the lists, confirms; one *Undo* takes it all back.
- **Measure before shipping**, as `try_covers` did: a command that runs a few real photos of
  his shelves (he supplies them) and reports how many books were read rightly, wrongly or
  missed, the time and the tokens, with and without cutting into pieces. Dutch titles and
  thin comic spines are the hard cases. Show him the numbers; he decides whether it ships.

**Done when:** one photo of a shelf of about thirty books gives a list he can confirm in under
a minute, with no book added that he did not tick.

## 8. The wrap-up picture

**In Shelf:** a picture of one month or one year: how much was finished, the top author when
one appears more than once, a grid of at most 24 covers. Drawn in the browser, stored nowhere,
saved as a PNG or handed to the phone's share sheet.

**In Folio today:** the statistics view counts whatever the place and its filters show, and
*Year read* is a filter. The export sheet already saves and shares files (`openExport`,
`app.js:6147`).

**Build:**

- In the statistics of a place narrowed to one year (or one month): **A picture of this**.
  It shows the period, how many books, pages and hours, and the covers of what was read, in
  the order read. Consider the best-rated books larger. A book without a cover gets a tile
  with its title. No "unread" figure, and reads given up stay out, as in the charts.
- Drawn on a canvas on the device and never sent anywhere. *Save* and *Share…* as the export
  has them.
- A canvas with a picture from another site in it cannot be saved unless that site allows it.
  Covers kept on Folio's own server are fine; Open Library's covers send
  `access-control-allow-origin: *` (checked); for any other, or when loading fails, fall back
  to the title tile. Wait for the fonts (Fraunces and Instrument Sans, in `fonts/`) before
  drawing.
- In the app's language. A size for a phone (4:5) first; a wide one if he asks.
- **Design first.** Make two or three real pictures from a year of real reads, show them to
  Michel, and build the one he picks. This is the part of the plan where his eye matters most.

**Done when:** *Read*, narrowed to 2025, gives a picture he would put on his site.

---

## Left out on purpose

Michel was offered these and did not choose them. Do not build them as part of this work.

- A look-only scan for the bookshop ("do I have this?") and Shelf's offline *Store Mode*.
- Checking a place by scanning everything in it (audits, the *missing* mark).
- When, where and for how much a copy was bought; valuation; price alerts; buy links.
- Importing exports of other reading sites.

Not offered, because they do not fit Folio: other media (films, games, music, periodicals),
several users with roles, printed copy labels, feature switches, a dashboard page, API tokens
for home dashboards, and the integrations with Audiobookshelf, Komga and RomM.

## Where to read in Shelf

For understanding only (see *Take ideas, not code*): `docs/user-guide/` describes each feature
as its users see it. Behind them: `app/services/national.py` and `kb.py`, `bnf.py`, `dnb.py`
(catalogues by ISBN group), `hardcover.py` (the series queries and their filters),
`release_radar.py`, `vision.py` and `tiling.py` (the shelf photo), `trash.py`, `archive.py`
(the portable archive and its preview), `wrapups.py`, `covers.py`.
