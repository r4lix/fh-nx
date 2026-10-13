#!/bin/sh
# Device perf run. Console must be on hbmenu (sphaira starred) and idle -- LOOK AT A SCREENSHOT FIRST.
# Uploads js (+ tests/dev_coarse.js as www/js/dev_extra.js), launches sphaira->nxlink, loads save slot 1|2
# (the Load screen opens on slot 2: Global.sav says last saved = 2), runs N s, quits, prints perf lines.
#   tools/dev_run.sh [seconds] [slot 1|2]
IP=${SWITCH_IP:-172.31.99.188}; ROOT=$(cd "$(dirname "$0")/.." && pwd)
SW=${SWTOOLS:-/c/Users/Admin/Documents/sh2-nx/port-sh2-nx/tools}; RUN=${1:-40}; SLOT=${2:-1}
for f in env.js boot.js; do curl -s --max-time 30 -T "$ROOT/host/js/$f" "ftp://$IP:5002/switch/fh-nx/js/$f"; done
[ -f "$ROOT/tests/dev_coarse.js" ] && curl -s --max-time 30 -T "$ROOT/tests/dev_coarse.js" "ftp://$IP:5002/switch/fh-nx/www/js/dev_extra.js"
curl -s --max-time 8 -Q "DELE /switch/fh-nx/log.txt" "ftp://$IP:5002/" >/dev/null 2>&1
python "$SW/swremote.py" "PRESS A" "sleep 10" | tail -1
(timeout 100 /opt/devkitpro/tools/bin/nxlink -a "$IP" "$ROOT/host/build/fh-nx.nro" >/dev/null 2>&1 &); sleep 45
python "$SW/swremote.py" "PRESS A" "sleep 7" | tail -1
[ "$SLOT" = 1 ] && python "$SW/swremote.py" "PRESS UP" "sleep 1" | tail -1
python "$SW/swremote.py" "PRESS A" "sleep $RUN" | tail -1
python "$SW/swremote.py" "PRESS PLUS" "sleep 6" | tail -1
rm -f "$ROOT/build/device_log.txt"
for i in 1 2 3 4 5; do curl -s --max-time 15 -o "$ROOT/build/device_log.txt" "ftp://$IP:5002/switch/fh-nx/log.txt" && [ -s "$ROOT/build/device_log.txt" ] && break; sleep 3; done
[ -s "$ROOT/build/device_log.txt" ] || { echo "NO LOG (app did not run)"; exit 1; }
grep -a '\[coarse\]' "$ROOT/build/device_log.txt" | tail -1 | cut -c1-700
grep -a '\[perf\] map' "$ROOT/build/device_log.txt" | tail -3 | cut -c1-140
grep -a '\[host\]' "$ROOT/build/device_log.txt" | tail -1 | cut -c1-110
