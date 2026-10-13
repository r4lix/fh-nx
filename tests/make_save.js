// Load the map-74 save, teleport to g.__pmap on a passable tile near the map centre, and save it as slot 2.
globalThis.__maps = []; globalThis.__nx.loadScript("tests/bench_maps.js");
(function (g) { const o = g.__tick; let phase = 0, at = 0;
  g.__tick = function (t) { o(t); const sc = SceneManager._scene && SceneManager._scene.constructor.name, n = __nx.now();
    if (phase === 0 && $gamePlayer && $dataMap && sc === "Scene_Map" && g.$gameMap.mapId() === 74 && n > 20000) { 
      let best = null; const id = g.__pmap || 93; phase = 1; at = n; g.__target = id;
      // find passable tile on target map: need its data -> transfer first to centre, then adjust
      $gamePlayer.reserveTransfer(id, 40, 45, 2, 0); }
    else if (phase === 1 && sc === "Scene_Map" && $gameMap.mapId() === g.__target && !$gamePlayer.isTransferring() && n - at > 2500) {
      const w = $gameMap.width(), h = $gameMap.height(); let found = false;
      for (let r = 0; r < 30 && !found; r++) for (let dx = -r; dx <= r && !found; dx++) for (let dy = -r; dy <= r && !found; dy++) { const x = (w >> 1) + dx, y = (h >> 1) + dy; if ($gameMap.isPassable(x, y, 2) && $gameMap.isPassable(x, y, 4) && $gameMap.eventsXy(x, y).length === 0) { $gamePlayer.locate(x, y); found = true; } }
      phase = 2; at = n; }
    else if (phase === 2 && n - at > 3000) { $gameSystem.onBeforeSave(); let ok; try { StorageManager.backup(2); ok = DataManager.saveGameWithoutRescue(2); } catch (e) { ok = "ERR " + e + " " + String(e && e.stack).slice(0, 400); } __nx.log("[save] slot 2 saved=" + ok + " map " + $gameMap.mapId() + " at " + $gamePlayer.x + "," + $gamePlayer.y); phase = 3; } };
})(globalThis);
