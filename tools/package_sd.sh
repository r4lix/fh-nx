#!/bin/sh
# Build a copy-to-SD-root folder for testing on another console: dist/sdcard/switch/fh-nx/{fh-nx.nro,fh-nx-quickjs.nro,js/,www/}.
#   tools/package_sd.sh <clean www dir>
set -e
WWW=${1:?clean www dir}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/dist/sdcard/switch/fh-nx"
rm -rf "$ROOT/dist/sdcard"
mkdir -p "$OUT/js" "$OUT/www" "$OUT/save"
# fh-nx.nro is the V8 build (host/Makefile.v8, about 1.5-2x faster); fh-nx-quickjs.nro the QuickJS build, kept as a fallback
[ -f "$ROOT/host/build_v8/fh-nx.nro" ] || { echo "build host/build_v8/fh-nx.nro first (tools/get_switch_v8.sh, make -f Makefile.v8)"; exit 1; }
cp "$ROOT/host/build_v8/fh-nx.nro" "$OUT/fh-nx.nro"
cp "$ROOT/host/build/fh-nx.nro" "$OUT/fh-nx-quickjs.nro"
cp "$ROOT/host/js/env.js" "$ROOT/host/js/boot.js" "$OUT/js/"
# the game, minus junk (same filter as tools/upload_www.sh); saves are never copied
(cd "$WWW" && find . -type f ! -name '.DS_Store' ! -name '*.psd' ! -name '*.xmp' ! -name '*.bak' ! -path './__MACOSX/*' ! -path './save/*' -print0 | tar --null -T - -cf -) | (cd "$OUT/www" && tar -xf -)
cp "$ROOT/tools/summarize_log.py" "$ROOT/dist/summarize_log.py"
du -sh "$ROOT/dist/sdcard"
