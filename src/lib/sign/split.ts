import { Box3, BoxGeometry, BufferGeometry, Float32BufferAttribute, Vector3 } from "three";
import { ADDITION, Brush, Evaluator, INTERSECTION, SUBTRACTION } from "three-bvh-csg";

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
  const center = bounds
    .getCenter(new Vector3())
    .addScaledVector(normal, options.offset ?? 0);
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
        if ((currentDistance >= 0) !== (nextDistance >= 0)) {
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
  for (let i = 0; i + 2 < position.count; i += 3) {
    const a = new Vector3(position.getX(i), position.getY(i), position.getZ(i));
    const b = new Vector3(position.getX(i + 1), position.getY(i + 1), position.getZ(i + 1));
    const c = new Vector3(position.getX(i + 2), position.getY(i + 2), position.getZ(i + 2));
    if (![...a.toArray(), ...b.toArray(), ...c.toArray()].every(Number.isFinite)) continue;
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    if (cross.crossVectors(ab, ac).lengthSq() <= 1e-12) continue;
    vertices.push(...a.toArray(), ...b.toArray(), ...c.toArray());
  }
  const cleaned = new BufferGeometry();
  cleaned.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  cleaned.computeVertexNormals();
  return cleaned;
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
  const radians = (options.angle * Math.PI) / 180;
  const normal = new Vector3(Math.cos(radians), Math.sin(radians), 0);
  center.addScaledVector(normal, options.offset ?? 0);
  const extent = Math.max(size.x, size.y) * 4 + Math.abs(options.offset ?? 0) * 2 + 10;
  const zPadding = Math.max(size.z, 1) + 2;
  const sourceGeometry = geometry.clone();
  const source = new Brush(sourceGeometry);
  source.updateMatrixWorld(true);
  const evaluator = new Evaluator();
  evaluator.attributes = ["position"];
  const pieces: SplitPiece[] = [];

  for (const side of [-1, 1] as const) {
    const cutterGeometry = new BoxGeometry(extent, extent * 2, zPadding);
    cutterGeometry.rotateZ(radians);
    cutterGeometry.translate(
      center.x + normal.x * side * (extent / 2),
      center.y + normal.y * side * (extent / 2),
      bounds.max.z - tongueHeight / 2,
    );
    const cutter = new Brush(cutterGeometry);
    cutter.updateMatrixWorld(true);
    const result = evaluator.evaluate(source, cutter, INTERSECTION).geometry.clone();
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
  // Mesmo princípio do rebaixo da tampa: uma faixa fina junto à frente forma
  // o macho, enquanto o restante da parede da peça fêmea funciona como apoio.
  const tongueHeight = Math.min(
    size.z,
    Math.max(0.4, options.connectorThickness ?? size.z * widthPercent),
  );
  const tangent = new Vector3(-normal.y, normal.x, 0);
  const overlap = Math.min(0.5, depth * 0.2);
  const sampleDepth = depth + overlap;
  const sectionBox = new BoxGeometry(sampleDepth, extent * 2, tongueHeight);
  sectionBox.rotateZ(radians);
  sectionBox.translate(
    center.x - direction.x * (sampleDepth / 2),
    center.y - direction.y * (sampleDepth / 2),
    (bounds.min.z + bounds.max.z) / 2,
  );
  let maleConnector: BufferGeometry;
  try {
    maleConnector = evaluateGeometry(geometry, sectionBox, INTERSECTION);
  } catch (error) {
    throw new Error("Falha ao extrair o perfil das paredes no corte", { cause: error });
  }
  if (maleConnector.getAttribute("position").count === 0) {
    return pieces.map((piece) => ({ ...piece, total: pieces.length }));
  }
  maleConnector.translate(direction.x * depth, direction.y * depth, 0);

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
      tangentExtent = Math.max(
        tangentExtent,
        Math.abs(tangent.dot(point.clone().sub(cavityCenter))),
      );
    }
    const normalScale = (depth + clearance * 2) / depth;
    const tangentScale =
      tangentExtent > 1e-6 ? (tangentExtent + clearance) / tangentExtent : 1;
    const zScale = (tongueHeight + clearance * 2) / tongueHeight;
    for (let i = 0; i < cavityPosition.count; i++) {
      const relative = new Vector3(
        cavityPosition.getX(i) - cavityCenter.x,
        cavityPosition.getY(i) - cavityCenter.y,
        cavityPosition.getZ(i) - cavityCenter.z,
      );
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

  try {
    pieces[maleIndex] = {
      ...pieces[maleIndex]!,
      geometry: evaluateGeometry(pieces[maleIndex]!.geometry, maleConnector, ADDITION),
    };
  } catch (error) {
    throw new Error("Falha ao unir o rebaixo prolongado à peça macho", { cause: error });
  }
  let femaleGeometry: BufferGeometry;
  try {
    femaleGeometry = evaluateGeometry(pieces[femaleIndex]!.geometry, femaleCavity, SUBTRACTION);
  } catch (error) {
    throw new Error("Falha ao abrir a cavidade fêmea", { cause: error });
  }
  pieces[femaleIndex] = { ...pieces[femaleIndex]!, geometry: femaleGeometry };
  return pieces.map((piece) => ({ ...piece, total: pieces.length }));
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

