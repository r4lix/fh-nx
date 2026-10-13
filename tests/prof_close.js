
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
  for (const [o2, n, l] of [[g.Scene_Map.prototype, "terminate", "Scene_Map.terminate"], [g.Scene_Map.prototype, "stop", "Scene_Map.stop"], [g.Scene_Base.prototype, "terminate", "Scene_Base.terminate"], [g.Scene_Base.prototype, "stop", "Scene_Base.stop"], [g.Scene_Base.prototype, "initialize", "Scene_Base.initialize"], [g.Scene_Map.prototype, "initialize", "Scene_Map.initialize"], [g.Scene_Map.prototype, "createWindowLayer", "createWindowLayer"], [g.Scene_Base.prototype, "createWindowLayer", "Scene_Base.createWindowLayer"], [g.Spriteset_Map.prototype, "destroy", "Spriteset.destroy"], [g.Spriteset_Base.prototype, "destroy", "SpritesetBase.destroy"], [g.PIXI.Container.prototype, "destroy", "Container.destroy"], [g.PIXI.Container.prototype, "removeChildren", "removeChildren"], [g.PIXI.Sprite.prototype, "destroy", "Sprite.destroy"], [g.Graphics, "_updateRealScale", "x"], [g.Scene_Map.prototype, "isReady", "Scene_Map.isReady"], [g.Scene_Base.prototype, "isReady", "Scene_Base.isReady"], [g.Scene_Map.prototype, "isMapTouchOk", "x2"], [g.SceneManager, "terminate", "SM.terminate"], [g.Game_Map.prototype, "update", "Game_Map.update"], [g.Bitmap.prototype, "destroy", "Bitmap.destroy"], [g.ImageManager, "clear", "ImageManager.clear"], [g.ImageManager, "releaseReservation", "releaseReservation"], [g.Scene_Map.prototype, "create", "Scene_Map.create"], [g.Scene_Map.prototype, "start", "Scene_Map.start"], [g.Scene_Map.prototype, "update", "Scene_Map.update"], [g.PIXI.WebGLRenderer.prototype, "render", "PIXI.render"], [g.PIXI.TextureManager ? g.PIXI.TextureManager.prototype : {}, "updateTexture", "tex.update"]]) wrap(o2, n, l);
  const nx = g.__nx, now = () => nx.now();
  let held = 0, releaseAt = 0; nx.pad = () => [held >>> 0, 0, 0, 0, 0, 0];
  const press = () => { held |= 1; releaseAt = now() + 120; };
  const o = g.__tick; let step = 0, stepAt = 0, phase = "", shown = 0;
  g.__tick = function (t) { if (held && now() >= releaseAt) held = 0; for (const k in acc) delete acc[k]; const a = now(); o(t); const d = now() - a, sc = SceneManager._scene ? SceneManager._scene.constructor.name : "-", n = now();
    const win = SceneManager._scene && SceneManager._scene._commandWindow;
    if (step === 0 && sc === "Scene_Title" && win && win.active) { if (!stepAt) stepAt = n; else if (n - stepAt > 1500) { press(); step = 1; stepAt = n; } }
    else if (step === 1 && sc === "Scene_Load" && n - stepAt > 2500) { press(); step = 2; stepAt = n; }
    else if (step === 2 && sc === "Scene_Map" && $gamePlayer.canMove() && n - stepAt > 4000) { step = 3; phase = "open"; stepAt = n; }
    if (step === 3) {
      if (d > 40 && on) nx.log("[close] " + d.toFixed(0) + " ms " + sc + ": " + Object.entries(acc).sort((x, y) => y[1].ms - x[1].ms).slice(0, 14).map(([k, v]) => k + "=" + v.ms.toFixed(0) + "(" + v.n + ")").join(" "));
      if (phase === "open") { SceneManager.push(Scene_Menu); phase = "wait"; stepAt = n; }
      else if (phase === "wait" && sc === "Scene_Menu" && n - stepAt > 2500) { SceneManager.pop(); phase = "closing"; on = true; stepAt = n; nx.log("[close] --- closing menu ---"); }
      else if (phase === "closing" && sc === "Scene_Map" && n - stepAt > 2500) { on = false; phase = "end"; }
    }
  };
})(globalThis);
