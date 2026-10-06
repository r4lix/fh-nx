globalThis.__nx.loadScript("tests/bench_map74.js");
(function (g) { const o = g.__tick; let t0 = 0, done = false;
  g.__tick = function (t) { o(t); const sc = SceneManager._scene && SceneManager._scene.constructor.name;
    if (!t0 && sc === "Scene_Map" && $gameMap && $gameMap.mapId() === 74) { t0 = __nx.now() + 3000; }
    if (t0 && !g.__dbg && __nx.now() > t0) { g.__dbg = {}; g.__pf = __nx.now(); }
    if (g.__dbg && !done && __nx.now() - g.__pf > 5000) { done = true; __nx.log("[dbg] " + Object.entries(g.__dbg).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => k + "x" + v).join(" ")); } };
})(globalThis);
