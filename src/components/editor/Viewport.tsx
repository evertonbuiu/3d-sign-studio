import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { ContactShadows, Grid, OrbitControls } from "@react-three/drei";
import {
  Box3,
  BufferGeometry,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Vector3,
  type Group,
} from "three";

import { useEditor } from "./store";
import type { SignOutline, SignPart } from "@/lib/sign/build";
import { clipGeometryByPlaneForPreview, splitGeometryByPlane } from "@/lib/sign/split";

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

function PartMesh({
  part,
  explode,
  wireframe,
  manualCut,
}: {
  part: SignPart;
  explode: number;
  wireframe: boolean;
  manualCut?:
    | {
        angle: number;
        offset: number;
        separation: number;
        connector: "none" | "male-female";
        maleSide: "part-1" | "part-2";
        connectorDepth: number;
        connectorWidth: number;
        connectorClearance: number;
      }
    | undefined;
}) {
  const offset = (EXPLODE_ORDER[part.kind] ?? 0) * explode;
  // Reduzimos o threshold para 1 grau para mostrar as curvas das letras
  // mas ainda ocultar as diagonais internas de superfícies planas.
  const edges = useMemo(() => new EdgesGeometry(part.geometry, 1), [part.geometry]);
  const manualPieces = useMemo(() => {
    if (!manualCut) return null;
    const position = part.geometry.getAttribute("position");
    const triangleCount = part.geometry.index
      ? part.geometry.index.count / 3
      : position.count / 3;
    // O encaixe exige três operações CSG e pode bloquear a interface em textos
    // completos. Para malhas complexas, priorize a prévia instantânea do corte
    // e do afastamento; a exportação STL continua gerando o encaixe completo.
    const previewConnector = triangleCount <= 2_000 ? manualCut.connector : "none";
    try {
      return splitGeometryByPlane(part.geometry, {
        angle: manualCut.angle,
        offset: manualCut.offset,
        connector: previewConnector,
        maleSide: manualCut.maleSide,
        connectorDepth: manualCut.connectorDepth,
        connectorWidth: manualCut.connectorWidth,
        connectorClearance: manualCut.connectorClearance,
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
    manualCut?.connectorClearance,
  ]);

  if (manualCut && manualPieces?.length) {
    const radians = (manualCut.angle * Math.PI) / 180;
    const normal: [number, number, number] = [Math.cos(radians), Math.sin(radians), 0];
    return (
      <group position={[0, 0, offset]}>
        {manualPieces.map((piece) => {
          const direction = piece.column === 1 ? -1 : 1;
          const separation = manualCut.separation / 2;
          const displacement: [number, number, number] = [
            normal[0] * direction * separation,
            normal[1] * direction * separation,
            0,
          ];
          return (
            <mesh
              key={piece.index}
              geometry={piece.geometry}
              position={displacement}
              castShadow
              receiveShadow
            >
              <meshStandardMaterial
                color={part.color}
                transparent={part.opacity < 1}
                opacity={part.opacity}
                roughness={0.55}
                metalness={0.05}
                side={DoubleSide}
              />
            </mesh>
          );
        })}
      </group>
    );
  }

  return (
    <group position={[0, 0, offset]}>
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
}: {
  parts: SignPart[];
  angle: number;
  offset: number;
}) {
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
    const center = box.getCenter(new Vector3()).addScaledVector(normal, offset);
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
    return result;
  }, [parts, angle, offset]);
  if (!geometry) return null;
  return (
    <mesh geometry={geometry} renderOrder={1001}>
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

function Model({
  edgeSelect,
  hover,
  selected,
  onHover,
  onPick,
}: {
  edgeSelect: boolean;
  hover: PickedEdge | null;
  selected: PickedEdge[];
  onHover: (edge: PickedEdge | null) => void;
  onPick: (edge: PickedEdge, additive: boolean) => void;
}) {
  const { build, explode, hidden, wireframe, showOutlines, params } = useEditor();
  const groupRef = useRef<Group>(null);

  const { scale, center } = useMemo(() => {
    const box = new Box3();
    if (build) {
      for (const part of build.parts) {
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
  }, [build]);

  if (!build) return null;

  const visible = build.parts.filter((part) => !hidden.has(part.id));

  return (
    <group ref={groupRef} scale={scale} rotation={[-0.05, 0, 0]}>
      <group position={[-center.x, -center.y, -center.z]}>
        {visible.map((part) => (
          <PartMesh
            key={part.id}
            part={part}
            explode={explode}
            wireframe={wireframe}
            manualCut={
              params.splitForBuildPlate && params.splitMode === "manual"
                ? {
                    angle: params.manualCutAngle,
                    offset: params.manualCutOffset,
                    separation: params.manualCutSeparation,
                    connector: params.cutConnector,
                    maleSide: params.cutMaleSide,
                    connectorDepth: params.cutConnectorDepth,
                    connectorWidth: params.cutConnectorWidth,
                    connectorClearance: params.cutConnectorClearance,
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
          build.outlines.map((outline) => <OutlineLine key={outline.id} outline={outline} />)}
      </group>
    </group>
  );
}

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
  } = useEditor();

  const [edgeSelect, setEdgeSelect] = useState(false);
  const [hover, setHover] = useState<PickedEdge | null>(null);
  const [selected, setSelected] = useState<PickedEdge[]>([]);

  const totalLength = selected.reduce((sum, e) => sum + e.length, 0);

  const handlePick = (edge: PickedEdge, additive: boolean) => {
    setSelected((prev) => {
      // Se a aresta já faz parte de um grupo "soldado", lidamos com o grupo todo?
      // Por enquanto mantemos a lógica de seleção individual para permitir compor o grupo
      const exists = prev.some((e) => e.key === edge.key);
      if (additive) {
        return exists ? prev.filter((e) => e.key !== edge.key) : [...prev, edge];
      }
      return exists && prev.length === 1 ? [] : [edge];
    });
  };

  return (
    <div className="absolute inset-0 bg-viewport">
      <Canvas
        shadows
        camera={{ position: [0, 1.1, 4.6], fov: 42 }}
        dpr={[1, 2]}
        onCreated={({ gl }) => {
          gl.localClippingEnabled = true;
        }}
      >
        <color attach="background" args={["#e6ebf2"]} />
        <hemisphereLight args={["#ffffff", "#c7d0dc", 1.1]} />
        <directionalLight position={[4, 6, 6]} intensity={1.5} castShadow />
        <directionalLight position={[-5, 2, -4]} intensity={0.5} />
        <Model
          edgeSelect={edgeSelect}
          hover={hover}
          selected={selected}
          onHover={setHover}
          onPick={handlePick}
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
          enablePan
          target={[0, 0, 0]}
          minDistance={0.5}
          maxDistance={14}
        />
      </Canvas>

      <div className="absolute left-4 top-4 w-64 space-y-3 rounded-lg border border-border bg-panel/90 p-3 shadow-lg backdrop-blur">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Modo wireframe</Label>
          <Switch checked={wireframe} onCheckedChange={setWireframe} />
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Contornos</Label>
          <Switch checked={showOutlines} onCheckedChange={setShowOutlines} />
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Selecionar aresta</Label>
          <Switch
            checked={edgeSelect}
            onCheckedChange={(v) => {
              setEdgeSelect(v);
              setHover(null);
              if (!v) setSelected([]);
            }}
          />
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
      {ready && !build && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted-foreground">
          Digite um texto para visualizar
        </div>
      )}
    </div>
  );
}

