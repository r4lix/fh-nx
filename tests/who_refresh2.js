// Which switch/variable ids request Game_Map refreshes on the loaded map? (counts for 6 s)
(function (g) {
  const nx = g.__nx, now = () => nx.now();
  let held = 0, releaseAt = 0;
  nx.pad = () => [held >>> 0, 0, 0, 0, 0, 0];
  const press = () => { held |= 1; releaseAt = now() + 120; };
  const counts = new Map(); let on = false;
  const req = Game_Map.prototype.requestRefresh;
  Game_Map.prototype.requestRefresh = function () {
    if (on) {
      const k = "var" + $gameVariables.__id + " sw" + $gameSwitches.__id + " ss" + ($gameSelfSwitches.__id ? String($gameSelfSwitches.__id) : "-");
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return req.apply(this, arguments);
  };
  const orig = g.__tick; let step = 0, stepAt = 0, startOn = 0, done = false;
  g.__tick = function (t) {
    if (held && now() >= releaseAt) held = 0;
    orig(t);
    const sc = SceneManager._scene ? SceneManager._scene.constructor.name : "-", n = now();
    const win = SceneManager._scene && SceneManager._scene._commandWindow;
    if (step === 0 && sc === "Scene_Title" && win && win.active) { if (!stepAt) stepAt = n; else if (n - stepAt > 1500) { press(); step = 1; stepAt = n; } }
    else if (step === 1 && sc === "Scene_Load" && n - stepAt > 2500) { press(); step = 2; stepAt = n; }
    else if (step === 2 && sc === "Scene_Map" && $gamePlayer.canMove() && n - stepAt > 5000) { step = 3; on = true; startOn = n; }
    if (on && !done && n - startOn > 6000) {
      done = true; on = false;
      for (const [k, v] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) nx.log("[who] " + v + "x " + k);
    }
  };
})(globalThis);
