// New Game on the PC, then watch whether the opening events finish and the player gets control.
(function (g) {
  const nx = g.__nx;
  let started = false, t0 = 0, lastLog = 0;
  const orig = g.__tick;
  g.__tick = function (t) {
    orig(t);
    const sc = SceneManager._scene, name = sc ? sc.constructor.name : "-";
    if (!started && name === "Scene_Title" && sc._commandWindow) { if (!t0) t0 = nx.now(); if (nx.now() - t0 > 2500) { started = true; t0 = nx.now(); sc.commandNewGame(); } }
    if (started && nx.now() - lastLog > 2000 && name === "Scene_Map") {
      lastLog = nx.now();
      nx.log("[flow +" + ((nx.now() - t0) / 1000).toFixed(0) + "s] scene " + name + " interpreter " + $gameMap._interpreter.isRunning() +
        " msg " + $gameMessage.hasText() + " canMove " + $gamePlayer.canMove() + " video " + Graphics.isVideoPlaying() +
        " tone " + JSON.stringify($gameScreen._tone) + " map " + $gameMap.mapId() + " at " + $gamePlayer.x + "," + $gamePlayer.y);
    }
  };
})(globalThis);
