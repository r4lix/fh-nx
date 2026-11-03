// Deterministic scripted run: title -> Continue -> load the latest save -> teleport through CFG.maps; on each map wait
// CFG.settle ticks, then time CFG.measure ticks. Time only advances by 1/60 s per tick (fake clock), so each engine runs
// the identical update sequence; the real time each phase takes is read from H.realNow(). Defines __bench_tick(): the
// host calls it until it returns false (then drains promise jobs between calls).
(function (g) {
  "use strict";
  const H = g.H, CFG = g.__benchCfg, F = g.__fake, rn = H.realNow;
  const out = (s) => H.print("[bench] " + s);
  const MAPS = CFG.maps;
  let logicMs = 0, renderMs = 0, updates = 0;
  const SM = g.SceneManager, us = SM.updateScene, rs = SM.renderScene;
  SM.updateScene = function () { const a = rn(); try { return us.apply(this, arguments); } finally { logicMs += rn() - a; updates++; } };
  SM.renderScene = function () { const a = rn(); try { return rs.apply(this, arguments); } finally { renderMs += rn() - a; } };
  const tick = g.__tick;
  let n = 0, step = 0, stepAt = 0, mi = -1, phase = "", t0 = rn(), held = 0, releaseAt = 0;
  let m = null;
  const press = (bit, ticks) => { held = 1 << bit; releaseAt = n + (ticks || 8); };
  const results = [];
  // state digest: identical across engines <=> identical work (event positions/directions, variables, switches)
  function digest(part) {
    let hsh = 2166136261;
    const mix = (v) => { hsh = Math.imul(hsh ^ (v | 0), 16777619) >>> 0; };
    if (!part || part === "ev") for (const e of g.$gameMap.events()) { mix(e._x * 1000); mix(e._y * 1000); mix(e._direction); mix(e._pageIndex); }
    if (!part) { mix(g.$gamePlayer._x); mix(g.$gamePlayer._y); mix(g.Graphics.frameCount); }
    if (!part || part === "var") for (const v of g.$gameVariables._data) mix(typeof v === "number" ? v * 1000 : String(v).length);
    if (!part || part === "sw") for (const s of g.$gameSwitches._data) mix(s ? 1 : 0);
    return hsh.toString(16);
  }
  g.__digest = digest;
  out("start " + CFG.engine);
  g.__bench_tick = function () {
    n++;
    F.advance(1000 / 60);
    if (held && n >= releaseAt) held = 0;
    g.__padHeld = held;
    const a = rn(), l0 = logicMs, r0 = renderMs, u0 = updates;
    tick(F.now());
    const dt = rn() - a;
    const sc = SM._scene ? SM._scene.constructor.name : "-";
    const win = SM._scene && SM._scene._commandWindow;
    if (step === 0 && sc === "Scene_Title" && win && win.active) {
      if (!stepAt) { stepAt = n; out("title after " + (rn() - t0).toFixed(0) + " ms real, tick " + n); }
      else if (n - stepAt > 90) { press(0); step = 1; stepAt = n; }
    } else if (step === 1 && sc === "Scene_Load" && n - stepAt > 150) { press(0); step = 2; stepAt = n; t0 = rn(); }
    else if (step === 2 && sc === "Scene_Map" && g.$gamePlayer.canMove() && n - stepAt > 240) { step = 3; phase = "next"; out("in save map " + g.$gameMap.mapId()); }
    if (step === 3) {
      if (phase === "next") {
        if (++mi >= MAPS.length) { step = 4; return false; }
        g.$gameMessage.clear(); g.$gamePlayer.reserveTransfer(MAPS[mi], 5, 5, 2, 0); phase = "loading"; stepAt = n; t0 = rn();
      } else if (phase === "loading") {
        if (sc === "Scene_Map" && g.$gameMap.mapId() === MAPS[mi] && !g.$gamePlayer.isTransferring()) {
          if (!m) m = { id: MAPS[mi], xferMs: rn() - t0, settleFrom: n };
          if (n - m.settleFrom >= CFG.settle) { phase = "measure"; m.ticks = 0; m.tick = 0; m.logic = 0; m.render = 0; m.upd = 0; m.worst = 0; m.all = []; }
        }
      } else if (phase === "measure") {
        if (CFG.dumpVars && m.ticks % CFG.dumpVars === 0) out("vars t" + m.ticks + " " + digest("var") + " " + g.$gameVariables._data.map((v, i) => i + "=" + (typeof v) + ":" + (typeof v === "number" ? v : String(v).length + ":" + JSON.stringify(v).slice(0, 80).replace(/ /g, "_"))).join(" "));
        if (CFG.trace && m.ticks % CFG.trace === 0) out("trace " + m.id + " t" + m.ticks + " ev " + digest("ev") + " var " + digest("var") + " sw " + digest("sw") + " rnd " + Math.random().toFixed(6));
        m.ticks++; m.tick += dt; m.logic += logicMs - l0; m.render += renderMs - r0; m.upd += updates - u0; m.all.push(dt);
        if (dt > m.worst) m.worst = dt;
        if (m.ticks >= CFG.measure) {
          const ev = g.$gameMap.events().length, info = g.$dataMapInfos[m.id];
          m.all.sort((x, y) => x - y);
          const med = m.all[m.all.length >> 1];
          const mem = H.mem();
          m.digest = digest();
          out("map " + m.id + " " + (info ? info.name : "?") + " events " + ev + " | tick avg " + (m.tick / m.ticks).toFixed(3) + " med " + med.toFixed(3) +
            " worst " + m.worst.toFixed(1) + " ms | logic " + (m.logic / Math.max(1, m.upd)).toFixed(3) + " ms/update (" + (m.upd / m.ticks).toFixed(2) +
            "/tick) | render " + (m.render / m.ticks).toFixed(3) + " ms/tick | other " + ((m.tick - m.logic - m.render) / m.ticks).toFixed(3) +
            " | transfer " + m.xferMs.toFixed(0) + " ms | mem " + mem.join("/") + " | digest " + m.digest);
          results.push({ id: m.id, tick: m.tick / m.ticks, med, logic: m.logic / Math.max(1, m.upd), render: m.render / m.ticks, digest: m.digest });
          m = null; phase = "next";
        }
      }
    }
    if (n > CFG.maxTicks) { out("gave up at tick " + n + " scene " + sc + " step " + step); return false; }
    return true;
  };
  g.__bench_done = function () {
    out("summary " + CFG.engine + " " + results.map((r) => r.id + ":" + r.tick.toFixed(3) + "/" + r.logic.toFixed(3) + "/" + r.render.toFixed(3) + "#" + r.digest).join(" "));
  };
})(globalThis);
