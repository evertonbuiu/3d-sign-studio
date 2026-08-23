import ClipperLib from "clipper-lib";
import { Path, Shape, Vector2 } from "three";

const SCALE = 1000; // mm -> unidades inteiras do clipper
const CURVE_DIVISIONS = 24;
const ARC_TOLERANCE = 0.05 * SCALE;
const MITER_LIMIT = 2;

type CPoint = { X: number; Y: number };
type CPath = CPoint[];

export function polygonArea(points: Vector2[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function shapePoints(shape: Shape): Vector2[] {
  return shape.getPoints(CURVE_DIVISIONS);
}

function toCPath(points: Vector2[]): CPath {
  const out: CPath = [];
  for (const p of points) {
    const X = Math.round(p.x * SCALE);
    const Y = Math.round(p.y * SCALE);
    const last = out[out.length - 1];
    if (last && last.X === X && last.Y === Y) continue;
    out.push({ X, Y });
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (first && last && out.length > 1 && first.X === last.X && first.Y === last.Y) out.pop();
  return out;
}

function shapeToCPaths(shape: Shape): CPath[] {
  const paths: CPath[] = [toCPath(shapePoints(shape))];
  for (const hole of shape.holes) {
    paths.push(toCPath(hole.getPoints(CURVE_DIVISIONS)));
  }
  return paths.filter((p) => p.length >= 3);
}

/** Normaliza contornos (par/ímpar) em uma árvore com orientação correta. */
function normalize(paths: CPath[]): CPath[] {
  if (!paths.length) return [];
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const solution: CPath[] = [];
  clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    solution,
    ClipperLib.PolyFillType.pftEvenOdd,
    ClipperLib.PolyFillType.pftEvenOdd,
  );
  return ClipperLib.Clipper.CleanPolygons(solution, SCALE * 0.005) as CPath[];
}

function offsetPaths(paths: CPath[], delta: number): CPath[] {
  if (!paths.length) return [];
  // Use a very small epsilon to ensure Clipper always creates a valid manifold polygon
  // even for "zero" offsets, which helps closing tiny gaps in fonts.
  const effectiveDelta = delta === 0 ? 0.001 : delta;
  const co = new ClipperLib.ClipperOffset(MITER_LIMIT, ARC_TOLERANCE);
  co.AddPaths(paths, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const solution: CPath[] = [];
  co.Execute(solution, effectiveDelta * SCALE);
  return normalize(solution);
}

function differencePaths(subject: CPath[], clip: CPath[]): CPath[] {
  if (!subject.length) return [];
  if (!clip.length) return subject;
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(subject, ClipperLib.PolyType.ptSubject, true);
  clipper.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
  const solution: CPath[] = [];
  clipper.Execute(
    ClipperLib.ClipType.ctDifference,
    solution,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  return ClipperLib.Clipper.CleanPolygons(solution, SCALE * 0.005) as CPath[];
}

function intersectionPaths(subject: CPath[], clip: CPath[]): CPath[] {
  if (!subject.length || !clip.length) return [];
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(subject, ClipperLib.PolyType.ptSubject, true);
  clipper.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
  const solution: CPath[] = [];
  clipper.Execute(
    ClipperLib.ClipType.ctIntersection,
    solution,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  return ClipperLib.Clipper.CleanPolygons(solution, SCALE * 0.005) as CPath[];
}

function toVectors(path: CPath): Vector2[] {
  return path.map((p) => new Vector2(p.X / SCALE, p.Y / SCALE));
}

/** Converte contornos do clipper em Shapes (externos + furos aninhados). */
function pathsToShapes(paths: CPath[]): Shape[] {
  const valid = paths.filter(
    (p) => p.length >= 3 && Math.abs(ClipperLib.Clipper.Area(p)) > SCALE * SCALE * 0.01,
  );
  if (!valid.length) return [];

  const outers = valid.filter((p) => ClipperLib.Clipper.Orientation(p));
  const holes = valid.filter((p) => !ClipperLib.Clipper.Orientation(p));

  const shapes = outers.map((p) => {
    const pts = toVectors(p);
    if (polygonArea(pts) < 0) pts.reverse();
    return { shape: new Shape(pts), path: p };
  });
  if (!shapes.length) return [];

  for (const hole of holes) {
    const pts = toVectors(hole);
    // acha o contorno externo que contém o furo
    const test = hole[0]!;
    let owner = shapes[0]!;
    let bestArea = Infinity;
    for (const candidate of shapes) {
      if (ClipperLib.Clipper.PointInPolygon(test, candidate.path) !== 0) {
        const area = Math.abs(ClipperLib.Clipper.Area(candidate.path));
        if (area < bestArea) {
          bestArea = area;
          owner = candidate;
        }
      }
    }
    if (polygonArea(pts) > 0) pts.reverse();
    owner.shape.holes.push(new Path(pts));
  }

  return shapes.map((s) => s.shape);
}

/** Offset de um Shape (delta positivo = para fora). Pode gerar 0..n Shapes. */
export function offsetShape(shape: Shape, delta: number): Shape[] {
  const base = normalize(shapeToCPaths(shape));
  if (!base.length) return [];
  const result = delta === 0 ? base : offsetPaths(base, delta);
  return pathsToShapes(result);
}

/** Recuo para dentro. Retorna null quando a forma desaparece. */
export function insetShape(shape: Shape, inset: number): Shape[] {
  return offsetShape(shape, -inset);
}

/**
 * Anel (parede) de espessura constante seguindo o contorno da letra.
 * `startInset` desloca o anel para dentro antes de gerar a parede.
 */
export function ringShape(shape: Shape, thickness: number, startInset = 0): Shape[] {
  const base = normalize(shapeToCPaths(shape));
  if (!base.length) return [];
  const outer = startInset > 0 ? offsetPaths(base, -startInset) : base;
  if (!outer.length) return [];
  const inner = offsetPaths(outer, -thickness);
  const ring = inner.length ? differencePaths(outer, inner) : outer;
  return pathsToShapes(ring);
}

/** Gera o anel e o recuo interno a partir da mesma operação de offset. */
export function insetWithRing(shape: Shape, inset: number): { ring: Shape[]; inner: Shape[] } {
  const base = normalize(shapeToCPaths(shape));
  if (!base.length) return { ring: [], inner: [] };
  const innerPaths = offsetPaths(base, -inset);
  const ringPaths = innerPaths.length ? differencePaths(base, innerPaths) : base;
  return { ring: pathsToShapes(ringPaths), inner: pathsToShapes(innerPaths) };
}

function unionPaths(paths: CPath[]): CPath[] {
  if (!paths.length) return [];
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const solution: CPath[] = [];
  clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    solution,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  return ClipperLib.Clipper.CleanPolygons(solution, SCALE * 0.005) as CPath[];
}

/**
 * Aproxima o eixo medial (linha central) do traço da forma e devolve uma faixa
 * de largura `2 * halfWidth` centrada nesse eixo.
 */
export function centerlineBand(shape: Shape, halfWidth: number, step = 0.4): Shape[] {
  const base = normalize(shapeToCPaths(shape));
  if (!base.length) return [];
  const allPoints = base.flat();
  const minX = Math.min(...allPoints.map((point) => point.X)) / SCALE;
  const maxX = Math.max(...allPoints.map((point) => point.X)) / SCALE;
  const minY = Math.min(...allPoints.map((point) => point.Y)) / SCALE;
  const maxY = Math.max(...allPoints.map((point) => point.Y)) / SCALE;
  const requestedCell = Math.max(step, 0.2);
  const cell = Math.max(requestedCell, Math.sqrt(((maxX - minX) * (maxY - minY)) / 220_000));
  const width = Math.max(3, Math.ceil((maxX - minX) / cell) + 3);
  const height = Math.max(3, Math.ceil((maxY - minY) / cell) + 3);
  const originX = minX - cell;
  const originY = minY - cell;
  const pixels = new Uint8Array(width * height);
  const at = (x: number, y: number) => y * width + x;
  const inside = (x: number, y: number) => {
    const point = {
      X: Math.round((originX + (x + 0.5) * cell) * SCALE),
      Y: Math.round((originY + (y + 0.5) * cell) * SCALE),
    };
    let crossings = 0;
    for (const path of base) {
      if (ClipperLib.Clipper.PointInPolygon(point, path) !== 0) crossings++;
    }
    return crossings % 2 === 1;
  };
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) pixels[at(x, y)] = inside(x, y) ? 1 : 0;
  }

  const remove = new Uint8Array(pixels.length);
  const thinPass = (second: boolean) => {
    remove.fill(0);
    let changed = false;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const index = at(x, y);
        if (!pixels[index]) continue;
        const p2 = pixels[at(x, y + 1)]!,
          p3 = pixels[at(x + 1, y + 1)]!;
        const p4 = pixels[at(x + 1, y)]!,
          p5 = pixels[at(x + 1, y - 1)]!;
        const p6 = pixels[at(x, y - 1)]!,
          p7 = pixels[at(x - 1, y - 1)]!;
        const p8 = pixels[at(x - 1, y)]!,
          p9 = pixels[at(x - 1, y + 1)]!;
        const neighbors = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (neighbors < 2 || neighbors > 6) continue;
        const ring = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
        let transitions = 0;
        for (let i = 0; i < 8; i++) if (!ring[i] && ring[i + 1]) transitions++;
        if (transitions !== 1) continue;
        const protectedA = second ? p2 * p4 * p8 : p2 * p4 * p6;
        const protectedB = second ? p2 * p6 * p8 : p4 * p6 * p8;
        if (protectedA || protectedB) continue;
        remove[index] = 1;
        changed = true;
      }
    }
    for (let i = 0; i < pixels.length; i++) if (remove[i]) pixels[i] = 0;
    return changed;
  };
  for (let iteration = 0; iteration < width + height; iteration++) {
    const changedA = thinPass(false);
    const changedB = thinPass(true);
    if (!changedA && !changedB) break;
  }

  const seeds: CPath[] = [];
  const halfCell = cell * 0.38;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (!pixels[at(x, y)]) continue;
      const cx = originX + (x + 0.5) * cell;
      const cy = originY + (y + 0.5) * cell;
      seeds.push([
        { X: Math.round((cx - halfCell) * SCALE), Y: Math.round((cy - halfCell) * SCALE) },
        { X: Math.round((cx + halfCell) * SCALE), Y: Math.round((cy - halfCell) * SCALE) },
        { X: Math.round((cx + halfCell) * SCALE), Y: Math.round((cy + halfCell) * SCALE) },
        { X: Math.round((cx - halfCell) * SCALE), Y: Math.round((cy + halfCell) * SCALE) },
      ]);
    }
  }
  const skeleton = unionPaths(seeds);
  if (!skeleton.length) return [];
  const band = offsetPaths(skeleton, Math.max(0.05, halfWidth - halfCell));
  return pathsToShapes(intersectionPaths(band, base));
}

/** Cópia exata de um Shape (mesmos pontos do contorno e dos furos). */
export function cloneShape(shape: Shape): Shape {
  const copy = new Shape(shapePoints(shape).map((p) => p.clone()));
  for (const hole of shape.holes) {
    copy.holes.push(new Path(hole.getPoints(CURVE_DIVISIONS).map((p) => p.clone())));
  }
  return copy;
}
