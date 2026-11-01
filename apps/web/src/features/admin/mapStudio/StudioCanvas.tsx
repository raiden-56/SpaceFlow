// SVG editing canvas for the Map Studio. Units are metres (viewBox), so geometry maps 1:1 to the
// data model. Supports wheel zoom, background-drag pan, object drag, corner resize, keyboard
// nudge/delete, a grid, an optional background floor-plan image and an availability overlay.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, IconButton, Stack, Tooltip } from '@mui/material';
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInRounded';
import ZoomOutRoundedIcon from '@mui/icons-material/ZoomOutRounded';
import FitScreenRoundedIcon from '@mui/icons-material/FitScreenRounded';
import { STATUS_COLORS, type AvailabilityState } from '@spaceflow/shared';
import { KIND_FILL, clampToFloor, fitViewBox, snap, zoomViewBox, type StudioObject } from './studioUtils';

interface Props {
  widthM: number;
  depthM: number;
  objects: StudioObject[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onChange: (key: string, patch: Partial<StudioObject>, opts?: { commit?: boolean }) => void;
  onDelete: (key: string) => void;
  snapStep: number;
  backgroundUrl?: string | null;
  availability?: Map<string, AvailabilityState> | null;
  resourceCodes: Map<string, string>;
}

type Drag =
  | { mode: 'pan'; startX: number; startY: number; vb: ViewBox }
  | { mode: 'move'; key: string; offX: number; offY: number }
  | { mode: 'resize'; key: string; originX: number; originY: number };

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const AV_COLORS: Record<AvailabilityState, string> = {
  AVAILABLE: STATUS_COLORS.AVAILABLE,
  RESERVED: STATUS_COLORS.RESERVED,
  OCCUPIED: STATUS_COLORS.OCCUPIED,
  RESTRICTED: STATUS_COLORS.RESTRICTED,
  DISABLED: STATUS_COLORS.DISABLED,
};

export function StudioCanvas({ widthM, depthM, objects, selectedKey, onSelect, onChange, onDelete, snapStep, backgroundUrl, availability, resourceCodes }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [vb, setVb] = useState<ViewBox>(() => fitViewBox(widthM, depthM));
  const drag = useRef<Drag | null>(null);

  useEffect(() => setVb(fitViewBox(widthM, depthM)), [widthM, depthM]);

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = pt.matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }, []);

  // Wheel zoom (non-passive so we can prevent page scroll).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toWorld(e.clientX, e.clientY);
      setVb((v) => zoomViewBox(v, e.deltaY > 0 ? 1.12 : 1 / 1.12, p.x, p.y, { min: 2, max: Math.max(widthM, depthM) * 4 }));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [toWorld, widthM, depthM]);

  const onPointerDownBg = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    onSelect(null);
    drag.current = { mode: 'pan', startX: e.clientX, startY: e.clientY, vb };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.mode === 'pan') {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const scale = Math.max(d.vb.w / rect.width, d.vb.h / rect.height);
      setVb({ ...d.vb, x: d.vb.x - (e.clientX - d.startX) * scale, y: d.vb.y - (e.clientY - d.startY) * scale });
      return;
    }
    const p = toWorld(e.clientX, e.clientY);
    const o = objects.find((x) => x.key === d.key);
    if (!o) return;
    if (d.mode === 'move') {
      const next = clampToFloor({ ...o, x: snap(p.x - d.offX, snapStep), y: snap(p.y - d.offY, snapStep) }, widthM, depthM);
      onChange(d.key, { x: next.x, y: next.y });
    } else {
      const width = Math.max(0.2, snap(p.x - d.originX, snapStep));
      const depth = Math.max(0.1, snap(p.y - d.originY, snapStep));
      const next = clampToFloor({ ...o, width: Math.min(width, widthM - o.x), depth: Math.min(depth, depthM - o.y) }, widthM, depthM);
      onChange(d.key, { width: next.width, depth: next.depth });
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && d.mode !== 'pan') onChange(d.key, {}, { commit: true });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!selectedKey) return;
    const o = objects.find((x) => x.key === selectedKey);
    if (!o) return;
    const step = e.shiftKey ? 1 : snapStep > 0 ? snapStep : 0.1;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      const [dx, dy] = moves[e.key];
      const next = clampToFloor({ ...o, x: o.x + dx, y: o.y + dy }, widthM, depthM);
      onChange(o.key, { x: next.x, y: next.y }, { commit: true });
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onDelete(o.key);
    } else if (e.key === 'Escape') {
      onSelect(null);
    } else if (e.key.toLowerCase() === 'r') {
      onChange(o.key, { rotation: (o.rotation + 90) % 360 }, { commit: true });
    }
  };

  const gridStep = vb.w > 120 ? 10 : vb.w > 40 ? 5 : 1;
  const gridLines: React.ReactNode[] = [];
  for (let x = 0; x <= widthM + 1e-6; x += gridStep) gridLines.push(<line key={`gx${x}`} x1={x} y1={0} x2={x} y2={depthM} stroke="#E2E8F0" strokeWidth={0.03} />);
  for (let y = 0; y <= depthM + 1e-6; y += gridStep) gridLines.push(<line key={`gy${y}`} x1={0} y1={y} x2={widthM} y2={y} stroke="#E2E8F0" strokeWidth={0.03} />);

  const ordered = [...objects].sort((a, b) => (a.kind === 'ZONE' ? -1 : 0) - (b.kind === 'ZONE' ? -1 : 0) || (a.key === selectedKey ? 1 : 0) - (b.key === selectedKey ? 1 : 0));

  return (
    <Box sx={{ position: 'relative', height: '100%', minHeight: 420, bgcolor: '#F8FAFC', borderRadius: 2, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        width="100%"
        height="100%"
        style={{ display: 'block', touchAction: 'none', cursor: drag.current?.mode === 'pan' ? 'grabbing' : 'default', outline: 'none' }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="application"
        aria-label="Floor plan editor. Select an object, then use arrow keys to move (Shift for 1 m), R to rotate, Delete to remove."
        data-testid="map-studio-canvas"
      >
        <rect x={vb.x - 1000} y={vb.y - 1000} width={vb.w + 2000} height={vb.h + 2000} fill="#F8FAFC" onPointerDown={onPointerDownBg} />
        <rect x={0} y={0} width={widthM} height={depthM} fill="#fff" stroke="#94A3B8" strokeWidth={0.08} onPointerDown={onPointerDownBg} />
        {backgroundUrl && <image href={backgroundUrl} x={0} y={0} width={widthM} height={depthM} preserveAspectRatio="none" opacity={0.55} pointerEvents="none" />}
        <g pointerEvents="none">{gridLines}</g>
        {ordered.map((o) => {
          const selected = o.key === selectedKey;
          const state = o.resourceId ? availability?.get(o.resourceId) : undefined;
          const zoneColor = o.kind === 'ZONE' ? (o.meta?.color as string | undefined) : undefined;
          const fill = state ? AV_COLORS[state] : zoneColor ?? KIND_FILL[o.kind];
          const unlinkedBookable = (o.kind === 'DESK' || o.kind === 'MEETING_ROOM') && !o.resourceId;
          const label = o.resourceId ? resourceCodes.get(o.resourceId) ?? o.label : o.label;
          const fontSize = Math.min(0.45, Math.max(0.18, Math.min(o.width, o.depth) * 0.35));
          return (
            <g
              key={o.key}
              transform={`translate(${o.x} ${o.y}) rotate(${o.rotation} ${o.width / 2} ${o.depth / 2})`}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                onSelect(o.key);
                const p = toWorld(e.clientX, e.clientY);
                drag.current = { mode: 'move', key: o.key, offX: p.x - o.x, offY: p.y - o.y };
                svgRef.current?.setPointerCapture?.(e.pointerId);
                svgRef.current?.focus();
              }}
              style={{ cursor: 'move' }}
            >
              <title>{`${label ?? o.kind}${state ? ` · ${state.toLowerCase()}` : ''}${unlinkedBookable ? ' · not linked to a resource' : ''}`}</title>
              <rect
                width={o.width}
                height={o.depth}
                rx={o.kind === 'DESK' ? 0.08 : 0.15}
                fill={fill}
                fillOpacity={o.kind === 'ZONE' ? 0.35 : state ? 0.85 : 0.9}
                stroke={selected ? '#4F46E5' : unlinkedBookable ? '#DC2626' : o.kind === 'ZONE' ? '#A5B4FC' : '#64748B'}
                strokeWidth={selected ? 0.12 : 0.04}
                strokeDasharray={unlinkedBookable || o.kind === 'ACCESSIBLE_ROUTE' || o.kind === 'ZONE' ? '0.25 0.15' : undefined}
              />
              {label && o.kind !== 'WALL' && (
                <text x={o.width / 2} y={o.kind === 'ZONE' ? 0.4 : o.depth / 2} fontSize={o.kind === 'ZONE' ? 0.4 : fontSize} textAnchor="middle" dominantBaseline="middle" fill="#172033" pointerEvents="none" transform={o.rotation ? `rotate(${-o.rotation} ${o.width / 2} ${o.depth / 2})` : undefined}>
                  {label}
                </text>
              )}
              {selected && (
                <rect
                  x={o.width - 0.18}
                  y={o.depth - 0.18}
                  width={0.36}
                  height={0.36}
                  fill="#4F46E5"
                  stroke="#fff"
                  strokeWidth={0.04}
                  style={{ cursor: 'nwse-resize' }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    drag.current = { mode: 'resize', key: o.key, originX: o.x, originY: o.y };
                    svgRef.current?.setPointerCapture?.(e.pointerId);
                  }}
                  aria-label="Resize handle"
                />
              )}
            </g>
          );
        })}
      </svg>
      <Stack direction="row" spacing={0.5} sx={{ position: 'absolute', right: 8, bottom: 8, bgcolor: '#fff', borderRadius: 2, border: '1px solid', borderColor: 'divider', p: 0.25 }}>
        <Tooltip title="Zoom in"><IconButton size="small" aria-label="Zoom in" onClick={() => setVb((v) => zoomViewBox(v, 0.8, v.x + v.w / 2, v.y + v.h / 2))}><ZoomInRoundedIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="Zoom out"><IconButton size="small" aria-label="Zoom out" onClick={() => setVb((v) => zoomViewBox(v, 1.25, v.x + v.w / 2, v.y + v.h / 2, { min: 2, max: Math.max(widthM, depthM) * 4 }))}><ZoomOutRoundedIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="Fit to floor"><IconButton size="small" aria-label="Fit to floor" onClick={() => setVb(fitViewBox(widthM, depthM))}><FitScreenRoundedIcon fontSize="small" /></IconButton></Tooltip>
      </Stack>
    </Box>
  );
}
