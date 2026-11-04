// Map sweep: teleport to every map (god mode + walk through walls), stay 2.5 s after arriving (a cutscene may move the player
// on: still counted), log errors. A map that traps the player or stops MV is followed by a full game restart (nx.restart),
// the position kept in save/sweep_state.json, so each part starts clean. Quits by itself when done or stuck 90 s.
(function (g) {
  const nx = g.__nx, now = () => nx.now(), log = (m) => nx.log("[sweep] " + m);
  const STATE = nx.saveDir + "/sweep_state.json";
  let held = 0, releaseAt = 0; nx.pad = () => [held >>> 0, 0, 0, 0, 0, 0];
  const press = () => { held = 1; releaseAt = now() + 120; };
  const L = nx.log; let errs = 0, mvErr = 0;
  nx.log = function (m) {
    const s = String(m);
    if (/EXCEPTION|MV ERROR/.test(s) && s.indexOf("[sweep]") < 0 && !/require is not defined|Unexpected identifier 'Object'/.test(s)) errs++;
    if (/MV ERROR/.test(s)) mvErr++;
    return L.apply(this, arguments);
  };
  let st = { i: -1, ok: 0, bad: [] };
  try { const t = nx.readFile(STATE); if (t) st = JSON.parse(t); } catch (e) {}
  const orig = g.__tick;
  let step = 0, at = 0, ids = null, cur = 0, arrived = 0, e0 = 0;
  let lastStep = -1, lastI = -2, progAt = 0;
  const done = (n) => {
    log("done: " + st.ok + " of " + ids.length + " maps ok; notes: " + (st.bad.join(" | ") || "none"));
    try { nx.removeFile(STATE); } catch (e) {}
    step = 9; at = n;
  };
  const restart = (note) => {                            // a clean game for the next map
    st.bad.push(note); log(note);
    nx.writeFile(STATE, JSON.stringify(st));
    step = 8; nx.restart();
  };
  const next = (n) => {
    if (++st.i >= ids.length) return done(n);
    cur = ids[st.i]; arrived = 0;
    $gameMessage.clear(); step = 5; at = n;
  };
  g.__tick = function (t) {
    if (held && now() >= releaseAt) held = 0;
    try { orig(t); } catch (e) { errs++; log("tick threw on map " + cur + ": " + e); }
    const sc = SceneManager._scene ? SceneManager._scene.constructor.name : "-", n = now();
    if (step !== lastStep || st.i !== lastI) { lastStep = step; lastI = st.i; progAt = n; }
    else if (progAt && n - progAt > 90000 && step < 8) {
      if (ids && step >= 4) return restart(cur + " " + ($dataMapInfos[cur] || {}).name + ": no progress for 90 s (" + sc + ")");
      log("no progress for 90 s at step " + step + " in " + sc + ", quitting"); step = 10; nx.quit(); return;
    }
    const win = SceneManager._scene && SceneManager._scene._commandWindow;
    if (step === 0 && sc === "Scene_Title" && win && win.active) { if (!at) at = n; else if (n - at > 1500) { win.selectSymbol("continue"); press(); step = 1; at = n; } }
    else if (step === 1 && sc === "Scene_Load" && n - at > 2500) { press(); step = 2; at = n; }
    else if (step === 2 && sc === "Scene_Map" && $gamePlayer.canMove() && n - at > 3000) {
      ids = $dataMapInfos.filter((m) => m && m.id && m.id !== 2).map((m) => m.id);   // 2: character creation holds the player
      log((st.i < 0 ? "sweeping " : "resuming after map index " + st.i + " of ") + ids.length + " maps (session " + nx.session + ")");
      next(n);
    } else if (step === 5 && sc === "Scene_Map" && !$gamePlayer.isTransferring() && n - at > 1500) {
      e0 = errs; mvErr = 0; at = n; step = 4;
      g.__debugMenuApply("noclip 1\ngod 1\nteleport " + cur + "\n");
    } else if (step === 4 && mvErr) {
      return restart(cur + " " + ($dataMapInfos[cur] || {}).name + ": MV error (see log)");
    } else if (step === 4) {
      if (!arrived && sc === "Scene_Map" && $gameMap.mapId() === cur && !$gamePlayer.isTransferring()) arrived = n;
      if (arrived && n - arrived > 2500) {
        const e = errs - e0, name = ($dataMapInfos[cur] || {}).name;
        if (e) return restart(cur + " " + name + ": " + e + " error(s)");
        st.ok++; next(n);
      } else if (!arrived && n - at > 15000) {
        return restart(cur + " " + ($dataMapInfos[cur] || {}).name + ": never arrived (" + sc + ", map " + $gameMap.mapId() + ")");
      }
    } else if (step === 9 && n - at > 2000) { step = 10; nx.quit(); }
  };
})(globalThis);
