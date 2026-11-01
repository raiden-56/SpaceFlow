// "Me", directory, dashboard and search for demo mode: port of apps/api/src/modules/users,
// dashboard and search routes.
import { z } from 'zod';
import {
  favoriteCreateSchema,
  paginationQuerySchema,
  reservationListQuerySchema,
  searchQuerySchema,
  updatePreferencesSchema,
  updateProfileSchema,
  type DashboardDto,
  type FavoriteDto,
  type SearchResultsDto,
} from '@spaceflow/shared';
import { uuid } from '../db';
import {
  DemoError,
  Reply,
  computeAvailability,
  contains,
  endOfLocalDay,
  favoriteIds,
  findResource,
  findUser,
  iso,
  localDate,
  ms,
  paginate,
  startOfLocalDay,
  toCurrentUserDto,
  toNotificationDto,
  toReservationSummaryDto,
  toResourceDto,
  toUserSummaryDto,
} from '../core';
import { listReservations } from './reservations';
import { del, get, patch, post, type Route } from '../router';

const notifQuery = paginationQuerySchema.extend({ unreadOnly: z.enum(['true', 'false']).optional() });
const directoryQuery = paginationQuerySchema.extend({ q: z.string().max(100).optional(), departmentId: z.string().uuid().optional(), teamId: z.string().uuid().optional() });
const dashQuery = z.object({ buildingId: z.string().uuid().optional(), startAt: z.string().datetime({ offset: true }).optional(), endAt: z.string().datetime({ offset: true }).optional() });

/** Distinct resource ids from the user's bookings, newest booking first. */
function recentResourceIds(db: Parameters<typeof favoriteIds>[0], userId: string, limit: number): string[] {
  const ids: string[] = [];
  for (const r of db.reservations.filter((x) => x.userId === userId).sort((a, b) => ms(b.createdAt) - ms(a.createdAt))) {
    if (!ids.includes(r.resourceId)) ids.push(r.resourceId);
    if (ids.length >= limit) break;
  }
  return ids;
}

export const userRoutes: Route[] = [
  patch('/users/me', ({ db, user, body }) => {
    const me = findUser(db, user.id)!;
    Object.assign(me, updateProfileSchema.parse(body));
    return toCurrentUserDto(db, me);
  }),
  patch('/users/me/preferences', ({ db, user, body }) => {
    const me = findUser(db, user.id)!;
    const input = updatePreferencesSchema.parse(body);
    for (const [k, v] of Object.entries(input)) if (v !== undefined) (me.preferences as unknown as Record<string, unknown>)[k] = v;
    return toCurrentUserDto(db, me);
  }),
  get('/users/me/reservations', ({ db, user, query }) => listReservations(db, user, reservationListQuerySchema.parse(query), { ownOnly: true })),
  get('/users/me/favorites', ({ db, user }) =>
    db.favorites
      .filter((f) => f.userId === user.id && findResource(db, f.resourceId))
      .sort((a, b) => ms(b.createdAt) - ms(a.createdAt))
      .map((f): FavoriteDto => ({ id: f.id, resource: toResourceDto(db, findResource(db, f.resourceId)!, { isFavorite: true }), createdAt: f.createdAt })),
  ),
  post('/users/me/favorites', ({ db, user, body }) => {
    const { resourceId } = favoriteCreateSchema.parse(body);
    const resource = findResource(db, resourceId);
    if (!resource) throw DemoError.notFound('Resource');
    let fav = db.favorites.find((f) => f.userId === user.id && f.resourceId === resourceId);
    if (!fav) {
      fav = { id: uuid(), userId: user.id, resourceId, createdAt: iso(Date.now()) };
      db.favorites.push(fav);
    }
    return new Reply(201, { id: fav.id, resource: toResourceDto(db, resource, { isFavorite: true }), createdAt: fav.createdAt } satisfies FavoriteDto);
  }),
  del('/users/me/favorites/:id', ({ db, user, params }) => {
    db.favorites = db.favorites.filter((f) => !(f.userId === user.id && (f.id === params.id || f.resourceId === params.id)));
    return new Reply(204);
  }),
  get('/users/me/notifications', ({ db, user, query }) => {
    const q = notifQuery.parse(query);
    const mine = db.notifications.filter((n) => n.userId === user.id).sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
    const rows = q.unreadOnly === 'true' ? mine.filter((n) => !n.readAt) : mine;
    return { ...paginate(rows.map(toNotificationDto), q.page, q.pageSize), unread: mine.filter((n) => !n.readAt).length };
  }),
  post('/users/me/notifications/read-all', ({ db, user }) => {
    const now = iso(Date.now());
    for (const n of db.notifications) if (n.userId === user.id && !n.readAt) n.readAt = now;
    return { ok: true };
  }),
  post('/users/me/notifications/:id/read', ({ db, user, params }) => {
    const n = db.notifications.find((x) => x.id === params.id && x.userId === user.id);
    if (n && !n.readAt) n.readAt = iso(Date.now());
    return { ok: true };
  }),
  del('/users/me/notifications/:id', ({ db, user, params }) => {
    db.notifications = db.notifications.filter((n) => !(n.id === params.id && n.userId === user.id));
    return new Reply(204);
  }),
  get('/users/me/recent-resources', ({ db, user }) => {
    const favs = favoriteIds(db, user.id);
    return recentResourceIds(db, user.id, 50)
      .map((id) => findResource(db, id))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .slice(0, 6)
      .map((r) => toResourceDto(db, r, { isFavorite: favs.has(r.id) }));
  }),
  get('/users/me/audit', ({ db, user }) =>
    db.audit
      .filter((a) => a.actorId === user.id && a.action.startsWith('auth.'))
      .sort((a, b) => ms(b.createdAt) - ms(a.createdAt))
      .slice(0, 20)
      .map((a) => ({ id: a.id, action: a.action, ip: a.ip, createdAt: a.createdAt })),
  ),
  get('/users/directory', ({ db, query }) => {
    const q = directoryQuery.parse(query);
    const rows = db.users
      .filter((u) => u.status === 'ACTIVE' && !u.deletedAt && (!q.departmentId || u.departmentId === q.departmentId) && (!q.teamId || u.teamId === q.teamId))
      .filter((u) => !q.q || contains(u.firstName, q.q) || contains(u.lastName, q.q) || contains(u.email, q.q) || contains(u.jobTitle, q.q))
      .sort((a, b) => a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName));
    return paginate(rows.map((u) => toUserSummaryDto(db, u)), q.page, q.pageSize);
  }),
  get('/users/directory/:id/today', ({ db, user, params }) => {
    const colleague = db.users.find((u) => u.id === params.id && u.status === 'ACTIVE');
    if (!colleague) throw DemoError.notFound('Employee');
    const isAdmin = user.permissions.includes('reservation:manage-any');
    if (!colleague.preferences.shareLocationWithTeam && !isAdmin && colleague.id !== user.id) return { user: toUserSummaryDto(db, colleague), shared: false, seat: null };
    const now = Date.now();
    const seat = db.reservations
      .filter((r) => r.userId === colleague.id && r.type === 'SEAT' && ['CONFIRMED', 'CHECKED_IN'].includes(r.status) && ms(r.endAt) > now && ms(r.startAt) < now + 24 * 3600000)
      .sort((a, b) => ms(a.startAt) - ms(b.startAt))[0];
    const resource = seat ? db.resources.find((r) => r.id === seat.resourceId) : undefined;
    return {
      user: toUserSummaryDto(db, colleague),
      shared: true,
      seat: seat && resource ? { reservationId: seat.id, startAt: seat.startAt, endAt: seat.endAt, resource: toResourceDto(db, resource) } : null,
    };
  }),

  // ---------------- Dashboard ----------------
  get('/dashboard', ({ db, user, query }) => {
    const q = dashQuery.parse(query);
    const now = new Date();
    const nowMs = now.getTime();
    const me = findUser(db, user.id)!;
    const buildingId = q.buildingId ?? me.preferences.defaultBuildingId ?? me.homeBuildingId ?? null;
    const building = buildingId ? db.buildings.find((b) => b.id === buildingId) : undefined;
    const tz = building?.timezone ?? 'UTC';
    const today = localDate(now, tz);
    const dayStart = startOfLocalDay(today, tz).getTime();
    const dayEnd = endOfLocalDay(today, tz).getTime();
    const windowStart = q.startAt ? new Date(q.startAt) : now;
    const windowEnd = q.endAt ? new Date(q.endAt) : new Date(nowMs + 60 * 60000);
    const live = ['CONFIRMED', 'CHECKED_IN', 'PENDING_APPROVAL'];
    const mine = db.reservations.filter((r) => r.userId === user.id);
    const byStart = (a: { startAt: string }, b: { startAt: string }) => ms(a.startAt) - ms(b.startAt);
    const todaySeat = mine.filter((r) => r.type === 'SEAT' && live.includes(r.status) && ms(r.startAt) < dayEnd && ms(r.endAt) > Math.max(dayStart, nowMs)).sort(byStart)[0];
    const todayMeetings = mine.filter((r) => r.type === 'MEETING_ROOM' && live.includes(r.status) && ms(r.startAt) >= dayStart && ms(r.startAt) < dayEnd).sort(byStart);
    const upcoming = mine.filter((r) => live.includes(r.status) && ms(r.endAt) > nowMs).sort(byStart).slice(0, 6);
    const recent = mine.filter((r) => ms(r.endAt) <= nowMs).sort((a, b) => byStart(b, a)).slice(0, 5);
    const favorites = db.favorites.filter((f) => f.userId === user.id && findResource(db, f.resourceId)).sort((a, b) => ms(b.createdAt) - ms(a.createdAt)).slice(0, 6);
    const recentIds = recentResourceIds(db, user.id, 8);
    const announcements = db.announcements
      .filter((a) => ms(a.publishedAt) <= nowMs && (!a.expiresAt || ms(a.expiresAt) > nowMs) && (a.buildingId === null || a.buildingId === buildingId))
      .sort((a, b) => ms(b.publishedAt) - ms(a.publishedAt))
      .slice(0, 5);
    const resources = db.resources.filter(
      (r) => !r.deletedAt && r.status === 'ACTIVE' && r.isBookable && db.floors.find((f) => f.id === r.floorId)?.isPublished && db.buildings.find((b) => b.id === r.buildingId)?.isActive && (!buildingId || r.buildingId === buildingId),
    );
    const av = computeAvailability(db, resources, { startAt: windowStart, endAt: windowEnd, user, now });
    let availableSeats = 0;
    let availableRooms = 0;
    let checkedInNow = 0;
    let reservedNow = 0;
    for (const r of resources) {
      const a = av.get(r.id);
      if (!a) continue;
      if (a.state === 'AVAILABLE' || a.state === 'RESTRICTED') r.type === 'SEAT' ? availableSeats++ : availableRooms++;
      if (a.state === 'OCCUPIED') checkedInNow++;
      if (a.state === 'RESERVED') reservedNow++;
    }
    const favIds = new Set(favorites.map((f) => f.resourceId));
    const histIds = new Set(recentIds);
    const seatPool = resources
      .filter((r) => r.type === 'SEAT' && av.get(r.id)?.state === 'AVAILABLE')
      .sort((a, b) => Number(favIds.has(b.id)) - Number(favIds.has(a.id)) || Number(histIds.has(b.id)) - Number(histIds.has(a.id)) || a.code.localeCompare(b.code));
    const dto: DashboardDto = {
      user: { displayName: `${me.firstName} ${me.lastName}`, homeBuildingName: db.buildings.find((b) => b.id === me.homeBuildingId)?.name ?? null },
      today: { date: today, seatBooking: todaySeat ? toReservationSummaryDto(db, todaySeat) : null, meetings: todayMeetings.map((r) => toReservationSummaryDto(db, r)) },
      nextBooking: upcoming[0] ? toReservationSummaryDto(db, upcoming[0]) : null,
      upcoming: upcoming.map((r) => toReservationSummaryDto(db, r)),
      recent: recent.map((r) => toReservationSummaryDto(db, r)),
      availability: { buildingId, totalSeats: resources.filter((r) => r.type === 'SEAT').length, availableSeats, totalRooms: resources.filter((r) => r.type === 'MEETING_ROOM').length, availableRooms, checkedInNow, reservedNow },
      favorites: favorites.map((f) => toResourceDto(db, findResource(db, f.resourceId)!, { isFavorite: true })),
      recentResources: recentIds.map((id) => findResource(db, id)).filter((r): r is NonNullable<typeof r> => !!r).map((r) => toResourceDto(db, r, { isFavorite: favIds.has(r.id) })),
      suggestedSeats: seatPool.slice(0, 4).map((r) => ({ ...toResourceDto(db, r, { isFavorite: favIds.has(r.id) }), availability: av.get(r.id) })),
      announcements: announcements.map((a) => ({ id: a.id, title: a.title, body: a.body, buildingId: a.buildingId, publishedAt: a.publishedAt, expiresAt: a.expiresAt })),
      unreadNotifications: db.notifications.filter((n) => n.userId === user.id && !n.readAt).length,
    };
    return dto;
  }),

  // ---------------- Search ----------------
  get('/search', ({ db, user, query }) => {
    const { q, limit } = searchQuerySchema.parse(query);
    const term = q.trim();
    const isAdmin = user.permissions.includes('resource:manage');
    const floorOk = (floorId: string) => isAdmin || !!db.floors.find((f) => f.id === floorId)?.isPublished;
    const buildingOk = (buildingId: string) => isAdmin || !!db.buildings.find((b) => b.id === buildingId)?.isActive;
    const favs = favoriteIds(db, user.id);
    const resources = db.resources.filter((r) => !r.deletedAt && r.searchText.includes(term.toLowerCase()) && floorOk(r.floorId) && buildingOk(r.buildingId)).sort((a, b) => a.code.localeCompare(b.code));
    const out: SearchResultsDto = {
      buildings: db.buildings
        .filter((b) => !b.deletedAt && (isAdmin || b.isActive) && (contains(b.name, term) || contains(b.code, term) || contains(b.city, term)))
        .slice(0, limit)
        .map((b) => ({ id: b.id, name: b.name, code: b.code, city: b.city })),
      floors: db.floors
        .filter((f) => !f.deletedAt && floorOk(f.id) && contains(f.name, term) && !db.buildings.find((b) => b.id === f.buildingId)?.deletedAt)
        .slice(0, limit)
        .map((f) => ({ id: f.id, name: f.name, number: f.number, buildingId: f.buildingId, buildingName: db.buildings.find((b) => b.id === f.buildingId)!.name })),
      seats: resources.filter((r) => r.type === 'SEAT').slice(0, limit).map((r) => toResourceDto(db, r, { isFavorite: favs.has(r.id) })),
      rooms: resources.filter((r) => r.type === 'MEETING_ROOM').slice(0, limit).map((r) => toResourceDto(db, r, { isFavorite: favs.has(r.id) })),
      amenities: db.amenities
        .filter((a) => contains(a.name, term) || contains(a.code, term))
        .slice(0, limit)
        .map((a) => ({ id: a.id, name: a.name, resourceCount: db.resources.filter((r) => !r.deletedAt && r.amenityIds.includes(a.id)).length })),
      facilities: db.mapObjects
        .filter((o) => !o.resourceId && contains(o.label, term))
        .map((o) => {
          const plan = db.floorPlans.find((p) => p.id === o.floorPlanId);
          const floor = plan ? db.floors.find((f) => f.id === plan.floorId && !f.deletedAt) : undefined;
          return floor && floorOk(floor.id) ? { o, floor } : null;
        })
        .filter((x): x is NonNullable<typeof x> => !!x)
        .slice(0, limit)
        .map(({ o, floor }) => {
          const b = db.buildings.find((x) => x.id === floor.buildingId)!;
          return { id: o.id, label: o.label ?? o.kind, kind: o.kind, floorId: floor.id, floorName: floor.name, buildingId: b.id, buildingName: b.name };
        }),
      employees: user.permissions.includes('user:read')
        ? db.users
            .filter((u) => u.status === 'ACTIVE' && !u.deletedAt && (contains(u.firstName, term) || contains(u.lastName, term) || contains(u.email, term) || contains(u.jobTitle, term)))
            .slice(0, limit)
            .map((u) => toUserSummaryDto(db, u))
        : [],
    };
    return out;
  }),
];
