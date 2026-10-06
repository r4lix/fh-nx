#!/bin/sh
# Load the PC's map-74 save on the test Switch and read the [perf] lines: launch, Continue, file 1, let it run,
# quit, print the log summary. Console must be on hbmenu with sphaira selected.   tools/load_device.sh [seconds]
set -e
IP=${SWITCH_IP:-172.31.99.188}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SW=${SWTOOLS:-/c/Users/Admin/Documents/sh2-nx/port-sh2-nx/tools}
RUN=${1:-45}
for f in env.js boot.js; do curl -s --max-time 30 -T "$ROOT/host/js/$f" "ftp://$IP:5002/switch/fh-nx/js/$f"; done
for f in "RPG%20File1.sav" "RPG%20Global.sav"; do curl -s --max-time 30 --ftp-create-dirs -T "$ROOT/build/save/$f" "ftp://$IP:5002/switch/fh-nx/save/$(printf '%s' "$f" | sed 's/%/%25/g')"; done
curl -s --max-time 8 -Q "DELE /switch/fh-nx/log.txt" "ftp://$IP:5002/" >/dev/null 2>&1 || true
python "$SW/swremote.py" "PRESS A" "sleep 8" >/dev/null
"${DEVKITPRO:-/opt/devkitpro}/tools/bin/nxlink" -a "$IP" "$ROOT/host/build/fh-nx.nro" >/dev/null 2>&1 &
sleep 40
python "$SW/swremote.py" "PRESS A" "sleep 12" "PRESS A" "sleep $RUN" >/dev/null
python "$SW/swremote.py" --shot "$ROOT/build/load_device.jpg" >/dev/null
python "$SW/swremote.py" "PRESS PLUS" "sleep 6" >/dev/null
for i in 1 2 3 4 5; do curl -s --max-time 15 -o "$ROOT/build/device_log.txt" "ftp://$IP:5002/switch/fh-nx/log.txt" && [ -s "$ROOT/build/device_log.txt" ] && break; sleep 3; done
grep -a "audio out\|MV ERROR\|scene ->\|\[perf\]" "$ROOT/build/device_log.txt" | cut -c1-160 | head -30
