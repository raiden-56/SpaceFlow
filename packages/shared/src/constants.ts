export const API_PREFIX = '/api/v1';

export const STATUS_COLORS = {
  AVAILABLE: '#16A34A',
  SELECTED: '#4F46E5',
  OCCUPIED: '#DC2626',
  RESERVED: '#F97316',
  RESTRICTED: '#D97706',
  DISABLED: '#94A3B8',
  FOCUS: '#2563EB',
} as const;

export const PALETTE = {
  primary: '#4F46E5',
  primaryDark: '#3730A3',
  background: '#F5F7FB',
  surface: '#FFFFFF',
  text: '#172033',
  textSecondary: '#64748B',
  border: '#E2E8F0',
} as const;

export const SEAT_ATTRIBUTE_KEYS = [
  'nearWindow',
  'nearElevator',
  'monitor',
  'dualMonitor',
  'dockingStation',
  'heightAdjustable',
  'accessible',
  'quietZone',
] as const;
export type SeatAttributeKey = (typeof SEAT_ATTRIBUTE_KEYS)[number];

export const SEAT_ATTRIBUTE_LABELS: Record<SeatAttributeKey, string> = {
  nearWindow: 'Near a window',
  nearElevator: 'Near elevators',
  monitor: 'Monitor',
  dualMonitor: 'Dual monitors',
  dockingStation: 'Docking station',
  heightAdjustable: 'Height-adjustable desk',
  accessible: 'Wheelchair accessible',
  quietZone: 'Quiet zone',
};

export const DEFAULT_SLOT_MINUTES = 30;
export const MAX_PAGE_SIZE = 200;
