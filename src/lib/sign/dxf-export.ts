import type { BufferGeometry } from "three";

export type DxfSurface = "front" | "back";

interface Point2 {
  x: number;
  y: number;
}

const EPSILON = 1e-4;

function pointKey(x: number, y: number): string {
  return `${Math.round(x / EPSILON)},${Math.round(y / EPSILON)}`;
}

function surfaceLoops(geometry: BufferGeometry, surface: DxfSurface): Point2[][] {
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = source.getAttribute("position");
  if (!position?.count) return [];
  let planeZ = surface === "front" ? -Infinity : Infinity;
  for (let index = 0; index < position.count; index++) {
    const z = position.getZ(index);
    planeZ = surface === "front" ? Math.max(planeZ, z) : Math.min(planeZ, z);
  }

  const points = new Map<string, Point2>();
  const edges = new Map<string, { a: string; b: string; count: number }>();
  const addEdge = (a: Point2, b: Point2) => {
    const aKey = pointKey(a.x, a.y);
    const bKey = pointKey(b.x, b.y);
    if (aKey === bKey) return;
    points.set(aKey, a);
    points.set(bKey, b);
    const edgeKey = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
    const edge = edges.get(edgeKey);
    if (edge) edge.count += 1;
    else edges.set(edgeKey, { a: aKey, b: bKey, count: 1 });
  };

  for (let index = 0; index + 2 < position.count; index += 3) {
    const vertices = [0, 1, 2].map((offset) => ({
      x: position.getX(index + offset),
      y: position.getY(index + offset),
      z: position.getZ(index + offset),
    }));
    if (!vertices.every((point) => Math.abs(point.z - planeZ) <= EPSILON)) continue;
    addEdge(vertices[0]!, vertices[1]!);
    addEdge(vertices[1]!, vertices[2]!);
    addEdge(vertices[2]!, vertices[0]!);
  }

  const adjacency = new Map<string, string[]>();
  for (const edge of edges.values()) {
    if (edge.count !== 1) continue;
    adjacency.set(edge.a, [...(adjacency.get(edge.a) ?? []), edge.b]);
    adjacency.set(edge.b, [...(adjacency.get(edge.b) ?? []), edge.a]);
  }
  const used = new Set<string>();
  const loops: Point2[][] = [];
  const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const start of adjacency.keys()) {
    for (const first of adjacency.get(start) ?? []) {
      if (used.has(edgeKey(start, first))) continue;
      const keys = [start];
      let previous = start;
      let current = first;
      used.add(edgeKey(previous, current));
      while (current !== start && keys.length <= adjacency.size + 1) {
        keys.push(current);
        const next = (adjacency.get(current) ?? []).find(
          (candidate) => candidate !== previous && !used.has(edgeKey(current, candidate)),
        );
        if (!next) break;
        previous = current;
        current = next;
        used.add(edgeKey(previous, current));
      }
      if (current === start && keys.length >= 3) {
        loops.push(keys.map((key) => points.get(key)!));
      }
    }
  }
  return loops;
}

/** Exporta as bordas da superfície extrema como polilinhas DXF fechadas, em milímetros. */
export function geometriesSurfaceToDxf(
  geometries: BufferGeometry[],
  surface: DxfSurface,
): string {
  const loops = geometries.flatMap((geometry) => surfaceLoops(geometry, surface));
  if (!loops.length) throw new Error("A peça não possui uma superfície plana exportável.");
  const lines = ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "4", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES"];
  for (const loop of loops) {
    lines.push("0", "LWPOLYLINE", "8", "CORTE", "90", String(loop.length), "70", "1");
    for (const point of loop) {
      lines.push("10", String(point.x), "20", String(point.y));
    }
  }
  lines.push("0", "ENDSEC", "0", "EOF", "");
  return lines.join("\n");
}

