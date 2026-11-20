#!/usr/bin/env bash
# The server's nightly copy of Folio (docs/server.md, "Nightly copies"). Installed by
# setup-nightly-backup.sh as /usr/local/sbin/folio-backup and run as root by folio-backup.timer;
# it is not run from the web root, which the deploy user can write.
#
# Each run:
#   1. if anything worth keeping changed since the last copy (books, lists, words, libraries,
#      accounts; a fingerprint of their content, not of sessions or login times), copies the
#      database while the server keeps running (`VACUUM INTO`: one consistent, compact copy),
#      checks it (`PRAGMA integrity_check`), and compresses it (zstd) into
#      $DEST/db/folio-<UTC stamp>.sqlite3.zst; the newest $KEEP are kept, older ones removed.
#      Nothing changed: no new copy (FOLIO_BACKUP_FORCE=1 makes one anyway);
#   2. copies the covers that can't be fetched again (covers/own: photographed covers, and the
#      photos straightened covers were made from) into $DEST/covers/own. Only added to: a cover
#      deleted in Folio stays here. Catalogue and booklog covers are fetched again when needed;
#   3. writes $DEST/last-copy.json ({"made", "checked", "file", "bytes"}: the newest copy, and
#      when this run found it still holds everything), which the server reads to say under
#      Settings → About when the last copy was made, and the PC's pull script to find it.
# A failed run leaves the previous copies as they are, and systemd marks the service failed
# (journalctl -u folio-backup.service).
set -euo pipefail

APP_DIR="${FOLIO_DIR:-/home/django/folio-yusupov}"
DEST="${FOLIO_BACKUP_DIR:-/var/backups/folio}"
KEEP="${FOLIO_BACKUP_KEEP:-14}"
DB="$APP_DIR/server/db.sqlite3"

[ -f "$DB" ] || { echo "No database at $DB (set FOLIO_DIR)." >&2; exit 1; }
umask 077
mkdir -p "$DEST/db" "$DEST/covers"
chmod 755 "$DEST"   # last-copy.json is read by the server's own user; db/ and covers/ stay root's

stamp=$(date -u +%Y%m%d-%H%M%S)
name="folio-$stamp.sqlite3.zst"
tmp="$DEST/db/.folio-$stamp.sqlite3"
trap 'rm -f "$tmp" "$DEST/db/.$name"' EXIT
now=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# 1. The database, when what it holds changed. The fingerprint leaves out what changes by
#    itself (sessions, login times, the server's own `changed` stamps).
fingerprint=$(sqlite3 -readonly -cmd '.timeout 60000' "$DB" "
  SELECT uid, modified, deleted, data FROM shelf_book ORDER BY user_id, uid;
  SELECT uid, modified, deleted, data FROM shelf_list ORDER BY user_id, uid;
  SELECT uid, modified, deleted, data FROM shelf_term ORDER BY user_id, uid;
  SELECT user_id, allowed, enabled, slug, title_en, title_nl, about_en, about_nl FROM shelf_library ORDER BY user_id;
  SELECT id, username, password, email, first_name, last_name, is_active, is_staff, is_superuser FROM auth_user ORDER BY id;
" | sha256sum | cut -d' ' -f1)
last=$(ls -1t "$DEST"/db/folio-*.sqlite3.zst 2>/dev/null | head -n1 || true)
if [ -n "$last" ] && [ "${FOLIO_BACKUP_FORCE:-0}" != 1 ] && [ "$(cat "$DEST/db/.fingerprint" 2>/dev/null)" = "$fingerprint" ]; then
  name=$(basename "$last")
  made=$(sed -n 's/.*"made": "\([^"]*\)".*/\1/p' "$DEST/last-copy.json" 2>/dev/null)
  made=${made:-$now}
  echo "Nothing changed since $made: no new copy."
else
  sqlite3 -cmd '.timeout 60000' "$DB" "VACUUM INTO '$tmp'"
  check=$(sqlite3 "$tmp" 'PRAGMA integrity_check')
  [ "$check" = ok ] || { echo "The copy failed its integrity check: $check" >&2; exit 1; }
  zstd -q -T0 -10 "$tmp" -o "$DEST/db/.$name"
  mv "$DEST/db/.$name" "$DEST/db/$name"
  rm -f "$tmp"
  printf '%s\n' "$fingerprint" > "$DEST/db/.fingerprint"
  ls -1t "$DEST"/db/folio-*.sqlite3.zst | tail -n +"$((KEEP + 1))" | xargs -r rm --
  made=$now
  echo "Copied the database to $DEST/db/$name."
fi

# 2. The covers that exist nowhere else.
if [ -d "$APP_DIR/covers/own" ]; then
  rsync -a "$APP_DIR/covers/own/" "$DEST/covers/own/"
fi

# 3. When, for the server and the PC.
bytes=$(stat -c %s "$DEST/db/$name")
printf '{"made": "%s", "checked": "%s", "file": "%s", "bytes": %s}\n' "$made" "$now" "$name" "$bytes" > "$DEST/.last-copy.json"
chmod 644 "$DEST/.last-copy.json"
mv "$DEST/.last-copy.json" "$DEST/last-copy.json"
echo "Newest copy: $name ($bytes bytes); covers/own copied."
