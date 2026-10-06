// Profile a loaded save (build/save from an earlier scripted run): Continue -> file 1 -> wait for control,
// then deep-profile for 8 s. Fast way back into a slow map without replaying the intro.
(function (g) {
  const nx = g.__nx, now = () => nx.now();
  const BIT = { A: 0, B: 1, X: 2, Y: 3, LEFT: 12, UP: 13, RIGHT: 14, DOWN: 15 };
  let held = 0, releaseAt = 0;
  nx.pad = () => [held >>> 0, 0, 0, 0, 0, 0];
  const press = (name, ms) => { held |= 1 << BIT[name]; releaseAt = now() + (ms || 120); };
  const acc = new Map(); let on = false;
  function wrapAll(obj, prefix) {
    for (const k of Object.getOwnPropertyNames(obj)) {
      const d = Object.getOwnPropertyDescriptor(obj, k);
      if (!d || !("value" in d) || typeof d.value !== "function" || /^(prototype|length|name|caller|arguments|constructor)$/.test(k)) continue;
      const f = d.value;
      obj[k] = function () { if (!on) return f.apply(this, arguments); const t = now(); try { return f.apply(this, arguments); } finally { const e = acc.get(prefix + k) || { ms: 0, n: 0 }; e.ms += now() - t; e.n++; acc.set(prefix + k, e); } };
    }
  }
  wrapAll(Object.getPrototypeOf(document.createElement("canvas").getContext("2d")), "2d.");
  for (const [o, n] of [[Game_Map.prototype, "Game_Map."], [Game_Event.prototype, "Game_Event."], [Game_Character.prototype, "Game_Character."], [Game_CharacterBase.prototype, "Game_CharBase."],
    [Game_Interpreter.prototype, "Interp."], [Sprite_Character.prototype, "Sprite_Character."], [Sprite.prototype, "Sprite."], [Tilemap.prototype, "Tilemap."], [Spriteset_Map.prototype, "Spriteset_Map."],
    [Scene_Map.prototype, "Scene_Map."], [PIXI.WebGLRenderer.prototype, "PIXI.R."], [PIXI.Container.prototype, "PIXI.C."]]) wrapAll(o, n);
  wrapAll(Graphics, "Graphics."); wrapAll(SceneManager, "SceneManager.");
  const orig = g.__tick; let step = 0, stepAt = 0, frames = 0, wall = 0, startOn = 0, done = false, lastLog = 0;
  g.__tick = function (t) {
    if (held && now() >= releaseAt) held = 0;
    const a = now();
    orig(t);
    const sc = SceneManager._scene ? SceneManager._scene.constructor.name : "-", n = now();
    const win = SceneManager._scene && SceneManager._scene._commandWindow;
    switch (step) {
      case 0: if (sc === "Scene_Title" && win && win.active) { if (!stepAt) stepAt = n; else if (n - stepAt > 1500) { nx.log("[load] title: A (Continue)"); press("A"); step = 1; stepAt = n; } } break;
      case 1: if (sc === "Scene_Load" && n - stepAt > 2500) { nx.log("[load] file list: A"); press("A"); step = 2; stepAt = n; } break;
      case 2: if (sc === "Scene_Map" && $gamePlayer.canMove() && !$gameMessage.hasText() && !$gameMap._interpreter.isRunning()) { if (n - stepAt > 4000) { step = 3; stepAt = n; nx.log("[load] map " + $gameMap.mapId() + " " + ($dataMapInfos[$gameMap.mapId()] ? $dataMapInfos[$gameMap.mapId()].name : "") + ", " + $gameMap.events().length + " events: profiling"); on = true; startOn = n; } } break;
    }
    if (on) { frames++; wall += now() - a; }
    if (on && !done && n - startOn > 8000) {
      done = true; on = false;
      nx.log("[prof7] " + frames + " ticks, avg tick " + (wall / frames).toFixed(1) + " ms; inclusive ms/tick (top 44):");
      for (const [k, e] of [...acc.entries()].sort((x, y) => y[1].ms - x[1].ms).slice(0, 44))
        nx.log("[prof7] " + k.padEnd(40) + (e.ms / frames).toFixed(2).padStart(9) + " ms/tick " + (e.n / frames).toFixed(1).padStart(8) + " calls/tick");
    }
    if (n - lastLog > 8000) { lastLog = n; nx.log("[load +" + step + "] scene " + sc); }
  };
})(globalThis);
