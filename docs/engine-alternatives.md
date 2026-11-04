# Alternatives to QuickJS (November 2026)

The question: is there something better than QuickJS-ng, such as another engine, a JIT, or an ahead-of-time "recomp" of the game's
JavaScript? Short answer: **yes, V8 with its JIT.** It already runs on Switch homebrew, and on this game it is about 6x faster than
QuickJS on a PC. The device ratio is not measured yet, so a 1-week spike should come first.

## Measured: the real game under each engine (PC, tests/engine_bench)

These numbers come from an engine-neutral harness. It runs the port's own host/js/env.js and boot.js plus the game unchanged, with the
native bindings replaced by a JavaScript shim (`shim.js`), so only the JavaScript work differs. The QuickJS host (`qrun.c`) uses the
same runtime setup as the device. The V8 host is node (VS Code's Electron binary). Every engine reaches the same game-state digest on
every map.

Average tick in ms: logic plus the JavaScript side of rendering.

| Map | QuickJS-ng 0.17 | V8 jitless | V8 Sparkplug | V8 Maglev | V8 full JIT | full JIT vs QuickJS |
|---|---|---|---|---|---|---|
| 80 Back_alleys | 3.74 | 1.79 | 1.11 | 0.55 | 0.56 | 6.7x |
| 93 Level8_A | 2.99 | 1.56 | 0.98 | 0.50 | 0.50 | 6.0x |
| 185 The_Void2 | 2.88 | 1.40 | 0.90 | 0.57 | 0.49 | 5.9x |
| 65 Level8_2_A | 2.89 | 1.48 | 0.99 | 0.53 | 0.52 | 5.6x |
| 3 Level1_3_A | 2.37 | 1.25 | 0.82 | 0.42 | 0.41 | 5.7x |
| 74 Fortress | 1.57 | 0.87 | 0.59 | 0.30 | 0.31 | 5.1x |

- **Jitless V8:** even with no JIT, V8's interpreter is about 2x QuickJS.
- **Memory:** the V8 heap is 50-80 MB, against 100-150 MB for QuickJS on the same maps.
- **Synthetic Octane kernels** (`synth/`, `run_synth.sh`): full JIT is 50-90x QuickJS. Real MV code gains far less, as shown above.

## Options

| Option | Gain for this game | Switch feasibility | Effort | Verdict |
|---|---|---|---|---|
| **V8 inside the fh-nx host** (TooTallNate's switch-v8: V8 15.0 with Ignition, Sparkplug, Maglev and TurboFan on Horizon, JIT through libnx jitCreate) | about 6x on PC; device likely 3-5x (A57, memory-bound big maps, single-threaded GC) | Shown on hardware by the port author (fib 10x and string building 8.9x vs quickjs-ng on a Switch). Needs Clang-built prebuilt libs, title-override mode (as fh-nx already runs) and a ~128 MiB JIT arena | 4-8 person-weeks; the bindings (js_gl, canvas, nx_common, audio, mods) move to the V8 C++ API, and env.js/boot.js stay | **Best bet** |
| nx.js as the host (V8 + Skia + WebGL2), as BurialNX does for another MV game | same JS gain, but fh-nx's native canvas/lighting fast paths are lost and PIXI 4.5 wants WebGL1 | ships today | 3-5 weeks to boot, 6-10 for parity | worse than the above |
| ChowJS-style AOT (QuickJS bytecode to C, as OMORI's console port does) | about 3.9x over the QuickJS interpreter in MP2's own MV benchmark | no JIT needed | 25-50+ person-weeks | strongest "recomp" precedent, but 5-10x the effort of V8 for a lower ceiling |
| The Switch's WebKit browser applet | probably slower (old WebKit, JIT unknown) | needs a probe | 0.5-1 week probe | not worth it |
| Upgrade QuickJS (Bellard's 2026 release is ~1.24x quickjs-ng 0.15 on Octane) | 1.0-1.3x | trivial | 0.5-2 weeks | small |
| Rewrite in another engine (Unity/Godot) | large | n/a | 40-120+ weeks | a different program |

Sources and the full prior-art notes: build/engine_research/prior_art.json (local). They cover switch-v8 BUILD-LOG, the nx.js 1.0 betas,
BurialNX, MP2's ChowJS blog, and javascript-zoo arm64 data.

## The cheap first milestone (go/no-go, about 1 week)

1. Build a headless NRO from `tests/engine_bench`: the QuickJS host `qrun.c` for the Switch, and a V8 twin linked against switch-v8's
   prebuilt `libv8_monolith.a`. Both run the same files (shim.js + env.js + boot.js + driver.js) on the Lite.
2. Compare the per-map ticks on the Lite at stock clock and at 1700 MHz. If V8 JIT is at least 3x QuickJS on the big maps, port the real
   bindings (js_gl.c, the canvas binding layer, nx_common, audio, mods) to V8; the rasteriser and GL code stay as they are.
3. Risks to watch:
   - switch-v8 is young and single-maintainer, and its GC/W^X bugs were fixed only recently;
   - GC is single-threaded, so major GCs on a 150 MB heap stall the frame;
   - the JIT works only in application/title-override mode.

## Measured on the device (OLED, stock 1020 MHz, 2026-11-04)

Same harness, built as NROs (build/v8spike/qjs-bench and v8-bench, switch-v8 15.0.243-9). Average tick in ms; every engine reached the
same digest on every map.

| Map | QuickJS-ng | V8 jitless | V8 full JIT | full JIT vs QuickJS |
|---|---|---|---|---|
| 74 Fortress | 7.98 | 7.37 | 3.93 | 2.0x |
| 93 Level8_A | 14.83 | 12.25 | 6.02 | 2.5x |
| 80 Back_alleys | 18.76 | 14.92 | 6.39 | 2.9x |
| 185 The_Void2 | 14.24 | 11.34 | 5.48 | 2.6x |
| 65 Level8_2_A | 14.68 | 12.53 | 7.08 | 2.1x |
| 3 Level1_3_A | 12.37 | 10.70 | 5.06 | 2.4x |

- Full JIT is 2.0-2.9x QuickJS on the device, below the 3x go/no-go bar (Back_alleys, the heaviest map, comes closest). Jitless is
  only 1.1-1.3x, far from the 2x seen on PC.
- Embedder gotcha: `Isolate::AddMessageListener` writes into the heap, so the isolate must be entered (`Isolate::Scope`) first. Without
  it V8 reads a null current LocalHeap and Data Aborts in `WriteBarrier::GenerationalBarrierSlow` (fault address 0x8), on both jitless
  and JIT. Node on PC does not show it.

### At 1700 MHz (OLED, hoc:clk override through host/src/cpu_boost.c; `clock.ini` with `cpu_mhz=1700` in the bench dir)

| Map | QuickJS-ng | V8 full JIT | full JIT vs QuickJS |
|---|---|---|---|
| 74 Fortress | 5.42 | 2.81 | 1.9x |
| 93 Level8_A | 10.13 | 4.44 | 2.3x |
| 80 Back_alleys | 12.89 | 4.67 | 2.8x |
| 185 The_Void2 | 9.65 | 3.98 | 2.4x |
| 65 Level8_2_A | 10.04 | 5.16 | 1.9x |
| 3 Level1_3_A | 8.44 | 3.61 | 2.3x |

- The higher clock helps both engines about equally, so the gap stays at 1.9-2.8x, still under the 3x bar.
- Memory risk: the switch-v8 backend never gives pages back (munmap is a no-op), and the data arena it reserves varies from run to run
  (512 MB or 1024 MB). One 1700 MHz run got 512 MB and hit a fatal OOM on the 6th map after about 30 s of play. A port would need a
  reusing page allocator (the --hz-pool experiment) or a backend that releases memory.
