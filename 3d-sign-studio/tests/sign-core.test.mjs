import assert from "node:assert/strict";
import test from "node:test";

import { BufferGeometry, Float32BufferAttribute } from "three";

import { computeCost } from "../src/lib/sign/cost.ts";
import { DEFAULT_PARAMS } from "../src/lib/sign/model.ts";
import { geometriesToStl, slugify } from "../src/lib/sign/stl.ts";

const build = {
  parts: [],
  outlines: [],
  width: 100,
  height: 50,
  depth: 20,
  ledLengthMm: 2_000,
  totalVolumeCm3: 100,
  printedVolumeCm3: 100,
};

test("calcula custo, LED e margem", () => {
  const result = computeCost(build, DEFAULT_PARAMS);
  assert.equal(result.weightG, 124);
  assert.equal(result.ledCost, 56);
  assert.ok(Math.abs(result.total - result.subtotal * 1.45) < 1e-9);
});

test("gera STL binário com a contagem correta", () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  const result = geometriesToStl([geometry]);
  assert.equal(result.byteLength, 134);
  assert.equal(new DataView(result).getUint32(80, true), 1);
});

test("normaliza nomes de arquivo", () => {
  assert.equal(slugify("Letra São João!"), "letra-sao-joao");
  assert.equal(slugify("***"), "projeto");
});
