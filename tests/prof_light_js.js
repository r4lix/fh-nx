// What does one Lightmask update on map 185 spend in JS built-ins? Counts calls to common String/RegExp/Array/Math/Number functions inside update.
globalThis.__maps = [185, 185]; globalThis.__nx.loadScript("tests/bench_maps.js");
(function (g) {
  const cnt = {}; let inUpd = 0, calls = 0;
  const hook = (obj, name, label) => { const f = obj[name]; if (typeof f !== "function") return; obj[name] = function () { if (inUpd) cnt[label] = (cnt[label] || 0) + 1; return f.apply(this, arguments); }; };
  for (const n of ["split", "toLowerCase", "substring", "substr", "slice", "search", "match", "replace", "indexOf", "charAt", "toString", "padStart", "concat"]) hook(String.prototype, n, "String." + n);
  for (const n of ["test", "exec"]) hook(RegExp.prototype, n, "RegExp." + n);
  for (const n of ["shift", "push", "slice", "indexOf", "concat", "join"]) hook(Array.prototype, n, "Array." + n);
  for (const n of ["floor", "sqrt", "random", "cos", "sin", "min", "max", "round", "abs", "pow"]) hook(Math, n, "Math." + n);
  hook(globalThis, "parseInt", "parseInt"); hook(globalThis, "Number", "Number"); hook(globalThis, "parseFloat", "parseFloat");
  const CP = Object.getPrototypeOf(document.createElement("canvas").getContext("2d"));
  for (const n of ["fillRect", "createRadialGradient", "createLinearGradient", "save", "restore", "drawImage", "beginPath", "arc", "fill", "clearRect", "getImageData"]) hook(CP, n, "2d." + n);
  hook(g.Bitmap.prototype, "radialgradientFillRect", "radialgradientFillRect"); hook(g.Bitmap.prototype, "radialgradientFillRect2", "radialgradientFillRect2"); hook(g.Bitmap.prototype, "fillRect", "Bitmap.fillRect");
  const co = g.Spriteset_Map.prototype.createLightmask;
  g.Spriteset_Map.prototype.createLightmask = function () { co.apply(this, arguments); const p = this._lightmask && Object.getPrototypeOf(this._lightmask); if (p && !p.__pj) { p.__pj = 1; const u = p.update; p.update = function () { inUpd++; calls++; try { return u.apply(this, arguments); } finally { inUpd--; } }; } };
  const o = g.__tick; let t0 = 0, d = false;
  g.__tick = function (t) { o(t); const sc = SceneManager._scene && SceneManager._scene.constructor.name;
    if (!t0 && sc === "Scene_Map" && $gameMap.mapId() === 185) t0 = __nx.now() + 5000;
    if (t0 && !d && __nx.now() > t0 + 3000) { d = true; __nx.log("[lj] " + calls + " updates; calls per update: " + Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 24).map(([k, v]) => k + "=" + (v / calls).toFixed(0)).join(" ")); } };
})(globalThis);
