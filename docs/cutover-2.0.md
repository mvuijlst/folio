# Cut-over to 2.0 (books and their editions)

The steps of section 8 of [work-edition-plan.md](work-edition-plan.md), as commands, with what
the rehearsal on a copy of production's database (2026-11-16) says each should print. Michel
starts it; nothing here runs by itself. Take it in order and stop at any output that differs
from the expected one without a reason you can name.

On the server, as root (`ssh -p 2708 yusupov`). Management commands run as `django` with the
app's settings, as the timer's service does. Define this once in that shell:

```bash
folio() { sudo -u django bash -c 'cd /home/django/folio-yusupov/server && set -a && . ./.env && set +a && exec venv/bin/python manage.py "$@"' folio "$@"; }
```

## Before

**1. Every device synced.** Open Folio on each device and let it sync: Settings → Account says
*Synced …* with nothing waiting. An edit still waiting on a device is kept, except on the one
book the conversion merges away (the *Fire & Blood* audiobook, see step 6).

**2. Stop publishing.**

```bash
systemctl stop folio-boeken.timer
systemctl is-active folio-boeken.service    # wait until it says "inactive" (a run in progress finishes first)
```

**3. Nothing may be waiting to be published.**

```bash
folio sync_boeken --user mvuijlst --dry-run
```

Expected: `Would be: 0 published, 0 settled, 0 failed, 0 waiting`. If something is waiting:
`systemctl start folio-boeken.timer`, let it publish, and begin again at step 2.

**4. A copy of the database**, beside the earlier ones:

```bash
sudo -u django sqlite3 /home/django/folio-yusupov/server/db.sqlite3 \
  ".backup /home/django/folio-yusupov/server/db.sqlite3.before-works-$(date +%Y%m%d-%H%M%S)"
ls -la /home/django/folio-yusupov/server/db.sqlite3*
```

## Then

**5. Deploy 2.0.** On the desktop, in the bookscan checkout (the branch already contains
`main`, so this is a fast-forward):

```bash
git checkout main
git merge --ff-only works-and-editions
git push origin main
gh run watch
```

The deploy copies the app and restarts the sync server. From here old copies of the app are
told to update, and the booklog commands refuse to run until step 6 is done. Check:

```bash
curl -s https://folio.yusupov.cloud/app.js | grep -m1 APP_VERSION     # '2.0.0'
curl -s -o /dev/null -w '%{http_code}\n' https://folio.yusupov.cloud/works.js   # 200
```

**6. Convert the shelf.** First as a dry run, and read it:

```bash
folio to_works --dry-run
```

Expected (the rehearsal; a book or two more if you added some since):

```
mvuijlst (dry run, nothing written):
  2102 books, 2102 upgraded, 2120 editions, 17 books with more than one edition
  1 merged, 0 left waiting to be published, 17 possibly the same book
  2102 records written
  merged, another version: "Fire & Blood" (5a18f391-…) into "Fire & Blood" (boeken-fire-blood)
  possibly the same book: … (17 lines: mostly paper copies you scanned of books in the booklog)
  not merged, both in the booklog (ISBN 9781250621191): "The Blacktongue Thief" …
```

Then for real, and once more to see that it changes nothing:

```bash
folio to_works
folio to_works    # expected: 0 upgraded, 0 merged, 0 records written
```

**7. Import, and nothing to publish.**

```bash
folio import_boeken /home/django/folio-boeken --user mvuijlst
folio sync_boeken --user mvuijlst --dry-run
```

Expected from the import: `0 added`, `0 waiting to be published`, `0 reviews kept as edited in
the app`, and *1 to 2 updated*: *Fire & Blood* (with its audiobook merged in, it now follows
its latest read: read 2026-04-06, its link the audiobook's post, its writers that post's), and
possibly *Grim Leaper* (a cover thumbnail). Anything else updated: stop and look before going
on. Expected from the dry run: `Would be: 0 published, 0 settled, 0 failed, 0 waiting`.

**8. Publish again**, and watch two runs:

```bash
systemctl start folio-boeken.timer
journalctl -u folio-boeken.service -f        # two runs, then Ctrl+C
sudo -u django git -C /home/django/folio-boeken log -3 --oneline   # no new commit from Folio
```

**9. On each device:** open the app; it updates itself (Settings → About says version 2.0.0;
if it still says 1.29, close it and open it again). Open a one-edition book, *Fire & Blood*
(two editions: the e-book and the audiobook), and *Filter → Other → Possibly the same book*,
which lists the books to combine or leave.

## Going back, if it must be

```bash
systemctl stop folio-boeken.timer folio-yusupov
cd /home/django/folio-yusupov/server
rm -f db.sqlite3-wal db.sqlite3-shm
cp db.sqlite3.before-works-<stamp> db.sqlite3 && chown django:django db.sqlite3
systemctl start folio-yusupov
```

Then deploy what `main` was before the merge (`ce5a740`): on the desktop, `git revert --no-edit
ce5a740..main` and push, so the deploy copies 1.29's files back. Start the timer, and on each
device *Sign out & clear* and sign in again: a device has converted its own copy of the shelf
and 1.29 cannot read it. Edits made in between are lost.

## Leftovers

The deploy never deletes files. `server/shelf/management/commands/set_paper.py` (removed in
2.0, its job done) stays on the server; it is harmless. Remove it when convenient:
`rm /home/django/folio-yusupov/server/shelf/management/commands/set_paper.py`.
