import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Font } from "opentype.js";

import { loadFont, textToShapes } from "@/lib/sign/fonts";
import { svgToShapes } from "@/lib/sign/svg";
import { dxfToShapes } from "@/lib/sign/dxf";
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
  vectorKind: "svg" | "dxf" | null;
  setSvg: (name: string, content: string) => void;
  setDxf: (name: string, content: string) => void;
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
  const [svg, setSvgState] = useState<{
    name: string;
    content: string;
    kind: "svg" | "dxf";
  } | null>(null);
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

  const build = useMemo(() => {
    try {
      const shapes = svg
        ? svg.kind === "dxf"
          ? dxfToShapes(svg.content, params.letterHeight)
          : svgToShapes(svg.content, params.letterHeight)
        : font
          ? textToShapes(font, params.text.toUpperCase(), params.letterHeight, params.tracking)
          : [];
      if (!shapes.length) return null;
      return buildSign(shapes, params, style);
    } catch (error) {
      console.error("Falha ao gerar geometria", error);
      return null;
    }
  }, [font, svg, params, style]);

  const cost = useMemo(() => (build ? computeCost(build, params) : null), [build, params]);

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
    vectorKind: svg?.kind ?? null,
    setSvg: (name, content) => setSvgState({ name, content, kind: "svg" }),
    setDxf: (name, content) => setSvgState({ name, content, kind: "dxf" }),
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
