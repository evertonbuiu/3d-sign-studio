import type { SignBuild } from "./build";
import type { SignParams } from "./model";

export interface CostBreakdown {
  weightG: number;
  filamentMeters: number;
  hours: number;
  materialCost: number;
  energyCost: number;
  laborCost: number;
  ledCost: number;
  subtotal: number;
  total: number;
}

const FILAMENT_AREA_CM2 = Math.PI * Math.pow(0.175 / 2, 2) * 100; // 1,75 mm em cm²

export function computeCost(build: SignBuild, params: SignParams): CostBreakdown {
  const volume = build.printedVolumeCm3;
  const weightG = volume * params.density;
  const filamentMeters = volume / FILAMENT_AREA_CM2 / 100;
  const hours = params.printSpeed > 0 ? volume / params.printSpeed : 0;

  const materialCost = (weightG / 1000) * params.filamentPrice;
  const energyCost = ((params.printerPower / 1000) * hours) * params.energyPrice;
  const laborCost = hours * params.hourlyRate;
  const ledCost = params.led ? (build.ledLengthMm / 1000) * 28 : 0;

  const subtotal = materialCost + energyCost + laborCost + ledCost;
  const total = subtotal * (1 + params.margin / 100);

  return {
    weightG,
    filamentMeters,
    hours,
    materialCost,
    energyCost,
    laborCost,
    ledCost,
    subtotal,
    total,
  };
}

export const brl = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const mm = (value: number) =>
  `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mm`;
