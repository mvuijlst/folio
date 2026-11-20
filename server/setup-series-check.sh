#!/usr/bin/env bash
# Installs the monthly check of series on Hardcover (docs/server.md, "Series from Hardcover"): on
# the 1st of every month, manage.py check_series asks Hardcover again about the series marked still
# running in the app and keeps their new volumes. Run as root on the server, after a deploy that
# has shelf/management/commands/check_series.py, with the account whose series are checked:
#
#   sudo bash /home/django/folio-yusupov/server/setup-series-check.sh mvuijlst
#
# It needs HARDCOVER_API_TOKEN in server/.env. Running it again changes nothing that is there.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
ACCOUNT="${1:?Say whose series: setup-series-check.sh USERNAME}"
APP_DIR="${FOLIO_DIR:-$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)}"
[ -f "$APP_DIR/server/manage.py" ] || { echo "No Folio server in $APP_DIR (set FOLIO_DIR)." >&2; exit 1; }
OWNER=$(stat -c %U "$APP_DIR/server")

cat > /etc/systemd/system/folio-series-check.service <<UNIT
[Unit]
Description=Folio: ask Hardcover about the series still running

[Service]
Type=oneshot
User=$OWNER
WorkingDirectory=$APP_DIR/server
EnvironmentFile=$APP_DIR/server/.env
ExecStart=$APP_DIR/server/venv/bin/python manage.py check_series --user $ACCOUNT --write
Nice=10
UNIT

cat > /etc/systemd/system/folio-series-check.timer <<'UNIT'
[Unit]
Description=Folio: the series still running, once a month

[Timer]
OnCalendar=*-*-01 04:30:00 UTC
RandomizedDelaySec=30min
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now folio-series-check.timer
systemctl list-timers folio-series-check.timer --no-pager
