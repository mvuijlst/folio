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
  made when first needed), dated as in the booklog. A reread is the same book, not a second one.
- A book comes with its rating, series, how far along it is, and a link to its page in the
  booklog. Every read becomes a **review** of the book: the day it was read, the rating, the
  text (Hugo shortcodes for images and videos become plain Markdown) and the **edition** that
  read's post describes, with that post's own cover. A book that is not read
  yet gets its note as a review without a date.
- A booklog book that is already on the shelf (same ISBN) is joined with it and keeps its other
  lists and notes. A booklog book deleted in the app stays deleted.
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
| the edition of a read is changed | that read's own post gets the publisher, year, pages or length, ISBN, language and cover |
| what a read was read as changes | `format` on that read's post; an audiobook gets its length instead of pages |
| the people of a read, or of the book, change | `authors` and `roles` of that read's post (the book's: its latest read); someone new gets an author page, and people who didn't change keep the page they had |
| *To read* → *Reading* | the post's status, with progress started |
| the page reached changes (on the book's page) | `pagesRead` and a line in `progressLog` |
| a book being read gets a dated review, or moves to *Read* | the post is finished: no status, the reading date, rating and text |
| a read book gets another dated review, or moves back to *Reading* | a new post, a reread of the first, with the edition read that time |
| a book being read is marked *Did not finish* | the post's status becomes `abandoned` |
| a book that was only marked as read gets its review later | that same post gets the text and rating: no reread is made of it |
| a book to read is dropped | its post is deleted, with its cover and the author, tag and series pages nothing else uses. Never a book that was read: that is refused |
| title, series, publisher, year, pages or ISBN change | the front matter (title and series on every read of the book) |
| the language changes | `language` on the latest read's post (it is the edition's) |
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
  added a second time: the app says which book on your shelf it is.

Settings, in `server/.env`: `BOEKEN_REPO_PATH` (a clone of the booklog that only this server
writes to, outside the web root), `BOEKEN_GIT_AUTHOR` (`Name <address>` for its commits) and
`BOEKEN_PUSH=1` (without it commits are made but not pushed, so nothing is public). For the
assistant: `OPENAI_API_KEY` and `OPENAI_MODEL`; without a key the app does not offer it. On the
server a systemd timer runs `sync_boeken` every two minutes.
