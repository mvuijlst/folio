# Folio → Hardcover sync: plan

Status: proposed 2026-11-27. The same day Michel took the recommended answer to each of the three
questions at the end: (1a) only books with a reading status, (2) no reviews, ratings only, and
(3a) unmatched books left out and counted, with stage 3 to be decided once the counts are in.

Stage 0 and 1 done the same day (2.48.0, on the branch `claude/hardcover-sync`). The schema was
read by introspection and the plan's names were right; status ids are 1 Want to Read,
2 Currently Reading, 3 Read, 4 Paused, 5 Did Not Finish, 6 Ignored. His Hardcover library
already held 2,481 books (2,424 imported in July 2023, 356 with a review, all public). The dry
run on a copy of production (27 requests): of 1,580 books with a status, 162 would be added,
258 adopted (233 of them with changes: rating 169, edition 126, status 6, plus reads), and
1,160 matched nothing, 1,016 of them because no edition has an ISBN or ASIN. About 470 of those
have a single book of the same title in his own Hardcover library, which a title-and-writer match
against his library alone (not the whole catalogue) could adopt. Nothing has been written yet.

## What it is for

Michel has accounts on Hardcover, LibraryThing, Goodreads and StoryGraph and wants Folio's data
to reach them without his help. Only Hardcover can be written to by a program:

- **Hardcover** has a GraphQL API (`api.hardcover.app/v1/graphql`) with a personal token, which
  can add books to a library and set their status, rating and reads. Folio already uses the
  same token (`HARDCOVER_API_TOKEN`) to look up series (`server/shelf/hardcover.py`).
- **Goodreads** has given out no API keys since 2020, **StoryGraph** has no public API, and
  **LibraryThing**'s robots.txt forbids automated use of `/api/`, `/isbn/` and `/work/`. For
  these three the CSV from *Export for Goodreads, StoryGraph…* stays the way in. Driving their
  websites with a script is ruled out: it breaks their terms and breaks on every redesign.

So this plan covers Hardcover only, one way: Folio → Hardcover. Folio stays the record. Nothing
done on Hardcover comes back, and the sync overwrites only what it sends.

## What goes over

| Folio | Hardcover |
|---|---|
| Reading status *To read*, *Reading*, *Read*, *Did not finish* | `status_id` Want to read (1), Currently reading (2), Read (3), Did not finish (5) |
| Each read (a review with a date): its date and the edition it was read in | One `user_book_read` with `finished_at` and `edition_id`; a reread is a second read |
| Rating 0–10 | `rating` 0.5–5 (half stars), i.e. Folio's number halved; no rating stays empty |
| The edition read last, or the main edition | `edition_id` on the user book |
| Date added | `date_added` |
| Review text | Only if question 2 says yes (`review` + `review_has_spoilers` false) |

These are left out: categories, tags, places, notes, covers, the people's roles, the booklog's
own fields, and anything in the Trash.

Folio reads have a finished date only, so `started_at` stays empty.

## How it runs

A management command, `manage.py sync_hardcover --user mvuijlst [--dry-run] [--limit N]
[--verbose]`, run each night by a timer (`folio-hardcover.timer`, after the backup), the way
`sync_boeken` and the monthly series check run. Nothing in the app changes for the first stage.

**What it remembers.** A server-only table, `HardcoverLink` (one row per Folio book): the
book's uid, Hardcover's `book_id`, `user_book_id` and `edition_id`, the `user_book_read` ids it
made, a hash of what it last sent, whether Folio created the entry or found it already there,
and the last error. It stays out of the book's own `data`. Writing there would mark the book
changed, send it to every device and wake the booklog publish.

**Each run:**

1. Takes the books on the shelf (`Book.shelf`) that the sync covers (question 1) and works out
   for each what Hardcover should show. If the hash equals what was last sent, it skips the
   book, which is nearly every book on nearly every night.
2. **Matches** a book it has no link for, without guessing: first by ISBN-13 or ISBN-10, then
   by ASIN, edition by edition (the edition read first). A match gives the edition and its
   book. A book with no match is left for question 3, and the sync does no title search on
   its own.
3. **The first run reads the library that is already there** (`me { user_books { … } }`). A book
   Michel already added by hand is adopted, not added a second time. Its reads are compared by
   date, and only missing ones are added.
4. Writes the difference with `insert_user_book`, `update_user_book`, `insert_user_book_read`,
   `update_user_book_read` and `delete_user_book_read`.
5. **Deletes on Hardcover only what Folio made.** A book that leaves the shelf (Trash, deleted)
   loses its Hardcover entry only if the sync created it. An adopted one is left alone and
   reported. A read removed in Folio is removed there only if the sync made it.
6. Says what it did: added, updated, unchanged, unmatched, failed. With `--dry-run` it only says.

**Limits.** The free plan allows 60 requests a minute and 5,000 a day (`hardcover.py`). The
sync keeps to 50 a minute and stops cleanly at a daily budget (default 2,000). Each book
links as soon as it is written, so the next night carries on where it stopped. The first
fill (a few thousand requests, depending on question 1) takes several nights at
that pace, or one long run by hand with a higher `--budget`. After that a night is a handful
of requests.

**Failures.** If Hardcover is down or refuses the token, the run stops and says so (exit code
≠ 0, so the timer's journal shows it). A book that fails keeps its error on its link, the run
moves on to the next book, and the book is tried again the next night.

## Stages

0. **Check the schema.** Hardcover's documentation turns away automated readers, so the exact
   field and argument names above are from memory. Before any code, run one introspection
   query (`__schema`) with the token on the server and correct this plan: the status ids, the
   rating field, the read mutations, and how ownership works (an *Owned* list, or a flag).
   Try the mutations on one test book on his account, then remove it.
1. **The command, dry-run only.** Matching, the link table and the diff, with tests against
   canned Hardcover answers (as `test_hardcover.py` does). Run it on production with
   `--dry-run` and give Michel the counts: how many match, how many don't, how many are
   already on Hardcover.
2. **Writing.** Turn on writes, first with `--limit 20` and a look at his Hardcover page, then
   the whole shelf over a few nights, then the timer.
3. **Unmatched books in Folio** (if question 3 asks for it). Under Settings, *Hardcover* lists
   the books the sync could not match. Each gets a field where a Hardcover link can be pasted
   to match it by hand, plus *Leave out*. This needs a small API route (`/api/hardcover/…`) and
   works only when signed in, like the other server features.
   Signed out, the page doesn't show.

Each stage that ships bumps the version, adds release notes, and updates `docs/server.md`
(the command, the timer, the table) and `docs/using.md` (stage 3, and a line under *Export*
saying that Hardcover syncs while the other sites take the CSV).

## Questions for Michel

1. **Which books go over?** Many books have no reading status, and that doesn't mean unread.
   Sending them as *Want to read* would be wrong.
   - (a) Only books with a reading status (*To read*, *Reading*, *Read*, *Did not finish*).
   - (b) Also every book in the house, without a status, marked as owned on Hardcover.
   *Recommended: (a) first, and (b) later if he wants it. (b) is most of the requests.*
2. **Do reviews go along?** They would be public on Hardcover, beside the booklog.
   *Recommended: no, ratings only. A setting can turn reviews on later.*
3. **What happens to books Hardcover can't match** (comics and Flemish editions, mostly)?
   - (a) Left out, and the nightly report counts them.
   - (b) Left out, plus stage 3: a list in Folio where they can be matched by hand.
   *Recommended: (b), but only after stage 2's counts show whether it's worth it.*
