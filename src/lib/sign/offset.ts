import { Path, Shape, Vector2 } from "three";

/** Offset simples de contorno pela bissetriz (positivo = para fora). */
export function offsetPoints(points: Vector2[], delta: number): Vector2[] {
  const n = points.length;
  if (n < 3 || delta === 0) return points.map((p) => p.clone());

  const area = polygonArea(points);
  const dir = area >= 0 ? 1 : -1;
  const out: Vector2[] = [];

  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n]!;
    const cur = points[i]!;
    const next = points[(i + 1) % n]!;

    const d1 = new Vector2().subVectors(cur, prev).normalize();
    const d2 = new Vector2().subVectors(next, cur).normalize();
    if (d1.lengthSq() === 0 || d2.lengthSq() === 0) continue;

    const n1 = new Vector2(d1.y, -d1.x).multiplyScalar(dir);
    const n2 = new Vector2(d2.y, -d2.x).multiplyScalar(dir);
    const bis = new Vector2().addVectors(n1, n2);
    if (bis.lengthSq() < 1e-9) continue;
    bis.normalize();

    const cos = Math.max(0.25, bis.dot(n1));
    out.push(new Vector2(cur.x + (bis.x * delta) / cos, cur.y + (bis.y * delta) / cos));
  }

  if (out.length < 3) return [];
  const newArea = polygonArea(out);
  if (Math.sign(newArea) !== Math.sign(area) || Math.abs(newArea) < 1) return [];
  return out;
}

export function polygonArea(points: Vector2[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

const CURVE_DIVISIONS = 14;

export function shapePoints(shape: Shape): Vector2[] {
  return shape.getPoints(CURVE_DIVISIONS);
}

/** Reconstrói um Shape aplicando um offset para dentro. */
export function insetShape(shape: Shape, inset: number): Shape | null {
  const outer = offsetPoints(shapePoints(shape), -inset);
  if (outer.length < 3) return null;
  const result = new Shape(outer);
  for (const hole of shape.holes) {
    const pts = offsetPoints(hole.getPoints(CURVE_DIVISIONS), inset);
    if (pts.length >= 3) result.holes.push(new Path(pts));
  }
  return result;
}

/** Contorno externo com furo interno — usado para paredes e canais. */
export function ringShape(shape: Shape, thickness: number, startInset = 0): Shape | null {
  const outerShape = startInset > 0 ? insetShape(shape, startInset) : shape;
  if (!outerShape) return null;
  const inner = insetShape(outerShape, thickness);
  if (!inner) return null;
  const ring = new Shape(shapePoints(outerShape));
  ring.holes.push(new Path(shapePoints(inner)));
  for (const hole of outerShape.holes) ring.holes.push(new Path(hole.getPoints(CURVE_DIVISIONS)));
  for (const hole of inner.holes) ring.holes.push(new Path(hole.getPoints(CURVE_DIVISIONS)));
  return ring;
}
