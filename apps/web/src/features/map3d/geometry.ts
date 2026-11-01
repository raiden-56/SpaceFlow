// Pure geometry + colour helpers for the explorer (3D scene, 2D plan, previews). No React, no three.
import { STATUS_COLORS, type AvailabilityState, type FloorDto, type MapObjectDto, type MapObjectKind, type ResourceDto } from '@spaceflow/shared';

/** 1 plan metre == 1 scene unit. */
export const FLOOR_HEIGHT = 3.6;
export const SLAB_THICKNESS = 0.3;
export const EXPLODE_GAP = 4;

export type Vec3 = [number, number, number];

export interface CameraPose {
  position: Vec3;
  target: Vec3;
}

export interface FloorLayout {
  id: string;
  index: number;
  name: string;
  number: number;
  widthM: number;
  depthM: number;
  /** Y of the slab bottom. */
  y: number;
}

export function stateColor(state: AvailabilityState | 'SELECTED' | 'HOVER' | undefined | null): string {
  if (!state) return STATUS_COLORS.DISABLED;
  if (state === 'HOVER') return '#6366F1';
  return (STATUS_COLORS as Record<string, string>)[state] ?? STATUS_COLORS.DISABLED;
}

/** Resolve the state used for colouring a resource (falls back to ACTIVE => AVAILABLE when no window). */
export function resourceState(r: Pick<ResourceDto, 'availability' | 'status' | 'isBookable'> | undefined): AvailabilityState {
  if (!r) return 'DISABLED';
  if (r.availability) return r.availability.state;
  return r.status === 'ACTIVE' && r.isBookable ? 'AVAILABLE' : 'DISABLED';
}

/** Floors ordered bottom -> top with their vertical offset (optionally exploded). */
export function layoutFloors(floors: FloorDto[], exploded = false, fallbackW = 40, fallbackD = 24): FloorLayout[] {
  const ordered = [...floors].sort((a, b) => a.sortOrder - b.sortOrder || a.number - b.number);
  return ordered.map((f, index) => ({
    id: f.id,
    index,
    name: f.name,
    number: f.number,
    widthM: f.widthM ?? fallbackW,
    depthM: f.depthM ?? fallbackD,
    y: index * (FLOOR_HEIGHT + (exploded ? EXPLODE_GAP : 0)),
  }));
}

export function buildingBounds(layout: FloorLayout[]) {
  const w = Math.max(1, ...layout.map((l) => l.widthM));
  const d = Math.max(1, ...layout.map((l) => l.depthM));
  const top = layout.length ? layout[layout.length - 1].y + FLOOR_HEIGHT : FLOOR_HEIGHT;
  return { w, d, h: top };
}

/** Plan coords (x along width, y along depth, top-left origin) -> scene position of an object's centre. */
export function objectCenter(o: Pick<MapObjectDto, 'x' | 'y' | 'width' | 'depth'>, floorY: number, height = 0): Vec3 {
  return [o.x + o.width / 2, floorY + SLAB_THICKNESS + height / 2, o.y + o.depth / 2];
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Overview pose: oblique view that frames the whole building. */
export function overviewPose(layout: FloorLayout[]): CameraPose {
  const { w, d, h } = buildingBounds(layout);
  const radius = Math.max(w, d, h) * 1.15;
  return { position: [w / 2 + radius * 0.95, h + radius * 0.75, d / 2 + radius * 1.1], target: [w / 2, h * 0.45, d / 2] };
}

/** Floor pose: steep angled view onto a floor so desks/rooms are readable. */
export function floorPose(floor: FloorLayout): CameraPose {
  const span = Math.max(floor.widthM, floor.depthM);
  return { position: [floor.widthM / 2, floor.y + span * 0.9, floor.depthM / 2 + span * 0.55], target: [floor.widthM / 2, floor.y, floor.depthM / 2] };
}

/** Resource focus pose: close, slightly elevated, looking at the object. */
export function resourcePose(center: Vec3, size = 2): CameraPose {
  const dist = Math.max(6, size * 3);
  return { position: [center[0] + dist * 0.6, center[1] + dist * 0.9, center[2] + dist * 0.8], target: center };
}

export interface DeskInstance {
  id: string;
  resourceId: string | null;
  position: Vec3;
  rotationY: number;
  color: string;
  width: number;
  depth: number;
}

export const DESK_HEIGHT = 0.74;

/** Build instanced-desk attributes for a floor. */
export function buildDeskInstances(objects: MapObjectDto[], resources: Map<string, ResourceDto>, floorY: number, selectedId: string | null): DeskInstance[] {
  return objects
    .filter((o) => o.kind === 'DESK')
    .map((o) => {
      const r = o.resourceId ? resources.get(o.resourceId) : undefined;
      const state = o.resourceId ? resourceState(r) : 'DISABLED';
      return {
        id: o.id,
        resourceId: o.resourceId,
        position: objectCenter(o, floorY, DESK_HEIGHT),
        rotationY: -degToRad(o.rotation),
        color: o.resourceId && o.resourceId === selectedId ? STATUS_COLORS.SELECTED : stateColor(state),
        width: o.width,
        depth: o.depth,
      };
    });
}

export interface KindStyle {
  color: string;
  height: number;
  opacity: number;
  label: boolean;
}

/** Visual style per map-object kind (metres). */
export const KIND_STYLES: Record<Exclude<MapObjectKind, 'DESK'>, KindStyle> = {
  MEETING_ROOM: { color: '#93C5FD', height: 2.8, opacity: 0.45, label: true },
  PRIVATE_OFFICE: { color: '#C4B5FD', height: 2.8, opacity: 0.4, label: true },
  COLLAB_SPACE: { color: '#FDBA74', height: 0.08, opacity: 0.7, label: true },
  RECEPTION: { color: '#A5B4FC', height: 1.1, opacity: 0.9, label: true },
  ELEVATOR: { color: '#94A3B8', height: 3.2, opacity: 1, label: true },
  STAIRS: { color: '#CBD5E1', height: 3.2, opacity: 1, label: true },
  RESTROOM: { color: '#7DD3FC', height: 2.8, opacity: 0.9, label: true },
  CAFETERIA: { color: '#FCD34D', height: 0.08, opacity: 0.7, label: true },
  PRINTER: { color: '#475569', height: 1.2, opacity: 1, label: true },
  ACCESSIBLE_ROUTE: { color: '#34D399', height: 0.04, opacity: 0.6, label: false },
  EMERGENCY_EXIT: { color: '#EF4444', height: 2.2, opacity: 1, label: true },
  WALL: { color: '#E2E8F0', height: 2.8, opacity: 1, label: false },
  ZONE: { color: '#E0E7FF', height: 0.03, opacity: 0.5, label: true },
  OTHER: { color: '#CBD5E1', height: 1, opacity: 0.9, label: true },
};

export function kindLabel(kind: MapObjectKind): string {
  return kind.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function kindStyle(o: Pick<MapObjectDto, 'kind' | 'height' | 'meta'>): KindStyle {
  const base = o.kind === 'DESK' ? { color: STATUS_COLORS.DISABLED, height: DESK_HEIGHT, opacity: 1, label: false } : KIND_STYLES[o.kind];
  const metaColor = (o.meta as { color?: string } | null)?.color;
  return { ...base, color: o.kind === 'ZONE' && metaColor ? metaColor : base.color, height: o.height ?? base.height };
}

/** Clamp a value into [min, max]. */
export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Fit-to-view transform for a 2D plan inside a viewport (returns scale + translation in px). */
export function fitTransform(planW: number, planD: number, viewW: number, viewH: number, padding = 24) {
  const scale = Math.max(0.01, Math.min((viewW - padding * 2) / planW, (viewH - padding * 2) / planD));
  return { scale, tx: (viewW - planW * scale) / 2, ty: (viewH - planD * scale) / 2 };
}

/** Zoom about a point keeping that point fixed on screen. */
export function zoomAbout(t: { scale: number; tx: number; ty: number }, factor: number, px: number, py: number, minScale = 0.2, maxScale = 60) {
  const scale = clamp(t.scale * factor, minScale, maxScale);
  const k = scale / t.scale;
  return { scale, tx: px - (px - t.tx) * k, ty: py - (py - t.ty) * k };
}

/** Detect WebGL support without creating a persistent context. */
export function hasWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Hex colour -> [r,g,b] in 0..1. */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
