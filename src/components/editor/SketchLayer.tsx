import { useEffect, useMemo, useRef, useState } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Vector3, type Group } from "three";

import { useEditor } from "./store";
import {
  addEntity,
  clearSelection,
  entityPoints,
  nextSketchId,
  removeEntities,
  selectEntity,
  snapPoint,
  type SketchEntity,
  type SketchPoint,
} from "@/lib/sign/sketch";

export type SketchTool = "select" | "line" | "rect" | "circle";

interface Draft {
  tool: SketchTool;
  points: SketchPoint[];
}

function lineGeometry(points: SketchPoint[], closed: boolean, z = 0): BufferGeometry {
  const values: number[] = [];
  const limit = closed ? points.length : points.length - 1;
  for (let i = 0; i < limit; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    values.push(a.x, a.y, z, b.x, b.y, z);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(values, 3));
  return geometry;
}

function EntityLine({
  entity,
  selected,
  onSelect,
}: {
  entity: SketchEntity;
  selected: boolean;
  onSelect: (id: string, additive: boolean) => void;
}) {
  const geometry = useMemo(() => {
    const points = entityPoints(entity);
    const closed = entity.type !== "polyline" || entity.closed;
    return lineGeometry(points, closed, 0.02);
  }, [entity]);

  return (
    <lineSegments
      geometry={geometry}
      renderOrder={1200}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        onSelect(entity.id, event.nativeEvent.shiftKey);
      }}
    >
      <lineBasicMaterial
        color={selected ? "#f97316" : "#1d4ed8"}
        depthTest={false}
        transparent
        opacity={1}
      />
    </lineSegments>
  );
}

export default function SketchLayer({
  scale,
  active,
  tool,
  snapGrid,
  snapEndpoints,
  gridSize,
  onCursor,
}: {
  scale: number;
  active: boolean;
  tool: SketchTool;
  snapGrid: boolean;
  snapEndpoints: boolean;
  gridSize: number;
  onCursor: (point: SketchPoint | null) => void;
}) {
  const { sketch, sketchParts, updateSketch } = useEditor();
  const groupRef = useRef<Group>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [cursor, setCursor] = useState<SketchPoint | null>(null);
  const state = sketch.present;

  const stateRef = useRef(state);
  stateRef.current = state;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    if (!active) {
      setDraft(null);
      setCursor(null);
      onCursor(null);
    }
  }, [active, onCursor]);

  useEffect(() => {
    setDraft(null);
  }, [tool]);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key === "Escape") {
        setDraft(null);
        updateSketch((current) => clearSelection(current));
      }
      if (event.key === "Enter") {
        const current = draftRef.current;
        if (current?.tool === "line" && current.points.length >= 2) {
          const first = current.points[0]!;
          const last = current.points[current.points.length - 1]!;
          const closed = Math.hypot(first.x - last.x, first.y - last.y) <= gridSize;
          updateSketch((prev) =>
            addEntity(prev, {
              id: nextSketchId(),
              type: "polyline",
              points: current.points,
              closed,
            }),
          );
        }
        setDraft(null);
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        const ids = stateRef.current.selectedIds;
        if (ids.length) {
          event.preventDefault();
          updateSketch((prev) => removeEntities(prev, ids));
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, gridSize, updateSketch]);

  const snap = (point: SketchPoint): SketchPoint =>
    snapPoint(point, state.entities, {
      gridEnabled: snapGrid,
      gridSize,
      endpointEnabled: snapEndpoints,
      tolerance: Math.max(gridSize, 4),
    });

  const localPoint = (event: ThreeEvent<PointerEvent | MouseEvent>): SketchPoint | null => {
    const group = groupRef.current;
    if (!group) return null;
    const local = group.worldToLocal(event.point.clone());
    return snap({ x: local.x, y: local.y });
  };

  const handleMove = (event: ThreeEvent<PointerEvent>) => {
    if (!active) return;
    const point = localPoint(event);
    if (!point) return;
    setCursor(point);
    onCursor(point);
  };

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (!active) return;
    event.stopPropagation();
    const point = localPoint(event);
    if (!point) return;
    if (tool === "select") {
      updateSketch((prev) => clearSelection(prev));
      return;
    }
    const current = draftRef.current;
    if (tool === "line") {
      setDraft({ tool: "line", points: [...(current?.points ?? []), point] });
      return;
    }
    if (!current) {
      setDraft({ tool, points: [point] });
      return;
    }
    const start = current.points[0]!;
    if (tool === "rect") {
      const width = point.x - start.x;
      const height = point.y - start.y;
      if (Math.abs(width) > 1e-6 && Math.abs(height) > 1e-6) {
        updateSketch((prev) =>
          addEntity(prev, {
            id: nextSketchId(),
            type: "rect",
            x: Math.min(start.x, point.x),
            y: Math.min(start.y, point.y),
            width: Math.abs(width),
            height: Math.abs(height),
          }),
        );
      }
    } else {
      const radius = Math.hypot(point.x - start.x, point.y - start.y);
      if (radius > 1e-6) {
        updateSketch((prev) =>
          addEntity(prev, { id: nextSketchId(), type: "circle", cx: start.x, cy: start.y, radius }),
        );
      }
    }
    setDraft(null);
  };

  const draftEntity = useMemo<SketchEntity | null>(() => {
    if (!draft || !cursor) return null;
    const start = draft.points[0]!;
    if (draft.tool === "line") {
      return {
        id: "draft",
        type: "polyline",
        points: [...draft.points, cursor],
        closed: false,
      };
    }
    if (draft.tool === "rect") {
      return {
        id: "draft",
        type: "rect",
        x: Math.min(start.x, cursor.x),
        y: Math.min(start.y, cursor.y),
        width: Math.abs(cursor.x - start.x),
        height: Math.abs(cursor.y - start.y),
      };
    }
    return {
      id: "draft",
      type: "circle",
      cx: start.x,
      cy: start.y,
      radius: Math.hypot(cursor.x - start.x, cursor.y - start.y),
    };
  }, [draft, cursor]);

  const draftGeometry = useMemo(() => {
    if (!draftEntity) return null;
    if (draftEntity.type === "polyline" && draftEntity.points.length < 2) return null;
    const points = entityPoints(draftEntity);
    return lineGeometry(points, draftEntity.type !== "polyline", 0.03);
  }, [draftEntity]);

  const planeSize = 4000;

  return (
    <group ref={groupRef} scale={scale}>
      {active && (
        <mesh
          position={[0, 0, 0]}
          onPointerMove={handleMove}
          onClick={handleClick}
          onPointerMissed={() => setDraft(null)}
        >
          <planeGeometry args={[planeSize, planeSize]} />
          <meshBasicMaterial
            transparent
            opacity={0.04}
            color="#1d4ed8"
            side={DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}

      {state.entities.map((entity) => (
        <EntityLine
          key={entity.id}
          entity={entity}
          selected={state.selectedIds.includes(entity.id)}
          onSelect={(id, additive) =>
            active && tool === "select"
              ? updateSketch((prev) => selectEntity(prev, id, additive))
              : undefined
          }
        />
      ))}

      {draftGeometry && (
        <lineSegments geometry={draftGeometry} renderOrder={1300}>
          <lineBasicMaterial color="#0ea5e9" depthTest={false} transparent opacity={0.95} />
        </lineSegments>
      )}

      {sketchParts.map((part) => (
        <mesh key={part.id} geometry={part.geometry} castShadow receiveShadow>
          <meshStandardMaterial color="#7c3aed" roughness={0.5} metalness={0.05} />
        </mesh>
      ))}

      {cursor && active && (
        <mesh position={[cursor.x, cursor.y, 0.05]}>
          <sphereGeometry args={[Math.max(gridSize * 0.25, 1.2), 12, 12]} />
          <meshBasicMaterial color="#f97316" depthTest={false} />
        </mesh>
      )}
    </group>
  );
}

export function sketchCenterOffset(points: SketchPoint[]): Vector3 {
  if (!points.length) return new Vector3();
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return new Vector3(x / points.length, y / points.length, 0);
}
