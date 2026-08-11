import { BufferGeometry, Vector2 } from "three";

export interface ModelPlacement {
  rotation: number;
  mirrorX: boolean;
  mirrorY: boolean;
}

export interface PlacementOrigin {
  x: number;
  y: number;
}

export function transformPlacementPoint(
  point: { x: number; y: number },
  placement: ModelPlacement,
  origin: PlacementOrigin,
): Vector2 {
  let x = point.x - origin.x;
  let y = point.y - origin.y;
  if (placement.mirrorX) x = -x;
  if (placement.mirrorY) y = -y;
  const radians = (placement.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return new Vector2(origin.x + x * cos - y * sin, origin.y + x * sin + y * cos);
}

/** Aplica rotação/espelho no centro do conjunto e preserva a orientação das faces. */
export function transformGeometryForPlacement(
  geometry: BufferGeometry,
  placement: ModelPlacement,
  origin: PlacementOrigin,
): BufferGeometry {
  const result = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const position = result.getAttribute("position");
  for (let index = 0; index < position.count; index++) {
    const transformed = transformPlacementPoint(
      { x: position.getX(index), y: position.getY(index) },
      placement,
      origin,
    );
    position.setXYZ(index, transformed.x, transformed.y, position.getZ(index));
  }
  // Um único espelho troca a orientação. Invertemos novamente a ordem dos
  // triângulos para que STL e fatiadores continuem recebendo normais externas.
  if (placement.mirrorX !== placement.mirrorY) {
    for (let index = 0; index + 2 < position.count; index += 3) {
      const bx = position.getX(index + 1);
      const by = position.getY(index + 1);
      const bz = position.getZ(index + 1);
      position.setXYZ(
        index + 1,
        position.getX(index + 2),
        position.getY(index + 2),
        position.getZ(index + 2),
      );
      position.setXYZ(index + 2, bx, by, bz);
    }
  }
  position.needsUpdate = true;
  result.computeVertexNormals();
  result.computeBoundingBox();
  return result;
}
