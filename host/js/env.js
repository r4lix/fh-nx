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
  g.__frameMs = 8;                                 // smoothed cost of one tick (timers + animation frame), for load shedding
  const __tickBody = function () {
    const now = nx.now();                          // always the clock timers were scheduled against, whatever the host passes
    const due = timers.filter((t) => t.due <= now);
    for (const t of due) {
      if (t.repeat) t.due = now + t.ms; else timers = timers.filter((x) => x !== t);
      try { t.fn(...t.args); } catch (e) { log("timer error: " + e + (e && e.stack ? " | " + e.stack : "")); }
    }
    if (g.__audioTick) g.__audioTick();
    const cbs = frameCbs;
    frameCbs = [];
    for (const cb of cbs) cb(now);
  };
  g.__tick = function () {
    const t = nx.now();
    __tickBody();
    g.__frameMs = g.__frameMs * 0.9 + (nx.now() - t) * 0.1;
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
        bytes = readBinaryRel(decodeURIComponent(url.split("?")[0]));
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

  // ---- file resolution: enabled mods override files of the base game (see host/src/mods.cpp) ----------------
  function resolvePath(rel) {
    if (nx.modResolve) { const r = nx.modResolve(rel); if (r) return r[0]; }
    return nx.root + "/" + rel;
  }
  g.__resolvePath = resolvePath;
  // MV's Decrypter wants .rpgmvp/.rpgmvo/.rpgmvm: a mod may ship the plain file instead, so wrap it the way MV's own
  // tool does (16-byte header, first 16 bytes XORed with the System.json key).
  const ENC_EXT = { ".rpgmvp": 1, ".rpgmvo": 1, ".rpgmvm": 1 };
  function encryptPlain(buf) {
    g.Decrypter.readEncryptionkey();
    const key = g.Decrypter._encryptionKey, src = new Uint8Array(buf), out = new Uint8Array(16 + src.length);
    const head = [0x52, 0x50, 0x47, 0x4d, 0x56, 0, 0, 0, 0, 3, 1, 0, 0, 0, 0, 0];
    out.set(head, 0); out.set(src, 16);
    for (let i = 0; i < 16 && i < src.length; i++) out[16 + i] ^= parseInt(key[i], 16);
    return out.buffer;
  }
  function readBinaryRel(rel) {
    const dot = rel.lastIndexOf("."), ext = dot >= 0 ? rel.slice(dot).toLowerCase() : "";
    if (nx.modResolve) {
      const r = nx.modResolve(rel);
      if (r) { const b = nx.readBinary(r[0]); return b && ENC_EXT[ext] && !r[1] ? encryptPlain(b) : b; }
    }
    return nx.readBinary(nx.root + "/" + rel);
  }
  g.__readBinaryRel = readBinaryRel;

  // ---- fonts: @font-face from stylesheets (gamefont.css) and Graphics.loadFont's insertRule ------
  const fontFamilies = new Set();
  function parseFontFace(rule, baseDir) {
    const fam = /font-family:\s*["']?([^;"']+?)["']?\s*;/.exec(rule), url = /url\(\s*["']?([^)"']+?)["']?\s*\)/.exec(rule);
    if (fam && url && nx.registerFont(fam[1].trim(), resolvePath(baseDir + url[1]))) fontFamilies.add(fam[1].trim().toLowerCase());
  }
  g.__registerCss = function (rel) {
    const css = nx.readFile(resolvePath(rel));
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
  // <video>: no decoder yet, so a movie "plays" instantly: it loads, plays and ends on the next tick. MV's
  // interpreter waits on the ended event ("Play Movie" parks the event until it fires), so without this
  // the game's intro movie would hang the opening forever on a black screen.
  function videoElement() {
    const v = element("video");
    v.volume = 1; v.muted = false; v.videoWidth = 0; v.videoHeight = 0; v.currentTime = 0; v.duration = 0; v.paused = true;
    v.onloadeddata = v.onended = v.onerror = null;
    v.load = () => { g.setTimeout(() => { if (typeof v.onloadeddata === "function") v.onloadeddata({ target: v }); }, 0); };
    v.play = () => { v.paused = false; g.setTimeout(() => { v.paused = true; if (typeof v.onended === "function") v.onended({ target: v }); }, 0); return Promise.resolve(); };
    v.pause = () => { v.paused = true; };
    return v;
  }
  const head = element("head"), body = element("body");
  g.document = {
    createElement: (tag) => { const t = String(tag).toLowerCase(); return t === "canvas" ? new Canvas() : t === "video" ? videoElement() : element(tag); },
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
        const rel = decodeURIComponent(this._url.split("?")[0].replace(/^\.?\//, ""));
        const bin = this.responseType === "arraybuffer";
        const body = bin ? readBinaryRel(rel) : nx.readFile(resolvePath(rel));
        this.readyState = 4;
        if (body === null) { this.status = 404; if (this.onerror) this.onerror({}); return; }
        this.status = 200;
        if (bin) this.response = body; else { this.responseText = body; this.response = body; }
        if (this.onreadystatechange) this.onreadystatechange();
        if (this.onload) this.onload({});
      }, 0);
    }
  };

  // ---- Web Audio over the native mixer ---------------------------------------------------------
  // MV builds source -> gain -> panner -> master gain -> destination. A source node resolves that chain to
  // (volume, pan) for its mixer voice; fades are AudioParam ramps evaluated against context time each frame.
  class AudioParam {
    constructor(ctx, v) { this._ctx = ctx; this._v = v; this._ramp = null; }
    get value() {
      if (this._ramp) {
        const r = this._ramp, now = this._ctx.currentTime;
        const f = r.t1 > r.t0 ? Math.min(1, Math.max(0, (now - r.t0) / (r.t1 - r.t0))) : 1;
        const v = r.from + (r.to - r.from) * f;
        if (f >= 1) { this._v = r.to; this._ramp = null; }
        return v;
      }
      return this._v;
    }
    set value(x) { this._v = +x; this._ramp = null; }
    setValueAtTime(x, t) { if (t <= this._ctx.currentTime + 1e-6) { this._v = +x; this._ramp = null; } return this; }
    linearRampToValueAtTime(x, t) { this._ramp = { from: this.value, to: +x, t0: this._ctx.currentTime, t1: t }; return this; }
    cancelScheduledValues() { if (this._ramp) { this._v = this.value; this._ramp = null; } return this; }
  }
  class AudioNode {
    constructor(ctx) { this._ctx = ctx; this._to = null; }
    connect(dest) { this._to = dest; return dest; }
    disconnect() { this._to = null; }
  }
  class GainNode extends AudioNode { constructor(ctx) { super(ctx); this.gain = new AudioParam(ctx, 1); } }
  class PannerNode extends AudioNode {
    constructor(ctx) { super(ctx); this.panningModel = "equalpower"; this.distanceModel = "inverse"; this._x = 0; }
    setPosition(x) { this._x = +x; }
    setOrientation() {}
  }
  class DestinationNode extends AudioNode {}
  const liveBuffers = new FinalizationRegistry((id) => nx.audio.release(id));   // free compressed bytes when MV drops the buffer

  class AudioBufferSourceNode extends AudioNode {
    constructor(ctx) {
      super(ctx);
      this.buffer = null; this.loop = false; this.loopStart = 0; this.loopEnd = 0; this.onended = null;
      this.playbackRate = new AudioParam(ctx, 1);
      this._voice = 0; this._last = "";
    }
    _resolve() {                                             // walk the graph to the destination
      let vol = 1, pan = 0;
      for (let n = this._to, i = 0; n && i < 16; n = n._to, i++) {
        if (n instanceof GainNode) vol *= n.gain.value;
        else if (n instanceof PannerNode) pan = n._x;
      }
      return [vol, this.playbackRate.value, pan];
    }
    start(when, offset) {
      if (!this.buffer || this._voice) return;
      const [vol, pitch, pan] = this._resolve();
      this._voice = nx.audio.play(this.buffer._id, !!this.loop, this.loopStart, this.loopEnd, +offset || 0, vol, pitch, pan);
      this._last = vol + "," + pitch + "," + pan;
      if (this._voice) this._ctx._active.add(this);
    }
    stop() {
      if (this._voice) nx.audio.stop(this._voice);
      this._voice = 0;
      this._ctx._active.delete(this);
    }
    _update() {
      if (!nx.audio.isPlaying(this._voice)) {
        this._voice = 0;
        this._ctx._active.delete(this);
        if (typeof this.onended === "function") this.onended({ target: this });
        return;
      }
      const [vol, pitch, pan] = this._resolve(), key = vol + "," + pitch + "," + pan;
      if (key !== this._last) { nx.audio.setParams(this._voice, vol, pitch, pan); this._last = key; }
    }
  }
  const t0 = nx.now();
  const contexts = [];
  g.AudioContext = g.webkitAudioContext = class AudioContext {
    constructor() {
      this.sampleRate = 48000; this.state = "running"; this._active = new Set();
      this.destination = new DestinationNode(this);
      this.listener = { setPosition() {}, setOrientation() {} };
      contexts.push(this);
    }
    get currentTime() { return (nx.now() - t0) / 1000; }
    createGain() { return new GainNode(this); }
    createPanner() { return new PannerNode(this); }
    createBufferSource() { return new AudioBufferSourceNode(this); }
    decodeAudioData(data, ok, err) {
      const info = nx.audio.load(data);
      const done = () => {
        if (!info) { if (err) err(new Error("EncodingError")); return; }
        const buf = { _id: info.id, duration: info.duration, length: info.length, sampleRate: info.rate, numberOfChannels: info.channels, getChannelData: () => new Float32Array(0) };
        liveBuffers.register(buf, info.id);
        if (ok) ok(buf);
      };
      g.setTimeout(done, 0);
    }
    resume() { return Promise.resolve(); }
  };
  g.__audioStats = () => contexts.map((c) => c._active.size).join("/");
  g.__audioTick = () => { for (const c of contexts) for (const s of Array.from(c._active)) s._update(); };
  g.Audio = class Audio { constructor() { this.volume = 1; } addEventListener() {} play() {} pause() {} load() {} canPlayType() { return ""; } };

  g.FontFace = function () {};

  // ---- script loading ----------------------------------------------------------------------------
  g.__loadScript = function (rel) {
    g.document.currentScript = { src: rel };
    if (nx.loadScript(resolvePath(rel)) === null) throw new Error("cannot load " + rel);
  };
})(globalThis);
