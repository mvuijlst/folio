#!/usr/bin/env bash
# Installs the nightly Folio → Hardcover sync (docs/server.md, "Hardcover sync"): every night
# manage.py sync_hardcover sends the books with a reading status to the account's Hardcover library
# (only what changed since the last night). Run as root on the server, after a deploy that
# has shelf/management/commands/sync_hardcover.py, with the account whose shelf is sent:
#
#   sudo bash /home/django/folio-yusupov/server/setup-hardcover-sync.sh mvuijlst
#
# It needs HARDCOVER_API_TOKEN in server/.env. Running it again changes nothing that is there.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
ACCOUNT="${1:?Say whose shelf: setup-hardcover-sync.sh USERNAME}"
APP_DIR="${FOLIO_DIR:-$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)}"
[ -f "$APP_DIR/server/manage.py" ] || { echo "No Folio server in $APP_DIR (set FOLIO_DIR)." >&2; exit 1; }
OWNER=$(stat -c %U "$APP_DIR/server")

cat > /etc/systemd/system/folio-hardcover.service <<UNIT
[Unit]
Description=Folio: send the shelf to Hardcover

[Service]
Type=oneshot
User=$OWNER
WorkingDirectory=$APP_DIR/server
EnvironmentFile=$APP_DIR/server/.env
ExecStart=$APP_DIR/server/venv/bin/python manage.py sync_hardcover --user $ACCOUNT
Nice=10
UNIT

cat > /etc/systemd/system/folio-hardcover.timer <<'UNIT'
[Unit]
Description=Folio: the shelf to Hardcover, every night

[Timer]
OnCalendar=*-*-* 04:00:00 UTC
RandomizedDelaySec=30min
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now folio-hardcover.timer
systemctl list-timers folio-hardcover.timer --no-pager
