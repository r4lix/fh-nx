# fh-nx: advanced notes

## How it works

The Switch has no browser, so fh-nx is a native host that runs the game's own RPG Maker MV JavaScript:

- **QuickJS-ng** runs `rpg_*.js` and the plugins unmodified, except for a set of performance patches applied at load time in `host/js/boot.js` (numbered 0 to 14 in the comments).
- `host/js/env.js` is the browser shim: `window`, `document`, XHR, `Image`, Web Audio, gamepad.
- **WebGL1** is mapped onto GLES2 (`host/src/js_gl.c`). The logical game size comes from `Graphics.width/height`, letterboxed to 1280x720.
- **Canvas2D** is a software implementation (`host/src/js_canvas.c`) with the composite modes, gradients, `getImageData`, blur and tone adjustment that MV and its plugins use.
- Audio is decoded with libvorbis and mixed in software (`host/src/audio_*.c`).
- Sound, images and fonts are read from `sdmc:/switch/fh-nx/www` through a layered virtual file system (`src/vfs`) so that mods can override any file.

`env.js` and `boot.js` are loaded from the SD card at start, so they can be edited without rebuilding the NRO.

## SD layout

```
sdmc:/switch/fh-nx/
  fh-nx.nro
  js/env.js, js/boot.js
  www/                 the game (MV "www" folder)
  mods/<id>/           one folder per mod
  mods.ini             which mods are enabled
  log.txt              last run's log
```

## Mods

Hold **−** for two seconds to open the mods menu (D-pad/stick or touch, A toggles, Apply restarts the game). A mod is a folder in `mods/` with a `mod.json`:

```json
{
  "name": "Widescreen 16:9 (1280x720)",
  "version": "1.0",
  "description": "...",
  "plugins": [ { "name": "fullscreen" } ],
  "plugin_params": [ { "plugin": "TerraxLighting", "params": { "Screensize X": "1280" } } ]
}
```

Everything else in the folder mirrors the game's `www` tree (`img/`, `audio/`, `data/`, `js/plugins/`) and shadows the original files. Later mods win. Images and audio can be plain `.png` / `.ogg`; they are wrapped into MV's encrypted format on the fly using the key in `System.json`. `plugins` are appended to the plugin list and loaded from `js/plugins/`; `plugin_params` override the parameters of plugins already in `plugins.js`.

The widescreen pack I use (1280x720) is a mod made of replaced backgrounds plus plugins; it is not part of this repository.

## Intro video

The "New Game" intro is a WebM, and the Switch has no video decoder. Convert it once on a PC to an `.fhv` (JPEG frames plus an Ogg Vorbis track):

```sh
pip install av pillow
python tools/transcode_video.py www/movies/intro.webm www/movies/intro.fhv
```

and put the result next to the original in `sdmc:/switch/fh-nx/www/movies/`. Without it the intro is skipped. The same file can be shipped inside a mod. The format is documented in the docstring of the script.

## Building

Needs devkitPro (`switch-dev`, libnx, the Switch portlibs: mesa/`libdrm_nouveau`, `libvorbis`) and a [quickjs-ng](https://github.com/quickjs-ng/quickjs) checkout.

```sh
cd host
make QJS=/path/to/quickjs-ng -j4      # -> host/build/fh-nx.nro
```

`host/icon.jpg` is the NRO icon (rebuild requires deleting `host/build/fh-nx.nro`, make does not track it).

### PC tests

The same JS layer runs on a PC against a real `www/` folder, with a stub GL, which is how most of the work was done:

```sh
make boot-test SECONDS=30                       # run the game headless for 30 s
make boot-test SECONDS=30 EXTRA=tests/foo.js    # plus a probe script
FH_MODS=/path/to/mods FH_MODS_INI=/path/to/mods.ini make boot-test
```

`tests/` has the checks (canvas conformance, map benchmarks, mod VFS tests); `tools/dev_run.sh` and friends drive a console over FTP and nxlink.

## Performance

At stock clocks on a Switch Lite the teleport survey of 17 maps stays above 30 fps (worst map about 33 ms per frame). Big lit maps are the tightest. Overclocking is the user's choice and is not required.

## Tools

- `tools/fh_manifest.py`: inventory, hash and verify a `www/` folder; can decrypt assets for inspection.
- `tools/package_sd.sh <www>`: builds a copy-to-SD folder including the game, for testing on another console.
- `tools/transcode_video.py`: WebM to `.fhv`.
