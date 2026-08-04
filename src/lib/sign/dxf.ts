import type { Shape } from "three";

import { shapePoints } from "./offset";

type Poly = Array<[number, number]>;

function toPolys(shapes: Shape[]): Poly[] {
  const polys: Poly[] = [];
  for (const shape of shapes) {
    const outer = shapePoints(shape).map((p) => [p.x, p.y] as [number, number]);
    if (outer.length >= 3) polys.push(outer);
    for (const hole of shape.holes) {
      const pts = hole.getPoints(24).map((p) => [p.x, p.y] as [number, number]);
      if (pts.length >= 3) polys.push(pts);
    }
  }
  return polys;
}

/** DXF R12 mínimo (mm) com polilinhas fechadas — pronto para corte a laser. */
export function shapesToDxf(shapes: Shape[], layer = "CORTE"): string {
  const out: string[] = [];
  const push = (code: number | string, value: string | number) => {
    out.push(String(code), String(value));
  };

  push(0, "SECTION");
  push(2, "HEADER");
  push(9, "$INSUNITS");
  push(70, 4); // milímetros
  push(0, "ENDSEC");

  push(0, "SECTION");
  push(2, "ENTITIES");

  for (const poly of toPolys(shapes)) {
    push(0, "POLYLINE");
    push(8, layer);
    push(66, 1);
    push(70, 1); // fechada
    push(10, 0);
    push(20, 0);
    push(30, 0);
    for (const [x, y] of poly) {
      push(0, "VERTEX");
      push(8, layer);
      push(10, x.toFixed(4));
      push(20, y.toFixed(4));
      push(30, 0);
    }
    push(0, "SEQEND");
    push(8, layer);
  }

  push(0, "ENDSEC");
  push(0, "EOF");

  return out.join("\r\n") + "\r\n";
}
