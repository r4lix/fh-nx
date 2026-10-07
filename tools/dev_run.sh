#!/bin/sh
# Device perf run from a stopped state (hbmenu or Switch home): uploads js, launches sphaira->nxlink, Continue file 1,
# runs N s, quits, prints map-74 perf. Refuses to print a stale log.   tools/dev_run.sh [seconds]
IP=${SWITCH_IP:-172.31.99.188}; ROOT=$(cd "$(dirname "$0")/.." && pwd)
SW=${SWTOOLS:-/c/Users/Admin/Documents/sh2-nx/port-sh2-nx/tools}; RUN=${1:-40}
for f in env.js boot.js; do curl -s --max-time 30 -T "$ROOT/host/js/$f" "ftp://$IP:5002/switch/fh-nx/js/$f"; done
curl -s --max-time 8 -Q "DELE /switch/fh-nx/log.txt" "ftp://$IP:5002/" >/dev/null 2>&1
python "$SW/swremote.py" "PRESS A" "sleep 10" | tail -1
(timeout 100 /opt/devkitpro/tools/bin/nxlink -a "$IP" "$ROOT/host/build/fh-nx.nro" >/dev/null 2>&1 &); sleep 45
python "$SW/swremote.py" "PRESS A" "sleep 7" "PRESS A" "sleep $RUN" | tail -1
python "$SW/swremote.py" "PRESS PLUS" "sleep 6" | tail -1
rm -f "$ROOT/build/device_log.txt"
for i in 1 2 3 4 5; do curl -s --max-time 15 -o "$ROOT/build/device_log.txt" "ftp://$IP:5002/switch/fh-nx/log.txt" && [ -s "$ROOT/build/device_log.txt" ] && break; sleep 3; done
[ -s "$ROOT/build/device_log.txt" ] || { echo "NO LOG (app did not run)"; exit 1; }
grep -a "map 74" "$ROOT/build/device_log.txt" | tail -3 | cut -c1-140; grep -a "\[host\]" "$ROOT/build/device_log.txt" | tail -1 | cut -c1-110
