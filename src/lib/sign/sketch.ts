import { ExtrudeGeometry, Shape, type BufferGeometry } from "three";

/** Ponto 2D do esboço, sempre em milímetros no plano XY. */
export interface SketchPoint {
  x: number;
  y: number;
}

export type SketchEntity =
  | { id: string; type: "polyline"; points: SketchPoint[]; closed: boolean }
  | { id: string; type: "rect"; x: number; y: number; width: number; height: number }
  | { id: string; type: "circle"; cx: number; cy: number; radius: number };

export interface SketchExtrusion {
  id: string;
  entityId: string;
  height: number;
}

export interface SketchState {
  entities: SketchEntity[];
  extrusions: SketchExtrusion[];
  selectedIds: string[];
}

export interface SketchHistory {
  past: SketchState[];
  present: SketchState;
  future: SketchState[];
}

export const EMPTY_SKETCH: SketchState = { entities: [], extrusions: [], selectedIds: [] };

export function createSketchHistory(state: SketchState = EMPTY_SKETCH): SketchHistory {
  return { past: [], present: state, future: [] };
}

/** Aplica uma alteração criando um novo ponto de desfazer. */
export function commitSketch(
  history: SketchHistory,
  updater: (state: SketchState) => SketchState,
): SketchHistory {
  const next = updater(history.present);
  if (next === history.present) return history;
  return { past: [...history.past, history.present].slice(-100), present: next, future: [] };
}

export function undoSketch(history: SketchHistory): SketchHistory {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future].slice(0, 100),
  };
}

export function redoSketch(history: SketchHistory): SketchHistory {
  const next = history.future[0];
  if (!next) return history;
  return {
    past: [...history.past, history.present].slice(-100),
    present: next,
    future: history.future.slice(1),
  };
}

export function canUndo(history: SketchHistory): boolean {
  return history.past.length > 0;
}

export function canRedo(history: SketchHistory): boolean {
  return history.future.length > 0;
}

let sketchIdCounter = 0;
export function nextSketchId(prefix = "e"): string {
  sketchIdCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${sketchIdCounter.toString(36)}`;
}

export function addEntity(state: SketchState, entity: SketchEntity): SketchState {
  return { ...state, entities: [...state.entities, entity], selectedIds: [entity.id] };
}

export function removeEntities(state: SketchState, ids: string[]): SketchState {
  const set = new Set(ids);
  return {
    entities: state.entities.filter((entity) => !set.has(entity.id)),
    extrusions: state.extrusions.filter((extrusion) => !set.has(extrusion.entityId)),
    selectedIds: state.selectedIds.filter((id) => !set.has(id)),
  };
}

export function selectEntity(state: SketchState, id: string, additive = false): SketchState {
  if (!additive) {
    return { ...state, selectedIds: state.selectedIds.includes(id) && state.selectedIds.length === 1 ? [] : [id] };
  }
  return {
    ...state,
    selectedIds: state.selectedIds.includes(id)
      ? state.selectedIds.filter((current) => current !== id)
      : [...state.selectedIds, id],
  };
}

export function clearSelection(state: SketchState): SketchState {
  return state.selectedIds.length ? { ...state, selectedIds: [] } : state;
}

/** Cria ou atualiza a extrusão de um perfil fechado. */
export function setExtrusion(state: SketchState, entityId: string, height: number): SketchState {
  const entity = state.entities.find((current) => current.id === entityId);
  if (!entity || !isClosedProfile(entity)) return state;
  const safeHeight = Math.max(0.5, Number.isFinite(height) ? height : 0.5);
  const existing = state.extrusions.find((extrusion) => extrusion.entityId === entityId);
  if (existing) {
    return {
      ...state,
      extrusions: state.extrusions.map((extrusion) =>
        extrusion.entityId === entityId ? { ...extrusion, height: safeHeight } : extrusion,
      ),
    };
  }
  return {
    ...state,
    extrusions: [
      ...state.extrusions,
      { id: nextSketchId("x"), entityId, height: safeHeight },
    ],
  };
}

export function removeExtrusion(state: SketchState, entityId: string): SketchState {
  return {
    ...state,
    extrusions: state.extrusions.filter((extrusion) => extrusion.entityId !== entityId),
  };
}

/** Pontos do contorno da entidade (círculos são discretizados). */
export function entityPoints(entity: SketchEntity, segments = 64): SketchPoint[] {
  if (entity.type === "polyline") return entity.points;
  if (entity.type === "rect") {
    const { x, y, width, height } = entity;
    return [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ];
  }
  const points: SketchPoint[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points.push({
      x: entity.cx + Math.cos(angle) * entity.radius,
      y: entity.cy + Math.sin(angle) * entity.radius,
    });
  }
  return points;
}

/** Um perfil é fechado quando pode virar uma face extrudável. */
export function isClosedProfile(entity: SketchEntity): boolean {
  if (entity.type === "rect") return Math.abs(entity.width) > 1e-6 && Math.abs(entity.height) > 1e-6;
  if (entity.type === "circle") return entity.radius > 1e-6;
  if (!entity.closed) return false;
  const unique = dedupePoints(entity.points);
  return unique.length >= 3 && Math.abs(polygonArea(unique)) > 1e-6;
}

export function dedupePoints(points: SketchPoint[], epsilon = 1e-4): SketchPoint[] {
  const result: SketchPoint[] = [];
  for (const point of points) {
    const last = result[result.length - 1];
    if (last && Math.hypot(last.x - point.x, last.y - point.y) <= epsilon) continue;
    result.push(point);
  }
  const first = result[0];
  const last = result[result.length - 1];
  if (result.length > 1 && first && last && Math.hypot(first.x - last.x, first.y - last.y) <= epsilon) {
    result.pop();
  }
  return result;
}

export function polygonArea(points: SketchPoint[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

export interface SnapOptions {
  gridEnabled: boolean;
  gridSize: number;
  endpointEnabled: boolean;
  tolerance: number;
}

export function collectEndpoints(entities: SketchEntity[]): SketchPoint[] {
  const points: SketchPoint[] = [];
  for (const entity of entities) {
    if (entity.type === "circle") {
      points.push({ x: entity.cx, y: entity.cy });
      continue;
    }
    points.push(...entityPoints(entity));
  }
  return points;
}

/** Aplica snap em pontos finais existentes e depois na grade. */
export function snapPoint(
  point: SketchPoint,
  entities: SketchEntity[],
  options: SnapOptions,
): SketchPoint {
  if (options.endpointEnabled) {
    let best: SketchPoint | null = null;
    let bestDistance = options.tolerance;
    for (const candidate of collectEndpoints(entities)) {
      const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
      if (distance <= bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    if (best) return { x: best.x, y: best.y };
  }
  if (options.gridEnabled && options.gridSize > 0) {
    return {
      x: Math.round(point.x / options.gridSize) * options.gridSize,
      y: Math.round(point.y / options.gridSize) * options.gridSize,
    };
  }
  return { x: point.x, y: point.y };
}

export function entityToShape(entity: SketchEntity): Shape | null {
  if (!isClosedProfile(entity)) return null;
  const shape = new Shape();
  if (entity.type === "circle") {
    shape.absarc(entity.cx, entity.cy, entity.radius, 0, Math.PI * 2, false);
    return shape;
  }
  const points = entity.type === "rect" ? entityPoints(entity) : dedupePoints(entity.points);
  const first = points[0]!;
  shape.moveTo(first.x, first.y);
  for (const point of points.slice(1)) shape.lineTo(point.x, point.y);
  shape.closePath();
  return shape;
}

export function extrudeSketchEntity(entity: SketchEntity, height: number): BufferGeometry | null {
  const shape = entityToShape(entity);
  if (!shape) return null;
  const geometry = new ExtrudeGeometry(shape, {
    depth: Math.max(0.5, height),
    bevelEnabled: false,
    curveSegments: 48,
  });
  geometry.computeVertexNormals();
  return geometry;
}

/** Formato serializado gravado junto com os parâmetros do projeto. */
export interface SerializedSketch {
  entities: SketchEntity[];
  extrusions: SketchExtrusion[];
}

export function serializeSketch(state: SketchState): SerializedSketch {
  return { entities: state.entities, extrusions: state.extrusions };
}

/** Aceita projetos antigos (sem esboço) devolvendo um estado vazio. */
export function parseSketch(input: unknown): SketchState {
  if (!input || typeof input !== "object") return EMPTY_SKETCH;
  const raw = input as { entities?: unknown; extrusions?: unknown };
  const entities: SketchEntity[] = [];
  if (Array.isArray(raw.entities)) {
    for (const item of raw.entities) {
      const entity = parseEntity(item);
      if (entity) entities.push(entity);
    }
  }
  const ids = new Set(entities.map((entity) => entity.id));
  const extrusions: SketchExtrusion[] = [];
  if (Array.isArray(raw.extrusions)) {
    for (const item of raw.extrusions) {
      if (!item || typeof item !== "object") continue;
      const value = item as Partial<SketchExtrusion>;
      if (typeof value.entityId !== "string" || !ids.has(value.entityId)) continue;
      if (typeof value.height !== "number" || !Number.isFinite(value.height)) continue;
      extrusions.push({
        id: typeof value.id === "string" ? value.id : nextSketchId("x"),
        entityId: value.entityId,
        height: Math.max(0.5, value.height),
      });
    }
  }
  return { entities, extrusions, selectedIds: [] };
}

function parseEntity(input: unknown): SketchEntity | null {
  if (!input || typeof input !== "object") return null;
  const value = input as {
    id?: unknown;
    type?: unknown;
    points?: unknown;
    closed?: unknown;
    x?: unknown;
    y?: unknown;
    width?: unknown;
    height?: unknown;
    cx?: unknown;
    cy?: unknown;
    radius?: unknown;
  };
  const id = typeof value.id === "string" ? value.id : nextSketchId();
  if (value.type === "polyline" && Array.isArray(value.points)) {
    const points: SketchPoint[] = [];
    for (const item of value.points) {
      if (!item || typeof item !== "object") continue;
      const point = item as { x?: unknown; y?: unknown };
      if (typeof point.x !== "number" || typeof point.y !== "number") continue;
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      points.push({ x: point.x, y: point.y });
    }
    if (points.length < 2) return null;
    return { id, type: "polyline", points, closed: value.closed === true };
  }
  if (value.type === "rect") {
    const { x, y, width, height } = value;
    if (![x, y, width, height].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    return {
      id,
      type: "rect",
      x: x as number,
      y: y as number,
      width: width as number,
      height: height as number,
    };
  }
  if (value.type === "circle") {
    const { cx, cy, radius } = value;
    if (![cx, cy, radius].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    if ((radius as number) <= 0) return null;
    return { id, type: "circle", cx: cx as number, cy: cy as number, radius: radius as number };
  }
  return null;
}
