# A public catalogue of the whole shelf (proposal)

Nothing here is built. This is a note on whether and how the whole shelf could be made public,
next to the booklog, without changing what Folio does.

## The idea

[boeken.tsuk.org](https://boeken.tsuk.org) shows what was read, one post per read, with its
review. The shelf in Folio holds more: the library, books never read, every edition, the other
lists. The proposal is a second public site for all of that: a catalogue people can navigate
and filter, with the look of Folio, and with statistics and visualisations of the shelf.

It should not be a dynamic website: the server should do nothing per visitor.

## The shape

A read-only exporter plus a static site that filters in the browser.

1. **Export.** A management command (say `export_public`) reads an account's shelf and writes a
   folder of plain files: one compact `books.json` and the small cover images the server
   already keeps. It runs on a timer, as `sync_boeken` does, and rewrites only when the shelf
   changed.
2. **Site.** Static HTML, CSS and JS with no build step, like the app. It loads the JSON once
   and filters, sorts and searches in the browser. The state of the filters is in the URL, so a
   view such as "Dutch audiobooks read in 2024" is a link that can be shared.
3. **Look.** Folio's fonts and colours and its three views (list, covers, cards), without
   anything that edits.

The exporter only reads, so Folio and the booklog work as they do now. The result is files, so
it can be hosted anywhere.

A few thousand books should come to a few hundred kB of JSON once compressed, with covers
loaded as they scroll into view. This is an estimate: the size of the real shelf has not been
measured.

## Why not a second Hugo site

The booklog is a site of posts. A catalogue is for slicing, and Hugo can only render a fixed
set of slices ahead of time. The two would stand side by side: the catalogue links to a book's
page in the booklog where it has one, and reviews stay there.

## Statistics and visualisations

Computed in the browser, so they follow the filters: choose an author or a language and every
chart is redrawn for those books.

- **The pile over time:** books acquired against books read; the to-read stack growing and
  shrinking.
- **Age of what is read:** year of publication against the date of reading, a dot per book.
- **Formats:** paper, e-book and audiobook per year, in pages and in hours listened.
- **Languages:** from the language a book was written in to the language it was read in.
- **A shelf of spines:** a spine per book as wide as its number of pages, coloured by category
  or rating.
- A reading calendar, how far each series is read, rereads, ratings per category.

Some of these depend on how complete the shelf's facts are (the date a book was added, the
original language). That is to be checked before any of them is promised.

## To decide

- **What is public.** Probably not *Lent out*, notes per book, a wishlist, or reviews that are
  not published. The export should name the lists and fields it includes, so that nothing
  becomes public by being forgotten.
- **Its relation to the booklog.** Next to it (proposed here), or in time instead of it.
- **Where it lives.** Beside the booklog or beside Folio; in this repository or in one of its
  own.
- **Language.** Dutch as the booklog is, or Dutch and English as Folio is.

## Not yet looked at

- boeken.tsuk.org itself: this note is written from [booklog.md](booklog.md), not from the site.
- How many books and editions the shelf holds, and how complete their facts are.
