import {
  BufferGeometry,
  Float32BufferAttribute,
  ExtrudeGeometry,
  Box2,
  Box3,
  Path,
  Shape,
  ShapeUtils,
  Vector2,
  Vector3,
} from "three";
import { cloneShape, insetShape, offsetShape, ringShape, shapePoints } from "./offset.ts";
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

const EXTRUDE = { bevelEnabled: false, curveSegments: 24, steps: 1 };

function extrude(shape: Shape | Shape[], depth: number): ExtrudeGeometry {
  return new ExtrudeGeometry(shape, { ...EXTRUDE, depth: Math.max(depth, 0.5) });
}

function cleanContour(points: Vector2[]): Vector2[] {
  const result = points.map((point) => point.clone());
  const first = result[0];
  const last = result[result.length - 1];
  if (first && last && first.distanceToSquared(last) < 1e-12) result.pop();
  return result;
}

function reverseTriangleWinding(geometry: BufferGeometry): void {
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  if (source !== geometry) geometry.copy(source);
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i += 3) {
    const bx = position.getX(i + 1);
    const by = position.getY(i + 1);
    const bz = position.getZ(i + 1);
    position.setXYZ(i + 1, position.getX(i + 2), position.getY(i + 2), position.getZ(i + 2));
    position.setXYZ(i + 2, bx, by, bz);
  }
  position.needsUpdate = true;
}

function steppedRingGeometry(
  lower: Shape,
  upper: Shape,
  bodyHeight: number,
  faceHeight: number,
  backThickness = 0,
  throughHoles: Vector2[][] = [],
): BufferGeometry | null {
  if (lower.holes.length !== upper.holes.length) return null;

  const outer = cleanContour(lower.getPoints(24));
  const lowerHoles = lower.holes.map((hole) => cleanContour(hole.getPoints(24)));
  const upperHoles = upper.holes.map((hole) => cleanContour(hole.getPoints(24)));
  if (outer.length < 3 || lowerHoles.some((hole) => hole.length < 3)) return null;

  const values: number[] = [];
  const triangle = (a: Vector2, za: number, b: Vector2, zb: number, c: Vector2, zc: number) => {
    values.push(a.x, a.y, za, b.x, b.y, zb, c.x, c.y, zc);
  };
  const wallStrip = (contour: Vector2[], z0: number, z1: number, reverse = false) => {
    for (let i = 0; i < contour.length; i++) {
      const a = contour[i]!;
      const b = contour[(i + 1) % contour.length]!;
      if (reverse) {
        triangle(a, z0, b, z1, b, z0);
        triangle(a, z0, a, z1, b, z1);
      } else {
        triangle(a, z0, b, z0, b, z1);
        triangle(a, z0, b, z1, a, z1);
      }
    }
  };
  const cap = (contour: Vector2[], holes: Vector2[][], z: number, reverse = false) => {
    const points = [...contour, ...holes.flat()];
    for (const face of ShapeUtils.triangulateShape(contour, holes)) {
      const ia = reverse ? face[2]! : face[0]!;
      const ib = face[1]!;
      const ic = reverse ? face[0]! : face[2]!;
      triangle(points[ia]!, z, points[ib]!, z, points[ic]!, z);
    }
  };

  const stepZ = backThickness + bodyHeight;
  const topZ = stepZ + faceHeight;
  cap(outer, backThickness > 0 ? throughHoles : lowerHoles, 0, true);
  wallStrip(outer, 0, topZ);
  lowerHoles.forEach((hole) => {
    if (backThickness > 0) {
      const holes = throughHoles.filter((candidate) => pointInPolygon(candidate[0]!, hole));
      cap(hole, holes, backThickness);
    }
    wallStrip(hole, backThickness, stepZ, true);
  });
  for (const hole of throughHoles) wallStrip(hole, 0, backThickness, true);
  if (faceHeight > 0) {
    upperHoles.forEach((hole) => wallStrip(hole, stepZ, topZ, true));
    for (let i = 0; i < lowerHoles.length; i++) {
      cap(upperHoles[i]!, [lowerHoles[i]!], stepZ);
    }
    cap(outer, upperHoles, topZ);
  } else {
    // Canal aberto: fecha apenas o topo das paredes, sem criar o degrau ou
    // faces degeneradas de uma tampa com altura zero.
    cap(outer, lowerHoles, topZ);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(values, 3));
  return geometry;
}

function doubleRecessRingGeometry(
  thick: Shape,
  lip: Shape,
  bodyHeight: number,
  backHeight: number,
  faceHeight: number,
): BufferGeometry | null {
  if (thick.holes.length !== lip.holes.length) return null;
  const outer = cleanContour(thick.getPoints(24));
  const thickHoles = thick.holes.map((hole) => cleanContour(hole.getPoints(24)));
  const lipHoles = lip.holes.map((hole) => cleanContour(hole.getPoints(24)));
  if (outer.length < 3 || thickHoles.some((hole) => hole.length < 3)) return null;

  const values: number[] = [];
  const triangle = (a: Vector2, za: number, b: Vector2, zb: number, c: Vector2, zc: number) =>
    values.push(a.x, a.y, za, b.x, b.y, zb, c.x, c.y, zc);
  const wallStrip = (contour: Vector2[], z0: number, z1: number, reverse = false) => {
    for (let i = 0; i < contour.length; i++) {
      const a = contour[i]!;
      const b = contour[(i + 1) % contour.length]!;
      if (reverse) {
        triangle(a, z0, b, z1, b, z0);
        triangle(a, z0, a, z1, b, z1);
      } else {
        triangle(a, z0, b, z0, b, z1);
        triangle(a, z0, b, z1, a, z1);
      }
    }
  };
  const cap = (contour: Vector2[], holes: Vector2[][], z: number, reverse = false) => {
    const points = [...contour, ...holes.flat()];
    for (const face of ShapeUtils.triangulateShape(contour, holes)) {
      const ia = reverse ? face[2]! : face[0]!;
      const ib = face[1]!;
      const ic = reverse ? face[0]! : face[2]!;
      triangle(points[ia]!, z, points[ib]!, z, points[ic]!, z);
    }
  };

  const middleStart = backHeight;
  const middleEnd = backHeight + bodyHeight;
  const totalHeight = middleEnd + faceHeight;
  cap(outer, lipHoles, 0, true);
  wallStrip(outer, 0, totalHeight);
  for (let i = 0; i < thickHoles.length; i++) {
    const thickHole = thickHoles[i]!;
    const lipHole = lipHoles[i]!;
    wallStrip(lipHole, 0, middleStart, true);
    cap(lipHole, [thickHole], middleStart);
    wallStrip(thickHole, middleStart, middleEnd, true);
    cap(lipHole, [thickHole], middleEnd, true);
    wallStrip(lipHole, middleEnd, totalHeight, true);
  }
  cap(outer, lipHoles, totalHeight);

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(values, 3));
  return geometry;
}

function backFlangeRingGeometry(
  thick: Shape,
  frontLip: Shape,
  flange: Shape,
  bodyHeight: number,
  backHeight: number,
  faceHeight: number,
  flangeThickness: number,
): BufferGeometry | null {
  if (thick.holes.length !== frontLip.holes.length || thick.holes.length !== flange.holes.length) {
    return null;
  }
  const outer = cleanContour(thick.getPoints(24));
  const thickHoles = thick.holes.map((hole) => cleanContour(hole.getPoints(24)));
  const frontHoles = frontLip.holes.map((hole) => cleanContour(hole.getPoints(24)));
  const flangeHoles = flange.holes.map((hole) => cleanContour(hole.getPoints(24)));
  if (outer.length < 3 || thickHoles.some((hole) => hole.length < 3)) return null;

  const values: number[] = [];
  const triangle = (a: Vector2, za: number, b: Vector2, zb: number, c: Vector2, zc: number) =>
    values.push(a.x, a.y, za, b.x, b.y, zb, c.x, c.y, zc);
  const wallStrip = (contour: Vector2[], z0: number, z1: number, reverse = false) => {
    for (let i = 0; i < contour.length; i++) {
      const a = contour[i]!;
      const b = contour[(i + 1) % contour.length]!;
      if (reverse) {
        triangle(a, z0, b, z1, b, z0);
        triangle(a, z0, a, z1, b, z1);
      } else {
        triangle(a, z0, b, z0, b, z1);
        triangle(a, z0, b, z1, a, z1);
      }
    }
  };
  const cap = (contour: Vector2[], holes: Vector2[][], z: number, reverse = false) => {
    const points = [...contour, ...holes.flat()];
    for (const face of ShapeUtils.triangulateShape(contour, holes)) {
      const ia = reverse ? face[2]! : face[0]!;
      const ib = face[1]!;
      const ic = reverse ? face[0]! : face[2]!;
      triangle(points[ia]!, z, points[ib]!, z, points[ic]!, z);
    }
  };

  // A aba nasce exatamente na extremidade traseira da parede. O fundo
  // acrílico fica logo à frente dela, apoiado no ombro interno.
  const flangeStart = 0;
  const flangeEnd = Math.min(
    Math.max(flangeThickness, 0.5),
    Math.max(backHeight + bodyHeight / 2, 0.5),
  );
  const frontStart = backHeight + bodyHeight;
  const totalHeight = frontStart + faceHeight;
  // A tampa traseira acompanha o vazio menor criado pela aba. Assim parede e
  // aba compartilham uma única borda, sem faces coplanares sobrepostas.
  cap(outer, flangeHoles, 0, true);
  wallStrip(outer, 0, totalHeight);
  for (let i = 0; i < thickHoles.length; i++) {
    const thickHole = thickHoles[i]!;
    const frontHole = frontHoles[i]!;
    const flangeHole = flangeHoles[i]!;
    wallStrip(flangeHole, flangeStart, flangeEnd, true);
    cap(thickHole, [flangeHole], flangeEnd, true);
    wallStrip(thickHole, flangeEnd, frontStart, true);
    cap(frontHole, [thickHole], frontStart);
    wallStrip(frontHole, frontStart, totalHeight, true);
  }
  cap(outer, frontHoles, totalHeight);

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(values, 3));
  return geometry;
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
    const src = cloneShape(shape);
    const moved = new Shape(shapePoints(src).map((p) => new Vector2(p.x + dx, p.y + dy)));
    for (const hole of src.holes) {
      moved.holes.push(new Path(hole.getPoints(24).map((p) => new Vector2(p.x + dx, p.y + dy))));
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

function pointInPolygon(point: Vector2, polygon: Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToSegment(point: Vector2, a: Vector2, b: Vector2): number {
  const ab = b.clone().sub(a);
  const lengthSq = ab.lengthSq();
  if (!lengthSq) return point.distanceTo(a);
  const t = Math.max(0, Math.min(1, point.clone().sub(a).dot(ab) / lengthSq));
  return point.distanceTo(a.clone().addScaledVector(ab, t));
}

function findInteriorMountPoint(shape: Shape, minimumClearance: number): Vector2 | null {
  const outer = shapePoints(shape);
  const holes = shape.holes.map((hole) => hole.getPoints(24));
  const bounds = new Box2().setFromPoints(outer);
  let best: { point: Vector2; clearance: number } | null = null;

  for (let y = 1; y < 10; y++) {
    for (let x = 1; x < 10; x++) {
      const point = new Vector2(
        bounds.min.x + ((bounds.max.x - bounds.min.x) * x) / 10,
        bounds.min.y + ((bounds.max.y - bounds.min.y) * y) / 10,
      );
      if (!pointInPolygon(point, outer) || holes.some((hole) => pointInPolygon(point, hole))) {
        continue;
      }
      const contours = [outer, ...holes];
      let clearance = Infinity;
      for (const contour of contours) {
        for (let i = 0; i < contour.length; i++) {
          clearance = Math.min(
            clearance,
            distanceToSegment(point, contour[i]!, contour[(i + 1) % contour.length]!),
          );
        }
      }
      if (!best || clearance > best.clearance) best = { point, clearance };
    }
  }

  return best && best.clearance >= minimumClearance ? best.point : null;
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

export function buildSign(letterShapes: Shape[], params: SignParams, style: SignStyle): SignBuild {
  const active = new Set<PartKind>(style.parts);
  const neonFlexOpenCup = style.id === "neon-flex-fundo-impresso";
  const unifiedPrintedCup = style.id === "fundo-impresso-frente-acrilica" || neonFlexOpenCup;
  const unifiedPrintedFace = style.id === "fundo-acrilico-frente-impressa";
  const doubleAcrylicRecess = style.id === "fundo-acrilico-frente-acrilica";
  const acrylicBackFlange = style.id === "fundo-acrilico-frente-acrilica-aba";
  const parts: SignPart[] = [];

  const rawBounds = shapesBounds(letterShapes);
  const size = rawBounds.getSize(new Vector2());
  const center = rawBounds.getCenter(new Vector2());
  // Apply a tiny offset (0.01) to "heal" precision errors in font contours before main operations
  const shapes = translateShapes(letterShapes, -center.x, -center.y).flatMap((s) =>
    offsetShape(s, 0.01),
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
  const letterHolePoints =
    params.mountHoles && !plateOn
      ? shapes
          .map((shape) =>
            findInteriorMountPoint(shape, params.holeDiameter / 2 + Math.max(params.wall, 2)),
          )
          .filter((point): point is Vector2 => point !== null)
      : [];

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

  const bodyHeight = neonFlexOpenCup
    ? params.neonFlexThickness
    : Math.max(params.depth - params.backThickness - params.faceThickness, params.wall);

  // ---------- fundo ----------
  if (active.has("fundo") && !unifiedPrintedCup) {
    const geos: BufferGeometry[] = [];
    for (const shape of shapes) {
      const backs = doubleAcrylicRecess
        ? insetShape(shape, params.recessLip + params.clearance)
        : acrylicBackFlange
          ? insetShape(shape, params.wall + params.clearance)
          : [cloneShape(shape)];
      for (const back of backs) {
        if (!plateOn && params.mountHoles) {
          const mountPoint = findInteriorMountPoint(
            back,
            params.holeDiameter / 2 + Math.max(params.wall, 2),
          );
          if (mountPoint) {
            back.holes.push(circle(mountPoint.x, mountPoint.y, params.holeDiameter / 2));
          }
        }
        geos.push(extrude(back, params.backThickness));
      }
    }
    const geo = combine(geos);
    if (geo) {
      geo.translate(0, 0, baseZ + (acrylicBackFlange ? params.backFlangeThickness : 0));
      parts.push(
        makePart("fundo", "fundo", "Fundo", params.backColor, geo, { count: shapes.length }),
      );
    }
  }

  // rebaixo (degrau) na parede interna para assentar a frente
  const recessLip = Math.max(params.recessLip, 0.5);
  const recessOn =
    neonFlexOpenCup ||
    doubleAcrylicRecess ||
    acrylicBackFlange ||
    (params.faceRecess &&
      active.has("frente") &&
      active.has("laterais") &&
      recessLip < params.wall);
  const faceInset = recessOn ? recessLip + params.clearance : 0;

  // ---------- laterais (parede + rebaixo em uma peça só) ----------
  if (active.has("laterais")) {
    const geos: BufferGeometry[] = [];
    for (const shape of shapes) {
      if (recessOn) {
        const lowerRings = ringShape(shape, params.wall);
        const upperRings = ringShape(shape, neonFlexOpenCup ? params.wall : recessLip);
        const flangeRings = acrylicBackFlange
          ? ringShape(shape, params.wall + params.backFlangeWidth)
          : [];
        if (
          lowerRings.length === upperRings.length &&
          (!acrylicBackFlange || lowerRings.length === flangeRings.length)
        ) {
          for (let i = 0; i < lowerRings.length; i++) {
            const wall = acrylicBackFlange
              ? backFlangeRingGeometry(
                  lowerRings[i]!,
                  upperRings[i]!,
                  flangeRings[i]!,
                  bodyHeight,
                  params.backThickness,
                  params.faceThickness,
                  params.backFlangeThickness,
                )
              : doubleAcrylicRecess
                ? doubleRecessRingGeometry(
                    lowerRings[i]!,
                    upperRings[i]!,
                    bodyHeight,
                    params.backThickness,
                    params.faceThickness,
                  )
                : steppedRingGeometry(
                    lowerRings[i]!,
                    upperRings[i]!,
                    bodyHeight,
                    neonFlexOpenCup
                      ? 0
                      : unifiedPrintedFace
                        ? params.backThickness
                        : params.faceThickness,
                    unifiedPrintedCup
                      ? params.backThickness
                      : unifiedPrintedFace
                        ? params.faceThickness
                        : 0,
                    unifiedPrintedCup && params.mountHoles
                      ? letterHolePoints
                          .filter((point) => pointInPolygon(point, lowerRings[i]!.getPoints(24)))
                          .map((point) =>
                            circle(point.x, point.y, params.holeDiameter / 2).getPoints(24),
                          )
                      : [],
                  );
            if (wall) {
              if (unifiedPrintedFace) {
                wall.scale(1, 1, -1);
                wall.translate(0, 0, params.depth);
                reverseTriangleWinding(wall);
              }
              geos.push(wall);
            }
          }
          continue;
        }
      }
      geos.push(...ringShape(shape, params.wall).map((ring) => extrude(ring, bodyHeight)));
    }

    const geo = combine(geos);
    if (geo) {
      geo.translate(
        0,
        0,
        unifiedPrintedCup || unifiedPrintedFace || doubleAcrylicRecess || acrylicBackFlange
          ? baseZ
          : baseZ + (active.has("fundo") ? params.backThickness : 0),
      );
      parts.push(
        makePart(
          unifiedPrintedCup
            ? "fundo-laterais"
            : unifiedPrintedFace
              ? "frente-laterais"
              : "laterais",
          "laterais",
          unifiedPrintedCup
            ? "Fundo + laterais (peça única)"
            : unifiedPrintedFace
              ? "Frente + laterais (peça única)"
              : "Laterais",
          params.bodyColor,
          geo,
          { count: shapes.length },
        ),
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
  if (active.has("frente") && !unifiedPrintedFace) {
    const geos: BufferGeometry[] = [];
    for (const shape of shapes) {
      if (faceInset > 0) {
        for (const inner of insetShape(shape, faceInset)) {
          geos.push(extrude(inner, params.faceThickness));
        }
        continue;
      }
      geos.push(extrude(cloneShape(shape), params.faceThickness));
    }

    const geo = combine(geos);
    if (geo) {
      const z =
        plateOn && !active.has("laterais") ? baseZ : baseZ + params.depth - params.faceThickness;
      geo.translate(0, 0, Math.max(z, baseZ));
      parts.push(
        makePart("frente", "frente", "Frente", params.faceColor, geo, {
          emissive:
            params.led &&
            (style.thumb.glow === "front" ||
              style.thumb.glow === "both" ||
              style.thumb.glow === "edge"),
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
        makePart(
          def.kind,
          def.kind,
          `Camada ${def.index + 1}`,
          shadeColor(params.bodyColor, def.index * 18),
          geo,
          {
            count: shapes.length,
          },
        ),
      );
    }
  }

  // ---------- furos ----------
  const activeHolePoints = plateOn ? holePoints : letterHolePoints;
  if (params.mountHoles && active.has("furos") && activeHolePoints.length) {
    const geos: BufferGeometry[] = [];
    for (const p of activeHolePoints) {
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
  const pushOutlines = (id: string, name: string, color: string, z: number, list: Shape[]) => {
    list.forEach((shape, i) => {
      outlines.push({ id: `${id}-${i}`, name, color, z, points: contourPoints(shape) });
      shape.holes.forEach((hole, h) => {
        outlines.push({
          id: `${id}-${i}-h${h}`,
          name,
          color,
          z,
          points: hole.getPoints(24).map((p) => [p.x, p.y] as [number, number]),
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
