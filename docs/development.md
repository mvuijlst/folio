# Working on Folio

## Layout

| Path | What |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | the whole app; `theme.js` sets the theme before first paint |
| `works.js` | a book and its editions: the pure functions for them (upgrading an old record, which edition a row shows, finding the book a find is another edition of, combining, splitting), shared in spirit with `server/shelf/works.py` |
| `terms.js` | words kept in two languages (for now the roles of people on a book): the standard ones, yours on top, and how a role is stored, shown and tidied |
| `tests/` | the app's tests (`node --test "tests/*.test.mjs"`, Node 22: books and editions, backup, national catalogues, the website export and its zip, corner finding, roles, and that the page and the script are of one version), and `tests/fixtures/works/`: old records and what each must become, which the server is tested against too |
| `backup.js` | the backup file: what it holds, and how a restore compares it with the device before anything is written |
| `national.js` | the national catalogues (KB for 978-90/94, BnF for 978-2 and 979-10): the URLs, reading their answers, and how their facts merge with Open Library's and Google Books'; `server/shelf/national.py` does the same on the server |
| `site.js` | the export as a website: a page per read as Markdown for Hugo or Eleventy, or plain HTML pages, and the zip they go in; the app hands it the books and the covers |
| `corners.js` | finds a book's four corners in a photograph of its cover, for *Straighten*, and the proportions it comes out in |
| `screensaver.js` | the cover wall; loaded only when asked for |
| `lang-nl.js` | the app's text in Dutch |
| `sw.js`, `manifest.webmanifest`, `icons/` | offline support and install metadata |
| `server/` | optional Django sync server (accounts, a copy of each shelf and its lists), the booklog import and publishing, and the scripts that set up its timers (`setup-*.sh`) |
| `.github/workflows/deploy.yml` | the deploy: every push to `main` (see [Updating](server.md#updating)) |
| `CLAUDE.md` | what an assistant working on the repository is told: when to push to `main`, and what to do first |
| `covers/` | cover images kept by the server: `boeken/` from the import, `web/` fetched from the catalogues and anywhere else on the web, `own/` the ones photographed or supplied (not in the repository) |
| `fonts/` | Fraunces and Instrument Sans (SIL Open Font License) |
| `vendor/tesseract/` | [tesseract.js](https://github.com/naptha/tesseract.js) 7.0.0 and its English data, for printed ISBNs (Apache-2.0) |
| `vendor/barcode/` | [barcode-detector](https://github.com/Sec-ant/barcode-detector) 3.2.3 / zxing-wasm (MIT) |

Icons in the interface are from [Lucide](https://lucide.dev) (ISC).

The app is plain ES modules with no build step and no dependencies to install: edit a file,
reload the page. The server's tests run with `venv/bin/python manage.py test` in `server/`
(see [server.md](server.md)); the app's, with `node --test "tests/*.test.mjs"`. Both sides upgrade a record from before editions the same way, and
`tests/fixtures/works/` is how that is held: a fixture is an old record and the record it must
become (`node tests/fixtures/works/make-after.mjs` fills in a new one's, to be read before it is
trusted). Opening the app with `?guard=1` makes reading a field that moved into the editions
off a book itself say so in the console, with where.

`index.html` carries a Content-Security-Policy: scripts only from the app's own address (no
inline ones, which is why the theme is set by `theme.js`), WebAssembly allowed for the barcode
and ISBN readers, pictures and lookups from any https address. A script, worker or font from
anywhere else needs a line there first.

## Old names

Folio began as *Bookscan*. The names of things kept in the browser (localStorage keys, the
IndexedDB databases, the service worker's caches and messages) still start with `bookscan`:
renaming them would cut existing installs off from their shelf.

## Translations

Dutch lives in [`lang-nl.js`](../lang-nl.js), a dictionary from the English sentences in the
code; another language is another such file plus a line in `LANGS` and `DICTIONARIES` in
`app.js`.

## Icon and colours

The app's own icon and its colours come from one picture, `icons/folio-art.jpg`: an open book
in a dark disc on an indigo ground. `icons/make.py` cuts every icon size out of it (run it again
after replacing the picture), and the colour tokens at the top of `styles.css` are sampled from
it: the indigo ground, the amber of the book's pages for the main button and the list you are
on, and for the three reading lists a dot each: the blue of the book's left-hand pages for
*To read*, the gold of the middle mark for *Reading*, the mint of the first for *Read*.
Corners are barely rounded, and only the one main button of a screen is filled. *Add a book*
alone has a gradient: the mint to blue of the book's left-hand pages.

## Releasing

Run the tests, add the version to [release-notes.md](release-notes.md), and bump
`APP_VERSION` in `app.js` and `folio-version` in `index.html` with it: the version is
shown at the bottom of the settings sheet, so you can tell which build is running, and a page
whose version is not the script's is reloaded once (an old page from the cache next to a new
script, while a new version's service worker takes over). `tests/page.test.mjs` and the deploy
both refuse the two apart. The deploy also refuses a script that doesn't parse (`node --check`
on each `.js` at the top, as a module): it would stop the whole app. How a push reaches the
server, and installed copies, is under [Updating](server.md#updating).
