import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Font } from "opentype.js";

import { loadFont, parseCustomFont, textToShapes } from "@/lib/sign/fonts";
import { svgToShapes } from "@/lib/sign/svg";
import { dxfToShapes } from "@/lib/sign/dxf";
import { buildSign, type SignBuild } from "@/lib/sign/build";
import { computeCost, type CostBreakdown } from "@/lib/sign/cost";
import { paramsForPrinter } from "@/lib/sign/printers";
import { geometryVolumeCm3 } from "@/lib/sign/build";
import {
  createSketchHistory,
  commitSketch,
  extrudeSketchEntity,
  redoSketch as redoSketchHistory,
  undoSketch as undoSketchHistory,
  type SketchHistory,
  type SketchState,
} from "@/lib/sign/sketch";
import type { BufferGeometry } from "three";
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
  loadError: string | null;
  customFontName: string | null;
  setCustomFont: (name: string, buffer: ArrayBuffer) => void;
  clearCustomFont: () => void;
  explode: number;
  hidden: Set<string>;
  wireframe: boolean;
  showOutlines: boolean;
  svgName: string | null;
  vectorKind: "svg" | "dxf" | null;
  vectorSource: { name: string; content: string; kind: "svg" | "dxf" } | null;
  setSvg: (name: string, content: string) => void;
  setDxf: (name: string, content: string) => void;
  clearSvg: () => void;
  sketch: SketchHistory;
  sketchParts: SketchPart[];
  updateSketch: (updater: (state: SketchState) => SketchState) => void;
  undoSketch: () => void;
  redoSketch: () => void;
  setSketchState: (state: SketchState) => void;
  projectId: string | null;
  projectName: string;
  setParam: <K extends keyof SignParams>(key: K, value: SignParams[K]) => void;
  setParams: (patch: Partial<SignParams>) => void;
  selectPrinter: (id: string) => void;
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
    vectorSource?: { name: string; content: string; kind: "svg" | "dxf" } | null;
    sketch?: SketchState | null;
  }) => void;
  setProject: (id: string | null, name: string) => void;
}

export interface SketchPart {
  id: string;
  entityId: string;
  name: string;
  height: number;
  geometry: BufferGeometry;
  volumeCm3: number;
}

const EditorContext = createContext<EditorState | null>(null);

const NON_GEOMETRY_PARAMS = new Set<keyof SignParams>([
  "printerId",
  "buildWidth",
  "buildDepth",
  "buildHeight",
  "nozzleDiameter",
  "filamentDiameter",
  "maxPrintSpeed",
  "splitForBuildPlate",
  "splitMargin",
  "splitMode",
  "manualCutAngle",
  "manualCutOffset",
  "manualCutSeparation",
  "manualCutTarget",
  "manualCuts",
  "cutConnector",
  "cutMaleSide",
  "cutConnectorDepth",
  "cutConnectorWidth",
  "cutConnectorThickness",
  "cutConnectorClearance",
  "filamentPrice",
  "density",
  "printSpeed",
  "hourlyRate",
  "energyPrice",
  "printerPower",
  "margin",
]);

let previousGeometryKey = "";
let previousGeometryParams: SignParams | null = null;

function paramsForGeometry(params: SignParams): SignParams {
  const key = JSON.stringify(
    Object.entries(params).filter(([name]) => !NON_GEOMETRY_PARAMS.has(name as keyof SignParams)),
  );
  if (key === previousGeometryKey && previousGeometryParams) return previousGeometryParams;
  previousGeometryKey = key;
  previousGeometryParams = params;
  return params;
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

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
  const [customFont, setCustomFontState] = useState<Font | null>(null);
  const [customFontName, setCustomFontName] = useState<string | null>(null);
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
  const [sketch, setSketch] = useState<SketchHistory>(() => createSketchHistory());
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("Novo projeto");

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
  // A construção 3D é síncrona e cara. Alterações rápidas de sliders são
  // consolidadas para evitar uma fila de reconstruções que bloqueia a interface.
  const deferredParams = useDebouncedValue(params, 120);
  const geometryParams = paramsForGeometry(deferredParams);

  const build = useMemo(() => {
    try {
      const shapes = svg
        ? svg.kind === "dxf"
          ? dxfToShapes(svg.content)
          : svgToShapes(svg.content)
        : (customFont ?? font)
          ? textToShapes(
              (customFont ?? font)!,
              geometryParams.text.toUpperCase(),
              geometryParams.letterHeight,
              geometryParams.tracking,
            )
          : [];
      if (!shapes.length) return null;
      return buildSign(shapes, geometryParams, style);
    } catch (error) {
      console.error("Falha ao gerar geometria", error);
      return null;
    }
  }, [font, customFont, svg, geometryParams, style]);

  const sketchParts = useMemo<SketchPart[]>(() => {
    const parts: SketchPart[] = [];
    for (const extrusion of sketch.present.extrusions) {
      const entity = sketch.present.entities.find((item) => item.id === extrusion.entityId);
      if (!entity) continue;
      const geometry = extrudeSketchEntity(entity, extrusion.height);
      if (!geometry) continue;
      parts.push({
        id: extrusion.id,
        entityId: extrusion.entityId,
        name: `Esboço ${entity.type}`,
        height: extrusion.height,
        geometry,
        volumeCm3: geometryVolumeCm3(geometry),
      });
    }
    return parts;
  }, [sketch]);

  const cost = useMemo(
    () => (build ? computeCost(build, deferredParams) : null),
    [build, deferredParams],
  );

  return {
    params,
    style,
    build,
    cost,
    ready: Boolean(customFont ?? font) || Boolean(svg),
    loadError,
    customFontName,
    setCustomFont: (name, buffer) => {
      const parsed = parseCustomFont(buffer);
      setCustomFontState(parsed);
      setCustomFontName(name);
      setLoadError(null);
    },
    clearCustomFont: () => {
      setCustomFontState(null);
      setCustomFontName(null);
    },
    explode,
    hidden,
    wireframe,
    showOutlines,
    svgName: svg?.name ?? null,
    vectorKind: svg?.kind ?? null,
    vectorSource: svg,
    setSvg: (name, content) => setSvgState({ name, content, kind: "svg" }),
    setDxf: (name, content) => setSvgState({ name, content, kind: "dxf" }),
    clearSvg: () => setSvgState(null),
    setWireframe,
    setShowOutlines,
    sketch,
    sketchParts,
    updateSketch: (updater) => setSketch((prev) => commitSketch(prev, updater)),
    undoSketch: () => setSketch((prev) => undoSketchHistory(prev)),
    redoSketch: () => setSketch((prev) => redoSketchHistory(prev)),
    setSketchState: (state) => setSketch(createSketchHistory(state)),
    projectId,
    projectName,
    setParam: (key, value) => setParamsState((prev) => ({ ...prev, [key]: value })),
    setParams: (patch) => setParamsState((prev) => ({ ...prev, ...patch })),
    selectPrinter: (id) => setParamsState((prev) => paramsForPrinter(id, prev)),
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
      setSvgState(p.vectorSource ?? null);
      setSketch(createSketchHistory(p.sketch ?? undefined));
      setHidden(new Set());
    },
    setProject: (id, name) => {
      setProjectId(id);
      setProjectName(name);
    },
  };
}

export const EditorProvider = EditorContext.Provider;
