// Start battles against several troops from the loaded save, let each run ~6 s idle (command window up), and report tick cost.
(function (g) {
  const nx = g.__nx, now = () => nx.now();
  const TROOPS = g.__troops || [2, 10, 30, 60];
  let held = 0, releaseAt = 0; nx.pad = () => [held >>> 0, 0, 0, 0, 0, 0];
  const press = (ms) => { held |= 1; releaseAt = now() + (ms || 120); };
  const orig = g.__tick; let step = 0, stepAt = 0, ti = -1, frames = 0, wall = 0, tStart = 0, phase = "", updates = 0;
  const us = SceneManager.updateScene; SceneManager.updateScene = function () { updates++; return us.apply(this, arguments); };
  let u0 = 0;
  g.__tick = function (t) {
    if (held && now() >= releaseAt) held = 0;
    const a = now(); orig(t); const sc = SceneManager._scene ? SceneManager._scene.constructor.name : "-", n = now();
    const win = SceneManager._scene && SceneManager._scene._commandWindow;
    if (step === 0 && sc === "Scene_Title" && win && win.active) { if (!stepAt) stepAt = n; else if (n - stepAt > 1500) { press(); step = 1; stepAt = n; } }
    else if (step === 1 && sc === "Scene_Load" && n - stepAt > 2500) { press(); step = 2; stepAt = n; }
    else if (step === 2 && sc === "Scene_Map" && $gamePlayer.canMove() && n - stepAt > 4000) { step = 3; phase = "next"; }
    if (step === 3) {
      if (phase === "next") {
        if (++ti >= TROOPS.length) { nx.log("[battle] done"); step = 4; return; }
        $gameMessage.clear(); BattleManager.setup(TROOPS[ti], true, true); $gamePlayer.makeEncounterCount(); SceneManager.push(Scene_Battle); phase = "loading"; stepAt = n; nx.log("[battle] starting troop " + TROOPS[ti]);
      } else if (phase === "loading") {
        if (sc === "Scene_Battle" && n - stepAt > 3000) { phase = "measure"; tStart = n; frames = 0; wall = 0; u0 = updates; }
      } else if (phase === "measure") {
        frames++; wall += now() - a;
        if (n - tStart > 6000) {
          const u = updates - u0; const sb = SceneManager._scene; let spr = sb && sb._spriteset ? sb._spriteset._enemySprites.length : -1;
          nx.log("[battle] troop " + TROOPS[ti] + " enemies " + $gameTroop.members().length + " enemySprites " + spr + ": avg tick " + (wall / frames).toFixed(1) + " ms, " + (u / frames).toFixed(2) + " updates/tick; phase " + BattleManager._phase);
          SceneManager.pop(); phase = "back"; stepAt = n;
        }
      } else if (phase === "back") { if (sc === "Scene_Map" && n - stepAt > 2500) phase = "next"; }
    }
  };
})(globalThis);
