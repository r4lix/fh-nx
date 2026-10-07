// Sprite.update calls per tick by class on map 74 (loaded save), with inclusive ms.
globalThis.__nx.loadScript("tests/bench_map74.js");
(function (g) {
  const counts = new Map(), time = new Map(); let on = false, t0 = 0, done = false, ticks = 0;
  const orig = Sprite.prototype.update;
  Sprite.prototype.update = function () {
    if (!on) return orig.apply(this, arguments);
    const k = this.constructor.name + (this.visible ? "" : " (hidden)");
    counts.set(k, (counts.get(k) || 0) + 1);
    const a = __nx.now(); const r = orig.apply(this, arguments); time.set(k, (time.get(k) || 0) + __nx.now() - a); return r;
  };
  const o = g.__tick;
  g.__tick = function (t) { o(t); const sc = SceneManager._scene && SceneManager._scene.constructor.name;
    if (!t0 && sc === "Scene_Map" && $gameMap && $gameMap.mapId() === 74) t0 = __nx.now() + 3000;
    if (t0 && !on && !done && __nx.now() > t0) { on = true; g.__pf = __nx.now(); }
    if (on) ticks++;
    if (on && !done && __nx.now() - g.__pf > 5000) { done = true; on = false;
      for (const [k, v] of [...counts.entries()].sort((a, b) => b[1] - a[1])) __nx.log("[spr] " + k.padEnd(28) + (v / ticks).toFixed(1).padStart(7) + " calls/tick " + (time.get(k) / ticks).toFixed(2) + " ms/tick incl"); } };
})(globalThis);
