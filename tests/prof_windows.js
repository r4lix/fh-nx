// What does creating the map scene's windows cost? Inclusive time per function, from New Game until the
// map is ready (the Scene_Map the player arrives in).
(function (g) {
  const nx = g.__nx, now = () => nx.now();
  const acc = new Map();
  function wrapAll(obj, prefix) {
    for (const k of Object.getOwnPropertyNames(obj)) {
      const d = Object.getOwnPropertyDescriptor(obj, k);
      if (!d || !("value" in d)) continue;                       // accessors (fillStyle etc.) are not functions to wrap
      const f = d.value;
      if (typeof f !== "function" || /^(prototype|length|name|caller|arguments|constructor)$/.test(k)) continue;
      obj[k] = function () { const t = now(); try { return f.apply(this, arguments); } finally { const e = acc.get(prefix + k) || { ms: 0, n: 0 }; e.ms += now() - t; e.n++; acc.set(prefix + k, e); } };
    }
  }
  const proto = Object.getPrototypeOf(document.createElement("canvas").getContext("2d"));
  wrapAll(proto, "2d.");
  for (const [o, n] of [[Window.prototype, "Window."], [Window_Base.prototype, "Window_Base."], [Window_Message.prototype, "Window_Message."],
    [Bitmap.prototype, "Bitmap."], [Sprite.prototype, "Sprite."], [Scene_Map.prototype, "Scene_Map."]]) wrapAll(o, n);
  const orig = g.__tick; let started = false, done = false, t0 = 0, mapAt = 0;
  g.__tick = function (t) {
    orig(t);
    const sc = SceneManager._scene ? SceneManager._scene.constructor.name : "-";
    if (!started && sc === "Scene_Title" && SceneManager._scene._commandWindow) { if (!t0) t0 = now(); if (now() - t0 > 2500) { started = true; acc.clear(); SceneManager._scene.commandNewGame(); } }
    if (started && sc === "Scene_Map" && !mapAt) mapAt = now();
    if (mapAt && !done && now() - mapAt > 3000) {
      done = true;
      nx.log("[prof3] inclusive ms while entering the map (functions called, top 30):");
      for (const [k, e] of [...acc.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 30)) nx.log("[prof3] " + k.padEnd(40) + String(e.n).padStart(6) + " calls " + e.ms.toFixed(0).padStart(6) + " ms  avg " + (e.ms / e.n).toFixed(2));
    }
  };
})(globalThis);
