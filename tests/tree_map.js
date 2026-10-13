// Self-time of update() per class in the spriteset display tree on map 74 (nested time subtracted).
globalThis.__maps = [globalThis.__pmap || 93]; globalThis.__nx.loadScript("tests/bench_maps.js");
(function (g) {
  const self = new Map(), cnt = new Map(); let on = false, t0 = 0, done = false, ticks = 0, stack = [];
  const hooked = new Set();
  function hook(o) {
    if (!o || typeof o.update !== "function" || Object.prototype.hasOwnProperty.call(o, "__h")) return;
    const f = o.update, k = o.constructor.name + (o === g.SceneManager._scene._spriteset ? "(spriteset)" : "");
    o.__h = 1;
    o.update = function () { if (!on) return f.apply(this, arguments); const a = __nx.now(); stack.push(0); try { return f.apply(this, arguments); } finally { const el = __nx.now() - a, nested = stack.pop(); self.set(k, (self.get(k) || 0) + el - nested); cnt.set(k, (cnt.get(k) || 0) + 1); if (stack.length) stack[stack.length - 1] += el; } };
  }
  function walk(o, d) { hook(o); if (d < 6 && o.children) for (const c of o.children) walk(c, d + 1); }
  const o = g.__tick;
  g.__tick = function (t) { o(t); const sc = SceneManager._scene && SceneManager._scene.constructor.name;
    if (sc === "Scene_Map" && SceneManager._scene._spriteset) walk(SceneManager._scene._spriteset, 0);
    if (!t0 && sc === "Scene_Map" && $gameMap && $gameMap.mapId() === (g.__pmap || 93)) t0 = __nx.now() + 5000;
    if (t0 && !on && !done && __nx.now() > t0) { on = true; g.__pf = __nx.now(); }
    if (on) ticks++;
    if (on && !done && __nx.now() - g.__pf > 5000) { done = true; on = false; __nx.log("[tree] " + [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => k + "=" + (v / ticks).toFixed(2) + "ms(" + (cnt.get(k) / ticks).toFixed(0) + ")").join("  ")); } };
})(globalThis);
