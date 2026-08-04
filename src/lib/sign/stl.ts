import type { BufferGeometry } from "three";

type Tri = [number, number, number];

/** Grade de solda em mm: pontos mais próximos que isso viram o mesmo vértice. */
const WELD = 1e-3;

interface Mesh {
  verts: number[]; // x,y,z
  tris: Tri[];
}

function buildMesh(geometries: BufferGeometry[]): Mesh {
  const verts: number[] = [];
  const tris: Tri[] = [];
  const map = new Map<string, number>();

  const add = (x: number, y: number, z: number): number => {
    const qx = Math.round(x / WELD);
    const qy = Math.round(y / WELD);
    const qz = Math.round(z / WELD);
    const key = `${qx},${qy},${qz}`;
    const found = map.get(key);
    if (found !== undefined) return found;
    const index = verts.length / 3;
    verts.push(qx * WELD, qy * WELD, qz * WELD);
    map.set(key, index);
    return index;
  };

  for (const geometry of geometries) {
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = source.getAttribute("position");
    if (!pos) continue;
    for (let i = 0; i + 2 < pos.count; i += 3) {
      const a = add(pos.getX(i), pos.getY(i), pos.getZ(i));
      const b = add(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1));
      const c = add(pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
      if (a === b || b === c || a === c) continue; // degenerado
      tris.push([a, b, c]);
    }
  }
  return { verts, tris };
}

/** Fecha bordas abertas costurando os laços de arestas livres. */
function closeHoles(mesh: Mesh) {
  const boundary = new Map<number, number>(); // from -> to
  const count = new Map<string, number>();
  const dirKey = (a: number, b: number) => `${a}_${b}`;

  for (const [a, b, c] of mesh.tris) {
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ] as Array<[number, number]>) {
      count.set(dirKey(u, v), (count.get(dirKey(u, v)) ?? 0) + 1);
    }
  }

  for (const [key, n] of count) {
    const [u, v] = key.split("_").map(Number) as [number, number];
    const opposite = count.get(dirKey(v, u)) ?? 0;
    if (n > opposite) {
      // aresta sem par: o buraco é percorrido no sentido inverso
      boundary.set(v, u);
    }
  }

  const visited = new Set<number>();
  for (const start of boundary.keys()) {
    if (visited.has(start)) continue;
    const loop: number[] = [];
    let current = start;
    while (!visited.has(current)) {
      visited.add(current);
      loop.push(current);
      const next = boundary.get(current);
      if (next === undefined) break;
      current = next;
      if (current === start) break;
    }
    if (loop.length < 3) continue;

    // fecha com leque a partir do centróide
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const index of loop) {
      cx += mesh.verts[index * 3]!;
      cy += mesh.verts[index * 3 + 1]!;
      cz += mesh.verts[index * 3 + 2]!;
    }
    const center = mesh.verts.length / 3;
    mesh.verts.push(cx / loop.length, cy / loop.length, cz / loop.length);
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!;
      const b = loop[(i + 1) % loop.length]!;
      if (a === b) continue;
      mesh.tris.push([a, b, center]);
    }
  }
}

/** Gera um STL binário (mm) sólido: vértices soldados e bordas abertas fechadas. */
export function geometriesToStl(geometries: BufferGeometry[]): ArrayBuffer {
  const mesh = buildMesh(geometries);
  closeHoles(mesh);

  const triangles: number[][] = mesh.tris.map(([a, b, c]) => [
    mesh.verts[a * 3]!,
    mesh.verts[a * 3 + 1]!,
    mesh.verts[a * 3 + 2]!,
    mesh.verts[b * 3]!,
    mesh.verts[b * 3 + 1]!,
    mesh.verts[b * 3 + 2]!,
    mesh.verts[c * 3]!,
    mesh.verts[c * 3 + 1]!,
    mesh.verts[c * 3 + 2]!,
  ]);


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
