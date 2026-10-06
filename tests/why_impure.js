globalThis.__nx.loadScript("tests/bench_map74.js");
(function (g) {
  const res = {}; let on = false, cur = null;
  const GC = g.Game_CommonEvent.prototype, cu = GC.update;
  GC.update = function () { cur = this._commonEventId; const r = cu.apply(this, arguments); cur = null; return r; };
  const ec = g.Game_Interpreter.prototype.executeCommand;
  g.Game_Interpreter.prototype.executeCommand = function () {
    const was = this.__pure, c = this.currentCommand(); const r = ec.apply(this, arguments);
    if (on && was && !this.__pure && c) { const k = (cur||"?") + ":" + c.code + (c.code === 111 ? "t" + c.parameters[0] : "") + (c.code === 122 ? "o" + c.parameters[3] : "") + (c.code === 230 ? "w" + c.parameters[0] : "") + (c.code === 355 ? "[" + c.parameters[0].slice(0, 70) + "]" : ""); res[k] = (res[k] || 0) + 1; }
    return r; };
  const o = g.__tick; let t0 = 0, done = false;
  g.__tick = function (t) { o(t); const sc = SceneManager._scene && SceneManager._scene.constructor.name;
    if (!t0 && sc === "Scene_Map" && $gameMap && $gameMap.mapId() === 74) t0 = __nx.now() + 3000;
    if (t0 && !on && !done && __nx.now() > t0) on = true, g.__pf = __nx.now();
    if (on && !done && __nx.now() - g.__pf > 5000) { done = true; on = false; __nx.log("[why] " + Object.entries(res).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => k + "x" + v).join(" ")); } };
})(globalThis);
