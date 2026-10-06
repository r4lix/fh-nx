globalThis.__nx.loadScript("tests/bench_map74.js");
(function (g) { const o = g.__tick; let d = false;
  g.__tick = function (t) { o(t); if (!d && $gameMap && $gameMap.mapId && SceneManager._scene && SceneManager._scene.constructor.name === "Scene_Map") { d = true;
    for (const id of [73, 41, 39]) { const ce = $dataCommonEvents[id]; __nx.log("[ce] " + id + " trig " + ce.trigger + " sw " + ce.switchId + " name " + ce.name);
      __nx.log("[ce] " + ce.list.slice(0, 40).map(c => c.code + (c.code === 111 ? "(" + c.parameters.join(",") + ")" : c.code === 117 ? "(" + c.parameters[0] + ")" : "") + "@" + c.indent).join(" ")); } } };
})(globalThis);
