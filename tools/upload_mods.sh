#!/bin/sh
# Upload mods-local/<id>/... to sdmc:/switch/fh-nx/mods/<id>/... over sphaira's FTP (port 5000, paths under /sdmc:).
#   tools/upload_mods.sh [id ...]   (default: every folder in mods-local)   SWITCH_IP overrides the address
IP=${SWITCH_IP:-172.31.99.188}; ROOT=$(cd "$(dirname "$0")/.." && pwd)
IDS=${*:-$(ls "$ROOT/mods-local")}
for id in $IDS; do
  echo "== $id"
  (cd "$ROOT/mods-local/$id" && find . -type f | sed 's#^\./##') | while IFS= read -r f; do
    enc=$(printf '%s' "$f" | sed 's/ /%20/g')
    curl -s --max-time 120 --ftp-create-dirs -T "$ROOT/mods-local/$id/$f" "ftp://$IP:5000/sdmc:/switch/fh-nx/mods/$id/$enc" || echo "FAILED $f"
  done
done
