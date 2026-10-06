// A WebGL1 context that accepts every call, answers the introspection queries PIXI makes by parsing
// shader sources like a driver would, and counts calls. For running the engine on the PC.
function makeFakeGL(width, height) {
  const calls = { total: 0, draws: 0 };
  const constants = new Map();
  let nextConst = 0x1000, objId = 1;
  const constOf = (n) => { if (!constants.has(n)) constants.set(n, nextConst++); return constants.get(n); };
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
  const own = { drawingBufferWidth: width, drawingBufferHeight: height, __calls: calls, setLogicalSize(w, h) { calls.logical = [w, h]; } };
  return new Proxy(own, {
    get(t, k) {
      if (typeof k !== "string") return undefined;
      if (k in t) return t[k];
      if (/^[A-Z0-9_]+$/.test(k)) return constOf(k);
      return (...args) => {
        calls.total++;
        switch (k) {
          case "drawElements": case "drawArrays": calls.draws++; return undefined;
          case "getParameter": return 16;
          case "getShaderParameter": return true;
          case "shaderSource": shaderSrc.set(args[0], args[1]); return undefined;
          case "attachShader": { const l = programShaders.get(args[0]) || []; l.push(args[1]); programShaders.set(args[0], l); return undefined; }
          case "getProgramParameter":
            if (args[1] === constOf("ACTIVE_UNIFORMS")) return introspect(args[0]).uniforms.length;
            if (args[1] === constOf("ACTIVE_ATTRIBUTES")) return introspect(args[0]).attrs.length;
            return true;
          case "getActiveAttrib": return introspect(args[0]).attrs[args[1]];
          case "getActiveUniform": return introspect(args[0]).uniforms[args[1]];
          case "getAttribLocation": return introspect(args[0]).attrs.findIndex((x) => x.name === args[1]);
          case "getContextAttributes": return { stencil: true, antialias: false, alpha: true };
          case "getExtension": return null;
          case "getError": return 0;
          case "isContextLost": return false;
          case "getShaderPrecisionFormat": return { precision: 23, rangeMin: 127, rangeMax: 127 };
          case "getShaderInfoLog": case "getProgramInfoLog": return "";
          case "checkFramebufferStatus": return constOf("FRAMEBUFFER_COMPLETE");
          case "getUniformLocation": case "createShader": case "createProgram": case "createBuffer":
          case "createTexture": case "createFramebuffer": case "createRenderbuffer": return { id: objId++ };
          default: return undefined;
        }
      };
    },
  });
}
