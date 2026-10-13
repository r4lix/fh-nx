// Where does one Lightmask update go on map 93 (PC)? Times the Bitmap ops the plugin calls vs the rest.
globalThis.__nx.loadScript("tests/bench_map74.js");
(function (g) {
  const acc = {}; let on = false, calls = 0, t0 = 0, done = false;
  const wrap = (o, n, label) => { const f = o[n]; if (typeof f !== "function") return; o[n] = function () { if (!on) return f.apply(this, arguments); const a = __nx.now(); try { return f.apply(this, arguments); } finally { acc[label] = (acc[label] || 0) + __nx.now() - a; } }; };
  for (const n of ["fillRect", "radialgradientFillRect", "radialgradientFillRect2", "clearRect", "blt", "_setDirty", "_createBaseTexture", "resize"]) wrap(g.Bitmap.prototype, n, "Bitmap." + n);
  const CP = Object.getPrototypeOf(document.createElement("canvas").getContext("2d"));
  for (const n of ["fillRect", "createRadialGradient", "fill", "arc", "drawImage", "putImageData", "getImageData", "clearRect"]) wrap(CP, n, "2d." + n);
  const co = g.Spriteset_Map.prototype.createLightmask;
  g.Spriteset_Map.prototype.createLightmask = function () { co.apply(this, arguments); const p = this._lightmask && Object.getPrototypeOf(this._lightmask); if (p && !p.__pf) { p.__pf = 1; const u = p.update; p.update = function () { if (on) calls++; const a = __nx.now(); try { return u.apply(this, arguments); } finally { if (on) acc.total = (acc.total || 0) + __nx.now() - a; } }; } };
  wrap(g.PIXI.BaseTexture.prototype, "update", "BaseTexture.update");
  const o = g.__tick;
  g.__tick = function (t) { o(t); const sc = SceneManager._scene && SceneManager._scene.constructor.name;
    if (!t0 && sc === "Scene_Map") t0 = __nx.now() + 4000;
    if (t0 && !on && !done && __nx.now() > t0) { on = true; g.__pf2 = __nx.now(); }
    if (on && !done && __nx.now() - g.__pf2 > 5000) { done = true; on = false; __nx.log("[light] " + calls + " updates; ms per update: " + Object.entries(acc).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + "=" + (v / calls).toFixed(2)).join(" ")); } };
})(globalThis);
