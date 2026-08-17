import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { ContactShadows, Grid, OrbitControls } from "@react-three/drei";
import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Mesh,
  Vector3,
  type Group,
} from "three";

import { useEditor } from "./store";
import SketchLayer, { type SketchTool } from "./SketchLayer";
import {
  canRedo,
  canUndo,
  isClosedProfile,
  removeEntities,
  setExtrusion,
  type SketchPoint,
} from "@/lib/sign/sketch";
import type { SignOutline, SignPart } from "@/lib/sign/build";
import type { SignParams } from "@/lib/sign/model";
import {
  clipGeometryByPlaneForPreview,
  partSupportsCutConnector,
  resolveCutConnectorWidth,
  splitGeometryByPlane,
  splitGeometryByPlanes,
  type SequentialSplitOptions,
} from "@/lib/sign/split";
import {
  transformGeometryForPlacement,
  transformPlacementPoint,
} from "@/lib/sign/placement";

const EXPLODE_ORDER: Record<string, number> = {
  poste: -2,
  placa: -1,
  fundo: 0,
  laterais: 1,
  "canal-led": 2,
  furos: 0,
  frente: 4,
  "camada-2": 5,
  "camada-3": 6,
};

export interface PickedEdge {
  key: string;
  partId: string;
  partLabel: string;
  a: [number, number, number];
  b: [number, number, number];
  offset: number;
  length: number;
}

function EdgePicker({
  part,
  offset,
  onHover,
  onPick,
}: {
  part: SignPart;
  offset: number;
  onHover: (edge: PickedEdge | null) => void;
  onPick: (edge: PickedEdge, additive: boolean) => void;
}) {
  const edges = useMemo(() => new EdgesGeometry(part.geometry, 20), [part.geometry]);

  const edgeAt = (index: number): PickedEdge | null => {
    const pos = edges.getAttribute("position");
    const i = index - (index % 2);
    if (!pos || i + 1 >= pos.count) return null;
    const a: [number, number, number] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const b: [number, number, number] = [pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1)];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    return {
      key: `${part.id}:${i}`,
      partId: part.id,
      partLabel: part.name,
      a,
      b,
      offset,
      length,
    };
  };

  const handle = (event: ThreeEvent<PointerEvent>, pick: boolean) => {
    const index = event.index;
    if (index == null) return;
    const edge = edgeAt(index);
    if (!edge) return;
    event.stopPropagation();
    if (pick) onPick(edge, event.nativeEvent.shiftKey);
    else onHover(edge);
  };

  return (
    <lineSegments
      geometry={edges}
      position={[0, 0, offset]}
      onPointerMove={(e) => handle(e, false)}
      onPointerOut={() => onHover(null)}
      onClick={(e) => handle(e as unknown as ThreeEvent<PointerEvent>, true)}
    >
      <lineBasicMaterial color="#64748b" transparent opacity={0.55} />
    </lineSegments>
  );
}

function EdgeHighlight({ edge, color }: { edge: PickedEdge; color: string }) {
  const geometry = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute([...edge.a, ...edge.b], 3));
    return geo;
  }, [edge]);
  return (
    <lineSegments geometry={geometry} position={[0, 0, edge.offset]} renderOrder={1000}>
      <lineBasicMaterial color={color} depthTest={false} transparent opacity={1} />
    </lineSegments>
  );
}

function CutPieceMesh({
  geometry,
  color,
  opacity,
  position,
  wireframe,
}: {
  geometry: BufferGeometry;
  color: string;
  opacity: number;
  position: [number, number, number];
  wireframe: boolean;
}) {
  // O CSG triangula novamente superfícies planas. O limiar maior esconde
  // diagonais auxiliares e mantém apenas contornos e quinas estruturais.
  const edges = useMemo(() => new EdgesGeometry(geometry, 45), [geometry]);
  return (
    <group position={position}>
      {!wireframe && (
        <mesh geometry={geometry} castShadow receiveShadow>
          <meshStandardMaterial
            color={color}
            transparent={opacity < 1}
            opacity={opacity}
            roughness={0.55}
            metalness={0.05}
            side={DoubleSide}
          />
        </mesh>
      )}
      {wireframe && (
        <>
          <mesh geometry={geometry}>
            <meshBasicMaterial color={color} transparent opacity={0.05} depthWrite={false} />
          </mesh>
          <lineSegments geometry={edges}>
            <lineBasicMaterial color={color} transparent opacity={0.8} />
          </lineSegments>
        </>
      )}
    </group>
  );
}

function SelectionBox({ geometry }: { geometry: BufferGeometry }) {
  const edges = useMemo(() => {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) return null;
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const boxGeo = new BoxGeometry(
      Math.max(size.x, 0.01),
      Math.max(size.y, 0.01),
      Math.max(size.z, 0.01),
    );
    boxGeo.translate(center.x, center.y, center.z);
    return new EdgesGeometry(boxGeo);
  }, [geometry]);
  if (!edges) return null;
  return (
    <lineSegments geometry={edges} renderOrder={1400}>
      <lineBasicMaterial color="#f97316" depthTest={false} transparent opacity={0.95} />
    </lineSegments>
  );
}

function PartMesh({
  part,
  explode,
  wireframe,
  manualCut,
  selected = false,
  interactive = false,
  onSelectPart,
  onPushPullStart,
}: {
  part: SignPart;
  explode: number;
  wireframe: boolean;
  selected?: boolean | undefined;
  interactive?: boolean | undefined;
  onSelectPart?: ((part: SignPart) => void) | undefined;
  onPushPullStart?: ((part: SignPart, event: ThreeEvent<PointerEvent>) => void) | undefined;
  manualCut?:
    | {
        angle: number;
        offset: number;
        separation: number;
        connector: "none" | "male-female";
        maleSide: "part-1" | "part-2";
        connectorDepth: number;
        connectorWidth: number;
        connectorThickness: number;
        connectorClearance: number;
        connectorBackInset: number;
        connectorFrontInset: number;
        cuts: SequentialSplitOptions[];
        origin: { x: number; y: number };
        connectorEnabled: boolean;
      }
    | undefined;
}) {
  const offset = (EXPLODE_ORDER[part.kind] ?? 0) * explode;
  // Reduzimos o threshold para 1 grau para mostrar as curvas das letras
  // mas ainda ocultar as diagonais internas de superfícies planas.
  const edges = useMemo(() => new EdgesGeometry(part.geometry, 1), [part.geometry]);
  const manualPieces = useMemo(() => {
    if (!manualCut) return null;
    // O encaixe pertence às paredes. Frente, fundo e acessórios recebem apenas
    // o corte, evitando CSG desnecessário e mantendo macho/fêmea na peça certa.
    const previewConnector = manualCut.connectorEnabled ? manualCut.connector : "none";
    try {
      if (manualCut.cuts.length) {
        return splitGeometryByPlanes(
          part.geometry,
          manualCut.cuts.map((cut) => ({
            ...cut,
            connector: manualCut.connectorEnabled ? (cut.connector ?? "none") : "none",
          })),
          manualCut.origin,
        );
      }
      return splitGeometryByPlane(part.geometry, {
        angle: manualCut.angle,
        offset: manualCut.offset,
        connector: previewConnector,
        maleSide: manualCut.maleSide,
        connectorDepth: manualCut.connectorDepth,
        connectorWidth: manualCut.connectorWidth,
        connectorThickness: manualCut.connectorThickness,
        connectorClearance: manualCut.connectorClearance,
        connectorBackInset: manualCut.connectorBackInset,
        connectorFrontInset: manualCut.connectorFrontInset,
        origin: manualCut.origin,
      });
    } catch (error) {
      console.error(`Falha ao gerar prévia de corte para ${part.name}`, error);
      try {
        // O encaixe usa operações CSG mais sensíveis do que o corte plano. Se
        // ele falhar em uma letra complexa, preserve as metades reais para que
        // o controle "Afastar partes" continue visível e utilizável.
        return splitGeometryByPlane(part.geometry, {
          angle: manualCut.angle,
          offset: manualCut.offset,
          connector: "none",
        });
      } catch (fallbackError) {
        console.error(`Falha ao gerar prévia simples de corte para ${part.name}`, fallbackError);
        return clipGeometryByPlaneForPreview(part.geometry, {
          angle: manualCut.angle,
          offset: manualCut.offset,
        });
      }
    }
  }, [
    part.geometry,
    manualCut?.angle,
    manualCut?.offset,
    manualCut?.connector,
    manualCut?.maleSide,
    manualCut?.connectorDepth,
    manualCut?.connectorWidth,
    manualCut?.connectorThickness,
    manualCut?.connectorClearance,
    manualCut?.connectorBackInset,
    manualCut?.connectorFrontInset,
    manualCut?.cuts,
    manualCut?.origin,
  ]);

  const pointerProps = interactive
    ? {
        onClick: (event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          onSelectPart?.(part);
        },
        onPointerDown: (event: ThreeEvent<PointerEvent>) => {
          if (!onPushPullStart) return;
          event.stopPropagation();
          onPushPullStart(part, event);
        },
      }
    : {};

  if (manualCut && manualPieces?.length) {
    const radians = (manualCut.angle * Math.PI) / 180;
    const cutNormal = new Vector3(Math.cos(radians), Math.sin(radians), 0);
    return (
      <group position={[0, 0, offset]} {...pointerProps}>
        {selected && <SelectionBox geometry={part.geometry} />}
        {manualPieces.map((piece) => {
          const separation = manualCut.separation / 2;
          const side = piece.column === 1 ? -1 : 1;
          const displacement: [number, number, number] = [
            cutNormal.x * separation * side,
            cutNormal.y * separation * side,
            0,
          ];
          return (
            <CutPieceMesh
              key={piece.index}
              geometry={piece.geometry}
              color={part.color}
              opacity={part.opacity}
              position={displacement}
              wireframe={wireframe}
            />
          );
        })}
      </group>
    );
  }

  return (
    <group position={[0, 0, offset]} {...pointerProps}>
      {selected && <SelectionBox geometry={part.geometry} />}
      <mesh geometry={part.geometry} castShadow receiveShadow visible={!wireframe}>
        <meshStandardMaterial
          color={part.color}
          transparent={part.opacity < 1}
          opacity={part.opacity}
          roughness={part.emissive ? 0.35 : 0.55}
          metalness={0.05}
          emissive={part.emissive ? part.color : "#000000"}
          emissiveIntensity={part.emissive ? 0.85 : 0}
        />
      </mesh>
      {wireframe && (
        <>
          {/* Mesh semi-transparente sutil para dar volume no wireframe sem poluir */}
          <mesh geometry={part.geometry}>
            <meshBasicMaterial color={part.color} transparent opacity={0.05} depthWrite={false} />
          </mesh>
          <lineSegments geometry={edges}>
            <lineBasicMaterial color={part.color} transparent opacity={0.8} />
          </lineSegments>
        </>
      )}
    </group>
  );
}

function CutPreview({
  part,
  explode,
  plateWidth,
  plateDepth,
  margin,
}: {
  part: SignPart;
  explode: number;
  plateWidth: number;
  plateDepth: number;
  margin: number;
}) {
  const planes = useMemo(() => {
    part.geometry.computeBoundingBox();
    const box = part.geometry.boundingBox;
    if (!box) return [];
    const size = box.getSize(new Vector3());
    const usableWidth = plateWidth - margin * 2;
    const usableDepth = plateDepth - margin * 2;
    if (usableWidth <= 0 || usableDepth <= 0) return [];
    const result: Array<{
      key: string;
      position: [number, number, number];
      rotation: [number, number, number];
      width: number;
      height: number;
    }> = [];
    for (let x = box.min.x + usableWidth; x < box.max.x - 1e-5; x += usableWidth) {
      result.push({
        key: `x-${x}`,
        position: [x, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2],
        rotation: [0, Math.PI / 2, 0],
        width: size.y,
        height: Math.max(size.z, 1),
      });
    }
    for (let y = box.min.y + usableDepth; y < box.max.y - 1e-5; y += usableDepth) {
      result.push({
        key: `y-${y}`,
        position: [(box.min.x + box.max.x) / 2, y, (box.min.z + box.max.z) / 2],
        rotation: [Math.PI / 2, 0, 0],
        width: size.x,
        height: Math.max(size.z, 1),
      });
    }
    return result;
  }, [part.geometry, plateWidth, plateDepth, margin]);

  if (!planes.length) return null;
  const offset = (EXPLODE_ORDER[part.kind] ?? 0) * explode;
  return (
    <group position={[0, 0, offset]}>
      {planes.map((plane) => (
        <mesh
          key={plane.key}
          position={plane.position}
          rotation={plane.rotation}
          renderOrder={1001}
        >
          <planeGeometry args={[plane.width, plane.height]} />
          <meshBasicMaterial
            color="#ef4444"
            transparent
            opacity={0.32}
            depthTest={false}
            depthWrite={false}
            side={DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}

function ManualCutPlane({
  parts,
  angle,
  offset,
  onOffsetChange,
  onDraggingChange,
}: {
  parts: SignPart[];
  angle: number;
  offset: number;
  onOffsetChange: (offset: number) => void;
  onDraggingChange: (dragging: boolean) => void;
}) {
  const meshRef = useRef<Mesh>(null);
  const [previewOffset, setPreviewOffset] = useState(offset);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startOffset: number;
    screenX: number;
    screenY: number;
    pixelsPerUnit: number;
    currentOffset: number;
    captureTarget: Element;
  } | null>(null);
  const callbacksRef = useRef({ onDraggingChange, onOffsetChange });
  const { camera, size } = useThree();
  useEffect(() => {
    callbacksRef.current = { onDraggingChange, onOffsetChange };
  }, [onDraggingChange, onOffsetChange]);
  useEffect(() => {
    if (!dragRef.current) setPreviewOffset(offset);
  }, [offset]);
  useEffect(() => {
    const finish = (event?: PointerEvent) => {
      const state = dragRef.current;
      if (!state || (event && event.pointerId !== state.pointerId)) return;
      if (state.captureTarget.hasPointerCapture(state.pointerId)) {
        state.captureTarget.releasePointerCapture(state.pointerId);
      }
      dragRef.current = null;
      callbacksRef.current.onDraggingChange(false);
      callbacksRef.current.onOffsetChange(state.currentOffset);
      document.body.style.cursor = "";
    };
    const cancelOnBlur = () => finish();
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", finish, true);
    window.addEventListener("blur", cancelOnBlur);
    return () => {
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
      window.removeEventListener("blur", cancelOnBlur);
      if (dragRef.current) {
        dragRef.current = null;
        callbacksRef.current.onDraggingChange(false);
        document.body.style.cursor = "";
      }
    };
  }, []);
  const geometry = useMemo(() => {
    const box = new Box3();
    for (const part of parts) {
      part.geometry.computeBoundingBox();
      if (part.geometry.boundingBox) box.union(part.geometry.boundingBox);
    }
    if (box.isEmpty()) return null;
    const radians = (angle * Math.PI) / 180;
    const normal = new Vector3(Math.cos(radians), Math.sin(radians), 0);
    const tangent = new Vector3(-normal.y, normal.x, 0);
    const center = box.getCenter(new Vector3()).addScaledVector(normal, previewOffset);
    const size = box.getSize(new Vector3());
    const halfLength = Math.hypot(size.x, size.y) * 0.65 + 10;
    const minZ = box.min.z - 5;
    const maxZ = box.max.z + 5;
    const a = center.clone().addScaledVector(tangent, -halfLength).setZ(minZ);
    const b = center.clone().addScaledVector(tangent, halfLength).setZ(minZ);
    const c = center.clone().addScaledVector(tangent, halfLength).setZ(maxZ);
    const d = center.clone().addScaledVector(tangent, -halfLength).setZ(maxZ);
    const result = new BufferGeometry();
    result.setAttribute(
      "position",
      new Float32BufferAttribute(
        [
          ...a.toArray(),
          ...b.toArray(),
          ...c.toArray(),
          ...a.toArray(),
          ...c.toArray(),
          ...d.toArray(),
        ],
        3,
      ),
    );
    result.computeVertexNormals();
    result.computeBoundingBox();
    return result;
  }, [parts, angle, previewOffset]);
  if (!geometry) return null;

  const startDragging = (event: ThreeEvent<PointerEvent>) => {
    if (!meshRef.current) return;
    event.stopPropagation();
    const radians = (angle * Math.PI) / 180;
    const normal = new Vector3(Math.cos(radians), Math.sin(radians), 0);
    const localCenter = geometry.boundingBox?.getCenter(new Vector3()) ?? new Vector3();
    const worldCenter = meshRef.current.localToWorld(localCenter.clone());
    const worldNormalPoint = meshRef.current.localToWorld(localCenter.clone().add(normal));
    const projectedCenter = worldCenter.project(camera);
    const projectedNormal = worldNormalPoint.project(camera);
    const screenDeltaX = ((projectedNormal.x - projectedCenter.x) * size.width) / 2;
    const screenDeltaY = (-(projectedNormal.y - projectedCenter.y) * size.height) / 2;
    const pixelsPerUnit = Math.hypot(screenDeltaX, screenDeltaY);
    if (pixelsPerUnit < 1e-4) return;
    const captureTarget = event.nativeEvent.target as Element;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset: previewOffset,
      screenX: screenDeltaX / pixelsPerUnit,
      screenY: screenDeltaY / pixelsPerUnit,
      pixelsPerUnit,
      currentOffset: previewOffset,
      captureTarget,
    };
    captureTarget.setPointerCapture(event.pointerId);
    onDraggingChange(true);
    document.body.style.cursor = "grabbing";
  };

  const drag = (event: ThreeEvent<PointerEvent>) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const screenDistance =
      (event.clientX - state.startX) * state.screenX +
      (event.clientY - state.startY) * state.screenY;
    state.currentOffset =
      Math.round((state.startOffset + screenDistance / state.pixelsPerUnit) * 10) / 10;
    // Durante o gesto, move somente o plano. Recalcular o corte/encaixe em cada
    // pixel bloqueava a interface em letras complexas.
    setPreviewOffset(state.currentOffset);
  };

  const stopDragging = (event: ThreeEvent<PointerEvent>) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (state.captureTarget.hasPointerCapture(event.pointerId)) {
      state.captureTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    onDraggingChange(false);
    onOffsetChange(state.currentOffset);
    document.body.style.cursor = "";
  };

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      renderOrder={1001}
      onPointerDown={startDragging}
      onPointerMove={drag}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onPointerOver={() => {
        if (!dragRef.current) document.body.style.cursor = "grab";
      }}
      onPointerOut={() => {
        if (!dragRef.current) document.body.style.cursor = "";
      }}
    >
      <meshBasicMaterial
        color="#2563eb"
        transparent
        opacity={0.28}
        depthTest={false}
        depthWrite={false}
        side={DoubleSide}
      />
    </mesh>
  );
}

function OutlineLine({ outline }: { outline: SignOutline }) {
  const geometry = useMemo(() => {
    const pts = outline.points;
    const arr: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      arr.push(a[0], a[1], outline.z, b[0], b[1], outline.z);
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(arr, 3));
    return geo;
  }, [outline]);

  return (
    <lineSegments geometry={geometry} renderOrder={999}>
      <lineBasicMaterial color={outline.color} depthTest={false} transparent opacity={0.95} />
    </lineSegments>
  );
}

export type ToolMode = "orbit" | "pan" | "select" | "measure" | "pushpull" | "cut" | "sketch";

type PushPullKey =
  | "depth"
  | "faceThickness"
  | "backThickness"
  | "plateThickness"
  | "layerThickness"
  | "ledChannelHeight";

export const PUSH_PULL_PARAM: Record<
  string,
  { key: PushPullKey; label: string; min: number; max: number }
> = {
  laterais: { key: "depth", label: "Profundidade das laterais", min: 5, max: 200 },
  frente: { key: "faceThickness", label: "Espessura da frente", min: 0.5, max: 60 },
  fundo: { key: "backThickness", label: "Espessura do fundo", min: 0.5, max: 20 },
  placa: { key: "plateThickness", label: "Espessura da placa", min: 2, max: 40 },
  "camada-2": { key: "layerThickness", label: "Espessura da camada 2", min: 1, max: 30 },
  "camada-3": { key: "layerThickness", label: "Espessura da camada 3", min: 1, max: 30 },
  "canal-led": { key: "ledChannelHeight", label: "Altura do canal LED", min: 2, max: 30 },
};

function Model({
  edgeSelect,
  hover,
  selected,
  onHover,
  onPick,
  onCutPlaneDragging,
  mode,
  selectedPartId,
  onSelectPart,
  sketchTool,
  snapGrid,
  snapEndpoints,
  gridSize,
  onSketchCursor,
}: {
  edgeSelect: boolean;
  hover: PickedEdge | null;
  selected: PickedEdge[];
  onHover: (edge: PickedEdge | null) => void;
  onPick: (edge: PickedEdge, additive: boolean) => void;
  onCutPlaneDragging: (dragging: boolean) => void;
  mode: ToolMode;
  selectedPartId: string | null;
  onSelectPart: (part: SignPart | null) => void;
  sketchTool: SketchTool;
  snapGrid: boolean;
  snapEndpoints: boolean;
  gridSize: number;
  onSketchCursor: (point: SketchPoint | null) => void;
}) {
  const { build, explode, hidden, wireframe, showOutlines, params, setParam, style } = useEditor();
  const groupRef = useRef<Group>(null);

  const placement = useMemo(
    () => ({
      rotation: params.modelRotation,
      mirrorX: params.mirrorHorizontal,
      mirrorY: params.mirrorVertical,
    }),
    [params.modelRotation, params.mirrorHorizontal, params.mirrorVertical],
  );

  const sourceCenter = useMemo(() => {
    const box = new Box3();
    for (const part of build?.parts ?? []) {
      part.geometry.computeBoundingBox();
      if (part.geometry.boundingBox) box.union(part.geometry.boundingBox);
    }
    return box.isEmpty() ? new Vector3() : box.getCenter(new Vector3());
  }, [build]);

  const displayParts = useMemo(
    () =>
      (build?.parts ?? []).map((part) => ({
        ...part,
        geometry: transformGeometryForPlacement(part.geometry, placement, sourceCenter),
      })),
    [build, placement, sourceCenter],
  );

  const displayOutlines = useMemo(
    () =>
      (build?.outlines ?? []).map((outline) => ({
        ...outline,
        points: outline.points.map(([x, y]) => {
          const point = transformPlacementPoint({ x, y }, placement, sourceCenter);
          return [point.x, point.y] as [number, number];
        }),
      })),
    [build, placement, sourceCenter],
  );

  const pushPull = (part: SignPart, event: ThreeEvent<PointerEvent>) => {
    const config = PUSH_PULL_PARAM[part.kind];
    if (!config) return;
    const startY = event.nativeEvent.clientY;
    const startValue = params[config.key];
    if (typeof startValue !== "number") return;
    onCutPlaneDragging(true);
    const move = (native: PointerEvent) => {
      const delta = (startY - native.clientY) * 0.35;
      const next = Math.min(config.max, Math.max(config.min, startValue + delta));
      setParam(config.key, Number(next.toFixed(2)));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      onCutPlaneDragging(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const { scale, center } = useMemo(() => {
    const box = new Box3();
    if (displayParts.length) {
      for (const part of displayParts) {
        part.geometry.computeBoundingBox();
        const bb = part.geometry.boundingBox;
        if (bb && Number.isFinite(bb.min.x) && Number.isFinite(bb.max.x)) box.union(bb);
      }
    }
    if (box.isEmpty()) return { scale: 0.01, center: new Vector3() };
    const size = box.getSize(new Vector3());
    const max = Math.max(size.x, size.y, size.z) || 1;
    const s = 2.6 / max;
    return {
      scale: Number.isFinite(s) ? s : 0.01,
      center: box.getCenter(new Vector3()),
    };
  }, [displayParts]);

  const visible = displayParts.filter((part) => !hidden.has(part.id));
  const styleHasWalls = displayParts.some((part) => part.kind === "laterais");

  return (
    <group ref={groupRef} scale={scale} rotation={[-0.05, 0, 0]}>
      <group position={[-center.x, -center.y, -center.z]}>
        {visible.map((part) => (
          <PartMesh
            key={part.id}
            part={part}
            explode={explode}
            wireframe={wireframe}
            selected={selectedPartId === part.id}
            interactive={mode === "select" || mode === "pushpull"}
            onSelectPart={onSelectPart}
            onPushPullStart={mode === "pushpull" ? pushPull : undefined}
            manualCut={
              params.splitForBuildPlate && params.splitMode === "manual"
                ? {
                    angle: params.manualCutAngle,
                    offset: params.manualCutOffset,
                    separation: params.manualCutSeparation,
                    connector: params.cutConnector,
                    maleSide: "part-1",
                    connectorDepth: params.cutConnectorDepth,
                    connectorWidth: resolveCutConnectorWidth(
                      style.id,
                      params.cutConnectorWidth,
                      params.wall,
                      params.recessLip,
                    ),
                    connectorThickness: params.cutConnectorThickness,
                    connectorClearance: params.cutConnectorClearance,
                    connectorBackInset:
                      part.id === "fundo-laterais" ? params.backThickness : 0,
                    connectorFrontInset:
                      part.id === "frente-laterais" ? params.faceThickness : 0,
                    origin: { x: center.x, y: center.y },
                    cuts: params.manualCuts
                      .filter((cut) => cut.target === "all" || cut.target === part.kind)
                      .map((cut) => ({
                        angle: cut.angle,
                        offset: cut.offset,
                        connector: cut.connector,
                        maleSide: "part-1",
                        connectorDepth: cut.connectorDepth,
                        connectorWidth: resolveCutConnectorWidth(
                          style.id,
                          cut.connectorWidth,
                          params.wall,
                          params.recessLip,
                        ),
                        connectorThickness: cut.connectorThickness,
                        connectorClearance: cut.connectorClearance,
                        connectorBackInset:
                          part.id === "fundo-laterais" ? params.backThickness : 0,
                        connectorFrontInset:
                          part.id === "frente-laterais" ? params.faceThickness : 0,
                      })),
                    connectorEnabled: partSupportsCutConnector(part.kind, styleHasWalls),
                  }
                : undefined
            }
          />
        ))}
        {params.splitForBuildPlate &&
          params.splitMode === "automatic" &&
          visible.map((part) => (
            <CutPreview
              key={`cut-${part.id}`}
              part={part}
              explode={explode}
              plateWidth={params.buildWidth}
              plateDepth={params.buildDepth}
              margin={params.splitMargin}
            />
          ))}
        {params.splitForBuildPlate && params.splitMode === "manual" ? (
          <ManualCutPlane
            parts={visible}
            angle={params.manualCutAngle}
            offset={params.manualCutOffset}
            onOffsetChange={(value) => setParam("manualCutOffset", value)}
            onDraggingChange={onCutPlaneDragging}
          />
        ) : null}
        {edgeSelect &&
          visible.map((part) => (
            <EdgePicker
              key={`edges-${part.id}`}
              part={part}
              offset={(EXPLODE_ORDER[part.kind] ?? 0) * explode}
              onHover={onHover}
              onPick={onPick}
            />
          ))}
        {edgeSelect && hover && <EdgeHighlight edge={hover} color="#38bdf8" />}
        {edgeSelect &&
          selected.map((edge) => <EdgeHighlight key={edge.key} edge={edge} color="#f97316" />)}
        {showOutlines &&
          displayOutlines.map((outline) => <OutlineLine key={outline.id} outline={outline} />)}
      </group>
      <SketchLayer
        scale={1}
        active={mode === "sketch"}
        tool={sketchTool}
        snapGrid={snapGrid}
        snapEndpoints={snapEndpoints}
        gridSize={gridSize}
        onCursor={onSketchCursor}
      />
    </group>
  );
}

type ViewPreset = "iso" | "frente" | "superior" | "direita";

const VIEW_POSITIONS: Record<ViewPreset, [number, number, number]> = {
  iso: [3.2, 2.4, 3.6],
  frente: [0, 0, 5],
  superior: [0, 5, 0.001],
  direita: [5, 0, 0],
};

function ViewController({ preset, nonce }: { preset: ViewPreset; nonce: number }) {
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    const [x, y, z] = VIEW_POSITIONS[preset];
    camera.position.set(x, y, z);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, preset, nonce]);
  return null;
}

const MODE_LABEL: Record<ToolMode, string> = {
  orbit: "Orbitar (O)",
  pan: "Mover câmera (H)",
  select: "Selecionar peça (Espaço)",
  measure: "Medir arestas (M)",
  pushpull: "Empurrar/Puxar (P)",
  cut: "Plano de corte (C)",
  sketch: "Esboço 2D (S)",
};

const MODE_ORDER: ToolMode[] = ["orbit", "pan", "select", "measure", "pushpull", "cut", "sketch"];

export default function Viewport() {
  const {
    build,
    ready,
    loadError,
    explode,
    setExplode,
    wireframe,
    setWireframe,
    showOutlines,
    setShowOutlines,
    params,
    setParams,
    sketch,
    updateSketch,
    undoSketch,
    redoSketch,
  } = useEditor();

  const [mode, setMode] = useState<ToolMode>("orbit");
  const [view, setView] = useState<ViewPreset>("iso");
  const [viewNonce, setViewNonce] = useState(0);
  const [hover, setHover] = useState<PickedEdge | null>(null);
  const [selected, setSelected] = useState<PickedEdge[]>([]);
  const [cutPlaneDragging, setCutPlaneDragging] = useState(false);
  const [selectedPart, setSelectedPart] = useState<SignPart | null>(null);
  const [sketchTool, setSketchTool] = useState<SketchTool>("line");
  const [snapGrid, setSnapGrid] = useState(true);
  const [snapEndpoints, setSnapEndpoints] = useState(true);
  const [gridSize, setGridSize] = useState(5);
  const [sketchCursor, setSketchCursor] = useState<SketchPoint | null>(null);
  const [extrudeHeight, setExtrudeHeight] = useState(10);

  const edgeSelect = mode === "measure";
  const totalLength = selected.reduce((sum, e) => sum + e.length, 0);

  // A peça selecionada deixa de existir quando o estilo ou os parâmetros mudam.
  useEffect(() => {
    if (!selectedPart) return;
    const exists = build?.parts.some((part) => part.id === selectedPart.id);
    if (!exists) setSelectedPart(null);
  }, [build, selectedPart]);

  const applyView = (preset: ViewPreset) => {
    setView(preset);
    setViewNonce((value) => value + 1);
  };

  const activateMode = (next: ToolMode) => {
    setMode(next);
    setHover(null);
    if (next !== "measure") setSelected([]);
    if (next !== "select" && next !== "pushpull") setSelectedPart(null);
    if (next === "cut") {
      setParams({ splitForBuildPlate: true, splitMode: "manual" });
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.metaKey || event.ctrlKey) {
        if (event.key.toLowerCase() === "z" && mode === "sketch") {
          event.preventDefault();
          if (event.shiftKey) redoSketch();
          else undoSketch();
        }
        return;
      }
      const key = event.key.toLowerCase();
      const map: Record<string, ToolMode> = {
        o: "orbit",
        h: "pan",
        " ": "select",
        m: "measure",
        p: "pushpull",
        c: "cut",
        s: "sketch",
      };
      const nextMode = map[key];
      if (nextMode) {
        event.preventDefault();
        activateMode(nextMode);
        return;
      }
      if (key === "1") applyView("iso");
      if (key === "2") applyView("frente");
      if (key === "3") applyView("superior");
      if (key === "4") applyView("direita");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const handlePick = (edge: PickedEdge, additive: boolean) => {
    setSelected((prev) => {
      const exists = prev.some((e) => e.key === edge.key);
      if (additive) {
        return exists ? prev.filter((e) => e.key !== edge.key) : [...prev, edge];
      }
      return exists && prev.length === 1 ? [] : [edge];
    });
  };

  const selectedSize = useMemo(() => {
    if (!selectedPart) return null;
    selectedPart.geometry.computeBoundingBox();
    const box = selectedPart.geometry.boundingBox;
    if (!box) return null;
    return box.getSize(new Vector3());
  }, [selectedPart]);

  const pushPullConfig = selectedPart ? PUSH_PULL_PARAM[selectedPart.kind] : undefined;
  const sketchState = sketch.present;
  const selectedEntities = sketchState.entities.filter((entity) =>
    sketchState.selectedIds.includes(entity.id),
  );
  const closedSelected = selectedEntities.filter((entity) => isClosedProfile(entity));

  return (
    <div className="absolute inset-0 bg-viewport">
      <Canvas
        shadows
        gl={{ antialias: true, logarithmicDepthBuffer: true }}
        camera={{ position: [0, 1.1, 4.6], fov: 42, near: 0.000001, far: 1_000_000 }}
        dpr={[1, 2]}
        onCreated={({ gl }) => {
          gl.localClippingEnabled = true;
        }}
      >
        <color attach="background" args={["#e6ebf2"]} />
        <hemisphereLight args={["#ffffff", "#c7d0dc", 1.1]} />
        <directionalLight position={[4, 6, 6]} intensity={1.5} castShadow />
        <directionalLight position={[-5, 2, -4]} intensity={0.5} />
        <ViewController preset={view} nonce={viewNonce} />
        <Model
          edgeSelect={edgeSelect}
          hover={hover}
          selected={selected}
          onHover={setHover}
          onPick={handlePick}
          onCutPlaneDragging={setCutPlaneDragging}
          mode={mode}
          selectedPartId={selectedPart?.id ?? null}
          onSelectPart={setSelectedPart}
          sketchTool={sketchTool}
          snapGrid={snapGrid}
          snapEndpoints={snapEndpoints}
          gridSize={gridSize}
          onSketchCursor={setSketchCursor}
        />
        <ContactShadows position={[0, -1.6, 0]} opacity={0.35} blur={2.4} scale={9} far={4} />
        <Grid
          position={[0, -1.6, 0]}
          args={[20, 20]}
          cellSize={0.35}
          cellColor="#c3cddb"
          sectionSize={1.75}
          sectionColor="#a9b6c8"
          fadeDistance={16}
          infiniteGrid
        />
        <OrbitControls
          makeDefault
          enabled={!cutPlaneDragging && mode !== "sketch"}
          enableRotate={mode !== "pan"}
          enablePan
          target={[0, 0, 0]}
          minDistance={0}
          maxDistance={Infinity}
        />
      </Canvas>

      <div className="absolute left-4 top-4 w-72 space-y-3 rounded-lg border border-border bg-panel/90 p-3 shadow-lg backdrop-blur">
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Ferramentas</Label>
          <div className="grid grid-cols-2 gap-1.5">
            {MODE_ORDER.map((item) => (
              <Button
                key={item}
                size="sm"
                variant={mode === item ? "default" : "outline"}
                className="h-8 justify-start px-2 text-xs"
                onClick={() => activateMode(item)}
              >
                {MODE_LABEL[item]}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Vistas</Label>
          <div className="grid grid-cols-4 gap-1.5">
            {(["iso", "frente", "superior", "direita"] as ViewPreset[]).map((preset, index) => (
              <Button
                key={preset}
                size="sm"
                variant={view === preset ? "default" : "outline"}
                className="h-8 px-1 text-xs capitalize"
                onClick={() => applyView(preset)}
              >
                {preset === "iso" ? "Iso" : preset}
                <span className="ml-1 opacity-60">{index + 1}</span>
              </Button>
            ))}
          </div>
        </div>

        {(mode === "select" || mode === "pushpull") && (
          <div className="space-y-1 rounded-md border border-border bg-background/60 p-2">
            {selectedPart && selectedSize ? (
              <>
                <p className="text-sm font-medium">{selectedPart.name}</p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  X {selectedSize.x.toFixed(1)} · Y {selectedSize.y.toFixed(1)} · Z{" "}
                  {selectedSize.z.toFixed(1)} mm
                </p>
                {mode === "pushpull" &&
                  (pushPullConfig ? (
                    <div className="space-y-1 pt-1">
                      <div className="flex items-center justify-between text-xs">
                        <span>{pushPullConfig.label}</span>
                        <span className="tabular-nums">
                          {(params[pushPullConfig.key] as number).toFixed(1)} mm
                        </span>
                      </div>
                      <Slider
                        value={[params[pushPullConfig.key] as number]}
                        min={pushPullConfig.min}
                        max={pushPullConfig.max}
                        step={0.1}
                        onValueChange={([v]) =>
                          setParams({ [pushPullConfig.key]: v ?? pushPullConfig.min })
                        }
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Arraste a peça verticalmente para empurrar/puxar.
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Esta peça não possui parâmetro de empurrar/puxar.
                    </p>
                  ))}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Clique em uma peça para selecionar.</p>
            )}
          </div>
        )}

        {mode === "sketch" && (
          <div className="space-y-2 rounded-md border border-border bg-background/60 p-2">
            <div className="grid grid-cols-4 gap-1.5">
              {(
                [
                  ["select", "Sel."],
                  ["line", "Linha"],
                  ["rect", "Retân."],
                  ["circle", "Círc."],
                ] as [SketchTool, string][]
              ).map(([tool, label]) => (
                <Button
                  key={tool}
                  size="sm"
                  variant={sketchTool === tool ? "default" : "outline"}
                  className="h-8 px-1 text-xs"
                  onClick={() => setSketchTool(tool)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Snap na grade</Label>
              <Switch checked={snapGrid} onCheckedChange={setSnapGrid} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Snap nos pontos</Label>
              <Switch checked={snapEndpoints} onCheckedChange={setSnapEndpoints} />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span>Grade</span>
                <span className="tabular-nums">{gridSize.toFixed(0)} mm</span>
              </div>
              <Slider
                value={[gridSize]}
                min={1}
                max={50}
                step={1}
                onValueChange={([v]) => setGridSize(v ?? 5)}
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span>Altura da extrusão</span>
                <span className="tabular-nums">{extrudeHeight.toFixed(0)} mm</span>
              </div>
              <Slider
                value={[extrudeHeight]}
                min={1}
                max={200}
                step={1}
                onValueChange={([v]) => setExtrudeHeight(v ?? 10)}
              />
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={undoSketch}>
                Desfazer
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={redoSketch}>
                Refazer
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <Button
                size="sm"
                className="h-8 text-xs"
                disabled={!closedSelected.length}
                onClick={() =>
                  updateSketch((prev) =>
                    closedSelected.reduce(
                      (state, entity) => setExtrusion(state, entity.id, extrudeHeight),
                      prev,
                    ),
                  )
                }
              >
                Extrudar
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={!sketchState.selectedIds.length}
                onClick={() =>
                  updateSketch((prev) => removeEntities(prev, sketchState.selectedIds))
                }
              >
                Excluir
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Enter conclui a polilinha · Esc cancela · Delete apaga · Ctrl+Z/Ctrl+Shift+Z
              desfaz/refaz. Desfazer {canUndo(sketch) ? "disponível" : "vazio"} · Refazer{" "}
              {canRedo(sketch) ? "disponível" : "vazio"}.
            </p>
            {sketchCursor && (
              <p className="text-[11px] tabular-nums text-muted-foreground">
                Cursor: X {sketchCursor.x.toFixed(1)} · Y {sketchCursor.y.toFixed(1)} mm
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Modo wireframe</Label>
          <Switch checked={wireframe} onCheckedChange={setWireframe} />
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Contornos</Label>
          <Switch checked={showOutlines} onCheckedChange={setShowOutlines} />
        </div>
        {edgeSelect && (
          <div className="space-y-1 rounded-md border border-border bg-background/60 p-2">
            <p className="text-xs text-muted-foreground">
              Clique para medir; Shift+clique soma arestas à medição.
            </p>
            <div className="flex items-center justify-between text-sm">
              <span>Selecionadas</span>
              <span className="tabular-nums">{selected.length}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Comprimento</span>
              <span className="tabular-nums">{totalLength.toFixed(1)} mm</span>
            </div>
            {hover && (
              <p className="text-xs text-muted-foreground">
                {hover.partLabel} • {hover.length.toFixed(1)} mm
              </p>
            )}
            {selected.length > 0 && (
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => setSelected([])}
                >
                  Limpar medição
                </Button>
              </div>
            )}
          </div>
        )}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Vista explodida</Label>
            <span className="text-sm tabular-nums">{explode.toFixed(0)} mm</span>
          </div>
          <Slider
            value={[explode]}
            min={0}
            max={120}
            step={1}
            onValueChange={([v]) => setExplode(v ?? 0)}
          />
        </div>
      </div>

      {params.splitForBuildPlate ? (
        <div className="pointer-events-none absolute right-4 top-4 rounded-md border border-red-300 bg-red-50/90 px-3 py-2 text-xs font-medium text-red-700 shadow-sm backdrop-blur">
          Prévia de corte ativa · área útil {params.buildWidth - params.splitMargin * 2} ×{" "}
          {params.buildDepth - params.splitMargin * 2} mm
        </div>
      ) : null}

      {!ready && !loadError && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted-foreground">
          Carregando fontes...
        </div>
      )}
      {loadError && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center text-sm text-destructive">
          {loadError}
        </div>
      )}
      {ready && !build && mode !== "sketch" && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted-foreground">
          Digite um texto para visualizar
        </div>
      )}
    </div>
  );
}
