// Booking engine for demo mode: port of apps/api/src/modules/reservations/service.ts + routes.ts.
// Same validation order and messages, so conflicts, limits and policies read exactly as with the API.
import {
  approvalDecisionSchema,
  checkInSchema,
  paginationQuerySchema,
  reservationCancelSchema,
  reservationCreateSchema,
  reservationListQuerySchema,
  reservationUpdateSchema,
  type BatchReservationResultDto,
  type ConflictAlternativeDto,
  type Paginated,
  type RecurrenceRule,
  type ReservationCreateInput,
  type ReservationDto,
  type ReservationListQuery,
  type ReservationStatus,
  type ReservationSummaryDto,
  type ReservationUpdateInput,
} from '@spaceflow/shared';
import { dayjs } from '@/utils/time';
import { shortCode, uuid, type DbPolicy, type DbReservation, type DbResource, type DemoDb } from '../db';
import {
  DemoError,
  Reply,
  addDays,
  audit,
  checkOperatingHours,
  computeAvailability,
  contains,
  endOfLocalDay,
  formatRange,
  fromLocal,
  iso,
  isActiveStatus,
  localDate,
  localTime,
  minutesBetween,
  ms,
  notify,
  overlaps,
  paginate,
  requirePermission,
  resolvePolicy,
  startOfLocalDay,
  startOfLocalWeek,
  toReservationSummaryDto,
  toResourceDto,
  userCanAccessResource,
  type AuthUser,
} from '../core';
import { get, patch, post, type Route } from '../router';

interface Occurrence {
  startAt: Date;
  endAt: Date;
}

export function expandOccurrences(startAt: Date, endAt: Date, tz: string, recurrence: RecurrenceRule | undefined, additionalDates: string[] | undefined, maxOccurrences: number): Occurrence[] {
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
  return [...dates].sort().map((d) => {
    const s = fromLocal(d, startTime, tz);
    let e = fromLocal(d, endTime, tz);
    if (e <= s) e = new Date(s.getTime() + durationMs);
    return { startAt: s, endAt: e };
  });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface ValidationContext {
  db: DemoDb;
  user: AuthUser;
  bookingFor: string;
  resource: DbResource;
  tz: string;
  policy: DbPolicy;
  now: Date;
  excludeReservationId?: string;
  attendeeCount: number;
  isAdmin: boolean;
  /** Rows inserted earlier in the same atomic batch (not yet committed). */
  pending: DbReservation[];
}

function validateOccurrence(ctx: ValidationContext, occ: Occurrence) {
  const { db, resource, policy, now, tz } = ctx;
  const duration = minutesBetween(occ.startAt, occ.endAt);
  if (occ.endAt <= occ.startAt) throw DemoError.invalidTime('End time must be after start time.');
  if (occ.endAt <= now) throw DemoError.invalidTime('The selected time is in the past.');
  if (occ.startAt < new Date(now.getTime() - 15 * 60000) && !ctx.isAdmin) throw DemoError.invalidTime('Bookings cannot start in the past.');
  const minDur = policy.minDurationMinutes;
  const maxDur = Math.min(policy.maxDurationMinutes, resource.maxDurationMinutes ?? Infinity);
  if (duration < minDur) throw DemoError.policy(`Minimum booking duration is ${minDur} minutes.`);
  if (duration > maxDur) throw DemoError.policy(`Maximum booking duration is ${maxDur} minutes.`);
  const advanceLimit = new Date(now.getTime() + policy.advanceBookingDays * 86400000);
  if (occ.startAt > advanceLimit && !ctx.isAdmin) throw DemoError.policy(`Bookings can be made at most ${policy.advanceBookingDays} days in advance.`);
  const hours = checkOperatingHours(resource, policy, occ.startAt, occ.endAt, tz);
  if (!hours.ok) throw DemoError.policy(hours.reason);
  if (resource.type === 'MEETING_ROOM' && resource.capacity && ctx.attendeeCount + 1 > resource.capacity) {
    throw DemoError.policy(`This room seats ${resource.capacity} people; you listed ${ctx.attendeeCount + 1}.`);
  }
  const s = occ.startAt.getTime();
  const e = occ.endAt.getTime();
  const maintenance = db.maintenance.find((m) => m.resourceId === resource.id && overlaps(ms(m.startAt), ms(m.endAt), s, e));
  if (maintenance) throw DemoError.unavailable(`The resource is under maintenance ${formatRange(new Date(maintenance.startAt), new Date(maintenance.endAt), tz)}.`);

  const rows = [...db.reservations, ...ctx.pending].filter((r) => r.id !== ctx.excludeReservationId && isActiveStatus(r.status));
  if (!ctx.isAdmin) {
    const mine = rows.filter((r) => r.userId === ctx.bookingFor);
    const activeCount = mine.filter((r) => ms(r.endAt) > now.getTime()).length;
    if (activeCount >= policy.maxActiveReservations) throw DemoError.policy(`You already have ${activeCount} active reservations (limit ${policy.maxActiveReservations}).`);
    const day = localDate(occ.startAt, tz);
    const dayStart = startOfLocalDay(day, tz).getTime();
    const dayEnd = endOfLocalDay(day, tz).getTime();
    const dailyCount = mine.filter((r) => r.type === resource.type && ms(r.startAt) >= dayStart && ms(r.startAt) < dayEnd).length;
    if (dailyCount >= policy.maxDailyBookings) throw DemoError.policy(`Daily limit reached: at most ${policy.maxDailyBookings} ${resource.type === 'SEAT' ? 'seat' : 'room'} bookings per day.`);
    const weekStart = startOfLocalWeek(occ.startAt, tz).getTime();
    const weeklyCount = mine.filter((r) => r.type === resource.type && ms(r.startAt) >= weekStart && ms(r.startAt) < weekStart + 7 * 86400000).length;
    if (weeklyCount >= policy.maxWeeklyBookings) throw DemoError.policy(`Weekly limit reached: at most ${policy.maxWeeklyBookings} bookings per week.`);
    if (resource.type === 'SEAT') {
      const otherSeat = mine.find((r) => r.type === 'SEAT' && overlaps(ms(r.startAt), ms(r.endAt), s, e));
      if (otherSeat) {
        const code = db.resources.find((x) => x.id === otherSeat.resourceId)?.code ?? '';
        throw DemoError.policy(`You already have seat ${code} booked for an overlapping time.`);
      }
    }
  }
  const conflict = rows.find((r) => r.resourceId === resource.id && overlaps(ms(r.startAt), ms(r.endAt), s, e));
  if (conflict) {
    throw DemoError.bookingConflict(`${resource.name} is already reserved ${formatRange(new Date(conflict.startAt), new Date(conflict.endAt), tz)}.`, {
      conflictingReservationId: conflict.id,
      isMine: conflict.userId === ctx.bookingFor,
    });
  }
}

function loadResource(db: DemoDb, resourceId: string): DbResource {
  const r = db.resources.find((x) => x.id === resourceId && !x.deletedAt);
  if (!r) throw DemoError.notFound('Resource');
  return r;
}

function assertResourceBookable(db: DemoDb, resource: DbResource, user: AuthUser, isAdmin: boolean) {
  const building = db.buildings.find((b) => b.id === resource.buildingId)!;
  const floor = db.floors.find((f) => f.id === resource.floorId)!;
  if (resource.status !== 'ACTIVE') throw DemoError.unavailable(`${resource.name} is currently ${resource.status.toLowerCase()}.`);
  if (!resource.isBookable) throw DemoError.unavailable(`${resource.name} is not bookable.`);
  if (!building.isActive) throw DemoError.unavailable('This building is inactive.');
  if (!floor.isPublished && !isAdmin) throw DemoError.unavailable('This floor is not published yet.');
  if (!userCanAccessResource(resource, user)) throw DemoError.forbidden(`${resource.name} is reserved for a specific department or team.`);
}

const tzOf = (db: DemoDb, r: DbResource) => db.buildings.find((b) => b.id === r.buildingId)!.timezone;

export function findAlternatives(db: DemoDb, resource: DbResource, startAt: Date, endAt: Date, user: AuthUser | undefined, limit = 3): ConflictAlternativeDto[] {
  const candidates = db.resources
    .filter(
      (c) =>
        c.id !== resource.id && c.type === resource.type && c.status === 'ACTIVE' && c.isBookable && !c.deletedAt &&
        db.floors.find((f) => f.id === c.floorId)?.isPublished &&
        (resource.type !== 'MEETING_ROOM' || !resource.capacity || (c.capacity ?? 0) >= Math.max(1, Math.floor(resource.capacity * 0.6))) &&
        (c.floorId === resource.floorId || c.buildingId === resource.buildingId),
    )
    .slice(0, 60)
    .sort((a, b) => Number(b.floorId === resource.floorId) - Number(a.floorId === resource.floorId));
  const availability = computeAvailability(db, candidates, { startAt, endAt, user });
  const out: ConflictAlternativeDto[] = [];
  for (const c of candidates) {
    if (availability.get(c.id)?.state === 'AVAILABLE') {
      out.push({ resource: toResourceDto(db, c), startAt: startAt.toISOString(), endAt: endAt.toISOString() });
      if (out.length >= limit) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export function createReservations(db: DemoDb, user: AuthUser, input: ReservationCreateInput): BatchReservationResultDto {
  const isAdmin = user.permissions.includes('reservation:manage-any');
  if (input.onBehalfOfUserId && !isAdmin) throw DemoError.forbidden('Only administrators can book on behalf of others.');
  const bookingFor = input.onBehalfOfUserId && isAdmin ? input.onBehalfOfUserId : user.id;
  const now = new Date();
  const resource = loadResource(db, input.resourceId);
  assertResourceBookable(db, resource, user, isAdmin);
  const policy = resolvePolicy(db, resource.buildingId, resource.type);
  const tz = tzOf(db, resource);
  if (input.recurrence && !policy.allowRecurring) throw DemoError.policy('Recurring bookings are not allowed by policy.');
  if (input.additionalDates?.length && !policy.allowMultiDay) throw DemoError.policy('Multi-day bookings are not allowed by policy.');
  const occurrences = expandOccurrences(new Date(input.startAt), new Date(input.endAt), tz, input.recurrence, input.additionalDates, policy.maxRecurringOccurrences);
  if (occurrences.length > policy.maxRecurringOccurrences) throw DemoError.policy(`At most ${policy.maxRecurringOccurrences} occurrences can be booked at once.`);

  const attendees = (input.attendees ?? []).filter((a) => a.userId || a.email);
  const status: ReservationStatus = resource.requiresApproval ? 'PENDING_APPROVAL' : 'CONFIRMED';
  const seriesId = occurrences.length > 1 || input.recurrence ? uuid() : null;
  const created: DbReservation[] = [];
  const failed: BatchReservationResultDto['failed'] = [];

  const build = (occ: Occurrence, pending: DbReservation[]): DbReservation => {
    validateOccurrence({ db, user, bookingFor, resource, tz, policy, now, attendeeCount: attendees.length, isAdmin, pending }, occ);
    const nowIso = iso(Date.now());
    return {
      id: uuid(), resourceId: resource.id, userId: bookingFor, createdById: user.id, type: resource.type, status,
      title: input.title ?? (resource.type === 'SEAT' ? `Desk ${resource.code}` : null),
      description: input.description ?? null, setupNotes: input.setupNotes ?? null,
      startAt: occ.startAt.toISOString(), endAt: occ.endAt.toISOString(), timezone: tz, isAllDay: input.isAllDay ?? false, seriesId, checkInCode: shortCode(),
      checkedInAt: null, checkedOutAt: null, cancelledAt: null, cancelledById: null, cancelReason: null, createdAt: nowIso, updatedAt: nowIso,
      attendees: attendees.map((a) => ({ id: uuid(), userId: a.userId ?? null, email: a.email ?? null, name: a.name ?? null })),
      approval: resource.requiresApproval ? { id: uuid(), status: 'PENDING', requestedById: user.id, approverId: null, decisionNote: null, decidedAt: null } : null,
    };
  };

  if (input.atomic !== false) {
    const pending: DbReservation[] = [];
    try {
      for (const occ of occurrences) pending.push(build(occ, pending));
      created.push(...pending);
    } catch (err) {
      if (!(err instanceof DemoError)) throw err;
      const failing = occurrences.find((o) => err.message.includes(dayjs(o.startAt).tz(tz).format('ddd D MMM'))) ?? occurrences[0];
      failed.push({ startAt: failing.startAt.toISOString(), endAt: failing.endAt.toISOString(), code: err.code, message: err.message });
      if (err.code === 'BOOKING_CONFLICT' && occurrences.length === 1) {
        const alternatives = findAlternatives(db, resource, occurrences[0].startAt, occurrences[0].endAt, user);
        throw DemoError.bookingConflict(err.message, { ...(err.details as object), alternatives });
      }
      if (occurrences.length === 1) throw err;
      return { created: [], failed, seriesId: null, atomic: true };
    }
  } else {
    for (const occ of occurrences) {
      try {
        created.push(build(occ, created));
      } catch (err) {
        if (!(err instanceof DemoError)) throw err;
        failed.push({ startAt: occ.startAt.toISOString(), endAt: occ.endAt.toISOString(), code: err.code, message: err.message });
      }
    }
  }
  db.reservations.push(...created);

  if (created.length) {
    const first = created[0];
    const building = db.buildings.find((b) => b.id === resource.buildingId)!;
    const floor = db.floors.find((f) => f.id === resource.floorId)!;
    const label = resource.type === 'SEAT' ? 'Seat' : 'Meeting room';
    const multi = created.length > 1 ? ` (+${created.length - 1} more)` : '';
    notify(db, {
      userId: bookingFor,
      type: first.status === 'PENDING_APPROVAL' ? 'APPROVAL_REQUESTED' : 'BOOKING_CONFIRMED',
      title: first.status === 'PENDING_APPROVAL' ? `${label} booking awaiting approval` : `${label} booked: ${resource.name}`,
      body: `${resource.name} · ${building.name}, ${floor.name} · ${formatRange(new Date(first.startAt), new Date(first.endAt), tz)}${multi}`,
      data: { reservationId: first.id, resourceId: resource.id, floorId: resource.floorId, buildingId: resource.buildingId },
    });
    for (const r of created) audit(db, { actorId: user.id, action: 'reservation.create', entityType: 'Reservation', entityId: r.id, after: r });
  }
  const seriesUsed = created.length && seriesId ? seriesId : null;
  return { created: created.map((r) => getReservation(db, user, r.id)), failed, seriesId: seriesUsed, atomic: input.atomic !== false };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

function canView(user: AuthUser, row: DbReservation): boolean {
  if (row.userId === user.id) return true;
  if (user.permissions.includes('reservation:manage-any') || user.permissions.includes('reservation:approve')) return true;
  return row.attendees.some((a) => a.userId === user.id);
}

export function toReservationDto(db: DemoDb, row: DbReservation, viewer: AuthUser): ReservationDto {
  const resource = db.resources.find((r) => r.id === row.resourceId)!;
  const policy = resolvePolicy(db, resource.buildingId, resource.type);
  const now = Date.now();
  const start = ms(row.startAt);
  const end = ms(row.endAt);
  const checkInRequired = resource.checkInRequired ?? policy.checkInRequired;
  const checkInOpensAt = start - policy.checkInOpensMinutesBefore * 60000;
  const checkInDeadlineAt = start + policy.checkInGraceMinutes * 60000;
  const cancellationDeadlineAt = policy.cancellationDeadlineMinutes ? start - policy.cancellationDeadlineMinutes * 60000 : null;
  const isOwner = row.userId === viewer.id;
  const isAdmin = viewer.permissions.includes('reservation:manage-any');
  const active = isActiveStatus(row.status);
  const notStarted = end > now;
  const approver = row.approval?.approverId ? db.users.find((u) => u.id === row.approval!.approverId) : undefined;
  const mo = db.mapObjects.find((o) => o.resourceId === resource.id);
  return {
    ...toReservationSummaryDto(db, row),
    description: row.description,
    setupNotes: row.setupNotes,
    capacity: resource.capacity,
    attendees: row.attendees,
    checkInCode: isOwner || isAdmin ? row.checkInCode : null,
    approval: row.approval
      ? { id: row.approval.id, status: row.approval.status, approverId: row.approval.approverId, approverName: approver ? `${approver.firstName} ${approver.lastName}` : null, decisionNote: row.approval.decisionNote, decidedAt: row.approval.decidedAt }
      : null,
    policy: {
      checkInRequired,
      checkInOpensAt: checkInRequired ? iso(checkInOpensAt) : null,
      checkInDeadlineAt: checkInRequired && policy.autoReleaseEnabled ? iso(checkInDeadlineAt) : null,
      cancellationDeadlineAt: cancellationDeadlineAt ? iso(cancellationDeadlineAt) : null,
    },
    actions: {
      canModify: (isOwner || isAdmin) && (row.status === 'CONFIRMED' || row.status === 'PENDING_APPROVAL') && start > now,
      canCancel: (isOwner || isAdmin) && active && notStarted && (isAdmin || !cancellationDeadlineAt || now <= cancellationDeadlineAt),
      canCheckIn: (isOwner || isAdmin) && row.status === 'CONFIRMED' && now >= checkInOpensAt && now < end,
      canCheckOut: (isOwner || isAdmin) && row.status === 'CHECKED_IN' && now < end,
      canRebook: isOwner && ['COMPLETED', 'CANCELLED', 'NO_SHOW', 'RELEASED'].includes(row.status),
    },
    mapPosition: mo ? { x: mo.x, y: mo.y } : null,
  };
}

export function getReservation(db: DemoDb, user: AuthUser, id: string, opts: { verifiedByCode?: boolean } = {}): ReservationDto {
  const row = db.reservations.find((r) => r.id === id);
  if (!row || (!opts.verifiedByCode && !canView(user, row))) throw DemoError.notFound('Reservation');
  return toReservationDto(db, row, user);
}

export function listReservations(db: DemoDb, user: AuthUser, q: ReservationListQuery, opts: { ownOnly: boolean }): Paginated<ReservationSummaryDto> {
  const now = Date.now();
  let rows = db.reservations.filter((r) => {
    if (opts.ownOnly ? r.userId !== user.id : q.userId && r.userId !== q.userId) return false;
    if (q.type && r.type !== q.type) return false;
    if (q.resourceId && r.resourceId !== q.resourceId) return false;
    if (q.buildingId || q.floorId) {
      const res = db.resources.find((x) => x.id === r.resourceId);
      if (!res || (q.buildingId && res.buildingId !== q.buildingId) || (q.floorId && res.floorId !== q.floorId)) return false;
    }
    if (q.from && !(ms(r.endAt) > ms(q.from))) return false;
    if (q.to && !(ms(r.startAt) < ms(q.to))) return false;
    if (q.q) {
      const res = db.resources.find((x) => x.id === r.resourceId);
      const u = db.users.find((x) => x.id === r.userId);
      const hit = contains(r.title, q.q) || contains(res?.name, q.q) || contains(res?.code, q.q) || (!opts.ownOnly && (contains(u?.firstName, q.q) || contains(u?.lastName, q.q) || contains(u?.email, q.q)));
      if (!hit) return false;
    }
    return true;
  });
  const statusIn = (list: ReservationStatus[]) => (r: DbReservation) => (q.status ? r.status === q.status : list.includes(r.status));
  let dir: 'asc' | 'desc' = q.sortDir ?? 'desc';
  switch (q.scope) {
    case 'upcoming':
      rows = rows.filter(statusIn(['CONFIRMED', 'PENDING_APPROVAL'])).filter((r) => ms(r.startAt) > now);
      dir = q.sortDir ?? 'asc';
      break;
    case 'ongoing':
      rows = rows.filter(statusIn(['CONFIRMED', 'CHECKED_IN'])).filter((r) => ms(r.startAt) <= now && ms(r.endAt) > now);
      dir = q.sortDir ?? 'asc';
      break;
    case 'past':
      rows = rows.filter(statusIn(['COMPLETED', 'NO_SHOW', 'CHECKED_IN', 'CONFIRMED'])).filter((r) => ms(r.endAt) <= now);
      break;
    case 'cancelled':
      rows = rows.filter(statusIn(['CANCELLED', 'REJECTED', 'RELEASED']));
      break;
    default:
      if (q.status) rows = rows.filter((r) => r.status === q.status);
  }
  rows.sort((a, b) => (dir === 'asc' ? 1 : -1) * (ms(a.startAt) - ms(b.startAt)));
  return paginate(rows.map((r) => toReservationSummaryDto(db, r)), q.page, q.pageSize);
}

// ---------------------------------------------------------------------------
// Update / cancel / check-in / approvals
// ---------------------------------------------------------------------------

export function updateReservation(db: DemoDb, user: AuthUser, id: string, input: ReservationUpdateInput): ReservationDto {
  const isAdmin = user.permissions.includes('reservation:manage-any');
  const now = new Date();
  const before = db.reservations.find((r) => r.id === id);
  if (!before || (!isAdmin && before.userId !== user.id)) throw DemoError.notFound('Reservation');
  if (!['CONFIRMED', 'PENDING_APPROVAL'].includes(before.status)) throw DemoError.policy(`A ${before.status.toLowerCase().replace('_', ' ')} booking cannot be modified.`);
  if (ms(before.startAt) <= now.getTime() && !isAdmin) throw DemoError.policy('A booking that has already started cannot be modified.');
  const resourceId = input.resourceId ?? before.resourceId;
  const resource = loadResource(db, resourceId);
  assertResourceBookable(db, resource, user, isAdmin);
  const policy = resolvePolicy(db, resource.buildingId, resource.type);
  const tz = tzOf(db, resource);
  const startAt = input.startAt ? new Date(input.startAt) : new Date(before.startAt);
  const endAt = input.endAt ? new Date(input.endAt) : new Date(before.endAt);
  const timeChanged = startAt.getTime() !== ms(before.startAt) || endAt.getTime() !== ms(before.endAt) || resourceId !== before.resourceId;
  const attendees = input.attendees?.filter((a) => a.userId || a.email);
  const attendeeCount = attendees ? attendees.length : before.attendees.length;
  if (timeChanged) {
    validateOccurrence({ db, user, bookingFor: before.userId, resource, tz, policy, now, excludeReservationId: before.id, attendeeCount, isAdmin, pending: [] }, { startAt, endAt });
  } else if (resource.type === 'MEETING_ROOM' && resource.capacity && attendeeCount + 1 > resource.capacity) {
    throw DemoError.policy(`This room seats ${resource.capacity} people.`);
  }
  const snapshot = { ...before };
  const reopen = resource.requiresApproval && before.status === 'CONFIRMED' && resourceId !== before.resourceId;
  Object.assign(before, {
    resourceId,
    type: resource.type,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    timezone: tz,
    title: input.title ?? before.title,
    description: input.description === undefined ? before.description : input.description,
    setupNotes: input.setupNotes === undefined ? before.setupNotes : input.setupNotes,
    status: reopen ? 'PENDING_APPROVAL' : before.status,
    attendees: attendees ? attendees.map((a) => ({ id: uuid(), userId: a.userId ?? null, email: a.email ?? null, name: a.name ?? null })) : before.attendees,
    approval: reopen ? { id: before.approval?.id ?? uuid(), status: 'PENDING', requestedById: user.id, approverId: null, decisionNote: null, decidedAt: null } : before.approval,
    updatedAt: iso(Date.now()),
  } satisfies Partial<DbReservation>);
  audit(db, { actorId: user.id, action: 'reservation.update', entityType: 'Reservation', entityId: id, before: snapshot, after: before });
  const building = db.buildings.find((b) => b.id === resource.buildingId)!;
  const floor = db.floors.find((f) => f.id === resource.floorId)!;
  notify(db, { userId: before.userId, type: 'BOOKING_MODIFIED', title: `Booking updated: ${resource.name}`, body: `${building.name}, ${floor.name} · ${formatRange(startAt, endAt, tz)}`, data: { reservationId: id, resourceId: resource.id, floorId: resource.floorId } });
  return getReservation(db, user, id);
}

export function cancelReservation(db: DemoDb, user: AuthUser, id: string, input: { reason?: string; cancelSeries?: boolean }, opts: { admin?: boolean } = {}): ReservationDto {
  const isAdmin = user.permissions.includes('reservation:manage-any');
  const now = Date.now();
  const row = db.reservations.find((r) => r.id === id);
  if (!row || (!isAdmin && row.userId !== user.id)) throw DemoError.notFound('Reservation');
  if (!isActiveStatus(row.status)) throw DemoError.policy('This booking is no longer active.');
  if (ms(row.endAt) <= now && !isAdmin) throw DemoError.policy('A booking that has ended cannot be cancelled.');
  const resource = db.resources.find((r) => r.id === row.resourceId)!;
  const policy = resolvePolicy(db, resource.buildingId, row.type);
  if (!isAdmin && policy.cancellationDeadlineMinutes > 0 && now > ms(row.startAt) - policy.cancellationDeadlineMinutes * 60000) {
    throw DemoError.policy(`Cancellations must be made at least ${policy.cancellationDeadlineMinutes} minutes before the start.`);
  }
  if (opts.admin && !input.reason) throw DemoError.badRequest('A reason is required when cancelling on behalf of someone else.');
  const targets = [row];
  if (input.cancelSeries && row.seriesId) {
    targets.push(...db.reservations.filter((r) => r.seriesId === row.seriesId && r.id !== row.id && isActiveStatus(r.status) && ms(r.startAt) >= ms(row.startAt)));
  }
  const nowIso = iso(now);
  for (const t of targets) {
    const prev = t.status;
    Object.assign(t, { status: 'CANCELLED', cancelledAt: nowIso, cancelledById: user.id, cancelReason: input.reason ?? null, updatedAt: nowIso });
    if (t.approval?.status === 'PENDING') Object.assign(t.approval, { status: 'REJECTED', decisionNote: 'Cancelled by requester', decidedAt: nowIso });
    audit(db, { actorId: user.id, action: opts.admin ? 'reservation.admin-cancel' : 'reservation.cancel', entityType: 'Reservation', entityId: t.id, before: { status: prev }, after: { status: 'CANCELLED', reason: input.reason ?? null } });
  }
  const tz = row.timezone;
  notify(db, {
    userId: row.userId,
    type: 'BOOKING_CANCELLED',
    title: `Booking cancelled: ${resource.name}`,
    body: `${formatRange(new Date(row.startAt), new Date(row.endAt), tz)}${targets.length > 1 ? ` and ${targets.length - 1} further occurrence(s)` : ''}${input.reason ? ` · Reason: ${input.reason}` : ''}`,
    data: { reservationId: row.id, resourceId: row.resourceId, floorId: resource.floorId },
  });
  return getReservation(db, user, id);
}

function checkIn(db: DemoDb, user: AuthUser, id: string, code: string | undefined): ReservationDto {
  const isAdmin = user.permissions.includes('reservation:manage-any');
  const now = Date.now();
  const row = db.reservations.find((r) => r.id === id);
  if (!row) throw DemoError.notFound('Reservation');
  const isOwner = row.userId === user.id;
  const codeMatches = !!code && code.replace(/\s/g, '').toUpperCase() === row.checkInCode.toUpperCase();
  if (!isOwner && !isAdmin && !codeMatches) throw DemoError.forbidden('Invalid check-in code.');
  if (code && !codeMatches && !isAdmin) throw DemoError.badRequest('The check-in code does not match this booking.');
  if (row.status === 'CHECKED_IN') return getReservation(db, user, id, { verifiedByCode: codeMatches });
  if (row.status !== 'CONFIRMED') throw DemoError.policy(`Cannot check in to a ${row.status.toLowerCase().replace('_', ' ')} booking.`);
  const resource = db.resources.find((r) => r.id === row.resourceId)!;
  const policy = resolvePolicy(db, resource.buildingId, row.type);
  if (now < ms(row.startAt) - policy.checkInOpensMinutesBefore * 60000) throw DemoError.policy(`Check-in opens ${policy.checkInOpensMinutesBefore} minutes before the booking starts.`);
  if (now >= ms(row.endAt)) throw DemoError.policy('This booking has already ended.');
  const method = codeMatches ? 'QR' : isAdmin && !isOwner ? 'ADMIN' : 'MANUAL';
  Object.assign(row, { status: 'CHECKED_IN', checkedInAt: iso(now), updatedAt: iso(now) });
  db.checkIns.push({ id: uuid(), reservationId: id, userId: user.id, method, kind: 'IN', at: iso(now) });
  audit(db, { actorId: user.id, action: 'reservation.check-in', entityType: 'Reservation', entityId: id, after: { method: codeMatches ? 'QR' : 'MANUAL' } });
  return getReservation(db, user, id, { verifiedByCode: codeMatches });
}

function checkOut(db: DemoDb, user: AuthUser, id: string): ReservationDto {
  const isAdmin = user.permissions.includes('reservation:manage-any');
  const now = Date.now();
  const row = db.reservations.find((r) => r.id === id);
  if (!row || (!isAdmin && row.userId !== user.id)) throw DemoError.notFound('Reservation');
  if (row.status !== 'CHECKED_IN') throw DemoError.policy('Only a checked-in booking can be checked out.');
  Object.assign(row, { status: 'COMPLETED', checkedOutAt: iso(now), endAt: now < ms(row.endAt) ? iso(now) : row.endAt, updatedAt: iso(now) });
  db.checkIns.push({ id: uuid(), reservationId: id, userId: user.id, method: 'MANUAL', kind: 'OUT', at: iso(now) });
  audit(db, { actorId: user.id, action: 'reservation.check-out', entityType: 'Reservation', entityId: id });
  return getReservation(db, user, id);
}

function decideApproval(db: DemoDb, user: AuthUser, id: string, decision: 'APPROVED' | 'REJECTED', note: string | undefined): ReservationDto {
  const row = db.reservations.find((r) => r.id === id);
  if (!row || !row.approval) throw DemoError.notFound('Approval request');
  if (row.approval.status !== 'PENDING') throw DemoError.conflict('This request has already been decided.');
  if (row.userId === user.id) throw DemoError.forbidden('You cannot approve your own request.');
  const nowIso = iso(Date.now());
  Object.assign(row.approval, { status: decision, approverId: user.id, decisionNote: note ?? null, decidedAt: nowIso });
  Object.assign(row, { status: decision === 'APPROVED' ? 'CONFIRMED' : 'REJECTED', updatedAt: nowIso });
  audit(db, { actorId: user.id, action: `approval.${decision.toLowerCase()}`, entityType: 'Reservation', entityId: id, after: { decision, note } });
  const resource = db.resources.find((r) => r.id === row.resourceId)!;
  notify(db, {
    userId: row.userId,
    type: 'APPROVAL_DECIDED',
    title: `Booking ${decision === 'APPROVED' ? 'approved' : 'rejected'}: ${resource.name}`,
    body: `${formatRange(new Date(row.startAt), new Date(row.endAt), row.timezone)}${note ? ` · ${note}` : ''}`,
    data: { reservationId: id, resourceId: row.resourceId, floorId: resource.floorId },
  });
  return getReservation(db, user, id);
}

// ---------------------------------------------------------------------------
// QR + calendar file (no server-side libraries in the browser)
// ---------------------------------------------------------------------------

const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A check-in card showing the code. The demo has no QR encoder; the code works the same way. */
function checkInCard(code: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320"><rect width="320" height="320" rx="24" fill="#EEF2FF"/><rect x="16" y="16" width="288" height="288" rx="16" fill="none" stroke="#4F46E5" stroke-width="4" stroke-dasharray="10 8"/><text x="160" y="120" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="18" fill="#3730A3">Check-in code</text><text x="160" y="180" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="44" font-weight="700" letter-spacing="4" fill="#172033">${escapeXml(code)}</text><text x="160" y="232" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="14" fill="#64748B">Demo mode: enter this code to check in</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function icsDate(isoStr: string): string {
  return isoStr.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function buildIcs(dto: ReservationDto, organizer: string): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SpaceFlow//Demo//EN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${dto.id}@spaceflow.demo`,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(dto.startAt)}`,
    `DTEND:${icsDate(dto.endAt)}`,
    `SUMMARY:${(dto.title ?? `${dto.resourceName} (${dto.resourceCode})`).replace(/[,;]/g, '\\$&')}`,
    `LOCATION:${`${dto.resourceName}, ${dto.floorName}, ${dto.buildingName}`.replace(/[,;]/g, '\\$&')}`,
    `DESCRIPTION:${dto.resourceType === 'SEAT' ? 'Desk' : 'Meeting room'} booking in SpaceFlow. Check-in code: ${dto.checkInCode ?? 'n/a'}`,
    `ORGANIZER:mailto:${organizer}`,
    ...dto.attendees.filter((a) => a.email).map((a) => `ATTENDEE:mailto:${a.email}`),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const reservationRoutes: Route[] = [
  get('/reservations', ({ db, user, query }) => listReservations(db, user, reservationListQuerySchema.parse(query), { ownOnly: !user.permissions.includes('reservation:manage-any') })),
  get('/reservations/approvals', (ctx) => {
    requirePermission(ctx, 'reservation:approve');
    const q = paginationQuerySchema.parse(ctx.query);
    const rows = ctx.db.reservations.filter((r) => r.status === 'PENDING_APPROVAL' && r.approval?.status === 'PENDING').sort((a, b) => ms(a.startAt) - ms(b.startAt));
    return paginate(rows.map((r) => toReservationSummaryDto(ctx.db, r)), q.page, q.pageSize);
  }),
  post('/reservations', ({ db, user, body }) => {
    const result = createReservations(db, user, reservationCreateSchema.parse(body));
    return new Reply(result.created.length ? 201 : 409, result);
  }),
  get('/reservations/:id', ({ db, user, params }) => getReservation(db, user, params.id)),
  patch('/reservations/:id', ({ db, user, params, body }) => updateReservation(db, user, params.id, reservationUpdateSchema.parse(body))),
  post('/reservations/:id/cancel', ({ db, user, params, body }) => cancelReservation(db, user, params.id, reservationCancelSchema.parse(body))),
  post('/reservations/:id/check-in', ({ db, user, params, body }) => checkIn(db, user, params.id, checkInSchema.parse(body).code)),
  post('/reservations/:id/check-out', ({ db, user, params }) => checkOut(db, user, params.id)),
  post('/reservations/:id/approval', (ctx) => {
    requirePermission(ctx, 'reservation:approve');
    const { decision, note } = approvalDecisionSchema.parse(ctx.body);
    return decideApproval(ctx.db, ctx.user, ctx.params.id, decision, note);
  }),
  get('/reservations/:id/qr', ({ db, user, params }) => {
    const dto = getReservation(db, user, params.id);
    if (!dto.checkInCode) throw DemoError.forbidden();
    const url = `${location.origin}${import.meta.env.BASE_URL}check-in?reservation=${dto.id}&code=${encodeURIComponent(dto.checkInCode)}`;
    return { reservationId: dto.id, code: dto.checkInCode, url, dataUrl: checkInCard(dto.checkInCode) };
  }),
  get('/reservations/:id/ics', ({ db, user, params }) => {
    const dto = getReservation(db, user, params.id);
    const owner = db.users.find((u) => u.id === dto.userId);
    return new Reply(200, buildIcs(dto, owner?.email ?? 'no-reply@spaceflow.local'), 'text/calendar; charset=utf-8');
  }),
];
