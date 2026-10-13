(function (g) { const o = g.__tick; let d = false;
  g.__tick = function (t) { o(t); if (d || !g.Bitmap) return; d = true;
    const mk = () => { const b = new Bitmap(200, 150); const c = b._context; c.fillStyle = "rgb(90,120,60)"; c.fillRect(0, 0, 200, 150); for (let i = 0; i < 400; i++) { c.fillStyle = "rgb(" + ((i * 37) % 256) + "," + ((i * 91) % 256) + "," + ((i * 13) % 256) + ")"; c.fillRect((i * 17) % 200, (i * 29) % 150, 5 + i % 30, 5 + i % 20); } return b; };
    const a = mk(), b = mk(); const t0 = __nx.now();
    // original MV blur = the prototype function saved by boot.js is not exposed, so rebuild it here
    const orig = function () { for (var i = 0; i < 2; i++) { var w = this.width, h = this.height, canvas = this._canvas, context = this._context; var tc = document.createElement("canvas"), tctx = tc.getContext("2d"); tc.width = w + 2; tc.height = h + 2;
      tctx.drawImage(canvas, 0, 0, w, h, 1, 1, w, h); tctx.drawImage(canvas, 0, 0, w, 1, 1, 0, w, 1); tctx.drawImage(canvas, 0, 0, 1, h, 0, 1, 1, h); tctx.drawImage(canvas, 0, h - 1, w, 1, 1, h + 1, w, 1); tctx.drawImage(canvas, w - 1, 0, 1, h, w + 1, 1, 1, h);
      context.save(); context.fillStyle = "black"; context.fillRect(0, 0, w, h); context.globalCompositeOperation = "lighter"; context.globalAlpha = 1 / 9; for (var y = 0; y < 3; y++) for (var x = 0; x < 3; x++) context.drawImage(tc, x, y, w, h, 0, 0, w, h); context.restore(); } };
    orig.call(a); const t1 = __nx.now(); b.blur(); const t2 = __nx.now();
    const da = a._context.getImageData(0, 0, 200, 150).data, db = b._context.getImageData(0, 0, 200, 150).data; let sum = 0, max = 0; for (let i = 0; i < da.length; i++) { const e = Math.abs(da[i] - db[i]); sum += e; if (e > max) max = e; }
    __nx.log("[blur] orig " + (t1 - t0).toFixed(1) + " ms, native " + (t2 - t1).toFixed(1) + " ms, mean abs diff " + (sum / da.length).toFixed(3) + " max " + max); };
})(globalThis);
