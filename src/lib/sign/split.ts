import {
  BufferGeometry,
  Float32BufferAttribute,
  ShapeUtils,
  Vector2,
  Vector3,
} from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

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
  connectorBackInset?: number;
  connectorFrontInset?: number;
  origin?: { x: number; y: number };
}

export interface SequentialSplitOptions extends ManualSplitOptions {
  id?: string;
}

/** Seleciona onde o encaixe estrutural pode ser criado em cada estilo. */
export function partSupportsCutConnector(kind: string, styleHasWalls: boolean): boolean {
  if (styleHasWalls) return kind === "laterais";
  return ["fundo", "frente", "placa", "poste", "camada-2", "camada-3"].includes(kind);
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

/** Recorte visual robusto, sem CSG e sem tampas, usado somente na prÃ©via. */
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

function weldShellByPosition(geometry: BufferGeometry, tolerance = 1e-3): BufferGeometry {
  const shell = withoutDegenerateTriangles(geometry);
  // A soldagem deve usar somente posição; normais diferentes nas quinas
  // impedem que vértices coincidentes da parede e do encaixe sejam unidos.
  for (const attribute of Object.keys(shell.attributes)) {
    if (attribute !== "position") shell.deleteAttribute(attribute);
  }
  const welded = mergeVertices(shell, tolerance);
  welded.computeVertexNormals();
  welded.computeBoundingBox();
  return welded;
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

interface WallProfile {
  minT: number;
  maxT: number;
  centerT: number;
}

function wallProfilesAtPlane(
  geometry: BufferGeometry,
  planePoint: Vector3,
  normal: Vector3,
): WallProfile[] {
  const epsilon = 1e-5;
  const tangent = new Vector3(-normal.y, normal.x, 0);
  const planeDistance = normal.dot(planePoint);
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = source.getAttribute("position");
  const coordinates: number[] = [];
  for (let index = 0; index + 2 < position.count; index += 3) {
    const triangle = [0, 1, 2].map((offset) =>
      new Vector3(position.getX(index + offset), position.getY(index + offset), position.getZ(index + offset)));
    const zValues = triangle.map((point) => point.z);
    if (Math.max(...zValues) - Math.min(...zValues) <= epsilon) continue;
    for (let edge = 0; edge < 3; edge++) {
      const start = triangle[edge]!;
      const end = triangle[(edge + 1) % 3]!;
      const startDistance = normal.dot(start) - planeDistance;
      const endDistance = normal.dot(end) - planeDistance;
      if (Math.abs(startDistance) <= epsilon) coordinates.push(tangent.dot(start));
      if (startDistance * endDistance < -epsilon * epsilon) {
        const ratio = startDistance / (startDistance - endDistance);
        coordinates.push(tangent.dot(start.clone().lerp(end, ratio)));
      }
    }
  }
  const coordinateCounts = new Map<number, number>();
  for (const coordinate of coordinates) {
    const rounded = Math.round(coordinate * 1e4) / 1e4;
    coordinateCounts.set(rounded, (coordinateCounts.get(rounded) ?? 0) + 1);
  }
  // Uma parede realmente atravessada pelo plano produz a mesma linha em mais
  // de um triangulo vertical. Contatos tangenciais aparecem apenas uma vez e,
  // se entrarem no pareamento, deslocam todos os intervalos seguintes e fecham
  // o vazio da letra com placas largas.
  const confirmed = [...coordinateCounts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([coordinate]) => coordinate)
    .sort((a, b) => a - b);
  const unique = confirmed.length >= 2
    ? confirmed
    : [...coordinateCounts.keys()].sort((a, b) => a - b);
  const profiles: WallProfile[] = [];
  // A uniÃ£o da frente com as laterais pode conservar uma linha intermediÃ¡ria
  // dentro da mesma parede. Por isso cada parede pode aparecer com duas ou trÃªs
  // linhas. Particionamos a sequÃªncia procurando os grupos locais mais estreitos,
  // em vez de parear cegamente de dois em dois e atravessar o vazio seguinte.
  const costs = Array(unique.length + 1).fill(Number.POSITIVE_INFINITY);
  const groupSizes = Array<number>(unique.length + 1).fill(0);
  costs[unique.length] = 0;
  for (let index = unique.length - 1; index >= 0; index--) {
    for (const groupSize of [2, 3]) {
      const next = index + groupSize;
      if (next > unique.length || !Number.isFinite(costs[next])) continue;
      const span = unique[next - 1]! - unique[index]!;
      // Uma linha isolada pode ser uma tangÃªncia ou uma aresta residual da
      // uniÃ£o. O custo equivale a uma parede de 5 mm: preferimos agrupamentos
      // locais reais, mas descartamos a sobra antes de cruzar um vazio grande.
      const cost = span * span + costs[next]!;
      if (cost < costs[index]!) {
        costs[index] = cost;
        groupSizes[index] = groupSize;
      }
    }
  }
  for (let index = 0; index < unique.length && groupSizes[index]! > 0;) {
    const groupSize = groupSizes[index]!;
    const minT = unique[index]!;
    const maxT = unique[index + groupSize - 1]!;
    profiles.push({ minT, maxT, centerT: (minT + maxT) / 2 });
    index += groupSize;
  }
  return profiles;
}

function surfaceProfilesAtPlane(
  geometry: BufferGeometry,
  planePoint: Vector3,
  normal: Vector3,
  z: number,
): WallProfile[] {
  const epsilon = 1e-4;
  const tangent = new Vector3(-normal.y, normal.x, 0);
  const planeDistance = normal.dot(planePoint);
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = source.getAttribute("position");
  const intervals: Array<[number, number]> = [];
  for (let index = 0; index + 2 < position.count; index += 3) {
    const triangle = [0, 1, 2].map((offset) =>
      new Vector3(position.getX(index + offset), position.getY(index + offset), position.getZ(index + offset)));
    if (!triangle.every((point) => Math.abs(point.z - z) <= epsilon)) continue;
    const intersections: number[] = [];
    for (let edge = 0; edge < 3; edge++) {
      const start = triangle[edge]!;
      const end = triangle[(edge + 1) % 3]!;
      const startDistance = normal.dot(start) - planeDistance;
      const endDistance = normal.dot(end) - planeDistance;
      if (Math.abs(startDistance) <= epsilon) intersections.push(tangent.dot(start));
      if (startDistance * endDistance < -epsilon * epsilon) {
        intersections.push(tangent.dot(start.clone().lerp(end, startDistance / (startDistance - endDistance))));
      }
    }
    if (intersections.length >= 2) {
      const minT = Math.min(...intersections);
      const maxT = Math.max(...intersections);
      if (maxT - minT > epsilon) intervals.push([minT, maxT]);
    }
  }
  intervals.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && interval[0] <= previous[1] + epsilon) previous[1] = Math.max(previous[1], interval[1]);
    else merged.push([...interval]);
  }
  return merged.map(([minT, maxT]) => ({ minT, maxT, centerT: (minT + maxT) / 2 }));
}

function capProfiles(
  profiles: WallProfile[],
  planePoint: Vector3,
  normal: Vector3,
  minZ: number,
  maxZ: number,
): BufferGeometry {
  const tangent = new Vector3(-normal.y, normal.x, 0);
  const planeDistance = normal.dot(planePoint);
  const at = (coordinate: number, z: number) =>
    tangent.clone().multiplyScalar(coordinate).addScaledVector(normal, planeDistance).setZ(z);
  const vertices: number[] = [];
  for (const profile of profiles) {
    const a = at(profile.minT, minZ), b = at(profile.maxT, minZ);
    const c = at(profile.maxT, maxZ), d = at(profile.minT, maxZ);
    vertices.push(
      ...a.toArray(),
      ...b.toArray(),
      ...c.toArray(),
      ...a.toArray(),
      ...c.toArray(),
      ...d.toArray(),
    );
  }
  const cap = new BufferGeometry();
  cap.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  cap.computeVertexNormals();
  return cap;
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
  selectInner = true,
  capOnly = false,
  followGeometry?: BufferGeometry,
  preserveSectionProfile = false,
): BufferGeometry {
  const epsilon = 1e-5;
  const planeDistance = normal.dot(planePoint);
  const tangent = new Vector3(-normal.y, normal.x, 0);
  const surfaceTriangles: Array<[Vector3, Vector3, Vector3]> = [];

  // As intersecoes das faces verticais fornecem diretamente um intervalo
  // independente para cada parede atravessada pelo plano.
  const profileSections = wallProfilesAtPlane(followGeometry ?? geometry, planePoint, normal);
  if (!preserveSectionProfile && profileSections.length && maxZ > minZ + epsilon) {
    const at = (coordinate: number, z: number) =>
      tangent.clone().multiplyScalar(coordinate).addScaledVector(normal, planeDistance).setZ(z);
    for (const profile of profileSections) {
      const a = at(profile.minT, minZ);
      const b = at(profile.maxT, minZ);
      const c = at(profile.maxT, maxZ);
      const d = at(profile.minT, maxZ);
      surfaceTriangles.push([a, b, c], [a, c, d]);
    }
  }

  // Cada ilha da secao representa uma parede atravessada pelo plano.
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
  if (preserveSectionProfile) {
    // Um rebaixo cria juncoes em T: a faixa estreita da frente encosta na
    // parede principal, mas sua borda termina no meio do triangulo inferior.
    // Como nao ha vertices identicos nessa emenda, una tambem triangulos cujas
    // projecoes (tangente/Z) se tocam. Assim todo o degrau continua sendo uma
    // unica secao de parede, sem transformar cada nivel em um encaixe separado.
    const bounds2d = surfaceTriangles.map((triangle) => {
      const transverse = triangle.map((point) => tangent.dot(point));
      const vertical = triangle.map((point) => point.z);
      return {
        minT: Math.min(...transverse),
        maxT: Math.max(...transverse),
        minZ: Math.min(...vertical),
        maxZ: Math.max(...vertical),
      };
    });
    for (let left = 0; left < bounds2d.length; left++) {
      for (let right = left + 1; right < bounds2d.length; right++) {
        const a = bounds2d[left]!;
        const b = bounds2d[right]!;
        const transverseOverlap = Math.min(a.maxT, b.maxT) - Math.max(a.minT, b.minT);
        const verticalOverlap = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
        if (transverseOverlap > epsilon && verticalOverlap >= -epsilon) union(left, right);
      }
    }
  }
  const groups = new Map<number, Array<[Vector3, Vector3, Vector3]>>();
  surfaceTriangles.forEach((triangle, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), triangle]);
  });
  const connectorTriangles: Array<[Vector3, Vector3, Vector3]> = [];
  const fraction = Math.min(Math.max(wallFraction, 0), 1);
  if (fraction <= 1e-6) return new BufferGeometry();
  const sections = [...groups.values()]
    .map((triangles) => {
      const coordinates = triangles.flat().map((point) => tangent.dot(point));
      const minT = Math.min(...coordinates);
      const maxT = Math.max(...coordinates);
      return { triangles, minT, maxT, centerT: (minT + maxT) / 2 };
    })
    .sort((a, b) => a.centerT - b.centerT);
  const targetProfiles = followGeometry
    ? wallProfilesAtPlane(
        followGeometry,
        planePoint.clone().add(direction.clone().multiplyScalar(depth)),
        normal,
      )
    : [];
  for (const [sectionIndex, section] of sections.entries()) {
    const { triangles, minT, maxT, centerT } = section;
    const innerAbove = sections.length % 2 === 0
      ? sectionIndex % 2 === 0
      : centerT < tangent.dot(planePoint);
    const keepAbove = selectInner ? innerAbove : !innerAbove;
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

  if (capOnly) {
    const cap = new BufferGeometry();
    cap.setAttribute(
      "position",
      new Float32BufferAttribute(
        connectorTriangles.flatMap((triangle) => triangle.flatMap((point) => point.toArray())),
        3,
      ),
    );
    return cap;
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
  for (const [a, b, c] of connectorTriangles) {
    const sourceCenter = tangent.dot(a.clone().add(b).add(c).multiplyScalar(1 / 3));
    const nearestSectionIndex = sections.reduce(
      (best, section, index) =>
        Math.abs(section.centerT - sourceCenter) < Math.abs(sections[best]!.centerT - sourceCenter)
          ? index
          : best,
      0,
    );
    const sourceSectionCenter = sections[nearestSectionIndex]!.centerT;
    // Quando a quantidade de paredes permanece igual, a ordem transversal Ã©
    // a correspondÃªncia topolÃ³gica correta. Escolher apenas pela proximidade
    // podia ligar uma parede Ã  vizinha em curvas apertadas e criar espigÃµes.
    const targetProfile = targetProfiles.length === sections.length
      ? targetProfiles[nearestSectionIndex]
      : targetProfiles.reduce<WallProfile | undefined>(
          (best, candidate) =>
            best === undefined ||
            Math.abs(candidate.centerT - sourceSectionCenter) <
              Math.abs(best.centerT - sourceSectionCenter)
              ? candidate
              : best,
          undefined,
        );
    const projectToTarget = (point: Vector3) => {
      const result = point.clone().addScaledVector(direction, depth);
      if (!targetProfile) return result;
      // No perfil escalonado, preserve cada largura local do rebaixo. Apenas
      // desloque a secao pelo centro da parede encontrado na profundidade de
      // destino; redimensionar todos os vertices pela largura total eliminava
      // o degrau frontal e recriava uma lingueta retangular independente.
      if (preserveSectionProfile) {
        return result.addScaledVector(tangent, targetProfile.centerT - sourceSectionCenter);
      }
      const sourceWidth = sections[nearestSectionIndex]!.maxT - sections[nearestSectionIndex]!.minT;
      const ratio = sourceWidth > epsilon
        ? (tangent.dot(point) - sections[nearestSectionIndex]!.minT) / sourceWidth
        : 0.5;
      const targetT = targetProfile.minT + ratio * (targetProfile.maxT - targetProfile.minT);
      return result.addScaledVector(tangent, targetT - tangent.dot(point));
    };
    const aa = projectToTarget(a);
    const bb = projectToTarget(b);
    const cc = projectToTarget(c);
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

function reverseTriangleWinding(geometry: BufferGeometry): BufferGeometry {
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = source.getAttribute("position");
  const vertices: number[] = [];
  for (let index = 0; index + 2 < position.count; index += 3) {
    for (const offset of [0, 2, 1]) {
      vertices.push(
        position.getX(index + offset),
        position.getY(index + offset),
        position.getZ(index + offset),
      );
    }
  }
  const result = new BufferGeometry();
  result.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  return result;
}

function replaceExactPlanarCap(
  geometry: BufferGeometry,
  replacement: BufferGeometry,
  planePoint: Vector3,
  normal: Vector3,
): BufferGeometry {
  const epsilon = 1e-4;
  const planeDistance = normal.dot(planePoint);
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = source.getAttribute("position");
  const vertices: number[] = [];
  for (let index = 0; index + 2 < position.count; index += 3) {
    const planar = [0, 1, 2].every((offset) =>
      Math.abs(
        normal.x * position.getX(index + offset) +
          normal.y * position.getY(index + offset) -
          planeDistance,
      ) <= epsilon);
    if (planar) continue;
    for (const offset of [0, 1, 2]) {
      vertices.push(
        position.getX(index + offset),
        position.getY(index + offset),
        position.getZ(index + offset),
      );
    }
  }
  const replacementPosition = replacement.getAttribute("position");
  if (replacementPosition) {
    for (let index = 0; index < replacementPosition.count; index++) {
      vertices.push(
        replacementPosition.getX(index),
        replacementPosition.getY(index),
        replacementPosition.getZ(index),
      );
    }
  }
  const result = new BufferGeometry();
  result.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  return result;
}

function extractExactPlanarCapRange(
  geometry: BufferGeometry,
  planePoint: Vector3,
  normal: Vector3,
  minZ: number,
  maxZ: number,
): BufferGeometry {
  const epsilon = 1e-5;
  const planeDistance = normal.dot(planePoint);
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = source.getAttribute("position");
  const vertices: number[] = [];
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
  for (let index = 0; index + 2 < position.count; index += 3) {
    let polygon = [0, 1, 2].map((offset) =>
      new Vector3(position.getX(index + offset), position.getY(index + offset), position.getZ(index + offset)));
    if (!polygon.every((point) => Math.abs(normal.dot(point) - planeDistance) <= epsilon)) continue;
    polygon = clipZ(polygon, minZ, true);
    polygon = clipZ(polygon, maxZ, false);
    for (let vertex = 1; vertex + 1 < polygon.length; vertex++) {
      vertices.push(...polygon[0]!.toArray(), ...polygon[vertex]!.toArray(), ...polygon[vertex + 1]!.toArray());
    }
  }
  const result = new BufferGeometry();
  result.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  return result;
}

/** Divide uma malha por um plano vertical rotacionado em torno do eixo Z. */
export function splitGeometryByPlane(
  geometry: BufferGeometry,
  options: ManualSplitOptions,
): SplitPiece[] {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox?.clone();
  if (!bounds || bounds.isEmpty()) return [];
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

  // O encaixe Ã© extraÃ­do da prÃ³pria seÃ§Ã£o das paredes junto ao plano de corte.
  // Assim, a metade macho prolonga o perfil real da parede em vez de receber
  // apenas um pino retangular isolado.
  // O macho usa a metade externa da espessura e percorre toda a parede,
  // preservando uma pele fina no fundo e na frente para fechar as extremidades.
  // A extensão começa exatamente no plano para compartilhar a mesma borda da
  // parede. O antigo volume de sobreposição deixava a lingueta como um sólido
  // separado dentro da peça original.
  const overlap = 0;
  // Sem placa unificada, o encaixe alcança os limites do fundo e da frente.
  const closureSeam = 1e-3;
  const backClosure = Math.max(options.connectorBackInset ?? 0, closureSeam);
  const frontClosure = Math.max(options.connectorFrontInset ?? 0, closureSeam);
  const maleBaseGeometry = pieces[maleIndex]!.geometry;
  const maleConnector = extrudeCutSection(
    maleBaseGeometry,
    center,
    normal,
    direction,
    depth + overlap,
    bounds.min.z + backClosure,
    bounds.max.z - frontClosure,
    widthPercent,
    false,
    false,
    geometry,
  );
  if (maleConnector.getAttribute("position").count === 0) {
    return pieces.map((piece) => ({ ...piece, total: pieces.length }));
  }
  maleConnector.translate(-direction.x * overlap, -direction.y * overlap, 0);

  // Expande uma Ãºnica cÃ³pia do perfil nos eixos normal, tangente e Z. Uma
  // Ãºnica subtraÃ§Ã£o Ã© mais estÃ¡vel em contornos complexos do que unir ou
  // subtrair vÃ¡rias cÃ³pias quase coincidentes.
  // A fêmea é o negativo direto da extensão realmente criada na peça de
  // baixo. Isso mantém o mesmo perfil da parede/rebaixo e impede divergências
  // quando a inclinação reduz ou desloca a profundidade efetiva do macho.
  const femaleCavity = maleConnector.clone();
  if (clearance > 0) {
    femaleCavity.computeBoundingBox();
    const cavityBounds = femaleCavity.boundingBox!;
    const cavityCenter = cavityBounds.getCenter(new Vector3());
    const cavityPosition = femaleCavity.getAttribute("position");
    const tangent = new Vector3(-normal.y, normal.x, 0);
    const parent = Array.from({ length: cavityPosition.count }, (_, index) => index);
    const find = (value: number): number => {
      while (parent[value] !== value) {
        parent[value] = parent[parent[value]!]!;
        value = parent[value]!;
      }
      return value;
    };
    const union = (left: number, right: number) => {
      const leftRoot = find(left), rightRoot = find(right);
      if (leftRoot !== rightRoot) parent[leftRoot] = rightRoot;
    };
    const owners = new Map<string, number>();
    for (let i = 0; i < cavityPosition.count; i++) {
      const key = [cavityPosition.getX(i), cavityPosition.getY(i), cavityPosition.getZ(i)]
        .map((value) => Math.round(value * 1e4)).join(",");
      const owner = owners.get(key);
      if (owner === undefined) owners.set(key, i);
      else union(i, owner);
      if (i % 3 !== 0) union(i, i - 1);
    }
    const componentT = new Map<number, { min: number; max: number }>();
    for (let i = 0; i < cavityPosition.count; i++) {
      const root = find(i);
      const coordinate = tangent.x * cavityPosition.getX(i) + tangent.y * cavityPosition.getY(i);
      const bounds = componentT.get(root) ?? { min: coordinate, max: coordinate };
      bounds.min = Math.min(bounds.min, coordinate);
      bounds.max = Math.max(bounds.max, coordinate);
      componentT.set(root, bounds);
    }
    let minNormal = Number.POSITIVE_INFINITY;
    let maxNormal = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < cavityPosition.count; i++) {
      const coordinate = normal.x * cavityPosition.getX(i) + normal.y * cavityPosition.getY(i);
      minNormal = Math.min(minNormal, coordinate);
      maxNormal = Math.max(maxNormal, coordinate);
    }
    const normalCenter = (minNormal + maxNormal) / 2;
    const normalExtent = Math.max(maxNormal - minNormal, 1e-6);
    const normalScale = (normalExtent + clearance * 2) / normalExtent;
    // A folga lateral não deve ultrapassar a frente nem o fundo da parede.
    const zScale = 1;
    for (let i = 0; i < cavityPosition.count; i++) {
      const relative = new Vector3(
        cavityPosition.getX(i) - cavityCenter.x,
        cavityPosition.getY(i) - cavityCenter.y,
        cavityPosition.getZ(i) - cavityCenter.z,
      );
      const currentNormal = normal.x * cavityPosition.getX(i) + normal.y * cavityPosition.getY(i);
      const expandedNormal = normalCenter + (currentNormal - normalCenter) * normalScale;
      const component = componentT.get(find(i))!;
      const componentCenter = (component.min + component.max) / 2;
      const tangentCoordinate = tangent.x * cavityPosition.getX(i) + tangent.y * cavityPosition.getY(i);
      const tangentExtent = Math.max((component.max - component.min) / 2, 1e-6);
      const expandedTangent = componentCenter +
        (tangentCoordinate - componentCenter) * ((tangentExtent + clearance) / tangentExtent);
      cavityPosition.setXYZ(
        i,
        cavityPosition.getX(i) + normal.x * (expandedNormal - currentNormal) +
          tangent.x * (expandedTangent - tangentCoordinate),
        cavityPosition.getY(i) + normal.y * (expandedNormal - currentNormal) +
          tangent.y * (expandedTangent - tangentCoordinate),
        cavityCenter.z + relative.z * zScale,
      );
    }

    cavityPosition.needsUpdate = true;
    femaleCavity.computeVertexNormals();
  }

  // A lingueta jÃ¡ penetra a parede pelo `overlap`. Concatenar as duas cascas
  // preserva esse volume sobreposto para o fatiador e evita a uniÃ£o CSG entre
  // faces coplanares, que criava pontas/triÃ¢ngulos atravessando letras inteiras.
  const femaleSide: -1 | 1 = maleIndex === 0 ? 1 : -1;
  const outerCap = extrudeCutSection(
    maleBaseGeometry,
    center,
    normal,
    direction,
    0,
    bounds.min.z + backClosure,
    bounds.max.z - frontClosure,
    1 - widthPercent,
    true,
    true,
    geometry,
  );
  const backCap = capProfiles(
    wallProfilesAtPlane(geometry, center, normal),
    center,
    normal,
    bounds.min.z,
    bounds.min.z + backClosure,
  );
  const frontCap = capProfiles(
    surfaceProfilesAtPlane(geometry, center, normal, bounds.max.z),
    center,
    normal,
    bounds.max.z - frontClosure,
    bounds.max.z,
  );
  const capParts = [outerCap, backCap, frontCap].filter(
    (cap) => (cap.getAttribute("position")?.count ?? 0) > 0,
  );
  const replacementCap = capParts.length === 1
    ? capParts[0]
    : mergeGeometries(capParts, false);
  // Abre a metade externa da parede original e remove a tampa traseira do
  // prolongamento. As duas cascas compartilham a mesma borda no plano de corte.
  const openedMale = replaceExactPlanarCap(
    maleBaseGeometry,
    replacementCap ?? outerCap,
    center,
    normal,
  );
  const openMaleConnector = replaceExactPlanarCap(
    maleConnector,
    new BufferGeometry(),
    center,
    normal,
  );
  const joinedMale = mergeGeometries(
    [withoutDegenerateTriangles(openedMale), withoutDegenerateTriangles(openMaleConnector)],
    false,
  );
  if (!joinedMale) throw new Error("Falha ao prolongar a parede interna da peça macho");
  const maleGeometry = weldShellByPosition(joinedMale);
  pieces[maleIndex] = { ...pieces[maleIndex]!, geometry: maleGeometry };
  const openedFemale = replaceExactPlanarCap(
    pieces[femaleIndex]!.geometry,
    replacementCap ?? outerCap,
    center,
    normal,
  );
  // Recorta primeiro no semiespaÃ§o feminino. A face traseira do sÃ³lido macho
  // fica do outro lado do plano e nÃ£o pode mais fechar a boca do encaixe.
  let cavityShell = reverseTriangleWinding(
    clipGeometryHalf(femaleCavity, center, normal, femaleSide),
  );
  // A face inicial do sÃ³lido macho fica exatamente na boca da cavidade. Ela Ã©
  // necessÃ¡ria para fechar o macho, mas deve ser removida da cÃ³pia invertida
  // usada como fÃªmea; caso contrÃ¡rio, vira uma tampa sobre o encaixe.
  cavityShell = replaceExactPlanarCap(cavityShell, new BufferGeometry(), center, normal);
  const joinedFemale = mergeGeometries(
    [withoutDegenerateTriangles(openedFemale), withoutDegenerateTriangles(cavityShell)],
    false,
  );
  if (!joinedFemale) throw new Error("Falha ao montar a cavidade fÃªmea aberta");
  const femaleGeometry = weldShellByPosition(joinedFemale);
  pieces[femaleIndex] = { ...pieces[femaleIndex]!, geometry: femaleGeometry };
  return pieces.map((piece) => ({ ...piece, total: pieces.length }));
}

/** Aplica vÃ¡rios planos sobre as peÃ§as resultantes, preservando a origem do modelo. */
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

/** Divide uma malha em blocos fechados que cabem na Ã¡rea Ãºtil XY da impressora. */
export function splitGeometryForBuildPlate(
  geometry: BufferGeometry,
  options: BuildPlateSplitOptions,
): SplitPiece[] {
  const margin = Math.max(options.margin ?? 0, 0);
  const usableWidth = options.width - margin * 2;
  const usableDepth = options.depth - margin * 2;
  if (usableWidth <= 0 || usableDepth <= 0) {
    throw new Error("A margem de corte Ã© maior que a mesa de impressÃ£o.");
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
  // O CSG com uma caixa por célula triangulava novamente toda a seção e podia
  // criar placas fechando vazados e cavidades. Os planos abaixo usam a mesma
  // reconstrução topológica do corte manual: cada tampa nasce somente dos
  // contornos efetivamente atravessados pelo respectivo limite da mesa.
  const origin = bounds.getCenter(new Vector3());
  const cuts: SequentialSplitOptions[] = [];
  for (let column = 1; column < columns; column++) {
    const boundary = bounds.min.x + column * usableWidth;
    cuts.push({ angle: 0, offset: boundary - origin.x, connector: "none" });
  }
  for (let row = 1; row < rows; row++) {
    const boundary = bounds.min.y + row * usableDepth;
    cuts.push({ angle: 90, offset: boundary - origin.y, connector: "none" });
  }
  const split = splitGeometryByPlanes(geometry, cuts, { x: origin.x, y: origin.y });
  const pieces = split.map((piece) => {
    piece.geometry.computeBoundingBox();
    const center = piece.geometry.boundingBox!.getCenter(new Vector3());
    const column = Math.min(columns, Math.max(1, Math.floor((center.x - bounds.min.x) / usableWidth) + 1));
    const row = Math.min(rows, Math.max(1, Math.floor((center.y - bounds.min.y) / usableDepth) + 1));
    return { ...piece, column, row };
  }).sort((left, right) => left.row - right.row || left.column - right.column);
  return pieces.map((piece, index) => ({
    ...piece,
    index: index + 1,
    total: pieces.length,
  }));
}

