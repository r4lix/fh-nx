// Scene change latency from the loaded save: open the menu, items/skill/equip/status/save, battle start; logs worst tick + total stalled ms per change.
(function (g) {
  const nx = g.__nx, now = () => nx.now();
  const STEPS = [["Scene_Menu", () => SceneManager.push(Scene_Menu)], ["Scene_Item", () => SceneManager.push(Scene_Item)], ["Scene_Equip", () => SceneManager.push(Scene_Equip)], ["Scene_Status", () => SceneManager.push(Scene_Status)], ["Scene_Save", () => SceneManager.push(Scene_Save)], ["Scene_Battle", () => { BattleManager.setup(2, true, true); SceneManager.push(Scene_Battle); }], ["Scene_Menu", () => SceneManager.push(Scene_Menu)]];
  let held = 0, releaseAt = 0; nx.pad = () => [held >>> 0, 0, 0, 0, 0, 0];
  const press = (ms) => { held |= 1; releaseAt = now() + (ms || 120); };
  const orig = g.__tick; let step = 0, stepAt = 0, si = -1, phase = "", worst = 0, big = 0, t0 = 0, ticks = 0;
  g.__tick = function (t) {
    if (held && now() >= releaseAt) held = 0;
    const a = now(); orig(t); const d = now() - a, sc = SceneManager._scene ? SceneManager._scene.constructor.name : "-", n = now();
    const win = SceneManager._scene && SceneManager._scene._commandWindow;
    if (step === 0 && sc === "Scene_Title" && win && win.active) { if (!stepAt) stepAt = n; else if (n - stepAt > 1500) { press(); step = 1; stepAt = n; } }
    else if (step === 1 && sc === "Scene_Load" && n - stepAt > 2500) { press(); step = 2; stepAt = n; }
    else if (step === 2 && sc === "Scene_Map" && $gamePlayer.canMove() && n - stepAt > 4000) { step = 3; phase = "next"; }
    if (step === 3) {
      if (phase === "next") { if (++si >= STEPS.length) { nx.log("[scn] done"); step = 4; return; } $gameMessage.clear(); STEPS[si][1](); phase = "wait"; t0 = n; worst = 0; big = 0; ticks = 0; }
      else if (phase === "wait") { ticks++; if (d > worst) worst = d; if (d > 60) big += d;
        if (sc === STEPS[si][0] && n - t0 > 1800) { nx.log("[scn] open " + STEPS[si][0] + ": worst tick " + worst.toFixed(0) + " ms, stalled(>60ms) " + big.toFixed(0) + " ms"); phase = "close"; stepAt = n; } }
      else if (phase === "close") { SceneManager.pop(); phase = "back"; stepAt = n; worst = 0; big = 0; }
      else if (phase === "back") { if (d > worst) worst = d; if (d > 60) big += d; if (sc === "Scene_Map" && n - stepAt > 1800) { nx.log("[scn]   close -> map: worst tick " + worst.toFixed(0) + " ms, stalled " + big.toFixed(0) + " ms"); phase = "next"; } }
    }
  };
})(globalThis);
