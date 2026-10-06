// Feasibility spike: load every MV script into QuickJS against a recording stub of the browser
// environment, in index.html order. Reports load time, heap use, errors, and every browser API
// the scripts touch at load time. Run:  qjs spike/load_mv.js <www dir>
import * as std from "qjs:std";
import * as os from "qjs:os";

const www = scriptArgs[1];
if (!www) { print("usage: qjs load_mv.js <www dir>"); std.exit(1); }

const touched = new Map();            // "document.createElement" -> count
const note = (path) => touched.set(path, (touched.get(path) || 0) + 1);

// A callable object that records every property read / call and hands back more stubs, so
// scripts keep running and we learn the surface they want.
function stub(path, seed) {
  const target = function () {};
  return new Proxy(target, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => 0;
      if (typeof k === "symbol") return undefined;
      if (seed && k in seed) return seed[k];
      if (k === "then") return undefined;
      if (k === "length") return 0;
      if (k === "toString" || k === "valueOf") return () => "";
      note(path + "." + k);
      return stub(path + "." + k);
    },
    set(t, k, v) { note(path + "." + String(k) + "=");
      Object.defineProperty(t, k, { value: v, writable: true, configurable: true }); return true; },
    apply() { return stub(path + "()"); },
    construct() { return stub("new " + path); },
  });
}

const g = globalThis;
const def = (k, v) => Object.defineProperty(g, k, { value: v, writable: true, configurable: true });
g.window = g;
g.self = g;
g.global = undefined;
def("navigator", stub("navigator", { userAgent: "Mozilla/5.0 (Nintendo Switch) NX", platform: "NX", language: "en" }));
g.document = stub("document", {
  createElement: (tag) => { note("document.createElement(" + tag + ")"); return stub("<" + tag + ">", { style: {}, width: 0, height: 0, getContext: () => stub("ctx2d") }); },
  getElementsByTagName: () => [stub("<head>")],
  body: stub("body", { style: {} }),
  addEventListener() {},
  fonts: stub("document.fonts"),
});
g.localStorage = stub("localStorage");
g.Image = function () { note("new Image"); };
g.XMLHttpRequest = function () { note("new XMLHttpRequest"); };
g.AudioContext = g.webkitAudioContext = function () { note("new AudioContext"); };
g.requestAnimationFrame = (f) => { note("requestAnimationFrame"); return 1; };
g.addEventListener = () => {};
def("performance", { now: () => Date.now() });
g.devicePixelRatio = 1;
g.innerWidth = 1280; g.innerHeight = 720;
g.WebGLRenderingContext = function () {};
g.HTMLCanvasElement = function () {};
g.HTMLElement = function () {};
g.Blob = function () {}; g.URL = { createObjectURL: () => "", revokeObjectURL() {} };
g.FontFace = function () {};
g.Float32Array = Float32Array;
g.nw = undefined;
g.require = undefined;
g.process = undefined;
g.Utils_NW = undefined;
g.$plugins = undefined;

function load(rel) {
  const src = std.loadFile(www + "/" + rel);
  if (src === null) { print("MISSING", rel); return { rel, ok: false, ms: 0, bytes: 0 }; }
  const t0 = Date.now();
  let ok = true, err = "";
  try { (0, eval)(src); } catch (e) { ok = false; err = String(e && e.stack ? e.message + " @ " + String(e.stack).split("\n")[0] : e); }
  return { rel, ok, ms: Date.now() - t0, bytes: src.length, err };
}

const order = ["js/libs/pixi.js", "js/libs/pixi-tilemap.js", "js/libs/pixi-picture.js", "js/libs/fpsmeter.js",
  "js/libs/lz-string.js", "js/libs/iphone-inline-video.browser.js",
  "js/rpg_core.js", "js/rpg_managers.js", "js/rpg_objects.js", "js/rpg_scenes.js", "js/rpg_sprites.js", "js/rpg_windows.js",
  "js/plugins.js"];

const results = order.map(load);
let total = 0, bytes = 0;
for (const r of results) {
  total += r.ms; bytes += r.bytes;
  print((r.ok ? "ok   " : "FAIL ") + r.rel.padEnd(40) + String(r.ms).padStart(5) + " ms " + String(r.bytes >> 10).padStart(5) + " KB" + (r.err ? "   " + r.err : ""));
}

// Now the plugins, in the order plugins.js lists them (enabled ones only).
let plugins = [];
try { plugins = g.$plugins || []; } catch (e) {}
print("\n$plugins entries:", plugins.length, " enabled:", plugins.filter((p) => p.status).length);
let pt = 0, pb = 0, pfail = 0;
const slow = [];
for (const p of plugins) {
  if (!p.status) continue;
  if (g.PluginManager) g.PluginManager.setParameters(p.name, p.parameters);   // what PluginManager.setup does
  const r = load("js/plugins/" + p.name + ".js");
  pt += r.ms; pb += r.bytes;
  if (!r.ok) { pfail++; print("FAIL plugin " + p.name + "  " + r.err); }
  slow.push([r.ms, p.name]);
}
slow.sort((a, b) => b[0] - a[0]);
print("plugins: " + pt + " ms, " + (pb >> 10) + " KB, failures " + pfail + "; slowest: " + slow.slice(0, 4).map((s) => s[1] + " " + s[0] + "ms").join(", "));
print("\nTOTAL load " + (total + pt) + " ms for " + ((bytes + pb) >> 10) + " KB of JS");

const mu = (std.getrusage ? std.getrusage() : null);
try { const m = os.getMemoryUsage ? os.getMemoryUsage() : null; if (m) print("memory", JSON.stringify(m)); } catch (e) {}
if (g.__qjs_mem) print(g.__qjs_mem);

print("\n--- browser APIs touched at load (top 60 of " + touched.size + ")");
const rows = [...touched.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60);
print(rows.map(([k, n]) => k + " x" + n).join("\n"));
