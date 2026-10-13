globalThis.__maps = [globalThis.__pmap || 93]; globalThis.__nx.loadScript("tests/bench_maps.js");
(function (g) { const o = g.__tick; let t0 = 0, d = false;
  g.__tick = function (t) { o(t); const sc = SceneManager._scene && SceneManager._scene.constructor.name;
    if (!t0 && sc === "Scene_Map" && $gameMap && $gameMap.mapId() === (g.__pmap || 93)) t0 = __nx.now() + 5000;
    if (t0 && !d && __nx.now() > t0) { d = true; const r = {}; let slow = 0, n = 0;
      for (const e of $gameMap.events()) { n++; const why = [];
        if (e._realX !== e._x || e._realY !== e._y) why.push("moving"); if (e._jumpCount > 0) why.push("jump"); if (e._stepAnime) why.push("stepAnime");
        if (e._animationCount !== 0) why.push("animCount"); if (e._pattern !== e._originalPattern) why.push("pattern"); if (e._moveRouteForcing) why.push("forcing");
        if (e._moveType !== 0) why.push("moveType" + e._moveType); if (e._trigger === 3) why.push("auto"); if (e._locked) why.push("locked");
        if (e._chasePlayer) why.push("chase"); if (e._fleePlayer) why.push("flee"); if (e._chaseRange > 0) why.push("chaseRange"); if (e._fleeRange > 0) why.push("fleeRange");
        if (e._returnPhase) why.push("return"); if (e._alertPlayer) why.push("alert");
        if (why.length) { slow++; const k = why.join("+"); r[k] = (r[k] || 0) + 1; } }
      __nx.log("[slow] events " + n + " slow " + slow + " : " + Object.entries(r).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => k + "x" + v).join(" ")); } };
})(globalThis);
