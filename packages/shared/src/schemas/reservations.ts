import { z } from 'zod';
import { ReservationStatuses, ResourceTypes } from '../enums.js';
import { dateOnlySchema, paginationQuerySchema } from './common.js';

export const recurrenceRuleSchema = z.object({
  frequency: z.enum(['DAILY', 'WEEKLY']),
  interval: z.number().int().min(1).max(4).default(1),
  /** 0..6 Sunday..Saturday; only for WEEKLY */
  byWeekday: z.array(z.number().int().min(0).max(6)).optional(),
  /** Inclusive end date (YYYY-MM-DD, in the building timezone). */
  until: dateOnlySchema.optional(),
  count: z.number().int().min(1).max(52).optional(),
});
export type RecurrenceRule = z.infer<typeof recurrenceRuleSchema>;

export const attendeeSchema = z.object({
  userId: z.string().uuid().optional(),
  email: z.string().email().optional(),
  name: z.string().max(100).optional(),
});
export type AttendeeInput = z.infer<typeof attendeeSchema>;

export const reservationCreateSchema = z
  .object({
    resourceId: z.string().uuid(),
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
    title: z.string().max(120).optional(),
    description: z.string().max(1000).optional(),
    attendees: z.array(attendeeSchema).max(100).optional(),
    setupNotes: z.string().max(500).optional(),
    isAllDay: z.boolean().optional(),
    recurrence: recurrenceRuleSchema.optional(),
    /** Additional dates (YYYY-MM-DD) for multi-day bookings using the same time window. */
    additionalDates: z.array(dateOnlySchema).max(31).optional(),
    /** When true, the whole batch fails if any occurrence conflicts. */
    atomic: z.boolean().default(true),
    /** Admin only: book on behalf of another user. */
    onBehalfOfUserId: z.string().uuid().optional(),
  })
  .refine((v) => new Date(v.endAt) > new Date(v.startAt), {
    message: 'End time must be after start time',
    path: ['endAt'],
  });
export type ReservationCreateInput = z.infer<typeof reservationCreateSchema>;

export const reservationUpdateSchema = z
  .object({
    startAt: z.string().datetime({ offset: true }).optional(),
    endAt: z.string().datetime({ offset: true }).optional(),
    title: z.string().max(120).optional(),
    description: z.string().max(1000).nullable().optional(),
    attendees: z.array(attendeeSchema).max(100).optional(),
    setupNotes: z.string().max(500).nullable().optional(),
    resourceId: z.string().uuid().optional(),
  })
  .refine((v) => !(v.startAt && v.endAt) || new Date(v.endAt) > new Date(v.startAt), {
    message: 'End time must be after start time',
    path: ['endAt'],
  });
export type ReservationUpdateInput = z.infer<typeof reservationUpdateSchema>;

export const reservationCancelSchema = z.object({
  reason: z.string().max(300).optional(),
  /** Cancel every future occurrence of the series as well. */
  cancelSeries: z.boolean().optional(),
});

export const checkInSchema = z.object({
  /** QR / confirmation code. Optional when the owner checks in from their own device. */
  code: z.string().max(40).optional(),
});

export const reservationListQuerySchema = paginationQuerySchema.extend({
  scope: z.enum(['upcoming', 'ongoing', 'past', 'cancelled', 'all']).default('all'),
  type: z.enum(ResourceTypes).optional(),
  status: z.enum(ReservationStatuses).optional(),
  buildingId: z.string().uuid().optional(),
  floorId: z.string().uuid().optional(),
  resourceId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  q: z.string().max(100).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});
export type ReservationListQuery = z.infer<typeof reservationListQuerySchema>;

export const approvalDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().max(300).optional(),
});

export const favoriteCreateSchema = z.object({ resourceId: z.string().uuid() });
