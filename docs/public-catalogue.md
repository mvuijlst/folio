# A public catalogue of the whole shelf (proposal)

Nothing here is built. This is a note on whether and how the whole shelf could be made public,
next to the booklog, without changing what Folio does.

## The idea

[boeken.tsuk.org](https://boeken.tsuk.org) shows what was read, one post per read, with its
review. The shelf in Folio holds more: the library, books never read, every edition, the other
lists. The proposal is to make all of that public: a catalogue people can navigate and filter,
with statistics and visualisations of the shelf.

It should not be a dynamic website: the server should do nothing per visitor.

## What the booklog already has

The booklog already has statistics and a search:

- **Statistics** (`site/layouts/_default/stats.html` and `site/assets/js/stats.js` in the
  booklog): books per year and per month, categories per year, a treemap of categories, the
  languages of the editions read, a histogram of length and the best six. Hugo computes them
  when the site is built, for all the books read, and they cannot be filtered.
- **Search** with Pagefind, over the posts.

So what is new here is not statistics as such. It is:

1. **The books that are not on the booklog.** The audit of 17 November 2026 counted 762 books
   only in Folio, about half the shelf: mostly the library, scanned and never read.
2. **Charts that follow a filter:** choose an author or a language and every chart is redrawn
   for those books.

## The order proposed

1. **The charts first in Folio, privately.** That needs no export, no choice of what is public
   and no new site, and the charts see the whole shelf, *Lent out* and the wishlist included.
   It also shows which charts are worth having before any of them is made public.
2. **Then, if it is still wanted, the catalogue as a page of the booklog,** not a second site.
   One public address; the reviews, author pages and series one click away; Dutch, the look and
   the deploy already settled. The statistics page of the booklog can become that same page,
   filterable, instead of standing beside it.

Hugo can only render a fixed set of slices ahead of time, but that does not matter here: the
page is static, and the slicing happens in the browser over a JSON file.

## The shape

1. **Export.** A management command (say `export_public`) reads an account's shelf and writes
   one compact `books.json` with the fields it is allowed to (see below), and the small cover
   images the server already keeps. It runs on a timer, as `sync_boeken` does, and rewrites only
   when the shelf changed.
2. **Where the file goes.** Not into the booklog's git repository: a file of a few hundred kB
   rewritten every few minutes would bloat its history. The booklog is served from the same
   server as Folio (`/home/django/boeken-tsuk`), and its images are already served from
   `media/`, outside what the build replaces. The export can be written beside them and served
   the same way. If it has to be in git after all, then at most once a day.
3. **Page.** One page of the booklog with plain JS, no build step. It loads the JSON once and
   filters, sorts and searches in the browser. The state of the filters is in the URL, so a
   view such as "Dutch audiobooks read in 2024" is a link that can be shared. Where a book has
   posts in the booklog, it links to them.
4. **Look.** The booklog's own. Folio's list, covers and cards rebuilt as a second front end
   would drift away from Folio with every change to it. If it has to look like Folio, then it
   should be Folio's own code, read-only, over the exported file: whether `app.js` can run like
   that has not been looked at.

The exporter only reads, so Folio and the booklog work as they do now.

**Size.** In a copy of the database, all the books' facts with the text of every review come to
3.8 MB before compression. Without the reviews, and with only the fields the catalogue needs, it
will be a small part of that; covers are loaded as they scroll into view.

## Statistics and visualisations

Computed in the browser, so they follow the filters. What the shelf's facts allow (counted in a
copy of the database of 17 November 2026: 1,468 books, 1,488 editions):

**The facts are there:**

- **Age of what is read:** year of publication against the date of reading, a dot per book
  (publication date on 1,481 editions; reading dates on the reviews).
- **Formats:** paper, e-book and audiobook per year (format on 1,478 editions), in pages
  (1,388) and in hours listened (length on the 63 audiobooks).
- **A shelf of spines:** a spine per book as wide as its number of pages, coloured by category
  or rating.
- A reading calendar, how far each series is read, rereads, ratings per category.

**The facts are not there:**

- **The pile over time** (books acquired against books read): nothing on the shelf says when a
  book was acquired. A book's `added` is the date of its first read for the booklog's books
  (1,297 of 1,468) and the day it was scanned for the others.
- **From the language a book was written in to the language it was read in:** there is no
  original language, only the language of each edition (on 1,384 of 1,488). It could be guessed
  for a book that has editions in two languages, and for no other.

These two need a new fact on the book before they can be drawn, or should be left out.

## What is public

The export names the fields and the lists it includes; everything else stays out. A list of
what to leave out would make something public the day a new field is added and nobody thinks of
it.

Clearly out: *Lent out* (and to whom), the wishlist, notes per book, reviews that are not
published, and what the app keeps for itself (`issues`, `pending`, `unresolved`, `regroup`,
`boekenState`).

## To decide

- **Whether the charts in Folio are enough,** once they exist.
- **The relation to the booklog:** a page of it (proposed here), or a site of its own beside
  it.
- **The look:** the booklog's, or Folio's own code, read-only.

## Not yet looked at

- The counts above are from a copy of the database, not from the live one.
- Whether `app.js` could run read-only over an exported file.
- What the booklog's build does to files beside `public/` and `media/`.
