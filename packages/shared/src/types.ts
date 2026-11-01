import type {
  ApprovalStatus,
  AssetKind,
  AvailabilityState,
  IntegrationProvider,
  MapObjectKind,
  NotificationType,
  Permission,
  ReservationStatus,
  ResourceStatus,
  ResourceType,
  RoleCode,
  RoomType,
  SeatType,
  UserStatus,
  ZoneKind,
} from './enums.js';
import type { OperatingHours, SeatAttributes } from './schemas/workplace.js';
import type { RecurrenceRule } from './schemas/reservations.js';

export interface UserSummaryDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  departmentId: string | null;
  departmentName: string | null;
  teamId: string | null;
  teamName: string | null;
}

export interface CurrentUserDto extends UserSummaryDto {
  orgId: string;
  orgName: string;
  roles: RoleCode[];
  permissions: Permission[];
  status: UserStatus;
  homeBuildingId: string | null;
  homeBuildingName: string | null;
  phone: string | null;
  preferences: UserPreferencesDto;
  lastLoginAt: string | null;
  /** True when the session belongs to a guest sandbox organisation (demo data, auto-purged). */
  isGuest: boolean;
  guestExpiresAt: string | null;
}

export interface UserPreferencesDto {
  defaultBuildingId: string | null;
  defaultFloorId: string | null;
  shareLocationWithTeam: boolean;
  emailNotifications: boolean;
  preferredView: '3D' | '2D' | 'LIST';
  reducedMotion: boolean;
}

export interface AuthResponseDto {
  accessToken: string;
  expiresIn: number;
  user: CurrentUserDto;
}

export interface BuildingDto {
  id: string;
  name: string;
  code: string;
  addressLine: string | null;
  city: string | null;
  country: string | null;
  timezone: string;
  isActive: boolean;
  description: string | null;
  modelAssetId: string | null;
  modelUrl: string | null;
  floorCount: number;
  seatCount: number;
  roomCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface FloorDto {
  id: string;
  buildingId: string;
  name: string;
  number: number;
  sortOrder: number;
  isPublished: boolean;
  hasFloorPlan: boolean;
  floorPlanStatus: 'NONE' | 'DRAFT' | 'PUBLISHED';
  seatCount: number;
  roomCount: number;
  widthM: number | null;
  depthM: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ZoneDto {
  id: string;
  floorId: string;
  name: string;
  kind: ZoneKind;
  color: string | null;
}

export interface AmenityDto {
  id: string;
  code: string;
  name: string;
  category: 'SEAT' | 'ROOM' | 'BOTH';
  icon: string | null;
}

export interface MapObjectDto {
  id: string;
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

export interface FloorMapDto {
  floor: FloorDto;
  building: Pick<BuildingDto, 'id' | 'name' | 'code' | 'timezone'>;
  plan: {
    id: string;
    widthM: number;
    depthM: number;
    status: 'DRAFT' | 'PUBLISHED';
    version: number;
    imageUrl: string | null;
    modelUrl: string | null;
    publishedAt: string | null;
  } | null;
  objects: MapObjectDto[];
  resources: ResourceDto[];
  zones: ZoneDto[];
}

export interface ResourceDto {
  id: string;
  type: ResourceType;
  code: string;
  name: string;
  description: string | null;
  status: ResourceStatus;
  isBookable: boolean;
  requiresApproval: boolean;
  buildingId: string;
  buildingName: string;
  buildingTimezone: string;
  floorId: string;
  floorName: string;
  floorNumber: number;
  zoneId: string | null;
  zoneName: string | null;
  capacity: number | null;
  seatType: SeatType | null;
  roomType: RoomType | null;
  seatAttributes: SeatAttributes | null;
  accessible: boolean;
  amenities: AmenityDto[];
  operatingHours: OperatingHours | null;
  maxDurationMinutes: number | null;
  checkInRequired: boolean | null;
  restrictedDepartmentIds: string[];
  restrictedTeamIds: string[];
  mapPosition: { x: number; y: number; width: number; depth: number; rotation: number } | null;
  isFavorite?: boolean;
  /** Present when the request included an availability window. */
  availability?: ResourceAvailabilityDto;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceAvailabilityDto {
  resourceId: string;
  state: AvailabilityState;
  /** Human-readable explanation, e.g. "Reserved 09:00-11:00 by A. Patel". */
  reason: string | null;
  canBook: boolean;
  conflictingReservation?: {
    id: string;
    startAt: string;
    endAt: string;
    status: ReservationStatus;
    userDisplayName: string | null;
    isMine: boolean;
  } | null;
}

export interface TimeSlotDto {
  startAt: string;
  endAt: string;
  state: AvailabilityState;
  reservationId?: string | null;
}

export interface ResourceDayAvailabilityDto {
  resourceId: string;
  date: string;
  timezone: string;
  slotMinutes: number;
  operatingStart: string | null;
  operatingEnd: string | null;
  slots: TimeSlotDto[];
  reservations: ReservationSummaryDto[];
}

export interface ReservationSummaryDto {
  id: string;
  resourceId: string;
  resourceCode: string;
  resourceName: string;
  resourceType: ResourceType;
  type: ResourceType;
  status: ReservationStatus;
  title: string | null;
  startAt: string;
  endAt: string;
  timezone: string;
  isAllDay: boolean;
  userId: string;
  userDisplayName: string;
  buildingId: string;
  buildingName: string;
  floorId: string;
  floorName: string;
  floorNumber: number;
  zoneName: string | null;
  seriesId: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReservationDto extends ReservationSummaryDto {
  description: string | null;
  setupNotes: string | null;
  capacity: number | null;
  attendees: { id: string; userId: string | null; email: string | null; name: string | null }[];
  checkInCode: string | null;
  approval: {
    id: string;
    status: ApprovalStatus;
    approverId: string | null;
    approverName: string | null;
    decisionNote: string | null;
    decidedAt: string | null;
  } | null;
  policy: {
    checkInRequired: boolean;
    checkInOpensAt: string | null;
    checkInDeadlineAt: string | null;
    cancellationDeadlineAt: string | null;
  };
  actions: {
    canModify: boolean;
    canCancel: boolean;
    canCheckIn: boolean;
    canCheckOut: boolean;
    canRebook: boolean;
  };
  mapPosition: { x: number; y: number } | null;
}

export interface BatchReservationResultDto {
  created: ReservationDto[];
  failed: { startAt: string; endAt: string; code: string; message: string }[];
  seriesId: string | null;
  atomic: boolean;
}

export interface ConflictAlternativeDto {
  resource: ResourceDto;
  startAt: string;
  endAt: string;
}

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface FavoriteDto {
  id: string;
  resource: ResourceDto;
  createdAt: string;
}

export interface PolicyDto {
  id: string;
  name: string;
  buildingId: string | null;
  buildingName: string | null;
  resourceType: ResourceType | null;
  advanceBookingDays: number;
  minDurationMinutes: number;
  maxDurationMinutes: number;
  slotMinutes: number;
  maxActiveReservations: number;
  maxDailyBookings: number;
  maxWeeklyBookings: number;
  operatingStart: string;
  operatingEnd: string;
  allowWeekends: boolean;
  cancellationDeadlineMinutes: number;
  checkInRequired: boolean;
  checkInGraceMinutes: number;
  checkInOpensMinutesBefore: number;
  autoReleaseEnabled: boolean;
  allowRecurring: boolean;
  maxRecurringOccurrences: number;
  allowMultiDay: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserDto extends UserSummaryDto {
  roles: RoleCode[];
  status: UserStatus;
  homeBuildingId: string | null;
  homeBuildingName: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  inviteUrl?: string | null;
}

export interface DepartmentDto {
  id: string;
  name: string;
  teams: { id: string; name: string; memberCount: number }[];
  memberCount: number;
}

export interface AuditLogDto {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
}

export interface AssetDto {
  id: string;
  kind: AssetKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  createdAt: string;
}

export interface IntegrationDto {
  provider: IntegrationProvider;
  isEnabled: boolean;
  isConfigured: boolean;
  status: 'NOT_CONFIGURED' | 'READY' | 'ERROR' | 'DISABLED';
  config: Record<string, unknown>;
  requiredEnv: string[];
  lastError: string | null;
  lastSyncedAt: string | null;
}

export interface AnnouncementDto {
  id: string;
  title: string;
  body: string;
  buildingId: string | null;
  publishedAt: string;
  expiresAt: string | null;
}

export interface SearchResultsDto {
  buildings: { id: string; name: string; code: string; city: string | null }[];
  floors: { id: string; name: string; number: number; buildingId: string; buildingName: string }[];
  seats: ResourceDto[];
  rooms: ResourceDto[];
  amenities: { id: string; name: string; resourceCount: number }[];
  facilities: {
    id: string;
    label: string;
    kind: MapObjectKind;
    floorId: string;
    floorName: string;
    buildingId: string;
    buildingName: string;
  }[];
  employees: UserSummaryDto[];
}

export interface DashboardDto {
  user: { displayName: string; homeBuildingName: string | null };
  today: {
    date: string;
    seatBooking: ReservationSummaryDto | null;
    meetings: ReservationSummaryDto[];
  };
  nextBooking: ReservationSummaryDto | null;
  upcoming: ReservationSummaryDto[];
  recent: ReservationSummaryDto[];
  availability: {
    buildingId: string | null;
    totalSeats: number;
    availableSeats: number;
    totalRooms: number;
    availableRooms: number;
    checkedInNow: number;
    reservedNow: number;
  };
  favorites: ResourceDto[];
  recentResources: ResourceDto[];
  suggestedSeats: ResourceDto[];
  announcements: AnnouncementDto[];
  unreadNotifications: number;
}

export interface AdminOverviewDto {
  totals: {
    buildings: number;
    floors: number;
    seats: number;
    rooms: number;
    employees: number;
  };
  today: {
    reservedSeats: number;
    reservedRooms: number;
    checkedIn: number;
    availableSeats: number;
    availableRooms: number;
    pendingApprovals: number;
  };
  range: { from: string; to: string };
  bookingVolume: { date: string; seats: number; rooms: number }[];
  utilization: { date: string; seatUtilization: number; roomUtilization: number }[];
  peakHours: { hour: number; count: number }[];
  rates: {
    totalBookings: number;
    cancelled: number;
    cancellationRate: number;
    checkInRequired: number;
    checkedIn: number;
    checkInRate: number;
    noShows: number;
    noShowRate: number;
  };
  topResources: { resourceId: string; code: string; name: string; type: ResourceType; count: number }[];
  floorUtilization: {
    floorId: string;
    floorName: string;
    buildingName: string;
    seats: number;
    bookedHours: number;
    utilization: number;
  }[];
  buildingComparison: {
    buildingId: string;
    buildingName: string;
    bookings: number;
    utilization: number;
  }[];
}

export interface RealtimeEvent {
  type: 'availability.changed' | 'reservation.updated' | 'notification.created' | 'floorplan.published' | 'ping';
  payload: Record<string, unknown>;
  at: string;
}

export interface HealthDto {
  status: 'ok' | 'degraded';
  version: string;
  uptimeSeconds: number;
  checks: { database: 'ok' | 'error'; jobs: 'ok' | 'disabled' | 'error' };
}

export type { RecurrenceRule };
