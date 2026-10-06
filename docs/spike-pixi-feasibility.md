# Feasibility spike: running the MV game on QuickJS + GLES

Measured on the clean Steam build (RPG Maker MV, PIXI 4.5.4), QuickJS-ng 0.17.0. Sections 1-5
are x86 desktop numbers; section 7 has the same scripts run on a Switch Lite at stock clock.
Scripts: `spike/load_mv.js`, `spike/pixi_bench.js`, `spike/parse_db.js`
(`qjs spike/<script>.js <www dir>`).

## Verdict

Feasible. The WebGL side is the easy part. The risks are boot time for the game database, one
plugin that rasterises a full-screen canvas every frame, and the Canvas 2D / Web Audio /
XHR / Image surface that the shim has to supply natively.

## 1. PIXI / WebGL: small and GLES2-clean

- PIXI 4.5.4 calls about 60 distinct `gl.*` functions in total, all core GLES 2.0. Extensions
  are optional: `OES_vertex_array_object` (PIXI falls back), `WEBGL_lose_context`,
  `OES_texture_float`.
- A realistic map frame (1314 tiles over 4 layers, 66 sprites, 6 window-sized containers)
  makes **43 GL calls and 19 distinct entry points** per frame. JS time for that frame
  is **0.67 ms** on x86.
- WebGL1 shaders are GLSL ES 1.00, the same dialect GLES2 takes, so the shaders in
  `FilterController` (a bundled pixi-filters) should run unchanged.
- The game only ever invokes four filters from event data: `OUTLINE`, `ZOOM` (ZoomBlur),
  `SATURATION` (Adjustment), `GOD` (Godray). The other 20-odd bundled filters can be ignored
  at first.
- The fake context needed to run PIXI had to answer `getActiveAttrib`/`getActiveUniform`
  from the shader text, as a real driver does. A native GLES2 backend gets that for free.

## 2. Loading the engine is cheap

All 4 MB of JS (PIXI, rpg_*, 48 enabled plugins) evaluates in **144 ms** and leaves
**10.6 MB** of QuickJS heap (5.9 MB of that is bytecode). Every plugin loads except
`Archeia_Steamworks` (needs greenworks: stub it). `eval(String(parameters))` in one plugin
and `require(...)` calls need `eval`/CommonJS shims but nothing exotic.

## 3. The game database: big, but a boot-time cost more than a memory problem

| Data | Text | QuickJS heap |
|---|---|---|
| Whole database (14 files) | 19.3 MB | **126 MB** |
| of which `Troops.json` | 12.2 MB | **about 79 MB** |
| of which `CommonEvents.json` | 5.6 MB | most of the rest |
| Each map | about 2 MB | **about 9.5 MB** |

The Switch Lite has 4 GB, and an installed (NSP) or title-takeover app gets most of the
~3.2 GB application pool, so 126 MB fits easily. Only applet-mode hbmenu launches have a
heap of a few hundred MB, where this plus the image cache could matter. Target the NSP.

The real cost is time: the database parses in 0.58 s on x86, probably several seconds on
the Switch, and a bigger heap lengthens GC pauses. Cheap wins if boot feels slow:
load `Troops.json` lazily (it is only read by id), or pre-process the data in the build
tool to drop default-valued fields.

## 4. Canvas 2D: needed natively, with one hot spot

`Bitmap` is always a 2D canvas, even in WebGL mode. Operations the core uses:
`fillRect`, `clearRect`, `drawImage` (with scaling and source rects), `getImageData` /
`putImageData` (tone, hue rotation, pixel reads), `measureText`, `fillText`, `strokeText`
(window text outlines), `createLinearGradient`, `arc`/`fill`/`clip`, `save`/`restore`,
`setTransform`, `globalAlpha`, `globalCompositeOperation`. FreeType and HarfBuzz are in the
Switch portlibs for text.

**`TerraxLighting` is the performance risk.** On the 71 maps that use lighting, each
frame it fills a screen-sized mask black, draws radial-gradient lights into it with
`globalCompositeOperation = 'lighter'`, and re-uploads the whole canvas as a texture.
Done in software that is millions of blended pixels per frame on a weak CPU. Plan: keep the
plugin's command parsing in JS but redraw the mask on the GPU (additive quads into an FBO).
Measure before optimising.

## 5. The rest of the browser surface

- **Audio**: `AudioContext` with buffer sources, gain, panner. `DSE-AudioLagFix` replaces
  the audio layer (check or drop it). OGG decodes with the vorbis libraries already in
  portlibs.
- **Loading**: XHR for JSON, `Image` for pictures (decrypt in memory, then libpng),
  `FontFace`/`document.fonts` for the two TTFs.
- **Saves**: `StorageManager` uses `require('fs')` under NW.js: shim `fs` onto the SD card.
- **Video**: `intro.webm` through an HTML video element: skip or play via ffmpeg.
- **Input**: keyboard events and `navigator.getGamepads()`, to be fed from the pad.
- The 1280×720 widescreen mod is already the right size for the Switch.

## 6. Order of work from here

1. Native host skeleton: QuickJS, a GLES2 context, `gl` bindings, minimal `document`/`window`.
2. `Bitmap`'s canvas-2D context, `Image`, XHR, fonts: enough to reach `Scene_Boot`.
3. Boot to the title screen and into the first map, headless first (fake GL, as in the spike).
4. The Terrax mask on the GPU, then audio; lazy Troops only if boot time needs it.

## 7. On device (Switch Lite, stock clock, handheld)

Same scripts, run by `bench-nro/` (QuickJS cross-built with devkitA64, `-O2`, one thread).
Stock clock confirmed from the status overlay during the run (CPU 100% at 1043.6 MHz).

| | x86 | Lite | slowdown |
|---|---|---|---|
| Load all 4 MB of JS | 144 ms | 758 ms | 5.3x |
| Parse the database (19.3 MB) | 579 ms | 2.8 s | 4.9x |
| of which `Troops.json` | 384 ms | 1.9 s | 4.9x |
| Parse one 2 MB map | 46 ms | 191 ms | 4.2x |
| PIXI map frame (1314 tiles + 66 sprites) | 0.67 ms | **3.9 ms** | 5.8x |

Heap sizes match the x86 run (about 143 MB for the database). Process memory available after
hbmenu title takeover: **3189 MB**.

Reading it: the engine is about **5x slower than the desktop**, not 3x. An earlier run looked
faster because the console was overclocked (about 2.4 GHz on the overlay); the bench's own
clock readout said 1020 MHz in both cases and is not to be trusted, so check the overlay.

- PIXI rendering for a typical map costs about 4 ms of a 16.6 ms frame, so about 12 ms is left
  at 60 fps for MV's own logic, window redraws and the native side. Tight, but a 30 fps
  fallback has plenty of room.
- Boot is about 3.5 s of JS work (load plus database), tolerable once, with lazy troops
  as the available trim.
- QuickJS scripts run on one core: the GL, audio and 2D-canvas work should go on others.
