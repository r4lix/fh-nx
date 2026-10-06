// Where does boot time go? Wraps the native/file/JSON primitives and reports totals at the title screen
// and again a few seconds into the first map.
(function (g) {
  const nx = g.__nx, now = () => nx.now();
  const acc = new Map();
  const note = (k, ms, extra) => { const e = acc.get(k) || { ms: 0, n: 0, bytes: 0 }; e.ms += ms; e.n++; e.bytes += extra || 0; acc.set(k, e); };
  function wrap(obj, name, label, bytesOf) {
    const f = obj[name];
    obj[name] = function () { const t = now(); const r = f.apply(this, arguments); note(label, now() - t, bytesOf ? bytesOf(r, arguments) : 0); return r; };
  }
  wrap(nx, "decodeImage", "PNG decode", (r, a) => (a[0] && a[0].byteLength) || 0);
  wrap(nx, "readFile", "readFile(text)", (r) => (r ? r.length : 0));
  wrap(nx, "readBinary", "readBinary", (r) => (r ? r.byteLength : 0));
  wrap(nx, "loadScript", "loadScript(eval)", null);
  wrap(nx.audio, "load", "audio.load", (r, a) => (a[0] && a[0].byteLength) || 0);
  wrap(JSON, "parse", "JSON.parse", (r, a) => (a[0] ? a[0].length : 0));
  wrap(nx, "surfaceResize", "canvas resize", null);
  wrap(nx, "createSurface", "createSurface", null);
  const reported = { title: false, map: false };
  const orig = g.__tick, t0 = now();
  let ticks = 0, tickMs = 0, tickMax = 0, mapAt = 0, started = false, titleAt = 0;
  function report(tag) {
    nx.log("[prof] ---- " + tag + " (+" + ((now() - t0) / 1000).toFixed(1) + "s)");
    for (const [k, e] of [...acc.entries()].sort((a, b) => b[1].ms - a[1].ms))
      nx.log("[prof] " + k.padEnd(18) + String(e.n).padStart(6) + " calls " + e.ms.toFixed(0).padStart(7) + " ms" + (e.bytes ? "  " + (e.bytes / 1048576).toFixed(1) + " MB" : ""));
    nx.log("[prof] ticks " + ticks + ", tick time total " + tickMs.toFixed(0) + " ms, worst tick " + tickMax.toFixed(0) + " ms");
  }
  g.__tick = function (t) {
    const a = now();
    orig(t);
    const d = now() - a; ticks++; tickMs += d; if (d > tickMax) tickMax = d;
    const sc = SceneManager._scene ? SceneManager._scene.constructor.name : "-";
    if (!reported.title && sc === "Scene_Title") { reported.title = true; titleAt = now(); report("at Scene_Title"); acc.clear(); ticks = 0; tickMs = 0; tickMax = 0; }
    if (reported.title && !started && now() - titleAt > 2500 && SceneManager._scene._commandWindow) { started = true; SceneManager._scene.commandNewGame(); }
    if (started && sc === "Scene_Map" && !mapAt) mapAt = now();
    if (mapAt && !reported.map && now() - mapAt > 5000) { reported.map = true; report("first 5 s of the map"); }
  };
})(globalThis);
