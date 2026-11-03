// Checks for boot.js patch 7's idle-cache renewal and written-id record (make boot-test SECONDS=150 EXTRA=tests/chk_renew.js).
// Deterministic route (tests/det_digest.js): map 185, then map 80.
//  1. map 185: common event 38 (DEFAULT CHARACTER: wait 1, if switches 242-245/375/380 are all OFF turn 246 ON,
//     wait 5) turns switch 246 ON without ever reading it. Another writer turns 246 OFF: stock turns it back ON on
//     the list's next pass, so the cached list has to wake up (restored within 4 updates; before the written ids
//     joined the record it stayed OFF until the 60-update expiry). Variables never had this gap: Control Variables
//     reads the old value first (operateVariable), so a written variable is always a recorded read too.
//  2. map 80, updates 150-300 untouched: expiring caches are renewed (> 0) and no revalidation fails.
//  3. map 80, update 300: $gameParty._gold += 1 written directly (no hook, no __actVer bump). Every cached list with
//     actor/party conditions must fail its fingerprint at its next expiry and re-run (within 61 updates).
//  4. map 80, update 450: a switch that only one cached common event reads (in no other record, no page condition,
//     no common event trigger) flipped directly in _data (no onChange): its record check fails at expiry, it re-runs.
// Prints "[chk_renew] PASS/FAIL ..." lines and a summary line "[chk_renew] OK" or "[chk_renew] FAILED".
(function (g) {
  const nx = g.__nx;
  g.__det = { maps: [185, 80], per: 560, every: 1000 };
  nx.loadScript("tests/det_digest.js");
  const K = ["fresh", "cont", "freshDirty", "freshSame", "expire", "renew", "rScene", "rRec", "rFp", "fpN", "fpT"];
  const d = g.__pdbg = {}; for (const k of K) d[k] = 0;
  let pass = 0, fail = 0;
  const check = (ok, what) => { if (ok) pass++; else fail++; nx.log("[chk_renew] " + (ok ? "PASS " : "FAIL ") + what); };
  const GM = g.Game_Map.prototype, upd = GM.update, GI = g.Game_Interpreter.prototype, setup = GI.setup;
  let n = 0, mapId = 0, gapAt = -1, c0 = null, watch = [], watchAt = -1, watchWhat = "";
  GI.setup = function (list, eid) {                                  // a watched cached list runs again
    if (this.__chkWatch && watchAt > 0) { this.__chkWatch = false; this.__chkReran = n - watchAt; }
    return setup.call(this, list, eid);
  };
  const finishWatch = () => {
    const late = watch.filter((it) => !(it.__chkReran > 0 && it.__chkReran <= 61));
    check(watch.length > 0 && late.length === 0, watchWhat + ": " + watch.length + " cached lists re-ran after " + watch.map((it) => it.__chkReran).join(",") + " updates" + (late.length ? " (" + late.length + " did not within 61)" : ""));
    watch = []; watchAt = -1;
  };
  const ceOf = (gm, id) => { for (const c of gm._commonEvents) if (c._commonEventId === id) return c; return null; };
  GM.update = function () {
    if (this.mapId() !== mapId) { mapId = this.mapId(); n = 0; }
    n++;                                                               // this update's number on this map
    const r = upd.apply(this, arguments);
    const S = g.$gameSwitches;
    if (mapId === 185) {
      if (n === 200) {
        const c = ceOf(this, 38), it = c && c._interpreter;
        if (!(it && it.__idleList && S.value(246) && ![242, 243, 244, 245, 375, 380].some((s) => S.value(s)))) check(false, "written-id: precondition (ce38 cached, having turned 246 ON) not met");
        else { S.setValue(246, false); gapAt = n; }
      } else if (gapAt > 0 && S.value(246)) { check(n - gapAt <= 4, "written-id: switch 246 turned back ON by ce38 after " + (n - gapAt) + " updates"); gapAt = -1; }
      else if (gapAt > 0 && n - gapAt > 90) { check(false, "written-id: switch 246 still OFF after 90 updates"); gapAt = -1; }
    } else if (mapId === 80) {
      if (n === 150) c0 = Object.assign({}, d);
      else if (n === 300) {
        const dr = (k) => d[k] - c0[k];
        check(dr("renew") > 0 && dr("rRec") + dr("rFp") + dr("rScene") === 0 && dr("expire") === dr("renew"),
          "renewal while untouched: " + dr("expire") + " expiries, " + dr("renew") + " renewed, failures rec/fp/scene " + dr("rRec") + "/" + dr("rFp") + "/" + dr("rScene") + ", " + dr("fpN") + " fingerprints " + (dr("fpN") ? (dr("fpT") / dr("fpN") * 1000).toFixed(0) : 0) + " us each");
        for (const c of this._commonEvents) { const it = c._interpreter; if (it && it.__idleList && it.__fp) { it.__chkWatch = true; it.__chkReran = 0; watch.push(it); } }
        c0 = Object.assign({}, d); watchWhat = "direct _gold write"; watchAt = n;
        g.$gameParty._gold += 1;
      } else if (n === 362) {
        finishWatch();
        check(d.rFp - c0.rFp > 0, "direct _gold write: " + (d.rFp - c0.rFp) + " fingerprint failures");
      } else if (n === 450) {                                         // after the one-off actor refresh at ~401
        const its = [];
        for (const c of this._commonEvents) if (c._interpreter) its.push(c._interpreter);
        for (const e of this.events()) if (e._interpreter) its.push(e._interpreter);
        const readBy = (id, me) => its.some((it) => it !== me && it.__idleRec && it.__idleRec.some((v, i) => i % 3 === 1 && it.__idleRec[i - 1] === 0 && v === id));
        const deps = new Set();
        for (const ev of g.$dataMap.events) if (ev) for (const pg of ev.pages) { const q = pg.conditions; if (q.switch1Valid) deps.add(q.switch1Id); if (q.switch2Valid) deps.add(q.switch2Id); }
        for (const ce of g.$dataCommonEvents) if (ce && ce.trigger) deps.add(ce.switchId);
        let pick = null;
        for (let k = this._commonEvents.length - 1; k >= 0 && !pick; k--) {
          const c = this._commonEvents[k], it = c._interpreter;
          if (!it || !it.__idleList || !it.__ev) continue;
          const rec = it.__idleRec;
          for (let i = 0; i < rec.length; i += 3) if (rec[i] === 0 && !deps.has(rec[i + 1]) && !readBy(rec[i + 1], it)) { pick = [c, it, rec[i + 1]]; break; }
        }
        if (!pick) check(false, "direct switch write: no isolated switch read by a cached common event");
        else {
          const [c, it, id] = pick;
          it.__chkWatch = true; it.__chkReran = 0; watch.push(it);
          watchWhat = "direct switch " + id + " write (read only by ce" + c._commonEventId + ", idle " + (g.__upd - it.__idleU) + " updates)";
          c0 = Object.assign({}, d); watchAt = n;
          S._data[id] = !S._data[id];
        }
      } else if (n === 512 && watchAt > 0) {
        finishWatch();
        check(d.rRec - c0.rRec > 0, "direct switch write: " + (d.rRec - c0.rRec) + " record failures");
      }
    }
    return r;
  };
  const tick = g.__tick; let done = false;
  g.__tick = function (t) { tick(t); if (!done && g.__detDone) { done = true; nx.log("[chk_renew] " + (fail || !pass ? "FAILED" : "OK") + ": " + pass + " passed, " + fail + " failed"); } };
})(globalThis);
