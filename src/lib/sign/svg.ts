import { Path, Shape } from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";

type Pt = { x: number; y: number };

function clean(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-9 && Math.abs(last.y - p.y) < 1e-9) continue;
    out.push({ x: p.x, y: p.y });
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first && last && Math.abs(first.x - last.x) < 1e-9 && Math.abs(first.y - last.y) < 1e-9) {
    out.pop();
  }
  return out;
}

function area(points: Pt[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/**
 * Converte o conteúdo de um arquivo SVG em contornos (THREE.Shape) com o eixo Y
 * corrigido (SVG usa Y para baixo) e escalados para a altura desejada em mm.
 */
export function svgToShapes(svgText: string, targetHeight: number): Shape[] {
  const loader = new SVGLoader();
  const data = loader.parse(svgText);

  const raw: Shape[] = [];
  for (const path of data.paths) {
    const shapes =
      typeof (path as unknown as { toShapes?: (b: boolean) => Shape[] }).toShapes === "function"
        ? (path as unknown as { toShapes: (b: boolean) => Shape[] }).toShapes(true)
        : SVGLoader.createShapes(path);
    for (const shape of shapes) raw.push(shape);
  }
  if (!raw.length) return [];

  // extrai pontos, remove lixo e inverte Y
  const extracted = raw
    .map((shape) => {
      const pts = shape.extractPoints(24);
      return {
        shape: clean(pts.shape.map((p) => ({ x: p.x, y: -p.y }))),
        holes: pts.holes
          .map((h) => clean(h.map((p) => ({ x: p.x, y: -p.y }))))
          .filter((h) => h.length >= 3),
      };
    })
    .filter((e) => e.shape.length >= 3);

  if (!extracted.length) return [];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const e of extracted) {
    for (const p of e.shape) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return [];

  const height = maxY - minY || 1;
  const scale = targetHeight / height;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  if (!Number.isFinite(scale) || scale <= 0) return [];

  const map = (p: Pt) => ({ x: (p.x - cx) * scale, y: (p.y - cy) * scale });

  const result: Shape[] = [];
  for (const e of extracted) {
    // o flip em Y inverte a orientação: normaliza contorno anti-horário e furos horários
    const outer = area(e.shape) < 0 ? [...e.shape].reverse() : e.shape;
    const shape = new Shape();
    outer.map(map).forEach((p, i) => {
      if (i === 0) shape.moveTo(p.x, p.y);
      else shape.lineTo(p.x, p.y);
    });
    shape.closePath();

    for (const hole of e.holes) {
      const ring = area(hole) > 0 ? [...hole].reverse() : hole;
      const path = new Path();
      ring.map(map).forEach((p, i) => {
        if (i === 0) path.moveTo(p.x, p.y);
        else path.lineTo(p.x, p.y);
      });
      path.closePath();
      shape.holes.push(path);
    }
    result.push(shape);
  }
  return result;
}
