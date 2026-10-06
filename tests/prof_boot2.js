// Inclusive time of every DataManager / Scene_Boot / PluginManager function while booting to the title.
(function (g) {
  const nx = g.__nx, now = () => nx.now();
  const acc = new Map();
  function wrapAll(obj, prefix) {
    for (const k of Object.getOwnPropertyNames(obj)) {
      const f = obj[k];
      if (typeof f !== "function" || /^(prototype|length|name|caller|arguments)$/.test(k)) continue;
      obj[k] = function () { const t = now(); try { return f.apply(this, arguments); } finally { const e = acc.get(prefix + k) || { ms: 0, n: 0 }; e.ms += now() - t; e.n++; acc.set(prefix + k, e); } };
    }
  }
  wrapAll(DataManager, "DataManager.");
  wrapAll(Scene_Boot.prototype, "Scene_Boot.");
  if (typeof Scene_PretitleMap !== "undefined") wrapAll(Scene_PretitleMap.prototype, "PretitleMap.");
  wrapAll(Scene_Map.prototype, "Scene_Map.");
  wrapAll(ImageManager, "ImageManager.");
  wrapAll(PluginManager, "PluginManager.");
  const orig = g.__tick; let done = false;
  g.__tick = function (t) {
    orig(t);
    const sc = SceneManager._scene ? SceneManager._scene.constructor.name : "-";
    if (!done && sc === "Scene_Title") {
      done = true;
      nx.log("[prof2] inclusive ms by function, boot to title:");
      for (const [k, e] of [...acc.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 22)) nx.log("[prof2] " + k.padEnd(44) + String(e.n).padStart(6) + " calls " + e.ms.toFixed(0).padStart(6) + " ms");
    }
  };
})(globalThis);
