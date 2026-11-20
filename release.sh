#!/bin/bash
# release.sh VERSION "что изменилось; через точку с запятой": версия в VERSION и в index.html, запись в CHANGELOG.md,
# коммит, метка vVERSION, отправка ветки и метки (архив метки: GitHub → Code → Tags → zip)
set -e
cd "$(dirname "$0")"
v="$1"; notes="$2"
[[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "usage: release.sh X.Y.Z \"notes; notes\""; exit 1; }
[ -n "$notes" ] || { echo "notes needed"; exit 1; }
git rev-parse "v$v" >/dev/null 2>&1 && { echo "v$v exists"; exit 1; }
echo "$v" > VERSION
sed -i -E "s#(id=\"appVersion\"[^>]*>· v)[0-9.]+#\1$v#" index.html
entry="## $v — $(date +%F)"$'\n'"$(echo "$notes" | tr ';' '\n' | sed 's/^ *//' | grep -v '^$' | sed 's/^/- /')"$'\n'
python3 - "$entry" <<'PY'
import sys
p='CHANGELOG.md'; s=open(p).read(); i=s.index('\n## ')+1
open(p,'w').write(s[:i]+sys.argv[1]+'\n'+s[i:])
PY
git add -A
git commit -q -m "Release v$v" -m "$notes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Sj9imF8dWVkkU46qGotX9a"
git tag -a "v$v" -m "X4 Builder Web $v"
git push origin main
git push origin "v$v"
echo "released v$v"
