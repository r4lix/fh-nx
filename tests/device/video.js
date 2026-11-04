(function (g) { const o = g.__tick; let n = 0, started = 0, ended = false;
  g.__tick = function (t) { o(t); const sc = SceneManager._scene && SceneManager._scene.constructor.name;
    if (!started && sc === "Scene_Title" && ++n > 120) { started = __nx.now(); const v = document.createElement("video"); v.src = "movies/intro.webm"; v.onloadeddata = () => v.play(); v.onended = () => { ended = true; __nx.log("[video] ended after " + ((__nx.now() - started) / 1000).toFixed(1) + " s"); }; v.load(); __nx.log("[video] started"); }
    if (started && !ended && __nx.now() - started > 6000 && !g.__vlog) { g.__vlog = 1; const st = SceneManager._scene; __nx.log("[video] 6 s in: stage children " + st.children.length + ", last sprite " + (st.children[st.children.length - 1] && st.children[st.children.length - 1].constructor.name)); } };
})(globalThis);
// quit 3 s after the video ended (or after 90 s)
(function (g) { const o = g.__tick, nx = g.__nx, L = nx.log; let end = 0; const t0 = nx.now();
  nx.log = function (m) { if (String(m).indexOf("[video] ended") >= 0) end = nx.now(); return L.apply(this, arguments); };
  g.__tick = function (t) { o(t); const n = nx.now(); if ((end && n - end > 3000) || n - t0 > 90000) { end = 0; L.call(nx, "[video] quitting"); nx.quit(); } };
})(globalThis);
