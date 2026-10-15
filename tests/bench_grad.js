// Microbench: additive radial gradient rect on a small canvas, with/without scale, aligned/unaligned edges.
(function (g) {
  const nx = g.__nx; let done = false, n = 0;
  const o = g.__tick;
  g.__tick = function (t) { o(t); if (done || ++n < 200) return; done = true;
    const run = (label, scale, x, y, r) => {
      const c = document.createElement("canvas"); c.width = Math.ceil(816 / (1 / scale)); c.height = Math.ceil(624 / (1 / scale)); const ctx = c.getContext("2d");
      ctx.fillStyle = "black"; ctx.fillRect(0, 0, c.width, c.height); ctx.scale(scale, scale); ctx.globalCompositeOperation = "lighter";
      const N = 40, t0 = nx.now();
      for (let i = 0; i < N; i++) { const gr = ctx.createRadialGradient(x, y, 20, x, y, r); gr.addColorStop(0, "#ffddaa"); gr.addColorStop(1, "#000000"); ctx.fillStyle = gr; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
      const ms = (nx.now() - t0) / N; nx.log("[grad] " + label + ": " + ms.toFixed(3) + " ms per light (r=" + r + ", canvas " + c.width + "x" + c.height + ")");
    };
    run("scale 1   aligned  ", 1, 400, 300, 120); run("scale 1/2 aligned  ", 0.5, 400, 300, 120); run("scale 1/2 unaligned", 0.5, 401, 301, 121);
    run("scale 1/4 aligned  ", 0.25, 400, 300, 240); run("scale 1/4 unaligned", 0.25, 401, 303, 241); run("scale 1/4 big r=480 ", 0.25, 400, 300, 480);
  };
})(globalThis);
