import type { BufferGeometry } from "three";

/** Tolerância de solda de vértices (mm). Vértices dentro dessa grade viram o mesmo ponto. */
const WELD = 1e-3;

/** Arredonda para a grade de solda, evitando -0. */
function snap(value: number): number {
  const v = Math.round(value / WELD) * WELD;
  return Object.is(v, -0) ? 0 : Number(v.toFixed(4));
}

/** Chave canônica de um triângulo (independente da ordem dos vértices). */
function faceKey(t: number[]): string {
  const verts = [
    `${t[0]},${t[1]},${t[2]}`,
    `${t[3]},${t[4]},${t[5]}`,
    `${t[6]},${t[7]},${t[8]}`,
  ].sort();
  return verts.join("|");
}

/** Gera um STL binário (mm) a partir de geometrias em coordenadas de mundo. */
export function geometriesToStl(geometries: BufferGeometry[]): ArrayBuffer {
  const collected: number[][] = [];

  for (const geometry of geometries) {
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = source.getAttribute("position");
    if (!pos) continue;
    for (let i = 0; i + 2 < pos.count; i += 3) {
      const t = [
        snap(pos.getX(i)),
        snap(pos.getY(i)),
        snap(pos.getZ(i)),
        snap(pos.getX(i + 1)),
        snap(pos.getY(i + 1)),
        snap(pos.getZ(i + 1)),
        snap(pos.getX(i + 2)),
        snap(pos.getY(i + 2)),
        snap(pos.getZ(i + 2)),
      ];
      // descarta triângulos com valores inválidos
      if (t.some((v) => !Number.isFinite(v))) continue;
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = t as [
        number, number, number, number, number, number, number, number, number,
      ];
      // descarta triângulos degenerados (área ~0), que quebram slicers
      const ux = bx - ax;
      const uy = by - ay;
      const uz = bz - az;
      const vx = cx - ax;
      const vy = cy - ay;
      const vz = cz - az;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      if (Math.hypot(nx, ny, nz) / 2 < 1e-7) continue;
      collected.push(t);
    }
  }

  // Remove faces internas: pares de triângulos coincidentes com orientação oposta
  // (resultado típico de uniões booleanas) e duplicatas exatas.
  const buckets = new Map<string, number[]>();
  collected.forEach((t, index) => {
    const key = faceKey(t);
    const list = buckets.get(key);
    if (list) list.push(index);
    else buckets.set(key, [index]);
  });

  const drop = new Set<number>();
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    // mantém apenas uma face por posição; pares opostos são descartados por completo
    const keep = list.length % 2 === 1 ? list[list.length - 1]! : -1;
    for (const index of list) {
      if (index !== keep) drop.add(index);
    }
  }

  const triangles = collected.filter((_, index) => !drop.has(index));


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
