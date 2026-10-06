globalThis.__nx.loadScript("tests/bench_map74.js");
(function (g) { const o = g.__tick; let d = false;
  g.__tick = function (t) { o(t); if (!d && SceneManager._scene && SceneManager._scene.constructor.name === "Scene_Map" && $gameMap.mapId() === 74) { d = true;
    for (const id of [30, 101, 115]) { const e = $dataMap.events[id]; const pg = e.pages[0]; __nx.log("[ev] " + id + " trig " + pg.trigger + " " + pg.list.map(c => c.code + "(" + c.parameters.join(",").slice(0, 40) + ")@" + c.indent).join(" ")); }
    for (const id of [88, 309, 312]) { const ce = $dataCommonEvents[id]; __nx.log("[ce] " + id + " " + ce.list.filter(c => c.code === 356).map(c => c.parameters[0]).join(" | ")); } } };
})(globalThis);
