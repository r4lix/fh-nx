#!/bin/sh
# Self-driving device bench: tests/bench_transfer.js runs as dev_extra.js (loads the Continue save, then teleports
# through maps and logs [xfer] latency lines). Console on hbmenu + idle -- screenshot first.   tools/dev_xfer.sh [wait s]
IP=${SWITCH_IP:-172.31.99.188}; ROOT=$(cd "$(dirname "$0")/.." && pwd)
SW=${SWTOOLS:-/c/Users/Admin/Documents/sh2-nx/port-sh2-nx/tools}; WAIT=${1:-150}
for f in env.js boot.js; do curl -s --max-time 30 -T "$ROOT/host/js/$f" "ftp://$IP:5002/switch/fh-nx/js/$f"; done
sed 's/const MAPS = g.__maps || \[3, 93, 110, 74, 31, 53\];/const MAPS = g.__maps || [3, 93, 110, 74, 31, 53, 3, 93];/' "$ROOT/tests/bench_transfer.js" > "$ROOT/build/dev_xfer.js"
curl -s --max-time 30 -T "$ROOT/build/dev_xfer.js" "ftp://$IP:5002/switch/fh-nx/www/js/dev_extra.js"
curl -s --max-time 8 -Q "DELE /switch/fh-nx/log.txt" "ftp://$IP:5002/" >/dev/null 2>&1
python "$SW/swremote.py" "PRESS A" "sleep 10" | tail -1
(timeout 100 /opt/devkitpro/tools/bin/nxlink -a "$IP" "$ROOT/host/build/fh-nx.nro" >/dev/null 2>&1 &); sleep "$WAIT"
python "$SW/swremote.py" "PRESS PLUS" "sleep 6" | tail -1
rm -f "$ROOT/build/device_log.txt"
for i in 1 2 3 4 5; do curl -s --max-time 15 -o "$ROOT/build/device_log.txt" "ftp://$IP:5002/switch/fh-nx/log.txt" && [ -s "$ROOT/build/device_log.txt" ] && break; sleep 3; done
[ -s "$ROOT/build/device_log.txt" ] || { echo "NO LOG (app did not run)"; exit 1; }
grep -a '\[xfer\]' "$ROOT/build/device_log.txt" | cut -c1-220
