#!/bin/sh
# Reproducible performance run on the test Switch: push the JS, launch the host through sphaira, play the
# opening with scripted presses (New Game, Mercenary, name OK, game mode, a few advances), quit, and print the
# frame statistics from the log. The console must be on hbmenu with sphaira selected.
#   tools/play_device.sh [label]        (label is just printed with the summary)
set -e
IP=${SWITCH_IP:-172.31.99.188}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SW=${SWTOOLS:-/c/Users/Admin/Documents/sh2-nx/port-sh2-nx/tools}
LABEL=${1:-run}
NXLINK=${DEVKITPRO:-/opt/devkitpro}/tools/bin/nxlink

for f in env.js boot.js; do curl -s --max-time 30 -T "$ROOT/host/js/$f" "ftp://$IP:5002/switch/fh-nx/js/$f" || { echo "upload $f failed"; exit 1; }; done
curl -s --max-time 8 -Q "DELE /switch/fh-nx/log.txt" "ftp://$IP:5002/" >/dev/null 2>&1 || true

python "$SW/swremote.py" "PRESS A" "sleep 8" >/dev/null                       # hbmenu -> sphaira
"$NXLINK" -a "$IP" "$ROOT/host/build/fh-nx.nro" >/dev/null 2>&1 &            # sends the NRO, which starts
sleep 45                                                                       # engine load + pre-title
python "$SW/swremote.py" "PRESS A" "sleep 12" "PRESS A" "sleep 10" "PRESS UP" "sleep 1" "PRESS LEFT" "sleep 1" "PRESS A" "sleep 36" \
    "PRESS A" "sleep 10" "PRESS A" "sleep 8" "PRESS A" "sleep 8" "PRESS A" "sleep 30" >/dev/null
python "$SW/swremote.py" "PRESS PLUS" "sleep 6" >/dev/null

for i in 1 2 3 4 5; do curl -s --max-time 15 -o "$ROOT/build/device_log.txt" "ftp://$IP:5002/switch/fh-nx/log.txt" && [ -s "$ROOT/build/device_log.txt" ] && break; sleep 3; done
echo "=== $LABEL"
grep -a "audio out\|MV ERROR\|MV LOAD\|port patch\|scene ->" "$ROOT/build/device_log.txt" | head -14
echo "--- per-300-frame stats (fps, JS+GL ms/frame)"
grep -a "\[host\]" "$ROOT/build/device_log.txt" | awk '{printf "%s fps  %s ms\n", $4, $7}' | sort | uniq -c | sort -k2 -n | tail -14
