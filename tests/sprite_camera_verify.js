// Identity check for boot.js patch 3 (c), the camera-only Sprite_Character update.
// After every (c) decision, stock MV's Sprite_Character.update body is run on the same sprite and must change
// nothing: position and transform, bitmap/frame/texture, opacity/blend/bush, visibility, children (the bush
// half-body sprites), animation/balloon state on the sprite and on its character. The (c) bookkeeping is checked
// too (__off/renderable as patch 3's full path sets them). Any difference is counted by field and logged.
// Load before the driver, e.g.:  make boot-test SECONDS=90 EXTRA=tests/sprite_camera_walk.js
(function (g) {
  const nx = g.__nx, P3 = g.__p3;
  if (!P3) { nx.log("[scv] boot.js patch 3 hook missing"); return; }
  nx.log("[scv] installed, camera-only path " + (P3.camOK ? "on" : "OFF"));
  const st = { n: 0, parked: 0, inline: 0, fallback: 0, half: 0, by: {}, diff: 0, what: {}, first: [] };
  g.__scv = st;
  const NAMES = ["x", "y", "z", "pos._x", "pos._y", "localID", "visible", "alpha", "opacity", "blendMode", "bushDepth", "bitmap", "frame.x", "frame.y",
    "frame.w", "frame.h", "texUpd", "tilesetId", "tileId", "charName", "charIndex", "isBig", "nkids", "kid0", "kid1", "c.animPlaying", "c.balloonPlaying",
    "animSprites", "balloonSprite", "scale.x", "scale.y", "anchor.x", "anchor.y", "tint", "hiding", "c.animId", "c.balloonId"];
  const HB = ["bitmap", "frame.x", "frame.y", "frame.w", "frame.h", "visible", "y", "opacity", "localID"];
  const snap = (s) => {
    const c = s._character, f = s._frame, t = s.transform, k = s.children;
    const r = [s.x, s.y, s.z, t.position._x, t.position._y, t._localID, s.visible, s.alpha, s.opacity, s.blendMode, s._bushDepth, s.bitmap, f.x, f.y, f.width, f.height,
      s.texture && s.texture._updateID, s._tilesetId, s._tileId, s._characterName, s._characterIndex, s._isBigCharacter, k.length, k[0], k[1],
      c._animationPlaying, c._balloonPlaying, s._animationSprites.length, s._balloonSprite, s.scale.x, s.scale.y, s.anchor.x, s.anchor.y, s.tint, s._hiding,
      c._animationId, c._balloonId];
    for (const b of [s._upperBody, s._lowerBody]) {
      if (!b) { for (let i = 0; i < HB.length; i++) r.push(undefined); continue; }
      const bf = b._frame; r.push(b.bitmap, bf.x, bf.y, bf.width, bf.height, b.visible, b.y, b.opacity, b.transform._localID);
    }
    return r;
  };
  const name = (i) => i < NAMES.length ? NAMES[i] : ((i - NAMES.length) < HB.length ? "upper." : "lower.") + HB[(i - NAMES.length) % HB.length];
  const SB = g.Sprite_Base.prototype;
  const offOf = (s) => s.x < -128 || s.x > Graphics.width + 128 || s.y < -192 || s.y > Graphics.height + 128;
  P3.hook = function (s) {
    const c = s._character, parked = s.__off && offOf(s) && !(s.__dx === g.$gameMap._displayX && s.__dy === g.$gameMap._displayY && s.__rx === c._realX && s.__ry === c._realY);
    st.n++; if (parked) st.parked++;
    if (s.__pok && s.__sok) st.inline++; else st.fallback++;
    const cls = c.constructor.name; st.by[cls] = (st.by[cls] || 0) + 1;
    if (s.children.length) st.half++;
    // (c) bookkeeping: a sprite that stays parked keeps its old signature, any other one is settled at this camera
    let bad = s.__busy || s.__off !== offOf(s) || s.renderable !== !s.__off;
    if (!parked && !(s.__dx === g.$gameMap._displayX && s.__dy === g.$gameMap._displayY && s.__rx === c._realX && s.__ry === c._realY)) bad = true;
    if (bad) { st.what.bookkeeping = (st.what.bookkeeping || 0) + 1; }
    const a = snap(s);
    SB.update.call(s); s.updateBitmap(); s.updateFrame(); s.updatePosition(); s.updateAnimation(); s.updateBalloon(); s.updateOther();   // stock body
    const b = snap(s);
    let d = bad;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !(a[i] !== a[i] && b[i] !== b[i])) {
      d = true; const k = name(i); st.what[k] = (st.what[k] || 0) + 1;
      if (st.first.length < 10) st.first.push(k + " " + a[i] + " -> " + b[i] + " (" + (c.constructor && c.constructor.name) + " " + c._characterName + ")");
    }
    if (d) st.diff++;
  };
  const report = () => nx.log("[scv] map " + (g.$gameMap ? g.$gameMap.mapId() : -1) + " decisions " + st.n + " (parked " + st.parked + ", inline " + st.inline +
    ", fallback " + st.fallback + ", with half-body " + st.half + ", " + JSON.stringify(st.by) + ") diffs " + st.diff + " " + JSON.stringify(st.what) + (st.first.length ? " first: " + st.first.join(" | ") : ""));
  g.__scvReport = report;
  setInterval(report, 5000);
})(globalThis);
