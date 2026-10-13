globalThis.__maps = [93, 3]; globalThis.__nx.loadScript("tests/bench_transfer.js");
(function (g) { const f = g.StorageManager.load; const c = new Map(); let on = false;
  g.StorageManager.load = function (id) { if (on) { const st = String(new Error().stack).split("\n").slice(1, 6).map(l => l.trim().replace(/\(.*[\/]/, "(")).join(" < "); const k = id + " " + st; const e = c.get(k) || { n: 0, ms: 0 }; const a = __nx.now(); try { return f.apply(this, arguments); } finally { e.n++; e.ms += __nx.now() - a; c.set(k, e); } } return f.apply(this, arguments); };
  const o = g.__tick; let d = false;
  g.__tick = function (t) { o(t); if (g.$gamePlayer && $gamePlayer.isTransferring && $gamePlayer.isTransferring() && !d) on = true;
    if (on && !d && SceneManager._scene.constructor.name === "Scene_Map" && !$gamePlayer.isTransferring() && $gameMap.mapId() === 93) { d = true; on = false; for (const [k, v] of [...c.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 5)) __nx.log("[sl] " + v.n + "x " + v.ms.toFixed(0) + "ms " + k.slice(0, 380)); } };
})(globalThis);
