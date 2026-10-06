#!/bin/sh
# Upload a game www/ tree to the Switch SD (sdmc:/switch/fh-nx/www) over FTP, several files at a time.
# Resumable: finished files are recorded in build/uploaded.txt and skipped next time.
#   tools/upload_www.sh <www dir> [parallel]
set -e
WWW=${1:?www dir}
PAR=${2:-4}
IP=${SWITCH_IP:-172.31.99.188}
PORT=${FTP_PORT:-5002}            # 5002: sys-ftpd (fragile under load); 5000: the sdmc:-rooted server
PFX=${FTP_PREFIX:-}               # "/sdmc:" for port 5000
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DONE="$ROOT/build/uploaded.txt"
mkdir -p "$ROOT/build"
touch "$DONE"
export IP PORT PFX WWW DONE

# everything except junk and the user's saves
(cd "$WWW" && find . -type f ! -name '.DS_Store' ! -name '*.psd' ! -name '*.xmp' ! -name '*.bak' \
    ! -path './__MACOSX/*' ! -path './save/*' | sed 's|^\./||' | sort) > "$ROOT/build/www_files.txt"
grep -vxFf "$DONE" "$ROOT/build/www_files.txt" > "$ROOT/build/www_todo.txt" || true
echo "$(wc -l < "$ROOT/build/www_todo.txt") files to upload ($(wc -l < "$DONE") already done)"

tr '\n' '\0' < "$ROOT/build/www_todo.txt" | xargs -0 -P "$PAR" -I{} sh -c '
    f="$1"
    enc=$(printf "%s" "$f" | sed "s/ /%20/g; s/\\$/%24/g; s/#/%23/g; s/!/%21/g; s/&/%26/g; s/(/%28/g; s/)/%29/g; s/\\x27/%27/g")
    if curl -s --max-time 180 --ftp-create-dirs -T "$WWW/$f" "ftp://$IP:$PORT$PFX/switch/fh-nx/www/$enc"; then
        echo "$f" >> "$DONE"
    else
        echo "FAIL $f" >&2
    fi' _ {}
echo "upload finished: $(wc -l < "$DONE") files recorded"
