#!/usr/bin/env python3
"""Turn an extracted Nexus mod (a patched copy of the game's www/ tree) into an fh-nx mod folder.

    make_mod.py <extracted dir> <clean www> <mods dir> --id ID --name NAME --author AUTHOR --url URL [--tested] [--description TEXT]

Only files that differ from the clean game are copied, so the mod folder is a small overlay. js/plugins.js is never copied: the
difference between its plugin list and the clean one becomes the "plugins" / "plugin_params" entries of mod.json, which the host
applies at start (see host/js/boot.js). A mod folder is written to <mods dir>/<ID>; it ships disabled until the player enables it.
"""
import argparse
import filecmp
import json
import os
import shutil
import sys


def find_www(root):
    """The folder inside `root` that looks like the game's www/ (has data/ or js/)."""
    if os.path.isdir(os.path.join(root, "data")) or os.path.isdir(os.path.join(root, "js")):
        return root
    for dp, dn, _ in os.walk(root):
        if os.path.basename(dp).lower() == "www" or ("data" in dn and "js" in dn):
            return dp
    return None


def load_plugins(path):
    s = open(path, encoding="utf-8-sig").read()
    return json.loads(s[s.index("["):s.rindex("]") + 1])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("clean")
    ap.add_argument("mods")
    ap.add_argument("--id", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--author", required=True)
    ap.add_argument("--url", default="")
    ap.add_argument("--version", default="")
    ap.add_argument("--description", default="")
    ap.add_argument("--tested", action="store_true")
    ap.add_argument("--copy", action="append", default=[], metavar="SRC=REL", help="extra file (relative to the extracted dir) to place at REL in the mod")
    ap.add_argument("--plugin", action="append", default=[], metavar="NAME", help="enable/add this plugin (when the mod ships no plugins.js)")
    a = ap.parse_args()

    www = find_www(a.src)                      # None for a bare plugin file: only --copy then
    out = os.path.join(a.mods, a.id)
    if os.path.exists(out):
        shutil.rmtree(out)
    changed, data_changed = [], False
    walk = os.walk(www) if www else []
    for dp, _, fn in walk:
        for f in fn:
            full = os.path.join(dp, f)
            rel = os.path.relpath(full, www).replace("\\", "/")
            if rel == "js/plugins.js" or rel.startswith("save/") or f.lower() in ("thumbs.db", ".ds_store"):
                continue
            base = os.path.join(a.clean, rel)
            if os.path.exists(base) and filecmp.cmp(full, base, shallow=False):
                continue
            dst = os.path.join(out, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(full, dst)
            changed.append(rel)
            if rel.startswith("data/"):
                data_changed = True

    for c in a.copy:
        srcrel, rel = c.split("=", 1)
        dst = os.path.join(out, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(os.path.join(a.src, srcrel), dst)
        changed.append(rel)

    plugins, overrides = [], [
    ]
    for n in a.plugin:
        plugins.append({"name": n, "description": "", "parameters": {}})
    mp = os.path.join(www or "", "js/plugins.js")
    if www and os.path.exists(mp):
        base = {p["name"]: p for p in load_plugins(os.path.join(a.clean, "js/plugins.js"))}
        for p in load_plugins(mp):
            b = base.get(p["name"])
            params = p.get("parameters", {})
            if b is None:
                if p.get("status", True):
                    plugins.append({"name": p["name"], "description": p.get("description", ""), "parameters": params})
            else:
                if p.get("status") and not b.get("status"):
                    plugins.append({"name": p["name"], "description": p.get("description", ""), "parameters": params})
                else:
                    diff = {k: v for k, v in params.items() if b.get("parameters", {}).get(k) != v}
                    if diff:
                        overrides.append({"plugin": p["name"], "params": diff})

    meta = {"name": a.name, "version": a.version, "author": a.author, "url": a.url, "description": a.description,
            "tested": a.tested, "affects_saves": data_changed}
    if plugins:
        meta["plugins"] = plugins
    if overrides:
        meta["plugin_params"] = overrides
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "mod.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)
    print("%s: %d files, %d plugin(s), %d override(s), saves=%s" % (a.id, len(changed), len(plugins), len(overrides), data_changed))
    for r in changed[:40]:
        print("   ", r)
    if len(changed) > 40:
        print("    ... and %d more" % (len(changed) - 40))


if __name__ == "__main__":
    sys.exit(main())
