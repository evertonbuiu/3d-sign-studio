import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import opentype from "opentype.js";
import { ShapePath } from "three";

import { buildSign } from "../src/lib/sign/build.ts";
import { DEFAULT_PARAMS, getStyle } from "../src/lib/sign/model.ts";

function glyphShapes(font, text, height) {
  const capUnits = font.tables?.os2?.sCapHeight || font.unitsPerEm * 0.7;
  const fontSize = (height * font.unitsPerEm) / capUnits;
  const path = new ShapePath();
  for (const cmd of font.getPath(text, 0, 0, fontSize).commands) {
    if (cmd.type === "M") path.moveTo(cmd.x, -cmd.y);
    else if (cmd.type === "L") path.lineTo(cmd.x, -cmd.y);
    else if (cmd.type === "C") path.bezierCurveTo(cmd.x1, -cmd.y1, cmd.x2, -cmd.y2, cmd.x, -cmd.y);
    else if (cmd.type === "Q") path.quadraticCurveTo(cmd.x1, -cmd.y1, cmd.x, -cmd.y);
    else if (cmd.type === "Z") path.currentPath?.closePath();
  }
  return path.toShapes();
}

function topology(geometry, precision = 1e5) {
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = source.getAttribute("position");
  const edges = new Map();
  const parent = new Map();
  const key = (i) =>
    `${Math.round(position.getX(i) * precision)},${Math.round(position.getY(i) * precision)},${Math.round(position.getZ(i) * precision)}`;
  const find = (value) => {
    let root = value;
    while (parent.get(root) !== root) root = parent.get(root);
    while (value !== root) {
      const next = parent.get(value);
      parent.set(value, root);
      value = next;
    }
    return root;
  };
  const union = (a, b) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    parent.set(find(a), find(b));
  };
  for (let i = 0; i < position.count; i += 3) {
    const vertices = [key(i), key(i + 1), key(i + 2)];
    union(vertices[0], vertices[1]);
    union(vertices[1], vertices[2]);
    for (let e = 0; e < 3; e++) {
      const pair = [vertices[e], vertices[(e + 1) % 3]].sort().join("|");
      edges.set(pair, (edges.get(pair) || 0) + 1);
    }
  }
  return {
    boundary: [...edges.values()].filter((count) => count === 1).length,
    nonManifold: [...edges.values()].filter((count) => count > 2).length,
    components: new Set([...parent.keys()].map(find)).size,
  };
}

const archivo = opentype.parse(
  fs.readFileSync(new URL("../src/assets/fonts/archivo-black.ttf", import.meta.url)).buffer,
);

test("a letra G gera componentes fechados e manifold", () => {
  const params = { ...DEFAULT_PARAMS, text: "G", mountHoles: false };
  const build = buildSign(
    glyphShapes(archivo, "G", params.letterHeight),
    params,
    getStyle("caixa-iluminada"),
  );
  const failures = build.parts
    .filter((part) => part.kind !== "canal-led")
    .map((part) => ({ part: part.kind, ...topology(part.geometry) }));
  assert.deepEqual(
    failures,
    failures.map((item) => ({ ...item, boundary: 0, nonManifold: 0, components: 1 })),
  );
});

test("fundo impresso e laterais formam uma unica peca", () => {
  const style = getStyle("fundo-impresso-frente-acrilica");
  const params = { ...DEFAULT_PARAMS, ...style.preset, text: "G", mountHoles: true };
  const build = buildSign(glyphShapes(archivo, "G", params.letterHeight), params, style);
  const body = build.parts.filter((part) =>
    ["fundo", "laterais", "fundo-laterais"].includes(part.id),
  );
  assert.equal(body.length, 1);
  assert.equal(body[0]?.id, "fundo-laterais");
  assert.deepEqual(topology(body[0].geometry), {
    boundary: 0,
    nonManifold: 0,
    components: 1,
  });
});

test("frente impressa e laterais formam uma unica peca com fundo separado", () => {
  const style = getStyle("fundo-acrilico-frente-impressa");
  const params = { ...DEFAULT_PARAMS, ...style.preset, text: "G", mountHoles: true };
  const build = buildSign(glyphShapes(archivo, "G", params.letterHeight), params, style);
  const printedBody = build.parts.find((part) => part.id === "frente-laterais");
  assert.ok(printedBody);
  assert.deepEqual(topology(printedBody.geometry), {
    boundary: 0,
    nonManifold: 0,
    components: 1,
  });
  assert.equal(build.parts.filter((part) => part.kind === "frente").length, 0);
  assert.equal(build.parts.filter((part) => part.kind === "fundo").length, 1);
});
