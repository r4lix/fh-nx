// Uninstrumented yardstick for a heavy map: load the save, then measure real tick cost and logic updates per
// tick over 8 s. Cost per logic update = avg tick / updates per tick (render included).
(function (g) {
  const nx = g.__nx, now = () => nx.now();
  let held = 0, releaseAt = 0;
  nx.pad = () => [held >>> 0, 0, 0, 0, 0, 0];
  const press = (ms) => { held |= 1; releaseAt = now() + (ms || 120); };
  let updates = 0;
  const us = SceneManager.updateScene;
  SceneManager.updateScene = function () { updates++; return us.apply(this, arguments); };
  const orig = g.__tick; let step = 0, stepAt = 0, frames = 0, wall = 0, startOn = 0, on = false, done = false, upd0 = 0;
  g.__tick = function (t) {
    if (held && now() >= releaseAt) held = 0;
    const a = now();
    orig(t);
    const sc = SceneManager._scene ? SceneManager._scene.constructor.name : "-", n = now();
    const win = SceneManager._scene && SceneManager._scene._commandWindow;
    if (step === 0 && sc === "Scene_Title" && win && win.active) { if (!stepAt) stepAt = n; else if (n - stepAt > 1500) { press(); step = 1; stepAt = n; } }
    else if (step === 1 && sc === "Scene_Load" && n - stepAt > 2500) { press(); step = 2; stepAt = n; }
    else if (step === 2 && sc === "Scene_Map" && $gamePlayer.canMove() && !$gameMessage.hasText() && n - stepAt > 5000) { step = 3; on = true; startOn = n; upd0 = updates; nx.log("[bench] map " + $gameMap.mapId() + " measuring"); }
    if (on) { frames++; wall += now() - a; }
    if (on && !done && n - startOn > 8000) {
      done = true; on = false;
      const u = updates - upd0;
      nx.log("[bench] " + frames + " ticks, avg tick " + (wall / frames).toFixed(1) + " ms, " + (u / frames).toFixed(2) + " updates/tick => " + (wall / u).toFixed(1) + " ms per logic update (incl. render share)");
    }
  };
})(globalThis);
