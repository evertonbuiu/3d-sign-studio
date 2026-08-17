import { z } from "zod";

import { FONTS } from "./fonts";
import { STYLES } from "./model";

const color = z.string().regex(/^#[0-9a-f]{6}$/i, "Cor inválida");
const finite = (min: number, max: number) => z.number().finite().min(min).max(max);

export const signParamsSchema = z.object({
  text: z.string().max(120),
  fontId: z.enum(FONTS.map((font) => font.id) as [string, ...string[]]),
  letterHeight: finite(30, 800),
  tracking: finite(-10, 40),
  depth: finite(5, 200),
  wall: finite(0.8, 12),
  faceThickness: finite(0.6, 60),
  backThickness: finite(0.6, 20),
  clearance: finite(0, 1.5),
  faceRecess: z.boolean(),
  recessLip: finite(0.4, 12),
  backFlangeWidth: finite(0.6, 30),
  backFlangeThickness: finite(0.6, 20),
  neonFlexThickness: finite(4, 30),
  led: z.boolean(),
  ledChannelWidth: finite(3, 40),
  ledChannelHeight: finite(2, 30),
  ledOffset: finite(0, 25),
  ledColor: color,
  ledPowerPerMeter: finite(2, 30),
  layers: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  layerThickness: finite(1, 30),
  layerShrink: finite(1, 40),
  mountHoles: z.boolean(),
  holeDiameter: finite(2, 20),
  tabs: z.boolean(),
  guides: z.boolean(),
  bodyMode: z.enum(["letras", "placa", "totem"]),
  plateMargin: finite(5, 200),
  plateThickness: finite(2, 40),
  cutout: z.boolean(),
  poleHeight: finite(100, 2000),
  faceColor: color,
  bodyColor: color,
  backColor: color,
  modelRotation: finite(-180, 180),
  mirrorHorizontal: z.boolean(),
  mirrorVertical: z.boolean(),
  printerId: z.string().min(1).max(100),
  buildWidth: finite(50, 2_000),
  buildDepth: finite(50, 2_000),
  buildHeight: finite(50, 2_000),
  nozzleDiameter: finite(0.1, 3),
  filamentDiameter: finite(1, 3),
  maxPrintSpeed: finite(1, 2_000),
  splitForBuildPlate: z.boolean(),
  splitMargin: finite(0, 100),
  splitMode: z.enum(["automatic", "manual"]),
  manualCutAngle: finite(-180, 180),
  manualCutOffset: finite(-2_000, 2_000),
  manualCutSeparation: finite(0, 200),
  manualCutTarget: z.enum([
    "all", "fundo", "laterais", "frente", "canal-led", "furos",
    "camada-2", "camada-3", "placa", "poste",
  ]),
  manualCuts: z.array(z.object({
    id: z.string().min(1).max(100),
    angle: finite(-180, 180),
    offset: finite(-2_000, 2_000),
    target: z.enum([
      "all", "fundo", "laterais", "frente", "canal-led", "furos",
      "camada-2", "camada-3", "placa", "poste",
    ]),
    connector: z.enum(["none", "male-female"]),
    maleSide: z.enum(["part-1", "part-2"]),
    connectorDepth: finite(0.4, 30),
    connectorWidth: finite(10, 100),
    connectorThickness: finite(0.4, 60),
    connectorClearance: finite(0, 1.5),
  })).max(20),
  cutConnector: z.enum(["none", "male-female"]),
  cutMaleSide: z.enum(["part-1", "part-2"]),
  cutConnectorDepth: finite(0.4, 30),
  cutConnectorWidth: finite(10, 100),
  cutConnectorThickness: finite(0.4, 60),
  cutConnectorClearance: finite(0, 1.5),
  filamentPrice: finite(0, 100_000),
  density: finite(0.1, 30),
  printSpeed: finite(0.1, 10_000),
  hourlyRate: finite(0, 100_000),
  energyPrice: finite(0, 1_000),
  printerPower: finite(0, 100_000),
  margin: finite(0, 10_000),
  sketch: z
    .object({
      entities: z.array(z.record(z.string(), z.unknown())).max(500),
      extrusions: z.array(z.record(z.string(), z.unknown())).max(200),
    })
    .optional(),
});

export const styleIdSchema = z.enum(STYLES.map((style) => style.id) as [string, ...string[]]);

export const vectorSourceSchema = z
  .object({
    name: z.string().min(1).max(255),
    kind: z.enum(["svg", "dxf"]),
    content: z.string().min(1).max(2_000_000),
  })
  .nullable();
