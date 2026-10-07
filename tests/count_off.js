globalThis.__nx.loadScript("tests/bench_map74.js");
(function (g) { const o = g.__tick; let t0 = 0, d = false;
  g.__tick = function (t) { o(t); const sc = SceneManager._scene && SceneManager._scene.constructor.name;
    if (!t0 && sc === "Scene_Map" && $gameMap && $gameMap.mapId() === 74) t0 = __nx.now() + 4000;
    if (t0 && !d && __nx.now() > t0) { d = true; const cs = SceneManager._scene._spriteset._characterSprites; let off = 0, vis = 0, tr = 0; for (const s of cs) { if (s.__off) off++; if (s.visible) vis++; if (s._character && s._character.isTransparent && s._character.isTransparent()) tr++; }
      __nx.log("[off] sprites " + cs.length + " off " + off + " visible " + vis + " transparent " + tr + " tilemapChildren " + SceneManager._scene._spriteset._tilemap.children.length); } };
})(globalThis);
