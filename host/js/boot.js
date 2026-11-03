// Boots RPG Maker MV the way index.html + main.js do, on the native host.
(function (g) {
  "use strict";
  const nx = g.__nx;
  const t0 = nx.now();
  const step = (what) => nx.log("[boot +" + ((nx.now() - t0) / 1000).toFixed(2) + "s] " + what);

  __registerCss("fonts/gamefont.css");
  for (const f of ["js/libs/pixi.js", "js/libs/pixi-tilemap.js", "js/libs/pixi-picture.js", "js/libs/lz-string.js",
    "js/libs/iphone-inline-video.browser.js"]) __loadScript(f);

  // fpsmeter drives a DOM we do not have; MV only needs the calls to exist
  g.FPSMeter = function () {};
  for (const m of ["tickStart", "tick", "show", "hide", "pause", "resume", "showFps", "hideFps"]) g.FPSMeter.prototype[m] = function () {};
  step("libs loaded");

  for (const f of ["js/rpg_core.js", "js/rpg_managers.js", "js/rpg_objects.js", "js/rpg_scenes.js", "js/rpg_sprites.js",
    "js/rpg_windows.js", "js/plugins.js"]) __loadScript(f);
  step("engine loaded");

  // Mods: plugins that enabled mods add to the game, and parameter overrides of existing ones (host/src/mods.cpp).
  if (nx.modPlugins) {
    const m = JSON.parse(nx.modPlugins());
    for (const o of m.overrides) {
      const p = g.$plugins.find((x) => x.name === o.plugin);
      if (p) Object.assign(p.parameters, o.parameters); else nx.log("mod: parameter override for unknown plugin " + o.plugin);
    }
    for (const e of m.plugins) {
      const ex = g.$plugins.find((x) => x.name === e.name);
      if (ex) { ex.status = true; Object.assign(ex.parameters, e.parameters); }
      else g.$plugins.push({ name: e.name, status: true, description: e.description || "", parameters: e.parameters });
    }
    if (m.plugins.length || m.overrides.length) nx.log("mods: " + m.plugins.length + " plugin(s) added, " + m.overrides.length + " parameter override(s)");
  }

  // MV's error printer builds DOM; send it to the log instead
  g.Graphics.printError = (name, message) => nx.log("MV ERROR: " + name + ": " + message);
  g.Graphics.printLoadingError = (url) => nx.log("MV LOADING ERROR: " + url);

  // Port patch: Bitmap.adjustTone is a per-pixel JavaScript loop over getImageData (every window refresh pays
  // it); the native context does the identical clamped add in one pass.
  g.Bitmap.prototype.adjustTone = function (r, gr, b) {
    if ((r || gr || b) && this.width > 0 && this.height > 0) {
      this._context.__adjustTone(r, gr, b);
      this._setDirty();
    }
  };

  // Port patch: Bitmap.blur (the blurred menu/battle backdrop taken by SceneManager.snapForBackground) is 18
  // full-screen additive draws; the native context does the same two 3x3 box passes directly. And a map->map
  // transfer takes the snapshot for a background nobody will show: skipped.
  {
    const blur = g.Bitmap.prototype.blur;
    g.Bitmap.prototype.blur = function () {
      if (this.width > 0 && this.height > 0 && this._context && this._context.__blur) { this._context.__blur(2); this._setDirty(); }
      else blur.apply(this, arguments);
    };
    const snap = g.SceneManager.snapForBackground;
    g.SceneManager.snapForBackground = function () {
      if (this.isNextScene(g.Scene_Map)) return;
      return snap.apply(this, arguments);
    };
  }

  // Port patch: Bitmap.snap (the backdrop behind menus/battle, ~175 ms on the Switch: render the whole stage, then a
  // synchronous glReadPixels of 816x624) renders at a fraction of the size and scales back up. The backdrop is blurred
  // anyway. g.__snapScale = 1 restores the stock full-size snapshot.
  {
    const snap = g.Bitmap.snap;
    if (String(snap).indexOf("extract.canvas") >= 0) g.Bitmap.snap = function (stage) {
      const k = typeof g.__snapScale === "number" ? g.__snapScale : 0.5;
      if (!stage || k >= 1 || !g.Graphics.isWebGL()) return snap.apply(this, arguments);
      const width = g.Graphics.width, height = g.Graphics.height, bitmap = new g.Bitmap(width, height), context = bitmap._context;
      const rt = g.PIXI.RenderTexture.create(width, height, g.PIXI.SCALE_MODES.LINEAR, k);
      g.Graphics._renderer.render(stage, rt);
      stage.worldTransform.identity();
      const canvas = g.Graphics._renderer.extract.canvas(rt);
      context.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, width, height);
      rt.destroy({ destroyBase: true });
      bitmap._setDirty();
      return bitmap;
    };
  }

  // Port patch: MV keeps 100 Sprite_Picture objects alive and runs update + updateBitmap + a Game_Screen lookup
  // on each of them every frame, even with no picture shown: ~170 interpreted calls per frame doing nothing.
  // A hidden sprite whose own picture slot is empty is skipped. The picture array and the in-battle offset
  // are fetched once per frame, so the per-sprite check is one array read.
  {
    const update = g.Sprite_Picture.prototype.update;
    let stamp = -1, pics = null, offset = 0;
    g.Sprite_Picture.prototype.update = function () {
      if (!this.visible) {
        if (stamp !== Graphics.frameCount) {
          stamp = Graphics.frameCount;
          pics = $gameScreen._pictures;
          offset = $gameParty.inBattle() ? $gameScreen.maxPictures() : 0;
        }
        if (!pics[this._pictureId + offset]) return;
      }
      update.apply(this, arguments);
    };
  }

  // Port patches: plugins that work around browser limits the native host does not have.
  //  - DSE-AudioLagFix streams BGM through HTML5 <audio> elements; the native mixer already streams from
  //    compressed data, so the stock WebAudio path is used instead.
  const DISABLED = ["DSE-AudioLagFix"];
  for (const p of g.$plugins) if (DISABLED.includes(p.name) && p.status) { p.status = false; nx.log("port patch: plugin " + p.name + " disabled"); }

  g.__applyControls();                                // the plugins (AS_InputSettings) set the pad map during main.js; ours wins after it
  const __setup = g.PluginManager.setup;
  g.PluginManager.setup = function () { const r = __setup.apply(this, arguments); g.__applyControls(); return r; };
  __loadScript("js/main.js");                         // PluginManager.setup($plugins); window.onload = ...

  // ---- Engine port patches for a bytecode interpreter (QuickJS is ~10-30x slower than the browser JIT this
  // game was built for, and one big map costs ~20 ms per logic update). Each keeps behaviour identical. ----

  // 0. The port patches below keep bookkeeping on game objects (properties starting with "__": caches, interpreter
  //    read sets, ...). JsonEx would serialise those into saves (it chokes on prototype-less objects and cycles), so
  //    while a save is being encoded they are lifted off the objects and put back afterwards. Nothing in the game
  //    or its plugins uses such keys.
  {
    const JE = g.JsonEx, src = String(JE._encode), from = "for (var key in value) {";
    if (src.indexOf(from) >= 0) {
      const stash = [];
      JE.__stash = stash;
      JE._encode = (0, eval)("(" + src.replace(from, from + " if (key.charCodeAt(0) === 95 && key.charCodeAt(1) === 95) { JsonEx.__stash.push(value, key, value[key]); delete value[key]; continue; }") + ")");
      const stringify = JE.stringify;
      JE.stringify = function () {
        try { return stringify.apply(this, arguments); }
        finally { for (let i = 0; i < stash.length; i += 3) stash[i][stash[i + 1]] = stash[i + 2]; stash.length = 0; }
      };
    } else nx.log("port patch: JsonEx._encode not patched (source differs)");
  }

  // 1. Every switch/variable/self-switch write requests a full map refresh (every event re-evaluates its page
  //    conditions, ~2-4 ms per update on a big map), and F&H's parallel events write counters every frame. An
  //    event page only depends on: two switches, one variable threshold, a self switch, an item and an actor
  //    (Game_Event.meetsConditions; no plugin here changes that), and a common event only on its trigger switch.
  //    So a refresh is requested only when the value really changed AND some page on this map (or common event)
  //    references that switch/variable. Self switches keep the unchanged-value guard. The dependency sets are
  //    built per map from $dataMap and rebuilt on Game_Map.setup.
  g.__stateVer = 1; g.__actVer = 1; g.__imgVer = 1;
  g.__watch = [new Map(), new Map()];       // [switches, variables]: id -> Set of cached idle interpreters reading it
  {
    const GM = g.Game_Map.prototype, setup = GM.setup;
    GM.setup = function () { this.__deps = null; g.__stateVer++; g.__actVer++; return setup.apply(this, arguments); };
    const deps = () => {
      const gm = g.$gameMap;
      if (gm.__deps) return gm.__deps;
      const d = { sw: Object.create(null), va: Object.create(null), ok: false };
      if (g.$dataMap && g.$dataMap.events) {
        const add = (m, id, evId) => { const a = m[id] || (m[id] = []); if (a[a.length - 1] !== evId) a.push(evId); };
        for (const ev of g.$dataMap.events) {
          if (!ev) continue;
          for (const pg of ev.pages) {
            const c = pg.conditions;
            if (c.switch1Valid) add(d.sw, c.switch1Id, ev.id);
            if (c.switch2Valid) add(d.sw, c.switch2Id, ev.id);
            if (c.variableValid) add(d.va, c.variableId, ev.id);
          }
        }
        for (const ce of g.$dataCommonEvents) if (ce && !d.sw[ce.switchId]) d.sw[ce.switchId] = [];   // trigger switch: common events only
        d.ok = true;
      }
      return (gm.__deps = d);
    };
    // Partial refresh: stock Game_Map.refresh re-evaluates the pages of every event (~400 on a big map, ~4 ms on a PC,
    // and F&H's proximity switches toggle several times a second). When the only reason for the refresh is a
    // switch/variable/self-switch change, just the events reading it are refreshed. Any other request (items,
    // party, direct refresh() calls) still does the full pass.
    const refreshSrc = String(GM.refresh), requestSrc = String(GM.requestRefresh);
    g.__partialOK = refreshSrc.indexOf("refreshTileEvents") >= 0 && refreshSrc.length < 330 && requestSrc.length < 90;
    const markPartial = (gm, list) => {
      const dirty = gm.__dirtyEv || (gm.__dirtyEv = []);
      for (let i = 0; i < list.length; i++) dirty.push(list[i]);
      gm.__partial = true;
      gm._needsRefresh = true;
    };
    if (g.__partialOK) {
      const refresh = GM.refresh, request = GM.requestRefresh;
      GM.requestRefresh = function () { this.__full = true; return request.apply(this, arguments); };
      GM.refresh = function () {
        const dirty = this.__dirtyEv;
        if (this.__partial && !this.__full && dirty) {
          let tiles = false;
          for (let i = 0; i < dirty.length; i++) {
            const e = this._events[dirty[i]];
            if (!e) continue;
            const was = e._tileId > 0;
            e.refresh();
            if ((e._tileId > 0) !== was) tiles = true;
          }
          const ce = this._commonEvents;
          for (let i = 0; i < ce.length; i++) ce[i].refresh();
          if (tiles) this.refreshTileEvents();
          this._needsRefresh = false;
        } else refresh.apply(this, arguments);
        this.__partial = false; this.__full = false; if (dirty) dirty.length = 0;
      };
    }
    for (const [cls, kind] of [[g.Game_Variables, "va"], [g.Game_Switches, "sw"], [g.Game_SelfSwitches, null]]) {
      const proto = cls.prototype, setValue = proto.setValue, onChange = proto.onChange;
      proto.setValue = function (id) {
        this.__id = id; this.__before = kind === "va" ? this._data[id] : !!this._data[id];
        try { return setValue.apply(this, arguments); }
        finally {
          this.__id = undefined;
          const cur = g.__curIt;                                                   // every id a tracked run writes, and what (see 7)
          if (cur && cur.__ww) cur.__ww.push(this, id, kind === "va" ? (this._data[id] || 0) : !!this._data[id]);
        }
      };
      proto.onChange = function () {
        const id = this.__id;
        if (id !== undefined) {
          const now = kind === "va" ? this._data[id] : !!this._data[id];
          if (now === this.__before) return;                                       // same value: nothing to re-evaluate
          g.__stateVer++;                                                          // idle-parallel cache key (see 7)
          if (kind) { const w = g.__watch[kind === "va" ? 1 : 0].get(id); if (w) for (const it of w) { it.__dirty = true; if (it.__owner) it.__owner.__sleep = false; } }   // cached idle runs reading it
          if (g.__curIt) g.__curIt.__wl.push(this, id, this.__before);             // a tracked run really changed state
          const gm = g.$gameMap;
          if (gm && g.__partialOK) {
            // only the events whose pages read this value (and the common events) need re-evaluating
            if (kind) {
              const d = deps();
              if (d.ok) { const list = d[kind][id]; if (!list) return; markPartial(gm, list); return; }
            } else if (id[0] === gm._mapId) { markPartial(gm, [id[1]]); return; }
          } else if (kind && gm) { const d = deps(); if (d.ok && !d[kind][id]) return; }   // nobody on this map reads it
        }
        return onChange.apply(this, arguments);
      };
    }
  }

  // 2. "Is any event starting?" is a scan of every event's _starting: Game_Map.isAnyEventStarting (~10 times per
  //    update), YEP_StopMapMovement's isAnyEventStartingQuick (once per self-moving event per update) and
  //    setupStartingMapEvent; up to 4000 isStarting calls per update on a big map. Only Game_Event.start sets
  //    the flag (initMembers and clearStartingFlag clear it), so the events that started are kept in a set,
  //    rebuilt from the events whenever $gameMap._events is another array (new map, loaded save). The answer is
  //    whether one of them is still starting and on this map; entries that are not are dropped.
  //    setupStartingMapEvent keeps its stock scan (same order) and only returns false at once when none is.
  {
    const GM = g.Game_Map.prototype, update = GM.update;
    g.__upd = 0;
    const GE = g.Game_Event.prototype, start = GE.start, clear = GE.clearStartingFlag;
    const stockAny = GM.isAnyEventStarting, quick = GM.isAnyEventStartingQuick, ssme = GM.setupStartingMapEvent, isStarting = String(GE.isStarting);
    if (isStarting.indexOf("return this._starting") >= 0 && isStarting.length < 80 && String(stockAny).indexOf("isStarting") >= 0 && String(stockAny).length < 160) {
      const set = new Set();
      let src = null;
      const any = (gm) => {
        const ev = gm._events;
        if (ev !== src) {
          src = ev; set.clear();
          for (let i = 0; i < ev.length; i++) { const e = ev[i]; if (e && e._starting) set.add(e); }
        }
        if (set.size === 0) return false;
        for (const e of set) {
          if (e._starting && (ev[e._eventId] === e || ev.indexOf(e) >= 0)) return true;
          set.delete(e);
        }
        return false;
      };
      GE.start = function () { const r = start.call(this); if (this._starting) set.add(this); return r; };
      GE.clearStartingFlag = function () { set.delete(this); return clear.call(this); };
      GM.isAnyEventStarting = function () { return any(this); };
      if (quick) {
        if (String(quick).indexOf("isStarting") >= 0 && String(quick).length < 250) GM.isAnyEventStartingQuick = function () { return any(this); };
        else nx.log("port patch: isAnyEventStartingQuick keeps its scan (source differs)");
      }
      if (String(ssme).indexOf("isStarting") >= 0 && String(ssme).length < 400) GM.setupStartingMapEvent = function () { return any(this) ? ssme.call(this) : false; };
      else nx.log("port patch: setupStartingMapEvent keeps its scan (source differs)");
      GM.update = function (sceneActive) { g.__upd++; return update.call(this, sceneActive); };
    } else {
      // fallback: the answer is cached for one update, invalidated whenever an event starts or clears its flag
      nx.log("port patch: starting-event set not installed (source differs)");
      GM.isAnyEventStarting = function () { return this.__starting !== undefined ? this.__starting : (this.__starting = stockAny.apply(this, arguments)); };
      GM.update = function () { this.__starting = undefined; g.__upd++; return update.apply(this, arguments); };
      GE.start = function () { const r = start.apply(this, arguments); if (g.$gameMap) g.$gameMap.__starting = undefined; return r; };
      GE.clearStartingFlag = function () { const r = clear.apply(this, arguments); if (g.$gameMap) g.$gameMap.__starting = undefined; return r; };
    }
  }

  // 2b. setupAutorunCommonEvent walks all ~316 common events on every update to find the 2 autorun ones (trigger 1).
  //     The autorun ones are listed once per $dataCommonEvents; the loop is the stock one over that list (same
  //     order, same switch reads, same result).
  {
    const GM = g.Game_Map.prototype, auto = GM.setupAutorunCommonEvent, src = String(auto);
    if (src.indexOf("event.trigger === 1 && $gameSwitches.value(event.switchId)") >= 0 && src.indexOf("$dataCommonEvents.length") >= 0 && src.length < 360) {
      let data = null, n = -1, list = [];
      GM.setupAutorunCommonEvent = function () {
        const d = g.$dataCommonEvents;
        if (d !== data || d.length !== n) {
          data = d; n = d.length; list = [];
          for (let i = 0; i < n; i++) if (d[i] && d[i].trigger === 1) list.push(d[i]);
        }
        for (let i = 0; i < list.length; i++) {
          const event = list[i];
          if (event.trigger === 1 && g.$gameSwitches.value(event.switchId)) { this._interpreter.setup(event.list); return true; }
        }
        return false;
      };
    } else nx.log("port patch: setupAutorunCommonEvent keeps its scan (source differs)");
  }

  // 3. Sprite_Character.update only has an effect when something it mirrors has changed. A sprite is skipped when
  //    (a) it is far off screen (re-checked every 4th frame; the margin is wider than anything can travel in 4
  //    frames), or (b) its character's state, the camera and animation/balloon activity are all exactly as at
  //    the last full update. (b) is a dozen plain property reads against ~25 interpreted calls.
  //    Stock MV runs the update every frame, and some of its effects only land on the update AFTER the one that saw
  //    a change. Until those have landed the sprite is not skipped (its signature is left unset, __busy also
  //    lifts the off-screen skip):
  //     - a bitmap still loading (image loads are asynchronous): the update that set it computed a 0x0 frame from
  //       it, and the first update after the load sets the real one. Skipping that update left every sprite whose
  //       image was not decoded yet invisible until its character moved: the party on entering a map or after a
  //       battle/menu, a follower who joins, an event page with a new graphic (the sitting hero in the chair scene).
  //     - a balloon or animation that has just finished: the next update tells the character (endBalloon /
  //       endAnimation), and an event waiting on it (Show Balloon Icon / Show Animation with wait) polls exactly
  //       that; skipping it left the event waiting forever.
  //     - a bush depth change: updateFrame uses the depth the sprite took at the end of the previous update.
  //    A balloon/animation request on a far off-screen character is also started at once, as stock does.
  //    (c) Walking moves the camera, which changes (b)'s signature for every sprite. When only the camera and the
  //    character's real position differ from the signature, and nothing is pending (settled, no animation/balloon,
  //    no children but the bush half-body sprites), the full update recomputes the same bitmap, frame, opacity,
  //    blend mode and visibility, and changes only x/y/z: those are recomputed inline with the stock arithmetic of
  //    Sprite_Character.updatePosition -> Game_CharacterBase.screenX/Y/Z -> Game_Map.adjustX/Y, written through
  //    the position ObservablePoint as the x/y setters do. Used only where that chain is the stock one (checked
  //    by source at boot, and per character: Game_Vehicle has its own screenY), else updatePosition() is called.
  //    A parked sprite that stays far off screen keeps its old signature, as the 4th-frame check did before.
  {
    const SC = g.Sprite_Character.prototype, update = SC.update;
    const GCB = g.Game_CharacterBase.prototype, GM = g.Game_Map.prototype, DO = g.PIXI.DisplayObject.prototype, OP = g.PIXI.ObservablePoint;
    const hop = Object.prototype.hasOwnProperty, flat = (f) => (typeof f === "function" ? String(f) : "").replace(/\s+/g, "");
    const setterHas = (o, k, s) => { const d = Object.getOwnPropertyDescriptor(o, k); return !!d && flat(d.set).indexOf(s) >= 0; };
    const sPos = SC.updatePosition, sX = GCB.screenX, sY = GCB.screenY, sZ = GCB.screenZ, scX = GCB.scrolledX, scY = GCB.scrolledY,
      shY = GCB.shiftY, jH = GCB.jumpHeight, iOC = GCB.isObjectCharacter, aX = GM.adjustX, aY = GM.adjustY, tW = GM.tileWidth, tH = GM.tileHeight;
    const camOK =   // the stock sources (rpg_sprites.js / rpg_objects.js 1.6.x, pixi.js 4.5.4), whitespace removed
      flat(update) === "function(){Sprite_Base.prototype.update.call(this);this.updateBitmap();this.updateFrame();this.updatePosition();this.updateAnimation();this.updateBalloon();this.updateOther();}" &&
      flat(sPos) === "function(){this.x=this._character.screenX();this.y=this._character.screenY();this.z=this._character.screenZ();}" &&
      flat(sX) === "function(){vartw=$gameMap.tileWidth();returnMath.round(this.scrolledX()*tw+tw/2);}" &&
      flat(sY) === "function(){varth=$gameMap.tileHeight();returnMath.round(this.scrolledY()*th+th-this.shiftY()-this.jumpHeight());}" &&
      flat(sZ) === "function(){returnthis._priorityType*2+1;}" &&
      flat(scX) === "function(){return$gameMap.adjustX(this._realX);}" && flat(scY) === "function(){return$gameMap.adjustY(this._realY);}" &&
      flat(shY) === "function(){returnthis.isObjectCharacter()?0:6;}" && flat(iOC) === "function(){returnthis._isObjectCharacter;}" &&
      flat(jH) === "function(){return(this._jumpPeak*this._jumpPeak-Math.pow(Math.abs(this._jumpCount-this._jumpPeak),2))/2;}" &&
      flat(aX) === "function(x){if(this.isLoopHorizontal()&&x<this._displayX-(this.width()-this.screenTileX())/2){returnx-this._displayX+$dataMap.width;}else{returnx-this._displayX;}}" &&
      flat(aY) === "function(y){if(this.isLoopVertical()&&y<this._displayY-(this.height()-this.screenTileY())/2){returny-this._displayY+$dataMap.height;}else{returny-this._displayY;}}" &&
      flat(tW) === "function(){return48;}" && flat(tH) === "function(){return48;}" &&
      setterHas(DO, "x", "{this.transform.position.x=value;}") && setterHas(DO, "y", "{this.transform.position.y=value;}") &&
      setterHas(OP.prototype, "x", "{if(this._x!==value){this._x=value;this.cb.call(this.scope);}}") &&
      setterHas(OP.prototype, "y", "{if(this._y!==value){this._y=value;this.cb.call(this.scope);}}");
    if (!camOK) nx.log("patch 3: the Sprite_Character position chain is not stock, camera-only updates off");
    const charOK = (c) => c.screenX === sX && c.screenY === sY && c.screenZ === sZ && c.scrolledX === scX && c.scrolledY === scY &&
      c.shiftY === shY && c.jumpHeight === jH && c.isObjectCharacter === iOC;
    const spriteOK = (s) => {   // x/y/position reach the ObservablePoint through DisplayObject's own accessors
      for (let p = s; p && p !== DO; p = Object.getPrototypeOf(p)) if (hop.call(p, "x") || hop.call(p, "y") || hop.call(p, "position")) return false;
      return s.updatePosition === sPos && !!s.transform && s.transform.position instanceof OP;
    };
    const P3 = g.__p3 = { camOK: camOK, hook: null };   // hook: tests/sprite_camera_verify.js, called after every (c) update
    // the Game_Map.adjustX/Y terms that change only with the camera, the map or the screen size
    let kFc = -1, kDx = NaN, kDy = NaN, kMap = null, kGm = null, kOK = false, lh = false, lv = false, thX = 0, thY = 0, dW = 0, dH = 0, gw = 0, gh = 0;
    SC.update = function () {
      const c = this._character;
      if (this.__off && (Graphics.frameCount & 3) !== 0 && !this.__busy && (!c || (!c._animationId && !c._balloonId))) return;   // (a)
      const gm = g.$gameMap;
      if (c && !this._animationSprites.length && !this._balloonSprite && !c._animationId && !c._balloonId &&
          this.__dir === c._direction && this.__pat === c._pattern && this.__op === c._opacity && this.__bt === c._blendType &&
          this.__cn === c._characterName && this.__ci === c._characterIndex && this.__tid === c._tileId &&
          this.__tr === c._transparent && this.__bd === c._bushDepth && this.__pt === c._priorityType &&
          this.__jc === c._jumpCount && this.__sid === gm._tilesetId) {
        const dx = gm._displayX, dy = gm._displayY, rx = c._realX, ry = c._realY;
        if (this.__dx === dx && this.__dy === dy && this.__rx === rx && this.__ry === ry) return;                            // (b)
        const k = this.children;
        if (camOK && this.__dx === this.__dx && this.__dx !== undefined && !this.__busy && !c._animationPlaying && !c._balloonPlaying &&   // (c)
            (k.length === 0 || (k.length <= 2 && (k[0] === this._upperBody || k[0] === this._lowerBody) &&
                                (k.length === 1 || k[1] === this._upperBody || k[1] === this._lowerBody)))) {
          if (kFc !== Graphics.frameCount || kDx !== dx || kDy !== dy || kMap !== g.$dataMap || kGm !== gm) {
            kFc = Graphics.frameCount; kDx = dx; kDy = dy; kMap = g.$dataMap; kGm = gm;
            kOK = gm.adjustX === aX && gm.adjustY === aY && gm.tileWidth === tW && gm.tileHeight === tH;
            if (kOK) {
              lh = gm.isLoopHorizontal(); lv = gm.isLoopVertical();
              thX = dx - (gm.width() - gm.screenTileX()) / 2; thY = dy - (gm.height() - gm.screenTileY()) / 2;
              dW = kMap.width; dH = kMap.height;
            }
            gw = Graphics.width; gh = Graphics.height;
          }
          let x, y;
          if (kOK && (this.__pokc === c ? this.__pok : (this.__pokc = c, this.__pok = charOK(c))) &&
              (this.__sok !== undefined ? this.__sok : (this.__sok = spriteOK(this)))) {
            const ax = lh && rx < thX ? rx - dx + dW : rx - dx, ay = lv && ry < thY ? ry - dy + dH : ry - dy;
            x = Math.round(ax * 48 + 48 / 2);
            y = Math.round(ay * 48 + 48 - (c._isObjectCharacter ? 0 : 6) - (c._jumpPeak * c._jumpPeak - Math.pow(Math.abs(c._jumpCount - c._jumpPeak), 2)) / 2);
            const p = this.transform.position;
            if (p._x !== x) { p._x = x; p.cb.call(p.scope); }
            if (p._y !== y) { p._y = y; p.cb.call(p.scope); }
            this.z = c._priorityType * 2 + 1;
          } else {
            this.updatePosition(); x = this.x; y = this.y;
          }
          const off = x < -128 || x > gw + 128 || y < -192 || y > gh + 128;
          if (!(off && this.__off)) {
            this.__dx = dx; this.__dy = dy; this.__rx = rx; this.__ry = ry;
            this.__off = off; this.renderable = !off;
          }
          if (P3.hook !== null) P3.hook(this);
          return;
        }
      }
      const bd = this._bushDepth || 0;
      update.call(this);
      let busy = this._animationSprites.length > 0 || !!this._balloonSprite;
      if (c) {
        const b = this._bitmap;
        if ((b && !b.isReady()) || bd !== this._bushDepth || (c._balloonPlaying && !this._balloonSprite) || (c._animationPlaying && !this._animationSprites.length)) {
          this.__dx = NaN; busy = true;                                  // not settled: the next update runs in full
        } else {
          this.__dx = gm._displayX; this.__dy = gm._displayY; this.__rx = c._realX; this.__ry = c._realY;
          this.__dir = c._direction; this.__pat = c._pattern; this.__op = c._opacity; this.__bt = c._blendType;
          this.__cn = c._characterName; this.__ci = c._characterIndex; this.__tid = c._tileId; this.__tr = c._transparent; this.__bd = c._bushDepth; this.__pt = c._priorityType; this.__jc = c._jumpCount; this.__sid = gm._tilesetId;
        }
      }
      this.__busy = busy;
      this.__off = this.x < -128 || this.x > Graphics.width + 128 || this.y < -192 || this.y > Graphics.height + 128;
      this.renderable = !this.__off;                                   // far off screen: not drawn either
    };
    // ... nor transformed: its world matrix is refreshed on the update that brings it back within the margin
    const base = SC.updateTransform;
    SC.updateTransform = function () { if (this.__off) return; return base.apply(this, arguments); };
  }

  // 3b. An idle character (not moving, not jumping, no step animation, resting on its original pattern, animation
  //     counter at 0) changes nothing in Game_CharacterBase.update except _stopCount. 156 events per update
  //     made that ~8 interpreted calls each; the exact same state change is now one comparison chain.
  {
    const CB = g.Game_CharacterBase.prototype, update = CB.update, baseStop = CB.updateStop, baseStopping = CB.isStopping;
    CB.update = function () {
      // only for characters that keep the base updateStop/isStopping (events, followers, the player override them)
      if (this.updateStop === baseStop && this.isStopping === baseStopping && this._realX === this._x && this._realY === this._y && this._jumpCount <= 0 && !this._stepAnime &&
          this._animationCount === 0 && this._pattern === this._originalPattern) {
        this._stopCount++;
        return;
      }
      return update.apply(this, arguments);
    };
  }

  // 4. Game_Interpreter.executeCommand builds 'command' + code as a fresh string for every command; cache the
  //    names. Only replaced when it is the stock implementation (a plugin that wrapped it keeps working).
  {
    const GI = g.Game_Interpreter.prototype, src = String(GI.executeCommand);
    if (src.indexOf("'command' + command.code") >= 0 && src.length < 500) {
      const names = [];
      // commands whose execution has no effect beyond reading switches/variables: end of list, comments,
      // else/end-of-branch markers (a conditional branch on switch/variable/self switch is handled inline)
      // $gameActors.actor(N).setCharacterImage('name', i) (script) and Change Actor Graphic (322) as comparable specs
      const IMG = /^\$gameActors\.actor\((\d+)\)\.setCharacterImage\('([^']*)',\s*(\d+)\);?\s*$/;
      const FACE = /^\$gameActors\.actor\((\d+)\)\.setFaceImage\('([^']*)',\s*(\d+)\);?\s*$/;
      const BATT = /^\$gameActors\.actor\((\d+)\)\.setBattlerImage\('([^']*)'\);?\s*$/;
      const imgSpec = (c, next) => {
        if (c.__spec !== undefined) return next && next.code === 655 ? null : c.__spec;
        let sp = null;
        if (c.code === 356) {                                       // plugin commands that are idempotent
          const t = c.parameters[0]; let m;
          if (t === "DisableDashing" || t === "EnableDashing") sp = [903, t === "DisableDashing"];
          else if ((m = /^eraseFilter\s+(\S+)\s*$/i.exec(t))) sp = [904, m[1]];
        } else if (c.code === 322) sp = [322, c.parameters[0], c.parameters[1], c.parameters[2], c.parameters[3], c.parameters[4], c.parameters[5]];
        else {
          const t = c.parameters[0]; let m;
          if ((m = IMG.exec(t))) sp = [355, +m[1], m[2], +m[3]];
          else if ((m = FACE.exec(t))) sp = [901, +m[1], m[2], +m[3]];
          else if ((m = BATT.exec(t))) sp = [902, +m[1], m[2]];
          else if (/^\$gamePlayer\.refresh\(\);?\s*$/.test(t)) sp = [900, 0];
        }
        c.__spec = sp;
        return next && next.code === 655 ? null : sp;
      };
      const imgEq = (sp) => {
        if (sp[0] === 903) return g.$gameSystem.isDashDisabled() === sp[1];
        if (sp[0] === 904) return !g.$gameMap._filterConArr || !g.$gameMap._filterConArr.get(sp[1]);
        if (sp[0] === 900) {                                        // Game_Player.refresh would re-set images that are already right
          const l = g.$gameParty.leader(), p = g.$gamePlayer;
          if (p._characterName !== (l ? l.characterName() : "") || p._characterIndex !== (l ? l.characterIndex() : 0)) return false;
          const fl = p._followers._data;
          for (let i = 0; i < fl.length; i++) {
            const f = fl[i], a = f.actor(), n = f.isVisible() ? a.characterName() : "", x = f.isVisible() ? a.characterIndex() : 0;
            if (f._characterName !== n || f._characterIndex !== x) return false;
          }
          return true;
        }
        const a = g.$gameActors.actor(sp[1]);
        if (!a) return false;
        if (sp[0] === 355) return a._characterName === sp[2] && a._characterIndex === sp[3];
        if (sp[0] === 902) return a._battlerName === sp[2];
        if (sp[0] === 901) return a._faceName === sp[2] && a._faceIndex === sp[3];
        return a._characterName === sp[2] && a._characterIndex === sp[3] && a._faceName === sp[4] && a._faceIndex === sp[5] && a._battlerName === sp[6];
      };
      g.__imgEq = imgEq;
      const PURE = new Uint8Array(1000);
      for (const c of [0, 108, 408, 411, 412, 112, 413, 113, 115, 118, 119, 121, 123]) PURE[c] = 1;
      g.__PURE = PURE;
      GI.executeCommand = function () {
        const command = this.currentCommand();
        if (command) {
          this._params = command.parameters;
          this._indent = command.indent;
          const code = command.code, name = names[code] || (names[code] = "command" + code), f = this[name];
          let spec;
          if (this.__pure) {            // see 7: which commands leave the next identical run a no-op
            const p = command.parameters, t = p[0];
            if (PURE[code] === 1 || (code === 111 && t <= 2) || (code === 122 && p[3] <= 1) || code === 117) {
            } else if (code === 111 && (t === 4 || (t >= 7 && t <= 10))) { (this.__root || this).__actC = true;  // actor/party condition: see 7
            } else if (code === 230 && t <= 120) { (this.__root || this).__waited = true;
            } else if (code === 111 && t === 11 && g.__rec) {
              g.__rec.push(3, p[1], Input.isPressed(p[1]));                       // a button condition: remember its state
            } else if (code === 122 && p[3] === 3 && p[4] === 5 && g.__rec) {
              g.__rec.push(4, [this, p[5], p[6]], this.gameDataOperand(5, p[5], p[6]));   // character x/y/direction operand
            } else if ((code === 355 || code === 322 || code === 356) && g.__rec && (spec = imgSpec(command, this._list[this._index + 1]))) {
              // an actor-image setter whose target already has that image does nothing: skip it, depend on the image
              if (!imgEq(spec)) { this.__pure = false; if (this.__root) this.__root.__pure = false; }
              else { g.__rec.push(5, spec, true); this._index++; return true; }
            } else { this.__pure = false; if (this.__root) this.__root.__pure = false; }
          }
          if (typeof f === "function") { if (!f.call(this)) return false; }
          this._index++;
        } else {
          this.terminate();
        }
        return true;
      };
    }
  }

  // A child interpreter (common event call) belongs to its parent's idle-cache run: its impure commands count.
  {
    const GI = g.Game_Interpreter.prototype, sc = GI.setupChild;
    GI.setupChild = function () {
      const r = sc.apply(this, arguments), c = this._childInterpreter;
      if (c) { c.__pure = !!this.__pure; c.__root = this.__root || this; }
      return r;
    };
  }

  // 7. Idle parallel events. ~60 parallel/common-event interpreters are restarted every frame; most evaluate a
  //    switch/variable condition, find it false and finish having changed nothing, identically every frame.
  //    When a list's previous run executed only pure commands (see PURE) and no switch/variable/self switch
  //    has changed since (g.__stateVer), the next run would be the same no-op, so setup+run are skipped. Any
  //    state change, a different page/list, or any impure command (wait, write, script, text, plugin command)
  //    brings the normal path back. Exactly equivalent for lists of conditional branches on switches/variables.
  //  Conditions on actors, gold and items (the bulk of F&H's common events) read party/actor state, so those
  //  mutators bump g.__stateVer too; skipped runs are also re-verified every 60 frames as a safety net for any
  //  plugin path that changes such state without going through them (see TTL renewal below for how).
  {
    const bump = (proto, names) => { for (const n of names) { const f = proto[n]; if (typeof f === "function") proto[n] = function () { g.__actVer++; return f.apply(this, arguments); }; } };
    bump(g.Game_BattlerBase.prototype, ["refresh", "clearStates", "addNewState", "eraseState"]);
    for (const n of ["setCharacterImage", "setFaceImage", "setBattlerImage"]) {          // image reads (spec kinds 355/322/900) are versioned separately
      const f = g.Game_Actor.prototype[n];
      if (typeof f === "function") g.Game_Actor.prototype[n] = function () { g.__imgVer++; return f.apply(this, arguments); };
    }
    bump(g.Game_Actor.prototype, ["setName", "changeClass", "learnSkill", "forgetSkill", "changeEquip", "forceChangeEquip", "discardEquip", "initEquips", "clearEquipments", "optimizeEquipments", "setup", "releaseUnequippableItems"]);
    for (const C of [g.Game_Player, g.Game_Follower]) {          // the player's/followers' own sprite images (read by $gamePlayer.refresh checks)
      const si = C.prototype.setImage;
      C.prototype.setImage = function (n, i) { if (this._characterName !== n || this._characterIndex !== i) g.__imgVer++; return si.apply(this, arguments); };
    }
    bump(g.Game_Party.prototype, ["gainItem", "gainGold", "loseGold", "addActor", "removeActor", "setupStartingMembers", "initialize"]);
  }
  {
    // The variables/switches/self switches a pure run actually read are recorded with the values it saw; the run
    // is skipped while every one of them still has that value (so a counter nobody here reads costs nothing).
    for (const [cls, sw] of [[g.Game_Variables, 1], [g.Game_Switches, 0], [g.Game_SelfSwitches, 2]]) {
      const proto = cls.prototype, value = proto.value;
      proto.value = function (id) {
        const v = value.apply(this, arguments);
        if (g.__rec) {                                                  // not a dependency if this run wrote it first
          const wl = g.__curIt.__wl;
          for (let j = 0; j < wl.length; j += 3) if (wl[j] === this && wl[j + 1] === id) return v;
          g.__rec.push(sw, id, v);
        }
        return v;
      };
    }
    const same = (r) => {
      const V = g.$gameVariables, S = g.$gameSwitches, SS = g.$gameSelfSwitches;
      for (let i = 0; i < r.length; i += 3) {
        const k = r[i], id = r[i + 1], v = r[i + 2];
        if (k === 1 ? (V._data[id] || 0) !== v : k === 0 ? !!S._data[id] !== v : k === 2 ? (SS._data[id] ? true : false) !== v :
            k === 3 ? Input.isPressed(id) !== v : k === 5 ? g.__imgEq(id) !== v : id[0].gameDataOperand(5, id[1], id[2]) !== v) return false;
      }
      return true;
    };
    // Writes that cancel out (CE 49 zeroes variable 34 and re-counts the party into it) leave state as it was;
    // only valid when no wait ran in between, so nothing could have observed the transient values.
    const netNoop = (wl) => {
      for (let i = 0; i < wl.length; i += 3) {
        const st = wl[i], id = wl[i + 1], b = wl[i + 2], d = st._data;
        let dup = false;
        for (let j = 0; j < i; j += 3) if (wl[j] === st && wl[j + 1] === id) { dup = true; break; }
        if (dup) continue;                                     // only the value before the first write counts
        if (st instanceof g.Game_Variables ? (d[id] || 0) !== (b || 0) : !!d[id] !== !!b) return false;
      }
      return true;
    };
    // TTL renewal. When a cached run's 60 updates run out it is re-run as the safety net above; the Outfit common
    // events (~2000 commands each, plus ~1 ms of image requests in their setup) expire together: two 6-12 ms
    // updates on the PC about once a second. A cached run is a deterministic function of
    //  (a) the values it read and the final values of the ids it wrote (a re-run writes them again): the record;
    //  (b) the actor/party state that its conditions on actors, gold, items, weapons and armors (111) read. That
    //      is not recorded; at the end of every call (one update's worth of commands) that evaluated such a
    //      condition, a fingerprint of that state is taken. Within a call only the run's own pure commands run, so
    //      it is the state those conditions saw. If the calls of one run saw different states, it is not renewable.
    // When (a) and (b) are unchanged at expiry, a re-run would take the same path and end cached with the same
    // record, so the cache is renewed for another 60 updates instead (the re-run's setup and waits are skipped
    // too: a list with waits is renewed at its expiry rather than re-cached at the end of its re-run). Anything
    // else, or a scene change in progress (which defers a re-run), takes the normal re-run.
    const fpEnd = {};
    const fpArr = (b, a) => { if (!a) { b.push(-1); return; } b.push(a.length); for (let i = 0; i < a.length; i++) b.push(a[i]); };
    const fpObj = (b, o) => { for (const k in o) b.push(k, o[k]); b.push(fpEnd); };
    const fingerprint = (b) => {
      const P = g.$gameParty, A = g.$gameActors._data;
      b.length = 0;
      b.push(P._gold, !!P._inBattle); fpArr(b, P._actors); fpArr(b, P._guestActors);
      fpObj(b, P._items); fpObj(b, P._weapons); fpObj(b, P._armors);
      for (let i = 0; i < A.length; i++) {
        const a = A[i];
        if (!a) { b.push(null); continue; }
        b.push(a._name, a._classId, !!a._hidden); fpArr(b, a._skills); fpArr(b, a._states);
        const e = a._equips; b.push(e.length);
        for (let j = 0; j < e.length; j++) { const x = e[j]; if (x) b.push(x._dataClass, x._itemId); else b.push(null); }
      }
      return b;
    };
    const fpEq = (a, b) => {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    };
    const fpBuf = [];
    const fpNow = () => {                                             // the current fingerprint, in a reused buffer
      const d = g.__pdbg, a = d ? nx.now() : 0;
      fingerprint(fpBuf);
      if (d) { d.fpN++; d.fpT += nx.now() - a; }
      return fpBuf;
    };
    const renew = (it) => {
      const d = g.__pdbg;
      if (d) d.expire++;
      if (!it.__rok) return false;
      if (g.SceneManager.isSceneChanging()) { if (d) d.rScene++; return false; }
      if (!same(it.__idleRec)) { if (d) d.rRec++; return false; }
      if (it.__fp && !fpEq(fpNow(), it.__fp)) { if (d) d.rFp++; return false; }
      it.__idleU = g.__upd;
      const ow = it.__owner;
      if (ow) { ow.__sleep = it.__ev; ow.__sleepUntil = g.__upd + 60; ow.__sleepAct = g.__actVer; ow.__sleepImg = it.__img5; }
      if (d) d.renew++;
      return true;
    };
    // true: this run would be the cached no-op, skip it
    const idle = (it, list) => {
      if (it._list || !list || it.__idleList !== list || it.__idleAct !== g.__actVer) return false;
      if (it.__ev && (it.__dirty || (it.__img5 && it.__img5 !== g.__imgVer))) return false;
      if (g.__upd - it.__idleU < 60) return it.__ev || same(it.__idleRec);
      return renew(it);
    };
    const tracked = (it, list, setupFn) => {
      if (!it._list) {
        if (!list) return setupFn();                                  // nothing to run: stock behaviour
        if (g.__pdbg) { g.__pdbg.fresh++; if (it.__idleList === list) g.__pdbg[it.__ev ? "freshDirty" : "freshSame"]++; }
        g.__rec = it.__r0 = [];
        it.__ww = [];
        g.__curIt = it;
        setupFn();
        it.__pure = true; it.__wl = []; it.__waited = false; it.__a0 = g.__actVer; it.__l0 = list; it.__root = null;
        it.__fp0 = null; it.__fpBad = false;
      } else { if (g.__pdbg) g.__pdbg.cont++; if (it.__pure) { g.__rec = it.__r0; g.__curIt = it; } }
      it.__actC = false;
      it.update();
      g.__rec = null; g.__curIt = null;
      if (it.__actC && it.__pure && it.__l0) {                        // this call evaluated actor/party conditions
        if (!it.__fp0) it.__fp0 = fpNow().slice();
        else if (!it.__fpBad && !fpEq(fpNow(), it.__fp0)) it.__fpBad = true;
      }
      if (it.__l0 && !it.isRunning()) {
        if (it.__pure && g.__actVer === it.__a0 && (it.__wl.length === 0 || (!it.__waited && netNoop(it.__wl)))) {
          it.__idleList = it.__l0; it.__idleAct = it.__a0; it.__idleU = g.__upd; it.__idleRec = it.__r0;
          // when every read is a plain switch/variable, value changes mark it dirty (no re-reading each update)
          const r = it.__r0; let ev = true;
          for (let i = 0; i < r.length; i += 3) if (r[i] > 1 && r[i] !== 5) { ev = false; break; }   // image reads are covered by __actVer (setImage hooks)
          let h5 = false; for (let i = 0; i < r.length; i += 3) if (r[i] === 5) { h5 = true; break; }
          it.__ev = ev; it.__dirty = false; it.__img5 = h5 ? g.__imgVer : 0;
          // Every id the run wrote joins the record with the value it last wrote there: stock writes it again on
          // its next pass, so when anyone else changes it the owner has to run (switches/variables are watched like
          // reads; the record is re-read every update when the run is not watched, and at expiry in any case). If
          // another writer already changed it while this run was waiting, the owner runs on the next update.
          const w = it.__ww;
          let stale = false;
          if (w.length) {
            const seen = [new Set(), new Set(), new Set()];
            for (let i = w.length - 3; i >= 0; i -= 3) {                 // last write first
              const st = w[i], id = w[i + 1], v = w[i + 2], k = st instanceof g.Game_Variables ? 1 : st instanceof g.Game_Switches ? 0 : 2, key = k === 2 ? String(id) : id;
              if (seen[k].has(key)) continue;
              seen[k].add(key);
              r.push(k, id, v);
              if ((k === 1 ? (st._data[id] || 0) : !!st._data[id]) !== v) stale = true;
            }
          }
          it.__ww = null;
          it.__rok = !it.__fpBad; it.__fp = it.__fp0;                   // renewable at expiry (see TTL renewal above)
          const ow = it.__owner;
          if (ow) { ow.__sleep = ev; ow.__sleepUntil = g.__upd + 60; ow.__sleepAct = g.__actVer; ow.__sleepImg = it.__img5; }   // owner is skipped outright until woken
          if (stale) { it.__dirty = true; if (ow) ow.__sleep = false; }
          if (ev) for (let i = 0; i < r.length; i += 3) { if (r[i] > 1) continue; const m = g.__watch[r[i]]; let st = m.get(r[i + 1]); if (!st) m.set(r[i + 1], st = new Set()); st.add(it); }
        } else { it.__idleList = null; if (g.__pdbg) { const k = it.__pure ? (it.__waited ? "endPureWaitWrite" : "endPureWrite") : "endImpure"; g.__pdbg[k] = (g.__pdbg[k] || 0) + 1; } }
        it.__l0 = null;
      }
    };
    const GE = g.Game_Event.prototype, upd = GE.updateParallel;
    if (String(upd).length < 300) GE.updateParallel = function () {
      const it = this._interpreter;
      if (!it) return;
      const list = this.list();
      it.__owner = this;
      if (idle(it, list)) return;
      tracked(it, list, () => it.setup(list, this._eventId));
    };
    const GC = g.Game_CommonEvent.prototype, cupd = GC.update;
    if (String(cupd).length < 300) GC.update = function () {
      const it = this._interpreter;
      if (!it) return;
      const list = this.list();
      it.__owner = this;
      if (idle(it, list)) return;
      tracked(it, list, () => it.setup(list));
    };
  }

  // 8. Tilemap._sortChildren sorts ~150 sprites every update (~950 interpreted comparator calls) though the
  //    order barely changes between updates. A stable insertion sort with the comparison inlined is ~n steps on
  //    nearly sorted input and gives the identical order. Only when the comparator is the (a.z||0)/(a.y||0)/
  //    spriteId one this game ships; anything else keeps the stock sort.
  //    Reading .y is three interpreted getters (DisplayObject.y -> position -> ObservablePoint.y) per read, ~1600
  //    a frame on a 550-child map. Where those are PIXI's own accessors the value is transform.position._y, read
  //    directly; each child is checked once (its class keeps them, its position is an ObservablePoint) and keeps
  //    the transform it was checked with in __yt, so a new transform is checked again (PIXI never replaces a
  //    transform's position; a y accessor defined on a child after its check would be missed, nothing here does
  //    that). A child that fails sends this call to the getter version, which resumes correctly on the partly
  //    sorted array (a stable insertion sort). The predecessor's key is carried from the previous step, so on
  //    sorted input each child is read once. Same comparisons on the same values in the same order, same result
  //    (tests/tilemap_sort_verify.js checks every call against the getter version and the stock sort).
  {
    const TM = g.Tilemap.prototype, DO = g.PIXI.DisplayObject.prototype, OP = g.PIXI.ObservablePoint.prototype;
    const hop = Object.prototype.hasOwnProperty, flat = (f) => (typeof f === "function" ? String(f) : "").replace(/\s+/g, "");
    const getterIs = (o, k, s) => { const d = Object.getOwnPropertyDescriptor(o, k); return !!d && flat(d.get) === s; };
    if (String(TM._compareChildOrder).indexOf("(a.z || 0) !== (b.z || 0)") >= 0 && String(TM._sortChildren).length < 200) {
      const slow = function () {
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
      const yOK =   // pixi.js 4.5.4's accessors, whitespace removed
        getterIs(DO, "y", "functionget(){returnthis.position.y;}") && getterIs(DO, "position", "functionget(){returnthis.transform.position;}") &&
        getterIs(OP, "y", "functionget(){returnthis._y;}");
      if (!yOK) nx.log("patch 8: the DisplayObject y accessors are not stock, tilemap sort reads .y");
      const stockY = (o) => {   // o.y is o.transform.position._y
        let p = o;
        for (; p !== null && p !== DO; p = Object.getPrototypeOf(p)) if (hop.call(p, "y") || hop.call(p, "position")) return false;
        const t = p === DO ? o.transform : null, pt = t ? t.position : null;
        return !!pt && Object.getPrototypeOf(pt) === OP && !hop.call(pt, "y") && hop.call(pt, "_y");
      };
      TM._sortChildren = !yOK ? slow : function () {
        const a = this.children, n = a.length;
        if (n < 2) return;
        const p = a[0];
        let t = p.transform;   // addChild needs a transform: stock's .y throws where this does
        if (p.__yt !== t) { if (!stockY(p)) return slow.call(this); p.__yt = t; }
        let pz = p.z || 0, py = t.position._y || 0, ps = p.spriteId;
        for (let i = 1; i < n; i++) {
          const x = a[i];
          t = x.transform;
          if (x.__yt !== t) { if (!stockY(x)) return slow.call(this); x.__yt = t; }
          const xz = x.z || 0, xy = t.position._y || 0, xs = x.spriteId;
          if (pz < xz || (pz === xz && (py < xy || (py === xy && !(ps > xs))))) { pz = xz; py = xy; ps = xs; continue; }
          let j = i - 1;
          a[i] = a[j];
          for (j--; j >= 0; j--) {   // a[0..i-1] were all checked in this call
            const y = a[j], yz = y.z || 0;
            if (yz < xz) break;
            if (yz === xz) { const yy = y.transform.position._y || 0; if (yy < xy || (yy === xy && !(y.spriteId > xs))) break; }
            a[j + 1] = y;
          }
          a[j + 1] = x;   // a[i] is now the old a[i-1], whose key is the one carried
        }
      };
    }
  }

  // 16. Tilemap paint cache. Every time the camera crosses a tile boundary (every 16 logic updates per axis while
  //     walking) ShaderTilemap._paintAllTiles clears both tile layers and recomputes every visible cell: 6
  //     _readMapData calls, flag tests, _drawTile/_drawAutotile/_drawShadow/_drawTableEdge and 9 push() per rect,
  //     2-3.2 ms on a PC (5.4 worst), a 6-20 ms hitch on the Switch. A cell's rects depend only on its 6 map values
  //     (layers 0-3, the shadow bits, layer 1 of the tile above), on flag bits 0x10/0x80 of those 5 tiles and on
  //     the tile size, and they are emitted at the cell's screen offset. So the stock _paintTiles records a map
  //     cell's rects (relative to the cell) the first time, and they are replayed at the new offset while the
  //     cell's key is unchanged: both layers' pointsBuf and hasAnim come out element for element as stock, in the
  //     same order (0.75-0.97 ms per paint on a PC, 1.8 worst). The store is flat typed arrays (20 bytes per map
  //     cell, 18 per cached rect, a handful of JS objects; 0.2-0.6 MB on the big maps), one for the tilemap that
  //     painted last, rebuilt when another tilemap paints or the map data, flags array, map size or tile size
  //     change. The first paint of a map records every cell (1.5-2x the stock paint); later ones only record the
  //     cells that came into view or changed. Cells off a non-looping map draw nothing in stock and are skipped;
  //     the row just below one (it can draw the table edge of the tile above) and values that do not fit the
  //     store go through the stock _paintTiles every time. Only installed when everything the painting reaches
  //     has this game's stock source. Check: tests/paint_verify.js.
  {
    const T = g.Tilemap, ST = g.ShaderTilemap && g.ShaderTilemap.prototype, PT = g.PIXI.tilemap;
    const RL = PT && PT.RectTileLayer && PT.RectTileLayer.prototype;
    const NAMES = ["_paintTiles", "_readMapData", "_isHigherTile", "_isTableTile", "_isOverpassPosition", "_drawTile", "_drawNormalTile", "_drawAutotile", "_drawTableEdge", "_drawShadow"];
    const STATICS = ["isVisibleTile", "isAutotile", "isTileA1", "isTileA2", "isTileA3", "isTileA4", "isTileA5", "getAutotileKind", "getAutotileShape", "isShadowingTile"];
    let h = 0x811c9dc5;
    if (ST && RL) {
      let src = [ST._paintAllTiles, RL.addRect, Number.prototype.mod].concat(NAMES.map((n) => ST[n]), STATICS.map((n) => T[n])).map(String).join("\n") +
        JSON.stringify([T.FLOOR_AUTOTILE_TABLE, T.WALL_AUTOTILE_TABLE, T.WATERFALL_AUTOTILE_TABLE, T.TILE_ID_B, T.TILE_ID_C, T.TILE_ID_D, T.TILE_ID_E,
          T.TILE_ID_A5, T.TILE_ID_A1, T.TILE_ID_A2, T.TILE_ID_A3, T.TILE_ID_A4, T.TILE_ID_MAX]);
      src = src.replace(/\s+/g, "");                                    // FNV-1a over the code without whitespace
      for (let i = 0; i < src.length; i++) h = Math.imul(h ^ src.charCodeAt(i), 0x01000193);
    }
    if ((h >>> 0) !== 0x6521c030) nx.log("port patch: tilemap paint cache off (tile painting code is not stock, " + (h >>> 0).toString(16) + ")");
    else {
      const stockPaint = ST._paintAllTiles, refs = NAMES.map((n) => ST[n]), POOL_MAX = 1 << 21;
      const stats = { paints: 0, hit: 0, miss: 0, edge: 0, stock: 0, resets: 0 };   // edge: cells painted by the stock _paintTiles
      // one cache for the tilemap that painted last (tilemaps get an id, the cache holds no tilemap): a tilemap
      // the game keeps alive after its scene (map 80's is) does not keep a cache alive with it
      let cache = null, owners = 0;
      g.__paintCache = { stock: stockPaint, stats, cache: () => cache };
      // copy the rects src[from..to) into the pool from index q, cell-relative; false if a value does not fit an
      // Int16Array exactly (not an integer, out of range, or -0)
      const store = (P, q, src, from, to, dx, dy) => {
        for (let j = from; j < to; j += 9, q += 9) {
          const a0 = src[j], a1 = src[j + 1], a2 = src[j + 2] - dx, a3 = src[j + 3] - dy, a4 = src[j + 4], a5 = src[j + 5], a6 = src[j + 6], a7 = src[j + 7], a8 = src[j + 8];
          if (((a0 << 16) >> 16) !== a0 || ((a1 << 16) >> 16) !== a1 || ((a2 << 16) >> 16) !== a2 || ((a3 << 16) >> 16) !== a3 || ((a4 << 16) >> 16) !== a4 ||
              ((a5 << 16) >> 16) !== a5 || ((a6 << 16) >> 16) !== a6 || ((a7 << 16) >> 16) !== a7 || ((a8 << 16) >> 16) !== a8) return false;
          if ((a0 === 0 && 1 / a0 < 0) || (a1 === 0 && 1 / a1 < 0) || (a2 === 0 && 1 / a2 < 0) || (a3 === 0 && 1 / a3 < 0) || (a4 === 0 && 1 / a4 < 0) ||
              (a5 === 0 && 1 / a5 < 0) || (a6 === 0 && 1 / a6 < 0) || (a7 === 0 && 1 / a7 < 0) || (a8 === 0 && 1 / a8 < 0)) return false;
          P[q] = a0; P[q + 1] = a1; P[q + 2] = a2; P[q + 3] = a3; P[q + 4] = a4; P[q + 5] = a5; P[q + 6] = a6; P[q + 7] = a7; P[q + 8] = a8;
        }
        return true;
      };
      ST._paintAllTiles = function (startX, startY) {
        const tw = this._tileWidth, th = this._tileHeight, data = this._mapData, W = this._mapWidth, H = this._mapHeight, flags = this.flags;
        const lowerRL = this.lowerLayer && this.lowerLayer.children[0], upperRL = this.upperLayer && this.upperLayer.children[0];
        let same = !!(data && lowerRL && upperRL && W > 0 && H > 0 && (W | 0) === W && (H | 0) === H && W * H <= 262144 &&
          (startX | 0) === startX && (startY | 0) === startY && (tw | 0) === tw && (th | 0) === th && tw > 0 && th > 0);
        for (let i = 0; same && i < NAMES.length; i++) same = this[NAMES[i]] === refs[i];
        if (!same) { stats.stock++; return stockPaint.call(this, startX, startY); }
        const id = this.__pcid || (this.__pcid = ++owners);
        let c = cache;
        if (c === null || c.id !== id || c.data !== data || c.W !== W || c.H !== H || c.flags !== flags || c.tw !== tw || c.th !== th) {
          c = cache = { id, data, W, H, flags, tw, th, key: new Int16Array(W * H * 8), off: new Int32Array(W * H), pool: new Int16Array(9 * 2048), top: 0 };
        }
        this.lowerZLayer.clear();
        this.upperZLayer.clear();
        const tileCols = Math.ceil(this._width / tw) + 1, tileRows = Math.ceil(this._height / th) + 1;
        const WH = W * H, hw = !!this.horizontalWrap, vw = !!this.verticalWrap, K = c.key, OFF = c.off;
        const lpb = lowerRL.pointsBuf, upb = upperRL.pointsBuf;
        let P = c.pool, la = false, ua = false, hit = 0, miss = 0, edge = 0;
        for (let y = 0; y < tileRows; y++) {
          const my = startY + y, dy = y * th;
          // _readMapData: Number.prototype.mod's formula on a looping axis, 0 outside the map
          const myw = vw ? ((my % H) + H) % H : my, myu = vw ? (((my - 1) % H) + H) % H : my - 1;
          const inRow = myw >= 0 && myw < H, upRow = myu >= 0 && myu < H;
          if (!inRow && !upRow) continue;                              // all 6 reads are 0: stock draws nothing
          const rowBase = myw * W, upBase = WH + myu * W;
          for (let x = 0; x < tileCols; x++) {
            const mx = startX + x, mxw = hw ? ((mx % W) + W) % W : mx;
            if (mxw < 0 || mxw >= W) continue;                         // all 6 reads are 0 again
            if (!inRow) { edge++; this._paintTiles(startX, startY, x, y); continue; }     // the row just below the map
            const i0 = rowBase + mxw;
            const t0 = data[i0] || 0, t1 = data[WH + i0] || 0, t2 = data[2 * WH + i0] || 0, t3 = data[3 * WH + i0] || 0,
              sb = data[4 * WH + i0] || 0, u1 = upRow ? data[upBase + mxw] || 0 : 0;
            const fb = (flags[t0] & 0x90) | ((flags[t1] & 0x90) >> 2) | ((flags[t2] & 0x90) >> 4) | ((flags[t3] & 0x90) << 4) | ((flags[u1] & 0x90) << 6);
            const b = i0 << 3, m = K[b + 7];
            if (m !== 0 && K[b] === t0 && K[b + 1] === t1 && K[b + 2] === t2 && K[b + 3] === t3 && K[b + 4] === sb && K[b + 5] === u1 && K[b + 6] === fb) {
              hit++;
              const dx = x * tw;
              let q = OFF[i0] * 9, n = (m >> 3) & 63, k = lpb.length;
              for (; n > 0; n--, q += 9) {
                lpb[k] = P[q]; lpb[k + 1] = P[q + 1]; lpb[k + 2] = P[q + 2] + dx; lpb[k + 3] = P[q + 3] + dy; lpb[k + 4] = P[q + 4];
                lpb[k + 5] = P[q + 5]; lpb[k + 6] = P[q + 6]; lpb[k + 7] = P[q + 7]; lpb[k + 8] = P[q + 8]; k += 9;
              }
              n = (m >> 9) & 63; k = upb.length;
              for (; n > 0; n--, q += 9) {
                upb[k] = P[q]; upb[k + 1] = P[q + 1]; upb[k + 2] = P[q + 2] + dx; upb[k + 3] = P[q + 3] + dy; upb[k + 4] = P[q + 4];
                upb[k + 5] = P[q + 5]; upb[k + 6] = P[q + 6]; upb[k + 7] = P[q + 7]; upb[k + 8] = P[q + 8]; k += 9;
              }
              if (m & 2) la = true;
              if (m & 4) ua = true;
              continue;
            }
            // not cached (or the cell changed): the stock cell paint, recorded
            miss++;
            const l0 = lpb.length, u0 = upb.length, la0 = lowerRL.hasAnim, ua0 = upperRL.hasAnim;
            lowerRL.hasAnim = false; upperRL.hasAnim = false;
            this._paintTiles(startX, startY, x, y);
            const cla = lowerRL.hasAnim, cua = upperRL.hasAnim;
            lowerRL.hasAnim = la0 || cla; upperRL.hasAnim = ua0 || cua;
            const rl = (lpb.length - l0) / 9, ru = (upb.length - u0) / 9;
            K[b + 7] = 0;
            if (rl > 63 || ru > 63 || ((t0 << 16) >> 16) !== t0 || ((t1 << 16) >> 16) !== t1 || ((t2 << 16) >> 16) !== t2 || ((t3 << 16) >> 16) !== t3 ||
                ((sb << 16) >> 16) !== sb || ((u1 << 16) >> 16) !== u1) continue;          // keys must fit the Int16Array too (never -0: '|| 0')
            let p = c.top;
            const reuse = m !== 0 && ((m >> 3) & 63) + ((m >> 9) & 63) >= rl + ru;
            if (reuse) p = OFF[i0];                                        // the cell's old slot is big enough
            else {
              if ((p + rl + ru) * 9 > P.length) {
                let n = P.length * 2;
                while (n < (p + rl + ru) * 9) n *= 2;
                if (n > POOL_MAX) { K.fill(0); c.top = p = 0; n = P.length; stats.resets++; }   // runaway tile edits: start over
                if (n > P.length) { const np = new Int16Array(n); np.set(P); P = c.pool = np; }
              }
              c.top = p + rl + ru;
            }
            const dx = x * tw;
            if (!store(P, p * 9, lpb, l0, lpb.length, dx, dy) || !store(P, (p + rl) * 9, upb, u0, upb.length, dx, dy)) {
              if (!reuse) c.top = p;                                       // not storable: give the space back
              continue;
            }
            OFF[i0] = p;
            K[b] = t0; K[b + 1] = t1; K[b + 2] = t2; K[b + 3] = t3; K[b + 4] = sb; K[b + 5] = u1; K[b + 6] = fb;
            K[b + 7] = 1 | (cla ? 2 : 0) | (cua ? 4 : 0) | (rl << 3) | (ru << 9);
          }
        }
        if (la) lowerRL.hasAnim = true;
        if (ua) upperRL.hasAnim = true;
        stats.paints++; stats.hit += hit; stats.miss += miss; stats.edge += edge;
      };
    }
  }

  // 9. A resting event (not moving/jumping/animating, no self movement, not locked, no auto trigger, not chasing,
  //    fleeing or alerted) does in Game_Event.update only: _stopCount++, the alert lock countdown, and its parallel
  //    interpreter. Everything else in the chain (updateStop, updateSelfMovement and Yanfly's chase hooks,
  //    updateAnimation, checkEventTriggerAuto, updateAlert, updateReturnPhase) is a no-op for such an event.
  //    About 160 of the ~260 event updates per frame on a big map. Only installed over the stock + Yanfly chain.
  {
    const GE = g.Game_Event.prototype, update = GE.update, src = String(update);
    if (src.indexOf("updateAlert") >= 0 && src.indexOf("updateReturnPhase") >= 0 && src.length < 300) {
      GE.__restFast = true;
      GE.update = function () {
        if (this._realX === this._x && this._realY === this._y && this._jumpCount <= 0 && !this._stepAnime &&
            this._animationCount === 0 && this._pattern === this._originalPattern && !this._moveRouteForcing &&
            this._moveType === 0 && this._trigger !== 3 && !this._locked && !this._chasePlayer && !this._fleePlayer &&
            !(this._chaseRange > 0) && !(this._fleeRange > 0) && !this._returnPhase && !this._alertPlayer) {
          this._stopCount++;
          if (!this._erased) this._alertLock--;
          this.updateParallel();
          return;
        }
        return update.apply(this, arguments);
      };
    }
  }

  // 10. Game_Map.events() builds a filtered copy of ~400 slots on every call (about 15 calls per update), and
  //     updateEvents goes through forEach + Game_Event.update for every event. The list is cached per map
  //     (the _events array is only ever built by setupEvents), and resting events (see 9) are handled inline.
  {
    const GM = g.Game_Map.prototype, events = GM.events, ue = GM.updateEvents, GE = g.Game_Event.prototype;
    if (String(events).length < 200) GM.events = function () {
      const ev = this._events;
      if (this.__evSrc !== ev || this.__evLen !== ev.length) { this.__evSrc = ev; this.__evLen = ev.length; this.__evArr = events.apply(this, arguments); }
      return this.__evArr;
    };
    // a page change or common-event refresh replaces the interpreter/list: wake the owner
    { const sp = GE.setupPage, cr = g.Game_CommonEvent.prototype.refresh;
      GE.setupPage = function () { this.__sleep = false; return sp.apply(this, arguments); };
      g.Game_CommonEvent.prototype.refresh = function () { const before = this._interpreter; const r = cr.apply(this, arguments); if (this._interpreter !== before) this.__sleep = false; return r; }; }
    // Amortization: an event that has been resting for SETTLED consecutive checks (and has no interpreter) is only
    // looked at every (SKIP+1)th update. The skipped updates would only have counted _stopCount and _alertLock up
    // and down, so those are owed (__sc/__sd) and paid at the next check, exactly. The methods that make an event
    // stop resting wake it at once; anything else (a plugin writing a flag directly) is noticed within SKIP updates.
    const SETTLED = 24, SKIP = 3;
    const wake = (e) => {
      if (e.__sd) { e._stopCount += e.__sc; if (!e._erased) e._alertLock -= e.__sd; e.__sd = e.__sc = 0; }
      e.__skip = 0; e.__rs = 0;
    };
    if (!g.__noAmort) {
      const CBp = g.Game_CharacterBase.prototype, CHp = g.Game_Character.prototype;
      for (const [proto, names] of [[CBp, ["moveStraight", "moveDiagonally", "jump"]], [CHp, ["forceMoveRoute"]], [GE, ["setupPage", "lock", "start", "erase"]]]) {
        for (const n of names) {
          const f = Object.prototype.hasOwnProperty.call(proto, n) ? proto[n] : null;
          if (typeof f === "function") proto[n] = function () { if (this.__rs || this.__skip) wake(this); return f.apply(this, arguments); };
        }
      }
      const rs = CBp.resetStopCount;
      if (typeof rs === "function") CBp.resetStopCount = function () { this.__sc = 0; return rs.apply(this, arguments); };
    }
    if (GE.__restFast && String(ue).indexOf("forEach") >= 0 && String(ue).length < 250) GM.updateEvents = function () {
      const evs = this.events(), amort = !g.__noAmort;
      for (let i = 0; i < evs.length; i++) {
        const e = evs[i];
        if (e.__skip > 0) { e.__skip--; e.__sd++; e.__sc++; continue; }
        if (e._realX === e._x && e._realY === e._y && e._jumpCount <= 0 && !e._stepAnime &&
            e._animationCount === 0 && e._pattern === e._originalPattern && !e._moveRouteForcing &&
            e._moveType === 0 && e._trigger !== 3 && !e._locked && !e._chasePlayer && !e._fleePlayer &&
            !(e._chaseRange > 0) && !(e._fleeRange > 0) && !e._returnPhase && !e._alertPlayer) {
          const sd = e.__sd | 0;
          e._stopCount += 1 + (e.__sc | 0);
          if (!e._erased) e._alertLock -= 1 + sd;
          e.__sd = e.__sc = 0;
          if (e._interpreter) {
            if (!(e.__sleep && e.__sleepUntil > g.__upd && e.__sleepAct === g.__actVer && (!e.__sleepImg || e.__sleepImg === g.__imgVer))) e.updateParallel();
          } else if (amort && (e.__rs = (e.__rs | 0) + 1) >= SETTLED) e.__skip = e.__rs === SETTLED ? (e._eventId & 3) : SKIP;   // first time: staggered by id so checks spread over the updates
        } else { if (e.__rs || e.__sd) wake(e); e.update(); }
      }
      const ce = this._commonEvents;
      const up = g.__upd, av = g.__actVer;
      for (let i = 0; i < ce.length; i++) { const c = ce[i]; if (!(c.__sleep && c.__sleepUntil > up && c.__sleepAct === av && (!c.__sleepImg || c.__sleepImg === g.__imgVer))) c.update(); }
    };
  }

  // 11. Window._refreshBack / _refreshFrame redraw a window's background and border from the windowskin with
  //     dozens of blits (and a tone adjust), several times per window, for ~10 windows each time Scene_Map is
  //     built (about 60 of ~300 ms PC per map transfer). The result only depends on the skin, the window size and
  //     the tone, and nothing draws on those bitmaps afterwards, so identical ones are shared. Capped per skin
  //     (animated windows resize through many sizes).
  {
    const W = g.Window.prototype, back = W._refreshBack, frame = W._refreshFrame;
    if (String(back).indexOf("adjustTone") >= 0 && String(frame).indexOf("new Bitmap") >= 0) {
      const cacheFor = (skin, kind) => { const k = "__" + kind; let c = skin[k]; if (!c) c = skin[k] = new Map(); if (c.size > 48) c.clear(); return c; };
      W._refreshBack = function () {
        const skin = this._windowskin, m = this._margin, w = this._width - m * 2, h = this._height - m * 2;
        if (!skin || !skin.isReady || !skin.isReady() || !(w > 0 && h > 0)) return back.apply(this, arguments);
        const t = this._colorTone, key = w + "x" + h + "|" + t[0] + "," + t[1] + "," + t[2], c = cacheFor(skin, "backs"), hit = c.get(key);
        if (!hit) { back.apply(this, arguments); c.set(key, this._windowBackSprite.bitmap); return; }
        const sp = this._windowBackSprite;
        sp.bitmap = hit; sp.setFrame(0, 0, w, h); sp.move(m, m);
      };
      W._refreshFrame = function () {
        const skin = this._windowskin, w = this._width, h = this._height;
        if (!skin || !skin.isReady || !skin.isReady()) return frame.apply(this, arguments);
        const key = w + "x" + h, c = cacheFor(skin, "frames"), hit = c.get(key);
        if (!hit) { frame.apply(this, arguments); c.set(key, this._windowFrameSprite.bitmap); return; }
        const sp = this._windowFrameSprite;
        sp.bitmap = hit; sp.setFrame(0, 0, w, h);
      };
      const cursor = W._refreshCursor;
      if (String(cursor).indexOf("_windowCursorSprite") >= 0) W._refreshCursor = function () {
        // the cursor bitmap depends on its clipped size and the clipping offsets, not on where it is (the sprite moves)
        const skin = this._windowskin, pad = this._padding, r = this._cursorRect;
        if (!skin || !skin.isReady || !skin.isReady()) return cursor.apply(this, arguments);
        const x = r.x + pad - this.origin.x, y = r.y + pad - this.origin.y, w = r.width, h = r.height;
        const x2 = Math.max(x, pad), y2 = Math.max(y, pad), ox = x - x2, oy = y - y2;
        const w2 = Math.min(w, this._width - pad - x2), h2 = Math.min(h, this._height - pad - y2);
        if (!(w > 0 && h > 0 && w2 > 0 && h2 > 0)) return cursor.apply(this, arguments);
        const key = w2 + "x" + h2 + "|" + ox + "," + oy + "|" + w + "x" + h, c = cacheFor(skin, "cursors"), hit = c.get(key);
        if (!hit) { cursor.apply(this, arguments); c.set(key, this._windowCursorSprite.bitmap); return; }
        const sp = this._windowCursorSprite;
        sp.bitmap = hit; sp.setFrame(0, 0, w2, h2); sp.move(x2, y2);
      };
    } else nx.log("port patch: window background cache not installed (source differs)");
  }

  // 12. Closing a menu or ending a battle rebuilds the whole map scene: the map JSON is parsed again (~25 ms on a PC) and a new
  //     Spriteset_Map creates ~420 character sprites, tilemap, lightmask and pictures (~45 ms), ~0.5 s on the
  //     Switch. When the map scene went to a menu scene (not a battle, not a transfer) and the same map comes back
  //     with the same event list, the parsed map data and the spriteset are kept and put back. The sprites follow
  //     their characters every frame anyway, so the result matches a rebuilt one.
  {
    const SMp = g.Scene_Map.prototype, DM = g.DataManager, term = SMp.terminate, create = SMp.createSpriteset, load = DM.loadMapData;
    if (String(create).indexOf("new Spriteset_Map") >= 0 && String(load).indexOf("loadDataFile") >= 0) {
      let kept = null;
      SMp.terminate = function () {
        const r = term.apply(this, arguments);
        const next = g.SceneManager._nextScene;
        kept = null;
        const battle = next && next instanceof g.Scene_Battle;       // characters were hidden for the encounter effect: shown again on reuse
        if (next && (next instanceof g.Scene_MenuBase || battle) && this._spriteset && g.$gameMap && g.$dataMap && !g.$gamePlayer.isTransferring()) {
          kept = { sp: this._spriteset, id: g.$gameMap.mapId(), dm: g.$dataMap, ev: g.$gameMap._events, n: g.$gameMap._events.length, tile: g.$gameMap._tilesetId, battle: battle };
        }
        return r;
      };
      DM.loadMapData = function (mapId) {
        if (kept && kept.id === mapId && mapId > 0 && !g.$gamePlayer.isTransferring()) { g.$dataMap = kept.dm; return; }
        return load.apply(this, arguments);
      };
      SMp.createSpriteset = function () {
        const k = kept; kept = null;
        const gm = g.$gameMap;
        if (k && !this._transfer && gm && k.id === gm.mapId() && k.dm === g.$dataMap && k.ev === gm._events && k.n === gm._events.length && k.tile === gm._tilesetId) {
          this._spriteset = k.sp;
          if (k.battle) for (const sp of k.sp._characterSprites) if (!sp.isTile()) sp.show();   // undo hideCharacters()
          this.addChild(this._spriteset);
          return;
        }
        return create.apply(this, arguments);
      };
    } else nx.log("port patch: map scene reuse not installed (source differs)");
  }

  // 13. Troops.json is 12.5 MB (221 troops of battle-event commands) and was JSON.parse'd at boot: ~0.6 s on a PC,
  //     ~3 s on the Switch, plus ~60 MB of live objects. $dataTroops is only read by troop id when a battle starts,
  //     so it is now an array-shaped proxy over the raw file: an element is parsed the first time it is read.
  if (nx.jsonLazyOpen) {
    const DM = g.DataManager, load = DM.loadDataFile;
    if (String(load).indexOf("XMLHttpRequest") >= 0) DM.loadDataFile = function (name, src) {
      if (name !== "$dataTroops") return load.apply(this, arguments);
      const h = nx.jsonLazyOpen(nx.root + "/data/" + src);
      if (h < 0) return load.apply(this, arguments);                       // missing/odd file: the normal path reports it
      const n = nx.jsonLazyCount(h), cache = new Array(n);
      const idx = (k) => { if (typeof k !== "string") return -1; const c = k.charCodeAt(0); if (c < 48 || c > 57) return -1; const i = +k; return i >= 0 && i < n && String(i) === k ? i : -1; };
      g[name] = new Proxy(new Array(n), {
        get(t, k, r) { const i = idx(k); if (i < 0) return Reflect.get(t, k, r); let v = cache[i]; if (v === undefined) v = cache[i] = nx.jsonLazyGet(h, i); return v; },
        has(t, k) { const i = idx(k); return i >= 0 ? true : Reflect.has(t, k); },
        getOwnPropertyDescriptor(t, k) { const i = idx(k); if (i >= 0) return { value: this.get(t, k), writable: true, enumerable: true, configurable: true }; return Reflect.getOwnPropertyDescriptor(t, k); },
        set(t, k, v, r) { const i = idx(k); if (i >= 0) { cache[i] = v; return true; } return Reflect.set(t, k, v, r); },
      });
    };
  }

  // 15. A "middle" message on the map is centred on the screen, which is where the camera keeps the player: the box
  //     hides them. When it would cover the player, park it at the top or bottom, whichever is farther from them.
  if (g.Window_Message && g.Game_Player) {
    const WM = g.Window_Message.prototype, place = WM.updatePlacement;
    WM.updatePlacement = function () {
      place.apply(this, arguments);
      const sc = g.SceneManager._scene;
      if (this._positionType !== 1 || !sc || !g.Scene_Map || !(sc instanceof g.Scene_Map) || !g.$gamePlayer) return;
      const feet = g.$gamePlayer.screenY(), head = feet - 48;
      if (feet < this.y || head > this.y + this.height) return;
      this.y = feet > g.Graphics.boxHeight / 2 ? 0 : g.Graphics.boxHeight - this.height;
      this._goldWindow.y = this.y > 0 ? 0 : g.Graphics.boxHeight - this._goldWindow.height;
    };
  }

  // 14. YEP_GabWindow draws map "gab" lines at a fixed Y (560) which sits inside the message window's area, so a
  //     dialog box and a gab cover each other. While a message is on screen the gab bar moves up above the box.
  if (g.Window_Gab) {
    const WG = g.Window_Gab.prototype, upd = WG.update;
    WG.update = function () {
      const sc = g.SceneManager._scene, mw = sc && sc._messageWindow;
      if (mw && mw.openness > 0 && !this._battle) {
        if (this.__baseY === undefined) this.__baseY = this.y;
        const y = mw.y - this.height + this.standardPadding() - 4;     // the bar's content ends just above the box
        if (this.y !== y) this.y = y;
      } else if (this.__baseY !== undefined) { this.y = this.__baseY; this.__baseY = undefined; }
      return upd.apply(this, arguments);
    };
  }

  // 5. Catch-up cap. When a logic update costs more than 1/60 s MV runs more updates per frame to catch up
  //    (up to 15), which makes the frame even slower: a death spiral that took one map to ~1 fps. At most 2
  //    updates per frame now; a machine that cannot keep up runs the game slower instead of freezing.
  {
    const SM = g.SceneManager, main = SM.updateMain, scene = SM.updateScene, MAX = 2;
    SM.updateMain = function () { this.__n = 0; return main.apply(this, arguments); };
    SM.updateScene = function () {
      if (++this.__n >= MAX) this._accumulator = this._deltaTime;       // the loop subtracts one step: no debt carried over
      return scene.apply(this, arguments);
    };
  }

  // Load shedding for TerraxLighting. The plugin repaints a screen-sized mask every logic update, the single
  // biggest per-frame cost in lit maps. When ticks run over budget it repaints every 2nd (or 3rd) update:
  // the previous mask stays on screen (and is not re-uploaded), and lights lag by at most a frame or two.
  // On a machine that keeps up it never skips. Lightmask is private to the plugin's closure, so it is
  // reached through the instance Spriteset_Map.createLightmask makes.
  if (g.Spriteset_Map.prototype.createLightmask) {
    const budget = () => (typeof g.__perfBudgetMs === "number" ? g.__perfBudgetMs : 12);
    const create = g.Spriteset_Map.prototype.createLightmask;
    g.Spriteset_Map.prototype.createLightmask = function () {
      create.apply(this, arguments);
      const proto = this._lightmask && Object.getPrototypeOf(this._lightmask);
      // Reduced-resolution mask (1/4; 1/2 before; use powers of two - 1/3 misses the integer-edge fast paths and was 2x slower): lighting is soft gradients, so the mask bitmap is drawn at 1/k size (the 2D
      // context is scaled so the plugin's own coordinates stay valid) and its sprite is scaled back up by k.
      // Every pixel operation and the per-frame texture upload get k*k cheaper. g.__lightScale = 1 disables.
      const k = typeof g.__lightScale === "number" ? g.__lightScale : 4, bmp = this._lightmask && this._lightmask._maskBitmap;
      if (k > 1 && bmp && !bmp.__scaled) {
        bmp.resize(Math.ceil(bmp.width / k), Math.ceil(bmp.height / k));
        bmp._context.scale(1 / k, 1 / k);
        bmp.__scaled = k;
        nx.log("port patch: lighting mask at 1/" + k + " resolution (" + bmp.width + "x" + bmp.height + ")");
      }
      if (!proto || proto.__shed) return;
      proto.__shed = true;
      const addSprite = proto._addSprite;
      proto._addSprite = function (x, y, b) {
        addSprite.apply(this, arguments);
        if (b && b.__scaled) { const sp = this._sprites[this._sprites.length - 1]; if (sp) sp.scale.x = sp.scale.y = b.__scaled; }
      };
      const update = proto.update;
      // The repaint loops over all ~150 event notes twice per update (split + lowercase each) to find the few
      // light sources. Once the plugin has seen the map (its map-change block reads every event), they run
      // over a same-length array holding only the light events, so the other slots cost a null test.
      const LIGHT = { light: 1, fire: 1, flashlight: 1, daynight: 1 };
      const lit = (self, upd) => {
        const dm = g.$dataMap;
        if (!dm || !dm.events || self.__fm !== dm) { upd.call(self); if (dm && dm.events) self.__fm = dm; return; }
        let le = dm.__lightEvents;
        if (!le) {
          le = dm.__lightEvents = new Array(dm.events.length).fill(null);
          for (let i = 0; i < le.length; i++) { const e = dm.events[i]; if (e && LIGHT[String(e.note || "").split(" ")[0].toLowerCase()] === 1) le[i] = e; }
        }
        const full = dm.events; dm.events = le;
        try { upd.call(self); } finally { dm.events = full; }
      };
      proto.update = function () {
        const over = g.__frameMs / budget();
        const every = over > 2 ? 3 : over > 1 ? 2 : 1;
        this.__skip = ((this.__skip || 0) + 1) % every;
        if (this.__skip === 0 || !this.__drawn) { this.__drawn = true; lit(this, update); }
      };
      nx.log("port patch: TerraxLighting load shedding installed");
    };
  }
  step("plugins loaded");
  g.window.onload();                                  // SceneManager.run(Scene_Boot)
  step("SceneManager.run");
  // the native mods menu took over the screen and changed GL state behind PIXI's back: resync its caches
  g.__menuClosed = function () { try { g.__applyControls(); g.Graphics._renderer.reset(); } catch (e) { nx.log("menuClosed: " + e); } };
  try { __loadScript("js/dev_extra.js"); nx.log("dev_extra.js loaded"); } catch (e) { /* optional device-side probe script */ }

  // scene graph dump for debugging what is on screen (depth-limited)
  g.__dump = function (node, depth, indent) {
    if (!node || depth < 0) return;
    const tex = node.texture && node.texture.baseTexture ? " tex=" + node.texture.width + "x" + node.texture.height : "";
    const win = node.openness !== undefined ? " open=" + node.openness + " w=" + node.width + " h=" + node.height : "";
    nx.log(indent + (node.constructor && node.constructor.name || "?") + " pos=" + (node.x | 0) + "," + (node.y | 0) +
      " scale=" + (node.scale ? node.scale.x.toFixed(2) + "," + node.scale.y.toFixed(2) : "-") +
      " vis=" + node.visible + " a=" + node.alpha + tex + win + " kids=" + (node.children ? node.children.length : 0));
    if (node.children) for (const c of node.children.slice(0, 12)) g.__dump(c, depth - 1, indent + "  ");
  };
  g.__dumpScene = function () {
    nx.log("Graphics " + Graphics._width + "x" + Graphics._height + " canvas " + (Graphics._canvas && Graphics._canvas.width) + "x" + (Graphics._canvas && Graphics._canvas.height) +
      " box " + Graphics.boxWidth + "x" + Graphics.boxHeight + " renderer " + (Graphics._renderer && Graphics._renderer.width) + "x" + (Graphics._renderer && Graphics._renderer.height));
    nx.log("audio sources active: " + (g.__audioStats ? g.__audioStats() : "n/a") + "  BGM=" + (AudioManager._currentBgm ? AudioManager._currentBgm.name : "-"));
    g.__dump(SceneManager._scene, 3, "");
  };

  // Performance reporter: every 5 s, the average tick cost and logic updates per tick since the last report, with
  // the current map. Cost per logic update = avg tick / updates per tick. This is what the device runs are read from.
  {
    let ticks = 0, tickMs = 0, updates = 0, last = nx.now(), worst = 0;
    const tick = g.__tick, scene = g.SceneManager.updateScene;
    g.SceneManager.updateScene = function () { updates++; return scene.apply(this, arguments); };
    g.__tick = function (t) { const a = nx.now(); tick(t); const d = nx.now() - a; ticks++; tickMs += d; if (d > worst) worst = d; };
    g.setInterval(() => {
      if (!ticks) return;
      const map = g.$gameMap && g.SceneManager._scene && g.SceneManager._scene.constructor.name === "Scene_Map" ? " map " + g.$gameMap.mapId() : "";
      nx.log("[perf]" + map + " " + ticks + " ticks, avg " + (tickMs / ticks).toFixed(1) + " ms, worst " + worst.toFixed(0) + " ms, " + (updates / ticks).toFixed(2) + " updates/tick => " + (tickMs / Math.max(1, updates)).toFixed(1) + " ms per update");
      ticks = 0; tickMs = 0; updates = 0; worst = 0;
    }, 5000);
  }

  // progress report once a second: which scene, and how long since boot
  let last = "";
  g.setInterval(() => {
    const sc = g.SceneManager && g.SceneManager._scene;
    const name = sc ? sc.constructor.name : "(none)";
    if (name !== last) { step("scene -> " + name); last = name; if (name === "Scene_Title") g.setTimeout(g.__dumpScene, 3000); }
  }, 250);
})(globalThis);
