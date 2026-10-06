// Steady-state frame cost in the first map: where does one Scene_Map frame go? Wraps engine, Terrax and
// native canvas calls, then reports per-frame averages over a 6 s window once the map is running.
(function (g) {
  const nx = g.__nx, now = () => nx.now();
  const acc = new Map();
  let on = false;
  function wrapAll(obj, prefix) {
    for (const k of Object.getOwnPropertyNames(obj)) {
      const d = Object.getOwnPropertyDescriptor(obj, k);
      if (!d || !("value" in d) || typeof d.value !== "function" || /^(prototype|length|name|caller|arguments|constructor)$/.test(k)) continue;
      const f = d.value;
      obj[k] = function () { if (!on) return f.apply(this, arguments); const t = now(); try { return f.apply(this, arguments); } finally { const e = acc.get(prefix + k) || { ms: 0, n: 0 }; e.ms += now() - t; e.n++; acc.set(prefix + k, e); } };
    }
  }
  wrapAll(Object.getPrototypeOf(document.createElement("canvas").getContext("2d")), "2d.");
  const protos = [[Scene_Map.prototype, "Scene_Map."], [Spriteset_Map.prototype, "Spriteset_Map."], [Game_Map.prototype, "Game_Map."],
    [Game_Player.prototype, "Game_Player."], [Game_Event.prototype, "Game_Event."], [Game_CharacterBase.prototype, "Game_CharBase."],
    [Sprite_Character.prototype, "Sprite_Character."], [Sprite.prototype, "Sprite."], [Tilemap.prototype, "Tilemap."], [ShaderTilemap.prototype, "ShaderTilemap."],
    [Bitmap.prototype, "Bitmap."], [Window_Base.prototype, "Window_Base."], [Game_Interpreter.prototype, "Interp."], [PIXI.WebGLRenderer.prototype, "PIXI.R."], [PIXI.Container.prototype, "PIXI.C."]];
  if (typeof Lightmask !== "undefined") protos.push([Lightmask.prototype, "Lightmask."]);
  for (const [o, n] of protos) wrapAll(o, n);
  wrapAll(Graphics, "Graphics."); wrapAll(SceneManager, "SceneManager.");
  const orig = g.__tick; let started = false, t0 = 0, mapAt = 0, frames = 0, wall = 0, done = false, startOn = 0;
  g.__tick = function (t) {
    const a = now();
    orig(t);
    const sc = SceneManager._scene ? SceneManager._scene.constructor.name : "-";
    if (!started && sc === "Scene_Title" && SceneManager._scene._commandWindow) { if (!t0) t0 = now(); if (now() - t0 > 2500) { started = true; SceneManager._scene.commandNewGame(); } }
    if (started && sc === "Scene_Map" && !mapAt) mapAt = now();
    if (mapAt && !on && now() - mapAt > 5000) { on = true; startOn = now(); }
    if (on) { frames++; wall += now() - a; }
    if (on && !done && now() - startOn > 6000) {
      done = true; on = false;
      nx.log("[prof4] " + frames + " ticks measured, avg tick " + (wall / frames).toFixed(2) + " ms; top functions, ms per tick (inclusive):");
      for (const [k, e] of [...acc.entries()].sort((x, y) => y[1].ms - x[1].ms).slice(0, 32))
        nx.log("[prof4] " + k.padEnd(40) + (e.ms / frames).toFixed(3).padStart(8) + " ms/tick  " + (e.n / frames).toFixed(1).padStart(7) + " calls/tick");
    }
  };
})(globalThis);
