# Feasibility spike: running the MV game on QuickJS + GLES

Measured on the clean Steam build (RPG Maker MV, PIXI 4.5.4), QuickJS-ng 0.17.0, x86 desktop.
Nothing here is an on-device number: the Switch's A57 cores are several times slower than the
desktop that produced the timings below, so treat times as relative, and heap sizes as real.
Scripts: `spike/load_mv.js`, `spike/pixi_bench.js`, `spike/parse_db.js`
(`qjs spike/<script>.js <www dir>`).

## Verdict

Feasible. The WebGL side is the easy part. The risks are memory for the game database, one
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

## 3. The game database is the memory problem

| Data | Text | QuickJS heap |
|---|---|---|
| Whole database (14 files) | 19.3 MB | **126 MB** |
| of which `Troops.json` | 12.2 MB | **about 79 MB** |
| of which `CommonEvents.json` | 5.6 MB | most of the rest |
| Each map | about 2 MB | **about 9.5 MB** |

Parse time for the database is 0.58 s on x86, probably several seconds on the Switch.
Loading it all at boot, as MV does, is too much for comfort inside a homebrew's memory
budget. Mitigations, cheapest first:
1. Load `Troops.json` lazily (one troop on demand). It is only read by id.
2. Pre-process the data in the build tool: drop default-valued fields, intern repeated
   event-command objects.
3. Do the same for `CommonEvents`.

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
4. Lazy Troops, then the Terrax mask on the GPU, then audio.
