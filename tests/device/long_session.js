// Long session: load the save, go to Back_alleys (map 80) and walk in random directions for 12 minutes; every 30 s log the
// frame times (average, worst, frames over 33 ms) and the GC pauses that fell in that window, then quit.
(function (g) {
  const nx = g.__nx, now = () => nx.now(), log = (m) => nx.log("[long] " + m);
  let held = 0, releaseAt = 0, step = 0, at = 0, t0 = 0, w0 = 0, frames = 0, sum = 0, worst = 0, slow = 0, last = 0;
  const DIRS = [1 << 13, 1 << 15, 1 << 12, 1 << 14];   // Up, Down, Left, Right (nx.pad bit layout)
  nx.pad = () => [held >>> 0, 0, 0, 0, 0, 0];
  const press = (b, ms) => { held = b; releaseAt = now() + (ms || 120); };
  const orig = g.__tick;
  g.__tick = function (t) {
    if (held && now() >= releaseAt) held = 0;
    const a = now(); orig(t); const n = now(), dt = last ? n - last : 0; last = n;
    const sc = SceneManager._scene ? SceneManager._scene.constructor.name : "-", win = SceneManager._scene && SceneManager._scene._commandWindow;
    if (step === 0 && sc === "Scene_Title" && win && win.active) { if (!at) at = n; else if (n - at > 1500) { win.selectSymbol("continue"); press(1); step = 1; at = n; } }
    else if (step === 1 && sc === "Scene_Load" && n - at > 2500) { press(1); step = 2; at = n; }
    else if (step === 2 && sc === "Scene_Map" && $gamePlayer.canMove() && n - at > 3000) { g.__debugMenuApply("god 1\nteleport 80\n"); step = 3; at = n; }
    else if (step === 3 && sc === "Scene_Map" && $gameMap.mapId() === 80 && !$gamePlayer.isTransferring() && n - at > 4000) { step = 4; t0 = w0 = n; log("walking on Back_alleys for 12 min"); }
    else if (step === 4) {
      if (!held && Math.random() < 0.05) press(DIRS[(Math.random() * 4) | 0], 300 + Math.random() * 900);
      if (sc === "Scene_Map") { frames++; sum += dt; if (dt > worst) worst = dt; if (dt > 33) slow++; }
      if (n - w0 > 30000) {
        log(((n - t0) / 60000).toFixed(1) + " min: " + frames + " frames, avg " + (sum / Math.max(1, frames)).toFixed(1) + " ms, worst " + worst.toFixed(0) + " ms, " + slow + " over 33 ms, map " + $gameMap.mapId() + " " + sc);
        frames = sum = worst = slow = 0; w0 = n;
      }
      if (n - t0 > 12 * 60000) { step = 5; log("done"); nx.quit(); }
    }
  };
})(globalThis);
