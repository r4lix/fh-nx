// Profile the title -> New Game transition: which engine and native calls eat the frame time.
(function (g) {
  const nx = g.__nx, now = () => nx.now();
  const acc = new Map();
  function wrap(obj, name, label) {
    const f = obj[name];
    if (typeof f !== "function") return;
    obj[name] = function () { const t = now(); try { return f.apply(this, arguments); } finally { const e = acc.get(label) || { ms: 0, n: 0 }; e.ms += now() - t; e.n++; acc.set(label, e); } };
  }
  // native canvas context methods
  const cv = document.createElement("canvas").getContext("2d"), proto = Object.getPrototypeOf(cv);
  for (const m of ["drawImage", "fillRect", "clearRect", "getImageData", "putImageData", "fillText", "strokeText", "measureText", "createLinearGradient"]) wrap(proto, m, "2d." + m);
  const hook = () => {
    wrap(Graphics, "render", "Graphics.render");
    wrap(SceneManager, "updateScene", "SceneManager.updateScene");
    wrap(SceneManager, "renderScene", "SceneManager.renderScene");
    wrap(Bitmap, "snap", "Bitmap.snap");
    wrap(Bitmap.prototype, "blt", "Bitmap.blt");
    wrap(Bitmap.prototype, "_setDirty", "Bitmap._setDirty");
    wrap(Sprite.prototype, "update", "Sprite.update");
    wrap(Sprite.prototype, "_refresh", "Sprite._refresh");
    wrap(ScreenSprite.prototype, "update", "ScreenSprite.update");
    wrap(Window.prototype, "update", "Window.update");
    wrap(Window.prototype, "_refreshAllParts", "Window._refreshAllParts");
    wrap(Tilemap.prototype, "update", "Tilemap.update");
    wrap(Tilemap.prototype, "_paintAllTiles", "Tilemap._paintAllTiles");
    wrap(ShaderTilemap.prototype, "_paintAllTiles", "ShaderTilemap._paintAllTiles");
    wrap(PIXI.WebGLRenderer.prototype, "render", "PIXI.render");
    wrap(Scene_Base.prototype, "update", "Scene_Base.update");
    wrap(Scene_Base.prototype, "updateFade", "Scene_Base.updateFade");
    wrap(Scene_Map.prototype, "update", "Scene_Map.update");
    wrap(Game_Map.prototype, "update", "Game_Map.update");
    wrap(Spriteset_Map.prototype, "update", "Spriteset_Map.update");
    wrap(Spriteset_Map.prototype, "createTilemap", "Spriteset_Map.createTilemap");
    wrap(Bitmap.prototype, "_createBaseTexture", "Bitmap._createBaseTexture");
    wrap(PIXI.BaseTexture.prototype, "update", "BaseTexture.update");
    wrap(PIXI.WebGLRenderer.prototype, "updateTexture", "PIXI.updateTexture");
  };
  hook();

  let started = false, startedAt = 0, ticks = [];
  const origTick = g.__tick;
  g.__tick = function (t) {
    const t0 = now();
    origTick(t);
    const dt = now() - t0;
    const sc = SceneManager._scene ? SceneManager._scene.constructor.name : "-";
    if (started) ticks.push([dt, sc]);
    if (!started && sc === "Scene_Title" && SceneManager._scene._commandWindow && now() - (g.__titleAt = g.__titleAt || now()) > 2500) {
      started = true; startedAt = now(); acc.clear();
      nx.log("[prof] triggering New Game");
      SceneManager._scene.commandNewGame();
    }
    if (started && now() - startedAt > 7000 && !g.__reported) {
      g.__reported = true;
      const slow = ticks.filter((x) => x[0] > 25);
      nx.log("[prof] " + ticks.length + " ticks, " + slow.length + " slower than 25 ms; worst " + Math.max(...ticks.map((x) => x[0])).toFixed(0) + " ms");
      const bySc = {};
      for (const [d, s] of ticks) { const e = bySc[s] || (bySc[s] = { n: 0, ms: 0, max: 0 }); e.n++; e.ms += d; e.max = Math.max(e.max, d); }
      for (const s in bySc) nx.log("[prof] scene " + s + ": " + bySc[s].n + " ticks, avg " + (bySc[s].ms / bySc[s].n).toFixed(1) + " ms, max " + bySc[s].max.toFixed(0));
      const rows = [...acc.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 18);
      for (const [k, e] of rows) nx.log("[prof] " + k.padEnd(28) + " total " + e.ms.toFixed(0).padStart(6) + " ms  calls " + String(e.n).padStart(6) + "  avg " + (e.ms / e.n).toFixed(2) + " ms");
    }
  };
})(globalThis);
