#!/usr/bin/env bash
# Are the covers on this server? Run as root on the server, optionally with one account:
#
#   sudo bash /home/django/folio-yusupov/server/check-covers.sh [USERNAME]
#
# It first fetches one known cover (Dune, from Open Library) to see that this server can fetch
# covers at all. Then, for every account (or the one named), it says how many covers are kept
# here, small and large, and lists each cover still elsewhere with the reason it can't be had:
# each address is asked again and the error shown. It changes nothing: nothing is written, and a
# cover that failed is still left alone for a week by the hourly fetch (setup-cover-fetch.sh).
set -uo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
APP_DIR="${FOLIO_DIR:-$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)}"
[ -f "$APP_DIR/server/manage.py" ] || { echo "No Folio server in $APP_DIR (set FOLIO_DIR)." >&2; exit 1; }
cd "$APP_DIR/server"
OWNER=$(stat -c %U .)

sudo -u "$OWNER" FOLIO_ACCOUNT="${1:-}" bash -c 'set -a; [ -f .env ] && . ./.env; set +a; exec venv/bin/python manage.py shell' <<'PY'
import os

from django.contrib.auth import get_user_model

from shelf import covers
from shelf.models import Book

TEST = 'https://covers.openlibrary.org/b/isbn/9780441172719-L.jpg?default=false'
try:
    print(f'Fetching a cover works: {len(covers.download(TEST))} bytes from Open Library.')
except Exception as err:
    print(f'FETCHING A COVER FAILS: {type(err).__name__}: {err}')
    print('  No cover can be kept here until this works (the network, DNS, or the code).')

users = get_user_model().objects.order_by('username')
if os.environ.get('FOLIO_ACCOUNT'):
    users = users.filter(username=os.environ['FOLIO_ACCOUNT'])
    if not users:
        print(f'No account {os.environ["FOLIO_ACCOUNT"]!r}.')

for user in users:
    places = [(b, p) for b in Book.shelf(user) for p in covers.places(b.data)]
    here = [p for _, p in places if str(p.get('cover') or '').startswith('covers/')]
    large = [p for p in here if p.get('coverFull')]
    inside = [p for _, p in places if not p.get('cover') and str(p.get('thumb') or '').startswith('data:image/')]
    elsewhere = [(b, p) for b, p in places if str(p.get('cover') or '').startswith('http')]
    print(f'\n{user.get_username()}: {len(here)} covers kept here ({len(large)} also large), '
          f'{len(inside)} only inside the book (a picture taken offline), {len(elsewhere)} still elsewhere.')
    for book, place in elsewhere:
        url = place['cover']
        print(f'  {book.data.get("title")!r}: {url}')
        if not covers.wanted(url):
            print('    not fetched: not an https address on the public web')
            continue
        for address in covers.candidates(url):
            try:
                print(f'    {address}: fetches now ({len(covers.download(address))} bytes); the hourly fetch takes it within a week')
                break
            except Exception as err:
                print(f'    {address}: {type(err).__name__}: {err}')
PY
