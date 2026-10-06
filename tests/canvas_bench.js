// Timing of the canvas operations TerraxLighting runs every frame: a screen-sized black mask, then
// additive radial-gradient lights. Printed, not asserted (machine dependent).
const nx = globalThis.__nx;
function bench(name, n, fn) { const t = nx.now(); for (let i = 0; i < n; i++) fn(i); const ms = (nx.now() - t) / n; print(name.padEnd(46) + ms.toFixed(3) + " ms per op"); return ms; }
const s = nx.createSurface(1296, 740), c = { _s: s, width: 1296, height: 740 }, ctx = nx.createContext(s, c);
bench("fillRect black, full mask 1296x740", 50, () => { ctx.fillStyle = "#000000"; ctx.fillRect(0, 0, 1296, 740); });
bench("fillRect rgba(0,0,0,0.5) over opaque", 50, () => { ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(0, 0, 1296, 740); });
ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 1296, 740);
ctx.globalCompositeOperation = "lighter";
for (const r of [60, 150, 300]) {
  bench("lighter radial light, radius " + r, 20, () => {
    const g = ctx.createRadialGradient(600, 400, 0, 600, 400, r);
    g.addColorStop(0, "rgba(255,220,150,1)"); g.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = g; ctx.fillRect(600 - r, 400 - r, r * 2, r * 2);
  });
}
ctx.globalCompositeOperation = "source-over";
bench("drawImage 816x624 onto 1296x740 (1:1)", 30, () => ctx.drawImage(c, 0, 0, 816, 624, 100, 50, 816, 624));
const w = nx.createSurface(240, 108), wc = { _s: w, width: 240, height: 108 }, wctx = nx.createContext(w, wc);
bench("window-size fillRect + 3 texts (menu refresh)", 5, () => { wctx.fillStyle = "#222"; wctx.fillRect(0, 0, 240, 108); });
