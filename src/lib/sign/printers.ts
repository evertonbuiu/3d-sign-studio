import type { SignParams } from "./model";

export interface PrinterProfile {
  id: string;
  manufacturer: string;
  name: string;
  technology: "FDM";
  params: Pick<
    SignParams,
    | "printerId"
    | "buildWidth"
    | "buildDepth"
    | "buildHeight"
    | "nozzleDiameter"
    | "filamentDiameter"
    | "maxPrintSpeed"
    | "printSpeed"
    | "printerPower"
  >;
}

function profile(
  id: string,
  manufacturer: string,
  name: string,
  build: [number, number, number],
  maxPrintSpeed: number,
  printSpeed: number,
  printerPower: number,
  nozzleDiameter = 0.4,
): PrinterProfile {
  return {
    id,
    manufacturer,
    name,
    technology: "FDM",
    params: {
      printerId: id,
      buildWidth: build[0],
      buildDepth: build[1],
      buildHeight: build[2],
      nozzleDiameter,
      filamentDiameter: 1.75,
      maxPrintSpeed,
      printSpeed,
      printerPower,
    },
  };
}

/** Perfis iniciais editáveis. printSpeed é a vazão média usada na estimativa de custos. */
export const PRINTER_PROFILES: PrinterProfile[] = [
  profile("bambu-a1-mini", "Bambu Lab", "A1 mini", [180, 180, 180], 500, 22, 150),
  profile("bambu-a1", "Bambu Lab", "A1", [256, 256, 256], 500, 25, 350),
  profile("bambu-p1s", "Bambu Lab", "P1S", [256, 256, 256], 500, 28, 350),
  profile("bambu-x1c", "Bambu Lab", "X1 Carbon", [256, 256, 256], 500, 32, 350),
  profile("creality-ender-3-v3-se", "Creality", "Ender-3 V3 SE", [220, 220, 250], 250, 14, 350),
  profile("creality-k1", "Creality", "K1", [220, 220, 250], 600, 28, 350),
  profile("creality-k1-max", "Creality", "K1 Max", [300, 300, 300], 600, 32, 1000),
  profile("elegoo-neptune-4", "Elegoo", "Neptune 4", [225, 225, 265], 500, 22, 400),
  profile("prusa-mk4s", "Prusa", "MK4S", [250, 210, 220], 300, 20, 120),
  profile("prusa-xl", "Prusa", "XL", [360, 360, 360], 200, 25, 650),
  profile("anycubic-kobra-3", "Anycubic", "Kobra 3", [250, 250, 260], 600, 25, 400),
  profile("custom", "Outros", "Personalizada", [220, 220, 250], 200, 18, 350),
];

export const DEFAULT_PRINTER = PRINTER_PROFILES.find(
  (printer) => printer.id === "creality-ender-3-v3-se",
)!;

export function getPrinterProfile(id: string): PrinterProfile {
  return PRINTER_PROFILES.find((printer) => printer.id === id) ?? DEFAULT_PRINTER;
}

export function paramsForPrinter(id: string, base: SignParams): SignParams {
  return { ...base, ...getPrinterProfile(id).params };
}
