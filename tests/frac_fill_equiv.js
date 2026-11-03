// Equivalence check for the fractional-edge solid fillRect fast path (js_canvas.c fill_rect_frac_solid): every
// scene is drawn twice, with nx.__fracFast(0) (the generic fill_polys rasteriser) and nx.__fracFast(1), and every
// byte must match. Random rects/transforms/composite modes/alpha/clips, plus the TerraxLighting mask fills and
// degenerate inputs (zero size, negative size, off-surface, huge and non-finite coordinates).
//   make boot-test SECONDS=1 EXTRA=tests/frac_fill_equiv.js      -> "[frac] ... 0 mismatching"
(function (g) {
  const nx = g.__nx;
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const comps = ["source-over", "lighter", "copy", "destination-out", "destination-in", "source-atop", "source-in", "source-out",
    "destination-over", "destination-atop", "xor", "multiply", "screen", "lighten", "darken", "difference"];
  let bad = 0, trials = 0, pixels = 0;
  const run = (sc) => {                         // sc: {w, h, init, clip, m: [a,b,c,d,e,f], comp, ga, col, rects: [[x,y,w,h], ...]}
    const out = [];
    for (const fast of [0, 1]) {
      nx.__fracFast(fast);
      const cv = document.createElement("canvas"); cv.width = sc.w; cv.height = sc.h;
      const ctx = cv.getContext("2d");
      const id = ctx.createImageData(sc.w, sc.h); id.data.set(sc.init); ctx.putImageData(id, 0, 0);
      ctx.save();
      if (sc.clip) { ctx.beginPath(); ctx.rect(sc.clip[0], sc.clip[1], sc.clip[2], sc.clip[3]); ctx.clip(); }
      ctx.setTransform(sc.m[0], sc.m[1], sc.m[2], sc.m[3], sc.m[4], sc.m[5]);
      ctx.globalCompositeOperation = sc.comp; ctx.globalAlpha = sc.ga; ctx.fillStyle = sc.col;
      for (const r of sc.rects) ctx.fillRect(r[0], r[1], r[2], r[3]);
      ctx.restore();
      out.push(ctx.getImageData(0, 0, sc.w, sc.h).data);
    }
    nx.__fracFast(1);
    trials++; pixels += sc.w * sc.h;
    const a = out[0], b = out[1];
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    if (diff) { bad++; if (bad < 10) nx.log("[frac] MISMATCH " + JSON.stringify({ w: sc.w, h: sc.h, m: sc.m, comp: sc.comp, ga: sc.ga, col: sc.col, clip: sc.clip, rects: sc.rects }) + " bytes=" + diff); }
  };
  const randInit = (w, h) => {
    const init = new Uint8ClampedArray(w * h * 4), mode = rnd();
    for (let i = 0; i < init.length; i += 4) {
      init[i] = rnd() * 256; init[i + 1] = rnd() * 256; init[i + 2] = rnd() * 256;
      init[i + 3] = mode < 0.4 ? 255 : mode < 0.6 ? 0 : pick([0, 255, Math.floor(rnd() * 256)]);
    }
    return init;
  };
  const randCol = () => "rgba(" + Math.floor(rnd() * 256) + "," + Math.floor(rnd() * 256) + "," + Math.floor(rnd() * 256) + "," +
    pick([1, 1, 0.5, 0.2, 0, Math.round(rnd() * 100) / 100]) + ")";
  // 1) random scenes
  for (let t = 0; t < 3000; t++) {
    const w = 8 + Math.floor(rnd() * 60), h = 8 + Math.floor(rnd() * 60);
    const s = pick([0.25, 0.5, 1, 0.3, 1.7, 0.25]), sx = rnd() < 0.2 ? s * pick([0.5, 1.3, -1]) : s, sy = rnd() < 0.2 ? -s : s;
    const tx = pick([0, 0.5, 0.25, 3.3, -2.7, w]), ty = pick([0, 0.5, 0.75, -1.1, 2.6, h]);
    const r = [(rnd() - 0.2) * w * 2 / s, (rnd() - 0.2) * h * 2 / s, (rnd() - 0.3) * w * 2 / s, (rnd() - 0.3) * h * 2 / s];
    if (rnd() < 0.3) { r[0] = Math.round(r[0] * 2) / 2; r[1] = Math.round(r[1] * 2) / 2; r[2] = Math.round(r[2]); r[3] = Math.round(r[3]); }
    if (rnd() < 0.05) r[pick([2, 3])] = 0;
    run({ w, h, init: randInit(w, h), clip: rnd() < 0.25 ? [rnd() * w, rnd() * h, rnd() * w, rnd() * h] : null,
      m: [sx, 0, 0, sy, tx, ty], comp: pick(comps), ga: pick([1, 1, 0.5, 0.37, 0]), col: randCol(), rects: [r] });
  }
  // 2) TerraxLighting's mask update at 1/4 scale: black source-over fill, then the 'lighter' tint, over an opaque mask
  for (const tint of ["#000000", "#202040", "#ffffff", "#123456"]) {
    for (const off of [0, 0.5, 0.25, -0.75]) {
      const init = new Uint8ClampedArray(217 * 158 * 4);
      for (let i = 0; i < init.length; i += 4) { init[i] = rnd() * 256; init[i + 1] = rnd() * 256; init[i + 2] = rnd() * 256; init[i + 3] = 255; }
      run({ w: 217, h: 158, init, clip: null, m: [0.25, 0, 0, 0.25, off, off], comp: "source-over", ga: 1, col: "black", rects: [[0, 0, 866, 630]] });
      run({ w: 217, h: 158, init, clip: null, m: [0.25, 0, 0, 0.25, off, off], comp: "lighter", ga: 1, col: tint, rects: [[0, 0, 866, 630]] });
    }
  }
  // 3) degenerate and extreme inputs
  const odd = [[0.5, 0.5, 0, 3.2], [0.5, 0.5, 3.2, 0], [2.5, 2.5, -1.25, -1.75], [-100.5, -100.5, 50, 50], [30.5, 30.5, 1e9, 1e9],
    [-1e12, -1e12, 2e12, 2e12], [0.5, 0.5, 1e-9, 5], [1.5, 1.5, 0.3, 0.3], [1.1, 1.1, 0.2, 0.2], [5.9, 5.9, 0.2, 9],
    [NaN, 1, 5, 5], [1, NaN, 5, 5], [0.5, 0.5, Infinity, 5], [0.5, 0.5, 5, Infinity], [-Infinity, 0.5, Infinity, 5], [7.25, -3.5, 4.5, 40]];
  for (const comp of comps) for (const r of odd) for (const clip of [null, [3.3, 2.2, 20.5, 14.1]]) {
    const w = 32, h = 24;
    run({ w, h, init: randInit(w, h), clip, m: [1, 0, 0, 1, 0, 0], comp, ga: pick([1, 0.5]), col: randCol(), rects: [r] });
  }
  nx.log("[frac] fillRect fast path vs fill_polys: " + trials + " scenes, " + pixels + " pixels, " + bad + " mismatching");
  // timing: the two TerraxLighting mask fills at 1/4 scale, generic vs fast
  const cv = document.createElement("canvas"); cv.width = 217; cv.height = 158; const ctx = cv.getContext("2d");
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 217, 158);
  for (const fast of [0, 1, 0, 1]) {
    nx.__fracFast(fast);
    const a = nx.now();
    for (let i = 0; i < 200; i++) {
      ctx.save(); ctx.scale(0.25, 0.25); ctx.fillStyle = "black"; ctx.globalCompositeOperation = "source-over"; ctx.fillRect(0, 0, 866, 630);
      ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = "#202040"; ctx.fillRect(0, 0, 866, 630); ctx.restore();
    }
    nx.log("[frac] mask fill pair, fast path " + (fast ? "on " : "off") + ": " + ((nx.now() - a) / 200).toFixed(3) + " ms");
  }
  nx.__fracFast(1);
})(globalThis);
