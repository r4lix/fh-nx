// Coarse phases (few wrapped calls => low overhead) on map 74.
globalThis.__maps = [globalThis.__pmap || 93]; globalThis.__nx.loadScript("tests/bench_maps.js");
(function (g) {
  const acc = {}; let on = false, ticks = 0, t0 = 0, done = false;
  const wrap = (obj, name, label) => { const f = obj[name]; obj[name] = function () { if (!on) return f.apply(this, arguments); const a = __nx.now(); try { return f.apply(this, arguments); } finally { acc[label] = (acc[label] || 0) + __nx.now() - a; } }; };
  wrap(Game_Map.prototype, "updateEvents", "mapEvents");
  wrap(Game_Map.prototype, "updateInterpreter", "mapInterp");
  wrap(Game_Map.prototype, "update", "Game_Map.update");
  wrap(Game_Player.prototype, "update", "player");
  wrap(Game_Followers.prototype, "update", "followers");
  wrap(Spriteset_Map.prototype, "update", "Spriteset_Map.update");
  wrap(Scene_Map.prototype, "update", "Scene_Map.update");
  wrap(Scene_Map.prototype, "updateMain", "Scene_Map.updateMain");
  wrap(Game_Screen.prototype, "update", "screen");
  wrap(Game_Timer.prototype, "update", "timer");
  wrap(SceneManager, "renderScene", "render");
  wrap(Scene_Base.prototype, "updateChildren", "updateChildren");
  wrap(Scene_Map.prototype, "updateScene", "Scene_Map.updateScene");
  wrap(Game_CommonEvent.prototype, "update", "commonEvent");
  wrap(Game_Event.prototype, "update", "Game_Event.update");
  wrap(Spriteset_Base.prototype, "update", "SpritesetBase.update");
  for (const m of ["updateTileset","updateParallax","updateShadow","updateWeather","updatePictures","updateTimer","updateScreenSprites","updateToneChanger","updateTonePicture","updatePosition","updateFlashSprite","updateFogs","updateOverlay"]) if (Spriteset_Map.prototype[m]) wrap(Spriteset_Map.prototype, m, "SM."+m); else if (Spriteset_Base.prototype[m]) wrap(Spriteset_Base.prototype, m, "SB."+m);
  wrap(Sprite_Picture.prototype, "update", "Sprite_Picture.update"); wrap(Sprite.prototype, "update", "Sprite.update"); wrap(Sprite_Timer.prototype, "update", "Sprite_Timer");
  wrap(PIXI.Container.prototype, "updateTransform", "updateTransform");
  wrap(Tilemap.prototype, "update", "Tilemap.update");
  wrap(Sprite_Character.prototype, "update", "Sprite_Character.update");
  wrap(Spriteset_Map.prototype, "updateTilemap", "updateTilemap");
  const o = g.__tick;
  g.__tick = function (t) { const a = __nx.now(); o(t); const sc = SceneManager._scene && SceneManager._scene.constructor.name;
    if (!t0 && sc === "Scene_Map" && $gameMap && $gameMap.mapId() === (g.__pmap || 93)) t0 = __nx.now() + 5000;
    if (t0 && !on && !done && __nx.now() > t0) { on = true; g.__pf = __nx.now(); acc.tick = 0; }
    if (on) { ticks++; acc.tick += __nx.now() - a; }
    if (on && !done && __nx.now() - g.__pf > 6000) { done = true; on = false;
      __nx.log("[coarse] " + Object.entries(acc).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + "=" + (v / ticks).toFixed(2)).join("  ")); } };
})(globalThis);
