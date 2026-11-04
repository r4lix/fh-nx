# fh-nx

Fear & Hunger (RPG Maker MV) running natively on the Nintendo Switch.

**No game content is included.** You need your own copy of the game (the PC version, 1.4.1).

## Disclaimer

This project was created **entirely with the help of AI coding tools**.

I am **not a developer**, so the code may contain bugs, security vulnerabilities, mistakes, or unfinished features. fh-nx is a personal project that I decided to share with others who may find it useful.

Use it at your own risk. I cannot guarantee support, stability, compatibility, security, or regular updates.


## Install

1. Download `fh-nx.zip` from the [latest release](https://github.com/r4lix/fh-nx/releases/latest) and extract it to the root of your SD card. This creates `sdmc:/switch/fh-nx/`.
2. Copy the game's `www` folder (the one holding `js`, `img`, `audio`, `data`...) to `sdmc:/switch/fh-nx/www`.
3. Launch **Fear & Hunger** from the homebrew menu. For full speed, open the homebrew menu through a game (hold **R** while
   starting any game): the game then runs with V8's JIT. Opened from the album it still works, just slower.

`fh-nx-quickjs.nro` (**Fear & Hunger (QuickJS)** in the menu) is the previous, slower engine, kept as a fallback: use it if the
main one has a problem in some scene, and please report it.

Hold **-** for 2 seconds in game for the menu: mods, controls, system settings (CPU clock, widescreen, performance overlay) and
a Debug tab for testing.

Saves are written to `sdmc:/switch/fh-nx/save`.


## Building

`host/Makefile` builds the QuickJS version (needs devkitPro and a quickjs-ng checkout, `QJS=`). The V8 version: run
`tools/get_switch_v8.sh` once (fetches the switch-v8 libraries), then `make -f Makefile.v8` in `host/`. Notes on the V8 port:
`docs/engine-alternatives.md`.
