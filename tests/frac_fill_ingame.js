// In-game identity check for the fractional-edge fillRect fast path: every fillRect the game makes is run twice
// from the same pixels, first with nx.__fracFast(0) (fill_polys), then, after putImageData restores the canvas,
// with nx.__fracFast(1); the two results must be byte-identical. The canvas keeps the fast-path result. Tours
// maps 80/93/185/74 from build/save with tests/bench_maps.js (lighting load shedding off) and logs a tally per map:
// calls, calls on the 1/4-scale lighting mask, calls that changed the canvas, mismatches (must be 0).
//   make boot-test SECONDS=100 EXTRA=tests/frac_fill_ingame.js      (globalThis.__ffiNoTour = 1: bring your own driver)
(function (g) {
  const nx = g.__nx;
  const probe = new g.HTMLCanvasElement(); probe.width = 4; probe.height = 4;
  const proto = Object.getPrototypeOf(probe.getContext("2d"));
  const fill = proto.fillRect;
  let calls = 0, mask = 0, changed = 0, bad = 0, total = { calls: 0, mask: 0, changed: 0, bad: 0 };
  const u32 = (d) => new Uint32Array(d.buffer, d.byteOffset, d.length >> 2);
  const same = (a, b) => {
    if (a.length !== b.length) return false;
    const x = u32(a), y = u32(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  };
  proto.fillRect = function (x, y, w, h) {
    const cv = this.canvas, W = cv && cv.width, H = cv && cv.height;
    if (!W || !H) return fill.apply(this, arguments);
    calls++;
    if (W === 217 && H === 158) mask++;
    const before = this.getImageData(0, 0, W, H);
    nx.__fracFast(0);
    fill.apply(this, arguments);
    const off = this.getImageData(0, 0, W, H).data;
    this.putImageData(before, 0, 0);
    nx.__fracFast(1);
    const r = fill.apply(this, arguments);
    const on = this.getImageData(0, 0, W, H).data;
    if (!same(before.data, on)) changed++;
    if (!same(off, on)) { bad++; if (bad < 10) nx.log("[ffi] MISMATCH " + W + "x" + H + " fillRect(" + [x, y, w, h].join(",") + ") comp=" + this.globalCompositeOperation + " style=" + this.fillStyle); }
    return r;
  };
  const report = (label) => {
    nx.log("[ffi] " + label + ": " + calls + " fillRect calls (" + mask + " on the 217x158 lighting mask), " + changed + " changed the canvas, " + bad + " mismatching");
    total.calls += calls; total.mask += mask; total.changed += changed; total.bad += bad;
    calls = mask = changed = bad = 0;
  };
  const ol = nx.log;
  nx.log = function (s) {
    const r = ol.apply(this, arguments);
    if (typeof s === "string" && s.indexOf("[maps] map ") === 0) report(s.split(" ").slice(1, 3).join(" "));
    if (typeof s === "string" && s.indexOf("[maps] done") === 0) {
      report("rest");
      ol.call(nx, "[ffi] total: " + total.calls + " fillRect calls (" + total.mask + " on the lighting mask), " + total.changed + " changed the canvas, " + total.bad + " mismatching");
    }
    return r;
  };
  if (typeof g.__perfBudgetMs !== "number") g.__perfBudgetMs = 1e9;   // the checks are slow: keep lighting from shedding work
  if (!g.__ffiNoTour) {
    if (!g.__maps) g.__maps = [80, 93, 185, 74];
    (0, eval)(nx.readFile("tests/bench_maps.js"));
  }
})(globalThis);
