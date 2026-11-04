# Device test scripts

Self-driving runs for a console with SwitchLink. Each script is loaded by boot.js as `www/js/dev_extra.js`, drives the game with
a fake pad from the title screen (Continue, the latest save), logs `[tag]` lines to `sdmc:/switch/fh-nx/log.txt` and quits by
itself. `tools/device_run.ps1` uploads one, launches the game, waits, fetches the log and removes the script again:

    powershell -File tools\device_run.ps1 -Boot host\js\boot.js -Probe tests\device\sweep_maps.js -Tag sweep -Timeout 2700 -Nro /switch/fh-nx/fh-nx.nro

| Script | What it checks | Time |
|---|---|---|
| map_tour.js | tick cost on six big maps | 2 min |
| sweep_maps.js | every map (god mode, teleport); restarts the game and resumes when a map traps the player (`save/sweep_state.json`) | 40-50 min |
| sweep_troops.js | a short battle against every troop | 15 min |
| long_session.js | 12 min walking on Back_alleys: frame times, GC pauses | 13 min |
| restart_x20.js | 20 game restarts in a row (the mods menu's Apply path), then a map tour | 8 min |
| video.js | the intro movie (needs www/movies/intro.fhv, tools/transcode_video.py) | 1 min |

Results for the V8 build (OLED, 2026-11-04): docs/engine-alternatives.md.
