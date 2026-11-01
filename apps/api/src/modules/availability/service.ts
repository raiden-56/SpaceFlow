// Central availability logic. Every view (3D, 2D, list, search, booking form) and the booking
// engine use these functions so availability is computed identically everywhere.
import type { BookingPolicy, Resource } from '@prisma/client';
import type {
  AvailabilityState,
  OperatingHours,
  ResourceAvailabilityDto,
  ResourceDayAvailabilityDto,
  TimeSlotDto,
} from '@spaceflow/shared';
import { prisma, type Tx } from '../../lib/prisma.js';
import type { AuthUser } from '../../middleware/auth.js';
import { resolvePolicy } from '../policies/service.js';
import {
  dayjs,
  endOfLocalDay,
  formatRange,
  fromLocal,
  localDate,
  localWeekday,
  overlaps,
  startOfLocalDay,
  timeToMinutes,
} from '../../utils/time.js';
import { reservationSummaryInclude, toReservationSummaryDto } from '../../utils/mappers.js';

export const ACTIVE_STATUSES = ['PENDING_APPROVAL', 'CONFIRMED', 'CHECKED_IN'] as const;

export interface OperatingWindow {
  open: string;
  close: string;
}

/** Operating window for a local date: resource override first, then policy. null = closed. */
export function operatingWindowFor(
  resource: Pick<Resource, 'operatingHours'>,
  policy: Pick<BookingPolicy, 'operatingStart' | 'operatingEnd' | 'allowWeekends'>,
  weekday: number,
): OperatingWindow | null {
  const hours = resource.operatingHours as OperatingHours | null;
  if (hours && Object.keys(hours).length) {
    const day = hours[String(weekday)];
    return day ? { open: day.open, close: day.close } : null;
  }
  if (!policy.allowWeekends && (weekday === 0 || weekday === 6)) return null;
  return { open: policy.operatingStart, close: policy.operatingEnd };
}

export function checkOperatingHours(
  resource: Pick<Resource, 'operatingHours'>,
  policy: Pick<BookingPolicy, 'operatingStart' | 'operatingEnd' | 'allowWeekends'>,
  startAt: Date,
  endAt: Date,
  tz: string,
): { ok: true } | { ok: false; reason: string } {
  const startDay = localDate(startAt, tz);
  const endDay = localDate(new Date(endAt.getTime() - 1), tz);
  if (startDay !== endDay) {
    return { ok: false, reason: 'A booking must start and end on the same day. Use multi-day booking for several days.' };
  }
  const window = operatingWindowFor(resource, policy, localWeekday(startAt, tz));
  if (!window) return { ok: false, reason: 'The resource is closed on the selected day.' };
  const open = fromLocal(startDay, window.open, tz);
  const close = fromLocal(startDay, window.close, tz);
  if (startAt < open || endAt > close) {
    return { ok: false, reason: `Bookings are only allowed between ${window.open} and ${window.close} (local time).` };
  }
  return { ok: true };
}

/** Department / team restrictions. Admins with resource:manage bypass. */
export function userCanAccessResource(
  resource: Pick<Resource, 'restrictedDepartmentIds' | 'restrictedTeamIds'>,
  user: Pick<AuthUser, 'departmentId' | 'teamId' | 'permissions'> | undefined,
): boolean {
  const restricted = resource.restrictedDepartmentIds.length > 0 || resource.restrictedTeamIds.length > 0;
  if (!restricted) return true;
  if (!user) return false;
  if (user.permissions.includes('reservation:manage-any')) return true;
  if (user.departmentId && resource.restrictedDepartmentIds.includes(user.departmentId)) return true;
  if (user.teamId && resource.restrictedTeamIds.includes(user.teamId)) return true;
  return false;
}

type ResourceForAvailability = Pick<
  Resource,
  | 'id'
  | 'status'
  | 'isBookable'
  | 'requiresApproval'
  | 'restrictedDepartmentIds'
  | 'restrictedTeamIds'
  | 'operatingHours'
  | 'buildingId'
  | 'orgId'
  | 'type'
> & { floor?: { isPublished: boolean } | null; building?: { timezone: string; isActive: boolean } | null };

export interface AvailabilityOptions {
  startAt: Date;
  endAt: Date;
  user?: AuthUser;
  now?: Date;
  /** Ignore this reservation when computing conflicts (used when modifying a booking). */
  excludeReservationId?: string;
  tx?: Tx | typeof prisma;
}

/**
 * Compute availability for a batch of resources over [startAt, endAt).
 * - DISABLED: not bookable (status, floor unpublished, building inactive, maintenance)
 * - OCCUPIED: an active reservation on this resource is in progress right now
 * - RESERVED: an active reservation overlaps the requested interval
 * - RESTRICTED: bookable only with approval or for a specific group the user isn't in
 * - AVAILABLE: otherwise
 */
export async function computeAvailability(
  resources: ResourceForAvailability[],
  opts: AvailabilityOptions,
): Promise<Map<string, ResourceAvailabilityDto>> {
  const db = opts.tx ?? prisma;
  const now = opts.now ?? new Date();
  const ids = resources.map((r) => r.id);
  const result = new Map<string, ResourceAvailabilityDto>();
  if (!ids.length) return result;

  const [conflicts, maintenance] = await Promise.all([
    db.reservation.findMany({
      where: {
        resourceId: { in: ids },
        status: { in: [...ACTIVE_STATUSES] },
        startAt: { lt: opts.endAt },
        endAt: { gt: opts.startAt },
        ...(opts.excludeReservationId ? { id: { not: opts.excludeReservationId } } : {}),
      },
      select: {
        id: true,
        resourceId: true,
        startAt: true,
        endAt: true,
        status: true,
        userId: true,
        timezone: true,
        user: { select: { firstName: true, lastName: true, preferences: { select: { shareLocationWithTeam: true } } } },
      },
      orderBy: { startAt: 'asc' },
    }),
    db.maintenanceWindow.findMany({
      where: { resourceId: { in: ids }, startAt: { lt: opts.endAt }, endAt: { gt: opts.startAt } },
      select: { resourceId: true, reason: true, startAt: true, endAt: true },
    }),
  ]);

  const conflictsByResource = new Map<string, typeof conflicts>();
  for (const c of conflicts) {
    const list = conflictsByResource.get(c.resourceId) ?? [];
    list.push(c);
    conflictsByResource.set(c.resourceId, list);
  }
  const maintenanceByResource = new Map(maintenance.map((m) => [m.resourceId, m]));
  const canSeeNames = !!opts.user?.permissions.includes('reservation:manage-any');

  for (const r of resources) {
    let state: AvailabilityState = 'AVAILABLE';
    let reason: string | null = null;
    let conflicting: ResourceAvailabilityDto['conflictingReservation'] = null;

    const m = maintenanceByResource.get(r.id);
    if (r.status !== 'ACTIVE' || !r.isBookable) {
      state = 'DISABLED';
      reason = r.status === 'MAINTENANCE' ? 'Under maintenance' : 'Not bookable';
    } else if (r.floor && !r.floor.isPublished) {
      state = 'DISABLED';
      reason = 'Floor layout is not published';
    } else if (r.building && !r.building.isActive) {
      state = 'DISABLED';
      reason = 'Building is inactive';
    } else if (m) {
      state = 'DISABLED';
      reason = m.reason ? `Maintenance: ${m.reason}` : 'Scheduled maintenance';
    } else {
      const list = conflictsByResource.get(r.id) ?? [];
      if (list.length) {
        const first = list[0];
        const inProgress = list.some((c) => c.startAt <= now && c.endAt > now && (c.status === 'CHECKED_IN' || c.status === 'CONFIRMED'));
        const isMine = !!opts.user && first.userId === opts.user.id;
        state = inProgress && overlaps(first.startAt, first.endAt, now, new Date(now.getTime() + 1)) ? 'OCCUPIED' : 'RESERVED';
        const tz = first.timezone;
        const who =
          isMine ? 'you' : canSeeNames || first.user.preferences?.shareLocationWithTeam !== false ? `${first.user.firstName} ${first.user.lastName.charAt(0)}.` : 'a colleague';
        reason = `${state === 'OCCUPIED' ? 'In use' : 'Reserved'} ${formatRange(first.startAt, first.endAt, tz)} by ${who}`;
        conflicting = {
          id: first.id,
          startAt: first.startAt.toISOString(),
          endAt: first.endAt.toISOString(),
          status: first.status,
          userDisplayName: isMine || canSeeNames ? `${first.user.firstName} ${first.user.lastName}` : null,
          isMine,
        };
      } else if (!userCanAccessResource(r, opts.user)) {
        state = 'RESTRICTED';
        reason = 'Reserved for a specific department or team';
      } else if (r.requiresApproval) {
        state = 'RESTRICTED';
        reason = 'Booking requires approval';
      }
    }

    result.set(r.id, {
      resourceId: r.id,
      state,
      reason,
      canBook: state === 'AVAILABLE' || (state === 'RESTRICTED' && r.requiresApproval && userCanAccessResource(r, opts.user)),
      conflictingReservation: conflicting,
    });
  }
  return result;
}

/** Slot-by-slot availability for a resource on a given local date. */
export async function dayAvailability(
  resource: ResourceForAvailability & { building: { timezone: string; isActive: boolean } },
  date: string,
  user: AuthUser | undefined,
  slotMinutesOverride?: number,
): Promise<ResourceDayAvailabilityDto> {
  const tz = resource.building.timezone;
  const policy = await resolvePolicy(resource.orgId, resource.buildingId, resource.type);
  const slotMinutes = slotMinutesOverride ?? policy.slotMinutes;
  const dayStart = startOfLocalDay(date, tz);
  const dayEnd = endOfLocalDay(date, tz);
  const weekday = dayjs.tz(date, 'YYYY-MM-DD', tz).day();
  const window = operatingWindowFor(resource, policy, weekday);

  const reservations = await prisma.reservation.findMany({
    where: { resourceId: resource.id, status: { in: [...ACTIVE_STATUSES] }, startAt: { lt: dayEnd }, endAt: { gt: dayStart } },
    include: reservationSummaryInclude,
    orderBy: { startAt: 'asc' },
  });
  const maintenance = await prisma.maintenanceWindow.findMany({
    where: { resourceId: resource.id, startAt: { lt: dayEnd }, endAt: { gt: dayStart } },
  });

  const slots: TimeSlotDto[] = [];
  if (window) {
    const openMin = timeToMinutes(window.open);
    const closeMin = timeToMinutes(window.close);
    const now = new Date();
    for (let m = openMin; m + slotMinutes <= closeMin; m += slotMinutes) {
      const hh = String(Math.floor(m / 60)).padStart(2, '0');
      const mm = String(m % 60).padStart(2, '0');
      const s = fromLocal(date, `${hh}:${mm}`, tz);
      const e = new Date(s.getTime() + slotMinutes * 60000);
      let state: AvailabilityState = 'AVAILABLE';
      let reservationId: string | null = null;
      const hit = reservations.find((r) => overlaps(r.startAt, r.endAt, s, e));
      if (resource.status !== 'ACTIVE' || !resource.isBookable || maintenance.some((w) => overlaps(w.startAt, w.endAt, s, e))) {
        state = 'DISABLED';
      } else if (hit) {
        state = hit.startAt <= now && hit.endAt > now ? 'OCCUPIED' : 'RESERVED';
        reservationId = hit.id;
      } else if (e <= now) {
        state = 'DISABLED';
      } else if (!userCanAccessResource(resource, user) || resource.requiresApproval) {
        state = 'RESTRICTED';
      }
      slots.push({ startAt: s.toISOString(), endAt: e.toISOString(), state, reservationId });
    }
  }

  return {
    resourceId: resource.id,
    date,
    timezone: tz,
    slotMinutes,
    operatingStart: window?.open ?? null,
    operatingEnd: window?.close ?? null,
    slots,
    reservations: reservations.map(toReservationSummaryDto),
  };
}
