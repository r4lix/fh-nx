// Checks boot.js patch 8 (Tilemap._sortChildren reading transform.position._y): on every call the children end in
// exactly the order of the getter version patch 8 had before AND of the stock sort (VE_FogAndOverlay's comparator
// through Array.prototype.sort). Also counts children whose .y is not their transform.position._y (the per-child
// guard must send those to the getter version), and runs synthetic arrays with ties, NaN/undefined keys and a
// child with its own y accessor or a replaced transform. "unmarked" counts children the fast path did not read.
// Run with an EXTRA script (build/vs_stand.js) such as
//   globalThis.__maps = [80, 93, 185, 74];
//   globalThis.__nx.loadScript("tests/tilemap_sort_verify.js");
//   globalThis.__nx.loadScript("tests/bench_maps.js");        // or tests/sprite_camera_walk.js for walking
//   make boot-test SECONDS=75 EXTRA=build/vs_stand.js   -> every [verify_sort] line: diffs 0, nonStockY 0, unmarked 0
(function (g) {
  const nx = g.__nx, TM = g.Tilemap.prototype, mine = TM._sortChildren, DO = g.PIXI.DisplayObject.prototype;
  const hop = Object.prototype.hasOwnProperty;
  const getterSort = function () {   // patch 8 as it was (reads .y through the accessors)
    const a = this.children;
    for (let i = 1; i < a.length; i++) {
      const x = a[i], xz = x.z || 0, xy = x.y || 0, xs = x.spriteId;
      let j = i - 1;
      for (; j >= 0; j--) {
        const y = a[j], yz = y.z || 0;
        if (yz < xz) break;
        if (yz === xz) { const yy = y.y || 0; if (yy < xy || (yy === xy && !(y.spriteId > xs))) break; }
        a[j + 1] = y;
      }
      a[j + 1] = x;
    }
  };
  const same = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
  const st = { n: 0, diffP8: 0, diffStock: 0, moved: 0, kids: 0, nonStockY: 0, ownY: 0, maxKids: 0, unmarked: 0 };
  g.__vsort = st;
  const check = (tm, sortFn) => {   // one call: sortFn on the real array, both references on copies
    const before = tm.children.slice();
    sortFn.call(tm);
    const after = tm.children;
    const p8 = before.slice(); tm.children = p8; getterSort.call(tm);
    const sk = before.slice(); sk.sort(tm._compareChildOrder.bind(tm));
    tm.children = after;
    return { moved: !same(before, after), p8: same(after, p8), stock: same(after, sk), p8stock: same(p8, sk) };
  };
  TM._sortChildren = function () {
    const ch = this.children;
    for (let i = 0; i < ch.length; i++) {
      const c = ch[i];
      if (!(c.transform && c.transform.position && Object.is(c.y, c.transform.position._y))) st.nonStockY++;
      for (let p = c; p && p !== DO; p = Object.getPrototypeOf(p)) if (hop.call(p, "y") || hop.call(p, "position")) { st.ownY++; break; }
    }
    st.kids += ch.length; if (ch.length > st.maxKids) st.maxKids = ch.length;
    const r = check(this, mine);
    for (let i = 0; i < ch.length; i++) if (ch[i].__yt !== ch[i].transform) st.unmarked++;   // not read through the fast path
    st.n++; if (r.moved) st.moved++; if (!r.p8) st.diffP8++; if (!r.stock) st.diffStock++;
  };

  // synthetic: random z/y/spriteId with many ties, already-sorted and shuffled inputs, a child with its own y
  // accessor (guard -> getter version), a child whose transform is replaced after a sort by one whose position is
  // a plain PIXI.Point (its .y is not _y: the new transform must be checked again). Odd cases also get NaN/undefined
  // keys; an undefined spriteId makes the stock comparator inconsistent (NaN), where stable sorts may differ, so
  // those are compared with the getter version only.
  const syn = { cases: 0, diffP8: 0, clean: 0, diffStock: 0, swapped: 0 };
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const runSynthetic = () => {
    const tm = Object.create(TM);
    tm._compareChildOrder = TM._compareChildOrder;
    for (let c = 0; c < 400; c++) {
      const n = 1 + Math.floor(rnd() * 60), kids = [];
      for (let i = 0; i < n; i++) {
        const s = new g.Sprite();
        const r = rnd(), ry = rnd(), rs = rnd(), dirty = (c & 1) === 1;
        s.z = dirty && r < 0.1 ? undefined : dirty && r < 0.15 ? NaN : Math.floor(rnd() * 4);
        s.y = dirty && ry < 0.05 ? NaN : ry < 0.1 ? 0 : Math.floor(rnd() * 8) * 24 + (rnd() < 0.2 ? 0.5 : 0);
        s.spriteId = dirty && rs < 0.1 ? undefined : Math.floor(rnd() * 30);
        if (c % 7 === 3 && i === n >> 1) Object.defineProperty(s, "y", { get: () => 7, configurable: true });
        kids.push(s);
      }
      if (c % 3 === 0) { tm.children = kids.slice(); getterSort.call(tm); kids.length = 0; for (const k of tm.children) kids.push(k); if (n > 2) { const t = kids[1]; kids[1] = kids[n - 1]; kids[n - 1] = t; } }
      tm.children = kids;
      const tally = (r) => { syn.cases++; if (!r.p8) syn.diffP8++; if ((c & 1) === 0) { syn.clean++; if (!r.stock || !r.p8stock) syn.diffStock++; } };
      tally(check(tm, mine));
      if (c % 5 === 0) tally(check(tm, mine));   // again on its own output (children already checked)
      if (c % 11 === 5) {   // replaced transform: .y now reads a PIXI.Point, _y does not exist
        const s = kids[n >> 1], t = new g.PIXI.TransformStatic();
        t.position = new g.PIXI.Point(0, Math.floor(rnd() * 8) * 24 + 12); s.transform = t;
        tally(check(tm, mine)); syn.swapped++;
      }
    }
    nx.log("[verify_sort] synthetic cases " + syn.cases + " (" + syn.swapped + " with a replaced transform) diffs vs getter version " + syn.diffP8 +
      "; clean cases " + syn.clean + " diffs vs stock sort " + syn.diffStock);
  };
  let synDone = false;
  setInterval(() => {
    if (!synDone && g.Graphics && g.Graphics.frameCount > 0) { synDone = true; runSynthetic(); }
    nx.log("[verify_sort] map " + (g.$gameMap ? g.$gameMap.mapId() : -1) + " sorts " + st.n + " moved " + st.moved + " diffs vs getter version " + st.diffP8 +
      " vs stock sort " + st.diffStock + " children/sort " + (st.kids / Math.max(1, st.n)).toFixed(0) + " max " + st.maxKids + " nonStockY " + st.nonStockY + " ownY " + st.ownY + " unmarked " + st.unmarked);
  }, 5000);
})(globalThis);
