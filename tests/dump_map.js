// New Game on the PC harness, then inspect the first map: scene graph, the player's position, and the
// pixels of TerraxLighting's mask bitmap (is it all black, or are the lights drawn?).
(function (g) {
  const nx = g.__nx;
  let phase = 0, t0 = 0;
  const orig = g.__tick;
  function find(node, depth) {
    if (!node || depth < 0) return null;
    if (node._maskBitmap) return node;
    for (const c of node.children || []) { const r = find(c, depth - 1); if (r) return r; }
    return null;
  }
  g.__tick = function (t) {
    orig(t);
    const sc = SceneManager._scene, name = sc ? sc.constructor.name : "-";
    if (phase === 0 && name === "Scene_Title" && sc._commandWindow) { if (!t0) t0 = nx.now(); if (nx.now() - t0 > 2500) { phase = 1; sc.commandNewGame(); } }
    // jump through the character select / name entry by driving the scene objects directly
    if (phase === 1 && name === "Scene_Map") { phase = 2; t0 = nx.now(); }
    if (phase === 2 && nx.now() - t0 > 4000) {
      phase = 3;
      nx.log("[map] map " + $gameMap.mapId() + " player " + $gamePlayer.x + "," + $gamePlayer.y + " display " + $gameMap.displayX().toFixed(1) + "," + $gameMap.displayY().toFixed(1));
      nx.log("[map] screen tone " + JSON.stringify($gameScreen._tone) + " brightness " + $gameScreen.brightness());
      g.__dump(sc, 3, "[map]   ");
      const lm = find(sc, 6);
      if (lm) {
        const ctx = lm._maskBitmap.context, w = lm._maskBitmap.width, h = lm._maskBitmap.height;
        const d = ctx.getImageData(0, 0, w, h).data;
        let sum = 0, max = 0, lit = 0;
        for (let i = 0; i < w * h; i++) { const l = d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]; sum += l; if (l > max) max = l; if (l > 30) lit++; }
        nx.log("[map] lightmask " + w + "x" + h + " mean " + (sum / (w * h * 3)).toFixed(1) + " max " + max / 3 + " litpixels " + lit + " blend " + (lm.blendMode));
      } else nx.log("[map] no lightmask object found");
    }
  };
})(globalThis);
