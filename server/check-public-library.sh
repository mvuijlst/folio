#!/usr/bin/env bash
# Why is a public library not showing? Run as root on the server, no arguments needed:
#
#   sudo bash /home/django/folio-yusupov/server/check-public-library.sh
#
# For every library in the database it says whether it is allowed (the admin) and turned on
# (the owner), which lists are public and how many books that makes, and then asks for its page
# and its data twice: through nginx (the real address) and from the Folio server directly. When
# the server says yes and nginx says no, it is nginx; when both say no, it is the library.
# It changes nothing.
set -uo pipefail

HOST="${FOLIO_HOST:-folio.yusupov.cloud}"
PORT="${FOLIO_PORT:-8030}"
APP_DIR="${FOLIO_DIR:-$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)}"
[ -f "$APP_DIR/server/manage.py" ] || { echo "No Folio server in $APP_DIR (set FOLIO_DIR)." >&2; exit 1; }
owner=$(stat -c %U "$APP_DIR/server")

echo "== Libraries in the database ($APP_DIR)"
out=$(cd "$APP_DIR/server" && sudo -u "$owner" bash -c 'set -a; [ -f .env ] && . ./.env; set +a; exec venv/bin/python manage.py shell' 2>&1 <<'PY'
from shelf.models import Library, List
from shelf import public
libraries = list(Library.objects.select_related('user'))
if not libraries:
    print('  none: run setup-public-library.sh with a username first')
for lib in libraries:
    lists = [r.name for r in List.objects.filter(user=lib.user, deleted=False) if (r.data or {}).get('public') is True]
    built = public.library(lib) if lib.allowed and lib.enabled else None
    books = len(built['books']) if built else 0
    problems = [p for p, bad in [
        ('not allowed (admin: tick allowed)', not lib.allowed),
        ('not turned on (app: Settings, Public library, Share my library)', not lib.enabled),
        ('no public list (app: Settings, Public library, tick the lists; then let it sync)', not lists),
        ('account inactive', not lib.user.is_active),
    ] if bad]
    print(f'  /u/{lib.slug}  account {lib.user.get_username()}  allowed {lib.allowed}  on {lib.enabled}  '
          f'public lists {lists or "none"}  books shown {books}')
    print('    ' + ('OK: should be live' if not problems else 'NOT LIVE: ' + '; '.join(problems)))
    print('SLUG ' + lib.slug)
PY
)
printf '%s\n' "$out" | grep -vE '^SLUG |objects imported automatically'
slugs=$(printf '%s\n' "$out" | awk '$1 == "SLUG" {print $2}')

echo
echo "== nginx"
if grep -RqE "location\s+/u/" /etc/nginx/ 2>/dev/null; then echo "  location /u/ is there"; else echo "  NO location /u/ in /etc/nginx: run setup-public-library.sh"; fi
if grep -RqE "location\s+/api/public/" /etc/nginx/ 2>/dev/null; then echo "  location /api/public/ is there"; else echo "  NO location /api/public/ in /etc/nginx: run setup-public-library.sh"; fi

ask() {   # what, url, extra curl args → "status, and whether Folio's server answered"
  local headers
  headers=$(curl -sk -o /dev/null -D - --max-time 10 "$@" 2>/dev/null)
  local status=$(printf '%s' "$headers" | awk 'NR==1 {print $2}')
  if printf '%s' "$headers" | grep -qi '^x-robots-tag: *noindex'; then echo "${status:-no answer} (from Folio)"; else echo "${status:-no answer}"; fi
}

for slug in $slugs nobody-at-all; do
  echo
  [ "$slug" = nobody-at-all ] && echo "== For comparison, a name nobody has (404 from Folio is right):" || echo "== /u/$slug"
  echo "  page, through nginx:         $(ask "https://$HOST/u/$slug")"
  echo "  page, Folio server direct:   $(ask "http://127.0.0.1:$PORT/u/$slug" -H "Host: $HOST" -H "X-Forwarded-Proto: https")"
  echo "  data, through nginx:         $(ask "https://$HOST/api/public/$slug")"
  echo "  data, Folio server direct:   $(ask "http://127.0.0.1:$PORT/api/public/$slug" -H "Host: $HOST" -H "X-Forwarded-Proto: https")"
done

echo
echo "200 everywhere: live. 404 (from Folio) on both: the library itself, see NOT LIVE above."
echo "200 direct but not through nginx: nginx; send this output along."
