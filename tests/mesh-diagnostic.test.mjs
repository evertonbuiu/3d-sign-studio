import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import opentype from "opentype.js";
import { Box2, ShapePath, Vector2 } from "three";

import { buildSign } from "../src/lib/sign/build.ts";
import { DEFAULT_PARAMS, STYLES, getStyle, paramsForStyle } from "../src/lib/sign/model.ts";
import { partSupportsCutConnector, splitGeometryByPlane } from "../src/lib/sign/split.ts";

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

function outwardFrontTriangles(geometry) {
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = source.getAttribute("position");
  let maxZ = -Infinity;
  for (let i = 0; i < position.count; i++) maxZ = Math.max(maxZ, position.getZ(i));
  let outward = 0;
  for (let i = 0; i < position.count; i += 3) {
    const z0 = position.getZ(i);
    const z1 = position.getZ(i + 1);
    const z2 = position.getZ(i + 2);
    if ([z0, z1, z2].some((z) => Math.abs(z - maxZ) > 1e-5)) continue;
    const abx = position.getX(i + 1) - position.getX(i);
    const aby = position.getY(i + 1) - position.getY(i);
    const acx = position.getX(i + 2) - position.getX(i);
    const acy = position.getY(i + 2) - position.getY(i);
    if (abx * acy - aby * acx > 0) outward++;
  }
  return outward;
}

function frontCoversPoint(geometry, point) {
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = source.getAttribute("position");
  let maxZ = -Infinity;
  for (let i = 0; i < position.count; i++) maxZ = Math.max(maxZ, position.getZ(i));
  const side = (px, py, ax, ay, bx, by) => (px - bx) * (ay - by) - (ax - bx) * (py - by);
  for (let i = 0; i < position.count; i += 3) {
    if ([0, 1, 2].some((offset) => Math.abs(position.getZ(i + offset) - maxZ) > 1e-5)) {
      continue;
    }
    const d1 = side(
      point.x,
      point.y,
      position.getX(i),
      position.getY(i),
      position.getX(i + 1),
      position.getY(i + 1),
    );
    const d2 = side(
      point.x,
      point.y,
      position.getX(i + 1),
      position.getY(i + 1),
      position.getX(i + 2),
      position.getY(i + 2),
    );
    const d3 = side(
      point.x,
      point.y,
      position.getX(i + 2),
      position.getY(i + 2),
      position.getX(i),
      position.getY(i),
    );
    if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return true;
  }
  return false;
}

function backCoversPoint(geometry, point) {
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = source.getAttribute("position");
  let minZ = Infinity;
  for (let i = 0; i < position.count; i++) minZ = Math.min(minZ, position.getZ(i));
  const side = (px, py, ax, ay, bx, by) => (px - bx) * (ay - by) - (ax - bx) * (py - by);
  for (let i = 0; i < position.count; i += 3) {
    if ([0, 1, 2].some((offset) => Math.abs(position.getZ(i + offset) - minZ) > 1e-5)) continue;
    const d1 = side(
      point.x,
      point.y,
      position.getX(i),
      position.getY(i),
      position.getX(i + 1),
      position.getY(i + 1),
    );
    const d2 = side(
      point.x,
      point.y,
      position.getX(i + 1),
      position.getY(i + 1),
      position.getX(i + 2),
      position.getY(i + 2),
    );
    const d3 = side(
      point.x,
      point.y,
      position.getX(i + 2),
      position.getY(i + 2),
      position.getX(i),
      position.getY(i),
    );
    if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return true;
  }
  return false;
}

function surfaceCoversPointAtZ(geometry, point, targetZ) {
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = source.getAttribute("position");
  const side = (px, py, ax, ay, bx, by) => (px - bx) * (ay - by) - (ax - bx) * (py - by);
  for (let i = 0; i < position.count; i += 3) {
    if ([0, 1, 2].some((offset) => Math.abs(position.getZ(i + offset) - targetZ) > 1e-5)) continue;
    const d1 = side(
      point.x,
      point.y,
      position.getX(i),
      position.getY(i),
      position.getX(i + 1),
      position.getY(i + 1),
    );
    const d2 = side(
      point.x,
      point.y,
      position.getX(i + 1),
      position.getY(i + 1),
      position.getX(i + 2),
      position.getY(i + 2),
    );
    const d3 = side(
      point.x,
      point.y,
      position.getX(i + 2),
      position.getY(i + 2),
      position.getX(i),
      position.getY(i),
    );
    if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return true;
  }
  return false;
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

test("plano manual corta todas as malhas reais da letra sem lanÃ§ar erro", () => {
  const params = { ...DEFAULT_PARAMS, text: "G", mountHoles: false };
  const build = buildSign(
    glyphShapes(archivo, "G", params.letterHeight),
    params,
    getStyle("caixa-iluminada"),
  );
  for (const part of build.parts) {
    const pieces = splitGeometryByPlane(part.geometry, { angle: 90, offset: 0 });
    assert.ok(pieces.length >= 1, `${part.id} nÃ£o produziu segmentos`);
  }
});

test("corte das paredes nao tampa o vazio interno da letra", () => {
  const params = { ...DEFAULT_PARAMS, text: "O", mountHoles: false };
  const build = buildSign(glyphShapes(archivo, "O", params.letterHeight), params, getStyle("caixa-iluminada"));
  const walls = build.parts.find((part) => part.kind === "laterais");
  assert.ok(walls);
  walls.geometry.computeBoundingBox();
  const bounds = walls.geometry.boundingBox;
  const centerX = (bounds.min.x + bounds.max.x) / 2;
  const centerY = (bounds.min.y + bounds.max.y) / 2;
  const pieces = splitGeometryByPlane(walls.geometry, {
    angle: 0,
    origin: { x: centerX, y: centerY },
    connector: "male-female",
    connectorDepth: 4,
    connectorThickness: params.depth * 0.6,
    connectorClearance: 0.2,
  });
  const sampleZ = (bounds.min.z + bounds.max.z) / 2;
  const coversCavity = pieces.some((piece) => {
    const position = (piece.geometry.index ? piece.geometry.toNonIndexed() : piece.geometry).getAttribute("position");
    for (let i = 0; i + 2 < position.count; i += 3) {
      if (![position.getX(i), position.getX(i + 1), position.getX(i + 2)].every((x) => Math.abs(x - centerX) < 1e-4)) continue;
      const ay = position.getY(i), az = position.getZ(i), by = position.getY(i + 1), bz = position.getZ(i + 1), cy = position.getY(i + 2), cz = position.getZ(i + 2);
      const d1 = (centerY - by) * (az - bz) - (ay - by) * (sampleZ - bz);
      const d2 = (centerY - cy) * (bz - cz) - (by - cy) * (sampleZ - cz);
      const d3 = (centerY - ay) * (cz - az) - (cy - ay) * (sampleZ - az);
      if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return true;
    }
    return false;
  });
  assert.equal(coversCavity, false, "o rebaixo criou uma tampa sobre o vazio interno");
});

test("encaixe macho e fÃªmea Ã© gerado nas paredes de uma palavra", () => {
  const params = { ...DEFAULT_PARAMS, text: "LUMINA", mountHoles: false };
  const build = buildSign(
    glyphShapes(archivo, params.text, params.letterHeight),
    params,
    getStyle("caixa-iluminada"),
  );
  const target = build.parts.find((part) => part.kind === "laterais");
  assert.ok(target);
  const plainPieces = splitGeometryByPlane(target.geometry, { angle: 90 });
  const pieces = splitGeometryByPlane(target.geometry, {
    angle: 90,
    connector: "male-female",
    maleSide: "part-1",
    connectorDepth: 4,
    connectorWidth: 100,
    connectorThickness: 3,
    connectorClearance: 0.2,
  });
  assert.equal(pieces.length, 2);
  assert.equal(plainPieces.length, 2);
  plainPieces[0].geometry.computeBoundingBox();
  pieces[0].geometry.computeBoundingBox();
  assert.ok(
    pieces[0].geometry.boundingBox.max.y >= plainPieces[0].geometry.boundingBox.max.y + 3.9,
    "a lingueta macho deve avanÃ§ar pela profundidade configurada",
  );
  for (const piece of pieces) {
    const position = piece.geometry.getAttribute("position");
    assert.ok(position.count > 0);
    for (let i = 0; i < position.count; i++) {
      assert.ok(Number.isFinite(position.getX(i)));
      assert.ok(Number.isFinite(position.getY(i)));
      assert.ok(Number.isFinite(position.getZ(i)));
    }
  }
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

test("frente acrilica e fundo impresso preservam os vazados internos", () => {
  const shapes = glyphShapes(archivo, "D", DEFAULT_PARAMS.letterHeight);
  const bounds = new Box2();
  for (const shape of shapes) bounds.union(new Box2().setFromPoints(shape.getPoints(24)));
  const center = bounds.getCenter(new Vector2());
  const holePoints = shapes[0].holes[0].getPoints(24);
  const holeCenter = holePoints
    .reduce((sum, point) => sum.add(point), new Vector2())
    .multiplyScalar(1 / holePoints.length)
    .sub(center);
  const style = getStyle("fundo-impresso-frente-acrilica");
  const params = { ...DEFAULT_PARAMS, ...style.preset, text: "D", mountHoles: false };
  const build = buildSign(shapes, params, style);
  const front = build.parts.find((part) => part.kind === "frente");
  const printedBack = build.parts.find((part) => part.id === "fundo-laterais");
  assert.ok(front && printedBack);
  assert.equal(frontCoversPoint(front.geometry, holeCenter), false);
  assert.equal(backCoversPoint(printedBack.geometry, holeCenter), false);
  assert.equal(
    surfaceCoversPointAtZ(printedBack.geometry, holeCenter, params.backThickness),
    false,
  );
  assert.deepEqual(topology(front.geometry), {
    boundary: 0,
    nonManifold: 0,
    components: 1,
  });
  assert.deepEqual(topology(printedBack.geometry), {
    boundary: 0,
    nonManifold: 0,
    components: 1,
  });
});

test("Neon Flex gera fundo e paredes unidos sem tampa", () => {
  const style = getStyle("neon-flex-fundo-impresso");
  assert.equal(style.name, "Neon Flex â€” Fundo Impresso sem Tampa");
  const params = {
    ...DEFAULT_PARAMS,
    ...style.preset,
    text: "G",
    backThickness: 2.6,
    neonFlexThickness: 10,
  };
  const build = buildSign(glyphShapes(archivo, "I", params.letterHeight), params, style);
  const body = build.parts.find((part) => part.id === "fundo-laterais");
  assert.ok(body);
  assert.equal(
    build.parts.some((part) => part.kind === "frente"),
    false,
  );
  assert.equal(
    build.parts.some((part) => part.id === "fundo"),
    false,
  );
  assert.deepEqual(topology(body.geometry), {
    boundary: 0,
    nonManifold: 0,
    components: 1,
  });
  body.geometry.computeBoundingBox();
  assert.ok(Math.abs((body.geometry.boundingBox?.min.z ?? -1) - 0) < 1e-5);
  assert.ok(
    Math.abs(
      (body.geometry.boundingBox?.max.z ?? -1) - (params.backThickness + params.neonFlexThickness),
    ) < 1e-5,
  );

  // O miolo da letra permanece vazio: o fundo acompanha apenas o contorno.
  const source = body.geometry.index ? body.geometry.toNonIndexed() : body.geometry;
  const position = source.getAttribute("position");
  const centerX =
    ((body.geometry.boundingBox?.min.x ?? 0) + (body.geometry.boundingBox?.max.x ?? 0)) / 2;
  const centerY =
    ((body.geometry.boundingBox?.min.y ?? 0) + (body.geometry.boundingBox?.max.y ?? 0)) / 2;
  const containsCenter = (ax, ay, bx, by, cx, cy) => {
    const sign = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
    const d1 = sign(centerX, centerY, ax, ay, bx, by);
    const d2 = sign(centerX, centerY, bx, by, cx, cy);
    const d3 = sign(centerX, centerY, cx, cy, ax, ay);
    return !(d1 < 0 || d2 < 0 || d3 < 0) || !(d1 > 0 || d2 > 0 || d3 > 0);
  };
  let centerHasBottom = false;
  for (let i = 0; i < position.count; i += 3) {
    if ([0, 1, 2].some((offset) => Math.abs(position.getZ(i + offset)) > 1e-5)) continue;
    if (
      containsCenter(
        position.getX(i),
        position.getY(i),
        position.getX(i + 1),
        position.getY(i + 1),
        position.getX(i + 2),
        position.getY(i + 2),
      )
    ) {
      centerHasBottom = true;
      break;
    }
  }
  assert.equal(centerHasBottom, false);
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
  assert.ok(outwardFrontTriangles(printedBody.geometry) > 0);
  assert.equal(build.parts.filter((part) => part.kind === "frente").length, 0);
  assert.equal(build.parts.filter((part) => part.kind === "fundo").length, 1);
});

test("encaixe da peca unificada fica somente nas paredes e nao invade a frente", () => {
  const style = getStyle("fundo-acrilico-frente-impressa");
  const params = { ...DEFAULT_PARAMS, ...style.preset, text: "G", mountHoles: false };
  const build = buildSign(glyphShapes(archivo, "G", params.letterHeight), params, style);
  const body = build.parts.find((part) => part.id === "frente-laterais");
  assert.ok(body);
  body.geometry.computeBoundingBox();
  const bounds = body.geometry.boundingBox;
  const centerX = (bounds.min.x + bounds.max.x) / 2;
  const pieces = splitGeometryByPlane(body.geometry, {
    angle: 0,
    connector: "male-female",
    connectorDepth: 4,
    connectorWidth: 50,
    connectorClearance: 0.2,
    connectorFrontInset: params.faceThickness,
  });
  assert.equal(pieces.length, 2);
  const male = pieces[0].geometry.index ? pieces[0].geometry.toNonIndexed() : pieces[0].geometry;
  const position = male.getAttribute("position");
  let connectorVertices = 0;
  for (let index = 0; index < position.count; index++) {
    if (position.getX(index) <= centerX + 1e-4) continue;
    connectorVertices++;
    assert.ok(
      position.getZ(index) <= bounds.max.z - params.faceThickness + 1e-4,
      "o encaixe macho entrou na espessura da frente impressa",
    );
  }
  assert.ok(connectorVertices > 0, "o encaixe macho deve continuar presente nas paredes");
});

test("frentes impressas preservam os vazados internos das letras", () => {
  const shapes = glyphShapes(archivo, "D", DEFAULT_PARAMS.letterHeight);
  const bounds = new Box2();
  for (const shape of shapes) bounds.union(new Box2().setFromPoints(shape.getPoints(24)));
  const center = bounds.getCenter(new Vector2());
  const holePoints = shapes[0].holes[0].getPoints(24);
  const holeCenter = holePoints
    .reduce((sum, point) => sum.add(point), new Vector2())
    .multiplyScalar(1 / holePoints.length)
    .sub(center);

  for (const styleId of ["fundo-acrilico-frente-impressa", "fundo-impresso-frente-impressa-aba"]) {
    const style = getStyle(styleId);
    const params = { ...DEFAULT_PARAMS, ...style.preset, text: "D", mountHoles: false };
    const build = buildSign(shapes, params, style);
    const printedFront = build.parts.find((part) => part.id === "frente-laterais");
    assert.ok(printedFront);
    assert.equal(frontCoversPoint(printedFront.geometry, holeCenter), false, styleId);
    assert.deepEqual(topology(printedFront.geometry), {
      boundary: 0,
      nonManifold: 0,
      components: 1,
    });
  }
});

test("frente impressa com paredes encaixa no fundo impresso com aba", () => {
  const style = getStyle("fundo-impresso-frente-impressa-aba");
  assert.equal(style.name, "Fundo Impresso + Frente Impressa com Aba");
  const params = {
    ...DEFAULT_PARAMS,
    ...style.preset,
    text: "G",
    backThickness: 2.8,
    backFlangeWidth: 4.5,
    backFlangeThickness: 6,
    clearance: 0.35,
  };
  const build = buildSign(glyphShapes(archivo, "G", params.letterHeight), params, style);
  const frontWalls = build.parts.find((part) => part.id === "frente-laterais");
  const backInsert = build.parts.find((part) => part.id === "fundo");
  assert.ok(frontWalls && backInsert);
  assert.equal(build.parts.filter((part) => part.kind === "frente").length, 0);
  assert.deepEqual(topology(frontWalls.geometry), {
    boundary: 0,
    nonManifold: 0,
    components: 1,
  });
  assert.deepEqual(topology(backInsert.geometry), {
    boundary: 0,
    nonManifold: 0,
    components: 1,
  });
  frontWalls.geometry.computeBoundingBox();
  backInsert.geometry.computeBoundingBox();
  assert.equal(frontWalls.geometry.boundingBox?.max.z, params.depth);
  assert.ok(
    Math.abs(
      (backInsert.geometry.boundingBox?.max.z ?? 0) -
        (params.backThickness + params.backFlangeThickness),
    ) < 1e-5,
  );
});

test("fundo impresso com frente impressa recebe encaixe somente nas paredes da frente", () => {
  const style = getStyle("fundo-impresso-frente-impressa-aba");
  const params = { ...DEFAULT_PARAMS, ...style.preset, text: "G", mountHoles: false };
  const build = buildSign(glyphShapes(archivo, "G", params.letterHeight), params, style);
  const frontWalls = build.parts.find((part) => part.id === "frente-laterais");
  const back = build.parts.find((part) => part.id === "fundo");
  assert.ok(frontWalls && back);
  const hasWalls = build.parts.some((part) => part.kind === "laterais");
  assert.equal(partSupportsCutConnector(frontWalls.kind, hasWalls), true);
  assert.equal(partSupportsCutConnector(back.kind, hasWalls), false);

  const frontPieces = splitGeometryByPlane(frontWalls.geometry, {
    angle: 0,
    connector: "male-female",
    connectorDepth: 4,
    connectorWidth: 50,
    connectorClearance: 0.2,
    connectorFrontInset: params.faceThickness,
  });
  const plainFrontPieces = splitGeometryByPlane(frontWalls.geometry, { angle: 0 });
  const backPieces = splitGeometryByPlane(back.geometry, { angle: 0, connector: "none" });
  assert.equal(frontPieces.length, 2);
  assert.equal(backPieces.length, 2);
  frontPieces[0].geometry.computeBoundingBox();
  plainFrontPieces[0].geometry.computeBoundingBox();
  backPieces[0].geometry.computeBoundingBox();
  frontWalls.geometry.computeBoundingBox();
  back.geometry.computeBoundingBox();
  assert.ok(
    frontPieces[0].geometry.boundingBox.max.x >=
      plainFrontPieces[0].geometry.boundingBox.max.x + 3.9,
  );
  assert.ok(backPieces[0].geometry.boundingBox.max.x <= back.geometry.boundingBox.max.x + 1e-4);
  const cutLimit = plainFrontPieces[0].geometry.boundingBox.max.x;
  const frontPosition = frontPieces[0].geometry.getAttribute("position");
  const connectorZ = [];
  for (let index = 0; index < frontPosition.count; index++) {
    if (frontPosition.getX(index) > cutLimit + 0.1) connectorZ.push(frontPosition.getZ(index));
  }
  assert.ok(connectorZ.length > 0, "o macho deve prolongar as paredes cortadas");
  assert.ok(Math.abs(Math.min(...connectorZ) - 1) < 1e-3);
  assert.ok(
    Math.abs(Math.max(...connectorZ) - (params.depth - params.faceThickness)) < 1e-3,
    "o encaixe deve terminar sob a frente impressa, como no modelo SKP",
  );
});

test("encaixe da frente impressa nao fecha o canal entre paredes", () => {
  const style = getStyle("fundo-impresso-frente-impressa-aba");
  const params = { ...DEFAULT_PARAMS, ...style.preset, text: "LUMINA", mountHoles: false };
  const build = buildSign(glyphShapes(archivo, params.text, params.letterHeight), params, style);
  const frontWalls = build.parts.find((part) => part.id === "frente-laterais");
  assert.ok(frontWalls);
  frontWalls.geometry.computeBoundingBox();
  const bounds = frontWalls.geometry.boundingBox;

  for (const { angle, offset } of [
    { angle: 0, offset: 0 },
    { angle: 90, offset: 0 },
    { angle: 45, offset: -80 },
  ]) {
    const radians = (angle * Math.PI) / 180;
    const centerX = (bounds.min.x + bounds.max.x) / 2;
    const centerY = (bounds.min.y + bounds.max.y) / 2;
    const plane = Math.cos(radians) * centerX + Math.sin(radians) * centerY + offset;
    const pieces = splitGeometryByPlane(frontWalls.geometry, {
      angle,
      offset,
      connector: "male-female",
      connectorDepth: 4,
      connectorWidth: 50,
      connectorClearance: 0.2,
      connectorFrontInset: params.faceThickness,
    });
    const female = pieces[1].geometry.index
      ? pieces[1].geometry.toNonIndexed()
      : pieces[1].geometry;
    const position = female.getAttribute("position");
    let closedBackTriangles = 0;
    let closedFrontTriangles = 0;
    for (let index = 0; index + 2 < position.count; index += 3) {
      const normalValues = [0, 1, 2].map((vertexOffset) =>
        Math.cos(radians) * position.getX(index + vertexOffset) +
        Math.sin(radians) * position.getY(index + vertexOffset));
      const zValues = [0, 1, 2].map((offset) => position.getZ(index + offset));
      if (!normalValues.every((value) => Math.abs(value - plane) < 1e-3)) continue;
      if (Math.max(...zValues) <= 1 + 1e-3) closedBackTriangles++;
      if (Math.min(...zValues) >= params.depth - params.faceThickness - 1e-3) {
        closedFrontTriangles++;
      }
      if (
        Math.min(...zValues) < 0.9 ||
        Math.max(...zValues) > params.depth - params.faceThickness - 0.01
      ) continue;
      const tangentValues = [0, 1, 2].map((vertexOffset) =>
        -Math.sin(radians) * position.getX(index + vertexOffset) +
        Math.cos(radians) * position.getY(index + vertexOffset));
      assert.ok(
        Math.max(...tangentValues) - Math.min(...tangentValues) < 10,
        `o corte a ${angle} graus criou uma tampa atravessando o canal`,
      );
    }
    assert.ok(closedBackTriangles > 0, `o corte a ${angle} graus deixou o fundo da parede aberto`);
    assert.ok(closedFrontTriangles > 0, `o corte a ${angle} graus deixou a frente impressa aberta`);
  }
});

test("frente e fundo acrilicos ficam separados com rebaixo duplo", () => {
  const style = getStyle("fundo-acrilico-frente-acrilica");
  const params = {
    ...DEFAULT_PARAMS,
    ...style.preset,
    text: "G",
    mountHoles: false,
    faceRecess: false,
  };
  const build = buildSign(glyphShapes(archivo, "G", params.letterHeight), params, style);
  const back = build.parts.find((part) => part.kind === "fundo");
  const walls = build.parts.find((part) => part.kind === "laterais");
  const front = build.parts.find((part) => part.kind === "frente");
  assert.ok(back && walls && front);
  assert.deepEqual(topology(walls.geometry), {
    boundary: 0,
    nonManifold: 0,
    components: 1,
  });
  walls.geometry.computeBoundingBox();
  back.geometry.computeBoundingBox();
  front.geometry.computeBoundingBox();
  assert.equal(walls.geometry.boundingBox?.min.z, 0);
  assert.equal(walls.geometry.boundingBox?.max.z, params.depth);
  assert.ok(Math.abs((back.geometry.boundingBox?.max.z ?? 0) - params.backThickness) < 1e-5);
  assert.equal(front.geometry.boundingBox?.min.z, params.depth - params.faceThickness);
});

test("novo estilo usa fundo acrilico apoiado por aba interna", () => {
  const style = getStyle("fundo-acrilico-frente-acrilica-aba");
  assert.equal(style.name, "Fundo AcrÃ­lico + Frente AcrÃ­lica com Aba");
  const params = {
    ...DEFAULT_PARAMS,
    ...style.preset,
    text: "G",
    mountHoles: false,
    backThickness: 1.4,
    backFlangeWidth: 5,
    backFlangeThickness: 4,
  };
  const build = buildSign(glyphShapes(archivo, "G", params.letterHeight), params, style);
  const back = build.parts.find((part) => part.kind === "fundo");
  const walls = build.parts.find((part) => part.kind === "laterais");
  const front = build.parts.find((part) => part.kind === "frente");
  assert.ok(back && walls && front);
  assert.deepEqual(topology(walls.geometry), {
    boundary: 0,
    nonManifold: 0,
    components: 1,
  });
  const wallPositions = walls.geometry.getAttribute("position");
  const flangeEnd = params.backFlangeThickness;
  assert.ok(
    Array.from({ length: wallPositions.count }, (_, index) => wallPositions.getZ(index)).some(
      (z) => Math.abs(z - flangeEnd) < 1e-5,
    ),
  );
  back.geometry.computeBoundingBox();
  front.geometry.computeBoundingBox();
  assert.ok(Math.abs((back.geometry.boundingBox?.min.z ?? 0) - params.backFlangeThickness) < 1e-5);
  assert.ok(
    Math.abs(
      (back.geometry.boundingBox?.max.z ?? 0) - (params.backFlangeThickness + params.backThickness),
    ) < 1e-5,
  );
  assert.equal(front.geometry.boundingBox?.min.z, params.depth - params.faceThickness);
});

test("estilo acrilico com aba tem preset completo e estilos removidos nao retornam", () => {
  const removed = new Set([
    "fundo-impresso-tampa-acrilica",
    "frente-petg",
    "frente-acrilico-leitoso",
  ]);
  assert.equal(
    STYLES.some((style) => removed.has(style.id)),
    false,
  );

  const style = getStyle("fundo-acrilico-frente-acrilica-aba");
  const contaminatedBase = {
    ...DEFAULT_PARAMS,
    wall: 9,
    clearance: 1.4,
    recessLip: 0.4,
    faceRecess: false,
    led: false,
  };
  const params = paramsForStyle(style, contaminatedBase);
  assert.deepEqual(
    {
      depth: params.depth,
      wall: params.wall,
      backThickness: params.backThickness,
      faceThickness: params.faceThickness,
      clearance: params.clearance,
      faceRecess: params.faceRecess,
      recessLip: params.recessLip,
      backFlangeWidth: params.backFlangeWidth,
      backFlangeThickness: params.backFlangeThickness,
      led: params.led,
    },
    {
      depth: 45,
      wall: 2.4,
      backThickness: 3,
      faceThickness: 3,
      clearance: 0.3,
      faceRecess: true,
      recessLip: 1.2,
      backFlangeWidth: 4,
      backFlangeThickness: 2.4,
      led: true,
    },
  );
});

