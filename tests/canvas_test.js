// Canvas 2D host tests. Run through tests/canvas_host: pixel-exact where the maths is exact, with a
// small tolerance for anti-aliased edges. Also writes a few PPMs for eyeballing.
const nx = globalThis.__nx;
globalThis.__failures = 0;
let checks = 0;

function fail(msg) { globalThis.__failures++; print("FAIL " + msg); }
function eq(name, got, want, tol = 0) {
  checks++;
  const g = Array.isArray(got) ? got : [got], w = Array.isArray(want) ? want : [want];
  for (let i = 0; i < w.length; i++) if (Math.abs(g[i] - w[i]) > tol) { fail(name + ": got [" + g + "] want [" + w + "] tol " + tol); return; }
}
function ok(name, cond) { checks++; if (!cond) fail(name); }

function mk(w, h) {
  const s = nx.createSurface(w, h);
  const canvas = { _s: s, width: w, height: h };
  const ctx = nx.createContext(s, canvas);
  return { s, canvas, ctx };
}
function px(ctx, x, y) { const d = ctx.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2], d[3]]; }
function count(ctx, w, h, pred) {
  const d = ctx.getImageData(0, 0, w, h).data;
  let n = 0;
  for (let i = 0; i < w * h; i++) if (pred(d[i * 4], d[i * 4 + 1], d[i * 4 + 2], d[i * 4 + 3])) n++;
  return n;
}
function dump(name, t) { nx.writePPM(name, nx.surfaceBuffer(t.s), t.canvas.width, t.canvas.height); }

// ---- fillRect, colours, state --------------------------------------------------------------------
{
  const { ctx } = mk(20, 20);
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(2, 3, 5, 4);
  eq("fillRect inside", px(ctx, 2, 3), [255, 0, 0, 255]);
  eq("fillRect last px", px(ctx, 6, 6), [255, 0, 0, 255]);
  eq("fillRect outside right", px(ctx, 7, 3), [0, 0, 0, 0]);
  eq("fillRect outside below", px(ctx, 2, 7), [0, 0, 0, 0]);
  ctx.fillStyle = "rgba(0, 0, 255, 0.5)";
  ctx.fillRect(2, 3, 1, 1);
  eq("alpha over opaque", px(ctx, 2, 3), [128, 0, 128, 255], 2);
  ctx.fillRect(10, 10, 1, 1);
  eq("alpha over empty keeps colour", px(ctx, 10, 10), [0, 0, 255, 128], 1);
  ctx.fillStyle = "#0f0";
  eq("fillStyle getter", ctx.fillStyle, "#00ff00");
  ctx.fillStyle = "garbage";
  eq("bad colour ignored", ctx.fillStyle, "#00ff00");
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.globalAlpha = 0.5;
  ctx.globalCompositeOperation = "bogus";
  eq("bad composite ignored", ctx.globalCompositeOperation, "source-over");
}

// ---- save / restore ----------------------------------------------------------------------------
{
  const { ctx } = mk(8, 8);
  ctx.fillStyle = "#123456";
  ctx.save();
  ctx.fillStyle = "#abcdef";
  ctx.globalAlpha = 0.3;
  ctx.translate(2, 2);
  ctx.restore();
  eq("restore fillStyle", ctx.fillStyle, "#123456");
  eq("restore alpha", ctx.globalAlpha, 1);
  ctx.fillRect(0, 0, 1, 1);
  eq("restore transform", px(ctx, 0, 0), [0x12, 0x34, 0x56, 255]);
}

// ---- transforms --------------------------------------------------------------------------------
{
  const { ctx } = mk(20, 20);
  ctx.fillStyle = "#00ff00";
  ctx.translate(5, 5);
  ctx.scale(2, 2);
  ctx.fillRect(1, 1, 2, 2);                 // device (7,7)-(11,11)
  eq("transform inside", px(ctx, 7, 7), [0, 255, 0, 255]);
  eq("transform edge", px(ctx, 10, 10), [0, 255, 0, 255]);
  eq("transform outside", px(ctx, 11, 11), [0, 0, 0, 0]);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillRect(0, 0, 1, 1);
  eq("setTransform reset", px(ctx, 0, 0), [0, 255, 0, 255]);
}

// ---- clearRect / destination-out / copy -------------------------------------------------------
{
  const { ctx } = mk(10, 10);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 10, 10);
  ctx.clearRect(2, 2, 3, 3);
  eq("clearRect", px(ctx, 3, 3), [0, 0, 0, 0]);
  eq("clearRect neighbour intact", px(ctx, 5, 5), [255, 255, 255, 255]);
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(6, 6, 2, 2);
  eq("destination-out half", px(ctx, 6, 6)[3], 128, 2);
}

// ---- lighter / lighten / multiply --------------------------------------------------------------
{
  const { ctx } = mk(4, 4);
  ctx.fillStyle = "#100000";
  ctx.fillRect(0, 0, 4, 4);
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = "#200010";
  ctx.fillRect(0, 0, 1, 1);
  eq("lighter adds", px(ctx, 0, 0), [0x30, 0, 0x10, 255]);
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(1, 0, 1, 1);
  eq("lighter clamps", px(ctx, 1, 0), [255, 0, 0, 255]);
  ctx.globalCompositeOperation = "lighten";
  ctx.fillStyle = "#050830";
  ctx.fillRect(2, 0, 1, 1);
  eq("lighten max", px(ctx, 2, 0), [0x10, 0x08, 0x30, 255]);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = "#808080";
  ctx.fillRect(3, 0, 1, 1);
  eq("multiply", px(ctx, 3, 0)[0], 8, 1);
}

// ---- drawImage ---------------------------------------------------------------------------------
{
  const src = mk(4, 4);
  src.ctx.fillStyle = "#ff0000"; src.ctx.fillRect(0, 0, 2, 4);
  src.ctx.fillStyle = "#0000ff"; src.ctx.fillRect(2, 0, 2, 4);
  const dst = mk(16, 16);
  dst.ctx.drawImage(src.canvas, 1, 1);
  eq("drawImage 1:1 left", px(dst.ctx, 1, 1), [255, 0, 0, 255]);
  eq("drawImage 1:1 right", px(dst.ctx, 4, 4), [0, 0, 255, 255]);
  eq("drawImage 1:1 beyond", px(dst.ctx, 5, 1), [0, 0, 0, 0]);
  dst.ctx.drawImage(src.canvas, 2, 0, 2, 4, 8, 8, 4, 8);    // right half stretched 2x
  eq("drawImage src rect", px(dst.ctx, 8, 8), [0, 0, 255, 255]);
  eq("drawImage src rect far corner", px(dst.ctx, 11, 15), [0, 0, 255, 255]);
  eq("drawImage src rect outside", px(dst.ctx, 12, 8), [0, 0, 0, 0]);
  dst.ctx.imageSmoothingEnabled = false;
  dst.ctx.drawImage(src.canvas, 0, 0, 4, 4, 0, 8, 8, 8);
  eq("drawImage nearest edge", px(dst.ctx, 3, 8), [255, 0, 0, 255]);
  eq("drawImage nearest edge 2", px(dst.ctx, 4, 8), [0, 0, 255, 255]);
  dst.ctx.imageSmoothingEnabled = true;
  const smooth = mk(8, 8);
  smooth.ctx.drawImage(src.canvas, 0, 0, 4, 4, 0, 0, 8, 8);
  const mid = px(smooth.ctx, 4, 0);
  ok("drawImage bilinear blends at the seam", mid[0] > 20 && mid[2] > 20 && mid[3] === 255);
  // alpha + globalAlpha
  const a = mk(4, 4);
  a.ctx.fillStyle = "rgba(255,255,255,0.5)"; a.ctx.fillRect(0, 0, 4, 4);
  const b = mk(4, 4);
  b.ctx.fillStyle = "#000000"; b.ctx.fillRect(0, 0, 4, 4);
  b.ctx.globalAlpha = 0.5;
  b.ctx.drawImage(a.canvas, 0, 0);
  eq("drawImage alpha x globalAlpha", px(b.ctx, 0, 0)[0], 64, 2);
  // flipped destination
  const f = mk(4, 4);
  f.ctx.drawImage(src.canvas, 0, 0, 4, 4, 4, 0, -4, 4);
  eq("drawImage mirrored", px(f.ctx, 0, 0), [0, 0, 255, 255]);
}

// ---- scaled drawImage vs a reference bilinear sampler ---------------------------------------------
{
  function refScale(src, sw, sh, dw, dh) {                         // pixel-centre mapping, edge clamp, premultiplied taps
    const out = [];
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
      const fu = (x + 0.5) * sw / dw - 0.5, fv = (y + 0.5) * sh / dh - 0.5;
      const x0 = Math.floor(fu), y0 = Math.floor(fv), ax = fu - x0, ay = fv - y0;
      const cl = (v, m) => Math.max(0, Math.min(m - 1, v));
      let A = 0, R = 0, G = 0, B = 0;
      for (const [dx, dy, w] of [[0, 0, (1 - ax) * (1 - ay)], [1, 0, ax * (1 - ay)], [0, 1, (1 - ax) * ay], [1, 1, ax * ay]]) {
        const p = src[cl(y0 + dy, sh) * sw + cl(x0 + dx, sw)];
        A += p[3] * w; R += p[0] * p[3] * w; G += p[1] * p[3] * w; B += p[2] * p[3] * w;
      }
      out.push(A > 0 ? [R / A, G / A, B / A, A] : [0, 0, 0, 0]);
    }
    return out;
  }
  function makeImage(pixels, w, h) {
    const t = mk(w, h);
    const d = t.ctx.createImageData(w, h);
    pixels.forEach((p, i) => { d.data[i * 4] = p[0]; d.data[i * 4 + 1] = p[1]; d.data[i * 4 + 2] = p[2]; d.data[i * 4 + 3] = p[3]; });
    t.ctx.putImageData(d, 0, 0);
    return t;
  }
  const cases = [
    ["opaque 3x2 -> 9x6", [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 0, 255], [0, 255, 255, 255], [255, 0, 255, 255]], 3, 2, 9, 6],
    ["opaque 4x4 -> 2x2 (down)", Array.from({ length: 16 }, (_, i) => [i * 16, 255 - i * 16, (i * 37) % 256, 255]), 4, 4, 2, 2],
    ["with transparency 2x2 -> 6x6", [[255, 0, 0, 255], [0, 0, 255, 0], [0, 255, 0, 128], [255, 255, 255, 255]], 2, 2, 6, 6],
  ];
  for (const [name, pix, sw, sh, dw, dh] of cases) {
    const src = makeImage(pix, sw, sh), dst = mk(dw, dh);
    dst.ctx.drawImage(src.canvas, 0, 0, sw, sh, 0, 0, dw, dh);
    const want = refScale(pix, sw, sh, dw, dh), got = dst.ctx.getImageData(0, 0, dw, dh).data;
    let worst = 0;
    for (let i = 0; i < dw * dh; i++) {
      const w = want[i], a = got[i * 4 + 3];
      worst = Math.max(worst, Math.abs(a - w[3]));
      if (w[3] > 2) for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(got[i * 4 + k] - w[k]));
    }
    ok("scaled drawImage matches reference: " + name + " (worst error " + worst.toFixed(1) + ")", worst <= 3);
  }
  const part = mk(10, 10);
  part.ctx.drawImage(makeImage([[9, 9, 9, 255]], 1, 1).canvas, 0, 0, 1, 1, 2.5, 2.5, 4, 4);   // fractional destination: edges only by pixel centres
  ok("fractional destination fills the covered centres", px(part.ctx, 4, 4)[3] === 255 && px(part.ctx, 1, 1)[3] === 0);
}

// ---- native adjustTone (Bitmap.adjustTone) ----------------------------------------------------------
{
  const { ctx } = mk(3, 1);
  ctx.fillStyle = "rgb(100, 200, 250)"; ctx.fillRect(0, 0, 2, 1);
  ctx.__adjustTone(20, -30, 30);
  eq("adjustTone adds and clamps", px(ctx, 0, 0), [120, 170, 255, 255]);
  eq("adjustTone leaves alpha alone (transparent pixel keeps alpha 0)", px(ctx, 2, 0), [20, 0, 30, 0]);
  ctx.__adjustTone(-255, -255, -255);
  eq("adjustTone clamps at zero", px(ctx, 0, 0), [0, 0, 0, 255]);
}

// ---- gradients ---------------------------------------------------------------------------------
{
  const { ctx } = mk(100, 4);
  const g = ctx.createLinearGradient(0, 0, 100, 0);
  g.addColorStop(0, "#000000");
  g.addColorStop(1, "#ffffff");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 100, 4);
  eq("linear start", px(ctx, 0, 1)[0], 1, 3);
  eq("linear middle", px(ctx, 50, 1)[0], 128, 4);
  eq("linear end", px(ctx, 99, 1)[0], 254, 3);
  const r = mk(40, 40);
  const rg = r.ctx.createRadialGradient(20, 20, 0, 20, 20, 20);
  rg.addColorStop(0, "rgba(255,255,255,1)");
  rg.addColorStop(1, "rgba(255,255,255,0)");
  r.ctx.fillStyle = rg;
  r.ctx.fillRect(0, 0, 40, 40);
  eq("radial centre opaque", px(r.ctx, 20, 20)[3], 255, 12);
  eq("radial halfway", px(r.ctx, 30, 20)[3], 128, 12);
  eq("radial corner transparent", px(r.ctx, 0, 0)[3], 0);
}

// ---- paths -------------------------------------------------------------------------------------
{
  const t = mk(60, 60);
  const ctx = t.ctx;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(30, 30, 20, 0, Math.PI * 2);
  ctx.fill();
  eq("arc centre", px(ctx, 30, 30), [255, 255, 255, 255]);
  eq("arc outside", px(ctx, 5, 5)[3], 0);
  const area = count(ctx, 60, 60, (r, g, b, a) => a > 127);
  ok("arc area ~ pi r^2 (" + area + ")", Math.abs(area - Math.PI * 400) < 25);
  // triangle
  const t2 = mk(20, 20);
  t2.ctx.fillStyle = "#ff0000";
  t2.ctx.beginPath(); t2.ctx.moveTo(2, 2); t2.ctx.lineTo(18, 2); t2.ctx.lineTo(2, 18); t2.ctx.closePath(); t2.ctx.fill();
  eq("triangle inside", px(t2.ctx, 4, 4), [255, 0, 0, 255]);
  eq("triangle outside", px(t2.ctx, 16, 16)[3], 0);
  // stroke
  const t3 = mk(30, 30);
  t3.ctx.strokeStyle = "#00ff00"; t3.ctx.lineWidth = 4;
  t3.ctx.beginPath(); t3.ctx.moveTo(5, 15); t3.ctx.lineTo(25, 15); t3.ctx.stroke();
  eq("stroke centre", px(t3.ctx, 15, 15), [0, 255, 0, 255]);
  eq("stroke last row inside", px(t3.ctx, 15, 16)[3], 255, 3);
  eq("stroke first row outside", px(t3.ctx, 15, 17)[3], 0, 3);
  eq("stroke far outside", px(t3.ctx, 15, 20)[3], 0);
  // rect() + fill with a hole winding: nonzero keeps same-direction inner rect filled
  const t4 = mk(20, 20);
  t4.ctx.fillStyle = "#ffffff";
  t4.ctx.beginPath(); t4.ctx.rect(2, 2, 16, 16); t4.ctx.fill();
  eq("rect path fill", px(t4.ctx, 10, 10), [255, 255, 255, 255]);
  dump("paths.ppm", t);
}

// ---- clip --------------------------------------------------------------------------------------
{
  const { ctx } = mk(20, 20);
  ctx.save();
  ctx.beginPath(); ctx.rect(5, 5, 6, 6); ctx.clip();
  ctx.fillStyle = "#ff00ff";
  ctx.fillRect(0, 0, 20, 20);
  eq("clip inside", px(ctx, 7, 7), [255, 0, 255, 255]);
  eq("clip outside", px(ctx, 2, 2)[3], 0);
  eq("clip edge in", px(ctx, 10, 10)[3], 255);
  eq("clip edge out", px(ctx, 11, 11)[3], 0);
  ctx.restore();
  ctx.fillRect(0, 0, 1, 1);
  eq("clip removed by restore (fillStyle back to black)", px(ctx, 0, 0), [0, 0, 0, 255]);
}

// ---- image data --------------------------------------------------------------------------------
{
  const { ctx } = mk(6, 6);
  const img = ctx.createImageData(2, 2);
  for (let i = 0; i < 16; i++) img.data[i] = i * 10;
  ctx.putImageData(img, 1, 1);
  eq("putImageData", px(ctx, 1, 1), [0, 10, 20, 30]);
  eq("putImageData second px", px(ctx, 2, 1), [40, 50, 60, 70]);
  const back = ctx.getImageData(0, 0, 3, 3);
  eq("getImageData size", [back.width, back.height, back.data.length], [3, 3, 36]);
  eq("getImageData offset", [back.data[(1 * 3 + 1) * 4], back.data[(1 * 3 + 1) * 4 + 3]], [0, 30]);
  const off = ctx.getImageData(-1, -1, 2, 2);
  eq("getImageData outside is transparent", off.data[3], 0);
  eq("getImageData clipped px", off.data[(1 * 2 + 1) * 4 + 3], 0);
}

// ---- surface buffer is the live pixel store ---------------------------------------------------
{
  const { s, ctx } = mk(4, 4);
  const view = new Uint8Array(nx.surfaceBuffer(s));
  ctx.fillStyle = "#010203";
  ctx.fillRect(0, 0, 4, 4);
  eq("surfaceBuffer sees draws", [view[0], view[1], view[2], view[3]], [1, 2, 3, 255]);
  view[0] = 99;
  eq("draws see surfaceBuffer writes", px(ctx, 0, 0)[0], 99);
  nx.surfaceResize(s, 8, 2);
  eq("resize clears", px(ctx, 0, 0), [0, 0, 0, 0]);
  eq("old view stays valid memory", view.length, 64);
  const tooBig = (() => { try { nx.createSurface(100000, 100000); return false; } catch (e) { return true; } })();
  ok("oversized surface throws", tooBig);
}

// ---- PNG decode --------------------------------------------------------------------------------
{
  const hex = "89504e470d0a1a0a0000000d49484452000000040000000208060000007fa87d630000002349444154789c63f8cfc0f01f0c19fe377089c801292060005227528cfe333231b30000ed260d1a503bf6940000000049454e44ae426082";
  const bytes = new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));
  const r = nx.decodeImage(bytes.buffer);
  ok("decodeImage returns an image", r && r.width === 4 && r.height === 2);
  const c = { _s: r.surface, width: r.width, height: r.height };
  const ctx = nx.createContext(r.surface, c);
  eq("png px 0 (opaque red)", px(ctx, 0, 0), [255, 0, 0, 255]);
  eq("png px 2 keeps straight alpha", px(ctx, 2, 0), [0, 0, 255, 128]);
  eq("png px 3 (transparent)", px(ctx, 3, 0)[3], 0);
  eq("png row 2", px(ctx, 2, 1), [200, 100, 50, 255]);
  const dst = mk(8, 4);
  dst.ctx.drawImage(c, 0, 0);
  eq("decoded image drawImage", px(dst.ctx, 1, 0), [0, 255, 0, 255]);
  eq("decoded image drawImage (alpha blend onto empty)", px(dst.ctx, 2, 0), [0, 0, 255, 128], 1);
  ok("garbage is not an image", nx.decodeImage(new ArrayBuffer(32)) === null);
  ok("truncated png is not an image", nx.decodeImage(bytes.slice(0, 40).buffer) === null);
  ok("non-buffer arg is null", nx.decodeImage("x") === null);
  const view = new Uint8Array(nx.surfaceBuffer(r.surface));
  eq("surfaceBuffer over decoded pixels", [view[0], view[1], view[2], view[3]], [255, 0, 0, 255]);
}

// ---- text --------------------------------------------------------------------------------------
{
  ok("registerFont", nx.registerFont("TestFont", nx.fontPath));
  const t = mk(300, 120);
  const ctx = t.ctx;
  ctx.font = "28px TestFont, sans-serif";
  const w = ctx.measureText("Hello World").width;
  ok("measureText width plausible (" + w.toFixed(1) + ")", w > 90 && w < 260);
  ok("measureText empty", ctx.measureText("").width === 0);
  ctx.font = "56px TestFont";
  ok("measureText scales with size", Math.abs(ctx.measureText("Hello World").width - 2 * w) < 4);
  ctx.font = "28px TestFont";
  ctx.fillStyle = "#ffffff";
  ctx.fillText("Hello World", 10, 40);
  const lit = count(ctx, 300, 120, (r, g, b, a) => a > 0);
  ok("fillText draws (" + lit + " px)", lit > 200);
  const ink = ctx.getImageData(0, 0, 300, 120).data;
  let minX = 999, maxX = -1, minY = 999, maxY = -1;
  for (let y = 0; y < 120; y++) for (let x = 0; x < 300; x++) if (ink[(y * 300 + x) * 4 + 3] > 0) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  ok("text starts near x=10 (" + minX + ")", minX >= 8 && minX <= 14);
  ok("text ink width ~ measured (" + (maxX - minX) + ")", Math.abs((maxX - minX) - w) < w * 0.15);
  ok("baseline at y=40: ink mostly above (" + minY + ".." + maxY + ")", minY < 40 && maxY < 52 && maxY >= 38);

  // alignment
  const c = mk(300, 60);
  c.ctx.font = "28px TestFont"; c.ctx.fillStyle = "#fff"; c.ctx.textAlign = "center";
  c.ctx.fillText("Hello", 150, 40);
  const cd = c.ctx.getImageData(0, 0, 300, 60).data;
  let cmin = 999, cmax = -1;
  for (let y = 0; y < 60; y++) for (let x = 0; x < 300; x++) if (cd[(y * 300 + x) * 4 + 3] > 0) { cmin = Math.min(cmin, x); cmax = Math.max(cmax, x); }
  ok("textAlign center (" + cmin + ".." + cmax + ")", Math.abs((cmin + cmax) / 2 - 150) < 6);
  const r = mk(300, 60);
  r.ctx.font = "28px TestFont"; r.ctx.fillStyle = "#fff"; r.ctx.textAlign = "right";
  r.ctx.fillText("Hello", 290, 40);
  const rd = r.ctx.getImageData(0, 0, 300, 60).data;
  let rmax = -1;
  for (let y = 0; y < 60; y++) for (let x = 0; x < 300; x++) if (rd[(y * 300 + x) * 4 + 3] > 0) rmax = Math.max(rmax, x);
  ok("textAlign right (" + rmax + ")", rmax >= 280 && rmax <= 292);

  // maxWidth compresses
  const m = mk(300, 60);
  m.ctx.font = "28px TestFont"; m.ctx.fillStyle = "#fff";
  m.ctx.fillText("Hello World", 0, 40, 80);
  const md = m.ctx.getImageData(0, 0, 300, 60).data;
  let mmax = -1;
  for (let y = 0; y < 60; y++) for (let x = 0; x < 300; x++) if (md[(y * 300 + x) * 4 + 3] > 0) mmax = Math.max(mmax, x);
  ok("maxWidth compresses (" + mmax + ")", mmax <= 82 && mmax >= 60);

  // outline: strokeText grows the ink, fill on top keeps the interior
  const o = mk(300, 80);
  o.ctx.font = "40px TestFont"; o.ctx.lineWidth = 6; o.ctx.lineJoin = "round";
  o.ctx.strokeStyle = "#000000"; o.ctx.fillStyle = "#ffffff";
  o.ctx.strokeText("Hi", 10, 55);
  const strokeOnly = count(o.ctx, 300, 80, (r, g, b, a) => a > 0);
  o.ctx.fillText("Hi", 10, 55);
  const plain = mk(300, 80);
  plain.ctx.font = "40px TestFont"; plain.ctx.fillStyle = "#ffffff"; plain.ctx.fillText("Hi", 10, 55);
  const plainInk = count(plain.ctx, 300, 80, (r, g, b, a) => a > 0);
  ok("stroke ink exceeds fill ink (" + strokeOnly + " vs " + plainInk + ")", strokeOnly > plainInk * 1.4);
  const white = count(o.ctx, 300, 80, (r, g, b, a) => r > 200 && a > 200);
  ok("fill drawn over outline (" + white + " white px)", white > plainInk * 0.5);
  dump("text.ppm", o);

  // a menu-like composite for the eyes
  const demo = mk(360, 160);
  demo.ctx.fillStyle = "rgba(30,30,80,0.9)"; demo.ctx.fillRect(0, 0, 360, 160);
  const gr = demo.ctx.createLinearGradient(0, 0, 360, 0);
  gr.addColorStop(0, "#c0392b"); gr.addColorStop(1, "#f1c40f");
  demo.ctx.fillStyle = gr; demo.ctx.fillRect(10, 10, 340, 12);
  demo.ctx.font = "30px TestFont"; demo.ctx.textBaseline = "alphabetic";
  demo.ctx.lineWidth = 4; demo.ctx.lineJoin = "round"; demo.ctx.strokeStyle = "#000"; demo.ctx.fillStyle = "#fff";
  demo.ctx.strokeText("Fear & Hunger", 14, 62); demo.ctx.fillText("Fear & Hunger", 14, 62);
  demo.ctx.font = "22px TestFont"; demo.ctx.fillStyle = "#9fe";
  demo.ctx.fillText("Attack  Skill  Item  Run", 14, 100);
  demo.ctx.save(); demo.ctx.beginPath(); demo.ctx.arc(300, 110, 30, 0, Math.PI * 2); demo.ctx.clip();
  const rg = demo.ctx.createRadialGradient(300, 110, 2, 300, 110, 30);
  rg.addColorStop(0, "#fff"); rg.addColorStop(1, "rgba(255,200,0,0)");
  demo.ctx.fillStyle = rg; demo.ctx.fillRect(260, 70, 80, 80); demo.ctx.restore();
  dump("demo.ppm", demo);
}

print(globalThis.__failures ? globalThis.__failures + " FAILED of " + checks + " checks" : "all " + checks + " checks passed");
