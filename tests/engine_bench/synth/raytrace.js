// RayTrace in the style of Octane's (Flog.RayTracer): prototype.js Class.create + initialize.apply(this, arguments),
var RT_SEEN;
// the same constructor pattern every RPG Maker MV class uses. 2 spheres + chessboard plane, 2 lights, shadows, reflection.
var Class = { create: function () { return function () { this.initialize.apply(this, arguments); }; } };
Object.extend = function (destination, source) { for (var property in source) destination[property] = source[property]; return destination; };
var Flog = { RayTracer: { Shape: {}, Material: {} } };

Flog.RayTracer.Color = Class.create();
Flog.RayTracer.Color.prototype = {
  red: 0.0, green: 0.0, blue: 0.0,
  initialize: function (r, g, b) { if (!r) r = 0.0; if (!g) g = 0.0; if (!b) b = 0.0; this.red = r; this.green = g; this.blue = b; },
  limit: function () {
    this.red = (this.red > 0.0) ? ((this.red > 1.0) ? 1.0 : this.red) : 0.0;
    this.green = (this.green > 0.0) ? ((this.green > 1.0) ? 1.0 : this.green) : 0.0;
    this.blue = (this.blue > 0.0) ? ((this.blue > 1.0) ? 1.0 : this.blue) : 0.0;
  },
  brightness: function () { var r = Math.floor(this.red * 255), g = Math.floor(this.green * 255), b = Math.floor(this.blue * 255); return (r * 77 + g * 150 + b * 29) >> 8; }
};
Flog.RayTracer.Color.add = function (c1, c2) { var r = new Flog.RayTracer.Color(0, 0, 0); r.red = c1.red + c2.red; r.green = c1.green + c2.green; r.blue = c1.blue + c2.blue; return r; };
Flog.RayTracer.Color.addScalar = function (c1, s) { var r = new Flog.RayTracer.Color(0, 0, 0); r.red = c1.red + s; r.green = c1.green + s; r.blue = c1.blue + s; r.limit(); return r; };
Flog.RayTracer.Color.multiply = function (c1, c2) { var r = new Flog.RayTracer.Color(0, 0, 0); r.red = c1.red * c2.red; r.green = c1.green * c2.green; r.blue = c1.blue * c2.blue; return r; };
Flog.RayTracer.Color.multiplyScalar = function (c1, f) { var r = new Flog.RayTracer.Color(0, 0, 0); r.red = c1.red * f; r.green = c1.green * f; r.blue = c1.blue * f; return r; };
Flog.RayTracer.Color.blend = function (c1, c2, w) { return Flog.RayTracer.Color.add(Flog.RayTracer.Color.multiplyScalar(c1, 1 - w), Flog.RayTracer.Color.multiplyScalar(c2, w)); };

Flog.RayTracer.Light = Class.create();
Flog.RayTracer.Light.prototype = { position: null, color: null, intensity: 10.0,
  initialize: function (pos, color, intensity) { this.position = pos; this.color = color; this.intensity = (intensity ? intensity : 10.0); } };

Flog.RayTracer.Vector = Class.create();
Flog.RayTracer.Vector.prototype = { x: 0.0, y: 0.0, z: 0.0,
  initialize: function (x, y, z) { this.x = (x ? x : 0); this.y = (y ? y : 0); this.z = (z ? z : 0); },
  normalize: function () { var m = this.magnitude(); return new Flog.RayTracer.Vector(this.x / m, this.y / m, this.z / m); },
  magnitude: function () { return Math.sqrt((this.x * this.x) + (this.y * this.y) + (this.z * this.z)); },
  cross: function (w) { return new Flog.RayTracer.Vector(-this.z * w.y + this.y * w.z, this.z * w.x - this.x * w.z, -this.y * w.x + this.x * w.y); },
  dot: function (w) { return this.x * w.x + this.y * w.y + this.z * w.z; }
};
Flog.RayTracer.Vector.add = function (v, w) { return new Flog.RayTracer.Vector(w.x + v.x, w.y + v.y, w.z + v.z); };
Flog.RayTracer.Vector.subtract = function (v, w) { return new Flog.RayTracer.Vector(v.x - w.x, v.y - w.y, v.z - w.z); };
Flog.RayTracer.Vector.multiplyScalar = function (v, w) { return new Flog.RayTracer.Vector(v.x * w, v.y * w, v.z * w); };

Flog.RayTracer.Ray = Class.create();
Flog.RayTracer.Ray.prototype = { position: null, direction: null, initialize: function (pos, dir) { this.position = pos; this.direction = dir; } };

Flog.RayTracer.Scene = Class.create();
Flog.RayTracer.Scene.prototype = { camera: null, shapes: [], lights: [], background: null,
  initialize: function () {
    this.camera = new Flog.RayTracer.Camera(new Flog.RayTracer.Vector(0, 0, -5), new Flog.RayTracer.Vector(0, 0, 1), new Flog.RayTracer.Vector(0, 1, 0));
    this.shapes = []; this.lights = [];
    this.background = new Flog.RayTracer.Background(new Flog.RayTracer.Color(0, 0, 0.5), 0.2);
  } };

Flog.RayTracer.Material.BaseMaterial = Class.create();
Flog.RayTracer.Material.BaseMaterial.prototype = { gloss: 2.0, transparency: 0.0, reflection: 0.0, refraction: 0.50, hasTexture: false,
  initialize: function () {},
  wrapUp: function (t) { t = t % 2.0; if (t < -1) t += 2.0; if (t >= 1) t -= 2.0; return t; } };

Flog.RayTracer.Material.Solid = Class.create();
Flog.RayTracer.Material.Solid.prototype = Object.extend(new Flog.RayTracer.Material.BaseMaterial(), {
  initialize: function (color, reflection, refraction, transparency, gloss) {
    this.color = color; this.reflection = reflection; this.transparency = transparency; this.gloss = gloss; this.hasTexture = false;
  },
  getColor: function (u, v) { return this.color; } });

Flog.RayTracer.Material.Chessboard = Class.create();
Flog.RayTracer.Material.Chessboard.prototype = Object.extend(new Flog.RayTracer.Material.BaseMaterial(), {
  colorEven: null, colorOdd: null, density: 0.5,
  initialize: function (colorEven, colorOdd, reflection, transparency, gloss, density) {
    this.colorEven = colorEven; this.colorOdd = colorOdd; this.reflection = reflection; this.transparency = transparency;
    this.gloss = gloss; this.density = density; this.hasTexture = true;
  },
  getColor: function (u, v) { var t = this.wrapUp(u * this.density) * this.wrapUp(v * this.density); return t < 0.0 ? this.colorEven : this.colorOdd; } });

Flog.RayTracer.Shape.Sphere = Class.create();
Flog.RayTracer.Shape.Sphere.prototype = {
  initialize: function (pos, radius, material) { this.radius = radius; this.position = pos; this.material = material; },
  intersect: function (ray) {
    var info = new Flog.RayTracer.IntersectionInfo();
    info.shape = this;
    var dst = Flog.RayTracer.Vector.subtract(ray.position, this.position);
    var B = dst.dot(ray.direction), C = dst.dot(dst) - (this.radius * this.radius), D = (B * B) - C;
    if (D > 0) {
      info.isHit = true;
      info.distance = (-B) - Math.sqrt(D);
      info.position = Flog.RayTracer.Vector.add(ray.position, Flog.RayTracer.Vector.multiplyScalar(ray.direction, info.distance));
      info.normal = Flog.RayTracer.Vector.subtract(info.position, this.position).normalize();
      info.color = this.material.getColor(0, 0);
    } else info.isHit = false;
    return info;
  } };

Flog.RayTracer.Shape.Plane = Class.create();
Flog.RayTracer.Shape.Plane.prototype = { d: 0.0,
  initialize: function (pos, d, material) { this.position = pos; this.d = d; this.material = material; },
  intersect: function (ray) {
    var info = new Flog.RayTracer.IntersectionInfo();
    var Vd = this.position.dot(ray.direction);
    if (Vd == 0) return info;
    var t = -(this.position.dot(ray.position) + this.d) / Vd;
    if (t <= 0) return info;
    info.shape = this; info.isHit = true;
    info.position = Flog.RayTracer.Vector.add(ray.position, Flog.RayTracer.Vector.multiplyScalar(ray.direction, t));
    info.normal = this.position; info.distance = t;
    if (this.material.hasTexture) {
      var vU = new Flog.RayTracer.Vector(this.position.y, this.position.z, -this.position.x);
      var vV = vU.cross(this.position);
      var u = info.position.dot(vU), v = info.position.dot(vV);
      info.color = this.material.getColor(u, v);
    } else info.color = this.material.getColor(0, 0);
    return info;
  } };

Flog.RayTracer.IntersectionInfo = Class.create();
Flog.RayTracer.IntersectionInfo.prototype = { isHit: false, hitCount: 0, shape: null, position: null, normal: null, color: null, distance: null,
  initialize: function () { this.color = new Flog.RayTracer.Color(0, 0, 0); } };

Flog.RayTracer.Camera = Class.create();
Flog.RayTracer.Camera.prototype = { position: null, lookAt: null, equator: null, up: null, screen: null,
  initialize: function (pos, lookAt, up) {
    this.position = pos; this.lookAt = lookAt; this.up = up;
    this.equator = lookAt.normalize().cross(this.up);
    this.screen = Flog.RayTracer.Vector.add(this.position, this.lookAt);
  },
  getRay: function (vx, vy) {
    var pos = Flog.RayTracer.Vector.subtract(this.screen, Flog.RayTracer.Vector.subtract(Flog.RayTracer.Vector.multiplyScalar(this.equator, vx), Flog.RayTracer.Vector.multiplyScalar(this.up, vy)));
    pos.y = pos.y * -1;
    var dir = Flog.RayTracer.Vector.subtract(pos, this.position);
    return new Flog.RayTracer.Ray(pos, dir.normalize());
  } };

Flog.RayTracer.Background = Class.create();
Flog.RayTracer.Background.prototype = { color: null, ambience: 0.0, initialize: function (color, ambience) { this.color = color; this.ambience = ambience; } };

Flog.RayTracer.Engine = Class.create();
Flog.RayTracer.Engine.prototype = { canvas: null,
  initialize: function (options) {
    this.options = Object.extend({ canvasHeight: 100, canvasWidth: 100, pixelWidth: 2, pixelHeight: 2, renderDiffuse: false, renderShadows: false,
      renderHighlights: false, renderReflections: false, rayDepth: 2 }, options || {});
    this.options.canvasHeight /= this.options.pixelHeight; this.options.canvasWidth /= this.options.pixelWidth;
    this.checksum = 0;
  },
  setPixel: function (x, y, color) { if (x == y) this.checksum += color.brightness(); },
  renderScene: function (scene) {
    this.checksum = 0;
    var canvasHeight = this.options.canvasHeight, canvasWidth = this.options.canvasWidth;
    for (var y = 0; y < canvasHeight; y++) for (var x = 0; x < canvasWidth; x++) {
      var yp = y * 1.0 / canvasHeight * 2 - 1, xp = x * 1.0 / canvasWidth * 2 - 1;
      var ray = scene.camera.getRay(xp, yp);
      this.setPixel(x, y, this.getPixelColor(ray, scene));
    }
    if (RT_SEEN === undefined) { RT_SEEN = this.checksum; __out("raytrace checksum " + this.checksum); }
    else if (this.checksum != RT_SEEN) throw new Error("raytrace: checksum changed " + this.checksum);
  },
  getPixelColor: function (ray, scene) {
    var info = this.testIntersection(ray, scene, null);
    if (info.isHit) return this.rayTrace(info, ray, scene, 0);
    return scene.background.color;
  },
  testIntersection: function (ray, scene, exclude) {
    var hits = 0, best = new Flog.RayTracer.IntersectionInfo();
    best.distance = 2000;
    for (var i = 0; i < scene.shapes.length; i++) {
      var shape = scene.shapes[i];
      if (shape != exclude) {
        var info = shape.intersect(ray);
        if (info.isHit && info.distance >= 0 && info.distance < best.distance) { best = info; hits++; }
      }
    }
    best.hitCount = hits;
    return best;
  },
  getReflectionRay: function (P, N, V) {
    var c1 = -N.dot(V);
    var R1 = Flog.RayTracer.Vector.add(Flog.RayTracer.Vector.multiplyScalar(N, 2 * c1), V);
    return new Flog.RayTracer.Ray(P, R1);
  },
  rayTrace: function (info, ray, scene, depth) {
    var color = Flog.RayTracer.Color.multiplyScalar(info.color, scene.background.ambience);
    var oldColor = color;
    var shininess = Math.pow(10, info.shape.material.gloss + 1);
    for (var i = 0; i < scene.lights.length; i++) {
      var light = scene.lights[i];
      var v = Flog.RayTracer.Vector.subtract(light.position, info.position).normalize();
      if (this.options.renderDiffuse) {
        var L = v.dot(info.normal);
        if (L > 0.0) color = Flog.RayTracer.Color.add(color, Flog.RayTracer.Color.multiply(info.color, Flog.RayTracer.Color.multiplyScalar(light.color, L)));
      }
      if (depth <= this.options.rayDepth) {
        if (this.options.renderReflections && info.shape.material.reflection > 0) {
          var reflectionRay = this.getReflectionRay(info.position, info.normal, ray.direction);
          var refl = this.testIntersection(reflectionRay, scene, info.shape);
          if (refl.isHit && refl.distance > 0) refl.color = this.rayTrace(refl, reflectionRay, scene, depth + 1);
          else refl.color = scene.background.color;
          color = Flog.RayTracer.Color.blend(color, refl.color, info.shape.material.reflection);
        }
      }
      var shadowInfo = new Flog.RayTracer.IntersectionInfo();
      if (this.options.renderShadows) {
        var shadowRay = new Flog.RayTracer.Ray(info.position, v);
        shadowInfo = this.testIntersection(shadowRay, scene, info.shape);
        if (shadowInfo.isHit && shadowInfo.shape != info.shape) {
          var vA = Flog.RayTracer.Color.multiplyScalar(color, 0.5);
          var dB = (0.5 * Math.pow(shadowInfo.shape.material.transparency, 0.5));
          color = Flog.RayTracer.Color.addScalar(vA, dB);
        }
      }
      if (this.options.renderHighlights && !shadowInfo.isHit && info.shape.material.gloss > 0) {
        var Lv = Flog.RayTracer.Vector.subtract(info.shape.position, light.position).normalize();
        var E = Flog.RayTracer.Vector.subtract(scene.camera.position, info.shape.position).normalize();
        var H = Flog.RayTracer.Vector.subtract(E, Lv).normalize();
        var glossWeight = Math.pow(Math.max(info.normal.dot(H), 0), shininess);
        color = Flog.RayTracer.Color.add(Flog.RayTracer.Color.multiplyScalar(light.color, glossWeight), color);
      }
    }
    color.limit();
    return color;
  } };

function renderScene() {
  var scene = new Flog.RayTracer.Scene();
  scene.camera = new Flog.RayTracer.Camera(new Flog.RayTracer.Vector(0, 0, -15), new Flog.RayTracer.Vector(-0.2, 0, 5), new Flog.RayTracer.Vector(0, 1, 0));
  scene.background = new Flog.RayTracer.Background(new Flog.RayTracer.Color(0.5, 0.5, 0.5), 0.4);
  var sphere = new Flog.RayTracer.Shape.Sphere(new Flog.RayTracer.Vector(-1.5, 1.5, 2), 1.5,
    new Flog.RayTracer.Material.Solid(new Flog.RayTracer.Color(0, 0.5, 0.5), 0.3, 0.0, 0.0, 2.0));
  var sphere1 = new Flog.RayTracer.Shape.Sphere(new Flog.RayTracer.Vector(1, 0.25, 1), 0.5,
    new Flog.RayTracer.Material.Solid(new Flog.RayTracer.Color(0.9, 0.9, 0.9), 0.1, 0.0, 0.0, 1.5));
  var plane = new Flog.RayTracer.Shape.Plane(new Flog.RayTracer.Vector(0.1, 0.9, -0.5).normalize(), 1.2,
    new Flog.RayTracer.Material.Chessboard(new Flog.RayTracer.Color(1, 1, 1), new Flog.RayTracer.Color(0, 0, 0), 0.2, 0.0, 1.0, 0.7));
  scene.shapes.push(plane); scene.shapes.push(sphere); scene.shapes.push(sphere1);
  scene.lights.push(new Flog.RayTracer.Light(new Flog.RayTracer.Vector(5, 10, -1), new Flog.RayTracer.Color(0.8, 0.8, 0.8)));
  scene.lights.push(new Flog.RayTracer.Light(new Flog.RayTracer.Vector(-3, 5, -15), new Flog.RayTracer.Color(0.8, 0.8, 0.8), 100));
  var raytracer = new Flog.RayTracer.Engine({ canvasWidth: 100, canvasHeight: 100, pixelWidth: 5, pixelHeight: 5,
    renderDiffuse: true, renderHighlights: true, renderShadows: true, renderReflections: true, rayDepth: 2 });
  raytracer.renderScene(scene);
}

BENCH("raytrace", renderScene, 20);
