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

  __loadScript("js/main.js");                         // PluginManager.setup($plugins); window.onload = ...

  // ---- Engine port patches for a bytecode interpreter (QuickJS is ~10-30x slower than the browser JIT this
  // game was built for, and one big map costs ~20 ms per logic update). Each keeps behaviour identical. ----

  // 1. Every switch/variable/self-switch write requests a full map refresh (every event re-evaluates its page
  //    conditions, ~2-4 ms per update on a big map), and F&H's parallel events write counters every frame. An
  //    event page only depends on: two switches, one variable threshold, a self switch, an item and an actor
  //    (Game_Event.meetsConditions; no plugin here changes that), and a common event only on its trigger switch.
  //    So a refresh is requested only when the value really changed AND some page on this map (or common event)
  //    references that switch/variable. Self switches keep the unchanged-value guard. The dependency sets are
  //    built per map from $dataMap and rebuilt on Game_Map.setup.
  g.__stateVer = 1; g.__actVer = 1;
  {
    const GM = g.Game_Map.prototype, setup = GM.setup;
    GM.setup = function () { this.__deps = null; g.__stateVer++; g.__actVer++; return setup.apply(this, arguments); };
    const deps = () => {
      const gm = g.$gameMap;
      if (gm.__deps) return gm.__deps;
      const d = { sw: Object.create(null), va: Object.create(null), ok: false };
      if (g.$dataMap && g.$dataMap.events) {
        for (const ev of g.$dataMap.events) {
          if (!ev) continue;
          for (const pg of ev.pages) {
            const c = pg.conditions;
            if (c.switch1Valid) d.sw[c.switch1Id] = true;
            if (c.switch2Valid) d.sw[c.switch2Id] = true;
            if (c.variableValid) d.va[c.variableId] = true;
          }
        }
        for (const ce of g.$dataCommonEvents) if (ce) d.sw[ce.switchId] = true;       // trigger switch (cheap superset)
        d.ok = true;
      }
      return (gm.__deps = d);
    };
    for (const [cls, kind] of [[g.Game_Variables, "va"], [g.Game_Switches, "sw"], [g.Game_SelfSwitches, null]]) {
      const proto = cls.prototype, setValue = proto.setValue, onChange = proto.onChange;
      proto.setValue = function (id) {
        this.__id = id; this.__before = kind === "va" ? this._data[id] : !!this._data[id];
        try { return setValue.apply(this, arguments); } finally { this.__id = undefined; }
      };
      proto.onChange = function () {
        const id = this.__id;
        if (id !== undefined) {
          const now = kind === "va" ? this._data[id] : !!this._data[id];
          if (now === this.__before) return;                                       // same value: nothing to re-evaluate
          g.__stateVer++;                                                          // idle-parallel cache key (see 7)
          if (g.__curIt) g.__curIt.__wl.push(this, id, this.__before);             // a tracked run really changed state
          if (kind && g.$gameMap) { const d = deps(); if (d.ok && !d[kind][id]) return; }   // nobody on this map reads it
        }
        return onChange.apply(this, arguments);
      };
    }
  }

  // 2. Game_Map.isAnyEventStarting scans every event, and is asked ~10 times per update. The answer is cached
  //    for the duration of one update and invalidated whenever an event starts or clears its flag.
  {
    const GM = g.Game_Map.prototype, any = GM.isAnyEventStarting, update = GM.update;
    GM.isAnyEventStarting = function () { return this.__starting !== undefined ? this.__starting : (this.__starting = any.apply(this, arguments)); };
    GM.update = function () { this.__starting = undefined; return update.apply(this, arguments); };
    const GE = g.Game_Event.prototype, start = GE.start, clear = GE.clearStartingFlag;
    GE.start = function () { const r = start.apply(this, arguments); if (g.$gameMap) g.$gameMap.__starting = undefined; return r; };
    GE.clearStartingFlag = function () { const r = clear.apply(this, arguments); if (g.$gameMap) g.$gameMap.__starting = undefined; return r; };
  }

  // 3. Sprite_Character.update only has an effect when something it mirrors has changed. A sprite is skipped when
  //    (a) it is far off screen (re-checked every 4th frame; the margin is wider than anything can travel in 4
  //    frames), or (b) its character's state, the camera and animation/balloon activity are all exactly as at
  //    the last full update. (b) is a dozen plain property reads against ~25 interpreted calls.
  {
    const SC = g.Sprite_Character.prototype, update = SC.update;
    SC.update = function () {
      if (this.__off && (Graphics.frameCount & 3) !== 0) return;
      const c = this._character, gm = g.$gameMap;
      if (c && !this._animationSprites.length && !this._balloonSprite && !c._animationId && !c._balloonId &&
          this.__dx === gm._displayX && this.__dy === gm._displayY && this.__rx === c._realX && this.__ry === c._realY &&
          this.__dir === c._direction && this.__pat === c._pattern && this.__op === c._opacity && this.__bt === c._blendType &&
          this.__cn === c._characterName && this.__ci === c._characterIndex && this.__tid === c._tileId &&
          this.__jc === c._jumpCount && this.__sid === gm._tilesetId) return;
      update.apply(this, arguments);
      if (c) {
        this.__dx = gm._displayX; this.__dy = gm._displayY; this.__rx = c._realX; this.__ry = c._realY;
        this.__dir = c._direction; this.__pat = c._pattern; this.__op = c._opacity; this.__bt = c._blendType;
        this.__cn = c._characterName; this.__ci = c._characterIndex; this.__tid = c._tileId; this.__jc = c._jumpCount; this.__sid = gm._tilesetId;
      }
      this.__off = this.x < -128 || this.x > Graphics.width + 128 || this.y < -192 || this.y > Graphics.height + 128;
    };
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
            if (PURE[code] === 1 || (code === 111 && (t <= 2 || t === 4 || (t >= 7 && t <= 10))) || (code === 122 && p[3] <= 1) || code === 117) {
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
  //  plugin path that changes such state without going through them.
  {
    const bump = (proto, names) => { for (const n of names) { const f = proto[n]; if (typeof f === "function") proto[n] = function () { g.__actVer++; return f.apply(this, arguments); }; } };
    bump(g.Game_BattlerBase.prototype, ["refresh", "clearStates", "addNewState", "eraseState"]);
    bump(g.Game_Actor.prototype, ["setName", "changeClass", "learnSkill", "forgetSkill", "changeEquip", "forceChangeEquip", "discardEquip", "initEquips", "clearEquipments", "optimizeEquipments", "setup", "releaseUnequippableItems"]);
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
    const tracked = (it, list, setupFn) => {
      if (!it.isRunning()) {
        if (!list) return setupFn();                                  // nothing to run: stock behaviour
        if (it.__idleList === list && it.__idleAct === g.__actVer && nx.now() - it.__idleF < 1000 && same(it.__idleRec)) return;
        g.__rec = it.__r0 = [];
        g.__curIt = it;
        setupFn();
        it.__pure = true; it.__wl = []; it.__waited = false; it.__a0 = g.__actVer; it.__l0 = list; it.__root = null;
      } else if (it.__pure) { g.__rec = it.__r0; g.__curIt = it; }
      it.update();
      g.__rec = null; g.__curIt = null;
      if (it.__l0 && !it.isRunning()) {
        if (it.__pure && g.__actVer === it.__a0 && (it.__wl.length === 0 || (!it.__waited && netNoop(it.__wl)))) {
          it.__idleList = it.__l0; it.__idleAct = it.__a0; it.__idleF = nx.now(); it.__idleRec = it.__r0;
        } else it.__idleList = null;
        it.__l0 = null;
      }
    };
    const GE = g.Game_Event.prototype, upd = GE.updateParallel;
    if (String(upd).length < 300) GE.updateParallel = function () {
      const it = this._interpreter;
      if (!it) return;
      tracked(it, this.list(), () => it.setup(this.list(), this._eventId));
    };
    const GC = g.Game_CommonEvent.prototype, cupd = GC.update;
    if (String(cupd).length < 300) GC.update = function () {
      const it = this._interpreter;
      if (!it) return;
      tracked(it, this.list(), () => it.setup(this.list()));
    };
  }

  // 8. Tilemap._sortChildren sorts ~150 sprites every update (~950 interpreted comparator calls) though the
  //    order barely changes between updates. A stable insertion sort with the comparison inlined is ~n steps on
  //    nearly sorted input and gives the identical order. Only when the comparator is the (a.z||0)/(a.y||0)/
  //    spriteId one this game ships; anything else keeps the stock sort.
  {
    const TM = g.Tilemap.prototype;
    if (String(TM._compareChildOrder).indexOf("(a.z || 0) !== (b.z || 0)") >= 0 && String(TM._sortChildren).length < 200) {
      TM._sortChildren = function () {
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
      // Half-resolution mask: lighting is soft gradients, so the mask bitmap is drawn at 1/k size (the 2D
      // context is scaled so the plugin's own coordinates stay valid) and its sprite is scaled back up by k.
      // Every pixel operation and the per-frame texture upload get k*k cheaper. g.__lightScale = 1 disables.
      const k = typeof g.__lightScale === "number" ? g.__lightScale : 2, bmp = this._lightmask && this._lightmask._maskBitmap;
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
