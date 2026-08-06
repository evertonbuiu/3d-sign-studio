export type PartKind =
  | "fundo"
  | "laterais"
  | "frente"
  | "canal-led"
  | "furos"
  | "camada-2"
  | "camada-3"
  | "placa"
  | "poste";

export type BodyMode = "letras" | "placa" | "totem";

export interface SignParams {
  /** conteúdo */
  text: string;
  fontId: string;
  letterHeight: number; // mm (altura de caixa alta)
  tracking: number; // mm entre letras
  /** construção */
  depth: number; // profundidade total da caixa (mm)
  wall: number; // espessura da parede lateral (mm)
  faceThickness: number; // espessura da frente (mm)
  backThickness: number; // espessura do fundo (mm)
  clearance: number; // folga de encaixe (mm)
  faceRecess: boolean; // parede interna com rebaixo para a frente
  recessLip: number; // largura da aba externa que segura a frente (mm)
  backFlangeWidth: number; // avanço da aba traseira para dentro (mm)
  backFlangeThickness: number; // espessura da aba traseira no eixo Z (mm)
  neonFlexThickness: number; // largura livre do canal de contorno para o Neon Flex (mm)
  /** iluminação */
  led: boolean;
  ledChannelWidth: number;
  ledChannelHeight: number;
  ledOffset: number; // distância da parede até o canal
  ledColor: string;
  ledPowerPerMeter: number; // W/m
  /** camadas */
  layers: 1 | 2 | 3;
  layerThickness: number;
  layerShrink: number; // redução por camada (mm)
  /** montagem */
  mountHoles: boolean;
  holeDiameter: number;
  tabs: boolean;
  guides: boolean;
  /** corpo */
  bodyMode: BodyMode;
  plateMargin: number; // margem da placa em volta do texto
  plateThickness: number;
  cutout: boolean; // letras vazadas na placa
  poleHeight: number; // totem
  /** aparência */
  faceColor: string;
  bodyColor: string;
  backColor: string;
  /** custos */
  filamentPrice: number; // R$/kg
  density: number; // g/cm3
  printSpeed: number; // cm3/h
  hourlyRate: number; // R$/h de máquina + mão de obra
  energyPrice: number; // R$/kWh
  printerPower: number; // W
  margin: number; // %
}

export const DEFAULT_PARAMS: SignParams = {
  text: "LUMINA",
  fontId: "archivo",
  letterHeight: 200,
  tracking: 4,
  depth: 60,
  wall: 2.4,
  faceThickness: 3,
  backThickness: 3,
  clearance: 0.5,
  faceRecess: true,
  recessLip: 1.2,
  backFlangeWidth: 4,
  backFlangeThickness: 2.4,
  neonFlexThickness: 8,
  led: true,
  ledChannelWidth: 12,
  ledChannelHeight: 6,
  ledOffset: 3,
  ledColor: "#ffe9b0",
  ledPowerPerMeter: 9.6,
  layers: 1,
  layerThickness: 6,
  layerShrink: 8,
  mountHoles: true,
  holeDiameter: 6,
  tabs: true,
  guides: true,
  bodyMode: "letras",
  plateMargin: 40,
  plateThickness: 10,
  cutout: false,
  poleHeight: 400,
  faceColor: "#f4f6fa",
  bodyColor: "#3f4a5a",
  backColor: "#2c333d",
  filamentPrice: 120,
  density: 1.24,
  printSpeed: 22,
  hourlyRate: 18,
  energyPrice: 0.92,
  printerPower: 180,
  margin: 45,
};

export type StyleGroup =
  "Neon Flex" | "Acrílico & Impresso" | "Iluminação" | "Letras" | "Placas & Totem" | "Logotipo";

export interface SignStyle {
  id: string;
  name: string;
  group: StyleGroup;
  description: string;
  /** peças ativas neste estilo */
  parts: PartKind[];
  preset: Partial<SignParams>;
  /** dica visual da miniatura */
  thumb: {
    face: string;
    body: string;
    glow?: "front" | "halo" | "back" | "edge" | "both" | "none";
    layers?: number;
    plate?: boolean;
    outline?: boolean;
  };
}

const boxParts: PartKind[] = ["fundo", "laterais", "frente", "canal-led", "furos"];

export const STYLES: SignStyle[] = [
  {
    id: "fundo-impresso-frente-acrilica",
    name: "Fundo Impresso + Frente Acrílica",
    group: "Acrílico & Impresso",
    description: "Corpo impresso e frente em acrílico encaixada no rebaixo.",
    parts: boxParts,
    preset: { depth: 50, faceThickness: 3 },
    thumb: { face: "#cfe0f2", body: "#3f4a5a", glow: "front" },
  },
  {
    id: "fundo-acrilico-frente-acrilica",
    name: "Fundo Acrílico + Frente Acrílica",
    group: "Acrílico & Impresso",
    description: "Fundo e frente em acrílico com laterais impressas.",
    parts: boxParts,
    preset: { depth: 45, backThickness: 3, faceThickness: 3 },
    thumb: { face: "#e6f0fb", body: "#5b6a7d", glow: "both" },
  },
  {
    id: "fundo-acrilico-frente-acrilica-aba",
    name: "Fundo Acrílico + Frente Acrílica com Aba",
    group: "Acrílico & Impresso",
    description: "Frente acrílica em rebaixo e fundo acrílico apoiado por aba interna.",
    parts: boxParts,
    preset: {
      depth: 45,
      backThickness: 3,
      faceThickness: 3,
      faceRecess: true,
      backFlangeWidth: 4,
      backFlangeThickness: 2.4,
    },
    thumb: { face: "#dceafb", body: "#526176", glow: "both" },
  },
  {
    id: "fundo-acrilico-frente-impressa",
    name: "Fundo Acrílico + Frente Impressa",
    group: "Acrílico & Impresso",
    description: "Frente impressa opaca sobre fundo translúcido.",
    parts: boxParts,
    preset: { depth: 45, faceThickness: 2.4, led: true },
    thumb: { face: "#8f9db0", body: "#39424f", glow: "halo" },
  },
  {
    id: "fundo-impresso-frente-impressa-aba",
    name: "Fundo Impresso + Frente Impressa com Aba",
    group: "Acrílico & Impresso",
    description:
      "Frente e paredes impressas em uma peça, com fundo impresso separado e aba interna de encaixe.",
    parts: ["fundo", "laterais", "frente"],
    preset: {
      depth: 45,
      wall: 2.4,
      faceThickness: 2.4,
      backThickness: 2.4,
      faceRecess: true,
      backFlangeWidth: 4,
      backFlangeThickness: 5,
      clearance: 0.5,
      led: false,
      mountHoles: false,
    },
    thumb: { face: "#e7e9ee", body: "#424b59", glow: "none" },
  },
  {
    id: "neon-flex-fundo-impresso",
    name: "Neon Flex — Fundo Impresso sem Tampa",
    group: "Neon Flex",
    description:
      "Canal aberto acompanhando somente o contorno das letras, com fundo e paredes impressos em uma peça.",
    parts: ["fundo", "laterais"],
    preset: {
      depth: 11,
      wall: 1.6,
      backThickness: 3,
      neonFlexThickness: 8,
      faceRecess: false,
      led: false,
      mountHoles: false,
    },
    thumb: { face: "#ff4fd8", body: "#252836", glow: "front", outline: true },
  },
  {
    id: "face-lit",
    name: "Face Lit",
    group: "Iluminação",
    description: "Luz frontal difusa em toda a face da letra.",
    parts: boxParts,
    preset: { led: true, depth: 55, ledChannelWidth: 14 },
    thumb: { face: "#fff3cf", body: "#3f4a5a", glow: "front" },
  },
  {
    id: "halo-light",
    name: "Halo Light",
    group: "Iluminação",
    description: "Letra opaca com halo de luz projetado na parede.",
    parts: ["laterais", "frente", "canal-led", "furos"],
    preset: { led: true, depth: 45, faceThickness: 4, ledOffset: 6 },
    thumb: { face: "#7b8798", body: "#2f3742", glow: "halo" },
  },
  {
    id: "back-light",
    name: "Back Light",
    group: "Iluminação",
    description: "Iluminação traseira com fundo aberto.",
    parts: ["laterais", "frente", "canal-led", "furos"],
    preset: { led: true, depth: 50, backThickness: 2 },
    thumb: { face: "#6f7c8f", body: "#2f3742", glow: "back" },
  },
  {
    id: "front-light",
    name: "Front Light",
    group: "Iluminação",
    description: "Somente a frente acende, laterais opacas.",
    parts: boxParts,
    preset: { led: true, depth: 48 },
    thumb: { face: "#ffeeb8", body: "#3a4350", glow: "front" },
  },
  {
    id: "front-back-light",
    name: "Front + Back Light",
    group: "Iluminação",
    description: "Luz na frente e halo traseiro simultâneos.",
    parts: ["laterais", "frente", "canal-led", "furos"],
    preset: { led: true, depth: 60, ledChannelWidth: 16 },
    thumb: { face: "#ffe9ad", body: "#333c48", glow: "both" },
  },
  {
    id: "edge-lit",
    name: "Edge Lit",
    group: "Iluminação",
    description: "Luz nas bordas com acrílico gravado.",
    parts: boxParts,
    preset: { led: true, depth: 30, ledChannelWidth: 8, ledOffset: 1.5 },
    thumb: { face: "#d5ecff", body: "#2f3742", glow: "edge" },
  },
  {
    id: "caixa-sem-iluminacao",
    name: "Caixa sem iluminação",
    group: "Letras",
    description: "Caixa oca econômica, sem LED.",
    parts: ["fundo", "laterais", "frente", "furos"],
    preset: { led: false, depth: 35 },
    thumb: { face: "#c9d3e0", body: "#4a5567", glow: "none" },
  },
  {
    id: "caixa-iluminada",
    name: "Caixa iluminada",
    group: "Letras",
    description: "Caixa completa com canal de LED.",
    parts: boxParts,
    preset: { led: true, depth: 60 },
    thumb: { face: "#ffe9ad", body: "#3f4a5a", glow: "front" },
  },
  {
    id: "letras-macicas",
    name: "Letras Maciças",
    group: "Letras",
    description: "Letra sólida extrudada, máxima resistência.",
    parts: ["frente", "furos"],
    preset: { led: false, depth: 25, faceThickness: 25 },
    thumb: { face: "#8ea3bd", body: "#5a6a80", glow: "none" },
  },
  {
    id: "letras-ocas",
    name: "Letras Ocas",
    group: "Letras",
    description: "Casca oca com paredes finas, leve e rápida.",
    parts: ["laterais", "frente"],
    preset: { led: false, depth: 30, wall: 2 },
    thumb: { face: "#b9c7da", body: "#4a5567", glow: "none" },
  },
  {
    id: "letras-vazadas",
    name: "Letras Vazadas",
    group: "Letras",
    description: "Placa com o texto recortado, efeito negativo.",
    parts: ["placa", "furos"],
    preset: { bodyMode: "placa", cutout: true, plateThickness: 12, led: false },
    thumb: { face: "#e3e9f2", body: "#46505f", plate: true, outline: true },
  },
  {
    id: "letras-dupla-camada",
    name: "Letras Dupla Camada",
    group: "Letras",
    description: "Duas camadas sobrepostas com contraste de cor.",
    parts: ["frente", "camada-2", "furos"],
    preset: { layers: 2, depth: 20, faceThickness: 8, layerThickness: 6 },
    thumb: { face: "#f0f3f8", body: "#3b82f6", layers: 2 },
  },
  {
    id: "letras-tripla-camada",
    name: "Letras Tripla Camada",
    group: "Letras",
    description: "Três níveis com profundidade escalonada.",
    parts: ["frente", "camada-2", "camada-3", "furos"],
    preset: { layers: 3, depth: 26, faceThickness: 8, layerThickness: 6 },
    thumb: { face: "#ffffff", body: "#3b82f6", layers: 3 },
  },
  {
    id: "neon-flex",
    name: "Neon Flex",
    group: "Iluminação",
    description: "Canal contínuo para mangueira de neon flex.",
    parts: ["placa", "canal-led", "furos"],
    preset: {
      bodyMode: "placa",
      led: true,
      ledChannelWidth: 8,
      ledChannelHeight: 10,
      plateThickness: 8,
      ledColor: "#ff5fa2",
    },
    thumb: { face: "#ff7ab8", body: "#1f2733", plate: true, glow: "front" },
  },
  {
    id: "neon-led",
    name: "Neon LED",
    group: "Iluminação",
    description: "Perfil neon LED com canal estreito.",
    parts: ["placa", "canal-led", "furos"],
    preset: {
      bodyMode: "placa",
      led: true,
      ledChannelWidth: 6,
      ledChannelHeight: 12,
      plateThickness: 8,
      ledColor: "#5fd9ff",
    },
    thumb: { face: "#7fe3ff", body: "#1f2733", plate: true, glow: "front" },
  },
  {
    id: "placa-decorativa",
    name: "Placa Decorativa",
    group: "Placas & Totem",
    description: "Placa com letras em relevo aplicadas.",
    parts: ["placa", "frente", "furos"],
    preset: { bodyMode: "placa", plateThickness: 8, depth: 14, faceThickness: 8, led: false },
    thumb: { face: "#dfe6f1", body: "#4a5567", plate: true },
  },
  {
    id: "placa-acm",
    name: "Placa ACM",
    group: "Placas & Totem",
    description: "Base fina em ACM com letras aplicadas.",
    parts: ["placa", "frente", "furos"],
    preset: { bodyMode: "placa", plateThickness: 4, depth: 18, faceThickness: 10, led: false },
    thumb: { face: "#cbd6e4", body: "#59657a", plate: true },
  },
  {
    id: "totem",
    name: "Totem",
    group: "Placas & Totem",
    description: "Totem vertical com base e letras iluminadas.",
    parts: ["placa", "poste", "frente", "canal-led", "furos"],
    preset: { bodyMode: "totem", plateThickness: 20, poleHeight: 500, led: true },
    thumb: { face: "#e6edf7", body: "#3b4757", plate: true, glow: "front" },
  },
  {
    id: "logotipo-3d",
    name: "Logotipo 3D",
    group: "Logotipo",
    description: "Volume único com face chanfrada para logotipos.",
    parts: ["frente", "furos"],
    preset: { depth: 30, faceThickness: 30, led: false },
    thumb: { face: "#9fb3cc", body: "#3b4757" },
  },
  {
    id: "logo-multicamadas",
    name: "Logo Multicamadas",
    group: "Logotipo",
    description: "Logotipo em camadas com cores independentes.",
    parts: ["placa", "frente", "camada-2", "camada-3"],
    preset: {
      bodyMode: "placa",
      layers: 3,
      plateThickness: 6,
      faceThickness: 6,
      layerThickness: 5,
      led: false,
    },
    thumb: { face: "#ffffff", body: "#3b82f6", plate: true, layers: 3 },
  },
];

export const STYLE_GROUPS: StyleGroup[] = [
  "Neon Flex",
  "Acrílico & Impresso",
  "Iluminação",
  "Letras",
  "Placas & Totem",
  "Logotipo",
];

export function getStyle(id: string): SignStyle {
  return STYLES.find((s) => s.id === id) ?? STYLES[0]!;
}

export function paramsForStyle(style: SignStyle, base: SignParams = DEFAULT_PARAMS): SignParams {
  return { ...base, ...style.preset };
}
