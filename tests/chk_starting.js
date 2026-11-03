// Cross-checks boot.js patches 1, 2 and 2b against the stock scans on every call while the game runs
// (load it after tests/det_maplogic.js, see there):
//  - Game_Map.isAnyEventStarting / isAnyEventStartingQuick / setupStartingMapEvent give the answer of a scan of
//    $gameMap._events for _starting (the starting-event set of patch 2);
//  - setupAutorunCommonEvent starts the common event the stock walk over $dataCommonEvents picks (patch 2b), also
//    in a self-test over every on/off combination of the autorun switches;
//  - after every Game_Map.refresh each parallel common event has an interpreter exactly when the stock
//    Game_CommonEvent.isActive says so, and a partial refresh left every event on the page the stock
//    Game_Event.findProperPageIndex picks (patch 1).
// Prints "[chk] ... mismatches 0" lines; any mismatch is also logged with the map and the call.
(function (g) {
  const nx = g.__nx, GM = g.Game_Map.prototype, st = g.__chk = { starting: 0, startingTrue: 0, auto: 0, autoTrue: 0, refresh: 0, partial: 0, dup: 0, events: 0, mismatches: 0 };
  const bad = (what) => { st.mismatches++; if (st.mismatches <= 20) nx.log("[chk] MISMATCH " + what + " map " + g.$gameMap.mapId() + " frame " + g.Graphics.frameCount); };
  const scan = (gm) => { const ev = gm._events; for (let i = 0; i < ev.length; i++) if (ev[i] && ev[i]._starting) return true; return false; };
  for (const name of ["isAnyEventStarting", "isAnyEventStartingQuick", "setupStartingMapEvent"]) {
    const f = GM[name];
    if (typeof f !== "function") continue;
    GM[name] = function () {
      const want = scan(this), r = f.call(this);
      st.starting++; if (want) st.startingTrue++;
      if (r !== want) bad(name + " returned " + r + ", scan says " + want);
      return r;
    };
  }
  const auto = GM.setupAutorunCommonEvent;
  GM.setupAutorunCommonEvent = function () {
    let want = null;
    const d = g.$dataCommonEvents;
    for (let i = 0; i < d.length; i++) { const e = d[i]; if (e && e.trigger === 1 && g.$gameSwitches.value(e.switchId)) { want = e; break; } }
    const r = auto.call(this);
    st.auto++; if (r) st.autoTrue++;
    if (r !== !!want || (want && this._interpreter._list !== want.list)) bad("setupAutorunCommonEvent");
    return r;
  };
  const refresh = GM.refresh;
  GM.refresh = function () {
    const partial = !!(this.__partial && !this.__full && this.__dirtyEv);
    if (partial) st.dup += this.__dirtyEv.length - new Set(this.__dirtyEv.map(String)).size;   // ids on the dirty list more than once
    const r = refresh.apply(this, arguments);
    st.refresh++;
    for (const c of this._commonEvents) {
      const ev = g.$dataCommonEvents[c._commonEventId];
      if (!!c._interpreter !== !!(ev.trigger === 2 && g.$gameSwitches.value(ev.switchId))) bad("common event " + c._commonEventId + " interpreter");
    }
    if (partial) {
      st.partial++;
      for (const e of this.events()) {
        st.events++;
        if (e._pageIndex !== (e._erased ? -1 : e.findProperPageIndex())) bad("event " + e._eventId + " page after partial refresh");
      }
    }
    return r;
  };
  // Once, on the first map: the game turns an autorun common event's switch on rarely, so setupAutorunCommonEvent
  // (patch 2b, not the wrapper above) is also run for every on/off combination of the autorun switches against a
  // scratch interpreter, then the switches are put back exactly as they were (no onChange, nothing else touched).
  let selfTested = false;
  const selfTest = () => {
    selfTested = true;
    const d = g.$dataCommonEvents, S = g.$gameSwitches, ids = [];
    for (const e of d) if (e && e.trigger === 1 && ids.indexOf(e.switchId) < 0) ids.push(e.switchId);
    if (ids.length > 8) ids.length = 8;
    const len = S._data.length, had = ids.map((id) => id in S._data), saved = ids.map((id) => S._data[id]);
    let n = 0, started = 0;
    for (let m = 0; m < (1 << ids.length); m++) {
      ids.forEach((id, j) => { S._data[id] = !!(m >> j & 1); });
      let want = null;
      for (let i = 0; i < d.length; i++) { const e = d[i]; if (e && e.trigger === 1 && S.value(e.switchId)) { want = e; break; } }
      const map = { _interpreter: { setup(list) { this.list = list; } } }, r = auto.call(map);
      n++; if (r) started++;
      if (r !== !!want || (want && map._interpreter.list !== want.list)) bad("setupAutorunCommonEvent with autorun switches " + m.toString(2));
    }
    ids.forEach((id, j) => { if (had[j]) S._data[id] = saved[j]; else delete S._data[id]; });
    S._data.length = len;
    nx.log("[chk] autorun self-test: switches " + ids.join(",") + ", " + n + " combinations, " + started + " started a common event");
  };
  let last = 0;
  const tick = g.__tick;
  g.__tick = function (t) {
    tick(t);
    if (!selfTested && g.SceneManager._scene instanceof g.Scene_Map && g.$gameMap && g.$gameMap.mapId() > 0 && g.$gameSwitches) selfTest();
    if (g.Graphics.frameCount - last >= 600 || (g.__detDone && last >= 0)) {
      last = g.__detDone ? -1e9 : g.Graphics.frameCount;
      nx.log("[chk] starting checks " + st.starting + " (true " + st.startingTrue + "), autorun " + st.auto + " (started " + st.autoTrue + "), refresh " + st.refresh +
        " (partial " + st.partial + ", duplicate dirty ids " + st.dup + ", event pages checked " + st.events + "), mismatches " + st.mismatches);
    }
  };
})(globalThis);
