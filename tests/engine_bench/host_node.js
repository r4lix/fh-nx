// Node/V8 host for the engine-neutral game bench. Usage: node [v8 flags] host_node.js <engine-label> <file.js>...
// Files run in order as classic global scripts (vm.runInThisContext), then __bench_tick() is pumped, one call per
// macrotask so promise jobs drain between ticks (as the C hosts do with JS_ExecutePendingJob).
"use strict";
const fs = require("fs"), vm = require("vm");
const pnow = performance.now.bind(performance);
const out = (s) => process.stdout.write(s + "\n");
function readText(p) { try { return fs.readFileSync(p, "utf8"); } catch (e) { return null; } }
globalThis.H = {
  engine: process.argv[2],
  print: out,
  realNow: pnow,
  readText,
  readBin(p) { try { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } catch (e) { return null; } },
  readRange(p, off, len) {
    try {
      const fd = fs.openSync(p, "r"), b = Buffer.alloc(len), n = fs.readSync(fd, b, 0, len, off);
      fs.closeSync(fd);
      return b.buffer.slice(b.byteOffset, b.byteOffset + n);
    } catch (e) { return null; }
  },
  evalScript(p) {
    const src = readText(p);
    if (src === null) return null;
    try { vm.runInThisContext(src, { filename: p }); } catch (e) { out("exception: " + (e && e.stack || e)); }   // still counts as loaded (nx.loadScript)
    return true;
  },
  gc() { if (typeof globalThis.gc === "function") globalThis.gc(); },
  mem() { const m = process.memoryUsage(); return [Math.round(m.heapUsed / 1048576) + "MB", Math.round(m.rss / 1048576) + "MBrss"]; },
};
const t0 = pnow();
for (const f of process.argv.slice(3)) {
  try { vm.runInThisContext(readText(f), { filename: f }); } catch (e) { out("load error in " + f + ": " + (e && e.stack || e)); process.exit(1); }
}
let errors = 0;
function loop() {
  let more;
  try { more = globalThis.__bench_tick(); } catch (e) { out("tick error: " + (e && e.stack || e)); more = ++errors < 30; }
  if (more) setImmediate(loop);
  else { if (globalThis.__bench_done) globalThis.__bench_done(); out("[host] total " + ((pnow() - t0) / 1000).toFixed(1) + " s, " + errors + " tick errors"); }
}
setImmediate(loop);
