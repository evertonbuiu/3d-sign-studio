import assert from "node:assert/strict";
import test from "node:test";

import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Vector3 } from "three";

import { computeCost } from "../src/lib/sign/cost.ts";
import { DEFAULT_PARAMS, STYLES, paramsForStyle } from "../src/lib/sign/model.ts";
import {
  DEFAULT_PRINTER,
  getPrinterProfile,
  paramsForPrinter,
  PRINTER_PROFILES,
} from "../src/lib/sign/printers.ts";
import { geometriesToStl, slugify } from "../src/lib/sign/stl.ts";
import {
  clipGeometryByPlaneForPreview,
  splitGeometryByPlane,
  splitGeometryByPlanes,
  splitGeometryForBuildPlate,
} from "../src/lib/sign/split.ts";

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

test("selecionar impressora carrega todos os parâmetros do perfil", () => {
  const selected = getPrinterProfile("bambu-x1c");
  const params = paramsForPrinter("bambu-x1c", {
    ...DEFAULT_PARAMS,
    buildWidth: 1,
    printSpeed: 1,
    printerPower: 1,
  });
  assert.equal(PRINTER_PROFILES.at(-1)?.id, "custom");
  assert.deepEqual(
    {
      printerId: params.printerId,
      buildWidth: params.buildWidth,
      buildDepth: params.buildDepth,
      buildHeight: params.buildHeight,
      nozzleDiameter: params.nozzleDiameter,
      filamentDiameter: params.filamentDiameter,
      maxPrintSpeed: params.maxPrintSpeed,
      printSpeed: params.printSpeed,
      printerPower: params.printerPower,
    },
    selected.params,
  );
});

test("Bambu Lab A1 é a impressora padrão", () => {
  assert.equal(DEFAULT_PRINTER.id, "bambu-a1");
  assert.equal(DEFAULT_PARAMS.printerId, "bambu-a1");
  assert.deepEqual(
    {
      buildWidth: DEFAULT_PARAMS.buildWidth,
      buildDepth: DEFAULT_PARAMS.buildDepth,
      buildHeight: DEFAULT_PARAMS.buildHeight,
      maxPrintSpeed: DEFAULT_PARAMS.maxPrintSpeed,
      printSpeed: DEFAULT_PARAMS.printSpeed,
      printerPower: DEFAULT_PARAMS.printerPower,
    },
    {
      buildWidth: 256,
      buildDepth: 256,
      buildHeight: 256,
      maxPrintSpeed: 500,
      printSpeed: 25,
      printerPower: 350,
    },
  );
});

test("todos os estilos ignoram parâmetros geométricos residuais", () => {
  const contaminated = {
    ...DEFAULT_PARAMS,
    depth: 199,
    wall: 11,
    faceThickness: 17,
    backThickness: 13,
    clearance: 1.4,
    faceRecess: false,
    recessLip: 9,
    backFlangeWidth: 18,
    backFlangeThickness: 14,
    neonFlexThickness: 29,
    led: false,
    ledChannelWidth: 39,
    ledChannelHeight: 28,
    ledOffset: 24,
    ledColor: "#123456",
    ledPowerPerMeter: 29,
    layers: 3,
    layerThickness: 29,
    layerShrink: 39,
    mountHoles: false,
    holeDiameter: 19,
    tabs: false,
    guides: false,
    bodyMode: "totem",
    plateMargin: 190,
    plateThickness: 39,
    cutout: true,
    poleHeight: 1900,
  };
  const geometryKeys = [
    "depth", "wall", "faceThickness", "backThickness", "clearance", "faceRecess",
    "recessLip", "backFlangeWidth", "backFlangeThickness", "neonFlexThickness", "led",
    "ledChannelWidth", "ledChannelHeight", "ledOffset", "ledColor", "ledPowerPerMeter",
    "layers", "layerThickness", "layerShrink", "mountHoles", "holeDiameter", "tabs",
    "guides", "bodyMode", "plateMargin", "plateThickness", "cutout", "poleHeight",
  ];
  for (const style of STYLES) {
    const clean = paramsForStyle(style, DEFAULT_PARAMS);
    const selectedAfterAnotherStyle = paramsForStyle(style, contaminated);
    assert.deepEqual(
      Object.fromEntries(geometryKeys.map((key) => [key, selectedAfterAnotherStyle[key]])),
      Object.fromEntries(geometryKeys.map((key) => [key, clean[key]])),
      style.id,
    );
  }
});

test("encaixe padrão usa faixa central de 60% como o modelo SKP", () => {
  assert.equal(DEFAULT_PARAMS.cutConnectorThickness, DEFAULT_PARAMS.depth * 0.6);
});

test("corta uma peça grande conforme a mesa da impressora", () => {
  const geometry = new BoxGeometry(500, 300, 10);
  const pieces = splitGeometryForBuildPlate(geometry, { width: 220, depth: 220, margin: 10 });
  assert.equal(pieces.length, 6);
  for (const piece of pieces) {
    piece.geometry.computeBoundingBox();
    const size = piece.geometry.boundingBox.getSize(new Vector3());
    assert.ok(size.x <= 200.001);
    assert.ok(size.y <= 200.001);
    assert.ok(size.z <= 10.001);
    assert.ok(piece.geometry.getAttribute("position").count > 0);
  }
});

test("corta uma peça em duas metades por um plano manual rotacionado", () => {
  const geometry = new BoxGeometry(300, 180, 20);
  const pieces = splitGeometryByPlane(geometry, { angle: 35, offset: 0 });
  assert.equal(pieces.length, 2);
  for (const piece of pieces) {
    assert.ok(piece.geometry.getAttribute("position").count > 0);
    piece.geometry.computeBoundingBox();
    assert.ok(piece.geometry.boundingBox.getSize(new Vector3()).z <= 20.001);
  }
});

test("acumula cortes manuais sucessivos usando a mesma origem", () => {
  const geometry = new BoxGeometry(120, 80, 20);
  const pieces = splitGeometryByPlanes(geometry, [
    { angle: 0, offset: -20, connector: "none" },
    { angle: 0, offset: 20, connector: "none" },
  ]);
  assert.equal(pieces.length, 3);
  assert.deepEqual(pieces.map((piece) => piece.total), [3, 3, 3]);
});

test("corte manual aceita malha sem UV e sem normais, como as letras geradas", () => {
  const geometry = new BoxGeometry(300, 180, 20);
  geometry.deleteAttribute("uv");
  geometry.deleteAttribute("normal");
  const pieces = splitGeometryByPlane(geometry, { angle: 90, offset: 0 });
  assert.equal(pieces.length, 2);
  for (const piece of pieces) {
    assert.ok(piece.geometry.getAttribute("normal"));
  }
});

test("fallback visual recorta duas metades locais sem depender da câmera", () => {
  const geometry = new BoxGeometry(100, 60, 20);
  const pieces = clipGeometryByPlaneForPreview(geometry, { angle: 90, offset: 0 });
  assert.equal(pieces.length, 2);
  for (const piece of pieces) {
    piece.geometry.computeBoundingBox();
    assert.ok(piece.geometry.boundingBox.getSize(new Vector3()).y <= 30.001);
  }
});

test("corte manual cria macho e fêmea complementares com folga", () => {
  const geometry = new BoxGeometry(100, 60, 20);
  const plain = splitGeometryByPlane(geometry, { angle: 0, offset: 0 });
  const pieces = splitGeometryByPlane(geometry, {
    angle: 0,
    offset: 0,
    connector: "male-female",
    maleSide: "part-1",
    connectorDepth: 4,
    connectorWidth: 100,
    connectorClearance: 0.2,
  });
  assert.equal(pieces.length, 2);
  pieces[0].geometry.computeBoundingBox();
  pieces[1].geometry.computeBoundingBox();
  assert.ok(pieces[0].geometry.boundingBox.max.x >= 3.99, "o macho deve avançar 4 mm");
  const malePosition = pieces[0].geometry.getAttribute("position");
  const extendedY = [];
  for (let i = 0; i < malePosition.count; i++) {
    if (malePosition.getX(i) > 0.1) extendedY.push(malePosition.getY(i));
  }
  assert.ok(
    Math.max(...extendedY) - Math.min(...extendedY) >= 59,
    "o rebaixo deve prolongar todo o perfil cortado da parede",
  );
  assert.ok(
    pieces[1].geometry.getAttribute("position").count >
      plain[1].geometry.getAttribute("position").count,
    "a fêmea deve conter a cavidade com folga",
  );
});

test("tamanho do encaixe controla a altura do perfil macho", () => {
  const geometry = new BoxGeometry(100, 60, 20);
  const small = splitGeometryByPlane(geometry, {
    angle: 0,
    connector: "male-female",
    connectorDepth: 4,
    connectorWidth: 25,
  });
  const full = splitGeometryByPlane(geometry, {
    angle: 0,
    connector: "male-female",
    connectorDepth: 4,
    connectorWidth: 100,
  });
  const extendedHeight = (piece) => {
    const position = piece.geometry.getAttribute("position");
    const z = [];
    for (let i = 0; i < position.count; i++) {
      if (position.getX(i) > 0.1) z.push(position.getZ(i));
    }
    return Math.max(...z) - Math.min(...z);
  };
  assert.ok(extendedHeight(small[0]) < extendedHeight(full[0]));
  assert.ok(extendedHeight(full[0]) >= 19.9, "100% deve usar toda a altura da parede");
  const smallPosition = small[0].geometry.getAttribute("position");
  const extendedZ = [];
  for (let i = 0; i < smallPosition.count; i++) {
    if (smallPosition.getX(i) > 0.1) extendedZ.push(smallPosition.getZ(i));
  }
  assert.ok(Math.min(...extendedZ) >= -2.51, "a faixa deve ficar centralizada na parede");
  assert.ok(Math.max(...extendedZ) <= 2.51, "a faixa deve deixar ombros simétricos");
});

test("encaixe por rebaixo usa espessura em milímetros no centro da parede", () => {
  const geometry = new BoxGeometry(100, 60, 20);
  const pieces = splitGeometryByPlane(geometry, {
    angle: 0,
    connector: "male-female",
    connectorDepth: 4,
    connectorThickness: 3,
  });
  const position = pieces[0].geometry.getAttribute("position");
  const extendedZ = [];
  for (let i = 0; i < position.count; i++) {
    if (position.getX(i) > 0.1) extendedZ.push(position.getZ(i));
  }
  assert.ok(Math.max(...extendedZ) - Math.min(...extendedZ) <= 3.01);
  assert.ok(Math.min(...extendedZ) >= -1.51);
  assert.ok(Math.max(...extendedZ) <= 1.51);
});

test("encaixe reproduz as medidas extraídas do modelo c.skp", () => {
  const geometry = new BoxGeometry(100, 60, 45);
  geometry.translate(0, 0, 22.5);
  const pieces = splitGeometryByPlane(geometry, {
    angle: 0,
    connector: "male-female",
    connectorDepth: 4,
    connectorThickness: 27,
    connectorClearance: 0.2,
  });
  const position = pieces[0].geometry.getAttribute("position");
  const extendedZ = [];
  for (let i = 0; i < position.count; i++) {
    if (position.getX(i) > 0.1) extendedZ.push(position.getZ(i));
  }
  assert.ok(Math.abs(Math.min(...extendedZ) - 9) < 0.01);
  assert.ok(Math.abs(Math.max(...extendedZ) - 36) < 0.01);
  pieces[0].geometry.computeBoundingBox();
  assert.ok(pieces[0].geometry.boundingBox.max.x >= 3.99);
});
