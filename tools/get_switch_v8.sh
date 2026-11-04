#!/bin/sh
# Fetch the switch-v8 15.0.243-9 package (V8 + abseil + zlib static libs and headers for Switch homebrew, by TooTallNate) that
# host/Makefile.v8 links against, and unpack it to build/v8spike/pkg (Makefile.v8's default V8PKG).
# The package ships inside the container image ghcr.io/tootallnate/pacman-packages:switch-v8 (one layer per package). This pulls
# only the layer that copies /packages/v8, anonymously, with curl: no docker or dkp-pacman needed. Needs curl, python, tar, zstd.
#   tools/get_switch_v8.sh            (V8DIR=<dir> to unpack elsewhere)
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIR=${V8DIR:-$ROOT/build/v8spike}
REPO=tootallnate/pacman-packages
TAG=switch-v8
PKG=switch-v8-15.0.243-9-any.pkg.tar.zst
mkdir -p "$DIR"
cd "$DIR"
if [ -f pkg/opt/devkitpro/portlibs/switch/lib/libv8_monolith.a ]; then echo "already there: $DIR/pkg"; exit 0; fi

TOKEN=$(curl -fsS "https://ghcr.io/token?scope=repository:$REPO:pull" | python -c 'import json,sys; print(json.load(sys.stdin)["token"])')
H="Authorization: Bearer $TOKEN"
ACC="Accept: application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json"
curl -fsS -H "$H" -H "$ACC" "https://ghcr.io/v2/$REPO/manifests/$TAG" -o manifest.json
M=$(python -c 'import json; print(next(m["digest"] for m in json.load(open("manifest.json"))["manifests"] if m.get("platform", {}).get("architecture") == "amd64"))')
curl -fsS -H "$H" -H "$ACC" "https://ghcr.io/v2/$REPO/manifests/$M" -o manifest_amd64.json
C=$(python -c 'import json; print(json.load(open("manifest_amd64.json"))["config"]["digest"])')
curl -fsSL -H "$H" "https://ghcr.io/v2/$REPO/blobs/$C" -o config.json
# the n-th history entry that made a layer goes with the n-th layer: take the one that copied /packages/v8
L=$(python -c '
import json
c = json.load(open("config.json")); m = json.load(open("manifest_amd64.json"))
h = [x for x in c["history"] if not x.get("empty_layer")]
i = next(n for n, x in enumerate(h) if "/packages/v8/" in x.get("created_by", ""))
print(m["layers"][i]["digest"])')
curl -fsSL -H "$H" "https://ghcr.io/v2/$REPO/blobs/$L" -o v8layer.tar.gz
mkdir -p layer pkg
tar -xzf v8layer.tar.gz -C layer "packages/v8/$PKG"
zstd -dc "layer/packages/v8/$PKG" | tar -xf - -C pkg
ls -l pkg/opt/devkitpro/portlibs/switch/lib
