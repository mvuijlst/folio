# The booklog (boeken.tsuk.org)

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
  made when first needed), dated as in the booklog. A reread is the same book, not a second one:
  a book is one `rereadOf` group of posts.
- A book comes with its rating, series, how far along it is, and a link to its page in the
  booklog. Every read becomes a **review** of the book: the day it was read, the rating, the
  text (Hugo shortcodes for images and videos become plain Markdown), and which **edition** of
  the book it was of. A book that is not read yet gets its note as a review without a date. A
  read given up (`status: "abandoned"`) is marked so (`dnf`).
- **Each post is of an edition** of the book (see [Books and their
  editions](using.md#books-and-their-editions)), with the publisher, year, pages or length,
  ISBN, language, format, people and cover that post states, nothing filled in from other
  posts. Which edition, in this order: the one its review already points at; for the post of a
  read not done yet, the book's main edition; an edition with the same facts that no post
  saying otherwise has claimed; otherwise a new one (`ed-<slug>`). An edition that no post
  describes (a copy in your library you never read) is left alone, and so is whatever only the
  app knows of an edition (the lists it is on, your own photograph).
- A booklog book that is already on the shelf (same ISBN) is joined with it and keeps its other
  lists and notes. A booklog book deleted in the app stays deleted.
- The book's title stays as the app has it while any post of the group has that title;
  otherwise it becomes the first post's.
- Covers are written as small images to `covers/boeken/` next to the app (the booklog's own are
  full-size) and served as plain files.
- The import and publishing (below) keep out of each other's way: whatever was changed in the
  app and is not published yet is left as the app has it; everything else follows the booklog.
  Other lists, notes and scanned books are never touched.

## Publishing back to the booklog

What is changed in the app about a booklog book is written back to the booklog, so
boeken.tsuk.org follows without anyone editing Markdown:

```bash
venv/bin/python manage.py sync_boeken --user NAME --dry-run   # say what would be published
venv/bin/python manage.py sync_boeken --user NAME             # fetch, publish, push, import
```

| In the app | In the booklog |
| --- | --- |
| a review is edited | its post gets the new text, rating and reading date (a date in another month keeps the old address as an alias) |
| an edition is changed | the posts of every read of it get the publisher, year, pages or length, ISBN, language and cover; an edition nobody read changes nothing there |
| what an edition is (paper, e-book, audiobook) changes | `format` on the posts of its reads; an audiobook gets its length instead of pages |
| the people of an edition change | `authors` and `roles` of the posts of its reads; someone new gets an author page, and people who didn't change keep the page they had |
| *To read* → *Reading* | the post's status, with progress started |
| the page reached changes (on the book's page) | `pagesRead` and a line in `progressLog` |
| a book being read gets a dated review, or moves to *Read* | the post is finished: no status, the reading date, rating and text |
| a read book gets another dated review | a new post, a reread of the first, with the edition read that time |
| a read book goes back to *To read* or *Reading* | a new post, a reread of the first, with the facts and cover of the edition to be read (the audiobook, after the e-book); the posts of the reads before are left exactly as they are |
| a book being read is marked *Did not finish* | the post's status becomes `abandoned` |
| a book that was only marked as read gets its review later | that same post gets the text and rating: no reread is made of it |
| a book to read is dropped | its post is deleted, with its cover and the author, tag and series pages nothing else uses. Never a book that was read: that is refused |
| title or series change | the front matter of every read of the book |
| the main edition changes (*I'm reading this one*) | the post of the read not done yet gets that edition's facts |
| categories or tags change | `categories` and `tags` on every read's post that has any, and the latest's; a new tag gets its page, and a category the booklog doesn't have is refused |
| the cover is replaced | the picture goes into `media/` and the post points at it |

- **Only what changed is written.** Posts are edited line by line, as boeggn did, never
  re-serialised; a post nobody touched in the app stays byte for byte as it was. Each book is
  one commit, worded as the booklog's always were (*Uitgelezen: …*, *Voortgang … (p. 210)*).
- **Checked first.** Every post touched goes through the booklog's own `scripts/check_books.py`;
  what it turns down is not committed, and the book's page in the app says why.
- **Back from the booklog.** `#/book/<slug>` opens the book whose page in the booklog has that
  slug. The booklog's own edit link on a book's page (its *bewerkstand*, and the key *E*) points
  there, so a book is one step from its public page to where it is edited.
- **Not at once.** A book is published once it has been left alone for two minutes
  (`--delay`), so a tap on the wrong list can be undone before it is public.
- **Not yet:** a review without a reading date on a book that is already read stays in the app.

## Adding a book to the booklog

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
  added a second time: the app says which book on your shelf it is, to combine them there.
- A book with several editions goes in as its main edition; its other reads follow as
  rereads, each with the edition it was of.

## Books with editions, and what a "version" was

Since Folio 2.0 a book on the shelf holds its editions (`editions`), and each read points at
the edition it was of; publishing and importing read a book through `works.flat`, the old shape
with the main edition's facts at the top and each read's edition beside it, so a post is still
a read and a group of posts still a book. From 1.26 to 1.29 the audiobook of an e-book you
had was a second book on the shelf, *another version* (`versionOf`), whose posts were taken out
of the first book's group on import. That is gone: such a version is an edition of the book.

`manage.py to_works [--user NAME] [--dry-run]` converts a shelf (once, at the cut-over; a
second run changes nothing): every book in the old shape is upgraded, a version becomes an
edition of the book it was a version of (with its reads, and its reading status when it was
on *To read* or *Reading*), books with the same ISBN become one book (when at most one of
them is in the booklog), and books that only look alike are listed, not merged. A booklog
book that had nothing waiting to be published stays in step; one that had something waiting
still has that, and nothing else. While any book is still in the old shape, `sync_boeken` and
`import_boeken` refuse to run. The steps are in [work-edition-plan.md](work-edition-plan.md),
section 8.

Settings, in `server/.env`: `BOEKEN_REPO_PATH` (a clone of the booklog that only this server
writes to, outside the web root), `BOEKEN_GIT_AUTHOR` (`Name <address>` for its commits) and
`BOEKEN_PUSH=1` (without it commits are made but not pushed, so nothing is public). For the
assistant: `OPENAI_API_KEY` and `OPENAI_MODEL`; without a key the app does not offer it. On the
server a systemd timer runs `sync_boeken` every two minutes.
