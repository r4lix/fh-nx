// Map transfer latency: from reserveTransfer to controllable, and the worst single tick (a stall the player feels).
(function (g) {
  const nx = g.__nx, now = () => nx.now();
  const MAPS = g.__maps || [3, 93, 110, 74, 31, 53];
  let held = 0, releaseAt = 0; nx.pad = () => [held >>> 0, 0, 0, 0, 0, 0];
  const press = (ms) => { held |= 1; releaseAt = now() + (ms || 120); };
  const orig = g.__tick; let step = 0, stepAt = 0, mi = -1, t0 = 0, worst = 0, ticks = 0, phase = "", totalTicks = 0, big = 0;
  g.__tick = function (t) {
    if (held && now() >= releaseAt) held = 0;
    const a = now(); orig(t); const d = now() - a, sc = SceneManager._scene ? SceneManager._scene.constructor.name : "-", n = now();
    const win = SceneManager._scene && SceneManager._scene._commandWindow;
    if (step === 0 && sc === "Scene_Title" && win && win.active) { if (!stepAt) stepAt = n; else if (n - stepAt > 1500) { press(); step = 1; stepAt = n; } }
    else if (step === 1 && sc === "Scene_Load" && n - stepAt > 2500) { press(); step = 2; stepAt = n; }
    else if (step === 2 && sc === "Scene_Map" && $gamePlayer.canMove() && n - stepAt > 4000) { step = 3; phase = "next"; }
    if (step === 3) {
      if (phase === "next") {
        if (++mi >= MAPS.length) { nx.log("[xfer] done"); step = 4; return; }
        $gameMessage.clear(); $gamePlayer.reserveTransfer(MAPS[mi], 40, 45, 2, 0); phase = "loading"; t0 = n; worst = 0; ticks = 0; big = 0;
      } else if (phase === "loading") {
        ticks++; if (d > worst) worst = d; if (d > 100) big += d;
        if (sc === "Scene_Map" && $gameMap.mapId() === MAPS[mi] && !$gamePlayer.isTransferring() && $gamePlayer.canMove() && !$gameMessage.isBusy() && SceneManager._scene._spriteset) {
          nx.log("[xfer] -> map " + MAPS[mi] + " " + $dataMapInfos[MAPS[mi]].name + ": " + (n - t0).toFixed(0) + " ms to controllable, " + ticks + " ticks, worst tick " + worst.toFixed(0) + " ms, ticks>100ms total " + big.toFixed(0) + " ms");
          phase = "settle"; stepAt = n; }
        else if (n - t0 > 20000) { nx.log("[xfer] timeout map " + MAPS[mi] + " scene " + sc); phase = "settle"; stepAt = n; }
      } else if (phase === "settle" && n - stepAt > 2500) phase = "next";
    }
  };
})(globalThis);
