globalThis.__nx.loadScript("tests/bench_map74.js");
(function (g) { const o = g.__tick; let d = false;
  g.__tick = function (t) { o(t); if (!d && SceneManager._scene && SceneManager._scene.constructor.name === "Scene_Map" && $gameMap.mapId() === 74) { d = true;
    const ce = $dataCommonEvents[73]; __nx.log("[ce] 73 " + ce.list.map(c => c.code + "(" + c.parameters.join(",").slice(0, 30) + ")@" + c.indent).filter(x => !/^(0|412|411)\(/.test(x)).join(" "));
    const ce2 = $dataCommonEvents[49]; __nx.log("[ce] 49 " + ce2.list.length + " " + ce2.list.map(c => c.code + "(" + c.parameters.join(",").slice(0, 30) + ")@" + c.indent).filter(x => !/^(0|412|411)\(/.test(x)).join(" ").slice(0, 600));
    const w = []; for (const e of $dataCommonEvents) if (e) for (const c of e.list) if ((c.code === 121 && c.parameters[0] <= 2980 && c.parameters[1] >= 2980)) w.push(e.id); __nx.log("[ce] writers of 2980: " + w.join(","));
  } };
})(globalThis);
