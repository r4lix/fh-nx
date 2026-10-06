// Feasibility spike: how much JS work does PIXI v4 do per frame for a map-sized scene, and how
// many GL calls does it make? Runs the real pixi.js + pixi-tilemap in QuickJS against a counting
// fake WebGL context (no GPU). Run:  qjs spike/pixi_bench.js <www dir> [frames]
import * as std from "qjs:std";

const www = scriptArgs[1];
const FRAMES = +(scriptArgs[2] || 300);
const g = globalThis;
const def = (k, v) => Object.defineProperty(g, k, { value: v, writable: true, configurable: true });

// ---- counting fake WebGL1 context -------------------------------------------------------------
const calls = new Map();
let callsThisFrame = 0;
const constants = new Map();
let nextConst = 0x1000;
const constOf = (name) => { if (!constants.has(name)) constants.set(name, nextConst++); return constants.get(name); };
let objId = 1;

// Enough of a GLSL "driver": remember each program's shader sources and answer the
// active-attribute / active-uniform queries PIXI makes by parsing them.
const TYPES = new Proxy({}, { get: (t, k) => constOf({ float: "FLOAT", vec2: "FLOAT_VEC2", vec3: "FLOAT_VEC3", vec4: "FLOAT_VEC4",
  int: "INT", bool: "BOOL", mat2: "FLOAT_MAT2", mat3: "FLOAT_MAT3", mat4: "FLOAT_MAT4", sampler2D: "SAMPLER_2D" }[k] || "FLOAT") });
const shaderSrc = new Map(), programShaders = new Map(), programInfo = new Map();
function introspect(program) {
  if (programInfo.has(program)) return programInfo.get(program);
  const src = (programShaders.get(program) || []).map((sh) => shaderSrc.get(sh) || "").join(" ");
  const attrs = [], uniforms = [], seen = new Set();
  for (const m of src.matchAll(/attribute\s+(?:\w+\s+)?(\w+)\s+(\w+)\s*;/g)) attrs.push({ name: m[2], type: TYPES[m[1]], size: 1 });
  for (const m of src.matchAll(/uniform\s+(?:\w+\s+)?(\w+)\s+(\w+)\s*(?:\[\s*(\d+)\s*\])?\s*;/g)) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    uniforms.push({ name: m[3] ? m[2] + "[0]" : m[2], type: TYPES[m[1]], size: m[3] ? +m[3] : 1 });
  }
  const info = { attrs, uniforms };
  programInfo.set(program, info);
  return info;
}
const fakeGl = new Proxy({}, {
  get(t, k) {
    if (typeof k !== "string") return undefined;
    if (k in t) return t[k];
    if (/^[A-Z0-9_]+$/.test(k)) return constOf(k);
    if (k === "canvas") return glCanvas;
    return (...args) => {
      calls.set(k, (calls.get(k) || 0) + 1);
      callsThisFrame++;
      switch (k) {
        case "getParameter": return 16;
        case "getShaderParameter": return true;
        case "shaderSource": shaderSrc.set(args[0], args[1]); return;
        case "attachShader": { const l = programShaders.get(args[0]) || []; l.push(args[1]); programShaders.set(args[0], l); return; }
        case "getProgramParameter":
          if (args[1] === constOf("ACTIVE_UNIFORMS")) return introspect(args[0]).uniforms.length;
          if (args[1] === constOf("ACTIVE_ATTRIBUTES")) return introspect(args[0]).attrs.length;
          return true;
        case "getActiveAttrib": return introspect(args[0]).attrs[args[1]];
        case "getActiveUniform": return introspect(args[0]).uniforms[args[1]];
        case "getAttribLocation": { const a = introspect(args[0]).attrs.findIndex((x) => x.name === args[1]); return a; }
        case "getContextAttributes": return { stencil: true, antialias: false, alpha: true };
        case "getExtension": return null;
        case "getError": return 0;
        case "isContextLost": return false;
        case "getShaderPrecisionFormat": return { precision: 23, rangeMin: 127, rangeMax: 127 };
        case "getUniformLocation": case "createShader": case "createProgram": case "createBuffer":
        case "createTexture": case "createFramebuffer": case "createRenderbuffer": return { id: objId++ };
        default: return undefined;
      }
    };
  },
});

function makeCanvas(w = 0, h = 0) {
  const c = {
    width: w, height: h, style: {}, _isCanvas: true,
    getContext: (type) => (type === "2d" ? ctx2d : fakeGl),
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: c.width, height: c.height }),
    toDataURL: () => "",
  };
  return c;
}
const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (typeof k === "string" ? () => ({ data: new Uint8ClampedArray(4), width: 1 }) : undefined)), set: (t, k, v) => (t[k] = v, true) });
const glCanvas = makeCanvas(1280, 720);

def("navigator", { userAgent: "NX" });
def("document", {
  createElement: (tag) => (tag === "canvas" ? makeCanvas() : { style: {}, addEventListener() {}, appendChild() {} }),
  addEventListener() {}, body: { appendChild() {}, style: {} }, documentElement: { style: {} },
});
g.window = g; g.self = g;
g.addEventListener = () => {};
g.requestAnimationFrame = () => 1;
g.WebGLRenderingContext = function () {};
g.HTMLImageElement = function () {};
g.HTMLCanvasElement = function () {};
g.HTMLVideoElement = function () {};
g.ImageData = function () {};
g.devicePixelRatio = 1;
g.innerWidth = 1280; g.innerHeight = 720;
g.Image = function () {};

function load(rel) {
  const src = std.loadFile(www + "/" + rel);
  (0, eval)(src);
}
load("js/libs/pixi.js");
load("js/libs/pixi-tilemap.js");
load("js/libs/pixi-picture.js");
const PIXI = g.PIXI;
print("PIXI", PIXI.VERSION);

// ---- scene shaped like Spriteset_Map -----------------------------------------------------------
const W = 1280, H = 720;
const renderer = new PIXI.WebGLRenderer(W, H, { view: glCanvas, transparent: false, antialias: false });
const stage = new PIXI.Container();

// Tilemap: ~ (W/48+2)*(H/48+2) cells, 4 layers (A-lower, B-upper, shadow, regions) of 48px tiles
const tex = PIXI.Texture.fromCanvas(makeCanvas(768, 768));
const tilemapBase = tex.baseTexture;
const layers = [];
let tiles = 0;
const tilemap = new PIXI.tilemap.CompositeRectTileLayer(0, [], true);   // as ShaderTilemap does
tilemap.setBitmaps([tex]);
for (let layer = 0; layer < 4; layer++) {
  for (let y = 0; y < Math.ceil(H / 48) + 2; y++)
    for (let x = 0; x < Math.ceil(W / 48) + 2; x++) {
      if (layer > 1 && (x + y) % 3) continue;           // upper layers are sparse
      tilemap.addRect(0, (x % 16) * 48, (y % 16) * 48, x * 48, y * 48, 48, 48);
      tiles++;
    }
}
stage.addChild(tilemap);

// Characters, events, HUD pieces: plain sprites, some sharing a base texture and some not
const sprites = [];
const charTex = [0, 1, 2, 3, 4, 5].map(() => new PIXI.Texture(PIXI.Texture.fromCanvas(makeCanvas(576, 384)).baseTexture, new PIXI.Rectangle(0, 0, 48, 48)));
for (let i = 0; i < 60; i++) {
  const s = new PIXI.Sprite(charTex[i % charTex.length]);
  s.x = (i * 37) % W; s.y = (i * 53) % H;
  stage.addChild(s);
  sprites.push(s);
}
// Window skins: nine-patch-ish quads, each its own small container with a handful of sprites
const winTex = new PIXI.Texture(PIXI.Texture.fromCanvas(makeCanvas(192, 192)).baseTexture);
for (let w = 0; w < 6; w++) {
  const c = new PIXI.Container();
  for (let i = 0; i < 12; i++) {
    const s = new PIXI.Sprite(winTex);
    s.x = i * 20; s.y = (i % 3) * 20;
    c.addChild(s);
  }
  c.x = 40 + w * 150; c.y = 500;
  stage.addChild(c);
  sprites.push(c);
}

// ---- measure ----------------------------------------------------------------------------------
function frame(i) {
  for (let k = 0; k < sprites.length; k++) { sprites[k].x += 1; if (sprites[k].x > W) sprites[k].x = 0; }
  tilemap.position.x = -(i % 48);                         // scroll
  renderer.render(stage);
}
for (let i = 0; i < 30; i++) frame(i);                    // warm-up: shader compile, texture upload
calls.clear();
const t0 = Date.now();
let maxCalls = 0;
for (let i = 0; i < FRAMES; i++) {
  callsThisFrame = 0;
  frame(i);
  if (callsThisFrame > maxCalls) maxCalls = callsThisFrame;
}
const dt = Date.now() - t0;

let total = 0;
for (const v of calls.values()) total += v;
print(`tiles/frame: ${tiles}, sprites: ${sprites.length}, display objects ~${tiles + sprites.length * 3}`);
print(`frames: ${FRAMES}  total ${dt} ms  => ${(dt / FRAMES).toFixed(3)} ms/frame (JS side, x86 desktop)`);
print(`GL calls/frame: avg ${(total / FRAMES).toFixed(1)}, max ${maxCalls}`);
print("top GL calls per frame: " + [...calls.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => k + " " + (n / FRAMES).toFixed(1)).join(", "));
print("distinct GL entry points used: " + calls.size + " -> " + [...calls.keys()].sort().join(" "));

// ---- sanity: did the sprites really render? ---------------------------------------------------
print("valid textures: char " + charTex[0].valid + " (" + charTex[0].width + "x" + charTex[0].height + "), win " + winTex.valid +
  ", tile base hasLoaded " + tilemapBase.hasLoaded + " " + tilemapBase.width + "x" + tilemapBase.height);
print("sprite renderable " + sprites[0].renderable + " visible " + sprites[0].visible + " worldAlpha " + sprites[0].worldAlpha);
