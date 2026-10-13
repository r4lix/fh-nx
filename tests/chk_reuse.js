(function (g) {
  const nx = g.__nx, now = () => nx.now();
  let held = 0, releaseAt = 0; nx.pad = () => [held >>> 0, 0, 0, 0, 0, 0];
  const press = () => { held |= 1; releaseAt = now() + 120; };
  const orig = g.__tick; let step = 0, stepAt = 0, phase = "", sp0 = null, round = 0, px0 = 0, lm = null, lmCalls = 0;
  g.__tick = function (t) { if (held && now() >= releaseAt) held = 0; orig(t); const sc = SceneManager._scene ? SceneManager._scene.constructor.name : "-", n = now();
    const win = SceneManager._scene && SceneManager._scene._commandWindow;
    if (step === 0 && sc === "Scene_Title" && win && win.active) { if (!stepAt) stepAt = n; else if (n - stepAt > 1500) { press(); step = 1; stepAt = n; } }
    else if (step === 1 && sc === "Scene_Load" && n - stepAt > 2500) { press(); step = 2; stepAt = n; }
    else if (step === 2 && sc === "Scene_Map" && $gamePlayer.canMove() && n - stepAt > 4000) { step = 3; phase = "open"; stepAt = n; }
    if (step === 3) {
      if (phase === "open") { sp0 = SceneManager._scene._spriteset; SceneManager.push(Scene_Menu); phase = "wait"; stepAt = n; }
      else if (phase === "wait" && sc === "Scene_Menu" && n - stepAt > 1200) { SceneManager.pop(); phase = "back"; stepAt = n; }
      else if (phase === "back" && sc === "Scene_Map" && n - stepAt > 1500) {
        const sps = SceneManager._scene._spriteset; round++;
        const chars = sps._characterSprites.length, evs = $gameMap.events().length;
        px0 = $gamePlayer.x; const sprX0 = sps._characterSprites.find(s => s._character === $gamePlayer).x;
        nx.log("[reuse] round " + round + " same spriteset " + (sps === sp0) + " charSprites " + chars + " events " + evs + " parent ok " + (sps.parent === SceneManager._scene) + " lightmask " + !!sps._lightmask);
        $gamePlayer.moveStraight(6); phase = "moved"; stepAt = n; g.__sprX0 = sprX0;
      }
      else if (phase === "moved" && n - stepAt > 600) { const sps = SceneManager._scene._spriteset; const ps = sps._characterSprites.find(s => s._character === $gamePlayer);
        nx.log("[reuse]   player moved: x " + px0 + " -> " + $gamePlayer.x + ", sprite x " + g.__sprX0.toFixed(0) + " -> " + ps.x.toFixed(0) + " (camera follows, sprite should stay roughly centred)");
        phase = round < 3 ? "open" : "end"; stepAt = n; if (phase === "end") nx.log("[reuse] done"); }
    }
  };
})(globalThis);
