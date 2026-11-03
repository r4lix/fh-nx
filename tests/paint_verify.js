// Checks boot.js patch 16 (tilemap paint cache) against stock MV inside the real game. Usage:
//   make boot-test SECONDS=150 EXTRA=tests/paint_verify.js
// Every _paintAllTiles (the game's own repaints and the ones below) is repeated by the stock function, and both
// tile layers (every RectTileLayer: pointsBuf element for element, hasAnim, modification markers) are compared.
// On each map the camera pans in a square (tile crossings on both axes), then the script sweeps start positions
// over the whole map and past its edges, edits tiles and flag bits in place, feeds values the cache must not
// store, tries other tile sizes, and swaps the tileset and back; each step is followed by compared repaints. One "[pv] map" line per map,
// "[pv] FAIL" on any difference, "[pv] RESULT" at the end. Maps: globalThis.__maps, default 80/93/185/74.
(function (g) {
  const nx = g.__nx, pc = g.__paintCache, MAPS = g.__maps || [80, 93, 185, 74];
  g.__maps = [];                                                    // bench_maps.js only loads the save; maps are visited below
  nx.loadScript("tests/bench_maps.js");
  if (!pc) { nx.log("[pv] FAIL patch 16 is not installed"); return; }
  const ST = g.ShaderTilemap.prototype, cached = ST._paintAllTiles, stock = pc.stock;
  const tot = { paints: 0, diffs: 0, maps: 0 };
  let cur = null;                                                   // per-map counters

  const snap = (tm) => {
    const out = [tm.lowerZLayer._previousLayers, tm.upperZLayer._previousLayers];
    for (const comp of [tm.lowerLayer, tm.upperLayer]) {
      out.push(comp.modificationMarker, comp.children.length);
      for (const rl of comp.children) out.push(rl.hasAnim, rl.modificationMarker, rl.pointsBuf.slice());
    }
    return out;
  };
  const diff = (a, b) => {
    if (a.length !== b.length) return "layer count";
    for (let i = 0; i < a.length; i++) {
      const x = a[i], y = b[i];
      if (Array.isArray(x)) {
        if (x.length !== y.length) return "item " + i + " length " + x.length + " vs " + y.length;
        for (let j = 0; j < x.length; j++) if (!Object.is(x[j], y[j])) return "item " + i + " [" + j + "] " + x[j] + " vs " + y[j];
      } else if (!Object.is(x, y)) return "item " + i + " " + x + " vs " + y;
    }
    return "";
  };
  ST._paintAllTiles = function (sx, sy) {
    cached.call(this, sx, sy);
    const a = snap(this);
    stock.call(this, sx, sy);                                       // leaves the stock result on screen
    const d = diff(a, snap(this));
    tot.paints++; if (cur) cur.paints++;
    if (d) { tot.diffs++; if (cur) cur.diffs++; if (tot.diffs <= 8) nx.log("[pv] FAIL map " + g.$gameMap.mapId() + " start " + sx + "," + sy + " (" + (cur ? cur.step : "-") + "): " + d); }
  };

  let seed = 12345;
  const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
  const repaint = (tm) => tm._paintAllTiles(tm._lastStartX, tm._lastStartY);

  function sweep(tm) {
    const W = tm._mapWidth, H = tm._mapHeight, cols = Math.ceil(tm._width / tm._tileWidth) + 1, rows = Math.ceil(tm._height / tm._tileHeight) + 1;
    const x0 = tm._lastStartX, y0 = tm._lastStartY;
    for (let sy = -rows - 1; sy <= H + 1; sy += Math.max(1, rows >> 1)) for (let sx = -cols - 1; sx <= W + 1; sx += Math.max(1, cols >> 1)) tm._paintAllTiles(sx, sy);
    for (const [sx, sy] of [[-3 * W - 5, 7 * H + 3], [W - 1, H - 1], [W, H], [-1, -1], [x0 + W, y0 - H]]) tm._paintAllTiles(sx, sy);
    for (let k = 0; k < 12; k++) tm._paintAllTiles(x0 + (k % 4) - 1, y0 + (k >> 2) - 1);    // one-tile steps, as walking
    tm._paintAllTiles(x0, y0);
  }

  // in-place edits of the visible area (and the row above it: the tile above feeds table edges)
  function edits(tm) {
    const d = tm._mapData, W = tm._mapWidth, H = tm._mapHeight, WH = W * H, cols = Math.ceil(tm._width / tm._tileWidth) + 1, rows = Math.ceil(tm._height / tm._tileHeight) + 1;
    const cell = () => {
      const mx = tm._lastStartX + rnd(cols), my = tm._lastStartY - 1 + rnd(rows + 1);
      const x = tm.horizontalWrap ? ((mx % W) + W) % W : mx, y = tm.verticalWrap ? ((my % H) + H) % H : my;
      return x >= 0 && x < W && y >= 0 && y < H ? y * W + x : -1;
    };
    // [layer, value]: autotiles of every kind (A2 ones can be tables), normal tiles, shadows, then values that are
    // not int16 or not numbers (the cache must leave those cells to the stock code every time). Wall autotiles
    // (A3, odd A4 rows) only have shapes 0-15: stock throws on anything else.
    const VALS = [[0, 2816 + 48 * 3 + 5], [0, 2048 + 48 * 2 + 9], [1, 2816 + 48 * 5 + 7], [1, 2816 + 47], [1, 0], [2, 17], [3, 300], [3, 1536 + 9],
      [4, 15], [4, 5], [0, 4352 + 48 * 4 + 9], [1, 5888 + 48 * 7 + 30], [0, 2048 + 48 * 6 + 3], [2, 2816 + 48 * 2],
      [0, 1.5], [0, 70000], [1, -3], [1, "2900"], [0, undefined], [4, -1], [2, 1e9], [3, NaN]];
    for (const [z, v] of VALS) {
      cur.step = "edit layer " + z + " = " + v;
      const touched = [];
      for (let k = 0; k < 12; k++) { const i = cell(); if (i < 0) continue; const j = z * WH + i; touched.push(j, d[j]); d[j] = v; }
      repaint(tm); repaint(tm);                                     // the second one replays what the first recorded
      for (let k = touched.length - 2; k >= 0; k -= 2) d[touched[k]] = touched[k + 1];
      repaint(tm);
    }
    // a whole visible block replaced by one table autotile and its neighbours (table edges below table tiles)
    cur.step = "table block";
    const saved = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const my = tm._lastStartY + 3 + y, mx = tm._lastStartX + 3 + x;
      if (mx < 0 || mx >= W || my < 0 || my >= H) continue;
      const j = WH + my * W + mx; saved.push(j, d[j]); d[j] = 2816 + 48 * ((x + y) % 4) + y * 4 + x;
    }
    repaint(tm); repaint(tm);
    for (let k = saved.length - 2; k >= 0; k -= 2) d[saved[k]] = saved[k + 1];
    repaint(tm);
    // table edges: a table tile (A2 + flag 0x80) on layer 1 draws an edge into the cell below it. Record that, then
    // change only the tile above (the lower cell's own values stay the same) and repaint
    cur.step = "table edge";
    const f = tm.flags, tA = 2816 + 48 * 2 + 4, tB = 2816 + 48 * 3 + 7, fA = f[tA], fB = f[tB], back = [];
    const put = (j, v) => { back.push(j, d[j]); d[j] = v; };
    f[tA] = (f[tA] | 0) | 0x80; f[tB] = f[tA];                      // two table tiles with the same flag bits
    for (let x = 2; x < 10; x++) {
      const mx = tm._lastStartX + x, my = tm._lastStartY + 4;
      if (mx < 0 || mx >= W || my < 0 || my + 1 >= H) continue;
      put(WH + my * W + mx, tA);                                    // the table tile
      put(WH + (my + 1) * W + mx, 0); put((my + 1) * W + mx, 1536 + x);  // below: no table, a floor that does not shadow
    }
    repaint(tm); repaint(tm);
    for (let x = 2; x < 10; x++) {
      const mx = tm._lastStartX + x, my = tm._lastStartY + 4;
      if (mx >= 0 && mx < W && my >= 0 && my + 1 < H) put(WH + my * W + mx, x & 1 ? 0 : tB);   // edge gone / another table's edge
    }
    repaint(tm); repaint(tm);
    for (let k = back.length - 2; k >= 0; k -= 2) d[back[k]] = back[k + 1];
    f[tA] = fA; f[tB] = fB;
    repaint(tm);
  }

  // flag bits of visible tiles flipped in place: 0x10 (upper layer) and 0x80 (table) change the rects, 0x01 does not
  function flagEdits(tm) {
    const f = tm.flags, d = tm._mapData, W = tm._mapWidth, H = tm._mapHeight, WH = W * H;
    for (const bit of [0x10, 0x80, 0x01, 0x90]) {
      cur.step = "flag bit " + bit;
      const ids = new Set();
      for (let k = 0; k < 40; k++) {
        const mx = ((tm._lastStartX + rnd(20)) % W + W) % W, my = ((tm._lastStartY + rnd(14)) % H + H) % H;
        const t = d[rnd(4) * WH + my * W + mx] || 0;
        if (t > 0) ids.add(t);
      }
      for (const t of ids) f[t] ^= bit;
      repaint(tm); repaint(tm);
      for (const t of ids) f[t] ^= bit;
      repaint(tm);
    }
  }

  // other tile sizes: each one rebuilds the cache. With 47 or 50 some quarter/half-tile rects are fractional, so
  // they cannot be stored and those cells go through the stock code on every paint; 40x40 is fully cacheable
  function tileSizes(tm) {
    const tw = tm._tileWidth, th = tm._tileHeight;
    for (const [w, h] of [[47, 48], [48, 50], [40, 40]]) {
      cur.step = "tile size " + w + "x" + h;
      tm._tileWidth = w; tm._tileHeight = h;
      repaint(tm); repaint(tm); repaint(tm);
    }
    tm._tileWidth = tw; tm._tileHeight = th;
    cur.step = "tile size back";
    repaint(tm); repaint(tm);
  }

  // per map: pan the camera in a square for 3 s (the game's own paints), then the checks above, then a tileset swap
  // through Game_Map.changeTileset (the event command's path) and back, then the next map
  let mi = -1, map = -1, at = 0, phase = 0, n = 0, other = 0, first = 0, left = null;   // left: [map id, WeakRef to its cache]
  const GM = g.Game_Map.prototype, upd = GM.update;
  GM.update = function (sceneActive) {
    if (phase === 1) {
      const leg = Math.floor(n++ / 48) & 3, s = 1 / 8;
      if (leg === 0) this.scrollRight(s); else if (leg === 1) this.scrollDown(s); else if (leg === 2) this.scrollLeft(s); else this.scrollUp(s);
    }
    return upd.call(this, sceneActive);
  };
  const report = () => {
    nx.log("[pv] map " + cur.id + " " + cur.W + "x" + cur.H + (cur.loop ? " looping" : "") + ": " + cur.paints + " compared paints, " + cur.diffs + " diffs; cache " +
      JSON.stringify(Object.fromEntries(Object.keys(pc.stats).map((k) => [k, pc.stats[k] - cur.s0[k]]))));
    tot.maps++;
    left = [cur.id, new WeakRef(pc.cache())];
    cur = null;
  };
  const next = () => {
    if (++mi >= MAPS.length) {
      phase = 9;
      nx.log("[pv] RESULT " + (tot.diffs === 0 && tot.paints > 0 && tot.maps === MAPS.length ? "PASS" : "FAIL") + ": " + tot.paints + " compared paints on " + tot.maps + " maps, " + tot.diffs + " diffs");
      return;
    }
    g.$gameMessage.clear(); g.$gamePlayer.reserveTransfer(MAPS[mi], 5, 5, 2, 0); phase = 0; map = -1;
  };
  const o = g.__tick;
  g.__tick = function (t) {
    o(t);
    if (phase === 9) return;
    const sc = g.SceneManager._scene, onMap = sc && sc.constructor.name === "Scene_Map" && g.$gameMap && !g.$gamePlayer.isTransferring();
    if (!onMap) return;
    const id = g.$gameMap.mapId(), tm = sc._spriteset && sc._spriteset._tilemap, now = nx.now();
    if (mi < 0) { if (!first) first = now; else if (now - first > 4500 && g.$gamePlayer.canMove()) next(); return; }
    if (id !== MAPS[mi] || !tm) return;
    if (map !== id) { map = id; at = now; phase = 0; return; }
    const el = now - at;
    if (phase === 0 && el > 1000) {
      phase = 1; n = 0; at = now;
      if (left && nx.gc) {                                          // the previous map's cache must be garbage now (needs a
        nx.gc(); nx.gc();                                           // host with nx.gc, e.g. build/probe_render/boot_cyc)
        const alive = left[1].deref() !== undefined;
        nx.log("[pv] cache of map " + left[0] + " after leaving it: " + (alive ? "STILL ALIVE" : "freed"));
        if (alive) { tot.diffs++; nx.log("[pv] FAIL the cache outlived its map"); }
        left = null;
      }
      cur = { id, W: tm._mapWidth, H: tm._mapHeight, loop: !!(tm.horizontalWrap || tm.verticalWrap), paints: 0, diffs: 0, step: "walk", s0: Object.assign({}, pc.stats) };
    } else if (phase === 1 && el > 3000) {
      phase = 2;
      try { cur.step = "sweep"; sweep(tm); edits(tm); flagEdits(tm); tileSizes(tm); }
      catch (e) { tot.diffs++; nx.log("[pv] FAIL exception in " + cur.step + ": " + e); }
      cur.step = "tileset swap";
      const ids = g.$dataTilesets.map((ts, i) => (ts && i !== g.$gameMap.tilesetId() ? i : 0)).filter((i) => i > 0);
      other = g.$gameMap.tilesetId();
      g.$gameMap.changeTileset(ids[id % ids.length]);
      at = nx.now();
    } else if (phase === 2 && el > 700) {
      cur.step = "tileset back";
      const pcc = pc.cache();
      if (!(pcc && pcc.id === tm.__pcid && pcc.flags === tm.flags)) nx.log("[pv] note: no repaint after the tileset swap on map " + id);
      g.$gameMap.changeTileset(other);
      phase = 3; at = nx.now();
    } else if (phase === 3 && el > 700) {
      cur.step = "after tileset"; sweep(tm);
      report(); next();
    }
  };
  nx.log("[pv] installed");
})(globalThis);
