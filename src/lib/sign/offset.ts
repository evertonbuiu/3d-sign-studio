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
  if (delta === 0) return paths;
  const co = new ClipperLib.ClipperOffset(MITER_LIMIT, ARC_TOLERANCE);
  co.AddPaths(paths, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const solution: CPath[] = [];
  co.Execute(solution, delta * SCALE);
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
  return solution;
}

function toVectors(path: CPath): Vector2[] {
  return path.map((p) => new Vector2(p.X / SCALE, p.Y / SCALE));
}

/** Converte contornos do clipper em Shapes (externos + furos aninhados). */
function pathsToShapes(paths: CPath[]): Shape[] {
  const valid = paths.filter((p) => p.length >= 3 && Math.abs(ClipperLib.Clipper.Area(p)) > SCALE * SCALE * 0.01);
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
