globalThis.__maps = [3, 93, 110]; globalThis.__nx.loadScript("tests/bench_transfer.js");
(function (g) {
  const acc = {}; let on = false;
  for (const k of Object.getOwnPropertyNames(g)) { if (!/^(Window_|Sprite_|Spriteset_)/.test(k)) continue; const C = g[k]; if (typeof C !== "function" || !C.prototype || !Object.prototype.hasOwnProperty.call(C.prototype, "initialize")) continue;
    const f = C.prototype.initialize; C.prototype.initialize = function () { if (!on) return f.apply(this, arguments); const a = __nx.now(); try { return f.apply(this, arguments); } finally { const e = acc[k] || (acc[k] = { ms: 0, n: 0 }); e.ms += __nx.now() - a; e.n++; } }; }
  const o = g.__tick; let edges = 0, was = false, done = false, target = 0;
  g.__tick = function (t) { o(t); const ph = !!(g.$gamePlayer && $gamePlayer.isTransferring && $gamePlayer.isTransferring());
    if (ph && !was) { edges++; if (edges === 3) { on = true; target = $gamePlayer._newMapId; for (const k in acc) delete acc[k]; } }
    was = ph;
    if (on && !done && !ph && SceneManager._scene.constructor.name === "Scene_Map" && $gameMap.mapId() === target && $gamePlayer.canMove()) { done = true; on = false; __nx.log("[win] " + Object.entries(acc).sort((a, b) => b[1].ms - a[1].ms).slice(0, 14).map(([k, v]) => k + "=" + v.ms.toFixed(0) + "(" + v.n + ")").join("  ")); } };
})(globalThis);
