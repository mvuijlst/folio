# Working on Folio

## Layout

| Path | What |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | the whole app |
| `lang-nl.js` | the app's text in Dutch |
| `sw.js`, `manifest.webmanifest`, `icons/` | offline support and install metadata |
| `server/` | optional Django sync server (accounts, a copy of each shelf and its lists), and the booklog import |
| `covers/` | cover images kept by the server: `boeken/` from the import, `web/` from the catalogues (not in the repository) |
| `fonts/` | Fraunces and Instrument Sans (SIL Open Font License) |
| `vendor/tesseract/` | [tesseract.js](https://github.com/naptha/tesseract.js) 7.0.0 and language data (Apache-2.0) |
| `vendor/barcode/` | [barcode-detector](https://github.com/Sec-ant/barcode-detector) 3.2.3 / zxing-wasm (MIT) |

Icons in the interface are from [Lucide](https://lucide.dev) (ISC).

The app is plain ES modules with no build step and no dependencies to install: edit a file,
reload the page. The server's tests run with `venv/bin/python manage.py test` in `server/`
(see [server.md](server.md)); the app itself has no automated tests.

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

Bump `APP_VERSION` in `app.js`: it is shown at the bottom of the settings sheet, so you can
tell which build is running. How a push reaches the server, and installed copies, is under
[Updating](server.md#updating).
