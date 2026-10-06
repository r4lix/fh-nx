// Time and heap cost of parsing the database files MV loads at boot, plus a couple of maps.
import * as std from "qjs:std";
const www = scriptArgs[1];
const names = ["Actors","Classes","Skills","Items","Weapons","Armors","Enemies","Troops","States","Animations","Tilesets","CommonEvents","System","MapInfos"];
let tot = 0, totB = 0; const keep = [];
for (const n of names) {
  const t0 = Date.now(); const s = std.loadFile(www + "/data/" + n + ".json"); const t1 = Date.now();
  keep.push(JSON.parse(s)); const t2 = Date.now();
  tot += t2 - t1; totB += s.length;
  print(n.padEnd(14) + String((s.length / 1024) | 0).padStart(7) + " KB  parse " + (t2 - t1) + " ms");
}
print("database: " + (totB / 1048576).toFixed(1) + " MB text, parse " + tot + " ms total");
if (scriptArgs[2] !== "nomaps") for (const m of ["Map001", "Map031", "Map053", "Map074"]) {
  const s = std.loadFile(www + "/data/" + m + ".json"); const t = Date.now(); keep.push(JSON.parse(s));
  print(m + " " + ((s.length / 1024) | 0) + " KB parse " + (Date.now() - t) + " ms");
}
