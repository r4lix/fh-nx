(function (g) { const o = g.__tick; let d = false, n = 0;
  g.__tick = function (t) { o(t); n++; if (d || n < 30 || !g.$dataTroops) return; d = true;
    const T = g.$dataTroops; const t0 = __nx.now(); const tr = T[2]; const t1 = __nx.now();
    __nx.log("[troops] isArray " + Array.isArray(T) + " length " + T.length + " T[0] " + T[0] + " T[2].name " + (tr && tr.name) + " members " + (tr && tr.members.length) + " pages " + (tr && tr.pages.length) + " first access " + (t1 - t0).toFixed(1) + " ms");
    let cnt = 0; T.forEach((x) => { if (x) cnt++; }); const f = T.filter((x) => x && x.members.length > 3).length; __nx.log("[troops] forEach non-null " + cnt + " filter(>3 members) " + f + " troop 221 id " + (T[221] && T[221].id) + " out of range " + T[500]); };
})(globalThis);
