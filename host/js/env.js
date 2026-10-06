// Browser shim for the MV engine on the native host. The native side provides `__nx`
// (log, now, readFile, readBinary, loadScript, gl, width, height); this file builds the DOM-ish
// globals PIXI and rpg_core expect on top of it. Canvas 2D is not implemented yet: getContext('2d')
// returns a no-op context so scripts that only touch it at load time keep running.
(function (g) {
  "use strict";
  const nx = g.__nx;
  g.window = g;
  g.self = g;
  g.global = undefined;

  const log = (...a) => nx.log(a.map(String).join(" "));
  g.console = { log, info: log, warn: log, error: log, debug: log };

  // ---- timers and animation frames, pumped from native once per frame via __tick ---------------
  let timers = [], nextTimer = 1, frameCbs = [];
  function addTimer(fn, ms, repeat, args) {
    const t = { id: nextTimer++, fn, due: nx.now() + Math.max(0, +ms || 0), ms: Math.max(1, +ms || 0), repeat, args };
    timers.push(t);
    return t.id;
  }
  g.setTimeout = (fn, ms, ...a) => addTimer(fn, ms, false, a);
  g.setInterval = (fn, ms, ...a) => addTimer(fn, ms, true, a);
  g.clearTimeout = g.clearInterval = (id) => { timers = timers.filter((t) => t.id !== id); };
  g.requestAnimationFrame = (cb) => { frameCbs.push(cb); return frameCbs.length; };
  g.cancelAnimationFrame = () => {};
  g.__tick = function (now) {
    const due = timers.filter((t) => t.due <= now);
    for (const t of due) {
      if (t.repeat) t.due = now + t.ms; else timers = timers.filter((x) => x !== t);
      t.fn(...t.args);
    }
    const cbs = frameCbs;
    frameCbs = [];
    for (const cb of cbs) cb(now);
  };
  Object.defineProperty(g, "performance", { value: { now: () => nx.now() }, configurable: true, writable: true });

  // ---- canvas / image ------------------------------------------------------------------------
  class Context2D {
    constructor(canvas) { this.canvas = canvas; this.fillStyle = "#000"; this.globalAlpha = 1; this.globalCompositeOperation = "source-over"; }
    measureText(t) { return { width: String(t).length * 8 }; }
    getImageData(x, y, w, h) { return { width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w * h * 4)) }; }
  }
  for (const m of ["fillRect", "clearRect", "strokeRect", "drawImage", "putImageData", "fillText", "strokeText", "save", "restore",
    "setTransform", "translate", "scale", "rotate", "beginPath", "closePath", "arc", "rect", "fill", "stroke", "clip", "moveTo", "lineTo"])
    Context2D.prototype[m] = function () {};
  Context2D.prototype.createLinearGradient = Context2D.prototype.createRadialGradient = () => ({ addColorStop() {} });

  class Canvas {
    constructor() { this._w = 300; this._h = 150; this._d = null; this.style = {}; this._ctx2d = null; }
    get width() { return this._w; }
    set width(v) { this._w = v | 0; this._d = null; }
    get height() { return this._h; }
    set height(v) { this._h = v | 0; this._d = null; }
    get _data() {                    // RGBA8 pixels, read by the native texture upload
      const n = this._w * this._h * 4;
      if (!this._d || this._d.byteLength !== n) this._d = new ArrayBuffer(n);
      return this._d;
    }
    getContext(type) {
      if (type === "webgl" || type === "experimental-webgl") return nx.gl;
      if (type === "2d") return this._ctx2d || (this._ctx2d = new Context2D(this));
      return null;
    }
    addEventListener() {}
    removeEventListener() {}
    getBoundingClientRect() { return { left: 0, top: 0, width: this._w, height: this._h }; }
    toDataURL() { return ""; }
  }
  g.HTMLCanvasElement = Canvas;
  g.HTMLImageElement = g.Image = class Image { constructor() { this.width = 0; this.height = 0; this.complete = false; } addEventListener() {} };
  g.HTMLVideoElement = function () {};
  g.WebGLRenderingContext = function () {};
  g.ImageData = function () {};

  // ---- document / navigator --------------------------------------------------------------------
  const element = (tag) => ({ tagName: String(tag).toUpperCase(), style: {}, children: [], appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null; } });
  g.document = {
    createElement: (tag) => (tag === "canvas" ? new Canvas() : element(tag)),
    createTextNode: (t) => ({ textContent: t }),
    getElementsByTagName: () => [element("head")],
    body: element("body"), head: element("head"), documentElement: element("html"),
    currentScript: { src: "" },
    fonts: { ready: Promise.resolve(), load: () => Promise.resolve(), add() {} },
    addEventListener() {}, removeEventListener() {}, visibilityState: "visible", title: "",
  };
  Object.defineProperty(g, "navigator", { value: { userAgent: "Mozilla/5.0 (Nintendo Switch) NX", platform: "NX", language: "en",
    getGamepads: () => [] }, configurable: true, writable: true });
  g.addEventListener = g.removeEventListener = () => {};
  g.innerWidth = nx.width;
  g.innerHeight = nx.height;
  g.devicePixelRatio = 1;

  const store = new Map();
  g.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); }, clear: () => store.clear() };

  // ---- XMLHttpRequest over the native file reader (data/*.json etc.) ----------------------------
  g.XMLHttpRequest = class XMLHttpRequest {
    constructor() { this.readyState = 0; this.status = 0; this.responseType = ""; this.response = null; this.responseText = ""; this._h = {}; }
    open(method, url) { this._url = url; this.readyState = 1; }
    overrideMimeType() {}
    setRequestHeader() {}
    send() {
      g.setTimeout(() => {
        const path = nx.root + "/" + this._url.replace(/^\.?\//, "");
        const bin = this.responseType === "arraybuffer";
        const body = bin ? nx.readBinary(path) : nx.readFile(path);
        this.readyState = 4;
        if (body === null) { this.status = 404; if (this.onerror) this.onerror({}); return; }
        this.status = 200;
        if (bin) this.response = body; else { this.responseText = body; this.response = body; }
        if (this.onreadystatechange) this.onreadystatechange();
        if (this.onload) this.onload({});
      }, 0);
    }
  };

  g.Blob = function () {};
  g.URL = { createObjectURL: () => "", revokeObjectURL() {} };
  g.FontFace = function () {};

  // ---- script loading ----------------------------------------------------------------------------
  g.__loadScript = function (rel) {
    document.currentScript = { src: rel };
    const ok = nx.loadScript(nx.root + "/" + rel);
    if (!ok) throw new Error("cannot load " + rel);
  };
})(globalThis);
