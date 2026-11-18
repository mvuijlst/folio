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

site=$(grep -RlE "server_name[^;]*\b${HOST//./\\.}\b" /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null | head -n1 || true)
[ -n "$site" ] || { echo "No nginx site with server_name $HOST found." >&2; exit 1; }
site=$(readlink -f "$site")
echo "Site: $site"

stamp=$(date +%Y%m%d-%H%M%S)
# Backups outside nginx's folders: a copy beside a site in sites-enabled would be loaded too.
backups=/var/backups/folio-nginx
mkdir -p "$backups"
backup="$backups/$(basename "$site").$stamp"
cp -a "$site" "$backup"
zone=/etc/nginx/conf.d/folio-public.conf
zone_new=0
if [ ! -e "$zone" ]; then
  printf '%s\n' '# Folio: public libraries are open to anyone; their data is limited per address.' \
    'limit_req_zone $binary_remote_addr zone=folio_public:10m rate=30r/m;' > "$zone"
  zone_new=1
fi

if ! python3 - "$site" "$HOST" <<'PY'
import re, sys
path, host = sys.argv[1], sys.argv[2]
text = open(path).read()

def blocks(s, start_pat):
    """(start, end, header) of each block whose header matches start_pat, braces balanced."""
    for m in re.finditer(start_pat, s):
        depth, i = 0, s.index('{', m.start())
        while True:
            if s[i] == '{': depth += 1
            elif s[i] == '}':
                depth -= 1
                if depth == 0: yield m.start(), i + 1, s[m.start():s.index('{', m.start())]; break
            i += 1

LOCATION = r'(?m)^[ \t]*location\b[^{;]*\{'
has = lambda server, path: re.search(r'location\s+(?:\^~\s+|=\s+)?' + re.escape(path) + r'\s*\{', server)

out, last, changed, found = [], 0, False, False
for s_start, s_end, _ in blocks(text, r'(?m)^\s*server\s*\{'):
    server = text[s_start:s_end]
    if not re.search(r'server_name[^;]*\b' + re.escape(host) + r'\b', server):
        continue
    # The block that passes requests on to the Folio server, however it is written
    # (location /api/, /api, ^~ /api/, a pattern for /api and /admin…): copied, so the new
    # ones proxy exactly as it does. One that says api first; else any that proxies.
    proxies = [b for b in blocks(server, LOCATION) if 'proxy_pass' in server[b[0]:b[1]]]
    template = next((b for b in proxies if 'api' in b[2]), proxies[0] if proxies else None)
    if not template:
        continue
    found = True
    t_start, t_end, _ = template
    block = server[t_start:t_end]
    indent = re.match(r'[ \t]*', block).group(0)
    body = block[block.index('{') + 1:block.rindex('}')]
    # proxy_pass with a path of its own (…:8030/api/) would rewrite ours: the address only.
    body = re.sub(r'(proxy_pass\s+https?://[^/;\s]+)/[^;\s]*\s*;', r'\1;', body)
    add = []
    # ^~: checked before any pattern location, so none can take these addresses.
    if not has(server, '/u/'):
        add.append(f'{indent}location ^~ /u/ {{{body}}}')
    if not has(server, '/api/public/'):
        add.append(f'{indent}location ^~ /api/public/ {{\n{indent}    limit_req zone=folio_public burst=20 nodelay;{body}}}')
    if not add:
        continue
    new_server = server[:t_start] + '\n\n'.join(add) + '\n\n' + server[t_start:]
    out.append(text[last:s_start]); out.append(new_server); last = s_end; changed = True

if changed:
    out.append(text[last:])
    open(path, 'w').write(''.join(out))
    print('Added location ^~ /u/ and/or ^~ /api/public/.')
elif found:
    print('Nothing to add: /u/ and /api/public/ are there already.')
else:
    print('Found no location that passes requests on (proxy_pass) beside server_name ' + host + '. Nothing changed.')
    sys.exit(3)
PY
then
  [ "$zone_new" -eq 1 ] && rm -f "$zone"
  echo "The site is as it was. Its locations, for a look:" >&2
  grep -nE "server_name|location|proxy_pass|include" "$site" >&2
  exit 1
fi

if nginx -t; then
  systemctl reload nginx
  echo "nginx reloaded. Backup of the site: $backup"
else
  echo "nginx -t failed: putting everything back." >&2
  cp -a "$backup" "$site"
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
User = get_user_model()
user = User.objects.filter(username="$ACCOUNT").first()
if user is None:
    raise SystemExit("No account called $ACCOUNT. The accounts are: " + ", ".join(User.objects.order_by("username").values_list("username", flat=True)))
lib, made = Library.objects.get_or_create(user=user)
lib.allowed = True
lib.save()
print(f"{'Made' if made else 'Updated'} the library of {user}: allowed, at /u/{lib.slug}, {'shared' if lib.enabled else 'not shared yet (Settings → Public library)'}.")
PY
fi

echo "Check: curl -sI https://$HOST/u/does-not-exist   → 404 with X-Robots-Tag: noindex"
