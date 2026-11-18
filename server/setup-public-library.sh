#!/usr/bin/env bash
# Sets up nginx for public libraries (docs/public-library-plan.md) and, optionally, lets an
# account share its library. Run as root on the server, after a deploy of 2.16.0 or later:
#
#   sudo bash setup-public-library.sh                 # nginx only
#   sudo bash setup-public-library.sh michel          # nginx, and allow the account "michel"
#
# What it does:
#   1. /etc/nginx/conf.d/folio-public.conf: a request limit for /api/public/ (30 a minute per
#      address, bursts of 20), in nginx's http block.
#   2. In the site that serves folio.yusupov.cloud, next to `location /api/`, two copies of that
#      block: `location /u/` (a public library's page) and `location /api/public/` (its data,
#      with the limit). They proxy exactly as /api/ does, whatever that says.
#   3. nginx -t, then a reload; if the test fails, everything is put back as it was.
#   4. With a username: a Library for that account, allowed (the owner turns it on in the app).
# Running it again changes nothing that is already there.
set -euo pipefail

HOST="${FOLIO_HOST:-folio.yusupov.cloud}"
# The app is the folder this script is in, one up (…/server/setup-public-library.sh); FOLIO_DIR overrides.
APP_DIR="${FOLIO_DIR:-$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)}"
[ -f "$APP_DIR/server/manage.py" ] || { echo "No Folio server in $APP_DIR (set FOLIO_DIR)." >&2; exit 1; }
ACCOUNT="${1:-}"

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }

site=$(grep -rlE "server_name[^;]*\b${HOST//./\\.}\b" /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null | head -n1 || true)
[ -n "$site" ] || { echo "No nginx site with server_name $HOST found." >&2; exit 1; }
site=$(readlink -f "$site")
echo "Site: $site"

stamp=$(date +%Y%m%d-%H%M%S)
cp -a "$site" "$site.bak-$stamp"
zone=/etc/nginx/conf.d/folio-public.conf
zone_new=0
if [ ! -e "$zone" ]; then
  printf '%s\n' '# Folio: public libraries are open to anyone; their data is limited per address.' \
    'limit_req_zone $binary_remote_addr zone=folio_public:10m rate=30r/m;' > "$zone"
  zone_new=1
fi

python3 - "$site" "$HOST" <<'PY'
import re, sys
path, host = sys.argv[1], sys.argv[2]
text = open(path).read()

def blocks(s, start_pat):
    """(start, end) of each block whose header matches start_pat, braces balanced."""
    for m in re.finditer(start_pat, s):
        depth, i = 0, s.index('{', m.start())
        while True:
            if s[i] == '{': depth += 1
            elif s[i] == '}':
                depth -= 1
                if depth == 0: yield m.start(), i + 1; break
            i += 1

out, last, changed = [], 0, False
for s_start, s_end in blocks(text, r'(?m)^\s*server\s*\{'):
    server = text[s_start:s_end]
    if not re.search(r'server_name[^;]*\b' + re.escape(host) + r'\b', server):
        continue
    api = next(blocks(server, r'(?m)^[ \t]*location\s+/api/\s*\{'), None)
    if not api:
        continue
    head = server[:api[0]]
    block = server[api[0]:api[1]]
    indent = re.match(r'[ \t]*', block).group(0)
    add = []
    if not re.search(r'location\s+/u/\s*\{', server):
        add.append(block.replace('location /api/', 'location /u/', 1))
    if not re.search(r'location\s+/api/public/\s*\{', server):
        public = block.replace('location /api/', 'location /api/public/', 1)
        public = public.replace('{', '{\n' + indent + '    limit_req zone=folio_public burst=20 nodelay;', 1)
        add.append(public)
    if not add:
        continue
    new_server = head + '\n\n'.join(a.strip('\n') for a in add) + '\n\n' + server[api[0]:]
    if not head.endswith('\n'):
        new_server = head + '\n' + new_server[len(head):]
    out.append(text[last:s_start]); out.append(new_server); last = s_end; changed = True

if changed:
    out.append(text[last:])
    open(path, 'w').write(''.join(out))
    print('Added location /u/ and/or /api/public/.')
else:
    print('Nothing to add to the site (already there, or no `location /api/` beside the server_name).')
PY

if nginx -t; then
  systemctl reload nginx
  echo "nginx reloaded. Backup of the site: $site.bak-$stamp"
else
  echo "nginx -t failed: putting everything back." >&2
  cp -a "$site.bak-$stamp" "$site"
  [ "$zone_new" -eq 1 ] && rm -f "$zone"
  nginx -t && systemctl reload nginx
  exit 1
fi

if [ -n "$ACCOUNT" ]; then
  owner=$(stat -c %U "$APP_DIR/server")
  cd "$APP_DIR/server"
  sudo -u "$owner" bash -c 'set -a; [ -f .env ] && . ./.env; set +a; exec venv/bin/python manage.py shell' <<PY
from django.contrib.auth import get_user_model
from shelf.models import Library
user = get_user_model().objects.get(username="$ACCOUNT")
lib, made = Library.objects.get_or_create(user=user)
lib.allowed = True
lib.save()
print(f"{'Made' if made else 'Updated'} the library of {user}: allowed, at /u/{lib.slug}, {'shared' if lib.enabled else 'not shared yet (Settings → Public library)'}.")
PY
fi

echo "Check: curl -sI https://$HOST/u/does-not-exist   → 404 with X-Robots-Tag: noindex"
