// Parse-only syntax check:  qjs tools/jscheck.js file.js [file.js ...]
import * as std from "qjs:std";
let bad = 0;
for (const f of scriptArgs.slice(1)) {
  const src = std.loadFile(f);
  try { new Function(src); print("ok   " + f); } catch (e) { bad++; print("FAIL " + f + ": " + e.message); }
}
std.exit(bad ? 1 : 0);
