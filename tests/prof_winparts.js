globalThis.__maps = [3, 93, 110]; globalThis.__nx.loadScript("tests/bench_transfer.js");
(function (g) {
  const acc = {}; let on = false, depth = 0;
  const wrap = (o, n, label) => { const f = o[n]; if (typeof f !== "function") return; o[n] = function () { if (!on) return f.apply(this, arguments); const a = __nx.now(); try { return f.apply(this, arguments); } finally { const e = acc[label] || (acc[label] = { ms: 0, n: 0 }); e.ms += __nx.now() - a; e.n++; } }; };
  for (const n of ["initialize", "_createAllParts", "_refreshAllParts", "_refreshBack", "_refreshFrame", "_refreshCursor", "_refreshArrows", "_refreshPauseSign", "updateTransform", "_updateCursor", "_updateContents", "_updateFilterArea"]) wrap(g.Window.prototype, n, "Window." + n);
  for (const n of ["initialize", "createContents", "loadWindowskin", "updateTone", "refresh", "resetFontSettings", "drawText", "standardPadding"]) wrap(g.Window_Base.prototype, n, "Window_Base." + n);
  wrap(g.Bitmap.prototype, "initialize", "Bitmap.initialize"); wrap(g.Bitmap.prototype, "_createCanvas", "Bitmap._createCanvas"); wrap(g.Bitmap.prototype, "_setDirty", "Bitmap._setDirty");
  wrap(g.Window_Message.prototype, "initialize", "Window_Message.initialize"); wrap(g.Window_Message.prototype, "createSubWindows", "WM.createSubWindows"); wrap(g.Window_Message.prototype, "initMembers", "WM.initMembers");
  wrap(g.Bitmap, "load", "Bitmap.load"); wrap(g.ImageManager, "loadSystem", "loadSystem"); wrap(g.Bitmap.prototype, "blt", "Bitmap.blt"); wrap(g.Bitmap.prototype, "bltImage", "Bitmap.bltImage");
  wrap(g.PIXI.Texture.prototype, "initialize", "x");
  const o = g.__tick; let edges = 0, was = false, done = false, target = 0;
  g.__tick = function (t) { o(t); const ph = !!(g.$gamePlayer && $gamePlayer.isTransferring && $gamePlayer.isTransferring());
    if (ph && !was) { edges++; if (edges === 3) { on = true; target = $gamePlayer._newMapId; for (const k in acc) delete acc[k]; } }
    was = ph;
    if (on && !done && !ph && SceneManager._scene.constructor.name === "Scene_Map" && $gameMap.mapId() === target && $gamePlayer.canMove()) { done = true; on = false; __nx.log("[wp] " + Object.entries(acc).sort((a, b) => b[1].ms - a[1].ms).slice(0, 18).map(([k, v]) => k + "=" + v.ms.toFixed(0) + "(" + v.n + ")").join("  ")); } };
})(globalThis);
