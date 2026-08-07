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
  const source = new Brush(geometry.clone());
  source.updateMatrixWorld(true);
  const evaluator = new Evaluator();
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
