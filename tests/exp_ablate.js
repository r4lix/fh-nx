// Ablation: disable one subsystem and measure tick cost on map g.__pmap. Variant via globalThis.__abl.
globalThis.__maps = [globalThis.__pmap || 93, globalThis.__pmap || 93]; globalThis.__nx.loadScript("tests/bench_maps.js");
(function (g) {
  const v = g.__abl, noop = function () {};
  if (v === "events") g.Game_Map.prototype.updateEvents = noop;
  if (v === "sprites") g.Spriteset_Map.prototype.update = noop;
  if (v === "render") g.SceneManager.renderScene = noop;
  if (v === "mapupdate") g.Game_Map.prototype.update = noop;
  if (v === "ce") g.Game_CommonEvent.prototype.update = noop;
  if (v === "evupdate") g.Game_Event.prototype.update = noop;
  if (v === "parallel") g.Game_Event.prototype.updateParallel = noop;
  if (v === "evnoparallel") { const u = g.Game_Event.prototype.update; g.Game_Event.prototype.updateParallel = noop; }
  if (v === "tilemap") { g.ShaderTilemap.prototype.update = noop; }
  if (v === "light") { const c = g.Spriteset_Map.prototype.createLightmask; g.Spriteset_Map.prototype.createLightmask = function () { c.apply(this, arguments); const p = this._lightmask && Object.getPrototypeOf(this._lightmask); if (p) p.update = noop; }; }
})(globalThis);
