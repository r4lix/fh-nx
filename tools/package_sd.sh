#!/bin/sh
# Build a copy-to-SD-root folder for testing on another console: dist/sdcard/switch/fh-nx/{fh-nx.nro,js/,www/}.
#   tools/package_sd.sh <clean www dir>
set -e
WWW=${1:?clean www dir}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/dist/sdcard/switch/fh-nx"
rm -rf "$ROOT/dist/sdcard"
mkdir -p "$OUT/js" "$OUT/www" "$OUT/save"
cp "$ROOT/host/build/fh-nx.nro" "$OUT/fh-nx.nro"
cp "$ROOT/host/js/env.js" "$ROOT/host/js/boot.js" "$OUT/js/"
# the game, minus junk (same filter as tools/upload_www.sh); saves are never copied
(cd "$WWW" && find . -type f ! -name '.DS_Store' ! -name '*.psd' ! -name '*.xmp' ! -name '*.bak' ! -path './__MACOSX/*' ! -path './save/*' -print0 | tar --null -T - -cf -) | (cd "$OUT/www" && tar -xf -)
cp "$ROOT/tools/summarize_log.py" "$ROOT/dist/summarize_log.py"
du -sh "$ROOT/dist/sdcard"
