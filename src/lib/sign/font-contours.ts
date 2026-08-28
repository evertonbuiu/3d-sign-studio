import { Path, Shape, ShapePath, Vector2 } from "three";

function polygonArea(points: Vector2[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const point = points[index]!;
    const next = points[(index + 1) % points.length]!;
    area += point.x * next.y - next.x * point.y;
  }
  return area / 2;
}

function pointInPolygon(point: Vector2, polygon: Vector2[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index]!;
    const b = polygon[previous]!;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Classifica contornos por contenção, sem depender da orientação fornecida pela fonte. */
export function shapePathByContainment(path: ShapePath): Shape[] {
  return shapePathsByContainment([path]);
}

/** Classifica em conjunto contornos vindos de vários caminhos SVG. */
export function shapePathsByContainment(paths: ShapePath[]): Shape[] {
  const contours = paths
    .flatMap((path) => path.subPaths)
    .map((subPath) => ({ points: subPath.getPoints(48) }))
    .filter(({ points }) => points.length >= 3)
    .map((contour) => ({
      ...contour,
      area: Math.abs(polygonArea(contour.points)),
      parent: -1,
      depth: 0,
    }));
  for (let index = 0; index < contours.length; index++) {
    const contour = contours[index]!;
    const sample = contour.points[0]!;
    let parentArea = Infinity;
    for (let candidateIndex = 0; candidateIndex < contours.length; candidateIndex++) {
      const candidate = contours[candidateIndex]!;
      if (candidateIndex === index || candidate.area <= contour.area) continue;
      if (candidate.area < parentArea && pointInPolygon(sample, candidate.points)) {
        contour.parent = candidateIndex;
        parentArea = candidate.area;
      }
    }
  }
  const depthOf = (index: number): number => {
    const parent = contours[index]!.parent;
    return parent < 0 ? 0 : 1 + depthOf(parent);
  };
  contours.forEach((contour, index) => {
    contour.depth = depthOf(index);
  });
  const shapes: Shape[] = [];
  contours.forEach((contour, index) => {
    if (contour.depth % 2) return;
    const outer = contour.points.slice();
    if (polygonArea(outer) < 0) outer.reverse();
    const shape = new Shape(outer);
    contours.forEach((hole) => {
      if (hole.parent !== index || hole.depth % 2 === 0) return;
      const points = hole.points.slice();
      if (polygonArea(points) > 0) points.reverse();
      shape.holes.push(new Path(points));
    });
    shapes.push(shape);
  });
  return shapes;
}

