(function (g) { const o = g.__tick; let d = false;
  g.__tick = function (t) { o(t); if (d) return; d = true; const r = __nx.modResolve("movies/intro.fhv"); __nx.log("[rng] resolve " + JSON.stringify(r) + " readRange " + typeof __nx.readRange); if (r) { const b = __nx.readRange(r[0], 0, 4); __nx.log("[rng] head " + (b && b.byteLength)); } };
})(globalThis);
