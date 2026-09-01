import assert from "node:assert/strict";
import test from "node:test";
import { ExtrudeGeometry, Path, Shape } from "three";

import { geometriesSurfaceToDxf } from "../src/lib/sign/dxf-export.ts";

test("exporta contorno externo e vazado interno como polilinhas DXF fechadas", () => {
  const shape = new Shape();
  shape.moveTo(0, 0);
  shape.lineTo(100, 0);
  shape.lineTo(100, 80);
  shape.lineTo(0, 80);
  shape.closePath();
  const hole = new Path();
  hole.moveTo(20, 20);
  hole.lineTo(80, 20);
  hole.lineTo(80, 60);
  hole.lineTo(20, 60);
  hole.closePath();
  shape.holes.push(hole);
  const geometry = new ExtrudeGeometry(shape, { depth: 3, bevelEnabled: false });
  const dxf = geometriesSurfaceToDxf([geometry], "front");
  assert.equal((dxf.match(/LWPOLYLINE/g) ?? []).length, 2);
  assert.equal((dxf.match(/\n70\n1/g) ?? []).length, 2);
  assert.match(dxf, /\$INSUNITS\n70\n4/);
});

test("exporta a superfície traseira", () => {
  const shape = new Shape();
  shape.moveTo(0, 0);
  shape.lineTo(10, 0);
  shape.lineTo(10, 10);
  shape.lineTo(0, 10);
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, { depth: 2, bevelEnabled: false });
  assert.match(geometriesSurfaceToDxf([geometry], "back"), /LWPOLYLINE/);
});

