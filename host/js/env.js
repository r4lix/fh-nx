// Browser shim for the MV engine on the native host. The native side provides `__nx` (see
// nx_common.h, js_gl.c, js_canvas.c, main.c); this file builds the DOM-ish globals PIXI and
// rpg_core expect on top of it. Only what MV actually touches is implemented.
(function (g) {
  "use strict";
  const nx = g.__nx;
  g.window = g;
  g.self = g;
  g.global = undefined;

  const log = (...a) => nx.log(a.map(String).join(" "));
  g.console = { log, info: log, warn: log, error: log, debug: log, trace() {} };


  // ---- V8 compatibility: legacy RegExp.$1..$9 / lastMatch (YEP and many MV plugins read note tags
  // through them). Recorded on every successful exec, which match/test/replace/split all go through. ----
  (function () {
    let last = null;
    const origExec = RegExp.prototype.exec;
    RegExp.prototype.exec = function (str) {
      const m = origExec.call(this, str);
      if (m) last = m;
      return m;
    };
    for (let i = 1; i <= 9; i++) Object.defineProperty(RegExp, "$" + i, { get() { return last && last[i] !== undefined ? last[i] : ""; }, configurable: true });
    Object.defineProperty(RegExp, "lastMatch", { get() { return last ? last[0] : ""; }, configurable: true });
    Object.defineProperty(RegExp, "$&", { get() { return last ? last[0] : ""; }, configurable: true });
  })();

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
  g.__tick = function () {
    const now = nx.now();                          // always the clock timers were scheduled against, whatever the host passes
    const due = timers.filter((t) => t.due <= now);
    for (const t of due) {
      if (t.repeat) t.due = now + t.ms; else timers = timers.filter((x) => x !== t);
      try { t.fn(...t.args); } catch (e) { log("timer error: " + e + (e && e.stack ? " | " + e.stack : "")); }
    }
    const cbs = frameCbs;
    frameCbs = [];
    for (const cb of cbs) cb(now);
  };
  Object.defineProperty(g, "performance", { value: { now: () => nx.now() }, configurable: true, writable: true });

  // ---- canvas ---------------------------------------------------------------------------------
  // Pixels live in native surfaces; the 2D context is the native rasteriser. "The screen" is the canvas
  // that both asked for a WebGL context and was given a size by the renderer (PIXI also makes a throwaway
  // canvas to test WebGL support; that one is never sized, so it never counts). Its size is the logical
  // size the GL viewport maps from.
  let screenCanvas = null;
  class Canvas {
    constructor() { this._s = nx.createSurface(300, 150); this._w = 300; this._h = 150; this._ab = null; this._ctx = null; this.style = {}; this.id = ""; this._gl = false; this._sized = false; }
    get width() { return this._w; }
    set width(v) { this._w = v | 0; this._sized = true; this._resize(); }
    get height() { return this._h; }
    set height(v) { this._h = v | 0; this._sized = true; this._resize(); }
    _claimScreen() { screenCanvas = this; nx.gl.setLogicalSize(this._w, this._h); }
    _resize() {
      if (this._gl) { if (this._sized) this._claimScreen(); return; }       // the screen has no pixel store
      nx.surfaceResize(this._s, this._w, this._h);
      this._ab = null;
    }
    get _data() { return this._ab || (this._ab = nx.surfaceBuffer(this._s)); }   // live RGBA pixels, read by texImage2D
    getContext(type) {
      if (type === "webgl" || type === "experimental-webgl") {
        this._gl = true;
        if (this._sized) this._claimScreen();
        return nx.gl;
      }
      if (type === "2d") return this._ctx || (this._ctx = nx.createContext(this._s, this));
      return null;
    }
    addEventListener() {}
    removeEventListener() {}
    getBoundingClientRect() { return { left: 0, top: 0, width: this._w, height: this._h }; }
    toDataURL() { return ""; }
    appendChild() {}
  }
  g.HTMLCanvasElement = Canvas;

  // ---- Blob / object URLs / Image: MV's Decrypter turns an encrypted .rpgmvp into a Blob URL, then
  // sets it as an Image's src, so Image loading handles both blob: URLs and plain file paths ----------
  const blobs = new Map();
  let nextBlob = 1;
  g.Blob = class Blob { constructor(parts, opts) { this.parts = parts || []; this.type = (opts && opts.type) || ""; } };
  g.URL = { createObjectURL(b) { const u = "blob:" + nextBlob++; blobs.set(u, b); return u; }, revokeObjectURL(u) { blobs.delete(u); } };

  g.HTMLImageElement = g.Image = class Image {
    constructor() {
      this.width = this.height = this.naturalWidth = this.naturalHeight = 0;
      this.complete = false;
      this.onload = this.onerror = null;
      this._src = "";
      this._s = null;
      this._ab = null;
      this._l = {};
    }
    get src() { return this._src; }
    set src(v) {
      this._src = String(v);
      this.complete = false;
      g.setTimeout(() => this._load(this._src), 0);        // loads are asynchronous in a browser, and MV relies on it
    }
    get _data() { return this._ab || (this._ab = nx.surfaceBuffer(this._s)); }
    addEventListener(type, fn) { (this._l[type] || (this._l[type] = [])).push(fn); }
    removeEventListener(type, fn) { this._l[type] = (this._l[type] || []).filter((f) => f !== fn); }
    _fire(type) {
      const ev = { type, target: this };
      const h = this["on" + type];
      if (typeof h === "function") h.call(this, ev);
      for (const fn of (this._l[type] || []).slice()) fn.call(this, ev);
    }
    _load(url) {
      let bytes = null;
      if (url.startsWith("blob:")) {
        const b = blobs.get(url);
        if (b) bytes = b.parts[0];
      } else {
        bytes = nx.readBinary(nx.root + "/" + decodeURIComponent(url.split("?")[0]));
      }
      const r = bytes ? nx.decodeImage(bytes) : null;
      if (!r) { this._fire("error"); return; }
      this._s = r.surface;
      this._ab = null;
      this.width = this.naturalWidth = r.width;
      this.height = this.naturalHeight = r.height;
      this.complete = true;
      this._fire("load");
    }
  };
  g.HTMLVideoElement = function () {};
  g.WebGLRenderingContext = function () {};
  g.ImageData = function () {};

  // ---- fonts: @font-face from stylesheets (gamefont.css) and Graphics.loadFont's insertRule ------
  const fontFamilies = new Set();
  function parseFontFace(rule, baseDir) {
    const fam = /font-family:\s*["']?([^;"']+?)["']?\s*;/.exec(rule), url = /url\(\s*["']?([^)"']+?)["']?\s*\)/.exec(rule);
    if (fam && url && nx.registerFont(fam[1].trim(), nx.root + "/" + baseDir + url[1])) fontFamilies.add(fam[1].trim().toLowerCase());
  }
  g.__registerCss = function (rel) {
    const css = nx.readFile(nx.root + "/" + rel);
    if (!css) return;
    const dir = rel.replace(/[^/]*$/, "");
    for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) parseFontFace(m[1], dir);
  };
  const fonts = {
    load: () => Promise.resolve(), add() {},
    check: (spec) => { const m = /[\d.]+px\s+(.+)$/.exec(String(spec)); return !!m && m[1].split(",").some((f) => fontFamilies.has(f.trim().replace(/["']/g, "").toLowerCase())); },
  };
  fonts.ready = Promise.resolve(fonts);                    // MV keeps the resolved value and calls .check() on it

  // ---- document / elements ---------------------------------------------------------------------
  const byId = new Map();
  function nodeList(arr) { arr.item = (i) => arr[i] || null; return arr; }
  function loadScriptElement(el) {
    try { g.__loadScript(el.src); } catch (e) { log("script load failed: " + el.src + ": " + e); if (el.onerror) el.onerror({ target: el }); return; }
    g.setTimeout(() => { if (el.onload) el.onload({ target: el }); }, 0);
  }
  const scripts = [];
  const element = (tag) => {
    const t = String(tag).toLowerCase();
    const el = {
      tagName: t.toUpperCase(), style: {}, children: [], textContent: "", src: "", id: "",
      sheet: t === "style" ? { insertRule: (r) => parseFontFace(r, "") } : undefined,
      appendChild(c) {
        this.children.push(c);
        if (c && c.tagName === "SCRIPT" && c.src) { scripts.push(c); loadScriptElement(c); }
        return c;
      },
      insertBefore(c) { return this.appendChild(c); },
      getElementsByTagName() { return nodeList([]); },
      removeChild() {}, remove() {},
      addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null; },
      canPlayType(type) { return /ogg/.test(type) ? "probably" : ""; },   // MV picks .ogg over .m4a when this says yes; the game ships only .rpgmvo
    };
    return el;
  };
  const head = element("head"), body = element("body");
  g.document = {
    createElement: (tag) => (String(tag).toLowerCase() === "canvas" ? new Canvas() : element(tag)),
    createTextNode: (t) => ({ textContent: t }),
    getElementsByTagName: (t) => nodeList(t === "head" ? [head] : t === "script" ? (scripts.length ? scripts.slice() : [{ src: "js/main.js" }]) : t === "body" ? [body] : []),
    getElementById: (id) => byId.get(id) || null,
    body, head, documentElement: element("html"),
    currentScript: { src: "" },
    fonts,
    addEventListener() {}, removeEventListener() {}, visibilityState: "visible", title: "",
  };

  // ---- location / navigator / gamepad ----------------------------------------------------------
  g.location = { search: "", href: "file:///index.html", protocol: "file:", pathname: "/index.html", hash: "", host: "", reload() {} };

  // The Switch pad as a "standard" gamepad, laid out by Nintendo semantics: A is OK, B is cancel,
  // Y is dash, X is the menu, so MV's mapper (0 ok, 1 cancel, 2 shift, 3 menu) feels native.
  const BIT = { A: 0, B: 1, X: 2, Y: 3, STICK_L: 4, STICK_R: 5, L: 6, R: 7, ZL: 8, ZR: 9, PLUS: 10, MINUS: 11, LEFT: 12, UP: 13, RIGHT: 14, DOWN: 15 };
  const STD = [BIT.A, BIT.B, BIT.Y, BIT.X, BIT.L, BIT.R, BIT.ZL, BIT.ZR, BIT.MINUS, BIT.PLUS, BIT.STICK_L, BIT.STICK_R, BIT.UP, BIT.DOWN, BIT.LEFT, BIT.RIGHT];
  const gamepad = { id: "Nintendo Switch", index: 0, connected: true, mapping: "standard", buttons: STD.map(() => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
  function getGamepads() {
    if (!nx.pad) return [];
    const p = nx.pad();
    for (let i = 0; i < STD.length; i++) {
      const bit = STD[i], on = ((p[0] >>> bit) & 1) === 1;
      gamepad.buttons[i].pressed = on;
      gamepad.buttons[i].value = on ? 1 : 0;
    }
    gamepad.axes[0] = p[2] / 32767; gamepad.axes[1] = -p[3] / 32767;      // libnx y is up-positive, the Gamepad API's is down
    gamepad.axes[2] = p[4] / 32767; gamepad.axes[3] = -p[5] / 32767;
    return [gamepad];
  }
  Object.defineProperty(g, "navigator", { value: { userAgent: "Mozilla/5.0 (Nintendo Switch) NX", platform: "NX", language: "en", getGamepads }, configurable: true, writable: true });

  g.addEventListener = g.removeEventListener = () => {};
  g.getComputedStyle = () => ({});
  g.close = g.open = () => {};
  g.screen = { width: nx.width, height: nx.height };
  g.innerWidth = nx.width;
  g.innerHeight = nx.height;
  g.devicePixelRatio = 1;

  // ---- localStorage persisted to the SD card (MV's web-storage saves live here) ----------------
  const cache = new Map();
  const savePath = (k) => nx.saveDir + "/" + encodeURIComponent(k) + ".sav";
  g.localStorage = {
    getItem(k) {
      k = String(k);
      if (!cache.has(k)) cache.set(k, nx.readFile(savePath(k)));
      return cache.get(k);
    },
    setItem(k, v) {
      k = String(k); v = String(v);
      if (!nx.writeFile(savePath(k), v)) throw new Error("localStorage: write failed for " + k);
      cache.set(k, v);
    },
    removeItem(k) { k = String(k); nx.removeFile(savePath(k)); cache.set(k, null); },
    clear() {},
  };

  // ---- XMLHttpRequest over the native file reader (data/*.json etc.) ----------------------------
  g.XMLHttpRequest = class XMLHttpRequest {
    constructor() { this.readyState = 0; this.status = 0; this.responseType = ""; this.response = null; this.responseText = ""; }
    open(method, url) { this._url = url; this.readyState = 1; }
    overrideMimeType() {}
    setRequestHeader() {}
    send() {
      g.setTimeout(() => {
        const path = nx.root + "/" + decodeURIComponent(this._url.split("?")[0].replace(/^\.?\//, ""));
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

  // ---- audio: a silent AudioContext so WebAudio initialises; real playback comes later ------------
  const param = () => ({ value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} });
  const node = () => ({ gain: param(), connect() {}, disconnect() {}, frequency: param(), setPosition() {}, setOrientation() {}, panningModel: "", distanceModel: "" });
  g.AudioContext = g.webkitAudioContext = class AudioContext {
    constructor() { this.currentTime = 0; this.sampleRate = 44100; this.state = "running"; this.destination = node(); this.listener = { setPosition() {}, setOrientation() {} }; }
    createGain() { return node(); }
    createPanner() { return node(); }
    createBufferSource() { return Object.assign(node(), { buffer: null, loop: false, loopStart: 0, loopEnd: 0, playbackRate: param(), start() {}, stop() {}, onended: null }); }
    decodeAudioData(buf, ok) { g.setTimeout(() => ok({ duration: 1, length: 44100, numberOfChannels: 2, sampleRate: 44100, getChannelData: () => new Float32Array(0) }), 0); }
    resume() { return Promise.resolve(); }
  };
  g.Audio = class Audio { constructor() { this.volume = 1; } addEventListener() {} play() {} pause() {} load() {} canPlayType() { return ""; } };

  g.FontFace = function () {};

  // ---- script loading ----------------------------------------------------------------------------
  g.__loadScript = function (rel) {
    g.document.currentScript = { src: rel };
    if (nx.loadScript(nx.root + "/" + rel) === null) throw new Error("cannot load " + rel);
  };
})(globalThis);
