#!/usr/bin/env python3
"""Split a modified Fear & Hunger install into mod folders by diffing it against a clean one.

  extract_mods.py <clean www> <modded www> <out mods dir>

Rules (specific to the 16:9 widescreen setup this was written against):
  widescreen-16x9        every changed img/ file, plus FilterController/fullscreen/ShiftEnemies,
                         the two plugin entries they need, and TerraxLighting's screen size
  map074-edit            data/Map074.json (affects saves: it changes event data)
  always-win-coin-tosses erri120 plugin, shipped disabled in plugins.js so the mod adds the entry

Neither install is modified. Anything the rules do not claim is listed at the end.
"""
import hashlib, json, os, shutil, sys

SKIP = {".DS_Store", "Thumbs.db"}


def files(root):
    out = {}
    for d, dirs, names in os.walk(root):
        dirs[:] = [x for x in dirs if x != "__MACOSX"]
        for n in names:
            if n in SKIP:
                continue
            p = os.path.join(d, n)
            out[os.path.relpath(p, root).replace(os.sep, "/")] = p
    return out


def sha1(p):
    h = hashlib.sha1()
    with open(p, "rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()


def plugin_table(path):
    """name -> parameters for every entry of `var $plugins = [...]` in plugins.js."""
    with open(path, encoding="utf-8") as f:
        text = f.read()
    arr = json.loads(text[text.index("["):text.rindex("]") + 1])
    return {e["name"]: e.get("parameters", {}) for e in arr}


def main(clean, modded, out):
    c, m = files(clean), files(modded)
    changed = [p for p in m if p in c and sha1(c[p]) != sha1(m[p])]
    added = [p for p in m if p not in c and not p.startswith("save/")]
    claimed = set()

    def put(mod, rel):
        dst = os.path.join(out, mod, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(m[rel], dst)
        claimed.add(rel)

    def manifest(mod, **kw):
        with open(os.path.join(out, mod, "mod.json"), "w", encoding="utf-8") as f:
            json.dump(kw, f, indent=2)

    ws = "widescreen-16x9"
    for rel in changed:
        if rel.startswith("img/"):
            put(ws, rel)
    for rel in ("js/plugins/FilterController.js", "js/plugins/fullscreen.js", "js/plugins/ShiftEnemies.js"):
        if rel in m:
            put(ws, rel)

    base_l, mod_l = plugin_table(os.path.join(clean, "js/plugins.js")), plugin_table(os.path.join(modded, "js/plugins.js"))
    entries = []
    for name in ("fullscreen", "ShiftEnemies"):
        if name in mod_l and name not in base_l:
            entries.append({"name": name})
    overrides = []
    for name, new in mod_l.items():
        old = base_l.get(name)
        if old is not None and old != new:
            overrides.append({"plugin": name, "params": {k: v for k, v in new.items() if old.get(k) != v}})
    claimed.add("js/plugins.js")
    manifest(ws, name="Widescreen 16:9 (1280x720)", version="1.0",
             description="Runs the game at 1280x720 instead of 816x624: widescreen backgrounds, "
                         "shifted battlers, resized lighting.",
             plugins=entries, plugin_params=overrides)

    if "data/Map074.json" in changed:
        put("map074-edit", "data/Map074.json")
        manifest("map074-edit", name="Map074 edit", version="1.0", affects_saves=True,
                 description="Edited events on map 74. Toggling this can desync an existing save.")

    cheat = "js/plugins/erri120_AlwaysWinCoinTosses.js"
    if cheat in added:
        put("always-win-coin-tosses", cheat)
        manifest("always-win-coin-tosses", name="Always win coin tosses", version="1.0", author="erri120",
                 description="Cheat: coin tosses always go your way.",
                 plugins=[{"name": "erri120_AlwaysWinCoinTosses"}])

    left = [p for p in changed + added if p not in claimed]
    print(f"{len(changed)} changed + {len(added)} added; mods written to {out}")
    for mod in sorted(os.listdir(out)):
        n = sum(len(fs) for _, _, fs in os.walk(os.path.join(out, mod))) - 1
        print(f"  {mod}: {n} files")
    print("unclaimed:", left or "none")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
