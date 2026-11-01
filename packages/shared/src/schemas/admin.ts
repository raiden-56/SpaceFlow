import { z } from 'zod';
import { IntegrationProviders, ResourceTypes, RoleCodes, SeatTypes, UserStatuses } from '../enums.js';
import { dateOnlySchema, paginationQuerySchema, timeOnlySchema } from './common.js';
import { passwordSchema } from './auth.js';

export const policySchema = z.object({
  name: z.string().min(1).max(80),
  buildingId: z.string().uuid().nullable().optional(),
  resourceType: z.enum(ResourceTypes).nullable().optional(),
  advanceBookingDays: z.number().int().min(0).max(365).default(30),
  minDurationMinutes: z
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .default(30),
  maxDurationMinutes: z
    .number()
    .int()
    .min(15)
    .max(24 * 60)
    .default(10 * 60),
  slotMinutes: z.number().int().min(5).max(240).default(30),
  maxActiveReservations: z.number().int().min(1).max(100).default(10),
  maxDailyBookings: z.number().int().min(1).max(50).default(3),
  maxWeeklyBookings: z.number().int().min(1).max(200).default(15),
  operatingStart: timeOnlySchema.default('07:00'),
  operatingEnd: timeOnlySchema.default('20:00'),
  allowWeekends: z.boolean().default(false),
  cancellationDeadlineMinutes: z
    .number()
    .int()
    .min(0)
    .max(24 * 60)
    .default(0),
  checkInRequired: z.boolean().default(true),
  checkInGraceMinutes: z.number().int().min(0).max(240).default(30),
  checkInOpensMinutesBefore: z.number().int().min(0).max(240).default(15),
  autoReleaseEnabled: z.boolean().default(true),
  allowRecurring: z.boolean().default(true),
  maxRecurringOccurrences: z.number().int().min(1).max(52).default(12),
  allowMultiDay: z.boolean().default(true),
  isActive: z.boolean().default(true),
});
export const policyUpdateSchema = policySchema.partial();
export type PolicyInput = z.infer<typeof policySchema>;

export const userCreateSchema = z.object({
  email: z.string().email().max(254),
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  roles: z.array(z.enum(RoleCodes)).min(1).default(['EMPLOYEE']),
  departmentId: z.string().uuid().nullable().optional(),
  teamId: z.string().uuid().nullable().optional(),
  homeBuildingId: z.string().uuid().nullable().optional(),
  jobTitle: z.string().max(80).nullable().optional(),
  /** When provided the account is active immediately; otherwise an invitation is issued. */
  password: passwordSchema.optional(),
});
export const userUpdateSchema = userCreateSchema
  .omit({ password: true })
  .partial()
  .extend({ status: z.enum(UserStatuses).optional() });

export const userListQuerySchema = paginationQuerySchema.extend({
  q: z.string().max(100).optional(),
  departmentId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  role: z.enum(RoleCodes).optional(),
  status: z.enum(UserStatuses).optional(),
});

export const departmentSchema = z.object({ name: z.string().min(1).max(80) });
export const teamSchema = z.object({
  name: z.string().min(1).max(80),
  departmentId: z.string().uuid(),
});

export const analyticsQuerySchema = z.object({
  buildingId: z.string().uuid().optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});

export const auditQuerySchema = paginationQuerySchema.extend({
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(60).optional(),
  actorId: z.string().uuid().optional(),
  action: z.string().max(60).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export const integrationUpdateSchema = z.object({
  provider: z.enum(IntegrationProviders),
  isEnabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const announcementSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(2000),
  buildingId: z.string().uuid().nullable().optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export const orgSettingsSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  timezone: z.string().min(1).max(64).optional(),
  settings: z
    .object({
      allowTeamLocationSharing: z.boolean().optional(),
      defaultView: z.enum(['3D', '2D', 'LIST']).optional(),
      workingDays: z.array(z.number().int().min(0).max(6)).optional(),
    })
    .optional(),
});

export const adminCancelSchema = z.object({ reason: z.string().min(3).max(300) });

const csvBool = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => v === true || (typeof v === 'string' && /^(true|1|yes|y)$/i.test(v.trim())));

export const seatCsvRowSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(100),
  floorNumber: z.coerce.number().int(),
  zone: z.string().max(60).optional(),
  seatType: z.enum(SeatTypes).optional(),
  x: z.coerce.number().optional(),
  y: z.coerce.number().optional(),
  nearWindow: csvBool,
  nearElevator: csvBool,
  monitor: csvBool,
  dockingStation: csvBool,
  heightAdjustable: csvBool,
  accessible: csvBool,
  quietZone: csvBool,
  amenities: z.string().optional(),
});
export type SeatCsvRow = z.infer<typeof seatCsvRowSchema>;

export const roomCsvRowSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(100),
  floorNumber: z.coerce.number().int(),
  capacity: z.coerce.number().int().min(1),
  roomType: z.string().optional(),
  x: z.coerce.number().optional(),
  y: z.coerce.number().optional(),
  width: z.coerce.number().optional(),
  depth: z.coerce.number().optional(),
  requiresApproval: csvBool,
  accessible: csvBool,
  amenities: z.string().optional(),
});
