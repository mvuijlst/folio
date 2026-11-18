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
`/api/logout`, `/api/sync`, `/api/booklog-names`, and for the assistant `/api/suggest`, `/api/translate`, `/api/tag-merges` and `/api/original`) plus the Django admin at `/admin/`, where accounts are made. There
is no public sign-up.

```bash
cd server
python -m venv venv && venv/bin/pip install -r requirements.txt
export DJANGO_DEBUG=1
venv/bin/python manage.py migrate && venv/bin/python manage.py createcachetable
venv/bin/python manage.py createsuperuser
venv/bin/python manage.py runserver   # serves the app too, at http://localhost:8000
venv/bin/python manage.py test
node --test "../tests/*.test.mjs"     # the app's own book logic (works.js)
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
for public libraries too, and for the booklog. Covers from before it kept large ones get theirs
a few per sync; `sudo bash server/fetch-large-covers.sh` (no arguments) does them all at once.

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
installs its requirements, migrates and restarts it. Otherwise replace the files on the server by
hand; nothing else is needed for the app. An installed copy compares its cached
files with the server each time it is opened (and when it returns to the foreground), and
restarts itself into the new version within a few seconds. If you are in the middle of
something it shows *A new version is ready · Reload* instead. The running version is shown at
the bottom of the settings sheet; bump `APP_VERSION` in `app.js` when you release.

Do not uninstall the app to update it: Android offers to clear the site's data along with it,
and that deletes the shelf.

A sync says which shape of book the app speaks (`"schema": 2`, books with editions since
2.0). The server refuses a sync without it (409, *This version of Folio is out of date…*),
so a copy of the app from before can never write books in the old shape over new ones; it
shows that under Settings and updates itself the next time it is opened. The one-time
conversion of a shelf is `manage.py to_works` (see [booklog.md](booklog.md#books-with-editions-and-what-a-version-was)).

## Filling in what a shelf lacks

`manage.py fill_original --user NAME` gives books the language they were first written in and
their original title (`originalLanguage`, `originalTitle`), from Wikidata (through each book's
Open Library work) and Open Library's record of an ISBN; `--assistant` also asks the assistant,
forty books a question, about every book (what a catalogue says goes first; where the two
differ, the report says so). Without `--write` it only says what it found, and `--report FILE`
lists every book with what each source said and why it may need a look; that file, corrected,
is what `--apply FILE` stores. Nothing is published: the booklog doesn't have these
fields. Wikidata's query service may be rate-limited; the command then waits as long as it is
told to and tries again.
