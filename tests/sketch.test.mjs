import assert from "node:assert/strict";
import test from "node:test";

import {
  addEntity,
  canRedo,
  canUndo,
  commitSketch,
  createSketchHistory,
  entityPoints,
  extrudeSketchEntity,
  isClosedProfile,
  parseSketch,
  redoSketch,
  removeEntities,
  selectEntity,
  serializeSketch,
  setExtrusion,
  snapPoint,
  undoSketch,
} from "../src/lib/sign/sketch.ts";

const rect = { id: "r1", type: "rect", x: 0, y: 0, width: 40, height: 20 };
const circle = { id: "c1", type: "circle", cx: 5, cy: 5, radius: 10 };
const openLine = { id: "l1", type: "polyline", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], closed: false };
const closedTriangle = {
  id: "t1",
  type: "polyline",
  points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }],
  closed: true,
};

test("detecta perfis fechados e abertos", () => {
  assert.equal(isClosedProfile(rect), true);
  assert.equal(isClosedProfile(circle), true);
  assert.equal(isClosedProfile(closedTriangle), true);
  assert.equal(isClosedProfile(openLine), false);
  assert.equal(
    isClosedProfile({ id: "z", type: "polyline", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], closed: true }),
    false,
  );
});

test("retângulo gera quatro vértices", () => {
  assert.equal(entityPoints(rect).length, 4);
});

test("estado do esboço adiciona, seleciona e remove entidades", () => {
  let history = createSketchHistory();
  history = commitSketch(history, (state) => addEntity(state, rect));
  history = commitSketch(history, (state) => addEntity(state, openLine));
  assert.equal(history.present.entities.length, 2);
  assert.deepEqual(history.present.selectedIds, ["l1"]);

  history = commitSketch(history, (state) => selectEntity(state, "r1"));
  assert.deepEqual(history.present.selectedIds, ["r1"]);
  history = commitSketch(history, (state) => selectEntity(state, "l1", true));
  assert.deepEqual(history.present.selectedIds, ["r1", "l1"]);

  history = commitSketch(history, (state) => removeEntities(state, ["l1"]));
  assert.equal(history.present.entities.length, 1);
});

test("desfazer e refazer operações do esboço", () => {
  let history = createSketchHistory();
  assert.equal(canUndo(history), false);
  history = commitSketch(history, (state) => addEntity(state, rect));
  assert.equal(canUndo(history), true);
  history = undoSketch(history);
  assert.equal(history.present.entities.length, 0);
  assert.equal(canRedo(history), true);
  history = redoSketch(history);
  assert.equal(history.present.entities.length, 1);
});

test("extrusão só ocorre em perfis fechados", () => {
  let history = createSketchHistory();
  history = commitSketch(history, (state) => addEntity(state, rect));
  history = commitSketch(history, (state) => addEntity(state, openLine));
  history = commitSketch(history, (state) => setExtrusion(state, "l1", 12));
  assert.equal(history.present.extrusions.length, 0);
  history = commitSketch(history, (state) => setExtrusion(state, "r1", 12));
  assert.equal(history.present.extrusions.length, 1);
  history = commitSketch(history, (state) => setExtrusion(state, "r1", 25));
  assert.equal(history.present.extrusions.length, 1);
  assert.equal(history.present.extrusions[0].height, 25);
  history = commitSketch(history, (state) => removeEntities(state, ["r1"]));
  assert.equal(history.present.extrusions.length, 0);
});

test("extrusão gera geometria 3D com a altura pedida", () => {
  const geometry = extrudeSketchEntity(rect, 15);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  assert.ok(Math.abs(box.max.z - box.min.z - 15) < 1e-6);
  assert.ok(Math.abs(box.max.x - box.min.x - 40) < 1e-6);
  assert.equal(extrudeSketchEntity(openLine, 10), null);
});

test("snap prioriza pontos finais e depois a grade", () => {
  const options = { gridEnabled: true, gridSize: 5, endpointEnabled: true, tolerance: 3 };
  const onEndpoint = snapPoint({ x: 39, y: 1 }, [rect], options);
  assert.deepEqual(onEndpoint, { x: 40, y: 0 });
  const onGrid = snapPoint({ x: 101.2, y: 98.4 }, [rect], options);
  assert.deepEqual(onGrid, { x: 100, y: 100 });
  const free = snapPoint(
    { x: 101.2, y: 98.4 },
    [rect],
    { gridEnabled: false, gridSize: 5, endpointEnabled: false, tolerance: 3 },
  );
  assert.deepEqual(free, { x: 101.2, y: 98.4 });
});

test("persistência mantém entidades e extrusões e aceita projetos antigos", () => {
  let history = createSketchHistory();
  history = commitSketch(history, (state) => addEntity(state, rect));
  history = commitSketch(history, (state) => addEntity(state, circle));
  history = commitSketch(history, (state) => setExtrusion(state, "c1", 8));
  const payload = JSON.parse(JSON.stringify(serializeSketch(history.present)));
  const restored = parseSketch(payload);
  assert.equal(restored.entities.length, 2);
  assert.equal(restored.extrusions.length, 1);
  assert.equal(restored.extrusions[0].entityId, "c1");
  assert.deepEqual(restored.selectedIds, []);

  assert.deepEqual(parseSketch(undefined).entities, []);
  assert.deepEqual(parseSketch({}).entities, []);
  assert.deepEqual(parseSketch({ entities: [{ type: "bogus" }] }).entities, []);
  assert.equal(parseSketch({ entities: [], extrusions: [{ entityId: "x", height: 4 }] }).extrusions.length, 0);
});
