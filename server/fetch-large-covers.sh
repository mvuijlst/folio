#!/usr/bin/env bash
# Keeps a large copy on the server of every cover that has only a small one, for every account,
# in one go (syncing does it too, but a few at a time). Run as root, no arguments needed:
#
#   sudo bash /home/django/folio-yusupov/server/fetch-large-covers.sh
#
# Runs manage.py fetch_covers as the user that owns the server, with its settings. It can take
# a few minutes for a large shelf; running it again only does what is still missing.
set -euo pipefail
APP_DIR="${FOLIO_DIR:-$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)}"
[ -f "$APP_DIR/server/manage.py" ] || { echo "No Folio server in $APP_DIR (set FOLIO_DIR)." >&2; exit 1; }
cd "$APP_DIR/server"
owner=$(stat -c %U .)
sudo -u "$owner" bash -c 'set -a; [ -f .env ] && . ./.env; set +a; exec venv/bin/python manage.py fetch_covers'
