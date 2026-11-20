#!/usr/bin/env bash
# Installs the server's nightly copy of Folio (docs/server.md, "Nightly copies"). Run as root
# on the server, after a deploy that has server/folio-backup.sh:
#
#   sudo bash /home/django/folio-yusupov/server/setup-nightly-backup.sh
#
# What it does:
#   1. copies folio-backup.sh to /usr/local/sbin/folio-backup, owned by root (the copy in the
#      web root can be written by the deploy user, so root never runs that one);
#   2. writes folio-backup.service (the copy, run with low CPU and disk priority) and
#      folio-backup.timer (every night at 03:30 UTC, and at the next boot if a night was missed);
#   3. enables the timer and makes the first copy now.
# Running it again after a deploy that changed folio-backup.sh installs the new version.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
APP_DIR="${FOLIO_DIR:-$(cd "$HERE/.." && pwd)}"
[ -f "$APP_DIR/server/manage.py" ] || { echo "No Folio server in $APP_DIR (set FOLIO_DIR)." >&2; exit 1; }
for tool in sqlite3 zstd rsync; do command -v "$tool" >/dev/null || { echo "$tool is not installed (apt install $tool)." >&2; exit 1; }; done

install -o root -g root -m 755 "$HERE/folio-backup.sh" /usr/local/sbin/folio-backup

cat > /etc/systemd/system/folio-backup.service <<UNIT
[Unit]
Description=Folio: nightly copy of the database and of the photographed covers
After=folio-yusupov.service

[Service]
Type=oneshot
Environment=FOLIO_DIR=$APP_DIR
ExecStart=/usr/local/sbin/folio-backup
Nice=10
IOSchedulingClass=idle
UNIT

cat > /etc/systemd/system/folio-backup.timer <<'UNIT'
[Unit]
Description=Folio: a copy every night

[Timer]
OnCalendar=*-*-* 03:30:00 UTC
RandomizedDelaySec=10min
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now folio-backup.timer
echo "Making the first copy…"
systemctl start folio-backup.service
journalctl -u folio-backup.service -n 3 --no-pager -o cat
systemctl list-timers folio-backup.timer --no-pager
