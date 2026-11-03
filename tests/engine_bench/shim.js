// Engine-neutral stand-in for the fh-nx native side (__nx), so the SAME env.js + boot.js + game run under QuickJS and V8.
// Needs a host object H (host_node.js or the qrun.c natives): print, realNow, readText, readBin, readRange, evalScript, gc, mem.
// Everything native is a no-op stub (canvas raster, GL, audio), so only JavaScript work is timed. Time is FAKE and advances
// exactly 1/60 s per tick, Math.random is seeded: every engine executes the identical sequence of game updates.
(function (g) {
  "use strict";
  const H = g.H;
  const CFG = g.__benchCfg;
  let FT = 1000000;                                            // fake clock, ms
  g.__fake = { advance(ms) { FT += ms; }, now() { return FT; } };
  let seed = 49734321;
  Math.random = function () {
    seed = ((seed + 0x7ed55d16) + (seed << 12)) & 0xffffffff;
    seed = ((seed ^ 0xc761c23c) ^ (seed >>> 19)) & 0xffffffff;
    seed = ((seed + 0x165667b1) + (seed << 5)) & 0xffffffff;
    seed = ((seed + 0xd3a2646c) ^ (seed << 9)) & 0xffffffff;
    seed = ((seed + 0xfd7046c5) + (seed << 3)) & 0xffffffff;
    seed = ((seed ^ 0xb55a4f09) ^ (seed >>> 16)) & 0xffffffff;
    return (seed & 0xfffffff) / 0x10000000;
  };
  // `new Date()` is fake time too: TerraxLighting's day/night clock advances on real 10 ms steps (new Date().getTime()),
  // which made a slower engine run a different game state.
  const RealDate = Date;
  function FakeDate() {
    if (!new.target) return new RealDate(1700000000000 + FT).toString();
    return arguments.length ? new RealDate(...arguments) : new RealDate(1700000000000 + FT);
  }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = function () { return 1700000000000 + FT; };
  FakeDate.UTC = RealDate.UTC; FakeDate.parse = RealDate.parse;
  g.Date = FakeDate;

  // ---- canvas stubs --------------------------------------------------------------------------------------------------
  const DUMMY_AB = new ArrayBuffer(16);
  function Surface(w, h) { this.w = w | 0; this.h = h | 0; }
  function Grad() {}
  Grad.prototype.addColorStop = function () {};
  class Ctx2D {
    constructor(s, canvas) {
      this._s = s; this.canvas = canvas; this.fillStyle = "#000000"; this.strokeStyle = "#000000"; this.globalAlpha = 1;
      this.globalCompositeOperation = "source-over"; this.lineWidth = 1; this.lineJoin = "miter"; this.font = "10px sans-serif";
      this.textAlign = "start"; this.textBaseline = "alphabetic"; this.imageSmoothingEnabled = true;
    }
    save() {} restore() {} setTransform() {} resetTransform() {} transform() {} translate() {} scale() {} rotate() {}
    beginPath() {} closePath() {} moveTo() {} lineTo() {} rect() {} arc() {} quadraticCurveTo() {} bezierCurveTo() {}
    fill() {} stroke() {} clip() {} fillRect() {} strokeRect() {} clearRect() {} drawImage() {}
    getImageData(x, y, w, h) { w = Math.max(1, w | 0); h = Math.max(1, h | 0); return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
    putImageData() {}
    createImageData(w, h) { w = Math.max(1, w | 0); h = Math.max(1, h | 0); return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
    __adjustTone() {} __blur() {}
    createLinearGradient() { return new Grad(); }
    createRadialGradient() { return new Grad(); }
    measureText(t) { const f = this.font, i = f.indexOf("px"); let px = 10; if (i > 0) { let j = i; while (j > 0 && f.charCodeAt(j - 1) >= 48 && f.charCodeAt(j - 1) <= 57) j--; px = +f.slice(j, i) || 10; } return { width: String(t).length * px * 0.5 }; }
    fillText() {} strokeText() {}
  }
  function decodeImage(bytes) {
    if (!bytes) return null;
    const u = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (u.length < 24) return null;
    let w = 1, h = 1;
    if (u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47) {
      w = ((u[16] << 24) | (u[17] << 16) | (u[18] << 8) | u[19]) >>> 0;
      h = ((u[20] << 24) | (u[21] << 16) | (u[22] << 8) | u[23]) >>> 0;
    }
    return { surface: new Surface(w, h), width: w, height: h };
  }

  // ---- lazy JSON array (nx.jsonLazy*): element boundaries found once, an element parsed on first read -----------------
  const lazy = [];
  function jsonLazyOpen(path) {
    const t = H.readText(path);
    if (t === null) return -1;
    const b = [];
    let depth = 0, start = -1, i = 0, n = t.length;
    for (; i < n; i++) {
      const c = t.charCodeAt(i);
      if (c === 34) { for (i++; i < n; i++) { const d = t.charCodeAt(i); if (d === 92) i++; else if (d === 34) break; } continue; }
      if (c === 91 || c === 123) { depth++; if (depth === 2) start = i; else if (depth === 1) continue; }
      else if (c === 93 || c === 125) { if (depth === 2) b.push(start, i + 1); depth--; }
      else if (depth === 1 && c > 32 && c !== 44) {               // scalar element at top level (e.g. null)
        let j = i; while (j < n && t.charCodeAt(j) !== 44 && t.charCodeAt(j) !== 93) j++;
        b.push(i, j); i = j - 1;
      }
    }
    lazy.push({ t, b });
    return lazy.length - 1;
  }

  // ---- WebGL: plain object with the native function list (js_gl.c k_funcs) and constants; answers PIXI's introspection --
  function makePlainGL(width, height) {
    const C = g.__GL_CONSTS, calls = { total: 0, draws: 0 };
    const TYPES = { float: C.FLOAT, vec2: C.FLOAT_VEC2, vec3: C.FLOAT_VEC3, vec4: C.FLOAT_VEC4, int: C.INT, bool: C.BOOL,
      mat2: C.FLOAT_MAT2, mat3: C.FLOAT_MAT3, mat4: C.FLOAT_MAT4, sampler2D: C.SAMPLER_2D };
    const shaderSrc = new Map(), programShaders = new Map(), programInfo = new Map();
    let objId = 1;
    function introspect(program) {
      if (programInfo.has(program)) return programInfo.get(program);
      const src = (programShaders.get(program) || []).map((sh) => shaderSrc.get(sh) || "").join(" ");
      const attrs = [], uniforms = [], seen = new Set();
      for (const m of src.matchAll(/attribute\s+(?:\w+\s+)?(\w+)\s+(\w+)\s*;/g)) attrs.push({ name: m[2], type: TYPES[m[1]] || C.FLOAT, size: 1 });
      for (const m of src.matchAll(/uniform\s+(?:\w+\s+)?(\w+)\s+(\w+)\s*(?:\[\s*(\d+)\s*\])?\s*;/g)) {
        if (seen.has(m[2])) continue;
        seen.add(m[2]);
        uniforms.push({ name: m[3] ? m[2] + "[0]" : m[2], type: TYPES[m[1]] || C.FLOAT, size: m[3] ? +m[3] : 1 });
      }
      const info = { attrs, uniforms };
      programInfo.set(program, info);
      return info;
    }
    const gl = { drawingBufferWidth: width, drawingBufferHeight: height, __calls: calls };
    for (const k in C) gl[k] = C[k];
    const NOOP = ["activeTexture", "blendFunc", "blendFuncSeparate", "blendEquation", "clear", "clearColor", "clearStencil", "colorMask",
      "cullFace", "depthMask", "depthFunc", "disable", "enable", "frontFace", "scissor", "stencilFunc", "stencilMask", "stencilOp",
      "viewport", "pixelStorei", "flush", "finish", "deleteBuffer", "deleteFramebuffer", "deleteRenderbuffer", "deleteTexture",
      "deleteProgram", "deleteShader", "bindBuffer", "bindFramebuffer", "bindRenderbuffer", "bindTexture", "framebufferTexture2D",
      "framebufferRenderbuffer", "renderbufferStorage", "generateMipmap", "texParameteri", "texParameterf", "bufferData",
      "bufferSubData", "vertexAttribPointer", "enableVertexAttribArray", "disableVertexAttribArray", "compileShader", "linkProgram",
      "useProgram", "validateProgram", "bindAttribLocation", "uniform1f", "uniform2f", "uniform3f", "uniform4f", "uniform1i",
      "uniform2i", "uniform3i", "uniform4i", "uniform1fv", "uniform2fv", "uniform3fv", "uniform4fv", "uniform1iv", "uniform2iv",
      "uniform3iv", "uniform4iv", "uniformMatrix2fv", "uniformMatrix3fv", "uniformMatrix4fv", "texImage2D", "texSubImage2D",
      "copyTexSubImage2D", "readPixels"];
    for (const k of NOOP) gl[k] = function () {};
    gl.drawArrays = gl.drawElements = function () { calls.draws++; };
    gl.setLogicalSize = function (w, h) { calls.logical = [w, h]; };
    gl.getError = () => 0;
    gl.isContextLost = () => false;
    gl.getExtension = () => null;
    gl.getParameter = () => 16;
    gl.getShaderParameter = () => true;
    gl.shaderSource = (sh, src) => { shaderSrc.set(sh, src); };
    gl.attachShader = (p, sh) => { const l = programShaders.get(p) || []; l.push(sh); programShaders.set(p, l); };
    gl.getProgramParameter = (p, what) => what === C.ACTIVE_UNIFORMS ? introspect(p).uniforms.length : what === C.ACTIVE_ATTRIBUTES ? introspect(p).attrs.length : true;
    gl.getActiveAttrib = (p, i) => introspect(p).attrs[i];
    gl.getActiveUniform = (p, i) => introspect(p).uniforms[i];
    gl.getAttribLocation = (p, name) => introspect(p).attrs.findIndex((x) => x.name === name);
    gl.getContextAttributes = () => ({ alpha: true, depth: true, stencil: true, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: false });
    gl.getShaderPrecisionFormat = () => ({ precision: 23, rangeMin: 127, rangeMax: 127 });
    gl.getShaderInfoLog = gl.getProgramInfoLog = () => "";
    gl.checkFramebufferStatus = () => C.FRAMEBUFFER_COMPLETE;
    gl.getUniformLocation = gl.createShader = gl.createProgram = gl.createBuffer = gl.createTexture = gl.createFramebuffer =
      gl.createRenderbuffer = function () { return { id: objId++ }; };
    return gl;
  }

  // ---- audio stub ------------------------------------------------------------------------------------------------------
  let nextId = 1;
  const voiceEnd = new Map();
  const audio = {
    load(data) { return data ? { id: nextId++, duration: 60, length: 48000 * 60, rate: 48000, channels: 2 } : null; },
    play(id, loop) { const v = nextId++; voiceEnd.set(v, loop ? Infinity : FT + 1000); return v; },
    stop(v) { voiceEnd.delete(v); },
    isPlaying(v) { const e = voiceEnd.get(v); return e !== undefined && e > FT; },
    setParams() {}, release() {},
  };

  const files = new Map();
  g.__padHeld = 0;
  g.__nx = {
    log: (s) => { if (CFG.verbose) H.print(String(s)); else { s = String(s); if (s.indexOf("ERROR") >= 0 || s.indexOf("error") >= 0 || s.indexOf("failed") >= 0) H.print(s); } },
    now: () => FT,
    sleep() {},
    readFile: (p) => (files.has(p) ? files.get(p) : H.readText(p)),
    readBinary: (p) => H.readBin(p),
    readRange: (p, o, l) => H.readRange(p, o, l),
    writeFile: (p, s) => { files.set(p, String(s)); return true; },   // saves stay in memory: the bench never writes the disk
    removeFile: (p) => { files.set(p, null); return true; },
    mkdir: () => true,
    loadScript: (p) => H.evalScript(p),
    root: CFG.www, saveDir: CFG.save, width: 1280, height: 720,
    registerFont: () => true,
    pad: () => [g.__padHeld >>> 0, 0, 0, 0, 0, 0],
    quit() { g.__quit = true; },
    gc() { H.gc(); }, mem() { return H.mem(); },
    audio,
    createSurface: (w, h) => new Surface(w, h),
    surfaceResize: (s, w, h) => { s.w = w | 0; s.h = h | 0; },
    surfaceBuffer: () => DUMMY_AB,
    surfaceFromRGBA: (w, h) => new Surface(w, h),
    decodeImage,
    createContext: (s, canvas) => new Ctx2D(s, canvas),
    jsonLazyOpen: CFG.lazyTroops ? jsonLazyOpen : undefined,
    jsonLazyCount: (h) => lazy[h].b.length / 2,
    jsonLazyGet: (h, i) => { const L = lazy[h]; return JSON.parse(L.t.slice(L.b[2 * i], L.b[2 * i + 1])); },
    gl: makePlainGL(1280, 720),
  };
  if (!CFG.lazyTroops) delete g.__nx.jsonLazyOpen;
})(globalThis);
