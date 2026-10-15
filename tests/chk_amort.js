globalThis.__noAmort=0;// Amortization check: count position changes + stopCount/alertLock sums of all events over a fixed number of updates, with and without it.
globalThis.__maps = [93, 93]; globalThis.__nx.loadScript("tests/bench_maps.js");
(function (g) { const o = g.__tick; let t0 = 0, d = false, base = null;
  g.__tick = function (t) { o(t); const sc = SceneManager._scene && SceneManager._scene.constructor.name;
    if (!t0 && sc === "Scene_Map" && $gameMap.mapId() === 93) t0 = __nx.now() + 5000;
    if (t0 && !d && __nx.now() > t0 + 4000) { d = true; let sc2 = 0, al = 0, mv = 0, pg = 0, rest = 0, skipping = 0; for (const e of $gameMap.events()) { sc2 += e._stopCount; al += e._alertLock || 0; if (e._moveType !== 0) mv++; pg += e._pageIndex; if (e.__skip > 0) skipping++; if (e.__rs >= 24) rest++; }
      const h = {}; for (const e of $gameMap.events()) { const k = "skip" + (e.__skip | 0) + (e._interpreter ? "I" : ""); h[k] = (h[k] || 0) + 1; } __nx.log("[amort] hist " + JSON.stringify(h)); __nx.log("[amort] noAmort=" + !!g.__noAmort + " events " + $gameMap.events().length + " settled " + rest + " skipping-now " + skipping + " movers " + mv + " pageIdxSum " + pg); } };
})(globalThis);
