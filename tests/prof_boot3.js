// Which calls make up the big ticks during boot (title screen reached)? Wraps every function on DataManager/ImageManager/
// SceneManager/AudioManager/Graphics/PluginManager/Window_*/Scene_Boot/Scene_Title statics+prototypes (inclusive ms).
(function (g) {
  const acc = {}; let on = true;
  function wrapAll(obj, prefix) { for (const k of Object.getOwnPropertyNames(obj)) { const d = Object.getOwnPropertyDescriptor(obj, k); if (!d || !("value" in d) || typeof d.value !== "function" || /^(prototype|length|name|caller|arguments|constructor)$/.test(k)) continue; const f = d.value; obj[k] = function () { if (!on) return f.apply(this, arguments); const a = __nx.now(); try { return f.apply(this, arguments); } finally { const e = acc[prefix + k] || (acc[prefix + k] = { ms: 0, n: 0 }); e.ms += __nx.now() - a; e.n++; } }; } }
  for (const n of ["DataManager", "ImageManager", "SceneManager", "AudioManager", "Graphics", "PluginManager", "StorageManager", "ConfigManager", "TextManager", "BattleManager", "FontManager"]) if (g[n]) wrapAll(g[n], n + ".");
  for (const n of ["Scene_Boot", "Scene_Title", "Scene_Base", "Scene_Map"]) if (g[n]) wrapAll(g[n].prototype, n + ".");
  wrapAll(g.Bitmap, "Bitmap."); wrapAll(g.Bitmap.prototype, "Bitmap#"); wrapAll(g.PIXI.WebGLRenderer.prototype, "PIXI.R.");
  const o = g.__tick; let n = 0, shown = 0;
  g.__tick = function (t) { for (const k in acc) delete acc[k]; const a = __nx.now(); o(t); const d = __nx.now() - a; n++;
    const sc = SceneManager._scene ? SceneManager._scene.constructor.name : "-";
    if (d > 150 && shown < 8) { shown++; __nx.log("[boot3] tick " + n + " " + d.toFixed(0) + " ms scene " + sc + ": " + Object.entries(acc).sort((x, y) => y[1].ms - x[1].ms).slice(0, 10).map(([k, v]) => k + "=" + v.ms.toFixed(0) + "(" + v.n + ")").join(" ")); }
    if (sc === "Scene_Title") on = false; };
})(globalThis);
