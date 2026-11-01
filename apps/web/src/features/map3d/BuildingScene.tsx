// React Three Fiber scene: procedural building (floors as slabs + glass facades), floor isolation,
// exploded view, instanced desks coloured by availability, rooms/facilities, hover tooltips,
// camera transitions and optional GLB models with graceful fallback.
import { Component, forwardRef, Suspense, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { CameraControls, Html, useGLTF } from '@react-three/drei';
import { Color, InstancedMesh, Object3D, type Group } from 'three';
import { Box, Typography } from '@mui/material';
import type { FloorDto, FloorMapDto, MapObjectDto, ResourceDto } from '@spaceflow/shared';
import { STATUS_COLORS } from '@spaceflow/shared';
import {
  buildDeskInstances, buildingBounds, DESK_HEIGHT, FLOOR_HEIGHT, floorPose, kindLabel, kindStyle, layoutFloors, objectCenter, overviewPose,
  resourcePose, resourceState, SLAB_THICKNESS, stateColor, type CameraPose, type FloorLayout,
} from './geometry';

export interface SceneHandle {
  reset: () => void;
  zoom: (delta: number) => void;
}

export interface BuildingSceneProps {
  floors: FloorDto[];
  selectedFloorId: string | null;
  map?: FloorMapDto;
  /** Visible resources of the selected floor (already filtered). */
  resources: ResourceDto[];
  selectedResourceId: string | null;
  onSelectResource: (id: string | null) => void;
  onSelectFloor: (id: string) => void;
  exploded: boolean;
  reducedMotion: boolean;
  /** Increment to request a camera focus on `selectedResourceId`. */
  focusNonce: number;
  buildingModelUrl?: string | null;
  floorModelUrl?: string | null;
  onModelFallback?: (which: 'building' | 'floor', error: unknown) => void;
}

type ControlsRef = React.ComponentRef<typeof CameraControls>;

// ---------------------------------------------------------------------------
// Camera driver
// ---------------------------------------------------------------------------

function applyPose(controls: ControlsRef | null, pose: CameraPose, animate: boolean) {
  if (!controls) return;
  void controls.setLookAt(pose.position[0], pose.position[1], pose.position[2], pose.target[0], pose.target[1], pose.target[2], animate);
}

function CameraDriver({ controlsRef, layout, selectedFloor, focusTarget, focusNonce, reducedMotion, bounds }: { controlsRef: React.RefObject<ControlsRef | null>; layout: FloorLayout[]; selectedFloor: FloorLayout | null; focusTarget: { center: [number, number, number]; size: number } | null; focusNonce: number; reducedMotion: boolean; bounds: { w: number; d: number; h: number } }) {
  const invalidate = useThree((s) => s.invalidate);
  const lastFocus = useRef(0);

  // Keep rendering while the controls move (demand frameloop).
  useEffect(() => {
    const c = controlsRef.current;
    if (!c) return;
    const onUpdate = () => invalidate();
    c.addEventListener('update', onUpdate);
    c.addEventListener('control', onUpdate);
    c.smoothTime = reducedMotion ? 0.001 : 0.55;
    c.minDistance = 4;
    c.maxDistance = Math.max(bounds.w, bounds.d, bounds.h) * 4;
    c.maxPolarAngle = Math.PI / 2 - 0.05;
    c.minPolarAngle = 0.05;
    return () => {
      c.removeEventListener('update', onUpdate);
      c.removeEventListener('control', onUpdate);
    };
  }, [controlsRef, invalidate, reducedMotion, bounds]);

  // Floor / overview transitions.
  useEffect(() => {
    applyPose(controlsRef.current, selectedFloor ? floorPose(selectedFloor) : overviewPose(layout), !reducedMotion);
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFloor?.id, selectedFloor?.y, layout.length, reducedMotion]);

  // Focus on a resource when requested.
  useEffect(() => {
    if (!focusTarget || focusNonce === lastFocus.current) return;
    lastFocus.current = focusNonce;
    applyPose(controlsRef.current, resourcePose(focusTarget.center, focusTarget.size), !reducedMotion);
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce, focusTarget]);
  return null;
}

// ---------------------------------------------------------------------------
// Floors (slabs + facades)
// ---------------------------------------------------------------------------

function FloorSlab({ floor, mode, onSelect, exploded }: { floor: FloorLayout; mode: 'overview' | 'selected' | 'above' | 'below'; onSelect: () => void; exploded: boolean }) {
  const groupRef = useRef<Group>(null);
  const targetY = floor.y;
  const invalidate = useThree((s) => s.invalidate);
  // Animate vertical position (exploded view) with a simple lerp.
  useFrame((_, delta) => {
    const g = groupRef.current;
    if (!g) return;
    const diff = targetY - g.position.y;
    if (Math.abs(diff) < 0.005) {
      g.position.y = targetY;
      return;
    }
    g.position.y += diff * Math.min(1, delta * 8);
    invalidate();
  });
  useEffect(() => invalidate(), [targetY, mode, exploded, invalidate]);
  if (mode === 'above') return null;
  const faded = mode === 'below';
  const { widthM: w, depthM: d } = floor;
  return (
    <group ref={groupRef} position={[0, floor.y, 0]}>
      {/* slab */}
      <mesh position={[w / 2, SLAB_THICKNESS / 2, d / 2]} onClick={(e) => { e.stopPropagation(); onSelect(); }} onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }} onPointerOut={() => { document.body.style.cursor = ''; }}>
        <boxGeometry args={[w, SLAB_THICKNESS, d]} />
        <meshStandardMaterial color={mode === 'selected' ? '#F8FAFC' : '#E2E8F0'} transparent={faded} opacity={faded ? 0.35 : 1} roughness={0.9} />
      </mesh>
      {/* glass facade (hidden on the selected floor so the interior is visible) */}
      {mode !== 'selected' && (
        <mesh position={[w / 2, SLAB_THICKNESS + (FLOOR_HEIGHT - SLAB_THICKNESS) / 2, d / 2]} onClick={(e) => { e.stopPropagation(); onSelect(); }}>
          <boxGeometry args={[w - 0.2, FLOOR_HEIGHT - SLAB_THICKNESS - 0.05, d - 0.2]} />
          <meshPhysicalMaterial color="#93C5FD" transparent opacity={faded ? 0.06 : 0.22} roughness={0.15} metalness={0.1} transmission={0} depthWrite={false} />
        </mesh>
      )}
      {/* core column for visual depth in overview */}
      {mode === 'overview' && (
        <mesh position={[2.5, SLAB_THICKNESS + (FLOOR_HEIGHT - SLAB_THICKNESS) / 2, 6]}>
          <boxGeometry args={[3, FLOOR_HEIGHT - SLAB_THICKNESS, 11]} />
          <meshStandardMaterial color="#CBD5E1" />
        </mesh>
      )}
      {mode !== 'selected' && (
        <Html position={[-0.6, FLOOR_HEIGHT / 2, d + 0.4]} center distanceFactor={60} style={{ pointerEvents: 'none' }}>
          <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600, color: faded ? '#94A3B8' : '#172033', background: 'rgba(255,255,255,0.85)', padding: '2px 8px', borderRadius: 6, whiteSpace: 'nowrap', border: '1px solid #E2E8F0' }}>{floor.name}</div>
        </Html>
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Desks (instanced)
// ---------------------------------------------------------------------------

const tmpObj = new Object3D();
const tmpColor = new Color();

function Desks({ objects, resources, floorY, selectedId, hoveredId, onHover, onSelect, reducedMotion }: { objects: MapObjectDto[]; resources: Map<string, ResourceDto>; floorY: number; selectedId: string | null; hoveredId: string | null; onHover: (id: string | null, point?: [number, number, number]) => void; onSelect: (id: string | null) => void; reducedMotion: boolean }) {
  const meshRef = useRef<InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const instances = useMemo(() => buildDeskInstances(objects, resources, floorY, selectedId), [objects, resources, floorY, selectedId]);
  const current = useRef<Float32Array>(new Float32Array(0));

  // Matrices only change with layout; colours animate towards targets.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    instances.forEach((inst, i) => {
      tmpObj.position.set(inst.position[0], inst.position[1], inst.position[2]);
      tmpObj.rotation.set(0, inst.rotationY, 0);
      tmpObj.scale.set(inst.width, DESK_HEIGHT, inst.depth);
      tmpObj.updateMatrix();
      mesh.setMatrixAt(i, tmpObj.matrix);
    });
    mesh.count = instances.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (current.current.length !== instances.length * 3) {
      current.current = new Float32Array(instances.length * 3);
      instances.forEach((inst, i) => {
        tmpColor.set(inst.color);
        current.current.set([tmpColor.r, tmpColor.g, tmpColor.b], i * 3);
        mesh.setColorAt(i, tmpColor);
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    invalidate();
  }, [instances, invalidate]);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh || !instances.length) return;
    let animating = false;
    const k = reducedMotion ? 1 : Math.min(1, delta * 7);
    instances.forEach((inst, i) => {
      const hovered = inst.resourceId && inst.resourceId === hoveredId && inst.resourceId !== selectedId;
      tmpColor.set(hovered ? '#6366F1' : inst.color);
      const base = i * 3;
      const cur = current.current;
      const dr = tmpColor.r - cur[base];
      const dg = tmpColor.g - cur[base + 1];
      const db = tmpColor.b - cur[base + 2];
      if (Math.abs(dr) + Math.abs(dg) + Math.abs(db) > 0.004) {
        cur[base] += dr * k;
        cur[base + 1] += dg * k;
        cur[base + 2] += db * k;
        animating = true;
      } else {
        cur[base] = tmpColor.r;
        cur[base + 1] = tmpColor.g;
        cur[base + 2] = tmpColor.b;
      }
      tmpColor.setRGB(cur[base], cur[base + 1], cur[base + 2]);
      mesh.setColorAt(i, tmpColor);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (animating) invalidate();
  });

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const inst = e.instanceId !== undefined ? instances[e.instanceId] : undefined;
    if (inst?.resourceId) {
      onHover(inst.resourceId, [inst.position[0], inst.position[1] + 0.6, inst.position[2]]);
      document.body.style.cursor = 'pointer';
    } else {
      onHover(null);
      document.body.style.cursor = '';
    }
  };

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, Math.max(1, instances.length)]}
      onPointerMove={handleMove}
      onPointerOut={() => { onHover(null); document.body.style.cursor = ''; }}
      onClick={(e) => {
        e.stopPropagation();
        const inst = e.instanceId !== undefined ? instances[e.instanceId] : undefined;
        if (inst?.resourceId) onSelect(inst.resourceId);
      }}
      frustumCulled={false}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.6} metalness={0.05} />
    </instancedMesh>
  );
}

// Selected desk highlight ring + chair hint for readability.
function SelectedMarker({ center, size }: { center: [number, number, number]; size: number }) {
  const ref = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  useFrame((state) => {
    if (!ref.current) return;
    const s = 1 + Math.sin(state.clock.elapsedTime * 3) * 0.04;
    ref.current.scale.set(s, 1, s);
  });
  useEffect(() => invalidate(), [center, invalidate]);
  return (
    <group ref={ref} position={[center[0], center[1], center[2]]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -DESK_HEIGHT / 2 + 0.02, 0]}>
        <ringGeometry args={[size * 0.65, size * 0.8, 48]} />
        <meshBasicMaterial color={STATUS_COLORS.SELECTED} transparent opacity={0.85} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Rooms, facilities, zones
// ---------------------------------------------------------------------------

function FacilityObject({ o, floorY, resource, selected, hovered, onHover, onSelect }: { o: MapObjectDto; floorY: number; resource?: ResourceDto; selected: boolean; hovered: boolean; onHover: (id: string | null, point?: [number, number, number]) => void; onSelect: (id: string) => void }) {
  const style = kindStyle(o);
  const bookable = o.kind === 'MEETING_ROOM' && !!o.resourceId;
  const state = bookable ? resourceState(resource) : null;
  const color = selected ? STATUS_COLORS.SELECTED : hovered && bookable ? '#6366F1' : state ? stateColor(state) : style.color;
  const center = objectCenter(o, floorY, style.height);
  const label = o.label ?? kindLabel(o.kind);
  const isFlat = style.height <= 0.1;
  return (
    <group>
      <mesh
        position={center}
        rotation={[0, -(o.rotation * Math.PI) / 180, 0]}
        onPointerOver={bookable ? (e) => { e.stopPropagation(); onHover(o.resourceId!, [center[0], center[1] + style.height / 2 + 0.3, center[2]]); document.body.style.cursor = 'pointer'; } : undefined}
        onPointerOut={bookable ? () => { onHover(null); document.body.style.cursor = ''; } : undefined}
        onClick={bookable ? (e) => { e.stopPropagation(); onSelect(o.resourceId!); } : undefined}
      >
        <boxGeometry args={[o.width, style.height, o.depth]} />
        <meshStandardMaterial color={color} transparent={style.opacity < 1 || bookable} opacity={bookable ? (selected ? 0.75 : 0.5) : style.opacity} roughness={0.7} depthWrite={!isFlat} />
      </mesh>
      {o.kind === 'ACCESSIBLE_ROUTE' && (
        // dashed strip: a few short segments
        <group>
          {Array.from({ length: Math.max(1, Math.floor(o.depth / 1.5)) }).map((_, i) => (
            <mesh key={i} position={[o.x + o.width / 2, floorY + SLAB_THICKNESS + 0.03, o.y + 0.5 + i * 1.5]}>
              <boxGeometry args={[o.width * 0.6, 0.02, 0.7]} />
              <meshBasicMaterial color="#059669" />
            </mesh>
          ))}
        </group>
      )}
      {style.label && (
        <Html position={[center[0], floorY + SLAB_THICKNESS + style.height + 0.4, center[2]]} center distanceFactor={45} style={{ pointerEvents: 'none' }} zIndexRange={[10, 0]}>
          <div style={{ fontFamily: 'Inter, sans-serif', fontSize: o.kind === 'ZONE' ? 10 : 11, fontWeight: 600, color: o.kind === 'ZONE' ? '#475569' : '#172033', background: 'rgba(255,255,255,0.9)', padding: '2px 7px', borderRadius: 6, whiteSpace: 'nowrap', border: `1px solid ${bookable ? color : '#E2E8F0'}` }}>
            {label}
            {bookable && resource?.capacity ? ` · ${resource.capacity}` : ''}
          </div>
        </Html>
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// GLB models with fallback
// ---------------------------------------------------------------------------

class ModelBoundary extends Component<{ fallback: ReactNode; onError: (err: unknown) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    this.props.onError(err);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function GltfModel({ url, position }: { url: string; position: [number, number, number] }) {
  const gltf = useGLTF(url);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate(), [gltf, invalidate]);
  return <primitive object={gltf.scene} position={position} />;
}

// ---------------------------------------------------------------------------
// Scene content
// ---------------------------------------------------------------------------

function SceneContent(props: BuildingSceneProps & { controlsRef: React.RefObject<ControlsRef | null>; hovered: { id: string; point: [number, number, number] } | null; setHovered: (h: { id: string; point: [number, number, number] } | null) => void; modelFailed: { building: boolean; floor: boolean }; setModelFailed: (v: { building: boolean; floor: boolean }) => void }) {
  const { floors, selectedFloorId, map, resources, selectedResourceId, onSelectResource, onSelectFloor, exploded, reducedMotion, focusNonce, controlsRef, hovered, setHovered, buildingModelUrl, floorModelUrl, modelFailed, setModelFailed, onModelFallback } = props;
  const layout = useMemo(() => layoutFloors(floors, exploded), [floors, exploded]);
  const selectedFloor = layout.find((f) => f.id === selectedFloorId) ?? null;
  const bounds = useMemo(() => buildingBounds(layout), [layout]);
  const resourceMap = useMemo(() => new Map(resources.map((r) => [r.id, r])), [resources]);
  const visibleObjects = useMemo(() => {
    if (!map || !selectedFloor) return [] as MapObjectDto[];
    // Hide objects whose resource was filtered out (keeps facilities).
    const allowed = new Set(resources.map((r) => r.id));
    return map.objects.filter((o) => !o.resourceId || allowed.has(o.resourceId) || o.kind !== 'DESK');
  }, [map, selectedFloor, resources]);
  const deskObjects = useMemo(() => visibleObjects.filter((o) => o.kind === 'DESK' && (!o.resourceId || resourceMap.has(o.resourceId))), [visibleObjects, resourceMap]);
  const otherObjects = useMemo(() => visibleObjects.filter((o) => o.kind !== 'DESK'), [visibleObjects]);

  const focusTarget = useMemo(() => {
    if (!selectedResourceId || !map || !selectedFloor) return null;
    const o = map.objects.find((x) => x.resourceId === selectedResourceId);
    if (!o) return null;
    const style = kindStyle(o);
    return { center: objectCenter(o, selectedFloor.y, style.height), size: Math.max(o.width, o.depth) };
  }, [selectedResourceId, map, selectedFloor]);

  const hoveredResource = hovered ? resourceMap.get(hovered.id) : undefined;
  const useBuildingModel = !!buildingModelUrl && !modelFailed.building && !selectedFloor;
  const useFloorModel = !!floorModelUrl && !modelFailed.floor && !!selectedFloor;

  return (
    <>
      <color attach="background" args={['#F5F7FB']} />
      <hemisphereLight args={['#ffffff', '#CBD5E1', 0.9]} />
      <directionalLight position={[bounds.w, bounds.h + 30, bounds.d * 1.5]} intensity={1.1} />
      <directionalLight position={[-bounds.w, bounds.h + 10, -bounds.d]} intensity={0.35} />
      {/* ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[bounds.w / 2, -0.01, bounds.d / 2]} onClick={() => onSelectResource(null)}>
        <planeGeometry args={[bounds.w * 6, bounds.d * 6]} />
        <meshStandardMaterial color="#E8ECF4" roughness={1} />
      </mesh>
      <gridHelper args={[Math.max(bounds.w, bounds.d) * 6, 60, '#D7DEEA', '#E5E9F2']} position={[bounds.w / 2, 0, bounds.d / 2]} />

      {useBuildingModel ? (
        <ModelBoundary fallback={<ProceduralFloors layout={layout} selectedFloor={null} onSelectFloor={onSelectFloor} exploded={exploded} />} onError={(err) => { setModelFailed({ ...modelFailed, building: true }); onModelFallback?.('building', err); }}>
          <Suspense fallback={<ProceduralFloors layout={layout} selectedFloor={null} onSelectFloor={onSelectFloor} exploded={exploded} />}>
            <GltfModel url={buildingModelUrl!} position={[0, 0, 0]} />
          </Suspense>
        </ModelBoundary>
      ) : (
        <ProceduralFloors layout={layout} selectedFloor={selectedFloor} onSelectFloor={onSelectFloor} exploded={exploded} />
      )}

      {selectedFloor && map && (
        <group>
          {useFloorModel && (
            <ModelBoundary fallback={null} onError={(err) => { setModelFailed({ ...modelFailed, floor: true }); onModelFallback?.('floor', err); }}>
              <Suspense fallback={null}>
                <GltfModel url={floorModelUrl!} position={[0, selectedFloor.y + SLAB_THICKNESS, 0]} />
              </Suspense>
            </ModelBoundary>
          )}
          <Desks objects={deskObjects} resources={resourceMap} floorY={selectedFloor.y} selectedId={selectedResourceId} hoveredId={hovered?.id ?? null} onHover={(id, point) => setHovered(id && point ? { id, point } : null)} onSelect={onSelectResource} reducedMotion={reducedMotion} />
          {otherObjects.map((o) => (
            <FacilityObject key={o.id} o={o} floorY={selectedFloor.y} resource={o.resourceId ? resourceMap.get(o.resourceId) : undefined} selected={!!o.resourceId && o.resourceId === selectedResourceId} hovered={!!o.resourceId && o.resourceId === hovered?.id} onHover={(id, point) => setHovered(id && point ? { id, point } : null)} onSelect={onSelectResource} />
          ))}
          {focusTarget && <SelectedMarker center={focusTarget.center} size={focusTarget.size} />}
          {hovered && hoveredResource && (
            <Html position={hovered.point} center style={{ pointerEvents: 'none' }} zIndexRange={[100, 50]}>
              <div role="tooltip" style={{ fontFamily: 'Inter, sans-serif', background: '#172033', color: '#fff', padding: '6px 10px', borderRadius: 8, fontSize: 12, whiteSpace: 'nowrap', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
                <div style={{ fontWeight: 700 }}>{hoveredResource.name}</div>
                <div style={{ opacity: 0.85 }}>
                  {hoveredResource.type === 'SEAT' ? 'Desk' : `Room · ${hoveredResource.capacity ?? '?'} seats`}
                  {hoveredResource.zoneName ? ` · ${hoveredResource.zoneName}` : ''}
                </div>
                <div style={{ color: stateColor(resourceState(hoveredResource)), fontWeight: 600 }}>{availabilityText(hoveredResource)}</div>
              </div>
            </Html>
          )}
        </group>
      )}

      <CameraControls ref={controlsRef} makeDefault dollyToCursor />
      <CameraDriver controlsRef={controlsRef} layout={layout} selectedFloor={selectedFloor} focusTarget={focusTarget} focusNonce={focusNonce} reducedMotion={reducedMotion} bounds={bounds} />
    </>
  );
}

function ProceduralFloors({ layout, selectedFloor, onSelectFloor, exploded }: { layout: FloorLayout[]; selectedFloor: FloorLayout | null; onSelectFloor: (id: string) => void; exploded: boolean }) {
  return (
    <group>
      {layout.map((f) => {
        const mode: 'overview' | 'selected' | 'above' | 'below' = !selectedFloor ? 'overview' : f.id === selectedFloor.id ? 'selected' : f.index > selectedFloor.index ? 'above' : 'below';
        return <FloorSlab key={f.id} floor={f} mode={mode} onSelect={() => onSelectFloor(f.id)} exploded={exploded} />;
      })}
      {/* roof */}
      {!selectedFloor && layout.length > 0 && (
        <mesh position={[layout[0].widthM / 2, layout[layout.length - 1].y + FLOOR_HEIGHT + 0.1, layout[0].depthM / 2]}>
          <boxGeometry args={[layout[layout.length - 1].widthM, 0.2, layout[layout.length - 1].depthM]} />
          <meshStandardMaterial color="#CBD5E1" />
        </mesh>
      )}
    </group>
  );
}

export function availabilityText(r: ResourceDto): string {
  const state = resourceState(r);
  if (r.availability?.reason && state !== 'AVAILABLE') return r.availability.reason;
  return { AVAILABLE: 'Available', RESERVED: 'Reserved', OCCUPIED: 'In use', RESTRICTED: 'Approval needed', DISABLED: 'Not bookable' }[state];
}

// ---------------------------------------------------------------------------
// Canvas wrapper
// ---------------------------------------------------------------------------

export const BuildingScene = forwardRef<SceneHandle, BuildingSceneProps>(function BuildingScene(props, ref) {
  const controlsRef = useRef<ControlsRef | null>(null);
  const [hovered, setHovered] = useState<{ id: string; point: [number, number, number] } | null>(null);
  const [modelFailed, setModelFailed] = useState({ building: false, floor: false });
  const layout = useMemo(() => layoutFloors(props.floors, props.exploded), [props.floors, props.exploded]);

  useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        const f = layout.find((x) => x.id === props.selectedFloorId) ?? null;
        applyPose(controlsRef.current, f ? floorPose(f) : overviewPose(layout), !props.reducedMotion);
      },
      zoom: (delta: number) => {
        void controlsRef.current?.dolly(delta, !props.reducedMotion);
      },
    }),
    [layout, props.selectedFloorId, props.reducedMotion],
  );

  useEffect(() => setHovered(null), [props.selectedFloorId, props.map]);

  return (
    <Box data-testid="explore-canvas" sx={{ position: 'absolute', inset: 0 }}>
      <Canvas
        frameloop="demand"
        dpr={[1, 1.75]}
        camera={{ fov: 45, near: 0.1, far: 2000, position: [60, 50, 80] }}
        gl={{ antialias: true, powerPreference: 'high-performance', alpha: false }}
        onPointerMissed={() => props.onSelectResource(null)}
        style={{ touchAction: 'none' }}
        aria-hidden
      >
        <SceneContent {...props} controlsRef={controlsRef} hovered={hovered} setHovered={setHovered} modelFailed={modelFailed} setModelFailed={setModelFailed} />
      </Canvas>
      {(modelFailed.building || modelFailed.floor) && (
        <Typography variant="caption" role="status" sx={{ position: 'absolute', left: 12, bottom: 12, bgcolor: 'rgba(255,255,255,0.9)', px: 1, py: 0.5, borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
          The custom 3D model could not be loaded; showing the generated layout instead.
        </Typography>
      )}
    </Box>
  );
});

