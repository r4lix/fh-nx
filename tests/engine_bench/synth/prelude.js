// Portable harness: same file runs under qjs (-C, classic script) and node. BENCH(name, fn, iters[, setup]):
// warm-up of max(iters/2, 300 ms), then 5 timed rounds; each round repeats batches of `iters` calls until >= 300 ms.
// Prints min and median ms per call. Deterministic Math.random so every engine does identical work.
var __out = typeof console !== "undefined" ? function (s) { console.log(s); } : print;
var __now = function () { return performance.now(); };
(function () {
  var seed = 49734321;
  Math.random = function () {
    // Robert Jenkins' 32 bit integer hash, as used by Octane's seeded random
    seed = ((seed + 0x7ed55d16) + (seed << 12)) & 0xffffffff;
    seed = ((seed ^ 0xc761c23c) ^ (seed >>> 19)) & 0xffffffff;
    seed = ((seed + 0x165667b1) + (seed << 5)) & 0xffffffff;
    seed = ((seed + 0xd3a2646c) ^ (seed << 9)) & 0xffffffff;
    seed = ((seed + 0xfd7046c5) + (seed << 3)) & 0xffffffff;
    seed = ((seed ^ 0xb55a4f09) ^ (seed >>> 16)) & 0xffffffff;
    return (seed & 0xfffffff) / 0x10000000;
  };
})();
function BENCH(name, fn, iters, setup) {
  if (setup) setup();
  var rounds = [], r, i, t0, n, el, MINMS = 300;
  var tw = __now(), first = -1;
  for (i = 0; i < Math.max(1, iters >> 1) || __now() - tw < MINMS; i++) { fn(); if (first < 0) first = __now() - tw; }
  for (r = 0; r < 5; r++) {
    t0 = __now(); n = 0;
    do { for (i = 0; i < iters; i++) fn(); n += iters; el = __now() - t0; } while (el < MINMS);
    rounds.push(el / n);
  }
  rounds.sort(function (a, b) { return a - b; });
  __out("RESULT " + name + " min " + rounds[0].toFixed(4) + " med " + rounds[2].toFixed(4) + " first " + first.toFixed(3) + " ms/iter");
}
