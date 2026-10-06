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

  __loadScript("js/main.js");                         // PluginManager.setup($plugins); window.onload = ...
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
