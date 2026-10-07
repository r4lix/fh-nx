globalThis.__nx.loadScript("tests/bench_map74.js");
(function (g) {
  let inUpd = 0, on = false; const stacks = new Map(); let t0 = 0, done = false;
  const sb = Spriteset_Base.prototype.update; Spriteset_Base.prototype.update = function () { inUpd++; try { return sb.apply(this, arguments); } finally { inUpd--; } };
  for (const C of [PIXI.Container, PIXI.DisplayObject, PIXI.Sprite]) { const f = C.prototype.updateTransform; if (!Object.prototype.hasOwnProperty.call(C.prototype, "updateTransform")) continue;
    C.prototype.updateTransform = function () { if (on && inUpd) { const st = new Error().stack.split("\n").slice(2, 7).map(l => l.trim().replace(/\(.*[\/]/, "(")).join(" < "); stacks.set(st, (stacks.get(st) || 0) + 1); } return f.apply(this, arguments); }; }
  const o = g.__tick;
  g.__tick = function (t) { o(t); const sc = SceneManager._scene && SceneManager._scene.constructor.name;
    if (!t0 && sc === "Scene_Map" && $gameMap && $gameMap.mapId() === 74) t0 = __nx.now() + 3000;
    if (t0 && !on && !done && __nx.now() > t0) { on = true; g.__pf = __nx.now(); }
    if (on && !done && __nx.now() - g.__pf > 2000) { done = true; on = false; [...stacks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).forEach(([k, v]) => __nx.log("[ut] " + v + "x " + k)); } };
})(globalThis);
