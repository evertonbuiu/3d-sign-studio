import { createContext, useContext, useDeferredValue, useEffect, useMemo, useState } from "react";
import type { Font } from "opentype.js";

import { getAvailableFonts, loadFont, textToShapes } from "@/lib/sign/fonts";
import {
  getInstalledFontPackageIds,
  setInstalledFontPackageIds,
} from "@/lib/sign/googleFonts";
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
import type { FontEntry } from "@/lib/sign/fonts";

export interface EditorState {
  params: SignParams;
  style: SignStyle;
  build: SignBuild | null;
  cost: CostBreakdown | null;
  ready: boolean;
  loadError: string | null;
  explode: number;
  hidden: Set<string>;
  wireframe: boolean;
  showOutlines: boolean;
  svgName: string | null;
  vectorKind: "svg" | "dxf" | null;
  vectorSource: { name: string; content: string; kind: "svg" | "dxf" } | null;
  availableFonts: FontEntry[];
  installedFontPackages: string[];
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
  installFontPackage: (id: string) => void;
  uninstallFontPackage: (id: string) => void;
  loadProject: (p: {
    id: string;
    name: string;
    styleId: string;
    params: Partial<SignParams>;
    vectorSource?: { name: string; content: string; kind: "svg" | "dxf" } | null;
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
  const [styleId, setStyleId] = useState("caixa-iluminada");
  const [params, setParamsState] = useState<SignParams>(() =>
    paramsForStyle(getStyle("caixa-iluminada")),
  );
  const [font, setFont] = useState<Font | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
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
  const [installedFontPackages, setInstalledFontPackages] = useState<string[]>(() =>
    getInstalledFontPackageIds(),
  );

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    loadFont(params.fontId)
      .then((f) => {
        if (!cancelled) setFont(f);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFont(null);
          setLoadError(
            error instanceof Error ? error.message : "Não foi possível carregar a fonte.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [params.fontId]);

  const style = useMemo(() => getStyle(styleId), [styleId]);
  const deferredParams = useDeferredValue(params);
  const availableFonts = useMemo(
    () => getAvailableFonts(installedFontPackages),
    [installedFontPackages],
  );

  const build = useMemo(() => {
    try {
      const shapes = svg
        ? svg.kind === "dxf"
          ? dxfToShapes(svg.content, deferredParams.letterHeight)
          : svgToShapes(svg.content, deferredParams.letterHeight)
        : font
          ? textToShapes(
              font,
              deferredParams.text.toUpperCase(),
              deferredParams.letterHeight,
              deferredParams.tracking,
            )
          : [];
      if (!shapes.length) return null;
      return buildSign(shapes, deferredParams, style);
    } catch (error) {
      console.error("Falha ao gerar geometria", error);
      return null;
    }
  }, [font, svg, deferredParams, style]);

  const cost = useMemo(
    () => (build ? computeCost(build, deferredParams) : null),
    [build, deferredParams],
  );

  return {
    params,
    style,
    build,
    cost,
    ready: Boolean(font) || Boolean(svg),
    loadError,
    explode,
    hidden,
    wireframe,
    showOutlines,
    svgName: svg?.name ?? null,
    vectorKind: svg?.kind ?? null,
    vectorSource: svg,
    availableFonts,
    installedFontPackages,
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
    installFontPackage: (id) =>
      setInstalledFontPackages((prev) => {
        const next = prev.includes(id) ? prev : [...prev, id];
        setInstalledFontPackageIds(next);
        return next;
      }),
    uninstallFontPackage: (id) =>
      setInstalledFontPackages((prev) => {
        const next = prev.filter((p) => p !== id);
        setInstalledFontPackageIds(next);
        return next;
      }),
    loadProject: (p) => {
      setStyleId(p.styleId);
      setParamsState({ ...DEFAULT_PARAMS, ...p.params });
      setProjectId(p.id);
      setProjectName(p.name);
      setSvgState(p.vectorSource ?? null);
      setHidden(new Set());
    },
    setProject: (id, name) => {
      setProjectId(id);
      setProjectName(name);
    },
  };
}

export const EditorProvider = EditorContext.Provider;
