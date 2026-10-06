#!/usr/bin/env python3
"""Stage the on-device benchmark payload: spike scripts (module imports stripped, the NRO
provides `std`/`print` globals) and the slice of www/ they read.

  prep_bench.py <clean www> <out dir>        -> <out>/bench_*.js and <out>/www/{js,data}
"""
import os, re, shutil, sys

SPIKES = {"load_mv.js": "bench_load.js", "parse_db.js": "bench_db.js", "pixi_bench.js": "bench_pixi.js"}
DB = ["Actors", "Classes", "Skills", "Items", "Weapons", "Armors", "Enemies", "Troops", "States",
      "Animations", "Tilesets", "CommonEvents", "System", "MapInfos", "Map001", "Map031", "Map053", "Map074"]


def main(www, out):
    here = os.path.dirname(os.path.abspath(__file__))
    os.makedirs(out, exist_ok=True)
    for src, dst in SPIKES.items():
        text = open(os.path.join(here, "..", "spike", src), encoding="utf-8").read()
        text = re.sub(r'^import .*$', "", text, flags=re.M)
        text = "(function () {\n" + text + "\n})();\n"   # keep top-level const/let out of the global scope
        open(os.path.join(out, dst), "w", encoding="utf-8").write(text)
    for sub in ("js",):
        for d, dirs, files in os.walk(os.path.join(www, sub)):
            dirs[:] = [x for x in dirs if x != "__MACOSX"]
            for n in files:
                if n.endswith((".node", ".DS_Store")):
                    continue
                s = os.path.join(d, n)
                t = os.path.join(out, "www", os.path.relpath(s, www))
                os.makedirs(os.path.dirname(t), exist_ok=True)
                shutil.copyfile(s, t)
    os.makedirs(os.path.join(out, "www", "data"), exist_ok=True)
    for n in DB:
        shutil.copyfile(os.path.join(www, "data", n + ".json"), os.path.join(out, "www", "data", n + ".json"))
    total = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(out) for f in fs)
    print(f"staged {total / 1048576:.1f} MB in {out}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(*sys.argv[1:])
