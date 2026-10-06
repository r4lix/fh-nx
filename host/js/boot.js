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
      proto.update = function () {
        const over = g.__frameMs / budget();
        const every = over > 2 ? 3 : over > 1 ? 2 : 1;
        this.__skip = ((this.__skip || 0) + 1) % every;
        if (this.__skip === 0 || !this.__drawn) { this.__drawn = true; update.call(this); }
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

  // progress report once a second: which scene, and how long since boot
  let last = "";
  g.setInterval(() => {
    const sc = g.SceneManager && g.SceneManager._scene;
    const name = sc ? sc.constructor.name : "(none)";
    if (name !== last) { step("scene -> " + name); last = name; if (name === "Scene_Title") g.setTimeout(g.__dumpScene, 3000); }
  }, 250);
})(globalThis);
