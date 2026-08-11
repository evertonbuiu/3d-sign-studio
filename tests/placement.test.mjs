import assert from "node:assert/strict";
import test from "node:test";

import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Vector3 } from "three";

import {
  transformGeometryForPlacement,
  transformPlacementPoint,
} from "../src/lib/sign/placement.ts";

test("rotaciona o modelo inteiro ao redor do centro", () => {
  const transformed = transformGeometryForPlacement(
    new BoxGeometry(40, 20, 10),
    { rotation: 90, mirrorX: false, mirrorY: false },
    { x: 0, y: 0 },
  );
  const size = transformed.boundingBox.getSize(new Vector3());
  assert.ok(Math.abs(size.x - 20) < 1e-5);
  assert.ok(Math.abs(size.y - 40) < 1e-5);
  assert.ok(Math.abs(size.z - 10) < 1e-5);
});

test("espelha horizontal e verticalmente ao redor da origem escolhida", () => {
  const horizontal = transformPlacementPoint(
    { x: 15, y: 8 },
    { rotation: 0, mirrorX: true, mirrorY: false },
    { x: 10, y: 5 },
  );
  const vertical = transformPlacementPoint(
    { x: 15, y: 8 },
    { rotation: 0, mirrorX: false, mirrorY: true },
    { x: 10, y: 5 },
  );
  assert.deepEqual(horizontal.toArray(), [5, 8]);
  assert.deepEqual(vertical.toArray(), [15, 2]);
});

test("preserva a orientacao das faces depois de um unico espelho", () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute([1, 0, 0, 3, 0, 0, 1, 2, 0], 3),
  );
  const transformed = transformGeometryForPlacement(
    geometry,
    { rotation: 0, mirrorX: true, mirrorY: false },
    { x: 0, y: 0 },
  );
  const position = transformed.getAttribute("position");
  const a = new Vector3(position.getX(0), position.getY(0), position.getZ(0));
  const b = new Vector3(position.getX(1), position.getY(1), position.getZ(1));
  const c = new Vector3(position.getX(2), position.getY(2), position.getZ(2));
  const normal = b.clone().sub(a).cross(c.clone().sub(a));
  assert.ok(normal.z > 0);
  assert.equal(transformed.boundingBox.min.x, -3);
  assert.equal(transformed.boundingBox.max.x, -1);
});
