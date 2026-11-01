// Accessible 2D SVG floor plan: pan/zoom, background image, labelled objects, keyboard-navigable resources.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded';
import FitScreenRoundedIcon from '@mui/icons-material/FitScreenRounded';
import type { FloorMapDto, MapObjectDto, ResourceDto } from '@spaceflow/shared';
import { STATUS_COLORS } from '@spaceflow/shared';
import { availabilityText } from './BuildingScene';
import { clamp, fitTransform, kindLabel, kindStyle, resourceState, stateColor, zoomAbout } from './geometry';

export interface FloorPlan2DProps {
  map?: FloorMapDto;
  resources: ResourceDto[];
  selectedResourceId: string | null;
  onSelectResource: (id: string | null) => void;
  /** Increment to re-centre on the selected resource. */
  focusNonce?: number;
  reducedMotion?: boolean;
  /**
   * When set, only these resources are emphasised (e.g. the ones matching the booking filters);
   * the rest stay visible but dimmed so the floor keeps its context.
   */
  highlightIds?: Set<string> | null;
  /** Small badges drawn over desks, e.g. teammates who are in the office. */
  markers?: PlanMarker[];
  /** Non-interactive preview (booking dialog): no pan/zoom controls, centred on the selection. */
  readOnly?: boolean;
}

export interface PlanMarker {
  resourceId: string;
  /** Short text inside the badge, e.g. initials. */
  label: string;
  /** Accessible / tooltip text, e.g. "Priya Sharma (your team) 09:00–17:30". */
  title: string;
  color?: string;
}

interface Transform {
  scale: number;
  tx: number;
  ty: number;
}

export function FloorPlan2D({ map, resources, selectedResourceId, onSelectResource, focusNonce = 0, reducedMotion, highlightIds, markers, readOnly }: FloorPlan2DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [t, setT] = useState<Transform>({ scale: 10, tx: 0, ty: 0 });
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean; onResource: boolean; pointerId: number } | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const resourceMap = useMemo(() => new Map(resources.map((r) => [r.id, r])), [resources]);
  const planW = map?.plan?.widthM ?? 40;
  const planD = map?.plan?.depthM ?? 24;
  const lastFocus = useRef(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => setT(fitTransform(planW, planD, size.w, size.h, readOnly ? 8 : 24)), [planW, planD, size, readOnly]);
  useEffect(() => {
    // Read-only previews zoom in around the selection once the container size is known.
    const o = readOnly && selectedResourceId ? map?.objects.find((x) => x.resourceId === selectedResourceId) : undefined;
    if (o) {
      const scale = fitTransform(planW, planD, size.w, size.h, 8).scale * 1.8;
      setT({ scale, tx: size.w / 2 - (o.x + o.width / 2) * scale, ty: size.h / 2 - (o.y + o.depth / 2) * scale });
    } else fit();
  }, [fit, map, readOnly, selectedResourceId, planW, planD, size]);
  const markersByResource = useMemo(() => {
    const m = new Map<string, PlanMarker[]>();
    for (const mk of markers ?? []) m.set(mk.resourceId, [...(m.get(mk.resourceId) ?? []), mk]);
    return m;
  }, [markers]);

  // Centre on the selected resource when a focus is requested.
  useEffect(() => {
    if (!focusNonce || focusNonce === lastFocus.current || !map || !selectedResourceId) return;
    lastFocus.current = focusNonce;
    const o = map.objects.find((x) => x.resourceId === selectedResourceId);
    if (!o) return;
    const scale = Math.max(t.scale, Math.min(size.w / 14, 40));
    setT({ scale, tx: size.w / 2 - (o.x + o.width / 2) * scale, ty: size.h / 2 - (o.y + o.depth / 2) * scale });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce, selectedResourceId, map]);

  const objects = useMemo(() => {
    if (!map) return [] as MapObjectDto[];
    const allowed = new Set(resources.map((r) => r.id));
    const list = map.objects.filter((o) => !o.resourceId || allowed.has(o.resourceId));
    // draw order: zones/routes first, then facilities, then rooms, then desks
    const rank = (o: MapObjectDto) => (o.kind === 'ZONE' ? 0 : o.kind === 'ACCESSIBLE_ROUTE' ? 1 : o.kind === 'DESK' ? 4 : o.kind === 'MEETING_ROOM' ? 3 : 2);
    return list.sort((a, b) => rank(a) - rank(b));
  }, [map, resources]);
  const bookableIds = useMemo(() => objects.filter((o) => o.resourceId).sort((a, b) => (a.label ?? '').localeCompare(b.label ?? '')).map((o) => o.resourceId!), [objects]);

  const onWheel = (e: React.WheelEvent) => {
    if (readOnly) return;
    e.preventDefault();
    const rect = containerRef.current!.getBoundingClientRect();
    setT((prev) => zoomAbout(prev, e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rect.left, e.clientY - rect.top));
  };
  // Pointer handling: capture the pointer only once a real drag starts. Capturing on pointerdown
  // would retarget the subsequent click to the container, so desks and rooms could never be
  // selected with a mouse (only with the keyboard).
  const onPointerDown = (e: React.PointerEvent) => {
    if (readOnly || e.button !== 0) return;
    const onResource = !!(e.target as Element).closest?.('[data-resource-id]');
    drag.current = { x: e.clientX, y: e.clientY, tx: t.tx, ty: t.ty, moved: false, onResource, pointerId: e.pointerId };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    if (!drag.current.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      drag.current.moved = true;
      (e.currentTarget as HTMLElement).setPointerCapture(drag.current.pointerId);
    }
    if (drag.current.moved) setT((prev) => ({ ...prev, tx: drag.current!.tx + dx, ty: drag.current!.ty + dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d?.moved && (e.currentTarget as HTMLElement).hasPointerCapture(d.pointerId)) (e.currentTarget as HTMLElement).releasePointerCapture(d.pointerId);
    // A plain click on empty floor clears the selection; clicks on resources are handled by their onClick.
    if (d && !d.moved && !d.onResource) onSelectResource(null);
    // Keep `moved` visible to the resource onClick that fires right after pointerup.
    setTimeout(() => {
      if (drag.current === d) drag.current = null;
    }, 0);
  };
  const zoomBy = (f: number) => setT((prev) => zoomAbout(prev, f, size.w / 2, size.h / 2));

  const onKeyNav = (e: React.KeyboardEvent, resourceId: string) => {
    const idx = bookableIds.indexOf(resourceId);
    let next: string | undefined;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = bookableIds[Math.min(bookableIds.length - 1, idx + 1)];
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = bookableIds[Math.max(0, idx - 1)];
    if (e.key === 'Home') next = bookableIds[0];
    if (e.key === 'End') next = bookableIds[bookableIds.length - 1];
    if (next) {
      e.preventDefault();
      (containerRef.current?.querySelector(`[data-resource-id="${next}"]`) as HTMLElement | null)?.focus();
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelectResource(resourceId);
    }
    if (e.key === 'Escape') onSelectResource(null);
  };

  if (!map) {
    return (
      <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'text.secondary' }}>
        <Typography variant="body2">Select a floor to view its plan.</Typography>
      </Box>
    );
  }

  const fontScale = clamp(1 / t.scale, 0.03, 0.4);

  return (
    <Box ref={containerRef} data-testid="floor-plan-2d" sx={{ position: 'absolute', inset: 0, overflow: 'hidden', bgcolor: '#EEF2F7', touchAction: 'none', cursor: drag.current ? 'grabbing' : 'grab' }} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      <svg width={size.w} height={size.h} role="group" aria-label={`2D floor plan of ${map.floor.name}`} style={{ display: 'block' }}>
        <g transform={`translate(${t.tx} ${t.ty}) scale(${t.scale})`} style={{ transition: reducedMotion ? 'none' : 'transform 160ms ease-out' }}>
          <rect x={0} y={0} width={planW} height={planD} fill="#FFFFFF" stroke="#94A3B8" strokeWidth={0.12} rx={0.3} />
          {map.plan?.imageUrl && <image href={map.plan.imageUrl} x={0} y={0} width={planW} height={planD} preserveAspectRatio="none" opacity={0.9} />}
          {objects.map((o) => {
            const style = kindStyle(o);
            const r = o.resourceId ? resourceMap.get(o.resourceId) : undefined;
            const bookable = !!o.resourceId && (o.kind === 'DESK' || o.kind === 'MEETING_ROOM');
            const state = bookable ? resourceState(r) : null;
            const selected = bookable && o.resourceId === selectedResourceId;
            const hovered = bookable && !readOnly && o.resourceId === hoverId;
            const dimmed = bookable && !selected && ((!!highlightIds && !highlightIds.has(o.resourceId!)) || (readOnly && !!selectedResourceId));
            const badges = o.resourceId ? markersByResource.get(o.resourceId) : undefined;
            const fill = selected ? STATUS_COLORS.SELECTED : hovered ? '#6366F1' : state ? stateColor(state) : style.color;
            const cx = o.x + o.width / 2;
            const cy = o.y + o.depth / 2;
            const label = o.label ?? kindLabel(o.kind);
            const showLabel = o.kind !== 'DESK' ? style.label : t.scale > 14;
            const dashed = o.kind === 'ACCESSIBLE_ROUTE';
            const shape = (
              <rect x={o.x} y={o.y} width={o.width} height={o.depth} rx={o.kind === 'DESK' ? 0.1 : 0.25} fill={fill} fillOpacity={bookable ? (o.kind === 'MEETING_ROOM' ? 0.35 : 0.95) : style.opacity} stroke={selected ? STATUS_COLORS.SELECTED : bookable ? fill : '#94A3B8'} strokeWidth={selected ? 0.25 : 0.06} strokeDasharray={dashed ? '0.6 0.4' : undefined} transform={o.rotation ? `rotate(${o.rotation} ${cx} ${cy})` : undefined} />
            );
            const text = showLabel ? (
              <text x={cx} y={o.kind === 'DESK' ? cy + 0.12 : o.y + Math.min(0.9, o.depth / 2)} textAnchor="middle" fontSize={o.kind === 'DESK' ? 0.32 : Math.max(0.45, fontScale * 4)} fontFamily="Inter, sans-serif" fontWeight={600} fill={o.kind === 'ZONE' ? '#64748B' : bookable && o.kind === 'DESK' ? '#fff' : '#172033'} style={{ pointerEvents: 'none', userSelect: 'none' }}>
                {label}
                {o.kind === 'MEETING_ROOM' && r?.capacity ? ` · ${r.capacity}` : ''}
              </text>
            ) : null;
            if (!bookable) return <g key={o.id}>{shape}{text}</g>;
            const badgeEls = badges?.map((b, i) => {
              const bx = o.x + o.width - 0.15 - i * 0.55;
              const by = o.y - 0.15;
              return (
                <g key={`${b.resourceId}-${i}`} style={{ pointerEvents: 'none' }}>
                  <title>{b.title}</title>
                  <circle cx={bx} cy={by} r={0.32} fill={b.color ?? '#0EA5E9'} stroke="#fff" strokeWidth={0.06} />
                  <text x={bx} y={by + 0.1} textAnchor="middle" fontSize={0.26} fontWeight={700} fontFamily="Inter, sans-serif" fill="#fff">
                    {b.label}
                  </text>
                </g>
              );
            });
            if (readOnly) {
              return (
                <g key={o.id} opacity={dimmed ? 0.35 : 1}>
                  {shape}
                  {selected && <rect x={o.x - 0.35} y={o.y - 0.35} width={o.width + 0.7} height={o.depth + 0.7} rx={0.35} fill="none" stroke={STATUS_COLORS.SELECTED} strokeWidth={0.2} strokeDasharray="0.5 0.3" />}
                  {text}
                </g>
              );
            }
            const teamText = badges?.length ? ` · ${badges.map((b) => b.title).join(', ')}` : '';
            return (
              <g key={o.id} role="button" tabIndex={0} data-resource-id={o.resourceId!} aria-label={`${r?.name ?? label}, ${r ? availabilityText(r) : 'unknown'}${dimmed ? ', does not match your filters' : ''}${teamText}`} aria-pressed={selected} opacity={dimmed ? 0.35 : 1} onClick={(e) => { e.stopPropagation(); if (!drag.current?.moved) onSelectResource(o.resourceId!); }} onKeyDown={(e) => onKeyNav(e, o.resourceId!)} onPointerEnter={() => setHoverId(o.resourceId!)} onPointerLeave={() => setHoverId(null)} onFocus={() => setHoverId(o.resourceId!)} onBlur={() => setHoverId(null)} style={{ cursor: 'pointer', outline: 'none' }}>
                <title>{`${r?.name ?? label} · ${r ? availabilityText(r) : ''}${teamText}`}</title>
                {shape}
                {hovered && !selected && <rect x={o.x - 0.1} y={o.y - 0.1} width={o.width + 0.2} height={o.depth + 0.2} rx={0.2} fill="none" stroke={STATUS_COLORS.FOCUS} strokeWidth={0.18} transform={o.rotation ? `rotate(${o.rotation} ${cx} ${cy})` : undefined} />}
                {text}
                {badgeEls}
              </g>
            );
          })}
        </g>
      </svg>
      {!readOnly && hoverId && resourceMap.get(hoverId) && (
        <Box role="tooltip" sx={{ position: 'absolute', left: 12, top: 12, bgcolor: '#172033', color: '#fff', px: 1.25, py: 0.75, borderRadius: 2, fontSize: 12, pointerEvents: 'none' }}>
          <strong>{resourceMap.get(hoverId)!.name}</strong> · {availabilityText(resourceMap.get(hoverId)!)}
          {markersByResource.get(hoverId)?.map((m) => <Box key={m.title} component="span" sx={{ display: 'block', mt: 0.25, color: '#7DD3FC' }}>{m.title}</Box>)}
        </Box>
      )}
      {readOnly ? null : (<>
      <Stack direction="column" spacing={0.5} sx={{ position: 'absolute', right: 12, top: 12, bgcolor: 'rgba(255,255,255,0.95)', p: 0.5, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
        <Tooltip title="Zoom in" placement="left"><IconButton size="small" aria-label="Zoom in" onClick={() => zoomBy(1.3)}><AddRoundedIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="Zoom out" placement="left"><IconButton size="small" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.3)}><RemoveRoundedIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="Fit to view" placement="left"><IconButton size="small" aria-label="Fit plan to view" onClick={fit}><FitScreenRoundedIcon fontSize="small" /></IconButton></Tooltip>
      </Stack>
      <Typography variant="caption" sx={{ position: 'absolute', left: 12, bottom: 8, color: 'text.secondary', pointerEvents: 'none' }}>
        Drag to pan · scroll to zoom · Tab/arrow keys to move between desks and rooms · Enter to select
      </Typography>
      </>)}
    </Box>
  );
}
