globalThis.__maps = [93, 53]; globalThis.__nx.loadScript("tests/bench_maps.js");
(function (g) { const GE = Game_Event.prototype, u = GE.update;
  if (g.__skipExp) GE.update = function () { if (!this._interpreter && this._moveType === 0 && this._realX === this._x && this._realY === this._y && !this._stepAnime && this._trigger !== 3 && !this._moveRouteForcing && this._animationCount === 0) return; return u.apply(this, arguments); }; })(globalThis);
