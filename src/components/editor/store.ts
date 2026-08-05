import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Font } from "opentype.js";

import { loadFont, textToShapes } from "@/lib/sign/fonts";
import { svgToShapes } from "@/lib/sign/svg";
import { scaleShapes } from "@/lib/sign/transform";
import { buildSign, type SignBuild } from "@/lib/sign/build";
import { computeCost, type CostBreakdown } from "@/lib/sign/cost";
import {
  DEFAULT_PARAMS,
  getStyle,
  paramsForStyle,
  type SignParams,
  type SignStyle,
} from "@/lib/sign/model";

export interface EditorState {
  params: SignParams;
  style: SignStyle;
  build: SignBuild | null;
  cost: CostBreakdown | null;
  ready: boolean;
  explode: number;
  hidden: Set<string>;
  wireframe: boolean;
  showOutlines: boolean;
  svgName: string | null;
  setSvg: (name: string, content: string) => void;
  clearSvg: () => void;
  projectId: string | null;
  projectName: string;
  setParam: <K extends keyof SignParams>(key: K, value: SignParams[K]) => void;
  setParams: (patch: Partial<SignParams>) => void;
  selectStyle: (id: string) => void;
  setExplode: (value: number) => void;
  setWireframe: (value: boolean) => void;
  setShowOutlines: (value: boolean) => void;
  togglePart: (id: string) => void;
  loadProject: (p: {
    id: string;
    name: string;
    styleId: string;
    params: Partial<SignParams>;
  }) => void;
  setProject: (id: string | null, name: string) => void;
}

/** Medidas do plano XY (largura/altura) e do eixo Z (profundidade). */
const X_KEYS = ["tracking"] as const;
const Y_KEYS = ["letterHeight", "poleHeight"] as const;
const XY_KEYS = [
  "wall",
  "clearance",
  "recessLip",
  "ledChannelWidth",
  "ledOffset",
  "layerShrink",
  "holeDiameter",
  "plateMargin",
] as const;
const Z_KEYS = [
  "depth",
  "faceThickness",
  "backThickness",
  "plateThickness",
  "layerThickness",
  "ledChannelHeight",
] as const;

export interface AxisScale {
  x: number;
  y: number;
  z: number;
}

export function axisScale(params: SignParams): AxisScale {
  const g = (params.scale || 100) / 100;
  return {
    x: (g * (params.scaleX || 100)) / 100,
    y: (g * (params.scaleY || 100)) / 100,
    z: (g * (params.scaleZ || 100)) / 100,
  };
}

const round = (n: number) => Number(n.toFixed(4));

/**
 * Aplica escala por eixo às medidas em mm.
 * Os contornos são gerados na altura escalada em Y; o estiramento horizontal
 * extra (x/y) é aplicado depois, direto nos contornos.
 */
export function scaleParams(params: SignParams): SignParams {
  const s = axisScale(params);
  if (s.x === 1 && s.y === 1 && s.z === 1) return params;
  const out: SignParams = { ...params };
  const xy = (s.x + s.y) / 2;
  for (const key of Y_KEYS) out[key] = round(params[key] * s.y);
  // tracking entra na geração do texto antes do estiramento x/y
  for (const key of X_KEYS) out[key] = round(params[key] * s.y);
  for (const key of XY_KEYS) out[key] = round(params[key] * xy);
  for (const key of Z_KEYS) out[key] = round(params[key] * s.z);
  return out;
}


const EditorContext = createContext<EditorState | null>(null);

export function useEditor(): EditorState {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("useEditor deve ser usado dentro de EditorProvider");
  return ctx;
}

export function useEditorState(): EditorState {
  const [styleId, setStyleId] = useState(DEFAULT_PARAMS.text ? "caixa-iluminada" : "caixa-iluminada");
  const [params, setParamsState] = useState<SignParams>(() =>
    paramsForStyle(getStyle("caixa-iluminada")),
  );
  const [font, setFont] = useState<Font | null>(null);
  const [explode, setExplode] = useState(0);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [wireframe, setWireframe] = useState(false);
  const [showOutlines, setShowOutlines] = useState(false);
  const [svg, setSvgState] = useState<{ name: string; content: string } | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("Novo projeto");

  useEffect(() => {
    let cancelled = false;
    loadFont(params.fontId)
      .then((f) => {
        if (!cancelled) setFont(f);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [params.fontId]);

  const style = useMemo(() => getStyle(styleId), [styleId]);

  const scaledParams = useMemo(() => scaleParams(params), [params]);

  const build = useMemo(() => {
    try {
      const p = scaledParams;
      const s = axisScale(params);
      const base = svg
        ? svgToShapes(svg.content, p.letterHeight)
        : font
          ? textToShapes(font, p.text.toUpperCase(), p.letterHeight, p.tracking)
          : [];
      const shapes = s.y === 0 ? base : scaleShapes(base, s.x / s.y, 1);

      if (!shapes.length) return null;
      return buildSign(shapes, p, style);
    } catch (error) {
      console.error("Falha ao gerar geometria", error);
      return null;
    }
  }, [font, svg, params, scaledParams, style]);

  const cost = useMemo(
    () => (build ? computeCost(build, scaledParams) : null),
    [build, scaledParams],
  );

  return {
    params,
    style,
    build,
    cost,
    ready: Boolean(font) || Boolean(svg),
    explode,
    hidden,
    wireframe,
    showOutlines,
    svgName: svg?.name ?? null,
    setSvg: (name, content) => setSvgState({ name, content }),
    clearSvg: () => setSvgState(null),
    setWireframe,
    setShowOutlines,
    projectId,
    projectName,
    setParam: (key, value) => setParamsState((prev) => ({ ...prev, [key]: value })),
    setParams: (patch) => setParamsState((prev) => ({ ...prev, ...patch })),
    selectStyle: (id) => {
      setStyleId(id);
      setParamsState((prev) => paramsForStyle(getStyle(id), prev));
      setHidden(new Set());
    },
    setExplode,
    togglePart: (id) =>
      setHidden((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    loadProject: (p) => {
      setStyleId(p.styleId);
      setParamsState({ ...DEFAULT_PARAMS, ...p.params });
      setProjectId(p.id);
      setProjectName(p.name);
      setHidden(new Set());
    },
    setProject: (id, name) => {
      setProjectId(id);
      setProjectName(name);
    },
  };
}

export const EditorProvider = EditorContext.Provider;
