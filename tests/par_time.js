globalThis.__maps = [globalThis.__pmap || 93, globalThis.__pmap || 93]; globalThis.__nx.loadScript("tests/bench_maps.js");
(function (g) { let on = false; const acc = { upd: 0, updN: 0, par: 0, parN: 0, ce: 0, ceN: 0, interpUpd: 0, interpN: 0, tick: 0 };
  const GE = g.Game_Event.prototype, up = GE.update, upp = GE.updateParallel, GC = g.Game_CommonEvent.prototype, cu = GC.update, GI = g.Game_Interpreter.prototype, iu = GI.update;
  const now = () => __nx.now();
  GE.update = function () { if (!on) return up.apply(this, arguments); const a = now(); up.apply(this, arguments); acc.upd += now() - a; acc.updN++; };
  GE.updateParallel = function () { if (!on) return upp.apply(this, arguments); const a = now(); upp.apply(this, arguments); acc.par += now() - a; acc.parN++; };
  GC.update = function () { if (!on) return cu.apply(this, arguments); const a = now(); cu.apply(this, arguments); acc.ce += now() - a; acc.ceN++; };
  GI.update = function () { if (!on) return iu.apply(this, arguments); const a = now(); iu.apply(this, arguments); acc.interpUpd += now() - a; acc.interpN++; };
  const o = g.__tick; let t0 = 0, d = false, ticks = 0;
  g.__tick = function (t) { const a = now(); o(t); const sc = SceneManager._scene && SceneManager._scene.constructor.name;
    if (!t0 && sc === "Scene_Map" && $gameMap && $gameMap.mapId() === (g.__pmap || 93)) t0 = now() + 4000;
    if (t0 && !on && !d && now() > t0) { on = true; g.__pf = now(); }
    if (on) { ticks++; acc.tick += now() - a; if (now() - g.__pf > 5000) { on = false; d = true; __nx.log("[ptime] per tick ms: " + Object.entries(acc).map(([k, v]) => k + "=" + (v / ticks).toFixed(2)).join(" ")); } } };
})(globalThis);
