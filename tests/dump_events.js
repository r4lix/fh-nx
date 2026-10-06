// Load the save into map 74 and describe what the parallel/autorun events do each frame.
(function (g) {
  const nx = g.__nx, now = () => nx.now();
  const BIT = { A: 0 };
  let held = 0, releaseAt = 0;
  nx.pad = () => [held >>> 0, 0, 0, 0, 0, 0];
  const press = (ms) => { held |= 1; releaseAt = now() + (ms || 120); };
  const orig = g.__tick; let step = 0, stepAt = 0, done = false;
  g.__tick = function (t) {
    if (held && now() >= releaseAt) held = 0;
    orig(t);
    const sc = SceneManager._scene ? SceneManager._scene.constructor.name : "-", n = now();
    const win = SceneManager._scene && SceneManager._scene._commandWindow;
    if (step === 0 && sc === "Scene_Title" && win && win.active) { if (!stepAt) stepAt = n; else if (n - stepAt > 1500) { press(); step = 1; stepAt = n; } }
    else if (step === 1 && sc === "Scene_Load" && n - stepAt > 2500) { press(); step = 2; stepAt = n; }
    else if (step === 2 && sc === "Scene_Map" && $gamePlayer.canMove() && n - stepAt > 5000 && !done) {
      done = true;
      const evs = $gameMap.events();
      const byTrig = {}, moveTypes = {}; let withGraphic = 0, onScreen = 0, nearScreen = 0, moving = 0;
      const sprites = SceneManager._scene._spriteset._characterSprites || [];
      let off = 0; for (const sp of sprites) if (sp.__off) off++;
      for (const e of evs) {
        const tr = e._trigger; byTrig[tr] = (byTrig[tr] || 0) + 1; moveTypes[e._moveType] = (moveTypes[e._moveType] || 0) + 1;
        if (e.characterName() || e.tileId()) withGraphic++;
        if (e.isNearTheScreen()) nearScreen++; if (e.isMoving()) moving++;
      }
      nx.log("[ev] map " + $gameMap.mapId() + " size " + $gameMap.width() + "x" + $gameMap.height() + " events " + evs.length + " sprites " + sprites.length + " offscreenFlagged " + off);
      nx.log("[ev] triggers " + JSON.stringify(byTrig) + " moveTypes " + JSON.stringify(moveTypes) + " withGraphic " + withGraphic + " nearScreen " + nearScreen + " moving " + moving);
      const par = evs.filter((e) => e._trigger === 4);
      const sizes = {}; for (const e of par) { const l = e.list(); const k = l ? l.length : 0; sizes[k] = (sizes[k] || 0) + 1; }
      nx.log("[ev] parallel events " + par.length + ", command-list length histogram " + JSON.stringify(sizes));
      for (const e of par.slice(0, 5)) {
        const l = e.list() || [];
        nx.log("[ev]  #" + e.eventId() + " '" + (e.event().name) + "' " + l.length + " cmds: " + l.slice(0, 14).map((c) => c.code + (c.code === 108 || c.code === 408 ? "(" + String(c.parameters[0]).slice(0, 14) + ")" : "")).join(" "));
      }
      // what do they run? count command codes across all parallel lists
      const codes = {}; for (const e of par) for (const c of (e.list() || [])) codes[c.code] = (codes[c.code] || 0) + 1;
      nx.log("[ev] command codes in parallel lists: " + Object.entries(codes).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => k + "x" + v).join(" "));
      const auto = evs.filter((e) => e._trigger === 3); nx.log("[ev] autorun events " + auto.length);
    }
  };
})(globalThis);
