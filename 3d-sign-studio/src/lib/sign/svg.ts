import { Path, Shape } from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";

/**
 * Converte o conteúdo de um arquivo SVG em contornos (THREE.Shape) com o eixo Y
 * corrigido (SVG usa Y para baixo) e escalados para a altura desejada em mm.
 */
export function svgToShapes(svgText: string, targetHeight: number): Shape[] {
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
  const height = maxY - minY || 1;
  const scale = targetHeight / height;
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
