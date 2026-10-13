// Device-side coarse phase timing (few wrapped calls). Upload as sdmc:/switch/fh-nx/js/dev_extra.js to enable;
// logs "[coarse] ..." every 5 s of Scene_Map time: ms per tick spent in each phase.
(function (g) {
  const nx = g.__nx, acc = {}; let ticks = 0, last = 0;
  const wrap = (obj, name, label) => { const f = obj[name]; if (typeof f !== "function") return; obj[name] = function () { const a = nx.now(); try { return f.apply(this, arguments); } finally { acc[label] = (acc[label] || 0) + nx.now() - a; } }; };
  wrap(g.SceneManager, "renderScene", "render"); wrap(g.Graphics, "render", "Graphics.render");
  wrap(g.Scene_Map.prototype, "update", "Scene_Map.update");
  wrap(g.Game_Map.prototype, "update", "Game_Map.update"); wrap(g.Game_Map.prototype, "updateEvents", "updateEvents");
  wrap(g.Game_CommonEvent.prototype, "update", "commonEvent"); wrap(g.Game_Event.prototype, "updateParallel", "evParallel");
  wrap(g.Game_Interpreter.prototype, "update", "interp.update");
  const cnt = (obj, name, label) => { const f = obj[name]; if (typeof f !== "function") return; obj[name] = function () { acc["#" + label] = (acc["#" + label] || 0) + 1; return f.apply(this, arguments); }; };
  for (const m of ["refresh", "refreshIfNeeded", "setupStartingEvent", "updateScroll", "updateVehicles", "updateParallax", "updateInterpreter", "setupStartingMapEvent", "setupAutorunCommonEvent", "isEventRunning"]) if (g.Game_Map.prototype[m]) wrap(g.Game_Map.prototype, m, "GM." + m);
  cnt(g.Game_CommonEvent.prototype, "update", "CE.update calls"); cnt(g.Game_Event.prototype, "updateParallel", "evParallel calls"); cnt(g.Game_Event.prototype, "refresh", "Game_Event.refresh"); cnt(g.Game_Event.prototype, "update", "Game_Event.update(slow)"); cnt(g.Game_Event.prototype, "findProperPageIndex", "findProperPageIndex");
  wrap(g.Spriteset_Map.prototype, "update", "Spriteset_Map.update"); wrap(g.Game_Player.prototype, "update", "player");
  const co = g.Spriteset_Map.prototype.createLightmask;
  g.Spriteset_Map.prototype.createLightmask = function () { co.apply(this, arguments); const p = this._lightmask && Object.getPrototypeOf(this._lightmask); if (p && !p.__prof) { p.__prof = 1; wrap(p, "update", "Lightmask"); } };
  wrap(g.ShaderTilemap.prototype, "updateTransform", "tilemap.updateTransform"); wrap(g.PIXI.WebGLRenderer.prototype, "render", "PIXI.render");
  const o = g.__tick;
  g.__tick = function (t) { const a = nx.now(); o(t); const sc = g.SceneManager._scene;
    if (sc && sc.constructor.name === "Scene_Map") { ticks++; acc.tick = (acc.tick || 0) + nx.now() - a; if (!last) last = nx.now();
      if (nx.now() - last > 5000) { nx.log("[coarse] map " + g.$gameMap.mapId() + " per tick ms: " + Object.entries(acc).sort((x, y) => y[1] - x[1]).map(([k, v]) => k + "=" + (v / ticks).toFixed(k[0] === "#" ? 1 : 2)).join(" ")); for (const k in acc) acc[k] = 0; ticks = 0; last = nx.now(); } } };
})(globalThis);
