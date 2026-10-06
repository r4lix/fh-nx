// How many Sprite.update calls per frame, and from which classes (steady state, first map)?
(function (g) {
  const nx = g.__nx, now = () => nx.now();
  let on = false;
  const counts = new Map(), time = new Map();
  const orig = Sprite.prototype.update;
  Sprite.prototype.update = function () {
    if (!on) return orig.apply(this, arguments);
    const k = this.constructor.name + (this.visible ? "" : " (hidden)");
    counts.set(k, (counts.get(k) || 0) + 1);
    return orig.apply(this, arguments);
  };
  const o2 = g.__tick; let started = false, t0 = 0, mapAt = 0, frames = 0, done = false, startOn = 0;
  g.__tick = function (t) {
    o2(t);
    const sc = SceneManager._scene ? SceneManager._scene.constructor.name : "-";
    if (!started && sc === "Scene_Title" && SceneManager._scene._commandWindow) { if (!t0) t0 = now(); if (now() - t0 > 2500) { started = true; SceneManager._scene.commandNewGame(); } }
    if (started && sc === "Scene_Map" && !mapAt) mapAt = now();
    if (mapAt && !on && now() - mapAt > 5000) { on = true; startOn = now(); }
    if (on) frames++;
    if (on && !done && now() - startOn > 4000) {
      done = true; on = false;
      nx.log("[prof5] Sprite.update calls per tick over " + frames + " ticks, by class:");
      for (const [k, n] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) nx.log("[prof5] " + k.padEnd(34) + (n / frames).toFixed(1).padStart(7));
      let total = 0; for (const n of counts.values()) total += n; nx.log("[prof5] total " + (total / frames).toFixed(1));
    }
  };
})(globalThis);
