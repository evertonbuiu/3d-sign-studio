import { useMemo, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, Grid, OrbitControls } from "@react-three/drei";
import { Box3, BufferGeometry, Float32BufferAttribute, Vector3, type Group } from "three";

import { useEditor } from "./store";
import type { SignOutline, SignPart } from "@/lib/sign/build";

const EXPLODE_ORDER: Record<string, number> = {
  poste: -2,
  placa: -1,
  fundo: 0,
  laterais: 1,
  "canal-led": 2,
  furos: 0,
  difusor: 3,
  frente: 4,
  "camada-2": 5,
  "camada-3": 6,
  tampa: 7,
};

function PartMesh({
  part,
  explode,
  wireframe,
}: {
  part: SignPart;
  explode: number;
  wireframe: boolean;
}) {
  const offset = (EXPLODE_ORDER[part.kind] ?? 0) * explode;
  return (
    <mesh geometry={part.geometry} position={[0, 0, offset]} castShadow receiveShadow>
      <meshStandardMaterial
        color={part.color}
        wireframe={wireframe}
        transparent={part.opacity < 1 || wireframe}
        opacity={wireframe ? 0.9 : part.opacity}
        roughness={part.emissive ? 0.35 : 0.55}
        metalness={0.05}
        emissive={part.emissive && !wireframe ? part.color : "#000000"}
        emissiveIntensity={part.emissive && !wireframe ? 0.85 : 0}
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

function Model() {
  const { build, explode, hidden, wireframe, showOutlines } = useEditor();
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

  return (
    <group ref={groupRef} scale={scale} rotation={[-0.05, 0, 0]}>
      <group position={[-center.x, -center.y, -center.z]}>
        {build.parts
          .filter((part) => !hidden.has(part.id))
          .map((part) => (
            <PartMesh key={part.id} part={part} explode={explode} wireframe={wireframe} />
          ))}
        {showOutlines &&
          build.outlines.map((outline) => <OutlineLine key={outline.id} outline={outline} />)}
      </group>
    </group>
  );
}

export default function Viewport() {
  const { build, ready } = useEditor();

  return (
    <div className="absolute inset-0 bg-viewport">
      <Canvas shadows camera={{ position: [0, 1.1, 4.6], fov: 42 }} dpr={[1, 2]}>
        <color attach="background" args={["#e6ebf2"]} />
        <hemisphereLight args={["#ffffff", "#c7d0dc", 1.1]} />
        <directionalLight position={[4, 6, 6]} intensity={1.5} castShadow />
        <directionalLight position={[-5, 2, -4]} intensity={0.5} />
        <Model />
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
        <OrbitControls makeDefault enablePan target={[0, 0, 0]} minDistance={2} maxDistance={14} />
      </Canvas>

      {!ready && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted-foreground">
          Carregando fontes...
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
