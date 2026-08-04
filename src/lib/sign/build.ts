import {
  BufferGeometry,
  Float32BufferAttribute,
  ExtrudeGeometry,
  Box2,
  Box3,
  Path,
  Shape,
  Vector2,
  Vector3,
} from "three";

import { insetShape, offsetShape, ringShape, shapePoints } from "./offset";
import type { PartKind, SignParams, SignStyle } from "./model";

export interface SignPart {
  id: string;
  kind: PartKind;
  name: string;
  color: string;
  opacity: number;
  emissive: boolean;
  geometry: BufferGeometry;
  volumeCm3: number;
  count: number;
}

export interface SignOutline {
  id: string;
  name: string;
  color: string;
  z: number;
  points: Array<[number, number]>;
}

export interface SignBuild {
  parts: SignPart[];
  outlines: SignOutline[];
  width: number;
  height: number;
  depth: number;
  ledLengthMm: number;
  totalVolumeCm3: number;
  printedVolumeCm3: number;
}

const EXTRUDE = { bevelEnabled: false, curveSegments: 14 };

function extrude(shape: Shape | Shape[], depth: number): ExtrudeGeometry {
  return new ExtrudeGeometry(shape, { ...EXTRUDE, depth: Math.max(depth, 0.2) });
}

function geometryVolumeCm3(geometry: BufferGeometry): number {
  const pos = geometry.getAttribute("position");
  if (!pos) return 0;
  const index = geometry.getIndex();
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  let volume = 0;
  const triangles = index ? index.count / 3 : pos.count / 3;
  for (let i = 0; i < triangles; i++) {
    const i0 = index ? index.getX(i * 3) : i * 3;
    const i1 = index ? index.getX(i * 3 + 1) : i * 3 + 1;
    const i2 = index ? index.getX(i * 3 + 2) : i * 3 + 2;
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    volume += a.dot(new Vector3().crossVectors(b, c)) / 6;
  }
  return Math.abs(volume) / 1000; // mm3 -> cm3
}

function circle(cx: number, cy: number, r: number): Path {
  const path = new Path();
  path.absarc(cx, cy, r, 0, Math.PI * 2, false);
  return path;
}

function rectShape(min: Vector2, max: Vector2, radius = 0): Shape {
  const shape = new Shape();
  const r = Math.min(radius, (max.x - min.x) / 2, (max.y - min.y) / 2);
  if (r <= 0) {
    shape.moveTo(min.x, min.y);
    shape.lineTo(max.x, min.y);
    shape.lineTo(max.x, max.y);
    shape.lineTo(min.x, max.y);
    shape.closePath();
    return shape;
  }
  shape.moveTo(min.x + r, min.y);
  shape.lineTo(max.x - r, min.y);
  shape.quadraticCurveTo(max.x, min.y, max.x, min.y + r);
  shape.lineTo(max.x, max.y - r);
  shape.quadraticCurveTo(max.x, max.y, max.x - r, max.y);
  shape.lineTo(min.x + r, max.y);
  shape.quadraticCurveTo(min.x, max.y, min.x, max.y - r);
  shape.lineTo(min.x, min.y + r);
  shape.quadraticCurveTo(min.x, min.y, min.x + r, min.y);
  shape.closePath();
  return shape;
}

function shapesBounds(shapes: Shape[]): Box2 {
  const box = new Box2();
  for (const shape of shapes) {
    for (const p of shapePoints(shape)) box.expandByPoint(p);
  }
  if (box.isEmpty()) box.set(new Vector2(-10, -10), new Vector2(10, 10));
  return box;
}

function translateShapes(shapes: Shape[], dx: number, dy: number): Shape[] {
  return shapes.map((shape) => {
    const moved = new Shape(shapePoints(shape).map((p) => new Vector2(p.x + dx, p.y + dy)));
    for (const hole of shape.holes) {
      moved.holes.push(new Path(hole.getPoints(14).map((p) => new Vector2(p.x + dx, p.y + dy))));
    }
    return moved;
  });
}

function perimeterMm(shapes: Shape[]): number {
  let total = 0;
  for (const shape of shapes) {
    const pts = shapePoints(shape);
    for (let i = 0; i < pts.length; i++) {
      total += pts[i]!.distanceTo(pts[(i + 1) % pts.length]!);
    }
  }
  return total;
}

function makePart(
  id: string,
  kind: PartKind,
  name: string,
  color: string,
  geometry: BufferGeometry,
  options: { opacity?: number; emissive?: boolean; count?: number } = {},
): SignPart {
  geometry.computeVertexNormals();
  return {
    id,
    kind,
    name,
    color,
    geometry,
    opacity: options.opacity ?? 1,
    emissive: options.emissive ?? false,
    volumeCm3: geometryVolumeCm3(geometry),
    count: options.count ?? 1,
  };
}

export function buildSign(
  letterShapes: Shape[],
  params: SignParams,
  style: SignStyle,
): SignBuild {
  const active = new Set<PartKind>(style.parts);
  const parts: SignPart[] = [];

  const rawBounds = shapesBounds(letterShapes);
  const size = rawBounds.getSize(new Vector2());
  const center = rawBounds.getCenter(new Vector2());
  const shapes = translateShapes(letterShapes, -center.x, -center.y).flatMap((s) =>
    offsetShape(s, 0),
  );
  const bounds = shapesBounds(shapes);

  const plateOn = active.has("placa");
  const totem = params.bodyMode === "totem" && active.has("poste");
  const plateZ = totem ? params.poleHeight : 0;
  const baseZ = plateOn ? plateZ + params.plateThickness : 0;

  const plateMin = new Vector2(
    bounds.min.x - params.plateMargin,
    bounds.min.y - params.plateMargin,
  );
  const plateMax = new Vector2(
    bounds.max.x + params.plateMargin,
    bounds.max.y + params.plateMargin,
  );

  const holePoints: Vector2[] = [];
  if (params.mountHoles) {
    const inset = Math.max(params.plateMargin * 0.4, 12);
    const minX = plateOn ? plateMin.x + inset : bounds.min.x + size.x * 0.15;
    const maxX = plateOn ? plateMax.x - inset : bounds.max.x - size.x * 0.15;
    const minY = plateOn ? plateMin.y + inset : bounds.min.y + size.y * 0.2;
    const maxY = plateOn ? plateMax.y - inset : bounds.max.y - size.y * 0.2;
    holePoints.push(
      new Vector2(minX, minY),
      new Vector2(maxX, minY),
      new Vector2(minX, maxY),
      new Vector2(maxX, maxY),
    );
  }

  // ---------- poste (totem) ----------
  if (totem) {
    const poleW = Math.max((plateMax.x - plateMin.x) * 0.18, 60);
    const pole = rectShape(
      new Vector2(-poleW / 2, plateMin.y),
      new Vector2(poleW / 2, plateMin.y + poleW),
      8,
    );
    const geo = extrude(pole, params.poleHeight);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, 0);
    parts.push(makePart("poste", "poste", "Poste do totem", params.backColor, geo));
  }

  // ---------- placa base ----------
  if (plateOn) {
    const plate = rectShape(plateMin, plateMax, 10);
    if (params.cutout) {
      for (const shape of shapes) plate.holes.push(new Path(shapePoints(shape)));
    }
    if (params.mountHoles) {
      for (const p of holePoints) plate.holes.push(circle(p.x, p.y, params.holeDiameter / 2));
    }
    const geo = extrude(plate, params.plateThickness);
    geo.translate(0, 0, plateZ);
    parts.push(makePart("placa", "placa", "Placa base", params.backColor, geo));
  }

  const bodyHeight = Math.max(
    params.depth - params.backThickness - params.faceThickness,
    params.wall,
  );

  // ---------- fundo ----------
  if (active.has("fundo")) {
    const geos: BufferGeometry[] = [];
    for (const shape of shapes) {
      const back = new Shape(shapePoints(shape));
      for (const hole of shape.holes) back.holes.push(new Path(hole.getPoints(14)));
      geos.push(extrude(back, params.backThickness));
    }
    const geo = combine(geos);
    if (geo) {
      geo.translate(0, 0, baseZ);
      parts.push(
        makePart("fundo", "fundo", "Fundo", params.backColor, geo, { count: shapes.length }),
      );
    }
  }

  // ---------- laterais ----------
  if (active.has("laterais")) {
    const geos: BufferGeometry[] = [];
    for (const shape of shapes) {
      for (const ring of ringShape(shape, params.wall)) geos.push(extrude(ring, bodyHeight));
    }
    const geo = combine(geos);
    if (geo) {
      geo.translate(0, 0, baseZ + (active.has("fundo") ? params.backThickness : 0));
      parts.push(
        makePart("laterais", "laterais", "Laterais", params.bodyColor, geo, {
          count: shapes.length,
        }),
      );
    }
  }

  // ---------- canal de LED ----------
  let ledLengthMm = 0;
  if (active.has("canal-led") && params.led) {
    const geos: BufferGeometry[] = [];
    for (const shape of shapes) {
      const start = params.wall + params.ledOffset;
      const rings = ringShape(shape, params.ledChannelWidth, start);
      if (rings.length) {
        for (const ring of rings) geos.push(extrude(ring, params.ledChannelHeight));
        const inner = insetShape(shape, start + params.ledChannelWidth / 2);
        if (inner.length) ledLengthMm += perimeterMm(inner);
      }
    }
    const geo = combine(geos);
    if (geo) {
      geo.translate(0, 0, baseZ + (active.has("fundo") ? params.backThickness : plateOn ? 0 : 0));
      parts.push(
        makePart("canal-led", "canal-led", "Canal para LED", params.ledColor, geo, {
          emissive: true,
          count: shapes.length,
        }),
      );
    }
  }


  // ---------- frente ----------
  if (active.has("frente")) {
    const geos: BufferGeometry[] = [];
    for (const shape of shapes) {
      const face = new Shape(shapePoints(shape));
      for (const hole of shape.holes) face.holes.push(new Path(hole.getPoints(14)));
      geos.push(extrude(face, params.faceThickness));
    }
    const geo = combine(geos);
    if (geo) {
      const z = plateOn && !active.has("laterais") ? baseZ : baseZ + params.depth - params.faceThickness;
      geo.translate(0, 0, Math.max(z, baseZ));
      parts.push(
        makePart("frente", "frente", "Frente", params.faceColor, geo, {
          emissive: params.led,
          count: shapes.length,
        }),
      );
    }
  }

  // ---------- camadas extras ----------
  const layerDefs: Array<{ kind: PartKind; index: number }> = [];
  if (active.has("camada-2")) layerDefs.push({ kind: "camada-2", index: 1 });
  if (active.has("camada-3")) layerDefs.push({ kind: "camada-3", index: 2 });
  for (const def of layerDefs) {
    const geos: BufferGeometry[] = [];
    for (const shape of shapes) {
      for (const inner of insetShape(shape, params.layerShrink * def.index)) {
        geos.push(extrude(inner, params.layerThickness));
      }
    }
    const geo = combine(geos);
    if (geo) {
      const base =
        baseZ +
        (plateOn && !active.has("laterais") ? params.faceThickness : params.depth) +
        params.layerThickness * (def.index - 1);
      geo.translate(0, 0, base);
      parts.push(
        makePart(def.kind, def.kind, `Camada ${def.index + 1}`, shadeColor(params.bodyColor, def.index * 18), geo, {
          count: shapes.length,
        }),
      );
    }
  }




  // ---------- furos ----------
  if (params.mountHoles && active.has("furos") && holePoints.length) {
    const geos: BufferGeometry[] = [];
    for (const p of holePoints) {
      const ring = new Shape();
      ring.absarc(p.x, p.y, params.holeDiameter / 2 + 2.5, 0, Math.PI * 2, false);
      ring.holes.push(circle(p.x, p.y, params.holeDiameter / 2));
      geos.push(extrude(ring, 1.6));
    }
    const geo = combine(geos);
    if (geo) {
      geo.translate(0, 0, plateOn ? plateZ + params.plateThickness : baseZ + params.backThickness);
      parts.push(
        makePart("furos", "furos", "Furos de fixação", "#64748b", geo, {
          count: holePoints.length,
        }),
      );
    }
  }

  const totalWidth = plateOn ? plateMax.x - plateMin.x : bounds.max.x - bounds.min.x;
  const totalHeight =
    (plateOn ? plateMax.y - plateMin.y : bounds.max.y - bounds.min.y) +
    (totem ? params.poleHeight : 0);
  const totalDepth = plateOn
    ? params.plateThickness + (active.has("frente") ? params.faceThickness : 0)
    : params.depth;

  const printedVolumeCm3 = parts
    .filter((p) => p.kind !== "canal-led")
    .reduce((sum, p) => sum + p.volumeCm3, 0);

  // ---------- contornos / offsets de conferência ----------
  const outlines: SignOutline[] = [];
  const pushOutlines = (
    id: string,
    name: string,
    color: string,
    z: number,
    list: Shape[],
  ) => {
    list.forEach((shape, i) => {
      outlines.push({ id: `${id}-${i}`, name, color, z, points: contourPoints(shape) });
      shape.holes.forEach((hole, h) => {
        outlines.push({
          id: `${id}-${i}-h${h}`,
          name,
          color,
          z,
          points: hole.getPoints(14).map((p) => [p.x, p.y] as [number, number]),
        });
      });
    });
  };

  pushOutlines("contorno", "Contorno da letra", "#0f172a", baseZ, shapes);
  pushOutlines(
    "parede",
    "Parede interna",
    "#2563eb",
    baseZ,
    shapes.flatMap((s) => insetShape(s, params.wall)),
  );
  if (params.led) {
    const start = params.wall + params.ledOffset;
    pushOutlines(
      "led-ini",
      "Canal LED (início)",
      "#f59e0b",
      baseZ,
      shapes.flatMap((s) => insetShape(s, start)),
    );
    pushOutlines(
      "led-fim",
      "Canal LED (fim)",
      "#f59e0b",
      baseZ,
      shapes.flatMap((s) => insetShape(s, start + params.ledChannelWidth)),
    );
  }
  if (plateOn) {
    pushOutlines("placa-out", "Contorno da placa", "#64748b", plateZ, [
      rectShape(plateMin, plateMax, 10),
    ]);
  }
  for (const p of holePoints) {
    const shape = new Shape();
    shape.absarc(p.x, p.y, params.holeDiameter / 2, 0, Math.PI * 2, false);
    pushOutlines(`furo-${p.x.toFixed(0)}-${p.y.toFixed(0)}`, "Furo", "#dc2626", baseZ, [shape]);
  }

  return {
    parts,
    outlines,
    width: totalWidth,
    height: totalHeight,
    depth: totalDepth,
    ledLengthMm: params.led ? ledLengthMm || perimeterMm(shapes) * 0.85 : 0,
    totalVolumeCm3: parts.reduce((sum, p) => sum + p.volumeCm3, 0),
    printedVolumeCm3,
  };
}

function combine(geos: BufferGeometry[]): BufferGeometry | null {
  const valid = geos.filter((g) => g.getAttribute("position")?.count);
  if (!valid.length) return null;
  if (valid.length === 1) return valid[0]!;
  return mergePositions(valid);
}

function mergePositions(geos: BufferGeometry[]): BufferGeometry {
  let total = 0;
  const nonIndexed = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of nonIndexed) total += g.getAttribute("position").count;
  const array = new Float32Array(total * 3);
  let offset = 0;
  for (const g of nonIndexed) {
    const pos = g.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      array[offset++] = pos.getX(i);
      array[offset++] = pos.getY(i);
      array[offset++] = pos.getZ(i);
    }
  }
  const merged = new BufferGeometry();
  merged.setAttribute("position", new Float32BufferAttribute(array, 3));
  return merged;
}

function shadeColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, ((num >> 16) & 255) + amount);
  const g = Math.min(255, ((num >> 8) & 255) + amount);
  const b = Math.min(255, (num & 255) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

export function buildBoundingBox(parts: SignPart[]): Box3 {
  const box = new Box3();
  for (const part of parts) {
    part.geometry.computeBoundingBox();
    if (part.geometry.boundingBox) box.union(part.geometry.boundingBox);
  }
  return box;
}

function contourPoints(shape: Shape): Array<[number, number]> {
  return shapePoints(shape).map((p) => [p.x, p.y] as [number, number]);
}
