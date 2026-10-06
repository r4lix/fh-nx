// Plays the opening through the pad on the PC harness: nx.pad() is scripted, so MV sees real gamepad
// presses (A = New Game, A = pick the Mercenary, d-pad to OK in the name box, A = confirm), then logs
// what the game is doing every 2 s.
(function (g) {
  const nx = g.__nx;
  const BIT = { A: 0, B: 1, X: 2, Y: 3, LEFT: 12, UP: 13, RIGHT: 14, DOWN: 15 };
  let held = 0, releaseAt = 0;
  nx.pad = () => [held >>> 0, 0, 0, 0, 0, 0];
  const press = (name, ms) => { held |= 1 << BIT[name]; releaseAt = nx.now() + (ms || 120); };
  const orig = g.__tick;
  let step = 0, stepAt = 0, lastLog = 0, t0 = nx.now();
  const sceneName = () => (SceneManager._scene ? SceneManager._scene.constructor.name : "-");
  g.__tick = function (t) {
    if (held && nx.now() >= releaseAt) held = 0;
    orig(t);
    const sc = sceneName(), now = nx.now();
    const since = () => now - stepAt;
    const next = () => { step++; stepAt = now; };
    switch (step) {
      case 0: if (sc === "Scene_Title" && SceneManager._scene._commandWindow && SceneManager._scene._commandWindow.active) { if (!stepAt) stepAt = now; if (since() > 1500) { press("A"); next(); } } break;
      case 1: if (sc === "Scene_Map" && since() > 6000) { nx.log("[play] char select: A"); press("A"); next(); } break;
      case 2: if (sc === "Scene_Name" && since() > 2000) { nx.log("[play] name entry: UP"); press("UP"); next(); } break;
      case 3: if (since() > 600) { press("LEFT"); next(); } break;
      case 4: if (since() > 600) { nx.log("[play] name entry: A (OK)"); press("A"); next(); } break;
      default: break;
    }
    if (now - lastLog > 2000 && step >= 1) {
      lastLog = now;
      const mi = $gameMap && $gameMap._interpreter;
      nx.log("[play +" + ((now - t0) / 1000).toFixed(0) + "s] step " + step + " scene " + sc + " map " + ($gameMap ? $gameMap.mapId() : "-") +
        " interp " + (mi && mi.isRunning()) + " msg " + $gameMessage.hasText() + " canMove " + ($gamePlayer && $gamePlayer.canMove()) +
        " video " + Graphics.isVideoPlaying() + " tone " + JSON.stringify($gameScreen && $gameScreen._tone) + " at " + ($gamePlayer && $gamePlayer.x) + "," + ($gamePlayer && $gamePlayer.y));
    }
  };
})(globalThis);
