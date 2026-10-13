globalThis.__maps = [93, 93]; globalThis.__nx.loadScript("tests/bench_maps.js");
(function (g) { const o = g.__tick; let t0 = 0, d = false;
  g.__tick = function (t) { o(t); const sc = SceneManager._scene && SceneManager._scene.constructor.name;
    if (!t0 && sc === "Scene_Map" && $gameMap && $gameMap.mapId() === 93) t0 = __nx.now() + 6000;
    if (t0 && !d && __nx.now() > t0) { d = true; let ce = 0, ceS = 0, ceEv = 0, ceCached = 0, cePure = 0, ceRun = 0; const kinds = {};
      for (const c of $gameMap._commonEvents) { ce++; const it = c._interpreter; if (c.__sleep) ceS++; if (it) { if (it.__idleList) ceCached++; if (it.__ev) ceEv++; if (it._list) ceRun++; if (it.__idleRec) for (let i = 0; i < it.__idleRec.length; i += 3) kinds[it.__idleRec[i]] = (kinds[it.__idleRec[i]] || 0) + 1; } }
      let ev = 0, evS = 0, evCached = 0, evRun = 0; for (const e of $gameMap.events()) { const it = e._interpreter; if (it) { ev++; if (e.__sleep) evS++; if (it.__idleList) evCached++; if (it._list) evRun++; } }
      __nx.log("[sleep] CE total " + ce + " sleeping " + ceS + " cached " + ceCached + " ev-type " + ceEv + " running " + ceRun + " readKinds " + JSON.stringify(kinds) + " | events w/ interp " + ev + " sleeping " + evS + " cached " + evCached + " running " + evRun); } };
})(globalThis);
