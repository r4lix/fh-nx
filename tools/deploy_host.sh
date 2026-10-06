#!/bin/sh
# Upload the host NRO, its JS and the PIXI libs to the test Switch (FTP 5002), launch it through
# sphaira's netloader, and leave the log at sdmc:/switch/fh-nx/log.txt (readable over FTP only after
# the app exits: FAT locks it while open). The console must be on hbmenu with sphaira selected.
#   tools/deploy_host.sh <clean www dir>
set -e
IP=${SWITCH_IP:-172.31.99.188}
B="ftp://$IP:5002/switch/fh-nx"
WWW=${1:?clean www dir}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SWTOOLS=${SWTOOLS:-/c/Users/Admin/Documents/sh2-nx/port-sh2-nx/tools}

for f in env.js demo.js; do curl -s --ftp-create-dirs -T "$ROOT/host/js/$f" "$B/js/$f"; done
for f in pixi.js pixi-tilemap.js pixi-picture.js; do curl -s --ftp-create-dirs -T "$WWW/js/libs/$f" "$B/www/js/libs/$f"; done
curl -s -T "$ROOT/host/build/fh-nx.nro" "$B/fh-nx.nro"
curl -s -Q "DELE /switch/fh-nx/log.txt" "ftp://$IP:5002/" >/dev/null 2>&1 || true

python "$SWTOOLS/swremote.py" "PRESS A" "sleep 10"          # hbmenu -> sphaira (netloader)
"${DEVKITPRO:-/opt/devkitpro}/tools/bin/nxlink" -a "$IP" "$ROOT/host/build/fh-nx.nro" || true
# nxlink's stdio server fails on this PC, the NRO still starts. Quit it with: swremote.py "PRESS PLUS"
