import { Path, Shape } from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";

/**
 * Converte o conteúdo de um arquivo SVG em contornos (THREE.Shape) com o eixo Y
 * corrigido (SVG usa Y para baixo) e mantendo o tamanho físico original em mm.
 */
export function svgToShapes(svgText: string): Shape[] {
  const loader = new SVGLoader();
  const data = loader.parse(svgText);

  const raw: Shape[] = [];
  for (const path of data.paths) {
    for (const shape of SVGLoader.createShapes(path)) raw.push(shape);
  }
  if (!raw.length) return [];

  // extrai pontos e inverte Y
  const extracted = raw.map((shape) => {
    const pts = shape.extractPoints(24);
    return {
      shape: pts.shape.map((p) => ({ x: p.x, y: -p.y })),
      holes: pts.holes.map((h) => h.map((p) => ({ x: p.x, y: -p.y }))),
    };
  });

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
  const scale = svgMillimetersPerUserUnit(svgText);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  return extracted.map((e) => {
    const shape = new Shape();
    e.shape.forEach((p, i) => {
      const x = (p.x - cx) * scale;
      const y = (p.y - cy) * scale;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
    shape.closePath();
    for (const hole of e.holes) {
      const path = new Path();
      hole.forEach((p, i) => {
        const x = (p.x - cx) * scale;
        const y = (p.y - cy) * scale;
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      });
      path.closePath();
      shape.holes.push(path);
    }
    return shape;
  });
}

function lengthToMillimeters(value: string | undefined): number | null {
  if (!value || value.trim().endsWith("%")) return null;
  const match = value.trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+))(mm|cm|in|pt|pc|px)?$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const factor: Record<string, number> = {
    mm: 1,
    cm: 10,
    in: 25.4,
    pt: 25.4 / 72,
    pc: 25.4 / 6,
    px: 25.4 / 96,
  };
  return amount * factor[(match[2] ?? "px").toLowerCase()]!;
}

/** Retorna quantos milímetros corresponde a uma unidade do viewBox. */
export function svgMillimetersPerUserUnit(svgText: string): number {
  const root = svgText.match(/<svg\b([^>]*)>/i)?.[1] ?? "";
  const attribute = (name: string) =>
    root.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];
  const viewBox = attribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const viewWidth = viewBox?.length === 4 && Number.isFinite(viewBox[2]) ? Math.abs(viewBox[2]!) : 0;
  const viewHeight = viewBox?.length === 4 && Number.isFinite(viewBox[3]) ? Math.abs(viewBox[3]!) : 0;
  const widthMm = lengthToMillimeters(attribute("width"));
  const heightMm = lengthToMillimeters(attribute("height"));
  if (widthMm && viewWidth) return widthMm / viewWidth;
  if (heightMm && viewHeight) return heightMm / viewHeight;
  // Sem tamanho físico explícito, SVG segue a unidade CSS padrão: 96 px por polegada.
  return 25.4 / 96;
}
