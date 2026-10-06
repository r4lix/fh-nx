#!/usr/bin/env python3
"""Summarize a fh-nx host log (sdmc:/switch/fh-nx/log.txt): scenes reached, boot timings, and per-300-frame
performance windows. Paste the output back for analysis.   summarize_log.py <log.txt>"""
import re, sys

lines = open(sys.argv[1], encoding="utf-8", errors="replace").read().splitlines()
print("== events")
for l in lines:
    if re.search(r"audio out|MV ERROR|MV LOAD|port patch|scene ->|JS EXCEPTION|FAILED", l) and "require is not defined" not in l:
        print(l[:160])
rows = []
for l in lines:
    m = re.match(r"\[host\] 300 frames, ([\d.]+) fps, JS\+GL ([\d.]+) ms/frame(?: \(swap wait ([\d.]+); GL: upload ([\d.]+) .*?draw ([\d.]+) .*?buffer ([\d.]+)\))?", l)
    if m:
        rows.append((float(m.group(1)), float(m.group(2))))
print("\n== frame windows (300 frames each): fps / JS+GL ms per frame")
print("  ".join("%.0f/%.1f" % r for r in rows))
busy = [r for r in rows if r[1] > 2.0]
if busy:
    print("\nbusy windows (>2 ms/frame): %d, avg %.1f ms, worst %.1f ms, min fps %.1f" % (
        len(busy), sum(r[1] for r in busy) / len(busy), max(r[1] for r in busy), min(r[0] for r in busy)))
