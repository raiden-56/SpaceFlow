import type { Prisma } from '@prisma/client';
import type {
  AmenityDto,
  BuildingDto,
  FloorDto,
  MapObjectDto,
  NotificationDto,
  PolicyDto,
  ReservationSummaryDto,
  ResourceDto,
  UserSummaryDto,
  ZoneDto,
} from '@spaceflow/shared';
import { env } from '../config/env.js';

export const resourceInclude = {
  building: { select: { id: true, name: true, timezone: true } },
  floor: { select: { id: true, name: true, number: true } },
  zone: { select: { id: true, name: true } },
  amenities: { include: { amenity: true } },
  mapObject: { select: { x: true, y: true, width: true, depth: true, rotation: true } },
} satisfies Prisma.ResourceInclude;

export type ResourceRow = Prisma.ResourceGetPayload<{ include: typeof resourceInclude }>;

export function assetUrl(assetId: string | null | undefined): string | null {
  return assetId ? `${env.API_BASE_URL}/api/v1/assets/${assetId}/file` : null;
}

export function toAmenityDto(a: { id: string; code: string; name: string; category: string; icon: string | null }): AmenityDto {
  return { id: a.id, code: a.code, name: a.name, category: a.category as AmenityDto['category'], icon: a.icon };
}

export function toResourceDto(r: ResourceRow, extras: { isFavorite?: boolean } = {}): ResourceDto {
  return {
    id: r.id,
    type: r.type,
    code: r.code,
    name: r.name,
    description: r.description,
    status: r.status,
    isBookable: r.isBookable,
    requiresApproval: r.requiresApproval,
    buildingId: r.building.id,
    buildingName: r.building.name,
    buildingTimezone: r.building.timezone,
    floorId: r.floor.id,
    floorName: r.floor.name,
    floorNumber: r.floor.number,
    zoneId: r.zone?.id ?? null,
    zoneName: r.zone?.name ?? null,
    capacity: r.capacity,
    seatType: r.seatType,
    roomType: r.roomType,
    seatAttributes: (r.seatAttributes as ResourceDto['seatAttributes']) ?? null,
    accessible: r.accessible,
    amenities: r.amenities.map((ra) => toAmenityDto(ra.amenity)),
    operatingHours: (r.operatingHours as ResourceDto['operatingHours']) ?? null,
    maxDurationMinutes: r.maxDurationMinutes,
    checkInRequired: r.checkInRequired,
    restrictedDepartmentIds: r.restrictedDepartmentIds,
    restrictedTeamIds: r.restrictedTeamIds,
    mapPosition: r.mapObject
      ? { x: r.mapObject.x, y: r.mapObject.y, width: r.mapObject.width, depth: r.mapObject.depth, rotation: r.mapObject.rotation }
      : null,
    isFavorite: extras.isFavorite,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export type BuildingRow = Prisma.BuildingGetPayload<{
  include: { _count: { select: { floors: true } }; resources: { select: { type: true } } };
}>;

export function toBuildingDto(b: BuildingRow): BuildingDto {
  return {
    id: b.id,
    name: b.name,
    code: b.code,
    addressLine: b.addressLine,
    city: b.city,
    country: b.country,
    timezone: b.timezone,
    isActive: b.isActive,
    description: b.description,
    modelAssetId: b.modelAssetId,
    modelUrl: assetUrl(b.modelAssetId),
    floorCount: b._count.floors,
    seatCount: b.resources.filter((r) => r.type === 'SEAT').length,
    roomCount: b.resources.filter((r) => r.type === 'MEETING_ROOM').length,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

export type FloorRow = Prisma.FloorGetPayload<{
  include: { floorPlan: { select: { status: true; widthM: true; depthM: true } }; resources: { select: { type: true } } };
}>;

export function toFloorDto(f: FloorRow): FloorDto {
  return {
    id: f.id,
    buildingId: f.buildingId,
    name: f.name,
    number: f.number,
    sortOrder: f.sortOrder,
    isPublished: f.isPublished,
    hasFloorPlan: !!f.floorPlan,
    floorPlanStatus: f.floorPlan ? f.floorPlan.status : 'NONE',
    seatCount: f.resources.filter((r) => r.type === 'SEAT').length,
    roomCount: f.resources.filter((r) => r.type === 'MEETING_ROOM').length,
    widthM: f.floorPlan?.widthM ?? null,
    depthM: f.floorPlan?.depthM ?? null,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}

export function toZoneDto(z: { id: string; floorId: string; name: string; kind: ZoneDto['kind']; color: string | null }): ZoneDto {
  return { id: z.id, floorId: z.floorId, name: z.name, kind: z.kind, color: z.color };
}

export function toMapObjectDto(o: {
  id: string;
  kind: MapObjectDto['kind'];
  label: string | null;
  x: number;
  y: number;
  width: number;
  depth: number;
  rotation: number;
  height: number | null;
  resourceId: string | null;
  meta: unknown;
}): MapObjectDto {
  return {
    id: o.id,
    kind: o.kind,
    label: o.label,
    x: o.x,
    y: o.y,
    width: o.width,
    depth: o.depth,
    rotation: o.rotation,
    height: o.height,
    resourceId: o.resourceId,
    meta: (o.meta as Record<string, unknown>) ?? null,
  };
}

export const reservationSummaryInclude = {
  user: { select: { id: true, firstName: true, lastName: true } },
  resource: {
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      building: { select: { id: true, name: true } },
      floor: { select: { id: true, name: true, number: true } },
      zone: { select: { name: true } },
    },
  },
} satisfies Prisma.ReservationInclude;

export type ReservationSummaryRow = Prisma.ReservationGetPayload<{ include: typeof reservationSummaryInclude }>;

export function toReservationSummaryDto(r: ReservationSummaryRow): ReservationSummaryDto {
  return {
    id: r.id,
    resourceId: r.resource.id,
    resourceCode: r.resource.code,
    resourceName: r.resource.name,
    resourceType: r.resource.type,
    type: r.type,
    status: r.status,
    title: r.title,
    startAt: r.startAt.toISOString(),
    endAt: r.endAt.toISOString(),
    timezone: r.timezone,
    isAllDay: r.isAllDay,
    userId: r.user.id,
    userDisplayName: `${r.user.firstName} ${r.user.lastName}`,
    buildingId: r.resource.building.id,
    buildingName: r.resource.building.name,
    floorId: r.resource.floor.id,
    floorName: r.resource.floor.name,
    floorNumber: r.resource.floor.number,
    zoneName: r.resource.zone?.name ?? null,
    seriesId: r.seriesId,
    checkedInAt: r.checkedInAt?.toISOString() ?? null,
    checkedOutAt: r.checkedOutAt?.toISOString() ?? null,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    cancelReason: r.cancelReason,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toUserSummaryDto(u: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  departmentId: string | null;
  teamId: string | null;
  department?: { name: string } | null;
  team?: { name: string } | null;
}): UserSummaryDto {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    displayName: `${u.firstName} ${u.lastName}`,
    avatarUrl: u.avatarUrl,
    jobTitle: u.jobTitle,
    departmentId: u.departmentId,
    departmentName: u.department?.name ?? null,
    teamId: u.teamId,
    teamName: u.team?.name ?? null,
  };
}

export function toNotificationDto(n: {
  id: string;
  type: NotificationDto['type'];
  title: string;
  body: string;
  data: unknown;
  readAt: Date | null;
  createdAt: Date;
}): NotificationDto {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    data: (n.data as Record<string, unknown>) ?? null,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

export function toPolicyDto(p: Prisma.BookingPolicyGetPayload<{ include: { building: { select: { name: true } } } }>): PolicyDto {
  return {
    id: p.id,
    name: p.name,
    buildingId: p.buildingId,
    buildingName: p.building?.name ?? null,
    resourceType: p.resourceType,
    advanceBookingDays: p.advanceBookingDays,
    minDurationMinutes: p.minDurationMinutes,
    maxDurationMinutes: p.maxDurationMinutes,
    slotMinutes: p.slotMinutes,
    maxActiveReservations: p.maxActiveReservations,
    maxDailyBookings: p.maxDailyBookings,
    maxWeeklyBookings: p.maxWeeklyBookings,
    operatingStart: p.operatingStart,
    operatingEnd: p.operatingEnd,
    allowWeekends: p.allowWeekends,
    cancellationDeadlineMinutes: p.cancellationDeadlineMinutes,
    checkInRequired: p.checkInRequired,
    checkInGraceMinutes: p.checkInGraceMinutes,
    checkInOpensMinutesBefore: p.checkInOpensMinutesBefore,
    autoReleaseEnabled: p.autoReleaseEnabled,
    allowRecurring: p.allowRecurring,
    maxRecurringOccurrences: p.maxRecurringOccurrences,
    allowMultiDay: p.allowMultiDay,
    isActive: p.isActive,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function buildSearchText(parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ').toLowerCase();
}
