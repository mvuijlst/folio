# A public library, and a three-pane layout on desktop

A working document: analysis and a proposed plan, nothing built yet. Written against 2.13.0.

Two things are asked for:

1. Someone with an account can show their library to the public, read-only.
2. On desktop, a more traditional "Outlook-like" layout (lists | books | the open book)
   instead of the sheet that opens from the bottom.

They are separate pieces of work that meet in one place: the read-only book page is the easiest
thing to put in a reading pane, so the public library is where the new layout starts.

## 1. What was decided

Answers given before this was written:

| Question | Decision |
| --- | --- |
| What can be made public | Chosen lists: each list has a "public" switch. Only books on a public list are visible. |
| What visitors see of a book | Title, people, cover, series, edition facts; reviews and ratings; reading dates and progress; tags and categories. **Not** the note a list keeps per book ("Lent to Jan"). |
| Address | By name: `folio.yusupov.cloud/u/<name>`. |
| Search engines | Not indexed. Rendered in the browser like the app; no server-side pages. |
| Where the three panes apply | Both the public library and your own shelf; the public library first. |
| Own shelf on desktop | The book page **and its forms** (edit details, review, edition) live in the reading pane. Adding, scanning, filters, settings stay overlays. |
| Visitor tools | Search, filter, order; all four views including statistics; series and author pages; "add to my own Folio". |

## 2. Where the app stands

What the plan has to work with, and around.

- **One page, one script.** `app.js` (6,900 lines) holds the shelf in three module-level
  variables, `books`, `lists` and `terms`, loaded from IndexedDB at start (`init`,
  `app.js:6863`). Every view reads them. There is no build step and no framework.
- **Every overlay is the one bottom sheet.** `sheet.open(content, onClose)` (`app.js:1367`)
  is called from 39 places: the book page, every form, filters, order, settings, lists,
  export. Another 17 places reach for `#sheet` or `#sheetBody` directly (the cover tint, swiping
  between books, keeping a field clear of the buttons, Escape). The sheet is a history entry, so
  Back closes it (`openLayer`, `app.js:1336`).
- **Desktop is two columns already.** From 900 px the lists are a sidebar (216 px) beside the
  books, in a page at most 1020 px wide (`styles.css:1007`). The page itself scrolls; more rows
  are appended as the window scrolls. The sheet stays a 680 px bottom sheet at every width.
- **Addresses are hashes.** `#/list/<id>`, `#/series/<name>`, `#/author/<name>`, with filters as
  a query (`readRoute`, `app.js:544`). The open book is not in the address, except
  `#/book/<booklog slug>`, which opens the book and then removes itself.
- **The server stores what the app sends.** `Book`, `List` and `Term` rows are a JSON blob per
  user and id (`server/shelf/models.py`); the server reads inside them only for covers and the
  booklog. Every endpoint but `session` and `login` needs a signed-in user. In production nginx
  serves the static files and passes only `/api/` and `/admin/` to Django.
- **A book's record mixes public and private facts.** Its lists (with notes), its reviews, its
  progress, and the booklog's bookkeeping (`boeken`, `boekenState`, `boekenWanted`,
  `boekenError`, `regroup`, `pending`, …) are all in the one blob. Reading status is on the
  book; every other list is on an edition (`works.js`).
- **Covers are public files already.** `covers/…` is served as plain files to anyone with the
  address. A cover the owner photographed can also travel inside the record as a data URI
  (`thumb`).

## 3. The public library

### 3.1 What is public, exactly

A list is public when its owner says so. Everything follows from one rule:

> **What a private list says stays private.** A visitor sees a book when it, or one of its
> editions, is on a public list, and sees of it only what public lists say.

Applied:

- **Lists.** Visitors see the public lists only, in the owner's order, with their sets. A
  private list does not exist for them: not in the sidebar, not as a filter, not as a tag on a
  book.
- **Reading belongs to the reading lists.** Reviews, ratings and read dates are what *Read* and
  *Did not finish* say; progress is what *Reading* says. They are shown only when the status
  list the book is on is public. Someone who shares only *Library* shows what they own, not
  what they thought of it.
- **Notes** on a list membership are never sent, whatever the list.
- **Editions.** Proposed: a public book shows all its editions, with their private list
  memberships removed. The alternative (hide editions that are only on private lists) leaves
  reads pointing at editions that are not there. This shows that a copy exists, not where it
  is. See open question 2.

The owner can keep a list private that the app treats as built in. *To read* private and
*Read* public is a normal choice.

### 3.2 Where the settings live

Two kinds of setting, kept in two places on purpose.

- **`public: true` on the list's own record.** Lists already sync as free-form JSON, so this
  needs no migration and no new sync shape, works offline, and reaches every device. Saving a
  list in the form assigns fields onto the existing record (`app.js:5095`), so a device running
  an older version keeps the flag rather than dropping it. If two devices disagree, the newest
  change wins, as for everything else.
- **A `Library` row per user on the server**: `enabled`, `slug` (the name in the address),
  and optionally a title and a line of introduction. This is not a synced record because the
  name has to be unique across accounts, which only the server can say, and because turning
  sharing off must take effect at once rather than at the next sync. Read and changed through
  `GET`/`POST /api/library`, signed in.

Sharing is on when `enabled` is set **and** at least one list is public. Both default to off.

**The name in the address.** The decision was "by username". Proposed: a separate `slug` that
starts out as the username and can be changed. The username is what the owner signs in with;
putting it in a public address tells everyone half of the login. (Failed logins are limited
per address and per username, `views.py:61`, which helps but is not a reason to publish it.)
Lowercase letters, digits and hyphens; a short list of reserved words. See open question 1.

### 3.3 The server

One new endpoint, open to anyone: `GET /api/public/<slug>`.

```json
{ "library": { "slug": "michel", "title": "…", "about": "…" },
  "lists": [ … ], "books": [ … ], "terms": [ … ] }
```

- **The projection is the security boundary**, so it is an allow-list: a new module
  (`server/shelf/public.py`) names every field that may leave, and a field nobody named stays
  home. A field added to books next year is private until someone decides otherwise.
  - Book: `id`, `title`, `author`, `series`, `seriesNumber`, `seriesLabel`, `originalTitle`,
    `originalLanguage`, `categories`, `tags`, `olid`, `main`, `added`, public `lists`
    (`at` only); and, when its status list is public, `rating`, `reviews` (`id`, `date`,
    `rating`, `text`, `dnf`, `ed`) and the progress fields.
  - Edition: `id`, `format`, `language`, `publisher`, `date`, `pages`, `duration`, `isbn`,
    `asin`, `people`, `cover`, `coverRatio`, `thumb`, `added`, public `lists` (`at` only).
  - List: `id`, `name`, `group`, `order`. Not `noteLabel`.
  - Terms: roles, categories and tags (they are vocabulary); list words only for the names
    and sets of public lists.
  - Never: anything of the booklog's bookkeeping, `pending`, `modified`, tombstones.
- **Unknown name, sharing off, no public list: the same 404.** A visitor cannot tell an
  account that exists from one that does not.
- **Cost.** The app wants the whole library at once, as it does for its owner. A few thousand
  books is a few megabytes of JSON before compression, more with photographed covers inline.
  An `ETag` from the newest `changed` among the user's rows (and the `Library` row) makes a
  repeat visit a 304; the built answer can sit in the database cache under that tag. To be
  measured on the real shelf before deciding whether inline `thumb`s need a file of their own.
- **Abuse.** The endpoint is unauthenticated and does real work on a miss. The cache covers
  the common case; an nginx `limit_req` on `/api/public/` covers the rest.
- **Tests.** `test_public.py` is the important one: records with private lists, notes, a
  private status list and booklog fields in, and assertions on what is absent, not only on what
  is present.

### 3.4 The address, and how the page is served

`/u/<slug>` is a path, and the app is static files with relative addresses (`styles.css`,
`app.js`). Served as it is at `/u/michel`, the page would ask for `/u/styles.css`.

Proposed: Django answers `/u/<slug>` with the contents of `index.html` plus three lines in its
head: `<base href="/">`, `<meta name="robots" content="noindex">`, and the library's name as
the title. It also sends `X-Robots-Tag: noindex` and a 404 for a name that is not shared.
nginx gets one more `location /u/` passed to gunicorn. This is a change on the server outside
the repository, to be written into `docs/server.md`.

What `<base>` touches, all checked against the code:

- **`addressOf` returns hash-only addresses** (`app.js:565`), and `pushState` resolves those
  against the base: `#/list/read` would become `/#/list/read` and leave the library. It has to
  return the path with the hash. Small, but the page breaks without it.
- **The service worker answers every navigation with the cached `./`** (`sw.js`,
  `staleWhileRevalidate`), which is the page without the `<base>`. `/u/` joins `BYPASS`. A
  public library then needs the network to open, which is right: its books come from the server.
- **The icon sprite** (`<use href="#i-…">`): current browsers treat a fragment-only reference
  as the same document regardless of `<base>`; older Safari did not. To be checked on a real
  iPhone before anything else is built on it.
- `abs()` already resolves against `document.baseURI` (`app.js:52`), so API calls and covers
  follow.

The fallback, if `<base>` misbehaves: `/?u=<slug>`. No server change, no base, and the
service worker already ignores the query. Uglier, and it cannot return a 404.

Not indexed means the address is unlisted, not secret. The settings page should say so.

### 3.5 The app as a visitor

The same app, in a second mode, when the address is `/u/<slug>`.

- **Start.** Fetch the public library into `books`, `lists` and `terms`. No IndexedDB, no
  sync, no pending lookups, no share target, no scanner shortcut.
- **Read-only is enforced in the storage layer, not by hiding buttons.** This matters more
  than it seems. The visitor is on the same origin as their own Folio, and may have their own
  shelf in this browser's IndexedDB. A missed *Edit* button that reached `saveBook` would write
  a stranger's book into the visitor's own shelf and sync it to their account. So while
  visiting, `DB.put`/`DB.del`, `touch*` and `runSync` refuse outright, and hiding the controls
  is the second line, not the first.
- **What goes.** *Add a book*, selecting, the settings sheet (theme and language stay, as two
  buttons), every edit and action on the book page, the booklog, *Possibly the same book*, and
  the *Other* filters (no cover, own photo, on the booklog, twins). What the app remembers per
  place (view, order) is kept apart from the visitor's own.
- **What stays.** Lists, series and author pages, search, filters, orders, the four views. The
  statistics follow what is public: without a public *Read* list there are no reads to count.
- **The header** names the library rather than Folio, with a quiet link to Folio itself.
- **The open book goes in the address** (`…&book=<id>`, section 4.3), so a visitor can send
  someone one book.

**Add to my own Folio.** Being on the same origin makes this cheap. The public page cannot
add to the visitor's shelf itself, because the page's `books` are the library's, and holding
two shelves in one page is exactly the mix-up the storage rule exists to prevent. Instead it
hands over: the book's facts (title, people, edition facts, cover address; no reviews, rating
or lists) are left where the visitor's own Folio picks them up at start, as it already picks up
what another app shares to it (`takeShare`, `app.js:4343`), and their Folio opens with the
usual proposal: add it, or add it as another edition of a book they have.

### 3.6 The owner's side

A page under Settings, *Public library*, for a signed-in account:

- The switch, and what it means in a sentence: anyone with the address can read these lists.
- The address, with copy and share, and the name in it.
- The lists, each with its switch (the list form has the same switch).
- A count that makes the consequence concrete: "412 books on 3 lists are public."
- *See it as a visitor.*

Turning it on asks once, naming what becomes visible. The README's privacy section gains a
paragraph. What visitors see is what the server has: a change shows after the next sync.

## 4. Three panes on desktop

### 4.1 The layout

| Width | Layout |
| --- | --- |
| under 900 px | As now: one column, bottom sheet. |
| 900 to 1199 px | As now: lists beside books. The sheet becomes a centred dialog (below). |
| 1200 px and up | Lists (216 px), books (about 400 px), the open book in the rest. |

- **Each column scrolls on its own**, in a page the height of the window. Today the page
  scrolls and the tools stick; rows are appended on window scroll (`app.js:2050`) and the filter
  chips tuck away by window scroll (`app.js:2057`). Both listeners move to the books column.
  This is the part of the layout that touches the most existing behaviour.
- **The views in a narrow column.** *List* and *cards* suit it. *Covers* becomes three or four
  across. *Statistics* needs the width: it takes the books column and the pane together, and
  there is no open book while it shows.
- **Nothing open.** The pane shows the shelf's quiet illustration and a line, not a blank.
- **The row of the open book is marked**, in all three views of books.

Independently of the panes, and cheap: **from 900 px the sheet is a centred dialog** (same
element, same code, CSS only: no handle, rounded all round, fades in rather than sliding up).
That alone removes "opens from the bottom" on desktop for filters, settings and adding, and it
can ship first.

### 4.2 Two hosts instead of one

Settings must be able to open over a book that is in the pane, so the pane cannot be the sheet
element moved sideways. There are two hosts: the **sheet** (modal, as now) and the **pane**
(part of the page).

The pane is not an overlay, and that is most of the work:

- no backdrop, no scroll lock on the page (`relock`), no `aria-modal`; a labelled region;
- no history entry per book (below);
- it stays while the list beside it is filtered, ordered or searched.

What goes where on a wide screen:

| Pane | Sheet (dialog) |
| --- | --- |
| The book page | Add a book, scanner, describe |
| Edit details, review, edition forms | Filter, order |
| Choose edition, combine, split, delete confirmation, booklog form | Settings and its pages, lists, export |
| | Editing many books at once |

The book's forms already hand each other a `back` callback and swap the sheet's content, so
they are one family that starts at `openBook`. That family is given its host when it opens
(pane on a wide screen, sheet otherwise) and passes it along. The 17 direct references to
`#sheet` and `#sheetBody` go through the host: the cover tint, swiping, Escape, keeping a
field clear of the buttons, `bookPageOpen`.

A new book's form (from adding) stays in the dialog: there is no row to select yet.

### 4.3 The open book in the address

Today the open book is a layer: a history entry with no address. In a pane it is a selection.

- The address carries it: `#/list/read?format=audiobook&book=<id>`. `book` is reserved; it is
  not a filter.
- Selecting another book **replaces** the address rather than adding a step, as a mail client
  does: Back leaves the list, it does not walk back through every book looked at.
- On a phone the same address opens the sheet over the list.
- `#/book/<booklog slug>` keeps working as it does.

This is also what gives a public library links to single books, and it makes a reload come
back to the same book.

### 4.4 Behaviour to settle

- **A form with changes in it, and a click on another row.** The pane asks (keep editing,
  discard), as closing a dirty form must. Today a tap beside the sheet closes it without
  asking; a pane makes that mistake much easier to make, since the list is right there.
- **Keyboard.** Up and down move through the list (left and right already turn pages,
  `initTurning`); Enter moves focus into the pane; Escape is Cancel in a form (`data-cancel`
  already) and otherwise returns focus to the list. Not while typing in a field.
- **The open book stops matching the filters.** It stays in the pane until another is chosen.
- **Selecting many.** Clicking toggles a row, as now; the pane keeps what it showed.
- **The window is resized across 1200 px with a book open.** The book is redrawn in the other
  host. A dirty form is the awkward case: simplest is to keep the host it started in until it
  is saved or cancelled.

### 4.5 Why the public library goes first

A visitor's book page has no forms, no actions and nothing to save. Putting it in a pane needs
the layout, the second host, the selection in the address and the keyboard, and none of the
dirty-form questions. The owner's shelf then adds the forms to something that already works.

## 5. Stages

Each can be released on its own. Sizes are relative.

| # | What | Size | Notes |
| --- | --- | --- | --- |
| 1 | Dialog instead of bottom sheet from 900 px | S | CSS only. Useful at once. |
| 2 | `addressOf` with the path; the open book in the address (`book=`) | S | Groundwork for 4 and 5; harmless alone. |
| 3 | Server: `Library`, the projection, `/api/library`, `/api/public/<slug>`, tests | M | The part to review hardest. |
| 4 | Owner's settings page and the list switch; visitor mode at `/u/<slug>` with today's layout; read-only storage; nginx and service worker | L | Public libraries exist from here. |
| 5 | Three panes for visitors: independent scrolling, the pane host, selection, keyboard | L | |
| 6 | Three panes for the owner: the book page, then its forms, the dirty-form guard | L | |
| 7 | Add to my own Folio | S | Any time after 4. |

No change to the sync schema (`"schema": 2`): the list flag rides in data the server already
stores as it comes.

`app.js` is one file of 6,900 lines, and visitor mode and the pane both add branches to it.
The new parts that stand alone (the visitor's start, the pane host) are better as modules of
their own, as `works.js` and `terms.js` are; each new one joins `MODULES` and `SHELL_FILES` in
`sw.js`.

## 6. Risks

- **A leak through the projection.** Mitigated by the allow-list and by tests that assert
  absence. The record's shape is not otherwise known to the server, so this module becomes the
  second place (after `works.py`) that must follow the app's data.
- **A visitor's own shelf written to by mistake.** Mitigated by refusing in the storage layer
  (3.5).
- **`<base>` and the icon sprite on older Safari.** Check first; the fallback is `/?u=`.
- **Independent column scrolling** changes how the tools stick, how rows load and how the
  chips tuck. The interface has no automated tests (README, *Status*), so this is tested by
  hand, on a phone as well, since the same code serves it.
- **Payload size** for a large library with photographed covers inline. Measure in stage 3.
- **Review text is Markdown rendered in the browser.** It is the owner's own text shown to
  strangers now, so `renderMarkdown` (`app.js:3792`) deserves a second look for anything it
  would let through, even with the page's Content-Security-Policy refusing inline scripts.

## 7. Open questions

1. **A name for the address apart from the username?** Proposed yes, starting as the
   username (3.2).
2. **Editions that are only on private lists**: shown with the rest of a public book
   (proposed), or hidden?
3. **Reviews follow the reading lists** (3.1): a book that is public through *Library* alone
   shows no rating or review unless *Read* is public too. Is that the wanted rule, or should
   reviews be a switch of their own?
4. **The booklog link.** A read published to boeken.tsuk.org has its address there (`url`).
   Show it to visitors as a link? It is public already, but it ties the library to the site.
5. **Photographed covers** are the owner's own pictures. Public with the rest, assumed.
6. **A title and a line of introduction** for a library, or just the name?
7. **1200 px** for three panes, and is a fixed 400 px books column enough, or should it be
   draggable (later)?
8. **Other accounts.** Accounts are made by hand in the admin. Is sharing for every account
   from the start, or a permission the admin grants?
