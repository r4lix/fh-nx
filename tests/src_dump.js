(function (g) {
  const nx = g.__nx; let done = false; const orig = g.__tick;
  g.__tick = function (t) { orig(t); if (!done && g.SceneManager._scene && g.SceneManager._scene.constructor.name === "Scene_Title") { done = true;
    for (const n of ["setup", "clear", "checkOverflow", "update", "updateWait", "updateChild", "currentCommand", "skipBranch", "command111", "command122", "command121", "command411", "command412"])
      nx.log("[src] GI." + n + " (" + String(Game_Interpreter.prototype[n]).length + " chars): " + String(Game_Interpreter.prototype[n]).replace(/\s+/g, " ").slice(0, 700)); } };
})(globalThis);
