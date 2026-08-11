import DxfParser from "dxf-parser";
import { Path, Shape } from "three";

// dxf-parser exposes heterogeneous entity records without a discriminated-union type.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Pt = { x: number; y: number };

const ARC_SEG = 24;

function arcPoints(cx: number, cy: number, r: number, startDeg: number, endDeg: number): Pt[] {
  const start = (startDeg * Math.PI) / 180;
  let end = (endDeg * Math.PI) / 180;
  while (end <= start) end += Math.PI * 2;
  const steps = Math.max(4, Math.ceil(((end - start) / (Math.PI * 2)) * ARC_SEG * 2));
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = start + ((end - start) * i) / steps;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

function bulgeArc(a: Pt, b: Pt, bulge: number): Pt[] {
  if (!bulge) return [b];
  const theta = 4 * Math.atan(bulge);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const chord = Math.hypot(dx, dy);
  if (!chord) return [b];
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const h = Math.sqrt(Math.max(r * r - (chord / 2) ** 2, 0));
  const sign = bulge > 0 ? 1 : -1;
  const cx = mx - (sign * h * dy) / chord;
  const cy = my + (sign * h * dx) / chord;
  const a0 = Math.atan2(a.y - cy, a.x - cx);
  const steps = Math.max(3, Math.ceil((Math.abs(theta) / (Math.PI * 2)) * ARC_SEG * 2));
  const pts: Pt[] = [];
  for (let i = 1; i <= steps; i++) {
    const ang = a0 + (theta * i) / steps;
    pts.push({ x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r });
  }
  return pts;
}

type Xf = { x: number; y: number; sx: number; sy: number; rot: number };

const ID: Xf = { x: 0, y: 0, sx: 1, sy: 1, rot: 0 };

function applyXf(p: Pt, t: Xf): Pt {
  const x = p.x * t.sx;
  const y = p.y * t.sy;
  const c = Math.cos(t.rot);
  const s = Math.sin(t.rot);
  return { x: t.x + x * c - y * s, y: t.y + x * s + y * c };
}

/** Expande entidades INSERT usando as definições de BLOCKS. */
function flatten(entities: any[], blocks: any, t: Xf, depth = 0): any[] {
  const out: any[] = [];
  for (const e of entities ?? []) {
    if (e.type === "INSERT" && depth < 8) {
      const block = blocks?.[e.name];
      if (!block?.entities) continue;
      const pos = e.position ?? { x: 0, y: 0 };
      const base = block.position ?? { x: 0, y: 0 };
      const local: Xf = {
        sx: t.sx * (e.xScale ?? 1),
        sy: t.sy * (e.yScale ?? 1),
        rot: t.rot + ((e.rotation ?? 0) * Math.PI) / 180,
        x: 0,
        y: 0,
      };
      const origin = applyXf(
        { x: pos.x - base.x * (e.xScale ?? 1), y: pos.y - base.y * (e.yScale ?? 1) },
        t,
      );
      local.x = origin.x;
      local.y = origin.y;
      out.push(...flatten(block.entities, blocks, local, depth + 1));
      continue;
    }
    out.push(transformEntity(e, t));
  }
  return out;
}

function transformEntity(e: any, t: Xf): any {
  if (t === ID) return e;
  const clone: any = { ...e };
  if (e.vertices) clone.vertices = e.vertices.map((v: any) => ({ ...v, ...applyXf(v, t) }));
  if (e.controlPoints) clone.controlPoints = e.controlPoints.map((v: any) => applyXf(v, t));
  if (e.fitPoints) clone.fitPoints = e.fitPoints.map((v: any) => applyXf(v, t));
  if (e.center) {
    clone.center = applyXf(e.center, t);
    clone.radius = (e.radius ?? 0) * Math.abs(t.sx);
  }
  return clone;
}

/** Extrai polilinhas (abertas ou fechadas) das entidades do DXF. */
function entitiesToPolylines(entities: any[]): { pts: Pt[]; closed: boolean }[] {
  const out: { pts: Pt[]; closed: boolean }[] = [];
  for (const e of entities ?? []) {
    switch (e.type) {
      case "LINE": {
        const v = e.vertices ?? [];
        if (v.length >= 2)
          out.push({
            pts: [
              { x: v[0].x, y: v[0].y },
              { x: v[1].x, y: v[1].y },
            ],
            closed: false,
          });
        break;
      }
      case "LWPOLYLINE":
      case "POLYLINE": {
        const v = e.vertices ?? [];
        if (v.length < 2) break;
        const pts: Pt[] = [{ x: v[0].x, y: v[0].y }];
        for (let i = 1; i < v.length; i++) {
          pts.push(...bulgeArc(v[i - 1], v[i], v[i - 1].bulge ?? 0));
        }
        const closed = Boolean(e.shape || e.closed);
        if (closed) pts.push(...bulgeArc(v[v.length - 1], v[0], v[v.length - 1].bulge ?? 0));
        out.push({ pts, closed });
        break;
      }
      case "CIRCLE":
        out.push({
          pts: arcPoints(e.center.x, e.center.y, e.radius, 0, 359.999),
          closed: true,
        });
        break;
      case "ARC":
        out.push({
          pts: arcPoints(
            e.center.x,
            e.center.y,
            e.radius,
            e.startAngle != null ? (e.startAngle * 180) / Math.PI : 0,
            e.endAngle != null ? (e.endAngle * 180) / Math.PI : 360,
          ),
          closed: false,
        });
        break;
      case "SPLINE": {
        const pts = (e.fitPoints?.length ? e.fitPoints : e.controlPoints) ?? [];
        if (pts.length >= 2) {
          out.push({ pts: pts.map((p: Pt) => ({ x: p.x, y: p.y })), closed: Boolean(e.closed) });
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function near(a: Pt, b: Pt, tol: number) {
  return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
}

/** Junta segmentos soltos em contornos fechados. */
function stitch(polys: { pts: Pt[]; closed: boolean }[], tol: number): Pt[][] {
  const loops: Pt[][] = [];
  const open = polys.filter((p) => !p.closed).map((p) => p.pts.slice());
  for (const p of polys) if (p.closed) loops.push(p.pts.slice());

  while (open.length) {
    let current = open.shift()!;
    let merged = true;
    while (merged) {
      merged = false;
      const head = current[0]!;
      const tail = current[current.length - 1]!;
      if (near(head, tail, tol) && current.length > 2) break;
      for (let i = 0; i < open.length; i++) {
        const cand = open[i]!;
        const cHead = cand[0]!;
        const cTail = cand[cand.length - 1]!;
        if (near(tail, cHead, tol)) current = current.concat(cand.slice(1));
        else if (near(tail, cTail, tol)) current = current.concat(cand.slice().reverse().slice(1));
        else if (near(head, cTail, tol)) current = cand.slice(0, -1).concat(current);
        else if (near(head, cHead, tol))
          current = cand.slice().reverse().slice(0, -1).concat(current);
        else continue;
        open.splice(i, 1);
        merged = true;
        break;
      }
    }
    if (current.length > 2) loops.push(current);
  }
  return loops;
}

function area(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function contains(outer: Pt[], p: Pt): boolean {
  let inside = false;
  for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
    const a = outer[i]!;
    const b = outer[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Converte o conteúdo de um arquivo DXF em contornos (THREE.Shape),
 * fechando linhas soltas, detectando furos e preservando as unidades originais.
 */
export function dxfToShapes(dxfText: string): Shape[] {
  const parser = new DxfParser();
  let dxf: any = null;
  try {
    // linhas vazias no fim quebram o parser
    dxf = parser.parseSync(dxfText.replace(/\r\n?/g, "\n").replace(/\s+$/, ""));
  } catch (error) {
    console.error("Falha ao ler o arquivo DXF", error);
    return [];
  }
  if (!dxf) return [];

  const flat = flatten(dxf.entities ?? [], dxf.blocks ?? {}, ID);
  const polys = entitiesToPolylines(flat);
  if (!polys.length) {
    console.warn("DXF sem entidades de contorno reconhecidas", dxf.entities?.length);
    return [];
  }

  // tolerância proporcional ao tamanho do desenho (arquivos em m, cm ou mm)
  let dx = 0;
  let dy = 0;
  {
    let a = Infinity;
    let b = Infinity;
    let c = -Infinity;
    let d = -Infinity;
    for (const poly of polys)
      for (const p of poly.pts) {
        a = Math.min(a, p.x);
        c = Math.max(c, p.x);
        b = Math.min(b, p.y);
        d = Math.max(d, p.y);
      }
    dx = c - a;
    dy = d - b;
  }
  const tol = Math.max(Math.hypot(dx, dy) * 0.001, 1e-9);

  const loops = stitch(polys, tol);
  if (!loops.length) {
    console.warn("DXF: nenhum contorno fechado encontrado");
    return [];
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const loop of loops) {
    for (const p of loop) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  }
  const scale = dxfMillimetersPerUnit(dxf.header?.$INSUNITS);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const map = (p: Pt): Pt => ({ x: (p.x - cx) * scale, y: (p.y - cy) * scale });

  const scaled = loops
    .map((loop) => loop.map(map))
    .filter((loop) => Math.abs(area(loop)) > 0.01)
    .sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));

  const used = new Set<number>();
  const shapes: Shape[] = [];

  scaled.forEach((loop, i) => {
    if (used.has(i)) return;
    used.add(i);
    const shape = new Shape();
    loop.forEach((p, idx) => (idx === 0 ? shape.moveTo(p.x, p.y) : shape.lineTo(p.x, p.y)));
    shape.closePath();

    scaled.forEach((inner, j) => {
      if (j <= i || used.has(j)) return;
      if (contains(loop, inner[0]!)) {
        used.add(j);
        const hole = new Path();
        inner.forEach((p, idx) => (idx === 0 ? hole.moveTo(p.x, p.y) : hole.lineTo(p.x, p.y)));
        hole.closePath();
        shape.holes.push(hole);
      }
    });

    shapes.push(shape);
  });

  return shapes;
}

/** Conversão dos códigos INSUNITS do AutoCAD para milímetros. */
export function dxfMillimetersPerUnit(insUnits: unknown): number {
  const factors: Record<number, number> = {
    0: 1,
    1: 25.4,
    2: 304.8,
    3: 1_609_344,
    4: 1,
    5: 10,
    6: 1_000,
    7: 1_000_000,
    8: 0.0000254,
    9: 0.0254,
    10: 914.4,
    11: 1e-7,
    12: 1e-6,
    13: 0.001,
    14: 100,
    15: 10_000,
    16: 100_000,
    17: 1_000_000_000,
  };
  return factors[Number(insUnits)] ?? 1;
}
