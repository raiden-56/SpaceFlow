// Cheap building preview for the dashboard: a tiny R3F scene (no controls, slow auto-rotate unless
// reduced motion) with an SVG fallback when WebGL is unavailable. Props contract is fixed.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Box, Typography, useMediaQuery } from '@mui/material';
import type { Group } from 'three';
import type { BuildingDto } from '@spaceflow/shared';
import { FLOOR_HEIGHT, hasWebGL, SLAB_THICKNESS } from './geometry';

function BuildingPreviewSvg({ building, height }: { building: BuildingDto | null; height: number }) {
  const floors = Math.max(1, Math.min(building?.floorCount ?? 3, 8));
  return (
    <svg width="220" height={height - 40} viewBox="0 0 220 200" aria-hidden>
      {Array.from({ length: floors }).map((_, i) => {
        const y = 170 - i * (120 / floors);
        return (
          <g key={i}>
            <polygon points={`30,${y} 110,${y - 30} 190,${y} 110,${y + 30}`} fill={i === floors - 1 ? '#818CF8' : '#A5B4FC'} stroke="#4F46E5" strokeWidth="1.5" opacity="0.95" />
            <polygon points={`30,${y} 110,${y + 30} 110,${y + 30 + 120 / floors - 4} 30,${y + 120 / floors - 4}`} fill="#6366F1" opacity="0.85" />
            <polygon points={`110,${y + 30} 190,${y} 190,${y + 120 / floors - 4} 110,${y + 30 + 120 / floors - 4}`} fill="#4338CA" opacity="0.85" />
          </g>
        );
      })}
    </svg>
  );
}

function MiniBuilding({ floors, rotate }: { floors: number; rotate: boolean }) {
  const ref = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  const w = 16;
  const d = 10;
  useFrame((_, delta) => {
    if (!ref.current || !rotate) return;
    ref.current.rotation.y += delta * 0.25;
    invalidate();
  });
  useEffect(() => invalidate(), [floors, invalidate]);
  const slabs = useMemo(() => Array.from({ length: floors }, (_, i) => i), [floors]);
  return (
    <group ref={ref} rotation={[0, Math.PI / 5, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <circleGeometry args={[18, 48]} />
        <meshStandardMaterial color="#E0E7FF" />
      </mesh>
      {slabs.map((i) => (
        <group key={i} position={[0, i * FLOOR_HEIGHT, 0]}>
          <mesh position={[0, SLAB_THICKNESS / 2, 0]}>
            <boxGeometry args={[w, SLAB_THICKNESS, d]} />
            <meshStandardMaterial color="#F8FAFC" />
          </mesh>
          <mesh position={[0, SLAB_THICKNESS + (FLOOR_HEIGHT - SLAB_THICKNESS) / 2, 0]}>
            <boxGeometry args={[w - 0.2, FLOOR_HEIGHT - SLAB_THICKNESS - 0.05, d - 0.2]} />
            <meshPhysicalMaterial color="#818CF8" transparent opacity={0.3} roughness={0.2} depthWrite={false} />
          </mesh>
          <mesh position={[-w / 2 + 2, SLAB_THICKNESS + (FLOOR_HEIGHT - SLAB_THICKNESS) / 2, 0]}>
            <boxGeometry args={[2.5, FLOOR_HEIGHT - SLAB_THICKNESS, 4]} />
            <meshStandardMaterial color="#C7D2FE" />
          </mesh>
        </group>
      ))}
      <mesh position={[0, floors * FLOOR_HEIGHT + 0.1, 0]}>
        <boxGeometry args={[w, 0.2, d]} />
        <meshStandardMaterial color="#A5B4FC" />
      </mesh>
    </group>
  );
}

export function BuildingPreview({ building, height = 240 }: { building: BuildingDto | null; height?: number }) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [webgl, setWebgl] = useState<boolean | null>(null);
  useEffect(() => setWebgl(hasWebGL()), []);
  const floors = Math.max(1, Math.min(building?.floorCount ?? 3, 8));
  const camY = floors * FLOOR_HEIGHT * 0.9 + 6;
  const camDist = 18 + floors * 2.2;
  return (
    <Box role="img" aria-label={building ? `${building.name}, ${building.floorCount} floors` : 'Building preview'} sx={{ height, borderRadius: 3, background: 'radial-gradient(600px 300px at 30% 20%, #EEF2FF 0%, #E0E7FF 40%, #C7D2FE 100%)', display: 'grid', placeItems: 'center', overflow: 'hidden', position: 'relative' }}>
      {webgl ? (
        <Canvas dpr={1} frameloop={reducedMotion ? 'demand' : 'always'} camera={{ fov: 35, position: [camDist, camY, camDist], near: 0.1, far: 200 }} gl={{ antialias: true, alpha: true }} style={{ width: '100%', height: '100%' }} aria-hidden onCreated={({ camera }) => camera.lookAt(0, (floors * FLOOR_HEIGHT) / 2, 0)}>
          <hemisphereLight args={['#ffffff', '#C7D2FE', 0.9]} />
          <directionalLight position={[10, 30, 10]} intensity={1} />
          <MiniBuilding floors={floors} rotate={!reducedMotion} />
        </Canvas>
      ) : (
        <BuildingPreviewSvg building={building} height={height} />
      )}
      <Typography variant="caption" sx={{ position: 'absolute', bottom: 10, left: 14, color: '#3730A3', fontWeight: 600, pointerEvents: 'none' }}>
        {building ? `${building.name} · ${building.floorCount} floors · ${building.seatCount} desks` : 'Select a building'}
      </Typography>
    </Box>
  );
}
