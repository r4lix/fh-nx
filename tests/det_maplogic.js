// Deterministic map-logic run, for proving that a boot.js change leaves the game's behaviour identical:
// exactly one logic update + one render per tick, seeded Math.random, no load shedding. It loads the latest save,
// then teleports through cfg.maps (or stays on the save's map) and logs a digest of the whole map-logic state
// (events, event and common-event interpreters, switches, variables, self switches, player, gold, pictures) every
// cfg.every updates, cfg.per updates per map. Two runs of the same code give the same "[det]" lines; run it on the
// old and the new boot.js (second argument of boot_host = a repo root holding host/js) and diff the "[det]" lines.
// Options (globalThis.__det, set by a small config script that then loads this file):
//   walk: true      hold a pseudo-random direction (changes every 23-60 ticks), tap A every 31 ticks
//   stress: true    every 97 ticks on an idle map, start a random action/touch event from inside the event update
//                   loop (as an event touch does), so the events updated after it see it starting
//   ceToggle: true  every 151 ticks, flip the trigger switch of a random parallel common event (partial refreshes
//                   then create and drop common-event interpreters)
//   quit: false     keep running after the last map (default: throw out of the harness 5 ticks after it)
// Example config (build/det_cfg.js), then make boot-test SECONDS=200 EXTRA=build/det_cfg.js:
//   globalThis.__det = { maps: [80, 93, 185, 74], per: 900, every: 150, walk: true, stress: true };
//   globalThis.__nx.loadScript("tests/det_maplogic.js");
//   globalThis.__nx.loadScript("tests/chk_starting.js");      // optional: cross-check patches 1, 2, 2b on every call
// The last line is "[detcnt] {...}": how often each path was exercised (events started, refreshes, page setups...).
(function (g) {
  const nx = g.__nx;
  const cfg = Object.assign({ maps: [80, 93, 185, 74], per: 900, every: 150, stay: false, walk: false, stress: false, ceToggle: false, quit: true }, g.__det || {});
  let seed = 12345;
  Math.random = function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  g.__perfBudgetMs = 1e9;
  const SM = g.SceneManager;
  SM.updateMain = function () { this.updateInputData(); this.changeScene(); this.updateScene(); this.renderScene(); this.requestUpdate(); };
  let held = 0, release = 0, ticks = 0; nx.pad = () => [held >>> 0, 0, 0, 0, 0, 0];
  const press = () => { held = 1; release = ticks + 6; };
  const lcg = (s) => () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
  // FNV-1a over a string
  const h = (s, x) => { for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };
  const itState = (it) => !it ? "-" : (it._list ? it._list.length : 0) + ":" + it._index + ":" + it._waitCount + ":" + (it._waitMode || "") + ":" + (it._childInterpreter ? itState(it._childInterpreter) : "");
  const digest = () => {
    const gm = g.$gameMap; let x = 2166136261, parts = { ev: 0, sw: 0, va: 0, ss: 0, it: 0 };
    let s = "", pi = "";
    for (const e of gm.events()) {
      // __sc/__sd: stop count and alert lock that boot.js's sprite/event skips owe the event (added back here)
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
  let step = 0, at = 0, mi = -1, nUpd = 0, phase = "";
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
  const onMap = () => g.SceneManager._scene instanceof g.Scene_Map && g.$gameMap && !g.__detDone;

  if (cfg.walk) {
    const base = nx.pad, rnd = lcg(777); let t = 0, dir = 15, until = 0;
    nx.pad = function () {
      const p = base(), sc = g.SceneManager._scene;
      if (!(sc instanceof g.Scene_Map) || !g.$gamePlayer) return p;
      t++;
      if (t >= until) { dir = [12, 13, 14, 15][Math.floor(rnd() * 4)]; until = t + 23 + Math.floor(rnd() * 38); }
      let bits = 1 << dir;
      if (t % 31 < 3) bits |= 1;
      return [(p[0] | bits) >>> 0, p[1], p[2], p[3], p[4], p[5]];
    };
  }

  if (cfg.stress) {
    const o = g.__tick, rnd = lcg(4242); let t = 0, n = 0, pending = null;
    const GE = g.Game_Event.prototype, upd = GE.update;
    GE.update = function () { const r = upd.call(this); if (pending) { const e = pending; pending = null; e.start(); n++; if (n % 10 === 0) nx.log("[stress] " + n + " starts, map " + g.$gameMap.mapId()); } return r; };
    g.__tick = function (x) {
      o(x);
      if (!onMap() || ++t % 97 !== 0 || g.$gameMap.isEventRunning()) return;
      const c = g.$gameMap.events().filter((e) => e._pageIndex >= 0 && !e._erased && e._trigger <= 2 && e.list() && e.list().length > 1);
      if (c.length) pending = c[Math.floor(rnd() * c.length)];
    };
  }

  if (cfg.ceToggle) {
    const o = g.__tick, rnd = lcg(99); let t = 0, n = 0;
    g.__tick = function (x) {
      o(x);
      if (!onMap() || ++t % 151 !== 0) return;
      const ce = g.$gameMap._commonEvents;
      if (!ce.length) return;
      const id = g.$dataCommonEvents[ce[Math.floor(rnd() * ce.length)]._commonEventId].switchId;
      g.$gameSwitches.setValue(id, !g.$gameSwitches.value(id)); n++;
      if (n % 10 === 0) nx.log("[cetoggle] " + n + " flips");
    };
  }

  {
    const c = g.__detCnt = {};
    const cnt = (obj, name, label, pred) => { const f = obj[name]; obj[name] = function () { const r = f.apply(this, arguments); if (!pred || pred.call(this, r)) c[label] = (c[label] || 0) + 1; return r; }; };
    cnt(g.Game_Event.prototype, "start", "GE.start(starting)", function () { return this._starting; });
    cnt(g.Game_Map.prototype, "setupStartingMapEvent", "ssme=true", (r) => r === true);
    cnt(g.Game_Map.prototype, "setupAutorunCommonEvent", "autorun=true", (r) => r === true);
    cnt(g.Game_Map.prototype, "refresh", "GM.refresh");
    cnt(g.Game_Event.prototype, "setupPage", "GE.setupPage");
    cnt(g.Game_CharacterBase.prototype, "updatePattern", "updatePattern");
    cnt(g.Game_Interpreter.prototype, "command230", "wait230");
    const o = g.__tick; let done = false, n = 0;
    g.__tick = function (t) {
      o(t);
      if (!g.__detDone) return;
      if (!done) { done = true; nx.log("[detcnt] " + JSON.stringify(c)); }
      if (cfg.quit && ++n > 5) throw new Error("det finished");
    };
  }
})(globalThis);
