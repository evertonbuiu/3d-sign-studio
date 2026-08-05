import { BufferGeometry, Float32BufferAttribute } from "three";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ADDITION, Brush, Evaluator } from "three-bvh-csg";

function prepareForUnion(source: BufferGeometry): BufferGeometry {
  let geometry = source.clone();
  geometry.clearGroups();
  if (geometry.index) geometry = geometry.toNonIndexed();
  geometry = BufferGeometryUtils.mergeVertices(geometry, 0.01);
  geometry.computeVertexNormals();

  if (!geometry.getAttribute("uv")) {
    const count = geometry.getAttribute("position")?.count ?? 0;
    geometry.setAttribute("uv", new Float32BufferAttribute(new Float32Array(count * 2), 2));
  }
  return geometry;
}

/** Une por operação booleana todas as peças que se tocam antes de gerar o STL. */
export function unionGeometriesForStl(geometries: BufferGeometry[]): BufferGeometry | null {
  const valid = geometries.filter((geometry) => geometry.getAttribute("position")?.count);
  if (!valid.length) return null;
  if (valid.length === 1) return prepareForUnion(valid[0]!);

  const evaluator = new Evaluator();
  evaluator.useGroups = false;
  let result = new Brush(prepareForUnion(valid[0]!));
  result.updateMatrixWorld(true);

  for (const geometry of valid.slice(1)) {
    const next = new Brush(prepareForUnion(geometry));
    next.updateMatrixWorld(true);
    result = evaluator.evaluate(result, next, ADDITION);
    result.updateMatrixWorld(true);
  }

  let united = result.geometry.clone();
  united.clearGroups();
  united = BufferGeometryUtils.mergeVertices(united, 0.01);
  united.computeVertexNormals();
  return united;
}

/** Gera um STL binário (mm) a partir de geometrias em coordenadas de mundo. */
export function geometriesToStl(geometries: BufferGeometry[]): ArrayBuffer {
  const triangles: number[][] = [];

  for (const geometry of geometries) {
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = source.getAttribute("position");
    if (!pos) continue;
    for (let i = 0; i < pos.count; i += 3) {
      triangles.push([
        pos.getX(i),
        pos.getY(i),
        pos.getZ(i),
        pos.getX(i + 1),
        pos.getY(i + 1),
        pos.getZ(i + 1),
        pos.getX(i + 2),
        pos.getY(i + 2),
        pos.getZ(i + 2),
      ]);
    }
  }

  const buffer = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(buffer);
  const header = "3D Sign Maker PRO";
  for (let i = 0; i < 80; i++) {
    view.setUint8(i, i < header.length ? header.charCodeAt(i) : 32);
  }
  view.setUint32(80, triangles.length, true);

  let offset = 84;
  for (const t of triangles) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = t as [
      number, number, number, number, number, number, number, number, number,
    ];
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;

    for (const v of [nx, ny, nz, ax, ay, az, bx, by, bz, cx, cy, cz]) {
      view.setFloat32(offset, v, true);
      offset += 4;
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  }

  return buffer;
}

export function downloadBlob(data: BlobPart, filename: string, type: string) {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slugify(value: string) {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "projeto"
  );
}
