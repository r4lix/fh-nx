#!/usr/bin/env python3
"""Inventory, hash and decrypt an RPG Maker MV `www/` folder (Fear & Hunger).

  fh_manifest.py manifest <www> -o manifest.json   SHA-1 of every file + classification
  fh_manifest.py verify   <www>                    decrypt every asset in memory, check magic bytes
  fh_manifest.py decrypt  <www> <out>              write a plain png/ogg/m4a copy of www

The source folder is only ever read.
"""
import argparse, hashlib, json, os, sys, time

HDR_LEN = 16
MV_HEADER = bytes.fromhex("5250474d56000000000301000000000000")[:HDR_LEN]
EXT_MAP = {".rpgmvp": ".png", ".rpgmvo": ".ogg", ".rpgmvm": ".m4a",
           ".png_": ".png", ".ogg_": ".ogg", ".m4a_": ".m4a"}
MAGIC = {".png": b"\x89PNG\r\n\x1a\n", ".ogg": b"OggS", ".m4a": None}
JUNK = {".DS_Store", "Thumbs.db"}


def load_key(www):
    with open(os.path.join(www, "data", "System.json"), "rb") as f:
        sysj = json.loads(f.read().decode("utf-8-sig"))
    return bytes.fromhex(sysj["encryptionKey"])


def decrypt(blob, key):
    if blob[:HDR_LEN] != MV_HEADER:
        raise ValueError("bad RPGMV header")
    body = bytearray(blob[HDR_LEN:])
    for i in range(min(HDR_LEN, len(body))):
        body[i] ^= key[i]
    return bytes(body)


def walk(www):
    for root, dirs, files in os.walk(www):
        dirs[:] = [d for d in dirs if d != "__MACOSX"]
        for n in sorted(files):
            if n in JUNK:
                continue
            p = os.path.join(root, n)
            yield p, os.path.relpath(p, www).replace(os.sep, "/")


def sha1(path):
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def classify(rel):
    if rel.startswith("js/plugins/"):
        return "plugin"
    if rel.startswith("save/"):
        return "save"
    if rel in ("js/plugins - Copie.js",) or rel.startswith("js_copies/"):
        return "leftover"
    return "game"


def cmd_manifest(a):
    entries = []
    for p, rel in walk(a.www):
        st = os.stat(p)
        entries.append({"path": rel, "size": st.st_size, "sha1": sha1(p),
                        "mtime": time.strftime("%Y-%m-%d", time.localtime(st.st_mtime)),
                        "class": classify(rel)})
    with open(a.o, "w", encoding="utf-8") as f:
        json.dump({"files": entries}, f, indent=1)
    by = {}
    for e in entries:
        by[e["class"]] = by.get(e["class"], 0) + 1
    print(f"{len(entries)} files -> {a.o}  {by}")


def cmd_verify(a):
    key = load_key(a.www)
    ok = bad = odd = 0
    for p, rel in walk(a.www):
        ext = os.path.splitext(p)[1].lower()
        if ext not in EXT_MAP:
            continue
        try:
            with open(p, "rb") as f:
                plain = decrypt(f.read(), key)
            magic = MAGIC.get(EXT_MAP[ext])
            if magic and not plain.startswith(magic):
                if plain.startswith(b"8BPS"):
                    print(f"NOTE {rel}: payload is a Photoshop PSD, not a PNG (shipped that way)")
                    odd += 1
                    continue
                raise ValueError("decrypted magic mismatch")
            ok += 1
        except Exception as e:
            bad += 1
            print(f"FAIL {rel}: {e}")
    print(f"decrypt ok={ok} bad={bad} odd={odd}")
    return 1 if bad else 0


def cmd_decrypt(a):
    key = load_key(a.www)
    n = 0
    for p, rel in walk(a.www):
        ext = os.path.splitext(p)[1].lower()
        out_rel = rel
        data = None
        if ext in EXT_MAP:
            out_rel = rel[: -len(ext)] + EXT_MAP[ext]
            with open(p, "rb") as f:
                data = decrypt(f.read(), key)
        out = os.path.join(a.out, out_rel)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        if data is None:
            with open(p, "rb") as f:
                data = f.read()
        with open(out, "wb") as f:
            f.write(data)
        n += 1
    print(f"{n} files written to {a.out}")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("manifest"); m.add_argument("www"); m.add_argument("-o", required=True)
    v = sub.add_parser("verify"); v.add_argument("www")
    d = sub.add_parser("decrypt"); d.add_argument("www"); d.add_argument("out")
    a = ap.parse_args()
    sys.exit({"manifest": cmd_manifest, "verify": cmd_verify, "decrypt": cmd_decrypt}[a.cmd](a) or 0)


if __name__ == "__main__":
    main()
