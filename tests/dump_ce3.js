globalThis.__nx.loadScript("tests/bench_map74.js");
(function (g) { const o = g.__tick; let d = false;
  g.__tick = function (t) { o(t); if (!d && SceneManager._scene && SceneManager._scene.constructor.name === "Scene_Map" && $gameMap.mapId() === 74) { d = true;
    for (const id of [39, 41, 40]) { const ce = $dataCommonEvents[id]; const out = []; ce.list.forEach((c, i) => { if (c.code === 355 || c.code === 655 || c.code === 322 || c.code === 205) out.push(i + ":" + c.code + "(" + c.parameters.join(",").slice(0, 90) + ")@" + c.indent); }); __nx.log("[ce] " + id + " " + out.slice(0, 8).join(" | ")); }
    for (const id of [309, 312, 88]) { const ce = $dataCommonEvents[id]; const out = []; ce.list.forEach((c, i) => { if (c.code === 356) out.push(i + ":" + c.parameters[0] + "@" + c.indent); else if (c.code === 111) out.push(i + ":if(" + c.parameters.join(",") + ")"); else if (c.code === 230) out.push("wait" + c.parameters[0]); }); __nx.log("[ce] " + id + " " + out.slice(0, 14).join(" ")); } } };
})(globalThis);
