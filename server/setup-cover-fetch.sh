#!/usr/bin/env bash
# Installs the hourly fetch of covers (docs/server.md, "Covers"): every hour, manage.py fetch_covers
# gives every edition whose cover still lives elsewhere (a catalogue, a bookshop, the web) a copy
# on this server, small and large, for every account. Syncing does the same a few covers at a
# time; this makes sure none is left out for long, also when nobody syncs. Run as root on the
# server, after a deploy that has it, no arguments needed:
#
#   sudo bash /home/django/folio-yusupov/server/setup-cover-fetch.sh
#
# Running it again changes nothing that is there. A cover that can't be fetched is tried again
# after a week.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
APP_DIR="${FOLIO_DIR:-$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)}"
[ -f "$APP_DIR/server/manage.py" ] || { echo "No Folio server in $APP_DIR (set FOLIO_DIR)." >&2; exit 1; }
OWNER=$(stat -c %U "$APP_DIR/server")

cat > /etc/systemd/system/folio-covers.service <<UNIT
[Unit]
Description=Folio: keep a copy of every cover on this server
After=folio-yusupov.service

[Service]
Type=oneshot
User=$OWNER
WorkingDirectory=$APP_DIR/server
EnvironmentFile=$APP_DIR/server/.env
ExecStart=$APP_DIR/server/venv/bin/python manage.py fetch_covers
Nice=10
IOSchedulingClass=idle
UNIT

cat > /etc/systemd/system/folio-covers.timer <<'UNIT'
[Unit]
Description=Folio: covers kept on this server, every hour

[Timer]
OnCalendar=hourly
RandomizedDelaySec=10min
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now folio-covers.timer
echo "Fetching the covers there are now…"
systemctl start folio-covers.service
journalctl -u folio-covers.service -n 5 --no-pager -o cat
systemctl list-timers folio-covers.timer --no-pager
