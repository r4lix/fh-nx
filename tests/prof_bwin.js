globalThis.__troops = [2, 30]; globalThis.__nx.loadScript("tests/bench_battle.js");
(function (g) {
  const acc = {}; let on = false;
  for (const k of Object.getOwnPropertyNames(g)) { if (!/^(Window_|Sprite_|Spriteset_)/.test(k)) continue; const C = g[k]; if (typeof C !== "function" || !C.prototype || !Object.prototype.hasOwnProperty.call(C.prototype, "initialize")) continue;
    const f = C.prototype.initialize; C.prototype.initialize = function () { if (!on) return f.apply(this, arguments); const a = __nx.now(); try { return f.apply(this, arguments); } finally { const e = acc[k] || (acc[k] = { ms: 0, n: 0 }); e.ms += __nx.now() - a; e.n++; } }; }
  const wrap = (o, n, label) => { const f = o[n]; if (typeof f !== "function") return; o[n] = function () { if (!on) return f.apply(this, arguments); const a = __nx.now(); try { return f.apply(this, arguments); } finally { const e = acc[label] || (acc[label] = { ms: 0, n: 0 }); e.ms += __nx.now() - a; e.n++; } }; };
  wrap(g.Bitmap.prototype, "initialize", "Bitmap.initialize"); wrap(g.Window_Base.prototype, "createContents", "createContents"); wrap(g.Window.prototype, "_createAllParts", "_createAllParts"); wrap(g.Window_Base.prototype, "loadWindowskin", "loadWindowskin"); wrap(g.Window.prototype, "_refreshAllParts", "_refreshAllParts"); wrap(g.Window_Selectable.prototype, "refresh", "Selectable.refresh"); wrap(g.Window_Base.prototype, "drawText", "drawText"); wrap(g.Window_Base.prototype, "drawIcon", "drawIcon"); wrap(g.Bitmap.prototype, "drawText", "Bitmap.drawText"); wrap(g.Bitmap.prototype, "blt", "Bitmap.blt");
  let battleSeen = 0; const o = g.__tick; let was = "";
  g.__tick = function (t) { const sc = SceneManager._scene ? SceneManager._scene.constructor.name : "-"; if (sc !== was) { if (was === "Scene_Battle" && on) { battleSeen++; __nx.log("[bw] " + Object.entries(acc).sort((a, b) => b[1].ms - a[1].ms).slice(0, 22).map(([k, v]) => k + "=" + v.ms.toFixed(0) + "(" + v.n + ")").join(" ")); on = false; for (const k in acc) delete acc[k]; } was = sc; }
    if (!on && sc === "Scene_Map" && SceneManager._nextScene && SceneManager._nextScene.constructor.name === "Scene_Battle") on = true;
    if (SceneManager._nextScene && SceneManager._nextScene.constructor.name === "Scene_Battle") on = true; o(t); };
})(globalThis);
