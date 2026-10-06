globalThis.__bumpDbg = {}; globalThis.__idleDbg = { skipped: 0, ran: 0, verChanged: 0, cached: 0, pureButWrote: 0, stillRunning: 0, impure: {} };
__nx.loadScript("tests/bench_map74.js");
const _o = globalThis.__tick; let _t0 = 0, _done = false;
globalThis.__tick = function (t) { _o(t); const sc = SceneManager._scene && SceneManager._scene.constructor.name;
  if (!_t0 && sc === "Scene_Map" && $gameMap && $gameMap.mapId() === 74) { _t0 = __nx.now(); globalThis.__idleDbg = { skipped: 0, ran: 0, verChanged: 0, cached: 0, pureButWrote: 0, stillRunning: 0, impure: {} }; }
  if (_t0 && !_done && __nx.now() - _t0 > 9000) { _done = true; const d = globalThis.__idleDbg; __nx.log("[idle] skipped " + d.skipped + " ran " + d.ran + " (of which list unchanged but state changed: " + d.verChanged + ") cached " + d.cached + " pureButWrote " + d.pureButWrote + " stillRunning " + d.stillRunning);
    __nx.log("[bump] " + Object.entries(globalThis.__bumpDbg).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => k + "x" + v).join(" "));
    __nx.log("[idle] first impure command per run: " + Object.entries(d.impure).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => k + "x" + v).join(" ") + "  | stateVer " + globalThis.__stateVer); } };
