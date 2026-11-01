export const RoleCodes = ['EMPLOYEE', 'WORKPLACE_ADMIN', 'ORG_ADMIN', 'APPROVER'] as const;
export type RoleCode = (typeof RoleCodes)[number];

export const Permissions = [
  'workplace:read',
  'reservation:create',
  'reservation:manage-own',
  'reservation:manage-any',
  'reservation:approve',
  'resource:manage',
  'building:manage',
  'floorplan:manage',
  'policy:manage',
  'user:read',
  'user:manage',
  'analytics:read',
  'audit:read',
  'integration:manage',
  'settings:manage',
] as const;
export type Permission = (typeof Permissions)[number];

export const ROLE_PERMISSIONS: Record<RoleCode, Permission[]> = {
  EMPLOYEE: ['workplace:read', 'reservation:create', 'reservation:manage-own', 'user:read'],
  APPROVER: [
    'workplace:read',
    'reservation:create',
    'reservation:manage-own',
    'reservation:approve',
    'user:read',
  ],
  WORKPLACE_ADMIN: [
    'workplace:read',
    'reservation:create',
    'reservation:manage-own',
    'reservation:manage-any',
    'reservation:approve',
    'resource:manage',
    'building:manage',
    'floorplan:manage',
    'policy:manage',
    'user:read',
    'analytics:read',
    'audit:read',
  ],
  ORG_ADMIN: [...Permissions],
};

export const ResourceTypes = ['SEAT', 'MEETING_ROOM'] as const;
export type ResourceType = (typeof ResourceTypes)[number];

export const ResourceStatuses = ['ACTIVE', 'DISABLED', 'MAINTENANCE'] as const;
export type ResourceStatus = (typeof ResourceStatuses)[number];

export const ReservationStatuses = [
  'PENDING_APPROVAL',
  'CONFIRMED',
  'CHECKED_IN',
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
  'NO_SHOW',
  'RELEASED',
] as const;
export type ReservationStatus = (typeof ReservationStatuses)[number];
/** Statuses that occupy a resource (participate in the exclusion constraint). */
export const ACTIVE_RESERVATION_STATUSES: ReservationStatus[] = [
  'PENDING_APPROVAL',
  'CONFIRMED',
  'CHECKED_IN',
];

/** Availability state shown to users for a specific interval. */
export const AvailabilityStates = [
  'AVAILABLE',
  'OCCUPIED', // a reservation is in progress right now (checked in or currently running)
  'RESERVED', // reserved for the requested interval (future or not yet checked in)
  'RESTRICTED', // bookable but requires approval or is restricted to a group
  'DISABLED', // not bookable (disabled, maintenance, unpublished)
] as const;
export type AvailabilityState = (typeof AvailabilityStates)[number];

export const MapObjectKinds = [
  'DESK',
  'MEETING_ROOM',
  'PRIVATE_OFFICE',
  'COLLAB_SPACE',
  'RECEPTION',
  'ELEVATOR',
  'STAIRS',
  'RESTROOM',
  'CAFETERIA',
  'PRINTER',
  'ACCESSIBLE_ROUTE',
  'EMERGENCY_EXIT',
  'WALL',
  'ZONE',
  'OTHER',
] as const;
export type MapObjectKind = (typeof MapObjectKinds)[number];
export const BOOKABLE_MAP_KINDS: MapObjectKind[] = ['DESK', 'MEETING_ROOM'];

export const NotificationTypes = [
  'BOOKING_CONFIRMED',
  'BOOKING_CANCELLED',
  'BOOKING_MODIFIED',
  'BOOKING_REMINDER',
  'CHECKIN_REMINDER',
  'NO_SHOW_WARNING',
  'BOOKING_RELEASED',
  'APPROVAL_REQUESTED',
  'APPROVAL_DECIDED',
  'RESOURCE_MAINTENANCE',
  'ANNOUNCEMENT',
] as const;
export type NotificationType = (typeof NotificationTypes)[number];

export const AssetKinds = ['BUILDING_MODEL', 'FLOOR_MODEL', 'FLOOR_PLAN_IMAGE'] as const;
export type AssetKind = (typeof AssetKinds)[number];

export const IntegrationProviders = [
  'MS365_CALENDAR',
  'GOOGLE_CALENDAR',
  'MS_TEAMS',
  'EMAIL_SMTP',
  'SSO_OIDC',
  'QR_CHECKIN',
] as const;
export type IntegrationProvider = (typeof IntegrationProviders)[number];

export const UserStatuses = ['INVITED', 'ACTIVE', 'DEACTIVATED'] as const;
export type UserStatus = (typeof UserStatuses)[number];

export const ApprovalStatuses = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type ApprovalStatus = (typeof ApprovalStatuses)[number];

export const ZoneKinds = ['NEIGHBORHOOD', 'QUIET', 'COLLABORATION', 'GENERAL'] as const;
export type ZoneKind = (typeof ZoneKinds)[number];

export const SeatTypes = ['WORKSTATION', 'HOT_DESK', 'STANDING', 'PHONE_BOOTH'] as const;
export type SeatType = (typeof SeatTypes)[number];
export const RoomTypes = ['MEETING', 'CONFERENCE', 'HUDDLE', 'BOARDROOM', 'TRAINING'] as const;
export type RoomType = (typeof RoomTypes)[number];
