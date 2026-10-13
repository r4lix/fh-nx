globalThis.__maps = [globalThis.__pmap || 93, globalThis.__pmap || 93]; globalThis.__nx.loadScript("tests/bench_maps.js");
(function (g) { const o = g.__tick; let t0 = 0, d = false, ticks = 0;
  g.__tick = function (t) { o(t); const sc = SceneManager._scene && SceneManager._scene.constructor.name;
    if (!t0 && sc === "Scene_Map" && $gameMap && $gameMap.mapId() === (g.__pmap || 93)) t0 = __nx.now() + 4000;
    if (t0 && !g.__pdbg && __nx.now() > t0) { g.__pdbg = { skip: 0, fresh: 0, freshDirty: 0, freshSame: 0, cont: 0 }; g.__pf = __nx.now(); }
    if (g.__pdbg && !d) { ticks++; if (__nx.now() - g.__pf > 5000) { d = true; const p = g.__pdbg; g.__pdbg = null; __nx.log("[pdbg] per tick: " + Object.entries(p).map(([k, v]) => k + "=" + (v / ticks).toFixed(1)).join(" ")); } } };
})(globalThis);
