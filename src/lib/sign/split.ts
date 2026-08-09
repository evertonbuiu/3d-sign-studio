import { Box3, BoxGeometry, BufferGeometry, Vector3 } from "three";
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
  connectorClearance?: number;
}

function evaluateGeometry(
  first: BufferGeometry,
  second: BufferGeometry,
  operation: number,
): BufferGeometry {
  const evaluator = new Evaluator();
  evaluator.attributes = ["position"];
  const a = new Brush(first.clone());
  const b = new Brush(second.clone());
  a.updateMatrixWorld(true);
  b.updateMatrixWorld(true);
  const result = evaluator.evaluate(a, b, operation).geometry.clone();
  result.computeVertexNormals();
  result.computeBoundingBox();
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
      (bounds.min.z + bounds.max.z) / 2,
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
  const widthPercent = Math.min(Math.max(options.connectorWidth ?? 100, 10), 100) * 0.01;
  const maleIndex = options.maleSide === "part-2" ? 1 : 0;
  const femaleIndex = maleIndex === 0 ? 1 : 0;
  const direction = normal.clone().multiplyScalar(maleIndex === 0 ? 1 : -1);

  const capGeometry = pieces[maleIndex]!.geometry.index
    ? pieces[maleIndex]!.geometry.toNonIndexed()
    : pieces[maleIndex]!.geometry;
  const position = capGeometry.getAttribute("position");
  let connectorCenter: Vector3 | null = null;
  let bestDistance = Infinity;
  const modelCenter = bounds.getCenter(new Vector3());
  for (let i = 0; i < position.count; i += 3) {
    const a = new Vector3(position.getX(i), position.getY(i), position.getZ(i));
    const b = new Vector3(position.getX(i + 1), position.getY(i + 1), position.getZ(i + 1));
    const c = new Vector3(position.getX(i + 2), position.getY(i + 2), position.getZ(i + 2));
    if (
      Math.abs(normal.dot(a.clone().sub(center))) > 1e-3 ||
      Math.abs(normal.dot(b.clone().sub(center))) > 1e-3 ||
      Math.abs(normal.dot(c.clone().sub(center))) > 1e-3
    ) {
      continue;
    }
    const candidate = a
      .add(b)
      .add(c)
      .multiplyScalar(1 / 3);
    const distance = candidate.distanceToSquared(modelCenter);
    if (distance < bestDistance) {
      bestDistance = distance;
      connectorCenter = candidate;
    }
  }
  if (!connectorCenter) return pieces.map((piece) => ({ ...piece, total: pieces.length }));

  const connectorWidth = Math.max(1, Math.min(20, size.z * widthPercent));
  const connectorHeight = Math.max(1, Math.min(20, size.z * widthPercent));
  const overlap = Math.min(0.5, depth * 0.2);
  const makeConnector = (normalDepth: number, centerOffset: number, extraSize = 0) => {
    const connector = new BoxGeometry(
      normalDepth,
      connectorWidth + extraSize,
      connectorHeight + extraSize,
    );
    connector.rotateZ(radians);
    connector.translate(
      connectorCenter.x + direction.x * centerOffset,
      connectorCenter.y + direction.y * centerOffset,
      connectorCenter.z,
    );
    return connector;
  };

  const maleConnector = makeConnector(depth + overlap, (depth - overlap) / 2);
  const femaleDepth = depth + clearance;
  const femaleCavity = makeConnector(femaleDepth, femaleDepth / 2, clearance * 2);

  pieces[maleIndex] = {
    ...pieces[maleIndex]!,
    geometry: evaluateGeometry(pieces[maleIndex]!.geometry, maleConnector, ADDITION),
  };
  pieces[femaleIndex] = {
    ...pieces[femaleIndex]!,
    geometry: evaluateGeometry(pieces[femaleIndex]!.geometry, femaleCavity, SUBTRACTION),
  };
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

