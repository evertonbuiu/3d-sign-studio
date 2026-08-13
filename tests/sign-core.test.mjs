import assert from "node:assert/strict";
import test from "node:test";

import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Vector3 } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

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
  geometryCrossesCutPlane,
  partSupportsCutConnector,
  splitGeometryByPlane,
  splitGeometryByPlanes,
  splitGeometryForBuildPlate,
} from "../src/lib/sign/split.ts";

test("encaixe estrutural atende estilos com e sem paredes", () => {
  assert.equal(partSupportsCutConnector("laterais", true), true);
  assert.equal(partSupportsCutConnector("frente", true), false);
  assert.equal(partSupportsCutConnector("frente", false), true);
  assert.equal(partSupportsCutConnector("placa", false), true);
  assert.equal(partSupportsCutConnector("camada-2", false), true);
  assert.equal(partSupportsCutConnector("canal-led", false), false);
  assert.equal(partSupportsCutConnector("furos", false), false);
});

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
  assert.equal(DEFAULT_PARAMS.cutConnector, "male-female");
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

test("plano manual usa a origem global do modelo em todas as peças", () => {
  const geometry = new BoxGeometry(20, 20, 10);
  geometry.translate(100, 0, 0);
  assert.equal(
    geometryCrossesCutPlane(geometry, { angle: 0, offset: 0, origin: { x: 0, y: 0 } }),
    false,
  );
  assert.equal(
    geometryCrossesCutPlane(geometry, { angle: 0, offset: 100, origin: { x: 0, y: 0 } }),
    true,
  );
  assert.equal(
    splitGeometryByPlane(geometry, { angle: 0, offset: 0, origin: { x: 0, y: 0 } }).length,
    1,
  );
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

test("parte femea deixa aberta a metade interna do rebaixo", () => {
  const geometry = new BoxGeometry(100, 60, 20);
  const pieces = splitGeometryByPlane(geometry, {
    angle: 0,
    connector: "male-female",
    connectorDepth: 4,
    connectorWidth: 50,
    connectorClearance: 0.2,
  });
  const source = pieces[1].geometry.index ? pieces[1].geometry.toNonIndexed() : pieces[1].geometry;
  const position = source.getAttribute("position");
  const sampleY = -15;
  const sampleZ = 0;
    let covered = false;
    for (let index = 0; index + 2 < position.count; index += 3) {
      const xs = [position.getX(index), position.getX(index + 1), position.getX(index + 2)];
      const meanX = (xs[0] + xs[1] + xs[2]) / 3;
      if (Math.max(...xs) - Math.min(...xs) > 1e-4 || Math.abs(meanX) > 1) continue;
    const ay = position.getY(index), az = position.getZ(index);
    const by = position.getY(index + 1), bz = position.getZ(index + 1);
    const cy = position.getY(index + 2), cz = position.getZ(index + 2);
    const d1 = (sampleY - by) * (az - bz) - (ay - by) * (sampleZ - bz);
    const d2 = (sampleY - cy) * (bz - cz) - (by - cy) * (sampleZ - cz);
    const d3 = (sampleY - ay) * (cz - az) - (cy - ay) * (sampleZ - az);
    if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) covered = true;
  }
  assert.equal(covered, false, "a cavidade da parte femea nao pode receber uma face de fechamento");
  let closedAtDepth = false;
  for (let index = 0; index + 2 < position.count; index += 3) {
    const xs = [position.getX(index), position.getX(index + 1), position.getX(index + 2)];
    if (Math.min(...xs) < 3.5 || Math.max(...xs) - Math.min(...xs) > 1e-4) continue;
    const ay = position.getY(index), az = position.getZ(index);
    const by = position.getY(index + 1), bz = position.getZ(index + 1);
    const cy = position.getY(index + 2), cz = position.getZ(index + 2);
    const d1 = (sampleY - by) * (az - bz) - (ay - by) * (sampleZ - bz);
    const d2 = (sampleY - cy) * (bz - cz) - (by - cy) * (sampleZ - cz);
    const d3 = (sampleY - ay) * (cz - az) - (cy - ay) * (sampleZ - az);
    if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) {
      closedAtDepth = true;
    }
  }
  assert.equal(closedAtDepth, true, "o fundo da cavidade femea deve ficar fechado");
});

test("encaixe e recuo femea acompanham o angulo do plano de corte", () => {
  const angle = 37;
  const radians = (angle * Math.PI) / 180;
  const normal = new Vector3(Math.cos(radians), Math.sin(radians), 0);
  const pieces = splitGeometryByPlane(new BoxGeometry(100, 60, 20), {
    angle,
    connector: "male-female",
    connectorDepth: 4,
    connectorWidth: 50,
    connectorClearance: 0.2,
  });
  const signedDistances = (piece) => {
    const position = piece.geometry.getAttribute("position");
    return Array.from({ length: position.count }, (_, index) =>
      normal.x * position.getX(index) + normal.y * position.getY(index));
  };
  assert.ok(
    Math.max(...signedDistances(pieces[0])) >= 3.99,
    "o macho deve avançar na normal do plano inclinado",
  );
  const female = pieces[1].geometry.index ? pieces[1].geometry.toNonIndexed() : pieces[1].geometry;
  const position = female.getAttribute("position");
  let recessedBack = false;
  for (let index = 0; index + 2 < position.count; index += 3) {
    const distances = [0, 1, 2].map((offset) =>
      normal.x * position.getX(index + offset) + normal.y * position.getY(index + offset));
    if (distances.every((distance) => Math.abs(distance - 4.2) < 0.05)) recessedBack = true;
  }
  assert.equal(recessedBack, true, "a Parte 2 deve ter o fundo do recuo paralelo ao corte");
});

test("todas as paredes atravessadas recebem o recuo femea", () => {
  const angle = 37;
  const radians = (angle * Math.PI) / 180;
  const normal = new Vector3(Math.cos(radians), Math.sin(radians), 0);
  const tangent = new Vector3(-normal.y, normal.x, 0);
  const lower = new BoxGeometry(100, 10, 20).translate(0, -20, 0);
  const upper = new BoxGeometry(100, 10, 20).translate(0, 20, 0);
  const geometry = mergeGeometries([lower, upper], false);
  assert.ok(geometry);
  const female = splitGeometryByPlane(geometry, {
    angle,
    connector: "male-female",
    connectorDepth: 4,
    connectorWidth: 50,
    connectorClearance: 0.2,
  })[1].geometry.toNonIndexed();
  const position = female.getAttribute("position");
  const recessedSections = [];
  for (let index = 0; index + 2 < position.count; index += 3) {
    const points = [0, 1, 2].map((offset) =>
      new Vector3(position.getX(index + offset), position.getY(index + offset), position.getZ(index + offset)));
    const distances = points.map((point) => normal.dot(point));
    if (distances.every((distance) => Math.abs(distance - 4.2) < 0.05)) {
      recessedSections.push(tangent.dot(points[0].clone().add(points[1]).add(points[2]).multiplyScalar(1 / 3)));
    }
  }
  assert.ok(recessedSections.some((value) => value < -10), "a parede inferior deve ter recuo");
  assert.ok(recessedSections.some((value) => value > 10), "a parede superior deve ter recuo");
});

test("encaixe acompanha a inclinacao local da parede", () => {
  const wallAngle = 20;
  const depth = 10;
  const geometry = new BoxGeometry(120, 10, 20);
  geometry.rotateZ((wallAngle * Math.PI) / 180);
  const male = splitGeometryByPlane(geometry, {
    angle: 0,
    connector: "male-female",
    connectorDepth: depth,
    connectorWidth: 100,
    connectorClearance: 0.2,
  })[0].geometry;
  const position = male.getAttribute("position");
  const baseY = [];
  const tipY = [];
  for (let index = 0; index < position.count; index++) {
    if (Math.abs(position.getX(index)) < 0.02) baseY.push(position.getY(index));
    if (position.getX(index) > depth - 0.5) tipY.push(position.getY(index));
  }
  const baseCenter = (Math.min(...baseY) + Math.max(...baseY)) / 2;
  const tipCenter = (Math.min(...tipY) + Math.max(...tipY)) / 2;
  const expectedShift = Math.tan((wallAngle * Math.PI) / 180) * depth;
  assert.ok(Math.abs((tipCenter - baseCenter) - expectedShift) < 0.5);
});

test("largura do encaixe controla a metade interna da parede", () => {
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
  const extendedWidth = (piece) => {
    const position = piece.geometry.getAttribute("position");
    const y = [];
    for (let i = 0; i < position.count; i++) {
      if (position.getX(i) > 0.1) y.push(position.getY(i));
    }
    return Math.max(...y) - Math.min(...y);
  };
  assert.ok(extendedWidth(small[0]) < extendedWidth(full[0]));
  assert.ok(extendedWidth(full[0]) >= 59.9, "100% deve usar toda a espessura da parede");
});

test("encaixe percorre a parede e preserva as extremidades fechadas", () => {
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
  assert.ok(Math.max(...extendedZ) - Math.min(...extendedZ) >= 17.99);
  assert.ok(Math.abs(Math.min(...extendedZ) + 9) < 0.01);
  assert.ok(Math.abs(Math.max(...extendedZ) - 9) < 0.01);
});

test("rebaixo ocupa somente metade interna da espessura da parede", () => {
  const geometry = new BoxGeometry(100, 60, 20);
  const pieces = splitGeometryByPlane(geometry, {
    angle: 0,
    connector: "male-female",
    connectorDepth: 4,
    connectorThickness: 20,
    connectorWidth: 50,
  });
  const position = pieces[0].geometry.getAttribute("position");
  const extendedY = [];
  for (let index = 0; index < position.count; index++) {
    if (position.getX(index) > 0.1) extendedY.push(position.getY(index));
  }
  assert.ok(Math.max(...extendedY) - Math.min(...extendedY) <= 30.01);
  assert.ok(Math.max(...extendedY) <= 0.01, "o macho deve permanecer na metade interna selecionada");
});

test("parte superior preserva a metade externa e recua a metade interna", () => {
  const geometry = new BoxGeometry(100, 60, 20);
  const pieces = splitGeometryByPlane(geometry, {
    angle: 0,
    connector: "male-female",
    connectorDepth: 4,
    connectorWidth: 50,
    connectorClearance: 0.2,
  });
  const position = pieces[1].geometry.getAttribute("position");
  const cavityY = [];
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index);
    const z = position.getZ(index);
    if (x > 0.1 && x < 4.5 && z > -9 && z < 9) cavityY.push(position.getY(index));
  }
  assert.ok(cavityY.length > 0, "a peça superior deve receber a cavidade fêmea");
  assert.ok(Math.max(...cavityY) <= 0.3, "a cavidade deve receber a lingueta na metade interna");
});

test("paredes fora do centro global mantem o encaixe voltado para dentro", () => {
  const first = new BoxGeometry(100, 20, 20).translate(0, 100, 0);
  const second = new BoxGeometry(100, 20, 20).translate(0, 140, 0);
  const geometry = mergeGeometries([first, second], false);
  assert.ok(geometry);
  const pieces = splitGeometryByPlane(geometry, {
    angle: 0,
    origin: { x: 0, y: 0 },
    connector: "male-female",
    connectorDepth: 4,
    connectorWidth: 50,
  });
  const position = pieces[0].geometry.getAttribute("position");
  const extendedY = [];
  for (let index = 0; index < position.count; index++) {
    if (position.getX(index) > 0.1) extendedY.push(position.getY(index));
  }
  assert.ok(extendedY.some((y) => y >= 100 && y <= 110.01));
  assert.ok(extendedY.some((y) => y >= 129.99 && y <= 140));
  assert.ok(
    extendedY.every((y) => (y >= 99.99 && y <= 110.01) || (y >= 129.99 && y <= 140.01)),
    "nenhum encaixe pode ocupar a metade externa das paredes",
  );
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
  assert.ok(Math.abs(Math.min(...extendedZ) - 1) < 0.01);
  assert.ok(Math.abs(Math.max(...extendedZ) - 44) < 0.01);
  pieces[0].geometry.computeBoundingBox();
  assert.ok(pieces[0].geometry.boundingBox.max.x >= 3.99);
});

