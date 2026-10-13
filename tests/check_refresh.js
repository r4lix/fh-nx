// Verify partial refresh: every event's page index must equal what a full refresh would pick (checked when no refresh is pending).
globalThis.__maps = [93, 3, 74, 110, 31]; globalThis.__nx.loadScript("tests/bench_maps.js");
(function (g) { const o = g.__tick; let checks = 0, bad = 0, seen = {}, partials = 0, fulls = 0;
  const pr = Game_Map.prototype.refresh; 
  g.__tick = function (t) { o(t); const sc = SceneManager._scene && SceneManager._scene.constructor.name;
    if (sc === "Scene_Map" && $gameMap && !$gameMap._needsRefresh && !$gamePlayer.isTransferring()) {
      checks++; for (const e of $gameMap.events()) { const want = e._erased ? -1 : e.findProperPageIndex(); if (e._pageIndex !== want) { bad++; const k = $gameMap.mapId() + ":" + e._eventId; if (!seen[k]) { seen[k] = 1; __nx.log("[chk] MISMATCH map " + k + " have " + e._pageIndex + " want " + want); } } } }
    if (checks && checks % 400 === 0 && !g.__lg) { g.__lg = 1; } if (checks % 400 === 1) g.__lg = 0;
    if (checks && checks % 400 === 0) __nx.log("[chk] checks " + checks + " mismatches " + bad); };
})(globalThis);
