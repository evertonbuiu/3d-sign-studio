import { Path, Shape, Vector2 } from "three";

import { shapePoints } from "./offset";

function scalePoints(points: Vector2[], sx: number, sy: number): Vector2[] {
  return points.map((p) => new Vector2(p.x * sx, p.y * sy));
}

/** Reconstrói os contornos aplicando escala não uniforme no plano XY. */
export function scaleShapes(shapes: Shape[], sx: number, sy: number): Shape[] {
  if (sx === 1 && sy === 1) return shapes;
  return shapes.map((shape) => {
    const outer = scalePoints(shapePoints(shape), sx, sy);
    const next = new Shape(outer);
    for (const hole of shape.holes) {
      const pts = scalePoints(hole.getPoints(24), sx, sy);
      if (pts.length >= 3) next.holes.push(new Path(pts));
    }
    return next;
  });
}
