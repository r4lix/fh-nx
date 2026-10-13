// Teleport through a list of maps from the loaded save and measure tick cost / logic updates per tick on each.
// MAPS=3,31,... via globalThis.__maps (default below). Player is placed on the first event of the map.
(function (g) {
  const nx = g.__nx, now = () => nx.now();
  const MAPS = g.__maps || [3, 31, 53, 110, 93, 65, 30, 16];
  let held = 0, releaseAt = 0; nx.pad = () => [held >>> 0, 0, 0, 0, 0, 0];
  const press = (ms) => { held |= 1; releaseAt = now() + (ms || 120); };
  let updates = 0; const us = SceneManager.updateScene; SceneManager.updateScene = function () { updates++; return us.apply(this, arguments); };
  const orig = g.__tick; let step = 0, stepAt = 0, mi = -1, frames = 0, wall = 0, u0 = 0, tStart = 0, phase = "";
  g.__tick = function (t) {
    if (held && now() >= releaseAt) held = 0;
    const a = now(); orig(t);
    const sc = SceneManager._scene ? SceneManager._scene.constructor.name : "-", n = now();
    const win = SceneManager._scene && SceneManager._scene._commandWindow;
    if (step === 0 && sc === "Scene_Title" && win && win.active) { if (!stepAt) stepAt = n; else if (n - stepAt > 1500) { press(); step = 1; stepAt = n; } }
    else if (step === 1 && sc === "Scene_Load" && n - stepAt > 2500) { press(); step = 2; stepAt = n; }
    else if (step === 2 && sc === "Scene_Map" && $gamePlayer.canMove() && n - stepAt > 4000) { step = 3; phase = "next"; }
    if (step === 3) {
      if (phase === "next") {
        if (++mi >= MAPS.length) { nx.log("[maps] done"); step = 4; return; }
        const id = MAPS[mi];
        $gameMessage.clear(); $gamePlayer.reserveTransfer(id, 5, 5, 2, 0); phase = "loading"; stepAt = n;
      } else if (phase === "loading") {
        if (sc === "Scene_Map" && $gameMap.mapId() === MAPS[mi] && !$gamePlayer.isTransferring() && n - stepAt > 1500) { phase = "measure"; tStart = n; frames = 0; wall = 0; u0 = updates; }
      } else if (phase === "measure") {
        frames++; wall += now() - a;
        if (n - tStart > 6000) {
          const u = updates - u0, ev = $gameMap.events().length;
          nx.log("[maps] map " + MAPS[mi] + " " + $dataMapInfos[MAPS[mi]].name + " events " + ev + ": avg tick " + (wall / frames).toFixed(1) + " ms, " + (u / frames).toFixed(2) + " updates/tick => " + (wall / Math.max(1, u)).toFixed(1) + " ms per update");
          phase = "next";
        }
      }
    }
  };
})(globalThis);
