// Which parallel/common events cost the commands on a heavy map? Per event: updates, commands executed, and the head of its list.
globalThis.__maps = [globalThis.__pmap || 93]; globalThis.__nx.loadScript("tests/bench_maps.js");
(function (g) {
  const stats = new Map(); let cur = null, on = false;
  const GE = g.Game_Event.prototype, up = GE.updateParallel;
  GE.updateParallel = function () { if (!on) return up.apply(this, arguments); cur = "ev" + this._eventId + "p" + this._pageIndex; const r = up.apply(this, arguments); cur = null; return r; };
  const GC = g.Game_CommonEvent.prototype, cu = GC.update;
  GC.update = function () { if (!on) return cu.apply(this, arguments); cur = "ce" + this._commonEventId; const r = cu.apply(this, arguments); cur = null; return r; };
  const ec = g.Game_Interpreter.prototype.executeCommand;
  g.Game_Interpreter.prototype.executeCommand = function () {
    if (on && cur) { let s = stats.get(cur); if (!s) stats.set(cur, s = { n: 0, codes: {}, list: this._list }); s.n++; const c = this.currentCommand(); if (c) { const k = c.code === 111 ? "111t" + c.parameters[0] + (c.parameters[0] === 4 ? "s" + c.parameters[2] : "") : c.code; s.codes[k] = (s.codes[k] || 0) + 1; } }
    return ec.apply(this, arguments);
  };
  const o = g.__tick; let t0 = 0, done = false;
  g.__tick = function (t) { o(t); const sc = SceneManager._scene && SceneManager._scene.constructor.name;
    if (!t0 && sc === "Scene_Map" && $gameMap && $gameMap.mapId() === (g.__pmap || 93)) t0 = __nx.now() + 5000;
    if (t0 && !on && !done && __nx.now() > t0) on = true, g.__pf = __nx.now();
    if (on && !done && __nx.now() - g.__pf > 6000) { done = true; on = false; let tot = 0; for (const s of stats.values()) tot += s.n;
      __nx.log("[par] total commands " + tot + " across " + stats.size + " events");
      [...stats.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 25).forEach(([k, s]) => __nx.log("[par] " + k + " n=" + s.n + " len=" + (s.list ? s.list.length : "?") + " " + Object.entries(s.codes).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c, v]) => c + "x" + v).join(" ")));
    } };
})(globalThis);
