(function (g) { const o = g.__tick; let d = false;
  g.__tick = function (t) { o(t); const sc = SceneManager._scene && SceneManager._scene.constructor.name; if (d || sc !== "Scene_Title" || !SceneManager._scene._backSprite1) return; d = true;
    const sp = SceneManager._scene._backSprite1; __nx.log("[wide] Graphics " + Graphics.width + "x" + Graphics.height + " box " + Graphics.boxWidth + "x" + Graphics.boxHeight + " title back " + (sp.bitmap ? sp.bitmap.width + "x" + sp.bitmap.height : "?") + " renderer " + (Graphics._renderer ? Graphics._renderer.width + "x" + Graphics._renderer.height : "?")); };
})(globalThis);
