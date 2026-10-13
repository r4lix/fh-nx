globalThis.__maps = [3, 93, 110]; globalThis.__nx.loadScript("tests/bench_transfer.js");
(function (g) {
  const acc = {}; let on = false, depth = 0;
  const wrap = (o, n, label) => { const f = o[n]; if (typeof f !== "function") return; o[n] = function () { if (!on) return f.apply(this, arguments); const a = __nx.now(); depth++; try { return f.apply(this, arguments); } finally { depth--; const e = acc[label] || (acc[label] = { ms: 0, n: 0 }); e.ms += __nx.now() - a; e.n++; } }; };
  wrap(g.Scene_Map.prototype, "create", "Scene_Map.create"); wrap(g.Scene_Map.prototype, "start", "Scene_Map.start"); wrap(g.Scene_Map.prototype, "createDisplayObjects", "createDisplayObjects");
  wrap(g.Scene_Map.prototype, "createSpriteset", "createSpriteset"); wrap(g.Scene_Map.prototype, "createAllWindows", "createAllWindows"); wrap(g.Scene_Map.prototype, "onMapLoaded", "onMapLoaded");
  wrap(g.Game_Map.prototype, "setup", "Game_Map.setup"); wrap(g.Game_Map.prototype, "setupEvents", "setupEvents"); wrap(g.Game_Player.prototype, "performTransfer", "performTransfer");
  wrap(g.Spriteset_Map.prototype, "createCharacters", "createCharacters"); wrap(g.Spriteset_Map.prototype, "createTilemap", "createTilemap"); wrap(g.Spriteset_Map.prototype, "loadTileset", "loadTileset"); wrap(g.Spriteset_Map.prototype, "createLightmask", "createLightmask");
  wrap(g.DataManager, "loadMapData", "loadMapData"); wrap(g.ImageManager, "loadBitmap", "ImageManager.loadBitmap"); wrap(g.JSON, "parse", "JSON.parse");
  wrap(g.Bitmap.prototype, "_onLoad", "Bitmap._onLoad"); wrap(g.Bitmap.prototype, "_requestImage", "Bitmap._requestImage");
  wrap(g.Sprite_Character.prototype, "initialize", "Sprite_Character.init"); wrap(g.Game_Event.prototype, "initialize", "Game_Event.init");
  wrap(g.Scene_Map.prototype, "fadeInForTransfer", "fadeIn"); wrap(g.SceneManager, "changeScene", "changeScene"); wrap(g.SceneManager, "goto", "goto");
  wrap(g.StorageManager, "load", "StorageManager.load"); wrap(g.Graphics, "render", "Graphics.render");
  wrap(g.Scene_Base.prototype, "update", "Scene_Base.update"); wrap(g.Scene_Map.prototype, "updateTransferPlayer", "updateTransferPlayer");
  const o = g.__tick; let edges = 0, was = false, done = false, target = 0;
  g.__tick = function (t) { o(t); const ph = !!(g.$gamePlayer && $gamePlayer.isTransferring && $gamePlayer.isTransferring());
    if (ph && !was) { edges++; if (edges === 3) { on = true; target = $gamePlayer._newMapId; for (const k in acc) delete acc[k]; } }
    was = ph;
    if (on && !done && !ph && SceneManager._scene.constructor.name === "Scene_Map" && $gameMap.mapId() === target && SceneManager._scene._spriteset && $gamePlayer.canMove()) { done = true; on = false; __nx.log("[xp] map " + target + ": " + Object.entries(acc).sort((a, b) => b[1].ms - a[1].ms).slice(0, 20).map(([k, v]) => k + "=" + v.ms.toFixed(0) + "(" + v.n + ")").join("  ")); } };
})(globalThis);
