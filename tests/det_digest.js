// Deterministic run for exactness checks: exactly one logic update + one render per tick, seeded Math.random,
// no load shedding. Loads the latest save, then teleports through cfg.maps (or stays), and logs a digest of the
// whole map-logic state (events, interpreters, switches, variables, self switches, player) every cfg.every updates.
// Two runs with identical code give identical digests; a prototype that changes behaviour shows a diverging digest.
// A/B: run it against two repo dirs (each with tests/fakegl.js + host/js/{env,boot}.js) and diff the [det] lines:
//   ./build/boot_host "<www>" <repoA> 210 <copy of build/save> tests/det_digest.js > a.txt   (same for repoB)
// globalThis.__det = { maps, per, every } or { stay: true, per, every } before loading it picks the route.
(function (g) {
  const nx = g.__nx;
  const cfg = Object.assign({ maps: [80, 93, 185, 74], per: 900, every: 150, stay: false }, g.__det || {});
  let seed = 12345;
  Math.random = function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  g.__perfBudgetMs = 1e9;
  const SM = g.SceneManager;
  SM.updateMain = function () { this.updateInputData(); this.changeScene(); this.updateScene(); this.renderScene(); this.requestUpdate(); };
  let held = 0, release = 0, ticks = 0; nx.pad = () => [held >>> 0, 0, 0, 0, 0, 0];
  const press = () => { held = 1; release = ticks + 6; };
  // FNV-1a over a string
  const h = (s, x) => { for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };
  const itState = (it) => !it ? "-" : (it._list ? it._list.length : 0) + ":" + it._index + ":" + it._waitCount + ":" + (it._waitMode || "") + ":" + (it._childInterpreter ? itState(it._childInterpreter) : "");
  const digest = () => {
    const gm = g.$gameMap; let x = 2166136261, parts = { ev: 0, sw: 0, va: 0, ss: 0, it: 0 };
    let s = "", pi = "";
    for (const e of gm.events()) {
      const sc = e._stopCount + (e.__sc | 0), al = e._erased ? e._alertLock : e._alertLock - (e.__sd | 0);
      s += e._eventId + "," + e._x + "," + e._y + "," + e._realX + "," + e._realY + "," + e._direction + "," + e._pattern + "," + e._animationCount + "," + sc + "," + al + "," +
        e._pageIndex + "," + e._starting + "," + e._locked + "," + e._moveSpeed + "," + e._erased + "," + e._chasePlayer + "," + e._fleePlayer + "," + e._alertPlayer + "," +
        e._returnPhase + "," + e._moveRouteIndex + "," + e._characterName + "," + e._characterIndex + "," + e._opacity + "," + e._tileId + ";";
      pi += e._eventId + ":" + (e._interpreter ? itState(e._interpreter) : "-") + ";";
    }
    parts.ev = h(s, 2166136261); x = h(s, x); parts.pi = h(pi, 2166136261); x = h(pi, x);
    s = JSON.stringify(g.$gameSwitches._data); parts.sw = h(s, 2166136261); x = h(s, x);
    s = JSON.stringify(g.$gameVariables._data); parts.va = h(s, 2166136261); x = h(s, x);
    s = JSON.stringify(g.$gameSelfSwitches._data); parts.ss = h(s, 2166136261); x = h(s, x);
    s = gm._commonEvents.map((c) => itState(c._interpreter)).join(";"); parts.ci = h(s, 2166136261); x = h(s, x);
    s = itState(gm._interpreter) + "|" + g.$gamePlayer._x + "," + g.$gamePlayer._y + "," + g.$gamePlayer._direction + "," + g.$gamePlayer._realX + "|" + g.$gameParty._gold + "|" + g.$gameScreen._pictures.filter(Boolean).length;
    parts.it = h(s, 2166136261); x = h(s, x);
    return x.toString(16) + " ev " + parts.ev.toString(16) + " sw " + parts.sw.toString(16) + " va " + parts.va.toString(16) + " ss " + parts.ss.toString(16) + " it " + parts.it.toString(16) + " pi " + parts.pi.toString(16) + " ci " + parts.ci.toString(16);
  };
  let step = 0, at = 0, mi = -1, upd0 = 0, nUpd = 0, phase = "";
  const us = SM.updateScene; SM.updateScene = function () { if (step === 3 && phase === "run") nUpd++; return us.apply(this, arguments); };
  const list = cfg.stay ? [-1] : cfg.maps;
  const orig = g.__tick;
  g.__tick = function (t) {
    ticks++;
    if (held && ticks >= release) held = 0;
    orig(t);
    const sc = SM._scene ? SM._scene.constructor.name : "-";
    const win = SM._scene && SM._scene._commandWindow;
    if (step === 0 && sc === "Scene_Title" && win && win.active) { if (!at) at = ticks; else if (ticks - at > 60) { press(); step = 1; at = ticks; } }
    else if (step === 1 && sc === "Scene_Load" && ticks - at > 120) { press(); step = 2; at = ticks; }
    else if (step === 2 && sc === "Scene_Map" && g.$gamePlayer.canMove()) { step = 3; phase = "next"; nx.log("[det] loaded map " + g.$gameMap.mapId() + " frameCount " + g.Graphics.frameCount); }
    if (step !== 3) return;
    if (phase === "next") {
      if (++mi >= list.length) { nx.log("[det] done"); g.__detDone = true; step = 4; return; }
      if (list[mi] > 0) { g.$gameMessage.clear(); g.$gamePlayer.reserveTransfer(list[mi], 5, 5, 2, 0); }
      phase = "load";
    } else if (phase === "load") {
      const id = list[mi] > 0 ? list[mi] : g.$gameMap.mapId();
      if (sc === "Scene_Map" && g.$gameMap.mapId() === id && !g.$gamePlayer.isTransferring() && SM._sceneStarted) { phase = "run"; nUpd = 0; }
    } else if (phase === "run") {
      if (nUpd > 0 && nUpd % cfg.every === 0) nx.log("[det] map " + g.$gameMap.mapId() + " upd " + nUpd + " digest " + digest());
      if (nUpd >= cfg.per) phase = "next";
    }
  };
})(globalThis);
