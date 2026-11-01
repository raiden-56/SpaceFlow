// Booking engine. All reservation operations go through here so availability + policy rules are
// applied identically. Conflict protection is layered:
//   1. A pre-check inside the transaction (friendly error + alternatives).
//   2. The PostgreSQL exclusion constraint `reservations_no_overlap` (authoritative; catches races).
import type { Prisma, Reservation, ReservationStatus, Resource } from '@prisma/client';
import type {
  BatchReservationResultDto,
  ConflictAlternativeDto,
  Paginated,
  RecurrenceRule,
  ReservationCreateInput,
  ReservationDto,
  ReservationListQuery,
  ReservationSummaryDto,
  ReservationUpdateInput,
} from '@spaceflow/shared';
import { AppError } from '../../lib/errors.js';
import { isExclusionViolation, prisma, type Tx } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import type { AuthUser } from '../../middleware/auth.js';
import { shortCode } from '../../utils/crypto.js';
import {
  addDays,
  dayjs,
  endOfLocalDay,
  formatRange,
  fromLocal,
  localDate,
  localTime,
  minutesBetween,
  startOfLocalDay,
  startOfLocalWeek,
} from '../../utils/time.js';
import {
  resourceInclude,
  reservationSummaryInclude,
  toReservationSummaryDto,
  toResourceDto,
  type ResourceRow,
} from '../../utils/mappers.js';
import { paginate, skipTake } from '../../utils/pagination.js';
import { resolvePolicy, type EffectivePolicy } from '../policies/service.js';
import { ACTIVE_STATUSES, checkOperatingHours, computeAvailability, userCanAccessResource } from '../availability/service.js';
import { notify } from '../notifications/service.js';
import { broadcastToOrg } from '../../realtime/sse.js';
import { removeReservationFromCalendars, syncReservationToCalendars } from '../../integrations/calendar.js';
import { logger } from '../../lib/logger.js';

type CancelInput = { reason?: string; cancelSeries?: boolean };
// Re-export for consumers that only import types from here.
export type { CancelInput as ReservationCancelSchemaInput };

const reservationDetailInclude = {
  ...reservationSummaryInclude,
  attendees: true,
  approval: { include: { approver: { select: { firstName: true, lastName: true } } } },
  resource: {
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      capacity: true,
      checkInRequired: true,
      orgId: true,
      buildingId: true,
      building: { select: { id: true, name: true, timezone: true } },
      floor: { select: { id: true, name: true, number: true } },
      zone: { select: { name: true } },
      mapObject: { select: { x: true, y: true } },
    },
  },
} satisfies Prisma.ReservationInclude;

type ReservationDetailRow = Prisma.ReservationGetPayload<{ include: typeof reservationDetailInclude }>;

const ACTIVE: ReservationStatus[] = [...ACTIVE_STATUSES];

// ---------------------------------------------------------------------------
// Occurrence expansion (recurring + multi-day)
// ---------------------------------------------------------------------------

export interface Occurrence {
  startAt: Date;
  endAt: Date;
}

export function expandOccurrences(
  startAt: Date,
  endAt: Date,
  tz: string,
  recurrence: RecurrenceRule | undefined,
  additionalDates: string[] | undefined,
  maxOccurrences: number,
): Occurrence[] {
  const baseDate = localDate(startAt, tz);
  const startTime = localTime(startAt, tz);
  const endTime = localTime(endAt, tz);
  const durationMs = endAt.getTime() - startAt.getTime();
  const dates = new Set<string>([baseDate]);

  if (recurrence) {
    const until = recurrence.until ?? null;
    const count = recurrence.count ?? maxOccurrences;
    let cursor = baseDate;
    let produced = 1;
    let guard = 0;
    while (produced < count && guard++ < 400) {
      cursor = addDays(cursor, recurrence.frequency === 'DAILY' ? recurrence.interval : 1);
      if (until && cursor > until) break;
      if (recurrence.frequency === 'WEEKLY') {
        const wd = dayjs(cursor, 'YYYY-MM-DD').day();
        const allowed = recurrence.byWeekday?.length ? recurrence.byWeekday : [dayjs(baseDate, 'YYYY-MM-DD').day()];
        if (!allowed.includes(wd)) continue;
        // interval > 1 for weekly: skip weeks not on the cadence
        const weeksApart = Math.floor(dayjs(cursor, 'YYYY-MM-DD').diff(dayjs(baseDate, 'YYYY-MM-DD'), 'day') / 7);
        if (weeksApart % recurrence.interval !== 0) continue;
      }
      if (!dates.has(cursor)) {
        dates.add(cursor);
        produced++;
      }
    }
  }
  for (const d of additionalDates ?? []) dates.add(d);

  return [...dates]
    .sort()
    .map((d) => {
      const s = fromLocal(d, startTime, tz);
      // Keep the same wall-clock end time; fall back to duration if DST makes it invalid.
      let e = fromLocal(d, endTime, tz);
      if (e <= s) e = new Date(s.getTime() + durationMs);
      return { startAt: s, endAt: e };
    });
}

// ---------------------------------------------------------------------------
// Policy validation
// ---------------------------------------------------------------------------

type ResourceWithRelations = Resource & {
  building: { id: string; name: string; timezone: string; isActive: boolean };
  floor: { id: string; name: string; number: number; isPublished: boolean };
};

interface ValidationContext {
  user: AuthUser;
  bookingFor: string; // user id the reservation belongs to
  resource: ResourceWithRelations;
  policy: EffectivePolicy;
  now: Date;
  tx: Tx;
  excludeReservationId?: string;
  attendeeCount: number;
  isAdmin: boolean;
}

async function validateOccurrence(ctx: ValidationContext, occ: Occurrence) {
  const { resource, policy, now, tx } = ctx;
  const tz = resource.building.timezone;
  const duration = minutesBetween(occ.startAt, occ.endAt);

  if (occ.endAt <= occ.startAt) throw AppError.invalidTime('End time must be after start time.');
  if (occ.endAt <= now) throw AppError.invalidTime('The selected time is in the past.');
  if (occ.startAt < new Date(now.getTime() - 15 * 60000) && !ctx.isAdmin) {
    throw AppError.invalidTime('Bookings cannot start in the past.');
  }
  const minDur = policy.minDurationMinutes;
  const maxDur = Math.min(policy.maxDurationMinutes, resource.maxDurationMinutes ?? Infinity);
  if (duration < minDur) throw AppError.policy(`Minimum booking duration is ${minDur} minutes.`);
  if (duration > maxDur) throw AppError.policy(`Maximum booking duration is ${maxDur} minutes.`);

  const advanceLimit = new Date(now.getTime() + policy.advanceBookingDays * 86400000);
  if (occ.startAt > advanceLimit && !ctx.isAdmin) {
    throw AppError.policy(`Bookings can be made at most ${policy.advanceBookingDays} days in advance.`);
  }

  const hours = checkOperatingHours(resource, policy, occ.startAt, occ.endAt, tz);
  if (!hours.ok) throw AppError.policy(hours.reason);

  if (resource.type === 'MEETING_ROOM' && resource.capacity && ctx.attendeeCount + 1 > resource.capacity) {
    throw AppError.policy(`This room seats ${resource.capacity} people; you listed ${ctx.attendeeCount + 1}.`);
  }

  const maintenance = await tx.maintenanceWindow.findFirst({
    where: { resourceId: resource.id, startAt: { lt: occ.endAt }, endAt: { gt: occ.startAt } },
  });
  if (maintenance) {
    throw AppError.unavailable(
      `The resource is under maintenance ${formatRange(maintenance.startAt, maintenance.endAt, tz)}.`,
    );
  }

  // Per-user limits (skip for admin acting on behalf of someone else)
  if (!ctx.isAdmin) {
    const activeCount = await tx.reservation.count({
      where: { userId: ctx.bookingFor, status: { in: ACTIVE }, endAt: { gt: now }, ...(ctx.excludeReservationId ? { id: { not: ctx.excludeReservationId } } : {}) },
    });
    if (activeCount >= policy.maxActiveReservations) {
      throw AppError.policy(`You already have ${activeCount} active reservations (limit ${policy.maxActiveReservations}).`);
    }
    const day = localDate(occ.startAt, tz);
    const dailyCount = await tx.reservation.count({
      where: {
        userId: ctx.bookingFor,
        type: resource.type,
        status: { in: ACTIVE },
        startAt: { gte: startOfLocalDay(day, tz), lt: endOfLocalDay(day, tz) },
        ...(ctx.excludeReservationId ? { id: { not: ctx.excludeReservationId } } : {}),
      },
    });
    if (dailyCount >= policy.maxDailyBookings) {
      throw AppError.policy(
        `Daily limit reached: at most ${policy.maxDailyBookings} ${resource.type === 'SEAT' ? 'seat' : 'room'} bookings per day.`,
      );
    }
    const weekStart = startOfLocalWeek(occ.startAt, tz);
    const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);
    const weeklyCount = await tx.reservation.count({
      where: {
        userId: ctx.bookingFor,
        type: resource.type,
        status: { in: ACTIVE },
        startAt: { gte: weekStart, lt: weekEnd },
        ...(ctx.excludeReservationId ? { id: { not: ctx.excludeReservationId } } : {}),
      },
    });
    if (weeklyCount >= policy.maxWeeklyBookings) {
      throw AppError.policy(`Weekly limit reached: at most ${policy.maxWeeklyBookings} bookings per week.`);
    }
    // A user cannot hold two seats at the same time.
    if (resource.type === 'SEAT') {
      const otherSeat = await tx.reservation.findFirst({
        where: {
          userId: ctx.bookingFor,
          type: 'SEAT',
          status: { in: ACTIVE },
          startAt: { lt: occ.endAt },
          endAt: { gt: occ.startAt },
          ...(ctx.excludeReservationId ? { id: { not: ctx.excludeReservationId } } : {}),
        },
        include: { resource: { select: { code: true } } },
      });
      if (otherSeat) {
        throw AppError.policy(`You already have seat ${otherSeat.resource.code} booked for an overlapping time.`);
      }
    }
  }

  // Friendly conflict pre-check (the DB constraint is the final authority).
  const conflict = await tx.reservation.findFirst({
    where: {
      resourceId: resource.id,
      status: { in: ACTIVE },
      startAt: { lt: occ.endAt },
      endAt: { gt: occ.startAt },
      ...(ctx.excludeReservationId ? { id: { not: ctx.excludeReservationId } } : {}),
    },
    select: { id: true, startAt: true, endAt: true, userId: true },
  });
  if (conflict) {
    throw AppError.bookingConflict(
      `${resource.name} is already reserved ${formatRange(conflict.startAt, conflict.endAt, tz)}.`,
      { conflictingReservationId: conflict.id, isMine: conflict.userId === ctx.bookingFor },
    );
  }
}

async function loadResource(resourceId: string, orgId: string, tx: Tx | typeof prisma): Promise<ResourceWithRelations> {
  const resource = await tx.resource.findFirst({
    where: { id: resourceId, orgId, deletedAt: null },
    include: {
      building: { select: { id: true, name: true, timezone: true, isActive: true } },
      floor: { select: { id: true, name: true, number: true, isPublished: true } },
    },
  });
  if (!resource) throw AppError.notFound('Resource');
  return resource;
}

function assertResourceBookable(resource: ResourceWithRelations, user: AuthUser, isAdmin: boolean) {
  if (resource.status !== 'ACTIVE') throw AppError.unavailable(`${resource.name} is currently ${resource.status.toLowerCase()}.`);
  if (!resource.isBookable) throw AppError.unavailable(`${resource.name} is not bookable.`);
  if (!resource.building.isActive) throw AppError.unavailable('This building is inactive.');
  if (!resource.floor.isPublished && !isAdmin) throw AppError.unavailable('This floor is not published yet.');
  if (!userCanAccessResource(resource, user)) {
    throw AppError.forbidden(`${resource.name} is reserved for a specific department or team.`);
  }
}

// ---------------------------------------------------------------------------
// Alternatives
// ---------------------------------------------------------------------------

export async function findAlternatives(
  orgId: string,
  resource: Pick<Resource, 'id' | 'floorId' | 'buildingId' | 'type' | 'capacity'>,
  startAt: Date,
  endAt: Date,
  user: AuthUser | undefined,
  limit = 3,
): Promise<ConflictAlternativeDto[]> {
  const candidates = await prisma.resource.findMany({
    where: {
      orgId,
      id: { not: resource.id },
      type: resource.type,
      status: 'ACTIVE',
      isBookable: true,
      deletedAt: null,
      floor: { isPublished: true },
      ...(resource.type === 'MEETING_ROOM' && resource.capacity ? { capacity: { gte: Math.max(1, Math.floor(resource.capacity * 0.6)) } } : {}),
      OR: [{ floorId: resource.floorId }, { buildingId: resource.buildingId }],
    },
    include: { ...resourceInclude, floor: { select: { id: true, name: true, number: true, isPublished: true } }, building: { select: { id: true, name: true, timezone: true, isActive: true } } },
    take: 60,
  });
  // Prefer same floor
  candidates.sort((a, b) => Number(b.floorId === resource.floorId) - Number(a.floorId === resource.floorId));
  const availability = await computeAvailability(candidates, { startAt, endAt, user });
  const out: ConflictAlternativeDto[] = [];
  for (const c of candidates) {
    if (availability.get(c.id)?.state === 'AVAILABLE') {
      out.push({ resource: toResourceDto(c as unknown as ResourceRow), startAt: startAt.toISOString(), endAt: endAt.toISOString() });
      if (out.length >= limit) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createReservations(
  user: AuthUser,
  input: ReservationCreateInput,
  meta: { ip?: string | null } = {},
): Promise<BatchReservationResultDto> {
  const isAdmin = user.permissions.includes('reservation:manage-any');
  const bookingFor = input.onBehalfOfUserId && isAdmin ? input.onBehalfOfUserId : user.id;
  if (input.onBehalfOfUserId && !isAdmin) throw AppError.forbidden('Only administrators can book on behalf of others.');
  const now = new Date();

  const resource = await loadResource(input.resourceId, user.orgId, prisma);
  assertResourceBookable(resource, user, isAdmin);
  const policy = await resolvePolicy(user.orgId, resource.buildingId, resource.type);
  const tz = resource.building.timezone;

  if (input.recurrence && !policy.allowRecurring) throw AppError.policy('Recurring bookings are not allowed by policy.');
  if (input.additionalDates?.length && !policy.allowMultiDay) throw AppError.policy('Multi-day bookings are not allowed by policy.');

  const occurrences = expandOccurrences(
    new Date(input.startAt),
    new Date(input.endAt),
    tz,
    input.recurrence,
    input.additionalDates,
    policy.maxRecurringOccurrences,
  );
  if (occurrences.length > policy.maxRecurringOccurrences) {
    throw AppError.policy(`At most ${policy.maxRecurringOccurrences} occurrences can be booked at once.`);
  }

  const attendees = (input.attendees ?? []).filter((a) => a.userId || a.email);
  const status: ReservationStatus = resource.requiresApproval ? 'PENDING_APPROVAL' : 'CONFIRMED';
  const seriesRule = input.recurrence ? { ...input.recurrence } : occurrences.length > 1 ? { frequency: 'MULTI_DAY', dates: occurrences.map((o) => localDate(o.startAt, tz)) } : null;

  const created: Reservation[] = [];
  const failed: BatchReservationResultDto['failed'] = [];
  let seriesId: string | null = null;

  const insertOne = async (tx: Tx, occ: Occurrence, sid: string | null) => {
    await validateOccurrence({ user, bookingFor, resource, policy, now, tx, attendeeCount: attendees.length, isAdmin }, occ);
    const row = await tx.reservation.create({
      data: {
        orgId: user.orgId,
        resourceId: resource.id,
        userId: bookingFor,
        createdById: user.id,
        type: resource.type,
        status,
        title: input.title ?? (resource.type === 'SEAT' ? `Desk ${resource.code}` : input.title ?? null),
        description: input.description ?? null,
        setupNotes: input.setupNotes ?? null,
        startAt: occ.startAt,
        endAt: occ.endAt,
        timezone: tz,
        isAllDay: input.isAllDay ?? false,
        seriesId: sid,
        checkInCode: shortCode(),
        attendees: attendees.length
          ? { create: attendees.map((a) => ({ userId: a.userId ?? null, email: a.email ?? null, name: a.name ?? null })) }
          : undefined,
        approval: resource.requiresApproval ? { create: { requestedById: user.id } } : undefined,
      },
    });
    return row;
  };

  const wrapError = (err: unknown): { code: string; message: string } => {
    if (isExclusionViolation(err)) {
      return { code: 'BOOKING_CONFLICT', message: `${resource.name} was just booked by someone else for an overlapping time.` };
    }
    if (err instanceof AppError) return { code: err.code, message: err.message };
    throw err;
  };

  if (input.atomic !== false) {
    try {
      await prisma.$transaction(
        async (tx) => {
          if (seriesRule) {
            const series = await tx.reservationSeries.create({ data: { rule: seriesRule as object } });
            seriesId = series.id;
          }
          for (const occ of occurrences) created.push(await insertOne(tx, occ, seriesId));
        },
        { isolationLevel: 'ReadCommitted', timeout: 20000 },
      );
    } catch (err) {
      created.length = 0;
      const e = wrapError(err);
      // Attribute failure to the first conflicting occurrence when possible.
      const failing = occurrences.find((o) => e.message.includes(dayjs(o.startAt).tz(tz).format('ddd D MMM'))) ?? occurrences[0];
      failed.push({ startAt: failing.startAt.toISOString(), endAt: failing.endAt.toISOString(), ...e });
      if (err instanceof AppError && err.code === 'BOOKING_CONFLICT' && occurrences.length === 1) {
        const alternatives = await findAlternatives(user.orgId, resource, occurrences[0].startAt, occurrences[0].endAt, user);
        throw new AppError(409, 'BOOKING_CONFLICT', err.message, { ...(err.details as object), alternatives });
      }
      if (isExclusionViolation(err) && occurrences.length === 1) {
        const alternatives = await findAlternatives(user.orgId, resource, occurrences[0].startAt, occurrences[0].endAt, user);
        throw AppError.bookingConflict(e.message, { alternatives });
      }
      if (err instanceof AppError && occurrences.length === 1) throw err;
      return { created: [], failed, seriesId: null, atomic: true };
    }
  } else {
    if (seriesRule) {
      const series = await prisma.reservationSeries.create({ data: { rule: seriesRule as object } });
      seriesId = series.id;
    }
    for (const occ of occurrences) {
      try {
        const row = await prisma.$transaction((tx) => insertOne(tx, occ, seriesId), { timeout: 20000 });
        created.push(row);
      } catch (err) {
        failed.push({ startAt: occ.startAt.toISOString(), endAt: occ.endAt.toISOString(), ...wrapError(err) });
      }
    }
    if (!created.length && seriesId) await prisma.reservationSeries.delete({ where: { id: seriesId } }).catch(() => undefined);
  }

  // Post-commit side effects
  if (created.length) {
    await afterBookingCreated(user, resource, created, bookingFor, meta.ip ?? null);
  }

  const dtos = await Promise.all(created.map((r) => getReservation(user, r.id)));
  return { created: dtos, failed, seriesId, atomic: input.atomic !== false };
}

async function afterBookingCreated(
  actor: AuthUser,
  resource: ResourceWithRelations,
  rows: Reservation[],
  bookingFor: string,
  ip: string | null,
) {
  const tz = resource.building.timezone;
  const first = rows[0];
  const label = resource.type === 'SEAT' ? 'Seat' : 'Meeting room';
  const where = `${resource.building.name}, ${resource.floor.name}`;
  const multi = rows.length > 1 ? ` (+${rows.length - 1} more)` : '';

  await notify({
    userId: bookingFor,
    type: first.status === 'PENDING_APPROVAL' ? 'APPROVAL_REQUESTED' : 'BOOKING_CONFIRMED',
    title: first.status === 'PENDING_APPROVAL' ? `${label} booking awaiting approval` : `${label} booked: ${resource.name}`,
    body: `${resource.name} · ${where} · ${formatRange(first.startAt, first.endAt, tz)}${multi}`,
    data: { reservationId: first.id, resourceId: resource.id, floorId: resource.floorId, buildingId: resource.buildingId },
    email: true,
  });

  if (first.status === 'PENDING_APPROVAL') {
    const approvers = await prisma.user.findMany({
      where: { orgId: actor.orgId, status: 'ACTIVE', roles: { some: { role: { code: { in: ['APPROVER', 'WORKPLACE_ADMIN', 'ORG_ADMIN'] } } } } },
      select: { id: true },
    });
    for (const a of approvers) {
      if (a.id === bookingFor) continue;
      await notify({
        userId: a.id,
        type: 'APPROVAL_REQUESTED',
        title: `Approval needed: ${resource.name}`,
        body: `${formatRange(first.startAt, first.endAt, tz)} · requested by ${actor.email}`,
        data: { reservationId: first.id, resourceId: resource.id },
      });
    }
  }

  for (const r of rows) {
    await audit({ orgId: actor.orgId, actorId: actor.id, action: 'reservation.create', entityType: 'Reservation', entityId: r.id, after: r, ip });
  }
  broadcastToOrg(actor.orgId, 'availability.changed', {
    resourceIds: [resource.id],
    floorId: resource.floorId,
    buildingId: resource.buildingId,
    reservationIds: rows.map((r) => r.id),
  });

  if (resource.type === 'MEETING_ROOM' && first.status === 'CONFIRMED') {
    const owner = await prisma.user.findUnique({ where: { id: bookingFor }, select: { email: true } });
    const attendees = await prisma.reservationAttendee.findMany({ where: { reservationId: first.id } });
    if (owner) {
      void syncReservationToCalendars(actor.orgId, {
        reservationId: first.id,
        title: first.title ?? resource.name,
        description: first.description ?? '',
        location: `${resource.name}, ${where}`,
        startAt: first.startAt,
        endAt: first.endAt,
        timezone: tz,
        organizerEmail: owner.email,
        attendeeEmails: attendees.map((a) => a.email).filter((e): e is string => !!e),
      }).catch((err) => logger.warn({ err }, 'calendar sync error'));
    }
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

function canView(user: AuthUser, row: { userId: string; attendees?: { userId: string | null }[] }): boolean {
  if (row.userId === user.id) return true;
  if (user.permissions.includes('reservation:manage-any') || user.permissions.includes('reservation:approve')) return true;
  return !!row.attendees?.some((a) => a.userId === user.id);
}

export async function toReservationDto(row: ReservationDetailRow, viewer: AuthUser): Promise<ReservationDto> {
  const resource = row.resource;
  const policy = await resolvePolicy(resource.orgId, resource.buildingId, resource.type);
  const now = new Date();
  const checkInRequired = resource.checkInRequired ?? policy.checkInRequired;
  const checkInOpensAt = new Date(row.startAt.getTime() - policy.checkInOpensMinutesBefore * 60000);
  const checkInDeadlineAt = new Date(row.startAt.getTime() + policy.checkInGraceMinutes * 60000);
  const cancellationDeadlineAt = policy.cancellationDeadlineMinutes
    ? new Date(row.startAt.getTime() - policy.cancellationDeadlineMinutes * 60000)
    : null;
  const isOwner = row.userId === viewer.id;
  const isAdmin = viewer.permissions.includes('reservation:manage-any');
  const active = row.status === 'CONFIRMED' || row.status === 'PENDING_APPROVAL' || row.status === 'CHECKED_IN';
  const notStarted = row.endAt > now;

  const actions = {
    canModify: (isOwner || isAdmin) && (row.status === 'CONFIRMED' || row.status === 'PENDING_APPROVAL') && row.startAt > now,
    canCancel: (isOwner || isAdmin) && active && notStarted && (isAdmin || !cancellationDeadlineAt || now <= cancellationDeadlineAt),
    canCheckIn: (isOwner || isAdmin) && row.status === 'CONFIRMED' && now >= checkInOpensAt && now < row.endAt,
    canCheckOut: (isOwner || isAdmin) && row.status === 'CHECKED_IN' && now < row.endAt,
    canRebook: isOwner && (row.status === 'COMPLETED' || row.status === 'CANCELLED' || row.status === 'NO_SHOW' || row.status === 'RELEASED'),
  };

  return {
    ...toReservationSummaryDto(row as unknown as Prisma.ReservationGetPayload<{ include: typeof reservationSummaryInclude }>),
    description: row.description,
    setupNotes: row.setupNotes,
    capacity: resource.capacity,
    attendees: row.attendees.map((a) => ({ id: a.id, userId: a.userId, email: a.email, name: a.name })),
    checkInCode: isOwner || isAdmin ? row.checkInCode : null,
    approval: row.approval
      ? {
          id: row.approval.id,
          status: row.approval.status,
          approverId: row.approval.approverId,
          approverName: row.approval.approver ? `${row.approval.approver.firstName} ${row.approval.approver.lastName}` : null,
          decisionNote: row.approval.decisionNote,
          decidedAt: row.approval.decidedAt?.toISOString() ?? null,
        }
      : null,
    policy: {
      checkInRequired,
      checkInOpensAt: checkInRequired ? checkInOpensAt.toISOString() : null,
      checkInDeadlineAt: checkInRequired && policy.autoReleaseEnabled ? checkInDeadlineAt.toISOString() : null,
      cancellationDeadlineAt: cancellationDeadlineAt?.toISOString() ?? null,
    },
    actions,
    mapPosition: resource.mapObject ? { x: resource.mapObject.x, y: resource.mapObject.y } : null,
  };
}

/**
 * @param opts.verifiedByCode the caller proved access with the booking's check-in code (kiosk or
 *   colleague scanning the QR). They may see the booking they just checked in; toReservationDto
 *   still hides the code itself from non-owners.
 */
export async function getReservation(user: AuthUser, id: string, opts: { verifiedByCode?: boolean } = {}): Promise<ReservationDto> {
  const row = await prisma.reservation.findFirst({ where: { id, orgId: user.orgId }, include: reservationDetailInclude });
  if (!row || (!opts.verifiedByCode && !canView(user, row))) throw AppError.notFound('Reservation');
  return toReservationDto(row, user);
}

export async function listReservations(
  user: AuthUser,
  q: ReservationListQuery,
  opts: { ownOnly: boolean },
): Promise<Paginated<ReservationSummaryDto>> {
  const now = new Date();
  const where: Prisma.ReservationWhereInput = { orgId: user.orgId };
  if (opts.ownOnly) where.userId = user.id;
  else if (q.userId) where.userId = q.userId;
  if (q.type) where.type = q.type;
  if (q.status) where.status = q.status;
  if (q.resourceId) where.resourceId = q.resourceId;
  if (q.buildingId || q.floorId) where.resource = { ...(q.buildingId ? { buildingId: q.buildingId } : {}), ...(q.floorId ? { floorId: q.floorId } : {}) };
  // Date range filters use overlap semantics so bookings crossing the range edges are included.
  if (q.from) where.endAt = { ...(where.endAt as object), gt: new Date(q.from) };
  if (q.to) where.startAt = { ...(where.startAt as object), lt: new Date(q.to) };
  if (q.q) {
    where.OR = [
      { title: { contains: q.q, mode: 'insensitive' } },
      { resource: { name: { contains: q.q, mode: 'insensitive' } } },
      { resource: { code: { contains: q.q, mode: 'insensitive' } } },
      ...(opts.ownOnly ? [] : [{ user: { OR: [{ firstName: { contains: q.q, mode: 'insensitive' as const } }, { lastName: { contains: q.q, mode: 'insensitive' as const } }, { email: { contains: q.q, mode: 'insensitive' as const } }] } }]),
    ];
  }
  let orderBy: Prisma.ReservationOrderByWithRelationInput = { startAt: q.sortDir ?? 'asc' };
  switch (q.scope) {
    case 'upcoming':
      where.status = q.status ?? { in: ['CONFIRMED', 'PENDING_APPROVAL'] };
      where.startAt = { ...(where.startAt as object), gt: now };
      break;
    case 'ongoing':
      where.status = q.status ?? { in: ['CONFIRMED', 'CHECKED_IN'] };
      where.startAt = { ...(where.startAt as object), lte: now };
      where.endAt = { ...(where.endAt as object), gt: now };
      break;
    case 'past':
      where.status = q.status ?? { in: ['COMPLETED', 'NO_SHOW', 'CHECKED_IN', 'CONFIRMED'] };
      where.endAt = { ...(where.endAt as object), lte: now };
      orderBy = { startAt: q.sortDir ?? 'desc' };
      break;
    case 'cancelled':
      where.status = q.status ?? { in: ['CANCELLED', 'REJECTED', 'RELEASED'] };
      orderBy = { startAt: q.sortDir ?? 'desc' };
      break;
    default:
      orderBy = { startAt: q.sortDir ?? 'desc' };
  }
  const [total, rows] = await Promise.all([
    prisma.reservation.count({ where }),
    prisma.reservation.findMany({ where, include: reservationSummaryInclude, orderBy, ...skipTake(q.page, q.pageSize) }),
  ]);
  return paginate(rows.map(toReservationSummaryDto), total, q.page, q.pageSize);
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateReservation(
  user: AuthUser,
  id: string,
  input: ReservationUpdateInput,
  meta: { ip?: string | null } = {},
): Promise<ReservationDto> {
  const isAdmin = user.permissions.includes('reservation:manage-any');
  const now = new Date();
  const before = await prisma.reservation.findFirst({ where: { id, orgId: user.orgId }, include: { attendees: true } });
  if (!before || (!isAdmin && before.userId !== user.id)) throw AppError.notFound('Reservation');
  if (!['CONFIRMED', 'PENDING_APPROVAL'].includes(before.status)) {
    throw AppError.policy(`A ${before.status.toLowerCase().replace('_', ' ')} booking cannot be modified.`);
  }
  if (before.startAt <= now && !isAdmin) throw AppError.policy('A booking that has already started cannot be modified.');

  const resourceId = input.resourceId ?? before.resourceId;
  const resource = await loadResource(resourceId, user.orgId, prisma);
  assertResourceBookable(resource, user, isAdmin);
  const policy = await resolvePolicy(user.orgId, resource.buildingId, resource.type);
  const startAt = input.startAt ? new Date(input.startAt) : before.startAt;
  const endAt = input.endAt ? new Date(input.endAt) : before.endAt;
  const timeChanged = startAt.getTime() !== before.startAt.getTime() || endAt.getTime() !== before.endAt.getTime() || resourceId !== before.resourceId;
  const attendees = input.attendees?.filter((a) => a.userId || a.email);
  const attendeeCount = attendees ? attendees.length : before.attendees.length;

  let updated: Reservation;
  try {
    updated = await prisma.$transaction(async (tx) => {
      if (timeChanged) {
        await validateOccurrence(
          { user, bookingFor: before.userId, resource, policy, now, tx, excludeReservationId: before.id, attendeeCount, isAdmin },
          { startAt, endAt },
        );
      } else if (resource.type === 'MEETING_ROOM' && resource.capacity && attendeeCount + 1 > resource.capacity) {
        throw AppError.policy(`This room seats ${resource.capacity} people.`);
      }
      const row = await tx.reservation.update({
        where: { id },
        data: {
          resourceId,
          type: resource.type,
          startAt,
          endAt,
          timezone: resource.building.timezone,
          title: input.title ?? undefined,
          description: input.description === undefined ? undefined : input.description,
          setupNotes: input.setupNotes === undefined ? undefined : input.setupNotes,
          // Moving to a resource that requires approval re-opens the approval.
          status: resource.requiresApproval && before.status === 'CONFIRMED' && resourceId !== before.resourceId ? 'PENDING_APPROVAL' : undefined,
          attendees: attendees
            ? { deleteMany: {}, create: attendees.map((a) => ({ userId: a.userId ?? null, email: a.email ?? null, name: a.name ?? null })) }
            : undefined,
        },
      });
      if (row.status === 'PENDING_APPROVAL' && before.status === 'CONFIRMED') {
        await tx.approvalRequest.upsert({
          where: { reservationId: id },
          create: { reservationId: id, requestedById: user.id },
          update: { status: 'PENDING', decidedAt: null, decisionNote: null, approverId: null },
        });
      }
      return row;
    });
  } catch (err) {
    if (isExclusionViolation(err)) {
      const alternatives = await findAlternatives(user.orgId, resource, startAt, endAt, user);
      throw AppError.bookingConflict(`${resource.name} was just booked by someone else for that time.`, { alternatives });
    }
    throw err;
  }

  await audit({ orgId: user.orgId, actorId: user.id, action: 'reservation.update', entityType: 'Reservation', entityId: id, before, after: updated, ip: meta.ip });
  await notify({
    userId: before.userId,
    type: 'BOOKING_MODIFIED',
    title: `Booking updated: ${resource.name}`,
    body: `${resource.building.name}, ${resource.floor.name} · ${formatRange(updated.startAt, updated.endAt, resource.building.timezone)}`,
    data: { reservationId: id, resourceId: resource.id, floorId: resource.floorId },
    email: true,
  });
  broadcastToOrg(user.orgId, 'availability.changed', {
    resourceIds: [...new Set([before.resourceId, resource.id])],
    floorId: resource.floorId,
    buildingId: resource.buildingId,
    reservationIds: [id],
  });
  return getReservation(user, id);
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

export async function cancelReservation(
  user: AuthUser,
  id: string,
  input: CancelInput,
  meta: { ip?: string | null; admin?: boolean } = {},
): Promise<ReservationDto> {
  const isAdmin = user.permissions.includes('reservation:manage-any');
  const now = new Date();
  const row = await prisma.reservation.findFirst({
    where: { id, orgId: user.orgId },
    include: { resource: { include: { building: true, floor: true } } },
  });
  if (!row || (!isAdmin && row.userId !== user.id)) throw AppError.notFound('Reservation');
  if (!ACTIVE.includes(row.status)) throw AppError.policy('This booking is no longer active.');
  if (row.endAt <= now && !isAdmin) throw AppError.policy('A booking that has ended cannot be cancelled.');
  const policy = await resolvePolicy(user.orgId, row.resource.buildingId, row.type);
  if (!isAdmin && policy.cancellationDeadlineMinutes > 0) {
    const deadline = new Date(row.startAt.getTime() - policy.cancellationDeadlineMinutes * 60000);
    if (now > deadline) {
      throw AppError.policy(`Cancellations must be made at least ${policy.cancellationDeadlineMinutes} minutes before the start.`);
    }
  }
  if (meta.admin && !input.reason) throw AppError.badRequest('A reason is required when cancelling on behalf of someone else.');

  const ids = [row.id];
  if (input.cancelSeries && row.seriesId) {
    const siblings = await prisma.reservation.findMany({
      where: { seriesId: row.seriesId, status: { in: ACTIVE }, startAt: { gte: row.startAt }, id: { not: row.id } },
      select: { id: true },
    });
    ids.push(...siblings.map((s) => s.id));
  }

  await prisma.$transaction(async (tx) => {
    await tx.reservation.updateMany({
      where: { id: { in: ids } },
      data: { status: 'CANCELLED', cancelledAt: now, cancelledById: user.id, cancelReason: input.reason ?? null },
    });
    await tx.approvalRequest.updateMany({ where: { reservationId: { in: ids }, status: 'PENDING' }, data: { status: 'REJECTED', decisionNote: 'Cancelled by requester', decidedAt: now } });
    for (const rid of ids) {
      await audit(
        { orgId: user.orgId, actorId: user.id, action: meta.admin ? 'reservation.admin-cancel' : 'reservation.cancel', entityType: 'Reservation', entityId: rid, before: { status: row.status }, after: { status: 'CANCELLED', reason: input.reason ?? null }, ip: meta.ip },
        tx,
      );
    }
  });

  const tz = row.resource.building.timezone;
  await notify({
    userId: row.userId,
    type: 'BOOKING_CANCELLED',
    title: `Booking cancelled: ${row.resource.name}`,
    body: `${formatRange(row.startAt, row.endAt, tz)}${ids.length > 1 ? ` and ${ids.length - 1} further occurrence(s)` : ''}${input.reason ? ` · Reason: ${input.reason}` : ''}`,
    data: { reservationId: row.id, resourceId: row.resourceId, floorId: row.resource.floorId },
    email: true,
  });
  broadcastToOrg(user.orgId, 'availability.changed', { resourceIds: [row.resourceId], floorId: row.resource.floorId, buildingId: row.resource.buildingId, reservationIds: ids });
  void removeReservationFromCalendars(user.orgId, row.id).catch(() => undefined);
  return getReservation(user, id);
}

// ---------------------------------------------------------------------------
// Check-in / check-out
// ---------------------------------------------------------------------------

export async function checkIn(user: AuthUser, id: string, code: string | undefined, meta: { ip?: string | null } = {}): Promise<ReservationDto> {
  const isAdmin = user.permissions.includes('reservation:manage-any');
  const now = new Date();
  const row = await prisma.reservation.findFirst({ where: { id, orgId: user.orgId }, include: { resource: { include: { building: true } } } });
  if (!row) throw AppError.notFound('Reservation');
  const isOwner = row.userId === user.id;
  // Anyone scanning the QR with the correct code may check the booking in (kiosk / shared device).
  const codeMatches = !!code && code.replace(/\s/g, '').toUpperCase() === row.checkInCode.toUpperCase();
  if (!isOwner && !isAdmin && !codeMatches) throw AppError.forbidden('Invalid check-in code.');
  if (code && !codeMatches && !isAdmin) throw AppError.badRequest('The check-in code does not match this booking.');
  if (row.status === 'CHECKED_IN') return getReservation(user, id, { verifiedByCode: codeMatches });
  if (row.status !== 'CONFIRMED') throw AppError.policy(`Cannot check in to a ${row.status.toLowerCase().replace('_', ' ')} booking.`);
  const policy = await resolvePolicy(user.orgId, row.resource.buildingId, row.type);
  const opensAt = new Date(row.startAt.getTime() - policy.checkInOpensMinutesBefore * 60000);
  if (now < opensAt) throw AppError.policy(`Check-in opens ${policy.checkInOpensMinutesBefore} minutes before the booking starts.`);
  if (now >= row.endAt) throw AppError.policy('This booking has already ended.');

  await prisma.$transaction(async (tx) => {
    await tx.reservation.update({ where: { id }, data: { status: 'CHECKED_IN', checkedInAt: now } });
    await tx.checkInRecord.create({ data: { reservationId: id, userId: user.id, method: codeMatches ? 'QR' : isAdmin && !isOwner ? 'ADMIN' : 'MANUAL', kind: 'IN', at: now } });
    await audit({ orgId: user.orgId, actorId: user.id, action: 'reservation.check-in', entityType: 'Reservation', entityId: id, after: { method: codeMatches ? 'QR' : 'MANUAL' }, ip: meta.ip }, tx);
  });
  broadcastToOrg(user.orgId, 'availability.changed', { resourceIds: [row.resourceId], floorId: row.resource.floorId, buildingId: row.resource.buildingId, reservationIds: [id] });
  return getReservation(user, id, { verifiedByCode: codeMatches });
}

export async function checkOut(user: AuthUser, id: string, meta: { ip?: string | null } = {}): Promise<ReservationDto> {
  const isAdmin = user.permissions.includes('reservation:manage-any');
  const now = new Date();
  const row = await prisma.reservation.findFirst({ where: { id, orgId: user.orgId }, include: { resource: true } });
  if (!row || (!isAdmin && row.userId !== user.id)) throw AppError.notFound('Reservation');
  if (row.status !== 'CHECKED_IN') throw AppError.policy('Only a checked-in booking can be checked out.');
  await prisma.$transaction(async (tx) => {
    // Checking out early frees the resource for the remainder of the slot.
    await tx.reservation.update({ where: { id }, data: { status: 'COMPLETED', checkedOutAt: now, endAt: now < row.endAt ? now : row.endAt } });
    await tx.checkInRecord.create({ data: { reservationId: id, userId: user.id, method: 'MANUAL', kind: 'OUT', at: now } });
    await audit({ orgId: user.orgId, actorId: user.id, action: 'reservation.check-out', entityType: 'Reservation', entityId: id, ip: meta.ip }, tx);
  });
  broadcastToOrg(user.orgId, 'availability.changed', { resourceIds: [row.resourceId], floorId: row.resource.floorId, buildingId: row.resource.buildingId, reservationIds: [id] });
  return getReservation(user, id);
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export async function decideApproval(
  user: AuthUser,
  reservationId: string,
  decision: 'APPROVED' | 'REJECTED',
  note: string | undefined,
  meta: { ip?: string | null } = {},
): Promise<ReservationDto> {
  const row = await prisma.reservation.findFirst({ where: { id: reservationId, orgId: user.orgId }, include: { approval: true, resource: { include: { building: true } } } });
  if (!row || !row.approval) throw AppError.notFound('Approval request');
  if (row.approval.status !== 'PENDING') throw AppError.conflict('This request has already been decided.');
  if (row.userId === user.id) throw AppError.forbidden('You cannot approve your own request.');
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.approvalRequest.update({ where: { id: row.approval!.id }, data: { status: decision, approverId: user.id, decisionNote: note ?? null, decidedAt: now } });
    await tx.reservation.update({ where: { id: reservationId }, data: { status: decision === 'APPROVED' ? 'CONFIRMED' : 'REJECTED' } });
    await audit({ orgId: user.orgId, actorId: user.id, action: `approval.${decision.toLowerCase()}`, entityType: 'Reservation', entityId: reservationId, after: { decision, note }, ip: meta.ip }, tx);
  });
  const tz = row.resource.building.timezone;
  await notify({
    userId: row.userId,
    type: 'APPROVAL_DECIDED',
    title: `Booking ${decision === 'APPROVED' ? 'approved' : 'rejected'}: ${row.resource.name}`,
    body: `${formatRange(row.startAt, row.endAt, tz)}${note ? ` · ${note}` : ''}`,
    data: { reservationId, resourceId: row.resourceId, floorId: row.resource.floorId },
    email: true,
  });
  broadcastToOrg(user.orgId, 'availability.changed', { resourceIds: [row.resourceId], floorId: row.resource.floorId, buildingId: row.resource.buildingId, reservationIds: [reservationId] });
  return getReservation(user, reservationId);
}

export async function listPendingApprovals(user: AuthUser, page: number, pageSize: number): Promise<Paginated<ReservationSummaryDto>> {
  const where: Prisma.ReservationWhereInput = { orgId: user.orgId, status: 'PENDING_APPROVAL', approval: { status: 'PENDING' } };
  const [total, rows] = await Promise.all([
    prisma.reservation.count({ where }),
    prisma.reservation.findMany({ where, include: reservationSummaryInclude, orderBy: { startAt: 'asc' }, ...skipTake(page, pageSize) }),
  ]);
  return paginate(rows.map(toReservationSummaryDto), total, page, pageSize);
}
