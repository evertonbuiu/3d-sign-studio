import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  ShapeUtils,
  Vector2,
  Vector3,
} from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { Brush, Evaluator, INTERSECTION, SUBTRACTION } from "three-bvh-csg";

export interface SplitPiece {
  geometry: BufferGeometry;
  column: number;
  row: number;
  index: number;
  total: number;
}

export interface BuildPlateSplitOptions {
  width: number;
  depth: number;
  margin?: number;
}

export interface ManualSplitOptions {
  angle: number;
  offset?: number;
  connector?: "none" | "male-female";
  maleSide?: "part-1" | "part-2";
  connectorDepth?: number;
  connectorWidth?: number;
  connectorThickness?: number;
  connectorClearance?: number;
  origin?: { x: number; y: number };
}

export interface SequentialSplitOptions extends ManualSplitOptions {
  id?: string;
}

export function geometryCrossesCutPlane(
  geometry: BufferGeometry,
  options: Pick<ManualSplitOptions, "angle" | "offset" | "origin">,
): boolean {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (!bounds || bounds.isEmpty()) return false;
  const fallback = bounds.getCenter(new Vector3());
  const origin = new Vector3(options.origin?.x ?? fallback.x, options.origin?.y ?? fallback.y, 0);
  const radians = (options.angle * Math.PI) / 180;
  const normal = new Vector3(Math.cos(radians), Math.sin(radians), 0);
  origin.addScaledVector(normal, options.offset ?? 0);
  const distances = [
    new Vector3(bounds.min.x, bounds.min.y, 0),
    new Vector3(bounds.min.x, bounds.max.y, 0),
    new Vector3(bounds.max.x, bounds.min.y, 0),
    new Vector3(bounds.max.x, bounds.max.y, 0),
  ].map((corner) => normal.dot(corner.sub(origin)));
  return Math.min(...distances) < -1e-5 && Math.max(...distances) > 1e-5;
}

/** Recorte visual robusto, sem CSG e sem tampas, usado somente na prévia. */
export function clipGeometryByPlaneForPreview(
  geometry: BufferGeometry,
  options: Pick<ManualSplitOptions, "angle" | "offset">,
): SplitPiece[] {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox?.clone();
  if (!bounds || bounds.isEmpty()) return [];
  const radians = (options.angle * Math.PI) / 180;
  const normal = new Vector3(Math.cos(radians), Math.sin(radians), 0);
  const center = bounds.getCenter(new Vector3()).addScaledVector(normal, options.offset ?? 0);
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = source.getAttribute("position");

  const clipSide = (side: -1 | 1) => {
    const vertices: number[] = [];
    const distance = (point: Vector3) => normal.dot(point.clone().sub(center)) * side;
    for (let i = 0; i + 2 < position.count; i += 3) {
      let polygon = [
        new Vector3(position.getX(i), position.getY(i), position.getZ(i)),
        new Vector3(position.getX(i + 1), position.getY(i + 1), position.getZ(i + 1)),
        new Vector3(position.getX(i + 2), position.getY(i + 2), position.getZ(i + 2)),
      ];
      const clipped: Vector3[] = [];
      for (let edge = 0; edge < polygon.length; edge++) {
        const current = polygon[edge]!;
        const next = polygon[(edge + 1) % polygon.length]!;
        const currentDistance = distance(current);
        const nextDistance = distance(next);
        if (currentDistance >= -1e-6) clipped.push(current.clone());
        if (currentDistance >= 0 !== nextDistance >= 0) {
          const t = currentDistance / (currentDistance - nextDistance);
          clipped.push(current.clone().lerp(next, t));
        }
      }
      polygon = clipped;
      for (let vertex = 1; vertex + 1 < polygon.length; vertex++) {
        vertices.push(
          ...polygon[0]!.toArray(),
          ...polygon[vertex]!.toArray(),
          ...polygon[vertex + 1]!.toArray(),
        );
      }
    }
    const result = new BufferGeometry();
    result.setAttribute("position", new Float32BufferAttribute(vertices, 3));
    result.computeVertexNormals();
    result.computeBoundingBox();
    return result;
  };

  return ([-1, 1] as const)
    .map((side, index) => ({
      geometry: clipSide(side),
      column: side < 0 ? 1 : 2,
      row: 1,
      index: index + 1,
      total: 2,
    }))
    .filter((piece) => piece.geometry.getAttribute("position").count > 0);
}

function evaluateGeometry(
  first: BufferGeometry,
  second: BufferGeometry,
  operation: number,
): BufferGeometry {
  const evaluator = new Evaluator();
  evaluator.attributes = ["position"];
  const a = new Brush(withoutDegenerateTriangles(first));
  const b = new Brush(withoutDegenerateTriangles(second));
  a.updateMatrixWorld(true);
  b.updateMatrixWorld(true);
  const result = evaluator.evaluate(a, b, operation).geometry.clone();
  result.computeVertexNormals();
  result.computeBoundingBox();
  return result;
}

function withoutDegenerateTriangles(geometry: BufferGeometry): BufferGeometry {
  const source = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const position = source.getAttribute("position");
  const vertices: number[] = [];
  const ab = new Vector3();
  const ac = new Vector3();
  const cross = new Vector3();
  const seen = new Set<string>();
  for (let i = 0; i + 2 < position.count; i += 3) {
    const a = new Vector3(position.getX(i), position.getY(i), position.getZ(i));
    const b = new Vector3(position.getX(i + 1), position.getY(i + 1), position.getZ(i + 1));
    const c = new Vector3(position.getX(i + 2), position.getY(i + 2), position.getZ(i + 2));
    if (![...a.toArray(), ...b.toArray(), ...c.toArray()].every(Number.isFinite)) continue;
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    if (cross.crossVectors(ab, ac).lengthSq() <= 1e-12) continue;
    const triangleKey = [a, b, c]
      .map((point) =>
        point
          .toArray()
          .map((value) => Math.round(value * 1e5))
          .join(","),
      )
      .sort()
      .join("|");
    if (seen.has(triangleKey)) continue;
    seen.add(triangleKey);
    vertices.push(...a.toArray(), ...b.toArray(), ...c.toArray());
  }
  const cleaned = new BufferGeometry();
  cleaned.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  cleaned.computeVertexNormals();
  return cleaned;
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

/**
 * Substitui a tampa plana criada pelo CSG por uma triangulacao da secao real.
 * Isso impede que vazios internos de letras (O, A, B etc.) sejam preenchidos.
 */
function rebuildCutCap(
  result: BufferGeometry,
  planePoint: Vector3,
  normal: Vector3,
  side: -1 | 1,
): BufferGeometry {
  const epsilon = 1e-5;
  const tangent = new Vector3(-normal.y, normal.x, 0);
  const planeDistance = normal.dot(planePoint);
  const resultSource = result.index ? result.toNonIndexed() : result;
  const resultPosition = resultSource.getAttribute("position");
  const nodes = new Map<string, Vector3>();
  const edgeCandidates = new Map<string, { edge: [string, string]; count: number }>();
  const keyFor = (point: Vector3) =>
    `${Math.round(point.x / epsilon)},${Math.round(point.y / epsilon)},${Math.round(point.z / epsilon)}`;

  for (let i = 0; i + 2 < resultPosition.count; i += 3) {
    const triangle = [0, 1, 2].map(
      (offset) =>
        new Vector3(
          resultPosition.getX(i + offset),
          resultPosition.getY(i + offset),
          resultPosition.getZ(i + offset),
        ),
    );
    for (let edge = 0; edge < 3; edge++) {
      const a = triangle[edge]!;
      const b = triangle[(edge + 1) % 3]!;
      const da = normal.dot(a) - planeDistance;
      const db = normal.dot(b) - planeDistance;
      if (Math.abs(da) > epsilon || Math.abs(db) > epsilon) continue;
      const aKey = keyFor(a);
      const bKey = keyFor(b);
      if (aKey === bKey) continue;
      nodes.set(aKey, a);
      nodes.set(bKey, b);
      const edgeKey = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
      const candidate = edgeCandidates.get(edgeKey);
      edgeCandidates.set(edgeKey, { edge: [aKey, bKey], count: (candidate?.count ?? 0) + 1 });
    }
  }
  const edges = new Map(
    [...edgeCandidates.entries()]
      .filter(([, candidate]) => candidate.count === 1)
      .map(([key, candidate]) => [key, candidate.edge]),
  );

  const adjacency = new Map<string, string[]>();
  for (const [a, b] of edges.values()) {
    adjacency.set(a, [...(adjacency.get(a) ?? []), b]);
    adjacency.set(b, [...(adjacency.get(b) ?? []), a]);
  }
  const unused = new Set(edges.keys());
  const loops: Vector2[][] = [];
  for (const [startA, startB] of edges.values()) {
    const initialKey = startA < startB ? `${startA}|${startB}` : `${startB}|${startA}`;
    if (!unused.has(initialKey)) continue;
    const loopKeys = [startA];
    let previous = startA;
    let current = startB;
    unused.delete(initialKey);
    while (current !== startA && loopKeys.length <= edges.size + 1) {
      loopKeys.push(current);
      const next = (adjacency.get(current) ?? []).find((candidate) => {
        if (candidate === previous) return false;
        const key = current < candidate ? `${current}|${candidate}` : `${candidate}|${current}`;
        return unused.has(key);
      });
      if (!next) break;
      const key = current < next ? `${current}|${next}` : `${next}|${current}`;
      unused.delete(key);
      previous = current;
      current = next;
    }
    if (current !== startA || loopKeys.length < 3) continue;
    loops.push(loopKeys.map((key) => new Vector2(tangent.dot(nodes.get(key)!), nodes.get(key)!.z)));
  }

  const loopInfo = loops
    .map((points, index) => ({ points, index, area: Math.abs(ShapeUtils.area(points)), parent: -1 }))
    .filter((loop) => loop.area > epsilon * epsilon);
  for (const loop of loopInfo) {
    let parentArea = Number.POSITIVE_INFINITY;
    for (const candidate of loopInfo) {
      if (candidate.index === loop.index || candidate.area <= loop.area) continue;
      if (pointInPolygon(loop.points[0]!, candidate.points) && candidate.area < parentArea) {
        loop.parent = candidate.index;
        parentArea = candidate.area;
      }
    }
  }
  const depthOf = (loop: (typeof loopInfo)[number]) => {
    let depth = 0;
    let parent = loop.parent;
    while (parent >= 0) {
      depth++;
      parent = loopInfo.find((candidate) => candidate.index === parent)?.parent ?? -1;
    }
    return depth;
  };
  const capVertices: number[] = [];
  for (const outer of loopInfo.filter((loop) => depthOf(loop) % 2 === 0)) {
    const holes = loopInfo
      .filter((loop) => loop.parent === outer.index && depthOf(loop) % 2 === 1)
      .map((loop) => loop.points);
    const allPoints = [...outer.points, ...holes.flat()];
    for (const face of ShapeUtils.triangulateShape(outer.points, holes)) {
      const ordered = side < 0 ? face : [face[0]!, face[2]!, face[1]!];
      for (const index of ordered) {
        if (index === undefined) continue;
        const point = allPoints[index]!;
        capVertices.push(
          tangent.x * point.x + normal.x * planeDistance,
          tangent.y * point.x + normal.y * planeDistance,
          point.y,
        );
      }
    }
  }

  const kept: number[] = [];
  for (let i = 0; i + 2 < resultPosition.count; i += 3) {
    const distances = [0, 1, 2].map(
      (offset) =>
        normal.x * resultPosition.getX(i + offset) +
        normal.y * resultPosition.getY(i + offset) -
        planeDistance,
    );
    if (distances.every((distance) => Math.abs(distance) <= epsilon)) continue;
    for (const offset of [0, 1, 2]) {
      kept.push(
        resultPosition.getX(i + offset),
        resultPosition.getY(i + offset),
        resultPosition.getZ(i + offset),
      );
    }
  }
  const rebuilt = new BufferGeometry();
  rebuilt.setAttribute("position", new Float32BufferAttribute([...kept, ...capVertices], 3));
  const welded = mergeVertices(withoutDegenerateTriangles(rebuilt), epsilon);
  welded.computeVertexNormals();
  welded.computeBoundingBox();
  return welded;
}

function clipGeometryHalf(
  geometry: BufferGeometry,
  planePoint: Vector3,
  normal: Vector3,
  side: -1 | 1,
): BufferGeometry {
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = source.getAttribute("position");
  const vertices: number[] = [];
  const distance = (point: Vector3) => normal.dot(point.clone().sub(planePoint)) * side;
  for (let i = 0; i + 2 < position.count; i += 3) {
    let polygon = [0, 1, 2].map(
      (offset) =>
        new Vector3(
          position.getX(i + offset),
          position.getY(i + offset),
          position.getZ(i + offset),
        ),
    );
    const clipped: Vector3[] = [];
    for (let edge = 0; edge < polygon.length; edge++) {
      const current = polygon[edge]!;
      const next = polygon[(edge + 1) % polygon.length]!;
      const currentDistance = distance(current);
      const nextDistance = distance(next);
      if (currentDistance >= -1e-7) clipped.push(current.clone());
      if (currentDistance >= 0 !== nextDistance >= 0) {
        clipped.push(current.clone().lerp(next, currentDistance / (currentDistance - nextDistance)));
      }
    }
    polygon = clipped;
    for (let vertex = 1; vertex + 1 < polygon.length; vertex++) {
      vertices.push(...polygon[0]!.toArray(), ...polygon[vertex]!.toArray(), ...polygon[vertex + 1]!.toArray());
    }
  }
  const clipped = new BufferGeometry();
  clipped.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  return clipped;
}

function extrudeCutSection(
  geometry: BufferGeometry,
  planePoint: Vector3,
  normal: Vector3,
  direction: Vector3,
  depth: number,
  minZ: number,
  maxZ: number,
  wallFraction: number,
): BufferGeometry {
  const epsilon = 1e-5;
  const planeDistance = normal.dot(planePoint);
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = source.getAttribute("position");
  const surfaceTriangles: Array<[Vector3, Vector3, Vector3]> = [];

  const clipZ = (polygon: Vector3[], limit: number, keepAbove: boolean) => {
    const clipped: Vector3[] = [];
    for (let index = 0; index < polygon.length; index++) {
      const current = polygon[index]!;
      const next = polygon[(index + 1) % polygon.length]!;
      const currentInside = keepAbove ? current.z >= limit - epsilon : current.z <= limit + epsilon;
      const nextInside = keepAbove ? next.z >= limit - epsilon : next.z <= limit + epsilon;
      if (currentInside) clipped.push(current.clone());
      if (currentInside !== nextInside) {
        const ratio = (limit - current.z) / (next.z - current.z);
        clipped.push(current.clone().lerp(next, ratio));
      }
    }
    return clipped;
  };

  for (let i = 0; i + 2 < position.count; i += 3) {
    let polygon = [0, 1, 2].map(
      (offset) =>
        new Vector3(position.getX(i + offset), position.getY(i + offset), position.getZ(i + offset)),
    );
    if (!polygon.every((point) => Math.abs(normal.dot(point) - planeDistance) <= epsilon)) continue;
    polygon = clipZ(polygon, minZ, true);
    polygon = clipZ(polygon, maxZ, false);
    for (let vertex = 1; vertex + 1 < polygon.length; vertex++) {
      surfaceTriangles.push([polygon[0]!, polygon[vertex]!, polygon[vertex + 1]!]);
    }
  }

  // Cada ilha da secao representa uma parede atravessada pelo plano. As ilhas
  // sao pareadas na ordem transversal e as metades ficam voltadas uma para a
  // outra. Isso identifica o interior local de cada letra, sem usar o centro
  // global da palavra (que invertia paredes em letras deslocadas).
  const tangent = new Vector3(-normal.y, normal.x, 0);
  const parent = surfaceTriangles.map((_, index) => index);
  const find = (value: number): number => {
    while (parent[value] !== value) {
      parent[value] = parent[parent[value]!]!;
      value = parent[value]!;
    }
    return value;
  };
  const union = (a: number, b: number) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootA] = rootB;
  };
  const vertexOwners = new Map<string, number>();
  const vertexKey = (point: Vector3) =>
    point.toArray().map((value) => Math.round(value * 1e5)).join(",");
  surfaceTriangles.forEach((triangle, triangleIndex) => {
    for (const point of triangle) {
      const key = vertexKey(point);
      const owner = vertexOwners.get(key);
      if (owner !== undefined) union(triangleIndex, owner);
      else vertexOwners.set(key, triangleIndex);
    }
  });
  const groups = new Map<number, Array<[Vector3, Vector3, Vector3]>>();
  surfaceTriangles.forEach((triangle, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), triangle]);
  });
  const connectorTriangles: Array<[Vector3, Vector3, Vector3]> = [];
  const fraction = Math.min(Math.max(wallFraction, 0.1), 1);
  const sections = [...groups.values()]
    .map((triangles) => {
      const coordinates = triangles.flat().map((point) => tangent.dot(point));
      const minT = Math.min(...coordinates);
      const maxT = Math.max(...coordinates);
      return { triangles, minT, maxT, centerT: (minT + maxT) / 2 };
    })
    .sort((a, b) => a.centerT - b.centerT);
  for (const [sectionIndex, section] of sections.entries()) {
    const { triangles, minT, maxT, centerT } = section;
    const keepAbove = sections.length % 2 === 0
      ? sectionIndex % 2 === 0
      : centerT < tangent.dot(planePoint);
    const limit = keepAbove ? maxT - (maxT - minT) * fraction : minT + (maxT - minT) * fraction;
    for (const triangle of triangles) {
      let polygon = triangle.map((point) => point.clone());
      const clipped: Vector3[] = [];
      for (let index = 0; index < polygon.length; index++) {
        const current = polygon[index]!;
        const next = polygon[(index + 1) % polygon.length]!;
        const currentT = tangent.dot(current);
        const nextT = tangent.dot(next);
        const currentInside = keepAbove ? currentT >= limit - epsilon : currentT <= limit + epsilon;
        const nextInside = keepAbove ? nextT >= limit - epsilon : nextT <= limit + epsilon;
        if (currentInside) clipped.push(current.clone());
        if (currentInside !== nextInside) {
          clipped.push(current.clone().lerp(next, (limit - currentT) / (nextT - currentT)));
        }
      }
      polygon = clipped;
      for (let vertex = 1; vertex + 1 < polygon.length; vertex++) {
        connectorTriangles.push([polygon[0]!, polygon[vertex]!, polygon[vertex + 1]!]);
      }
    }
  }

  const faces = new Map<string, { vertices: number[]; count: number }>();
  const addFace = (a: Vector3, b: Vector3, c: Vector3) => {
    const vertices = [...a.toArray(), ...b.toArray(), ...c.toArray()];
    const key = [a, b, c]
      .map((point) => point.toArray().map((value) => Math.round(value * 1e5)).join(","))
      .sort()
      .join("|");
    const existing = faces.get(key);
    faces.set(key, { vertices, count: (existing?.count ?? 0) + 1 });
  };
  const extension = direction.clone().multiplyScalar(depth);
  for (const [a, b, c] of connectorTriangles) {
    const aa = a.clone().add(extension);
    const bb = b.clone().add(extension);
    const cc = c.clone().add(extension);
    addFace(a, c, b);
    addFace(aa, bb, cc);
    for (const [start, end, endTop, startTop] of [
      [a, b, bb, aa],
      [b, c, cc, bb],
      [c, a, aa, cc],
    ] as const) {
      addFace(start, end, endTop);
      addFace(start, endTop, startTop);
    }
  }
  const vertices = [...faces.values()]
    .filter((face) => face.count === 1)
    .flatMap((face) => face.vertices);
  const result = new BufferGeometry();
  result.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  const welded = mergeVertices(withoutDegenerateTriangles(result), epsilon);
  welded.computeVertexNormals();
  welded.computeBoundingBox();
  return welded;
}

/** Divide uma malha por um plano vertical rotacionado em torno do eixo Z. */
export function splitGeometryByPlane(
  geometry: BufferGeometry,
  options: ManualSplitOptions,
): SplitPiece[] {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox?.clone();
  if (!bounds || bounds.isEmpty()) return [];
  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  if (options.origin) center.set(options.origin.x, options.origin.y, center.z);
  const radians = (options.angle * Math.PI) / 180;
  const normal = new Vector3(Math.cos(radians), Math.sin(radians), 0);
  center.addScaledVector(normal, options.offset ?? 0);
  const pieces: SplitPiece[] = [];

  for (const side of [-1, 1] as const) {
    let result = clipGeometryHalf(geometry, center, normal, side);
    result = rebuildCutCap(result, center, normal, side);
    result.computeVertexNormals();
    result.computeBoundingBox();
    const resultSize = result.boundingBox?.getSize(new Vector3());
    if (!resultSize || result.getAttribute("position").count === 0) continue;
    if (resultSize.x < 1e-5 || resultSize.y < 1e-5 || resultSize.z < 1e-5) continue;
    pieces.push({
      geometry: result,
      column: side < 0 ? 1 : 2,
      row: 1,
      index: pieces.length + 1,
      total: 2,
    });
  }
  if (pieces.length !== 2 || options.connector !== "male-female") {
    return pieces.map((piece) => ({ ...piece, total: pieces.length }));
  }

  const depth = Math.max(options.connectorDepth ?? 4, 0.4);
  const clearance = Math.max(options.connectorClearance ?? 0.2, 0);
  const widthPercent = Math.min(Math.max(options.connectorWidth ?? 60, 10), 100) * 0.01;
  const maleIndex = options.maleSide === "part-2" ? 1 : 0;
  const femaleIndex = maleIndex === 0 ? 1 : 0;
  const direction = normal.clone().multiplyScalar(maleIndex === 0 ? 1 : -1);

  // O encaixe é extraído da própria seção das paredes junto ao plano de corte.
  // Assim, a metade macho prolonga o perfil real da parede em vez de receber
  // apenas um pino retangular isolado.
  // O macho usa a metade interna da espessura e percorre toda a parede,
  // desde o fundo ate a frente. A metade externa permanece como ombro.
  const overlap = Math.min(0.5, depth * 0.2);
  const maleConnector = extrudeCutSection(
    pieces[maleIndex]!.geometry,
    center,
    normal,
    direction,
    depth + overlap,
    bounds.min.z,
    bounds.max.z,
    widthPercent,
  );
  if (maleConnector.getAttribute("position").count === 0) {
    return pieces.map((piece) => ({ ...piece, total: pieces.length }));
  }
  maleConnector.translate(-direction.x * overlap, -direction.y * overlap, 0);

  // Expande uma única cópia do perfil nos eixos normal, tangente e Z. Uma
  // única subtração é mais estável em contornos complexos do que unir ou
  // subtrair várias cópias quase coincidentes.
  const femaleCavity = maleConnector.clone();
  if (clearance > 0) {
    femaleCavity.computeBoundingBox();
    const cavityCenter = femaleCavity.boundingBox!.getCenter(new Vector3());
    const cavityPosition = femaleCavity.getAttribute("position");
    let tangentExtent = 0;
    for (let i = 0; i < cavityPosition.count; i++) {
      const point = new Vector3(
        cavityPosition.getX(i),
        cavityPosition.getY(i),
        cavityPosition.getZ(i),
      );
      const tangent = new Vector3(-normal.y, normal.x, 0);
      tangentExtent = Math.max(tangentExtent, Math.abs(tangent.dot(point.clone().sub(cavityCenter))));
    }
    const normalScale = (depth + clearance * 2) / depth;
    const tangentScale = tangentExtent > 1e-6 ? (tangentExtent + clearance) / tangentExtent : 1;
    const zScale = (size.z + clearance * 2) / size.z;
    for (let i = 0; i < cavityPosition.count; i++) {
      const relative = new Vector3(
        cavityPosition.getX(i) - cavityCenter.x,
        cavityPosition.getY(i) - cavityCenter.y,
        cavityPosition.getZ(i) - cavityCenter.z,
      );
      const tangent = new Vector3(-normal.y, normal.x, 0);
      const normalDistance = normal.dot(relative) * normalScale;
      const tangentDistance = tangent.dot(relative) * tangentScale;
      cavityPosition.setXYZ(
        i,
        cavityCenter.x + normal.x * normalDistance + tangent.x * tangentDistance,
        cavityCenter.y + normal.y * normalDistance + tangent.y * tangentDistance,
        cavityCenter.z + relative.z * zScale,
      );
    }
    cavityPosition.needsUpdate = true;
    femaleCavity.computeVertexNormals();
  }

  // A lingueta já penetra a parede pelo `overlap`. Concatenar as duas cascas
  // preserva esse volume sobreposto para o fatiador e evita a união CSG entre
  // faces coplanares, que criava pontas/triângulos atravessando letras inteiras.
  const mergedMale = mergeGeometries(
    [
      withoutDegenerateTriangles(pieces[maleIndex]!.geometry),
      withoutDegenerateTriangles(maleConnector),
    ],
    false,
  );
  if (!mergedMale) throw new Error("Falha ao montar o rebaixo prolongado da peça macho");
  mergedMale.computeVertexNormals();
  mergedMale.computeBoundingBox();
  pieces[maleIndex] = { ...pieces[maleIndex]!, geometry: mergedMale };
  let femaleGeometry: BufferGeometry;
  try {
    femaleGeometry = evaluateGeometry(pieces[femaleIndex]!.geometry, femaleCavity, SUBTRACTION);
  } catch (error) {
    throw new Error("Falha ao abrir a cavidade fêmea", { cause: error });
  }
  pieces[femaleIndex] = { ...pieces[femaleIndex]!, geometry: femaleGeometry };
  return pieces.map((piece) => ({ ...piece, total: pieces.length }));
}

/** Aplica vários planos sobre as peças resultantes, preservando a origem do modelo. */
export function splitGeometryByPlanes(
  geometry: BufferGeometry,
  cuts: SequentialSplitOptions[],
  origin?: { x: number; y: number },
): SplitPiece[] {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox?.clone();
  if (!bounds || bounds.isEmpty()) return [];
  const center = bounds.getCenter(new Vector3());
  if (origin) center.set(origin.x, origin.y, center.z);
  let geometries = [geometry.clone()];
  for (const cut of cuts) {
    const next: BufferGeometry[] = [];
    for (const candidate of geometries) {
      const split = splitGeometryByPlane(candidate, {
        ...cut,
        origin: { x: center.x, y: center.y },
      });
      if (split.length === 2) next.push(...split.map((piece) => piece.geometry));
      else next.push(candidate);
    }
    geometries = next;
  }
  return geometries.map((piece, index) => ({
    geometry: piece,
    column: index + 1,
    row: 1,
    index: index + 1,
    total: geometries.length,
  }));
}

/** Divide uma malha em blocos fechados que cabem na área útil XY da impressora. */
export function splitGeometryForBuildPlate(
  geometry: BufferGeometry,
  options: BuildPlateSplitOptions,
): SplitPiece[] {
  const margin = Math.max(options.margin ?? 0, 0);
  const usableWidth = options.width - margin * 2;
  const usableDepth = options.depth - margin * 2;
  if (usableWidth <= 0 || usableDepth <= 0) {
    throw new Error("A margem de corte é maior que a mesa de impressão.");
  }
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox?.clone();
  if (!bounds || bounds.isEmpty()) return [];
  const size = bounds.getSize(new Vector3());
  const columns = Math.max(1, Math.ceil(size.x / usableWidth));
  const rows = Math.max(1, Math.ceil(size.y / usableDepth));
  if (columns === 1 && rows === 1) {
    return [{ geometry: geometry.clone(), column: 1, row: 1, index: 1, total: 1 }];
  }
  const sourceGeometry = geometry.clone();
  const source = new Brush(sourceGeometry);
  source.updateMatrixWorld(true);
  const evaluator = new Evaluator();
  evaluator.attributes = ["position"];
  const pieces: Omit<SplitPiece, "total">[] = [];
  const zPadding = Math.max(size.z, 1) + 2;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const minX = bounds.min.x + column * usableWidth;
      const minY = bounds.min.y + row * usableDepth;
      const maxX = Math.min(minX + usableWidth, bounds.max.x);
      const maxY = Math.min(minY + usableDepth, bounds.max.y);
      const cell = new Box3(
        new Vector3(minX, minY, bounds.min.z - 1),
        new Vector3(maxX, maxY, bounds.max.z + 1),
      );
      const cellSize = cell.getSize(new Vector3());
      const cutterGeometry = new BoxGeometry(cellSize.x, cellSize.y, zPadding);
      cutterGeometry.translate(...cell.getCenter(new Vector3()).toArray());
      const cutter = new Brush(cutterGeometry);
      cutter.updateMatrixWorld(true);
      const result = evaluator.evaluate(source, cutter, INTERSECTION);
      const clipped = result.geometry.clone();
      clipped.computeVertexNormals();
      clipped.computeBoundingBox();
      const clippedSize = clipped.boundingBox?.getSize(new Vector3());
      if (!clippedSize || clipped.getAttribute("position").count === 0) continue;
      if (clippedSize.x < 1e-5 || clippedSize.y < 1e-5 || clippedSize.z < 1e-5) continue;
      pieces.push({
        geometry: clipped,
        column: column + 1,
        row: row + 1,
        index: pieces.length + 1,
      });
    }
  }
  return pieces.map((piece) => ({ ...piece, total: pieces.length }));
}
