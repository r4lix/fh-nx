// How fast does the host decode the movie's JPEG frames?
(function (g) {
  const nx = g.__nx; const path = "build/intro.fhv";
  const hl = new DataView(nx.readRange(path, 0, 4)).getUint32(0, true);
  const hdr = JSON.parse(String.fromCharCode.apply(null, new Uint8Array(nx.readRange(path, 4, hl))));
  const t0 = nx.now(); let bytes = 0, n = 60;
  for (let i = 0; i < n; i++) { const [o, l] = hdr.frames[i * 10]; const buf = nx.readRange(path, o, l); bytes += l; const r = nx.decodeImage(buf); if (!r) print("decode failed " + i); }
  const ms = (nx.now() - t0) / n;
  print("[jpeg] " + hdr.w + "x" + hdr.h + ": " + ms.toFixed(2) + " ms per frame (read + decode), avg " + (bytes / n / 1024).toFixed(1) + " KB");
})(globalThis);
