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
  filamentPrice: finite(0, 100_000),
  density: finite(0.1, 30),
  printSpeed: finite(0.1, 10_000),
  hourlyRate: finite(0, 100_000),
  energyPrice: finite(0, 1_000),
  printerPower: finite(0, 100_000),
  margin: finite(0, 10_000),
});

export const styleIdSchema = z.enum(STYLES.map((style) => style.id) as [string, ...string[]]);

export const vectorSourceSchema = z
  .object({
    name: z.string().min(1).max(255),
    kind: z.enum(["svg", "dxf"]),
    content: z.string().min(1).max(2_000_000),
  })
  .nullable();
