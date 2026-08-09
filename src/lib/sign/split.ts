import { Box3, BoxGeometry, BufferGeometry, Vector3 } from "three";
import { Brush, Evaluator, INTERSECTION } from "three-bvh-csg";

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
