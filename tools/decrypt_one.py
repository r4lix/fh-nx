#!/usr/bin/env python3
"""Decrypt one RPG Maker MV asset:  decrypt_one.py <www> <relative .rpgmvo/.rpgmvp path> <out file>"""
import json, os, sys
www, rel, out = sys.argv[1:4]
key = bytes.fromhex(json.load(open(os.path.join(www, "data", "System.json"), encoding="utf-8-sig"))["encryptionKey"])
blob = open(os.path.join(www, rel), "rb").read()
assert blob[:5] == b"RPGMV", "not an MV asset"
body = bytearray(blob[16:])
for i in range(16):
    body[i] ^= key[i]
open(out, "wb").write(body)
print(len(body), "bytes ->", out)
