// Skeleton demo: the real PIXI 4.5.4 + pixi-tilemap render a tilemap-sized scene through the native
// WebGL binding. Textures are generated procedurally (no image decoding yet), so the screen shows
// coloured tiles scrolling under moving sprites.
(function (g) {
  const nx = g.__nx;
  __loadScript("js/libs/pixi.js");
  __loadScript("js/libs/pixi-tilemap.js");
  __loadScript("js/libs/pixi-picture.js");
  const PIXI = g.PIXI;
  nx.log("PIXI " + PIXI.VERSION);

  const W = nx.width, H = nx.height;

  function checker(w, h, tile, hue) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const px = new Uint8Array(c._data);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const tx = (x / tile) | 0, ty = (y / tile) | 0;
        const edge = x % tile < 2 || y % tile < 2;
        const k = (tx * 7 + ty * 13 + hue) % 6;
        px[i] = edge ? 20 : 60 + k * 30;
        px[i + 1] = edge ? 20 : 200 - k * 25 + ((tx + ty) & 1) * 20;
        px[i + 2] = edge ? 20 : 90 + ((tx * 31 + ty * 17 + hue * 40) % 120);
        px[i + 3] = 255;
      }
    return c;
  }

  const renderer = new PIXI.WebGLRenderer(W, H, { view: document.createElement("canvas"), transparent: false, antialias: false });
  const stage = new PIXI.Container();

  const atlas = PIXI.Texture.fromCanvas(checker(768, 768, 48, 0));
  const tilemap = new PIXI.tilemap.CompositeRectTileLayer(0, [], true);
  tilemap.setBitmaps([atlas]);
  let tiles = 0;
  for (let layer = 0; layer < 2; layer++)
    for (let y = 0; y < Math.ceil(H / 48) + 2; y++)
      for (let x = 0; x < Math.ceil(W / 48) + 2; x++) {
        if (layer > 0 && (x + y) % 3) continue;
        tilemap.addRect(0, ((x * 5 + y * 3) % 16) * 48, ((x + y * 7) % 16) * 48, x * 48, y * 48, 48, 48);
        tiles++;
      }
  stage.addChild(tilemap);

  const charTex = new PIXI.Texture(PIXI.Texture.fromCanvas(checker(576, 384, 48, 3)).baseTexture, new PIXI.Rectangle(0, 0, 48, 48));
  const sprites = [];
  for (let i = 0; i < 60; i++) {
    const s = new PIXI.Sprite(charTex);
    s.x = (i * 37) % W; s.y = (i * 53) % H;
    stage.addChild(s);
    sprites.push(s);
  }
  nx.log("scene: " + tiles + " tiles, " + sprites.length + " sprites");

  // Canvas 2D -> texture: a menu-style panel and a live FPS label, as MV's Bitmap/Window would do
  __registerCss("fonts/gamefont.css");
  function outlined(ctx, text, x, y, size, fill) {
    ctx.font = size + "px GameFont, sans-serif";
    ctx.lineWidth = 4; ctx.lineJoin = "round"; ctx.strokeStyle = "#000000";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill; ctx.fillText(text, x, y);
  }
  const panel = document.createElement("canvas");
  panel.width = 520; panel.height = 200;
  const pc = panel.getContext("2d");
  const grad = pc.createLinearGradient(0, 0, 0, 200);
  grad.addColorStop(0, "rgba(20,20,60,0.92)"); grad.addColorStop(1, "rgba(60,20,40,0.92)");
  pc.fillStyle = grad; pc.fillRect(0, 0, 520, 200);
  pc.strokeStyle = "#d8c8a0"; pc.lineWidth = 3; pc.strokeRect(2, 2, 516, 196);
  outlined(pc, "Fear & Hunger  NX", 20, 50, 40, "#ffffff");
  outlined(pc, "Canvas 2D on the Switch Lite", 20, 95, 26, "#9fe8ff");
  outlined(pc, "Attack   Skill   Item   Run", 20, 140, 26, "#ffe08a");
  pc.save(); pc.beginPath(); pc.arc(450, 140, 40, 0, Math.PI * 2); pc.clip();
  const light = pc.createRadialGradient(450, 140, 2, 450, 140, 40);
  light.addColorStop(0, "#ffffff"); light.addColorStop(1, "rgba(255,190,60,0)");
  pc.fillStyle = light; pc.fillRect(400, 90, 100, 100); pc.restore();
  const panelSprite = new PIXI.Sprite(PIXI.Texture.fromCanvas(panel));
  panelSprite.x = 40; panelSprite.y = 40;
  stage.addChild(panelSprite);

  const fpsCanvas = document.createElement("canvas");
  fpsCanvas.width = 200; fpsCanvas.height = 40;
  const fpsTex = PIXI.Texture.fromCanvas(fpsCanvas);
  const fpsSprite = new PIXI.Sprite(fpsTex);
  fpsSprite.x = W - 220; fpsSprite.y = 30;
  stage.addChild(fpsSprite);
  function setFps(text) {
    const c = fpsCanvas.getContext("2d");
    c.clearRect(0, 0, 200, 40);
    outlined(c, text, 8, 30, 26, "#ffffff");
    fpsTex.baseTexture.update();
  }
  setFps("starting");

  let frames = 0, last = nx.now();
  function loop(now) {
    for (const s of sprites) { s.x += 2; if (s.x > W) s.x = -48; }
    tilemap.position.x = -(frames % 48);
    renderer.render(stage);
    frames++;
    if (now - last >= 2000) {
      const fps = (frames * 1000 / (now - last)).toFixed(1);
      nx.log("fps " + fps);
      setFps(fps + " fps");
      frames = 0; last = now;
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})(globalThis);
