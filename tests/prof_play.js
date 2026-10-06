// Plays through the pad to the opening narration (same path as the device runs), then profiles 6 s of it:
// inclusive time per engine/native function, per tick.
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
  for (const [o, n] of [[Scene_Map.prototype, "Scene_Map."], [Spriteset_Map.prototype, "Spriteset_Map."], [Spriteset_Base.prototype, "Spriteset_Base."], [Game_Map.prototype, "Game_Map."],
    [Game_Screen.prototype, "Game_Screen."], [Game_Interpreter.prototype, "Interp."], [Sprite.prototype, "Sprite."], [Sprite_Picture.prototype, "Sprite_Picture."],
    [Sprite_Character.prototype, "Sprite_Character."], [Tilemap.prototype, "Tilemap."], [ShaderTilemap.prototype, "ShaderTilemap."], [Window_Base.prototype, "Window_Base."],
    [Window_Message.prototype, "Window_Message."], [Window.prototype, "Window."], [Bitmap.prototype, "Bitmap."], [PIXI.WebGLRenderer.prototype, "PIXI.R."], [PIXI.Container.prototype, "PIXI.C."],
    [Game_Message.prototype, "Game_Message."], [Game_CharacterBase.prototype, "Game_CharBase."], [Game_Event.prototype, "Game_Event."]]) wrapAll(o, n);
  wrapAll(Graphics, "Graphics."); wrapAll(SceneManager, "SceneManager."); wrapAll(AudioManager, "Audio.");

  function deepWrap() {
    wrapAll(Game_Event.prototype, "Game_Event."); wrapAll(Game_Character.prototype, "Game_Character."); wrapAll(Game_CharacterBase.prototype, "Game_CharBase.");
    nx.log("[deep] wrappers installed");
  }
  const orig = g.__tick;
  g.__profiled = {};
  let step = 0, stepAt = 0, frames = 0, wall = 0, startOn = 0, done = false, lastLog = 0, t0 = now();
  g.__tick = function (t) {
    if (held && now() >= releaseAt) held = 0;
    const a = now();
    orig(t);
    const sc = SceneManager._scene ? SceneManager._scene.constructor.name : "-", n = now(), since = n - stepAt;
    const next = () => { step++; stepAt = n; };
    switch (step) {
      case 0: if (sc === "Scene_Title" && SceneManager._scene._commandWindow && SceneManager._scene._commandWindow.active) { if (!stepAt) stepAt = n; else if (n - stepAt > 1500) { press("A"); next(); } } break;
      case 1: if (sc === "Scene_Map" && since > 6000) { press("A"); next(); } break;
      case 2: if (sc === "Scene_Name" && since > 2000) { press("UP"); next(); } break;
      case 3: if (since > 600) { press("LEFT"); next(); } break;
      case 4: if (since > 600) { press("A"); next(); } break;
      case 5: if (sc === "Scene_Map" && $gameMessage.isChoice() && since > 3000) { nx.log("[play] game mode choice: A"); press("A"); next(); } break;
      case 6:
        if ($gameMessage.isChoice()) { if (n - (g.__lastA || 0) > 2500) { g.__lastA = n; nx.log("[play] choice: A"); press("A"); } }
        else if ($gameMessage.hasText() && since > 6000) { if (!g.__narr) g.__narr = n; else if (n - g.__narr > 2500) { nx.log("[play] narration on screen, advancing to the first playable map"); next(); } }
        break;
      case 7: {                                               // keep pressing A through the intro until the player can move on a real map
        if (n - (g.__lastA || 0) > 1200) { g.__lastA = n; press("A"); }
        const id = $gameMap ? $gameMap.mapId() : 0;
        if (id !== g.__lastMap) { g.__lastMap = id; nx.log("[play +" + ((n - t0) / 1000).toFixed(0) + "s] map " + id + " " + ($dataMapInfos[id] ? $dataMapInfos[id].name : "")); }
        const free = sc === "Scene_Map" && $gamePlayer.canMove() && !$gameMessage.hasText() && !$gameMap._interpreter.isRunning();
        if (free && !g.__profiled[id]) { if (!g.__free) g.__free = n; else if (n - g.__free > 3000) { g.__profiled[id] = true; g.__label = "map " + id + " " + ($dataMapInfos[id] ? $dataMapInfos[id].name : "") + " (" + $gameMap.events().length + " events)"; nx.log("[play] player is free: profiling " + g.__label); acc.clear(); frames = 0; wall = 0; done = false; on = true; startOn = n; if (id === 74 && !g.__deepDone) { g.__deepDone = true; deepWrap(); } } } else if (!free) g.__free = 0;
        break;
      }
      default: break;
    }
    if (on) { frames++; wall += now() - a; }
    if (on && !done && n - startOn > 6000) {
      done = true; on = false;
      nx.log("[prof6] === " + g.__label);
      nx.log("[prof6] " + frames + " ticks, avg tick " + (wall / frames).toFixed(2) + " ms (instrumented); inclusive ms/tick:");
      for (const [k, e] of [...acc.entries()].sort((x, y) => y[1].ms - x[1].ms).slice(0, g.__label && /map 74/.test(g.__label) ? 40 : 14))
        nx.log("[prof6] " + k.padEnd(38) + (e.ms / frames).toFixed(3).padStart(8) + " ms/tick " + (e.n / frames).toFixed(1).padStart(7) + " calls/tick");
    }
    if (n - lastLog > 8000) { lastLog = n; nx.log("[play +" + ((n - t0) / 1000).toFixed(0) + "s] step " + step + " scene " + sc + " msg " + $gameMessage.hasText() + " choice " + $gameMessage.isChoice()); }
  };
})(globalThis);
