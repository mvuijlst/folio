# Running Folio

The app on its own, the optional sync server, and how the one deployment is updated.

## The app on its own

The app is plain static files with no build step. It has to be served over HTTPS for the
camera and for installing.

- **GitHub Pages:** repository *Settings → Pages → Deploy from a branch*, pick the branch and
  `/ (root)`. Open the resulting URL in Chrome on Android and choose *Install app* (also offered
  under the settings icon in the app).
- **Locally:** `python3 -m http.server` in this folder, then open `http://localhost:8000`.

## Accounts and sync (optional)

Without an account everything stays on the phone. With one (settings → *Account*), the shelf
and its lists are also kept on the server and can be opened on any other device by signing in
there. Changes sync a moment after you make them, when the app comes back to the foreground,
and when you're back online; if two devices change the same book or the same list, the newest
change wins. *Sign out & clear* removes the shelf from that device only.

The server is a small Django app in [`server/`](../server): a JSON API (`/api/session`, `/api/login`,
`/api/logout`, `/api/sync`, `/api/gone` (which of a backup's records were deleted since, for
restoring one), `/api/cover`, `/api/booklog-names`, `/api/library` and `/api/public/<name>` (the
public library), `/api/hardcover` and `/api/pages` (see [Series from Hardcover](#series-from-hardcover)
and [Filling in what a shelf lacks](#filling-in-what-a-shelf-lacks)), and for the assistant
`/api/suggest`, `/api/translate`, `/api/categories`, `/api/tag-merges` and `/api/original`) plus
the Django admin at `/admin/`, where accounts are made. There is no public sign-up.

```bash
cd server
python -m venv venv && venv/bin/pip install -r requirements.txt
export DJANGO_DEBUG=1
venv/bin/python manage.py migrate && venv/bin/python manage.py createcachetable
venv/bin/python manage.py createsuperuser
venv/bin/python manage.py runserver   # serves the app too, at http://localhost:8000
venv/bin/python manage.py test
node --test "../tests/*.test.mjs"     # the app's own logic (works, backup, national catalogues, corners…)
```

Settings are environment variables. Copy [`server/.env.example`](../server/.env.example) to
`server/.env`, which says what each one is for; Django does not read the file itself, so
load it into the shell (`set -a; . ./.env; set +a`) before running `manage.py`. The assistant
needs `OPENAI_API_KEY`; without a key the app does not offer it. Publishing to the booklog
has settings of its own: see [booklog.md](booklog.md).

### Production (folio.yusupov.cloud)

nginx serves the static app from `/home/django/folio-yusupov` and passes `/api/` and
`/admin/` to gunicorn on `127.0.0.1:8030` (systemd unit `folio-yusupov`). Settings come from
`server/.env` (`DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`). A push deploys both the app and the
sync server (see [Updating](#updating)); the deploy user `django` may restart only that unit
(`/etc/sudoers.d/folio-deploy`).

A public library (`/u/<name>`, see [the plan](public-library-plan.md)) is the app's page as
Django sends it, with a `<base>` and a request not to be indexed, so nginx passes `/u/` on as
well. Its data comes from `/api/public/<name>`, open to anyone, which is limited per address.
`server/setup-public-library.sh` (as root) makes both changes, copying the site's own
`location /api/` block, and can allow an account at the same time; by hand it is:

```nginx
# in the http block
limit_req_zone $binary_remote_addr zone=folio_public:10m rate=30r/m;

# in the server block, next to /api/ and /admin/
location /u/ {
    proxy_pass http://127.0.0.1:8030;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
location /api/public/ {
    limit_req zone=folio_public burst=20 nodelay;
    proxy_pass http://127.0.0.1:8030;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

The server keeps every cover twice: small for lists and large (at most 1600 px) to look at,
for public libraries too, for the booklog and for site exports. Every cover of a signed-in
account is kept there, wherever it came from: a catalogue, a bookshop, any picture on the web
(over https; an address on the server's own network is refused, also when a name or a redirect
leads there). Covers still elsewhere, and covers from before it kept large ones, are fetched a
few per sync; `sudo bash server/fetch-large-covers.sh` (no arguments) does them all at once. To
have that done every hour, also when nobody syncs, install the timer once:

```bash
sudo bash /home/django/folio-yusupov/server/setup-cover-fetch.sh
```

See what it did with `journalctl -u folio-covers.service`. A cover that can't be fetched is
tried again a week later.

Whether covers reach the server at all, and why one doesn't: `sudo bash server/check-covers.sh
[USERNAME]` (it changes nothing) fetches one known cover from Open Library, counts each
account's covers kept here (small, and also large), and lists every cover still elsewhere with
the error its address gives now.

If a library doesn't show, `sudo bash server/check-public-library.sh` (no arguments, changes
nothing) says for each library what is missing, and whether nginx or the Folio server refuses it.

Who may share is set by hand in the admin: under *Libraries*, add one for the account and tick
*allowed*. The owner then turns it on and chooses the lists in the app (Settings → Public
library).

The old address, bookscan.yusupov.cloud, serves the same files and the same accounts, with a
notice at the top that points to the new one (`MOVED` in `app.js`). A shelf lives in the
browser per address, so it only comes along by signing in at the new address. Once nobody
opens the old address any more, its nginx site can become a redirect.

## Updating

Pushing to the repository deploys to the server (`.github/workflows/deploy.yml`, which lists the
secrets it needs): it copies the files whose content changed and, where the sync server is set up,
installs its requirements, migrates and restarts it. Before anything is copied it checks that
every script parses and that `index.html` and `app.js` say the same version; the README, `docs/`
and `tests/` are not copied. Otherwise replace the files on the server by
hand; nothing else is needed for the app. An installed copy compares its cached
files with the server each time it is opened (and when it returns to the foreground), and
restarts itself into the new version within a few seconds. If you are in the middle of
something it shows *A new version is ready · Reload* instead. The running version is shown at
the bottom of the settings sheet; bump `APP_VERSION` in `app.js` when you release.

Do not uninstall the app to update it: Android offers to clear the site's data along with it,
and that deletes the shelf.

A sync says which shape of book the app speaks (`"schema": 3`: books with editions since 2.0,
the Trash since 2.33.0). The server refuses a sync without the current one (409, *This version of
Folio is out of date…*), so a copy of the app from before can never write books in an old shape
over new ones; it shows that under Settings and updates itself the next time it is opened. The one-time
conversion of a shelf is `manage.py to_works` (see [booklog.md](booklog.md#books-with-editions-and-what-a-version-was)).

## Nightly copies

Besides the backup file each device can make (Settings → *As a file*, see
[using.md](using.md#backup-and-restore)), the server copies itself every night, and a PC fetches
those copies.

**On the server.** Installed once, as root, after a deploy that has the scripts:

```bash
sudo bash /home/django/folio-yusupov/server/setup-nightly-backup.sh
```

It installs [`folio-backup.sh`](../server/folio-backup.sh) as `/usr/local/sbin/folio-backup`
(owned by root: the copy in the web root can be written by the deploy user) and a timer,
`folio-backup.timer`, that runs it every night at 03:30 UTC, or at the next boot after a night
the server was off. Run the setup again after a deploy that changed `folio-backup.sh`. Each night:

- If anything worth keeping changed since the last copy (books, lists, words, public
  libraries, accounts; sessions and login times don't count), the database is copied while the
  server runs (`VACUUM INTO`), checked (`PRAGMA integrity_check`) and compressed into
  `/var/backups/folio/db/folio-<UTC stamp>.sqlite3.zst`. The newest 14 are kept. A night with
  nothing changed makes no copy. `FOLIO_BACKUP_FORCE=1 /usr/local/sbin/folio-backup` makes one
  anyway.
- The covers that can't be fetched again, `covers/own` (photographed covers and the photos
  straightened covers were made from), are added to `/var/backups/folio/covers/own`. Nothing is
  removed there. Catalogue covers (`covers/web`) and the booklog's (`covers/boeken`) come back by
  themselves.
- `/var/backups/folio/last-copy.json` says which copy is the newest, when it was made and
  when the job last ran. The server reads it (`FOLIO_BACKUP_STAMP`), and Settings → *About*
  tells a staff account when the last copy was made, and warns when the job hasn't run for a
  day and a half.

`/var/backups/folio` is outside the web root; `db/` and `covers/` can only be read by root. On
2026-11-20 a copy was 336 MB (the database is 588 MB, much of it inline cover thumbnails), and
`covers/own` 343 MB. See what happened with `journalctl -u folio-backup.service`.

**On the PC.** [`pull-backup.ps1`](../server/pull-backup.ps1) fetches the newest copy over SSH,
unless it is there already, keeps the newest 14, and adds the covers it doesn't have yet. Every
run writes a line to `pull-backup.log` in its folder, and fails (exit 1) when the server can't
be reached or the server's job hasn't run for a day and a half. Once, from PowerShell:

```powershell
M:\dev\bookscan\server\pull-backup.ps1 -Folder Z:\Backups\Folio -Install
```

`-Install` registers the scheduled task *Folio backup pull*: every day at 10:00, or as soon as
the PC is on after that. It uses the `yusupov` host from `~/.ssh/config` on port 2708 (`-Server`,
`-Port`), with the key that lets you in without a prompt. Michel's copies are in
`Z:\Backups\Folio` since 2026-11-20.

**Restoring the server from a copy.** Everything on the server goes back to the night of the copy:

```bash
systemctl stop folio-boeken.timer folio-boeken.service folio-yusupov
cd /home/django/folio-yusupov/server
cp -a db.sqlite3 "db.sqlite3.before-restore-$(date -u +%Y%m%d-%H%M%S)"   # what there was
zstd -d /var/backups/folio/db/folio-<stamp>.sqlite3.zst -o /tmp/folio.sqlite3
sqlite3 /tmp/folio.sqlite3 'PRAGMA integrity_check'                        # says ok
rm -f db.sqlite3-wal db.sqlite3-shm
install -o django -g django -m 644 /tmp/folio.sqlite3 db.sqlite3 && rm /tmp/folio.sqlite3
rsync -a /var/backups/folio/covers/own/ ../covers/own/ && chown -R django:django ../covers/own
systemctl start folio-yusupov folio-boeken.timer
```

From the PC, copy the file up first (`scp -P 2708 Z:\Backups\Folio\db\folio-<stamp>.sqlite3.zst
yusupov:/tmp/`). Then the devices: each has synced past the moment of the copy, so it won't
hear of what went back. On each one, make a backup file first if it may hold changes the copy
lacks, then *Sign out & clear*, sign in again, and restore that file (Settings → *As a file* →
*Restore*). What it adds or replaces goes up to the server like any other change.

## The Trash on the server

A book in the Trash is a record like any other, with `trashed` in its data, so it syncs and can
be put back on any device. Everything that reads the shelf goes through `Book.shelf(user)`, which
leaves it out (the public library, publishing, covers, categories, every management command);
`Book.kept(user)` has it too, for what must know it is there (the booklog import, which posts
are claimed). `test_trash` fails when code asks for `deleted=False` itself. Since the Trash, a
sync must say `"schema": 3`; older copies of the app are answered 409 and update.

Publishing and the Trash (`shelf/publish.py`): a trashed book is not published and its pages stay.
A book on To read that was dropped (`trashed` + `dropped`) has its posts deleted and is unlinked
while it is in the Trash; put back, the app sets `boekenWanted` and it is published again.
`unpublish` (slugs) takes posts off the booklog on purpose: the posts go, the book and its reads
stay, those reads marked `local` and never published again (`for_booklog` leaves them out).

## Series from Hardcover

With `HARDCOVER_API_TOKEN` in `server/.env` (a personal token from hardcover.app; it expires on the
date chosen when it was made, then answers 401), `/api/hardcover` answers a staff account: `{"name"}`
finds a series, `{"id"}` gives its volumes (`shelf/hardcover.py`, answers kept a day). The sync tells
the app whether it may ask (`hardcover`). The free plan allows 5,000 requests a day and 60 a minute.

What a series' list holds is sorted as measured on 2026-11-20 and 21: of series with one name, the
one with the most books; its books asked from their side, most-read first (the series' own list
leaves out books flagged as box sets, and the API cuts long lists short); per number the book most
people shelved (translations and parts lose to it); a book the series marks as a box set never, one
that only marks itself so only with 100 readers and ten times the others' (*Every Heart a Doorway*
carries the flag wrongly); nothing without a number; in a widely read series nothing under 1% of the
most-read book's readers unless it isn't out yet; a small series (comics) keeps all.

`manage.py check_series --user NAME [--write]` asks again about the series neither marked *Finished*
nor *Done with it* and keeps their new volumes on the series' record (`news`), which the app shows until
seen; the series' length grows with them. Installed
once a month (the 1st, 04:30 UTC) by:

```bash
sudo bash /home/django/folio-yusupov/server/setup-series-check.sh mvuijlst
```

See what it did with `journalctl -u folio-series-check.service`.

## Hardcover sync

`manage.py sync_hardcover --user NAME [--dry-run] [--limit N] [--budget N] [--verbose]` sends the
books with a reading status to that account's library on Hardcover, with the same token
(`shelf/hardcover_sync.py`; the reasoning is in [hardcover-sync-plan.md](hardcover-sync-plan.md)).
It goes one way, and Folio is the record:

- **What goes over.** The status (*To read*, *Reading*, *Read*, *Did not finish* become Want to
  Read, Currently Reading, Read, Did Not Finish), the rating halved to stars (that of the latest
  rated read, else the book's), the edition read last or the main one, the date added, and each
  read with a full date (finished on that day, in its edition). A read with only a year or a
  month, and a read marked *did not finish*, stay home. Reviews, categories, tags, places and
  notes never go. Books with no status don't go either: unlogged is not unread.
- **Matching** is by number first: ISBN-13, ISBN-10 or ASIN, the edition read last first. A
  book no number finds may be in your own Hardcover library. It is taken when exactly one book
  there has the same title and a writer with the same surname. The title can be the book's
  own, an edition's or the original, brackets are left out, and one title may stop at a colon
  where the other goes on, with the same numbers in both (*Mother Night* is *Mother Night: A
  Novel*, but *The Mongoliad: Book One* is not *Book Three*). A title is never looked up in
  Hardcover's catalogue, and never adds a book. A book still without a match is counted, and
  asked about again when its editions change or after a week.
- **What is already there is adopted.** A book already in the Hardcover library (an old
  Goodreads import) is updated, not added again: its status always, its rating only when Folio
  has one, its edition when Folio's is on Hardcover. Reads of the same day count as one read,
  and an empty read is filled before a new one is made. The sync never deletes an adopted book
  or a read it did not make. A book it added itself goes again when the book leaves the shelf
  or loses its status.
- **What was sent** is kept in `HardcoverLink` (in the admin): the Hardcover ids, whether the
  sync created the entry, the reads it made, a hash, the last error. An unchanged book costs no
  request. Two books of the shelf that match one Hardcover book are counted as *shared*, and the
  second is left out.
- **Limits.** At most 50 requests a minute, and `--budget` (default 2,000) a run. When the
  budget runs out the run stops, and the next one carries on. `--dry-run` asks Hardcover but
  writes nothing, and says what would change.

It runs every night (04:00 UTC) once installed by:

```bash
sudo bash /home/django/folio-yusupov/server/setup-hardcover-sync.sh mvuijlst
```

A night with nothing to send logs nothing; a book that fails keeps its error, is tried again the
next night, and makes the run exit non-zero. See what it did with `journalctl -u folio-hardcover.service`.

## A list that became a mark

`manage.py list_to_have --user NAME --list ID --have go|gone [--write]` gives the paper copies on
a list *can go* or *gone* (gone also takes them off their places, as the app does), takes every
copy off the list, and deletes the list. Copies that aren't paper only come off it, and are
named. Without `--write` it only says what it would do. Changed books keep their `modified` and
get a new `changed`, so every device fetches them. Made for *Mag weg* (`--list library --have
go`, 2026-11-20); make a database copy first, as for any bulk change.

## Filling in what a shelf lacks

`manage.py fill_from_national --user NAME` fills an edition's empty publisher, year, page count
and language from its national catalogue (`shelf/national.py`, as `national.js` in the app): the
KB for 978-90 and 978-94, the BnF for 978-2 and 979-10. What is said already is never changed.
The KB is asked 50 ISBNs at a time, the BnF one at a time, `--pause` seconds apart (1 by
default). Books on the booklog are left out unless `--booklog` (filling them publishes their pages
again). Without `--write` it only says what it would fill. The year is that of the printing the
catalogue has, which may be later than the copy's. Make a database copy first. The server's own
lookup of an ISBN (for the assistant's proposals) asks the national catalogue the same way.

`manage.py fill_pages --user NAME` fills the page count of paper and e-book editions that have an
ISBN and none (`shelf/pages.py`): Hardcover's count for the ISBN, 25 ISBNs a request, which needs
`HARDCOVER_API_TOKEN` (a personal token from Hardcover's account settings, in `server/.env`); for
the rest the median page count of the Open Library work, which is the work's and not the
edition's own (`--no-median` leaves those empty). A page count already said is never changed;
`--pause`, `--booklog` and `--write` as above. With the token set, the app asks Hardcover through
the server (`POST /api/pages`) after a scan the catalogues gave no pages for, then the Open Library
median itself; the server's own lookup of an ISBN does the same.

`manage.py fill_original --user NAME` gives books the language they were first written in and
their original title (`originalLanguage`, `originalTitle`), from Wikidata (through each book's
Open Library work) and Open Library's record of an ISBN; `--assistant` also asks the assistant,
forty books a question, about every book (what a catalogue says goes first; where the two
differ, the report says so). Without `--write` it only says what it found, and `--report FILE`
lists every book with what each source said and why it may need a look; that file, corrected,
is what `--apply FILE` stores. Nothing is published: the booklog doesn't have these
fields. Wikidata's query service may be rate-limited; the command then waits as long as it is
told to and tries again.

## Corrections from a file

For changes worked out elsewhere (a list of books and what each should get), a few commands
apply a JSON file to the books that are only on the shelf; booklog books are left alone, since
the booklog says their facts. Each takes `--user NAME` and only says what it would do without
`--write`. A changed book keeps its `modified` and gets a new `changed`, so every device
fetches it. Make a database copy first. The file's shape is at the top of each command.

- `manage.py set_categories FILE`: `{book id: {"from": [...], "to": [...]}}`, the categories a
  book has and those it gets (made for D-055); a book whose categories are no longer the
  `from` ones is left alone and reported.
- `manage.py add_tags FILE`: `{book id: [tags]}`, added to what a book has; nothing is taken
  away (made for the tag *young-adult* of D-057).
- `manage.py apply_fixes FILE`: `"change"`, fields of books and editions as `[old, new]`, made
  only where the field still holds the old value (else reported), and `"combine"`, pairs of duplicate books to
  make one.

`manage.py fill_languages --user NAME [--dry-run]` gives editions with an ISBN and no language
theirs: Open Library's record of the edition, else Google Books, else the ISBN's registration
group (978-90 is Dutch). `manage.py mark_cover_photos` and `manage.py try_covers` are in
[using.md](using.md).
