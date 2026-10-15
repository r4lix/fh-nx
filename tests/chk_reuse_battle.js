globalThis.__troops = [2]; globalThis.__nx.loadScript("tests/bench_battle.js");
(function (g) { const o = g.__tick; let sp0 = null, st = 0, t0 = 0;
  g.__tick = function (t) { o(t); const sc = SceneManager._scene ? SceneManager._scene.constructor.name : "-", n = __nx.now();
    if (st === 0 && sc === "Scene_Map" && SceneManager._scene._spriteset) { sp0 = SceneManager._scene._spriteset; }
    if (st === 0 && sc === "Scene_Battle") st = 1;
    if (st === 1 && sc === "Scene_Map" && SceneManager._scene._spriteset) { st = 2; t0 = n; }
    if (st === 2 && n - t0 > 2500) { st = 3; const sps = SceneManager._scene._spriteset; let hidden = 0, vis = 0; for (const s of sps._characterSprites) { if (s._hidden) hidden++; if (s.visible) vis++; }
      __nx.log("[rb] same spriteset " + (sps === sp0) + " charSprites " + sps._characterSprites.length + " _hidden " + hidden + " visible " + vis + " player visible " + sps._characterSprites.find(s => s._character === $gamePlayer).visible); } };
})(globalThis);
