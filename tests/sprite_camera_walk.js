// Drives the camera-only Sprite_Character path (boot.js patch 3 (c)) under tests/sprite_camera_verify.js:
// loads the save, adds three party members (followers on), then on each map of __maps
//   1. pans the camera at walking speed (1/16 tile per update, 6 tiles each way) with the player standing,
//   2. walks the player (through, no event/encounter triggers) right/left/down/up with a jump every 6th step,
//      so the player and followers move against a moving camera,
//   3. opens and closes the menu (map scene rebuilt or reused) and walks again, every tile a bush this time
//      (Game_Map.isBush forced on), so moving characters get the half-body sprites.
// Logs the verify totals per map.  make boot-test SECONDS=150 EXTRA=tests/sprite_camera_walk.js
(function (g) {
  const nx = g.__nx, now = () => nx.now();
  nx.loadScript("tests/sprite_camera_verify.js");
  const MAPS = g.__maps || [80, 93, 185, 74];
  let held = 0, releaseAt = 0; nx.pad = () => [held >>> 0, 0, 0, 0, 0, 0];
  const press = (bit, ms) => { held |= 1 << bit; releaseAt = now() + (ms || 120); };
  let pan = false, panN = 0;
  const GM = g.Game_Map.prototype, gmUpdate = GM.update;
  GM.update = function (sceneActive) {
    if (pan) { if ((Math.floor(panN / 96) & 1) === 0) this.scrollRight(1 / 16); else this.scrollLeft(1 / 16); panN++; }
    return gmUpdate.call(this, sceneActive);
  };
  let walk = false, steps = 0;
  const DIRS = [6, 6, 6, 6, 6, 6, 4, 4, 4, 4, 4, 4, 2, 2, 2, 8, 8, 8];
  const quiet = () => {   // no event starts or encounters while the test walks through walls
    const p = $gamePlayer; p.setThrough(true);
    p.checkEventTriggerHere = p.checkEventTriggerThere = p.checkEventTriggerTouch = function () {};
    p.canEncounter = () => false;
  };
  const orig = g.__tick; let step = 0, stepAt = 0, mi = -1;
  g.__tick = function (t) {
    if (held && now() >= releaseAt) held = 0;
    orig(t);
    const sc = SceneManager._scene ? SceneManager._scene.constructor.name : "-", n = now();
    const win = SceneManager._scene && SceneManager._scene._commandWindow, since = n - stepAt, next = (s) => { step = s; stepAt = n; };
    if (walk && sc === "Scene_Map" && !$gamePlayer.isMoving() && !$gamePlayer.isJumping() && !$gameMap.isEventRunning()) {
      const d = DIRS[steps % DIRS.length];
      if (++steps % 6 === 0) $gamePlayer.jump(d === 6 ? 1 : d === 4 ? -1 : 0, d === 2 ? 1 : d === 8 ? -1 : 0); else $gamePlayer.moveStraight(d);
    }
    switch (step) {
      case 0: if (sc === "Scene_Title" && win && win.active) { if (!stepAt) stepAt = n; else if (since > 1500) { press(0); next(1); } } break;
      case 1: if (sc === "Scene_Load" && since > 2500) { press(0); next(2); } break;
      case 2: if (sc === "Scene_Map" && $gamePlayer.canMove() && since > 4000) {
        for (const id of [3, 4, 7]) if (!$gameParty._actors.includes(id)) $gameParty.addActor(id);
        $gamePlayer.showFollowers(); $gamePlayer.refresh(); next(3); } break;
      case 3: if (since > 500) {
        if (mi >= 0) g.__scvReport();
        if (++mi >= MAPS.length) { nx.log("[scw] done"); g.__scvReport(); next(99); break; }
        $gameMessage.clear(); $gamePlayer.reserveTransfer(MAPS[mi], 5, 5, 2, 0); next(4); } break;
      case 4: if (sc === "Scene_Map" && $gameMap.mapId() === MAPS[mi] && !$gamePlayer.isTransferring() && since > 1500) {
        quiet(); nx.log("[scw] map " + MAPS[mi] + ": camera pan"); pan = true; panN = 0; next(5); } break;
      case 5: if (since > 6000) { pan = false; nx.log("[scw] map " + MAPS[mi] + ": player walk"); walk = true; next(6); } break;
      case 6: if (since > 8000) { walk = false; next(7); } break;
      case 7: if (!$gamePlayer.isMoving() && !$gamePlayer.isJumping()) { nx.log("[scw] map " + MAPS[mi] + ": menu"); SceneManager.push(Scene_Menu); next(8); } break;
      case 8: if (sc === "Scene_Menu" && since > 1500) { SceneManager.pop(); next(9); } break;
      case 9: if (sc === "Scene_Map" && SceneManager.isCurrentSceneStarted() && since > 1000) { quiet(); $gameMap.isBush = () => true; walk = true; next(10); } break;
      case 10: if (since > 7000) { walk = false; delete $gameMap.isBush; next(3); } break;
    }
  };
})(globalThis);
