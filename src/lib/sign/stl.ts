import type { BufferGeometry } from "three";

/** Tolerância de solda de vértices (mm). Vértices dentro dessa grade viram o mesmo ponto. */
const WELD = 1e-3;

/** Arredonda para a grade de solda, evitando -0. */
function snap(value: number): number {
  const v = Math.round(value / WELD) * WELD;
  return Object.is(v, -0) ? 0 : Number(v.toFixed(4));
}

interface FaceIdentity {
  key: string;
  orientation: 1 | -1;
}

/**
 * Identifica faces coincidentes e preserva o sentido da normal.
 * Duplicatas no mesmo sentido devem virar uma face; somente pares com
 * sentidos opostos representam uma parede interna que pode ser cancelada.
 */
function faceIdentity(t: number[]): FaceIdentity {
  const vertices = [
    `${t[0]},${t[1]},${t[2]}`,
    `${t[3]},${t[4]},${t[5]}`,
    `${t[6]},${t[7]},${t[8]}`,
  ];
  const sorted = [...vertices].sort();
  const permutation = vertices.map((vertex) => sorted.indexOf(vertex));
  let inversions = 0;
  for (let i = 0; i < permutation.length; i++) {
    for (let j = i + 1; j < permutation.length; j++) {
      if (permutation[i]! > permutation[j]!) inversions++;
    }
  }
  return {
    key: sorted.join("|"),
    orientation: inversions % 2 === 0 ? 1 : -1,
  };
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

  // Consolida duplicatas e cancela apenas pares realmente opostos. A lógica
  // anterior removia qualquer quantidade par de faces coincidentes, inclusive
  // duas faces externas com a mesma orientação, criando arestas abertas.
  const buckets = new Map<string, { positive: number[]; negative: number[] }>();
  collected.forEach((t, index) => {
    const identity = faceIdentity(t);
    const bucket = buckets.get(identity.key) ?? { positive: [], negative: [] };
    if (identity.orientation === 1) bucket.positive.push(index);
    else bucket.negative.push(index);
    buckets.set(identity.key, bucket);
  });

  const drop = new Set<number>();
  for (const { positive, negative } of buckets.values()) {
    const cancelled = Math.min(positive.length, negative.length);
    for (let i = 0; i < cancelled; i++) {
      drop.add(positive[i]!);
      drop.add(negative[i]!);
    }
    // Depois do cancelamento, faces repetidas no mesmo sentido são uma só.
    for (const list of [positive.slice(cancelled), negative.slice(cancelled)]) {
      for (let i = 1; i < list.length; i++) drop.add(list[i]!);
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
