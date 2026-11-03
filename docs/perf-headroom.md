# CPU headroom, November 2026

Question: is there still room for CPU improvement? Yes. Six changes landed in this round. The Switch Lite (stock clock, 1020 MHz) is
11-27% faster per frame on the surveyed maps, standing still. Walking gains more, but walking has not been measured on the device yet.

## Measured on the Switch Lite (stock clock, standing, teleport survey, `tools/lite_arm.ps1`)

Average frame (tick) time in ms, two runs per arm. The "before" arm is boot.js 8421f4c with the fill fast path off. The "after" arm is
boot.js e543286, which already has changes 1-4 but not the sort or the paint cache.

| Map | Before | After | Change | fps before -> after |
|---|---|---|---|---|
| 80 Back_alleys (535 events, 24 lights) | 35.5 / 36.2 | 31.4 / 30.7 | -14% | 28 -> 32 |
| 93 Level8_A (412 events) | 30.5 / 29.8 | 25.8 / 24.3 | -17% | 33 -> 40 |
| 185 The_Void2 (360 events, 18 lights) | 28.0 / 28.6 | 20.8 / 20.7 | -27% | 35 -> 48 |
| 74 Fortress (156 events) | 13.8 / 13.8 | 12.2 / 12.4 | -11% | 60 (capped) |
| 65 Level8_2_A | 25.7 / 26.3 | 22.0 / 21.9 | -16% | 38 -> 46 |
| 3 Level1_3_A | 22.9 / 23.5 | 18.9 / 18.1 | -20% | 43 -> 54 |

Cost per logic update fell 6-10% (for example 80: 21.6 -> 20.3 ms, 185: 18.3 -> 16.5 ms). Part of the per-frame gain comes from fewer catch-up
updates per frame (80: 1.66 -> 1.53). The device still needs about 16.5-20 ms per update on the big maps at stock clock, so 60 fps needs
either the overclock (1700-1800 MHz: about 1.7x) or more work below.

## What landed (PC harness, each verified identical to stock MV)

| # | Change | PC ms/tick saved (80/93/185/74) | Identity check |
|---|---|---|---|
| 0 | Exact fast path for solid fillRect with fractional edges (light mask), js_canvas.c | 1.1 / 1.7 / 1.2 / 1.3 | 3544 random scenes + every in-game fill, 0 differing pixels |
| 3 | Camera-only Sprite_Character update (patch 3 (c)) | walking 4.1 / 1.6 / 1.1 / 1.7 | about 316k decisions compared with stock, 0 diffs |
| 1 | Starting-event set + autorun-only list (patches 2, 2b) | 0.2 / 0.7 / 1.1 / 0.15 | deterministic digests identical, 6175 call checks |
| 2 | Patch 7 TTL renewal by exact revalidation | 0.3-0.4, plus no once-a-second spike (6-16 ms PC) | game state identical at every checkpoint (see caveat in the commit) |
| 4 | Tilemap sort reads position._y directly | 0.5 / 0.45 / 0.35 / 0.14 | 4700 sorts, 0 diffs against stock |
| 6 | Tilemap paint cache (patch 16) | tile-crossing paint 2-3 ms -> about 0.8 ms (walking spikes) | 1731 paints, 0 diffs |

PC survey standing, before -> after changes 0-3: 74 4.9 -> 3.3, 93 7.4 -> 5.4, 80 9.3 -> 7.6, 185 7.9 -> 5.3 ms/tick.

## Not landed

- **Multi-core gradient lights (branch proto/7-par-gradient):** 0.84 ms/tick on map 80 only. It is off on the Switch until it is built with
  FH_PAR_RASTER and checked on hardware.
- **Removing `arguments` objects from boot.js wrappers (proto 5):** the prototype was not finished; expect 0.2-0.34 ms/tick on PC.
- **QuickJS prototype-chain lookup cache:** only -2.3% once it was measured properly, and it would be a permanent engine fork. Dropped.
- Other dropped ideas, with reasons: `build/salvage/triage.json` (local).

## The ceiling

QuickJS is an interpreter: the game's JavaScript runs about 3-5x slower on the A57 than on this PC, and it is memory-bound on big maps.
The remaining per-update time is spread over many small items (map logic, sprite updates, PIXI render, lighting). The next steps are
the overclock, a device check of the walking gains, then proto 5 and proto 7. A JIT engine would be a rewrite, not a tweak.

## How to measure on the Lite

`tools/lite_arm.ps1 -Boot <boot.js> -Probe <probe.js> -Tag <name>`: it uploads both files through SwitchLink, launches the game, waits for
the probe to quit (nx.quit) and prints the probe's log lines. The probes are tests/bench_maps.js wrapped with `globalThis.__maps` and a quit
hook (see build/dev_survey_*.js, build/dev_walk_*.js). Needs the SwitchLink app connected on the Lite.
