import fs from "node:fs";
import opentype from "opentype.js";
import { ShapePath } from "three";
import { buildSign } from "../src/lib/sign/build.ts";
import { DEFAULT_PARAMS, getStyle } from "../src/lib/sign/model.ts";
import { splitGeometryByPlane } from "../src/lib/sign/split.ts";
function shapes(font, text, h) {
  const cap = font.tables?.os2?.sCapHeight || font.unitsPerEm * 0.7,
    size = (h * font.unitsPerEm) / cap,
    p = new ShapePath();
  for (const c of font.getPath(text, 0, 0, size).commands) {
    if (c.type === "M") p.moveTo(c.x, -c.y);
    else if (c.type === "L") p.lineTo(c.x, -c.y);
    else if (c.type === "C") p.bezierCurveTo(c.x1, -c.y1, c.x2, -c.y2, c.x, -c.y);
    else if (c.type === "Q") p.quadraticCurveTo(c.x1, -c.y1, c.x, -c.y);
    else if (c.type === "Z") p.currentPath?.closePath();
  }
  return p.toShapes();
}
const font = opentype.parse(
    fs.readFileSync(new URL("../src/assets/fonts/archivo-black.ttf", import.meta.url)).buffer,
  ),
  style = getStyle("fundo-impresso-frente-impressa-aba"),
  params = { ...DEFAULT_PARAMS, ...style.preset, text: "LUMINA", mountHoles: false },
  b = buildSign(shapes(font, "LUMINA", params.letterHeight), params, style),
  g = b.parts.find((p) => p.id === "frente-laterais").geometry;
g.computeBoundingBox();
for (const angle of [0, 30, 45, 60, 90, 120, 150])
  for (const offset of [-80, -40, 0, 40, 80]) {
    const ps = splitGeometryByPlane(g, {
      angle,
      offset,
      connector: "male-female",
      connectorDepth: 4,
      connectorWidth: 50,
      connectorClearance: 0.2,
      connectorFrontInset: params.faceThickness,
    });
    if (ps.length < 2) continue;
    const r = (angle * Math.PI) / 180,
      n = { x: Math.cos(r), y: Math.sin(r) },
      t = { x: -n.y, y: n.x },
      c = {
        x: (g.boundingBox.min.x + g.boundingBox.max.x) / 2,
        y: (g.boundingBox.min.y + g.boundingBox.max.y) / 2,
      },
      plane = n.x * c.x + n.y * c.y + offset,
      q = ps[1].geometry.index ? ps[1].geometry.toNonIndexed() : ps[1].geometry,
      a = q.getAttribute("position");
    let worst = 0,
      bad = null;
    for (let i = 0; i < a.count; i += 3) {
      const ns = [0, 1, 2].map((o) => n.x * a.getX(i + o) + n.y * a.getY(i + o) - plane),
        ts = [0, 1, 2].map((o) => t.x * a.getX(i + o) + t.y * a.getY(i + o)),
        zs = [0, 1, 2].map((o) => a.getZ(i + o));
      const dn = Math.max(...ns) - Math.min(...ns),
        dt = Math.max(...ts) - Math.min(...ts),
        dz = Math.max(...zs) - Math.min(...zs);
      if (
        Math.max(...ns) < -0.01 ||
        Math.min(...ns) > 4.6 ||
        Math.max(...zs) > 42.61 ||
        Math.min(...zs) < 0.99
      )
        continue;
      const score = dt * dz;
      if (score > worst) {
        worst = score;
        bad = { ns, ts, zs, dn, dt, dz };
      }
    }
    if (worst > 100) console.log({ angle, offset, worst, bad });
  }
