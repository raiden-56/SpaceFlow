// Pure helpers for the Map Studio editor (no React, unit-tested).
// Coordinates are metres from the top-left corner of the floor; x along width, y along depth.
// (x, y) is the top-left of an object's unrotated footprint; rotation is around its centre.
import type { MapObjectKind } from '@spaceflow/shared';

export interface StudioObject {
  key: string;
  kind: MapObjectKind;
  label: string | null;
  x: number;
  y: number;
  width: number;
  depth: number;
  rotation: number;
  height: number | null;
  resourceId: string | null;
  meta: Record<string, unknown> | null;
}

export interface StudioResource {
  id: string;
  code: string;
  name: string;
  type: 'SEAT' | 'MEETING_ROOM';
}

export const DEFAULT_SIZES: Record<MapObjectKind, { width: number; depth: number; height?: number }> = {
  DESK: { width: 1.6, depth: 0.8 },
  MEETING_ROOM: { width: 5, depth: 4, height: 3 },
  PRIVATE_OFFICE: { width: 4, depth: 3.5, height: 3 },
  COLLAB_SPACE: { width: 6, depth: 4 },
  RECEPTION: { width: 6, depth: 2.5 },
  ELEVATOR: { width: 2.5, depth: 2.5 },
  STAIRS: { width: 2.5, depth: 4 },
  RESTROOM: { width: 3, depth: 4 },
  CAFETERIA: { width: 10, depth: 6 },
  PRINTER: { width: 1.2, depth: 0.8 },
  ACCESSIBLE_ROUTE: { width: 1.5, depth: 8 },
  EMERGENCY_EXIT: { width: 1.2, depth: 1.2 },
  WALL: { width: 6, depth: 0.2 },
  ZONE: { width: 10, depth: 6 },
  OTHER: { width: 2, depth: 2 },
};

export const KIND_LABELS: Record<MapObjectKind, string> = {
  DESK: 'Desk',
  MEETING_ROOM: 'Meeting room',
  PRIVATE_OFFICE: 'Private office',
  COLLAB_SPACE: 'Collaboration space',
  RECEPTION: 'Reception',
  ELEVATOR: 'Elevator',
  STAIRS: 'Stairs',
  RESTROOM: 'Restroom',
  CAFETERIA: 'Cafeteria',
  PRINTER: 'Printer',
  ACCESSIBLE_ROUTE: 'Accessible route',
  EMERGENCY_EXIT: 'Emergency exit',
  WALL: 'Wall',
  ZONE: 'Zone outline',
  OTHER: 'Other facility',
};

export const KIND_FILL: Record<MapObjectKind, string> = {
  DESK: '#C7D2FE',
  MEETING_ROOM: '#BAE6FD',
  PRIVATE_OFFICE: '#E9D5FF',
  COLLAB_SPACE: '#FED7AA',
  RECEPTION: '#FDE68A',
  ELEVATOR: '#CBD5E1',
  STAIRS: '#CBD5E1',
  RESTROOM: '#BFDBFE',
  CAFETERIA: '#FECACA',
  PRINTER: '#E2E8F0',
  ACCESSIBLE_ROUTE: '#BBF7D0',
  EMERGENCY_EXIT: '#FCA5A5',
  WALL: '#475569',
  ZONE: '#EEF2FF',
  OTHER: '#E2E8F0',
};

/** Resource type a map object kind can be linked to (null = not linkable). */
export function linkableType(kind: MapObjectKind): 'SEAT' | 'MEETING_ROOM' | null {
  if (kind === 'DESK') return 'SEAT';
  if (kind === 'MEETING_ROOM') return 'MEETING_ROOM';
  return null;
}

export function round(v: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

/** Snap to a grid step (metres). step <= 0 disables snapping but still rounds to centimetres. */
export function snap(v: number, step: number): number {
  if (step <= 0) return round(v);
  return round(Math.round(v / step) * step);
}

/** Keep an object's footprint within the floor (ignores rotation, same rule as the API). */
export function clampToFloor<T extends Pick<StudioObject, 'x' | 'y' | 'width' | 'depth'>>(o: T, widthM: number, depthM: number): T {
  const width = Math.min(Math.max(o.width, 0.1), widthM);
  const depth = Math.min(Math.max(o.depth, 0.1), depthM);
  return { ...o, width: round(width), depth: round(depth), x: round(Math.min(Math.max(o.x, 0), widthM - width)), y: round(Math.min(Math.max(o.y, 0), depthM - depth)) };
}

export function rectsOverlap(a: Pick<StudioObject, 'x' | 'y' | 'width' | 'depth'>, b: Pick<StudioObject, 'x' | 'y' | 'width' | 'depth'>, gap = 0): boolean {
  return a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.depth + gap && b.y < a.y + a.depth + gap;
}

/** Client-side validation mirroring the API rules, so problems show before saving. */
export function validateDraft(objects: StudioObject[], widthM: number, depthM: number, resources: StudioResource[]): string[] {
  const issues: string[] = [];
  const seen = new Map<string, number>();
  objects.forEach((o, i) => {
    const name = o.label ? `"${o.label}"` : `${KIND_LABELS[o.kind]} #${i + 1}`;
    if (o.x < 0 || o.y < 0 || o.x + o.width > widthM + 0.001 || o.y + o.depth > depthM + 0.001) issues.push(`${name} is outside the floor bounds`);
    if (o.resourceId) {
      const r = resources.find((x) => x.id === o.resourceId);
      if (!r) issues.push(`${name} is linked to a resource that is not on this floor`);
      else if (linkableType(o.kind) !== r.type) issues.push(`${name} is a ${KIND_LABELS[o.kind].toLowerCase()} but ${r.code} is a ${r.type === 'SEAT' ? 'seat' : 'meeting room'}`);
      if (seen.has(o.resourceId)) issues.push(`${r?.code ?? 'A resource'} is linked twice`);
      seen.set(o.resourceId, i);
    } else if (linkableType(o.kind) && !o.label) {
      issues.push(`${name} needs a label or a linked resource`);
    }
  });
  return issues;
}

/**
 * Place unlinked resources into free space using a simple grid scan (left-to-right, top-to-bottom)
 * that avoids existing objects. Returns the new objects; resources that do not fit are reported.
 */
export function autoPlace(
  resources: StudioResource[],
  existing: StudioObject[],
  widthM: number,
  depthM: number,
  makeKey: () => string,
  opts: { margin?: number; gap?: number } = {},
): { placed: StudioObject[]; unplaced: StudioResource[] } {
  const margin = opts.margin ?? 0.5;
  const gap = opts.gap ?? 0.4;
  const occupied: Pick<StudioObject, 'x' | 'y' | 'width' | 'depth'>[] = existing.filter((o) => o.kind !== 'ZONE' && o.kind !== 'ACCESSIBLE_ROUTE').map((o) => ({ x: o.x, y: o.y, width: o.width, depth: o.depth }));
  const placed: StudioObject[] = [];
  const unplaced: StudioResource[] = [];
  for (const r of resources) {
    const kind: MapObjectKind = r.type === 'SEAT' ? 'DESK' : 'MEETING_ROOM';
    const size = DEFAULT_SIZES[kind];
    const step = r.type === 'SEAT' ? 0.2 : 0.5;
    let spot: { x: number; y: number } | null = null;
    for (let y = margin; y + size.depth <= depthM - margin + 1e-9 && !spot; y = round(y + step)) {
      for (let x = margin; x + size.width <= widthM - margin + 1e-9; x = round(x + step)) {
        const candidate = { x, y, width: size.width, depth: size.depth };
        if (!occupied.some((o) => rectsOverlap(candidate, o, gap))) {
          spot = { x, y };
          break;
        }
      }
    }
    if (!spot) {
      unplaced.push(r);
      continue;
    }
    const obj: StudioObject = { key: makeKey(), kind, label: r.code, x: spot.x, y: spot.y, width: size.width, depth: size.depth, rotation: 0, height: size.height ?? null, resourceId: r.id, meta: null };
    placed.push(obj);
    occupied.push(obj);
  }
  return { placed, unplaced };
}

/** Viewport math: fit the floor into the canvas with padding. Returns an SVG viewBox. */
export function fitViewBox(widthM: number, depthM: number, padding = 1): { x: number; y: number; w: number; h: number } {
  return { x: -padding, y: -padding, w: widthM + padding * 2, h: depthM + padding * 2 };
}

/** Zoom a viewBox around a point (metres). factor < 1 zooms in. */
export function zoomViewBox(vb: { x: number; y: number; w: number; h: number }, factor: number, cx: number, cy: number, limits = { min: 2, max: 2000 }) {
  const w = Math.min(Math.max(vb.w * factor, limits.min), limits.max);
  const k = w / vb.w;
  const h = vb.h * k;
  return { x: cx - (cx - vb.x) * k, y: cy - (cy - vb.y) * k, w, h };
}
