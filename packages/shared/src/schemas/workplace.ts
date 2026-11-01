import { z } from 'zod';
import {
  MapObjectKinds,
  ResourceStatuses,
  ResourceTypes,
  RoomTypes,
  SeatTypes,
  ZoneKinds,
} from '../enums.js';
import {
  boolQuery,
  csvList,
  dateOnlySchema,
  paginationQuerySchema,
  timeOnlySchema,
} from './common.js';

export const operatingHoursDaySchema = z
  .object({ open: timeOnlySchema, close: timeOnlySchema })
  .nullable();
/** Keys 0..6 (Sunday..Saturday). Missing key = closed. */
export const operatingHoursSchema = z.record(z.string().regex(/^[0-6]$/), operatingHoursDaySchema);
export type OperatingHours = z.infer<typeof operatingHoursSchema>;

export const seatAttributesSchema = z.object({
  nearWindow: z.boolean().optional(),
  nearElevator: z.boolean().optional(),
  monitor: z.boolean().optional(),
  dualMonitor: z.boolean().optional(),
  dockingStation: z.boolean().optional(),
  heightAdjustable: z.boolean().optional(),
  accessible: z.boolean().optional(),
  quietZone: z.boolean().optional(),
});
export type SeatAttributes = z.infer<typeof seatAttributesSchema>;

export const buildingCreateSchema = z.object({
  name: z.string().min(1).max(100),
  code: z
    .string()
    .min(1)
    .max(20)
    .regex(/^[A-Z0-9-]+$/i),
  addressLine: z.string().max(200).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  country: z.string().max(100).optional().nullable(),
  timezone: z.string().min(1).max(64),
  isActive: z.boolean().default(true),
  description: z.string().max(500).optional().nullable(),
});
export const buildingUpdateSchema = buildingCreateSchema.partial();
export type BuildingInput = z.infer<typeof buildingCreateSchema>;

export const floorCreateSchema = z.object({
  name: z.string().min(1).max(60),
  number: z.number().int().min(-10).max(200),
  isPublished: z.boolean().default(false),
});
export const floorUpdateSchema = floorCreateSchema.partial().extend({
  sortOrder: z.number().int().optional(),
});
export const floorReorderSchema = z.object({ floorIds: z.array(z.string().uuid()).min(1) });

export const zoneCreateSchema = z.object({
  name: z.string().min(1).max(60),
  kind: z.enum(ZoneKinds).default('GENERAL'),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional()
    .nullable(),
});
export const zoneUpdateSchema = zoneCreateSchema.partial();

export const resourceBaseSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(100),
  floorId: z.string().uuid(),
  zoneId: z.string().uuid().nullable().optional(),
  status: z.enum(ResourceStatuses).default('ACTIVE'),
  isBookable: z.boolean().default(true),
  requiresApproval: z.boolean().default(false),
  description: z.string().max(500).nullable().optional(),
  amenityIds: z.array(z.string().uuid()).optional(),
  restrictedDepartmentIds: z.array(z.string().uuid()).optional(),
  restrictedTeamIds: z.array(z.string().uuid()).optional(),
  operatingHours: operatingHoursSchema.nullable().optional(),
  maxDurationMinutes: z
    .number()
    .int()
    .min(15)
    .max(24 * 60)
    .nullable()
    .optional(),
  checkInRequired: z.boolean().nullable().optional(),
});
export const seatCreateSchema = resourceBaseSchema.extend({
  seatAttributes: seatAttributesSchema.optional(),
  seatType: z.enum(SeatTypes).default('WORKSTATION'),
});
export const seatUpdateSchema = seatCreateSchema.partial();
export type SeatInput = z.infer<typeof seatCreateSchema>;
export const roomCreateSchema = resourceBaseSchema.extend({
  capacity: z.number().int().min(1).max(500),
  roomType: z.enum(RoomTypes).default('MEETING'),
  accessible: z.boolean().optional(),
});
export const roomUpdateSchema = roomCreateSchema.partial();
export type RoomInput = z.infer<typeof roomCreateSchema>;

export const bulkResourceUpdateSchema = z.object({
  resourceIds: z.array(z.string().uuid()).min(1).max(500),
  patch: z.object({
    status: z.enum(ResourceStatuses).optional(),
    zoneId: z.string().uuid().nullable().optional(),
    requiresApproval: z.boolean().optional(),
    isBookable: z.boolean().optional(),
    addAmenityIds: z.array(z.string().uuid()).optional(),
    removeAmenityIds: z.array(z.string().uuid()).optional(),
  }),
});

export const resourceListQuerySchema = paginationQuerySchema.extend({
  type: z.enum(ResourceTypes).optional(),
  buildingId: z.string().uuid().optional(),
  floorId: z.string().uuid().optional(),
  zoneId: z.string().uuid().optional(),
  status: z.enum(ResourceStatuses).optional(),
  q: z.string().max(100).optional(),
  amenityIds: csvList.optional(),
  minCapacity: z.coerce.number().int().min(1).optional(),
  nearWindow: boolQuery.optional(),
  nearElevator: boolQuery.optional(),
  monitor: boolQuery.optional(),
  dockingStation: boolQuery.optional(),
  heightAdjustable: boolQuery.optional(),
  accessible: boolQuery.optional(),
  quietZone: boolQuery.optional(),
  nearTeam: boolQuery.optional(),
  availableOnly: boolQuery.optional(),
  startAt: z.string().datetime({ offset: true }).optional(),
  endAt: z.string().datetime({ offset: true }).optional(),
  sortBy: z.enum(['code', 'name', 'capacity', 'createdAt']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});
export type ResourceListQuery = z.infer<typeof resourceListQuerySchema>;

export const availabilityQuerySchema = z.object({
  floorId: z.string().uuid().optional(),
  buildingId: z.string().uuid().optional(),
  resourceIds: csvList.optional(),
  type: z.enum(ResourceTypes).optional(),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

export const resourceAvailabilityQuerySchema = z.object({
  date: dateOnlySchema,
  slotMinutes: z.coerce.number().int().min(15).max(240).optional(),
});

export const mapObjectSchema = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(MapObjectKinds),
  label: z.string().max(60).nullable().optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  depth: z.number().positive(),
  rotation: z.number().default(0),
  height: z.number().positive().nullable().optional(),
  resourceId: z.string().uuid().nullable().optional(),
  resourceCode: z.string().max(30).nullable().optional(),
  meta: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type MapObjectInput = z.infer<typeof mapObjectSchema>;

export const floorPlanUpsertSchema = z.object({
  widthM: z.number().positive().max(1000),
  depthM: z.number().positive().max(1000),
  objects: z.array(mapObjectSchema).max(5000),
  imageAssetId: z.string().uuid().nullable().optional(),
  modelAssetId: z.string().uuid().nullable().optional(),
});
export type FloorPlanUpsertInput = z.infer<typeof floorPlanUpsertSchema>;

export const amenityCreateSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_-]+$/i),
  name: z.string().min(1).max(80),
  category: z.enum(['SEAT', 'ROOM', 'BOTH']).default('BOTH'),
  icon: z.string().max(40).optional().nullable(),
});
export const amenityUpdateSchema = amenityCreateSchema.partial();

export const maintenanceWindowSchema = z.object({
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  reason: z.string().max(200).optional().nullable(),
});

export const searchQuerySchema = z.object({
  q: z.string().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const suggestSeatsQuerySchema = z.object({
  buildingId: z.string().uuid().optional(),
  floorId: z.string().uuid().optional(),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});
