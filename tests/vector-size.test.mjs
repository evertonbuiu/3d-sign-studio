import assert from "node:assert/strict";
import test from "node:test";

import { dxfMillimetersPerUnit } from "../src/lib/sign/dxf.ts";
import { svgMillimetersPerUserUnit } from "../src/lib/sign/svg.ts";

test("preserva as dimensões físicas declaradas no SVG", () => {
  assert.equal(
    svgMillimetersPerUserUnit('<svg width="120mm" height="60mm" viewBox="0 0 120 60"/>'),
    1,
  );
  assert.ok(
    Math.abs(
      svgMillimetersPerUserUnit('<svg width="96px" height="48px" viewBox="0 0 96 48"/>') -
        25.4 / 96,
    ) < 1e-12,
  );
  assert.equal(
    svgMillimetersPerUserUnit('<svg width="4in" height="2in" viewBox="0 0 400 200"/>'),
    0.254,
  );
});

test("converte as unidades originais do DXF para milímetros", () => {
  assert.equal(dxfMillimetersPerUnit(0), 1);
  assert.equal(dxfMillimetersPerUnit(4), 1);
  assert.equal(dxfMillimetersPerUnit(5), 10);
  assert.equal(dxfMillimetersPerUnit(1), 25.4);
  assert.equal(dxfMillimetersPerUnit(6), 1_000);
});
