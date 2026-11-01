// Buildings, floors, floor maps and resources for demo mode: port of apps/api/src/modules/buildings,
// resources and availability (dayAvailability) routes.
import { z } from 'zod';
import {
  availabilityQuerySchema,
  bulkResourceUpdateSchema,
  maintenanceWindowSchema,
  resourceAvailabilityQuerySchema,
  resourceListQuerySchema,
  roomCreateSchema,
  roomUpdateSchema,
  seatCreateSchema,
  seatUpdateSchema,
  suggestSeatsQuerySchema,
  type FloorMapDto,
  type ResourceDayAvailabilityDto,
  type ResourceListQuery,
  type RoomInput,
  type SeatInput,
  type TimeSlotDto,
  type AvailabilityState,
} from '@spaceflow/shared';
import { dayjs } from '@/utils/time';
import { uuid, type DbResource, type DemoDb } from '../db';
import {
  DemoError,
  Reply,
  assetUrl,
  audit,
  buildSearchText,
  computeAvailability,
  endOfLocalDay,
  favoriteIds,
  findBuilding,
  findFloor,
  findResource,
  fromLocal,
  iso,
  isActiveStatus,
  ms,
  notify,
  operatingWindowFor,
  overlaps,
  paginate,
  requirePermission,
  resolvePolicy,
  startOfLocalDay,
  timeToMinutes,
  toBuildingDto,
  toFloorDto,
  toMapObjectDto,
  toReservationSummaryDto,
  toResourceDto,
  toZoneDto,
  userCanAccessResource,
  type AuthUser,
  type Ctx,
} from '../core';
import { del, get, patch, post, type Route } from '../router';

const canManageBuildings = (ctx: Ctx) => ctx.user.permissions.includes('building:manage');
const canManageResources = (ctx: Ctx) => ctx.user.permissions.includes('resource:manage');

/** Resources visible to the user: admins also see unpublished floors and inactive buildings. */
function visible(db: DemoDb, r: DbResource, admin: boolean): boolean {
  if (r.deletedAt) return false;
  if (admin) return true;
  return !!db.floors.find((f) => f.id === r.floorId)?.isPublished && !!db.buildings.find((b) => b.id === r.buildingId)?.isActive;
}

function listResources(ctx: Ctx, q: ResourceListQuery, forcedType?: 'SEAT' | 'MEETING_ROOM') {
  const { db, user } = ctx;
  const admin = canManageResources(ctx);
  const type = forcedType ?? q.type;
  const attrKeys = ['nearWindow', 'nearElevator', 'monitor', 'dockingStation', 'heightAdjustable', 'quietZone'] as const;
  let rows = db.resources.filter((r) => {
    if (!visible(db, r, admin)) return false;
    if (type && r.type !== type) return false;
    if (q.buildingId && r.buildingId !== q.buildingId) return false;
    if (q.floorId && r.floorId !== q.floorId) return false;
    if (q.zoneId && r.zoneId !== q.zoneId) return false;
    if (q.status && r.status !== q.status) return false;
    if (q.minCapacity && !((r.capacity ?? 0) >= q.minCapacity)) return false;
    if (q.q && !r.searchText.includes(q.q.toLowerCase())) return false;
    const attrs = (r.seatAttributes ?? {}) as Record<string, boolean | undefined>;
    for (const k of attrKeys) if (q[k] && !attrs[k]) return false;
    if (q.accessible && !(r.accessible || attrs.accessible)) return false;
    if (q.amenityIds?.length && !q.amenityIds.every((a) => r.amenityIds.includes(a))) return false;
    return true;
  });
  // "Near my team": seats on floors/zones where teammates have a seat booked in the same window.
  if (q.nearTeam && q.startAt && q.endAt && user.teamId) {
    const s = ms(q.startAt);
    const e = ms(q.endAt);
    const mates = db.reservations.filter((r) => {
      if (r.type !== 'SEAT' || !['CONFIRMED', 'CHECKED_IN'].includes(r.status) || !overlaps(ms(r.startAt), ms(r.endAt), s, e)) return false;
      const u = db.users.find((x) => x.id === r.userId);
      return !!u && u.teamId === user.teamId && u.id !== user.id && u.preferences.shareLocationWithTeam;
    });
    const seats = mates.map((m) => db.resources.find((x) => x.id === m.resourceId)!).filter(Boolean);
    const zoneIds = new Set(seats.map((x) => x.zoneId).filter((z): z is string => !!z));
    const floorIds = new Set(seats.map((x) => x.floorId));
    rows = zoneIds.size ? rows.filter((r) => r.zoneId && zoneIds.has(r.zoneId)) : floorIds.size ? rows.filter((r) => floorIds.has(r.floorId)) : [];
  }
  const sortBy = q.sortBy ?? 'code';
  const dir = (q.sortDir ?? 'asc') === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    const av = a[sortBy] ?? '';
    const bv = b[sortBy] ?? '';
    return dir * (typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv)));
  });
  const favs = favoriteIds(db, user.id);
  if (q.startAt && q.endAt) {
    const av = computeAvailability(db, rows, { startAt: new Date(q.startAt), endAt: new Date(q.endAt), user });
    let dtos = rows.map((r) => ({ ...toResourceDto(db, r, { isFavorite: favs.has(r.id) }), availability: av.get(r.id) }));
    if (q.availableOnly) dtos = dtos.filter((d) => d.availability?.canBook);
    return paginate(dtos, q.page, q.pageSize);
  }
  return paginate(rows.map((r) => toResourceDto(db, r, { isFavorite: favs.has(r.id) })), q.page, q.pageSize);
}

function dayAvailability(db: DemoDb, resource: DbResource, date: string, user: AuthUser, slotMinutesOverride?: number): ResourceDayAvailabilityDto {
  const tz = db.buildings.find((b) => b.id === resource.buildingId)!.timezone;
  const policy = resolvePolicy(db, resource.buildingId, resource.type);
  const slotMinutes = slotMinutesOverride ?? policy.slotMinutes;
  const dayStart = startOfLocalDay(date, tz).getTime();
  const dayEnd = endOfLocalDay(date, tz).getTime();
  const window = operatingWindowFor(resource, policy, dayjs.tz(date, 'YYYY-MM-DD', tz).day());
  const reservations = db.reservations
    .filter((r) => r.resourceId === resource.id && isActiveStatus(r.status) && overlaps(ms(r.startAt), ms(r.endAt), dayStart, dayEnd))
    .sort((a, b) => ms(a.startAt) - ms(b.startAt));
  const maintenance = db.maintenance.filter((m) => m.resourceId === resource.id && overlaps(ms(m.startAt), ms(m.endAt), dayStart, dayEnd));
  const slots: TimeSlotDto[] = [];
  if (window) {
    const now = Date.now();
    for (let m = timeToMinutes(window.open); m + slotMinutes <= timeToMinutes(window.close); m += slotMinutes) {
      const s = fromLocal(date, `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, tz).getTime();
      const e = s + slotMinutes * 60000;
      let state: AvailabilityState = 'AVAILABLE';
      let reservationId: string | null = null;
      const hit = reservations.find((r) => overlaps(ms(r.startAt), ms(r.endAt), s, e));
      if (resource.status !== 'ACTIVE' || !resource.isBookable || maintenance.some((w) => overlaps(ms(w.startAt), ms(w.endAt), s, e))) state = 'DISABLED';
      else if (hit) {
        state = ms(hit.startAt) <= now && ms(hit.endAt) > now ? 'OCCUPIED' : 'RESERVED';
        reservationId = hit.id;
      } else if (e <= now) state = 'DISABLED';
      else if (!userCanAccessResource(resource, user) || resource.requiresApproval) state = 'RESTRICTED';
      slots.push({ startAt: iso(s), endAt: iso(e), state, reservationId });
    }
  }
  return { resourceId: resource.id, date, timezone: tz, slotMinutes, operatingStart: window?.open ?? null, operatingEnd: window?.close ?? null, slots, reservations: reservations.map((r) => toReservationSummaryDto(db, r)) };
}

function upsertResource(ctx: Ctx, type: 'SEAT' | 'MEETING_ROOM', input: Partial<SeatInput & RoomInput>, existingId?: string) {
  const { db, user } = ctx;
  const existing = existingId ? db.resources.find((r) => r.id === existingId && r.type === type && !r.deletedAt) : undefined;
  if (existingId && !existing) throw DemoError.notFound(type === 'SEAT' ? 'Seat' : 'Meeting room');
  const floorId = input.floorId ?? existing!.floorId;
  const floor = findFloor(db, floorId);
  if (!floor) throw DemoError.badRequest('Floor not found');
  const building = db.buildings.find((b) => b.id === floor.buildingId)!;
  if (input.zoneId && !db.zones.some((z) => z.id === input.zoneId && z.floorId === floorId)) throw DemoError.badRequest('Zone does not belong to the selected floor');
  const code = input.code ?? existing!.code;
  if (db.resources.some((r) => r.id !== existing?.id && !r.deletedAt && r.code.toLowerCase() === code.toLowerCase())) throw DemoError.conflict(`A resource with code ${code} already exists.`);
  const name = input.name ?? existing!.name;
  const nowIso = iso(Date.now());
  const prevAttrs = (existing?.seatAttributes ?? null) as Record<string, boolean> | null;
  const row: DbResource = {
    id: existing?.id ?? uuid(),
    buildingId: floor.buildingId,
    floorId,
    zoneId: input.zoneId === undefined ? existing?.zoneId ?? null : input.zoneId,
    type,
    code,
    name,
    description: input.description === undefined ? existing?.description ?? null : input.description,
    status: input.status ?? existing?.status ?? 'ACTIVE',
    isBookable: input.isBookable ?? existing?.isBookable ?? true,
    requiresApproval: input.requiresApproval ?? existing?.requiresApproval ?? false,
    capacity: type === 'MEETING_ROOM' ? input.capacity ?? existing?.capacity ?? 4 : null,
    seatType: type === 'SEAT' ? input.seatType ?? existing?.seatType ?? 'WORKSTATION' : null,
    roomType: type === 'MEETING_ROOM' ? input.roomType ?? existing?.roomType ?? 'MEETING' : null,
    accessible: type === 'MEETING_ROOM' ? input.accessible ?? existing?.accessible ?? false : !!(input.seatAttributes?.accessible ?? prevAttrs?.accessible),
    seatAttributes: type === 'SEAT' ? (input.seatAttributes ?? existing?.seatAttributes ?? {}) : null,
    amenityIds: input.amenityIds ?? existing?.amenityIds ?? [],
    operatingHours: input.operatingHours === undefined ? existing?.operatingHours ?? null : input.operatingHours,
    maxDurationMinutes: input.maxDurationMinutes === undefined ? existing?.maxDurationMinutes ?? null : input.maxDurationMinutes,
    checkInRequired: input.checkInRequired === undefined ? existing?.checkInRequired ?? null : input.checkInRequired,
    restrictedDepartmentIds: input.restrictedDepartmentIds ?? existing?.restrictedDepartmentIds ?? [],
    restrictedTeamIds: input.restrictedTeamIds ?? existing?.restrictedTeamIds ?? [],
    searchText: buildSearchText([code, name, input.description ?? existing?.description, floor.name, building.name]),
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
    deletedAt: null,
  };
  if (existing) Object.assign(existing, row);
  else db.resources.push(row);
  audit(db, { actorId: user.id, action: existing ? 'resource.update' : 'resource.create', entityType: 'Resource', entityId: row.id, after: row });
  if (existing && row.status !== 'ACTIVE') {
    for (const a of db.reservations.filter((r) => r.resourceId === row.id && ['CONFIRMED', 'PENDING_APPROVAL'].includes(r.status) && ms(r.startAt) > Date.now())) {
      notify(db, { userId: a.userId, type: 'RESOURCE_MAINTENANCE', title: `${row.name} is now ${row.status.toLowerCase()}`, body: 'One of your upcoming bookings may be affected. Please review it.', data: { reservationId: a.id, resourceId: row.id } });
    }
  }
  return toResourceDto(db, existing ?? row);
}

function deleteResource(ctx: Ctx, type: 'SEAT' | 'MEETING_ROOM', id: string) {
  requirePermission(ctx, 'resource:manage');
  const { db, user } = ctx;
  const row = db.resources.find((r) => r.id === id && r.type === type && !r.deletedAt);
  if (!row) throw DemoError.notFound(type === 'SEAT' ? 'Seats' : 'Meeting Rooms');
  const now = Date.now();
  for (const u of db.reservations.filter((r) => r.resourceId === id && isActiveStatus(r.status) && ms(r.endAt) > now)) {
    Object.assign(u, { status: 'CANCELLED', cancelledAt: iso(now), cancelledById: user.id, cancelReason: `${row.name} was removed by an administrator`, updatedAt: iso(now) });
    notify(db, { userId: u.userId, type: 'BOOKING_CANCELLED', title: `Booking cancelled: ${row.name}`, body: 'The resource was removed by an administrator.', data: { reservationId: u.id } });
  }
  Object.assign(row, { deletedAt: iso(now), status: 'DISABLED', isBookable: false, code: `${row.code}~${now.toString(36)}` });
  for (const o of db.mapObjects) if (o.resourceId === id) o.resourceId = null;
  audit(db, { actorId: user.id, action: 'resource.delete', entityType: 'Resource', entityId: id, before: row });
  return new Reply(204);
}

const teammatesQuery = z.object({
  buildingId: z.string().uuid().optional(),
  floorId: z.string().uuid().optional(),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
});
const mapQuery = z.object({ startAt: z.string().datetime({ offset: true }).optional(), endAt: z.string().datetime({ offset: true }).optional() });

export const workplaceRoutes: Route[] = [
  // ---------------- Buildings + floors ----------------
  get('/buildings', (ctx) => {
    const admin = canManageBuildings(ctx);
    return ctx.db.buildings.filter((b) => !b.deletedAt && (admin || b.isActive)).sort((a, b) => a.name.localeCompare(b.name)).map((b) => toBuildingDto(ctx.db, b));
  }),
  get('/buildings/:id', (ctx) => {
    const b = findBuilding(ctx.db, ctx.params.id);
    if (!b || (!b.isActive && !canManageBuildings(ctx))) throw DemoError.notFound('Building');
    return toBuildingDto(ctx.db, b);
  }),
  get('/buildings/:id/floors', (ctx) => {
    if (!findBuilding(ctx.db, ctx.params.id)) throw DemoError.notFound('Building');
    const admin = canManageBuildings(ctx);
    return ctx.db.floors
      .filter((f) => f.buildingId === ctx.params.id && !f.deletedAt && (admin || f.isPublished))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.number - b.number)
      .map((f) => toFloorDto(ctx.db, f));
  }),
  get('/floors/:id', (ctx) => {
    const f = findFloor(ctx.db, ctx.params.id);
    if (!f || (!f.isPublished && !canManageBuildings(ctx))) throw DemoError.notFound('Floor');
    return toFloorDto(ctx.db, f);
  }),
  get('/floors/:id/map', (ctx) => {
    const { db, user } = ctx;
    const q = mapQuery.parse(ctx.query);
    const floor = findFloor(db, ctx.params.id);
    if (!floor || (!floor.isPublished && !canManageBuildings(ctx))) throw DemoError.notFound('Floor');
    const building = db.buildings.find((b) => b.id === floor.buildingId)!;
    const plan = db.floorPlans.find((p) => p.floorId === floor.id);
    const resources = db.resources.filter((r) => r.floorId === floor.id && !r.deletedAt).sort((a, b) => a.code.localeCompare(b.code));
    const favs = favoriteIds(db, user.id);
    const dtos = resources.map((r) => toResourceDto(db, r, { isFavorite: favs.has(r.id) }));
    if (q.startAt && q.endAt) {
      const av = computeAvailability(db, resources, { startAt: new Date(q.startAt), endAt: new Date(q.endAt), user });
      for (const d of dtos) d.availability = av.get(d.id);
    }
    const payload: FloorMapDto = {
      floor: toFloorDto(db, floor),
      building: { id: building.id, name: building.name, code: building.code, timezone: building.timezone },
      plan: plan ? { id: plan.id, widthM: plan.widthM, depthM: plan.depthM, status: plan.status, version: plan.version, imageUrl: assetUrl(plan.imageAssetId), modelUrl: assetUrl(plan.modelAssetId), publishedAt: plan.publishedAt } : null,
      objects: plan ? db.mapObjects.filter((o) => o.floorPlanId === plan.id).map(toMapObjectDto) : [],
      resources: dtos,
      zones: db.zones.filter((z) => z.floorId === floor.id).map(toZoneDto),
    };
    return payload;
  }),

  // ---------------- Resources ----------------
  get('/resources', (ctx) => listResources(ctx, resourceListQuerySchema.parse(ctx.query))),
  get('/seats', (ctx) => listResources(ctx, resourceListQuerySchema.parse(ctx.query), 'SEAT')),
  get('/meeting-rooms', (ctx) => listResources(ctx, resourceListQuerySchema.parse(ctx.query), 'MEETING_ROOM')),
  get('/resources/availability', ({ db, user, query }) => {
    const q = availabilityQuerySchema.parse(query);
    const startAt = new Date(q.startAt);
    const endAt = new Date(q.endAt);
    if (endAt <= startAt) throw DemoError.invalidTime('endAt must be after startAt');
    const rows = db.resources.filter((r) => !r.deletedAt && (!q.floorId || r.floorId === q.floorId) && (!q.buildingId || r.buildingId === q.buildingId) && (!q.type || r.type === q.type) && (!q.resourceIds?.length || q.resourceIds.includes(r.id)));
    const av = computeAvailability(db, rows, { startAt, endAt, user });
    return { startAt: startAt.toISOString(), endAt: endAt.toISOString(), items: [...av.values()] };
  }),
  get('/resources/suggest', ({ db, user, query }) => {
    const q = suggestSeatsQuerySchema.parse(query);
    const me = db.users.find((u) => u.id === user.id)!;
    const favs = favoriteIds(db, user.id);
    const history = db.reservations.filter((r) => r.userId === user.id && r.type === 'SEAT').sort((a, b) => ms(b.createdAt) - ms(a.createdAt)).slice(0, 30);
    const buildingId = q.buildingId ?? me.preferences.defaultBuildingId ?? me.homeBuildingId ?? undefined;
    const rows = db.resources.filter((r) => r.type === 'SEAT' && r.status === 'ACTIVE' && r.isBookable && visible(db, r, false) && (!buildingId || r.buildingId === buildingId) && (!q.floorId || r.floorId === q.floorId));
    const av = computeAvailability(db, rows, { startAt: new Date(q.startAt), endAt: new Date(q.endAt), user });
    const histCount = new Map<string, number>();
    const zoneCount = new Map<string, number>();
    for (const h of history) {
      histCount.set(h.resourceId, (histCount.get(h.resourceId) ?? 0) + 1);
      const zoneId = db.resources.find((r) => r.id === h.resourceId)?.zoneId;
      if (zoneId) zoneCount.set(zoneId, (zoneCount.get(zoneId) ?? 0) + 1);
    }
    return rows
      .filter((r) => av.get(r.id)?.state === 'AVAILABLE')
      .map((r) => {
        const attrs = (r.seatAttributes ?? {}) as Record<string, boolean | undefined>;
        let score = 0;
        if (favs.has(r.id)) score += 50;
        score += (histCount.get(r.id) ?? 0) * 10;
        if (r.zoneId) score += (zoneCount.get(r.zoneId) ?? 0) * 3;
        if (r.floorId === me.preferences.defaultFloorId) score += 5;
        if (attrs.monitor) score += 2;
        if (attrs.dockingStation) score += 2;
        if (attrs.nearWindow) score += 1;
        return { r, score };
      })
      .sort((a, b) => b.score - a.score || a.r.code.localeCompare(b.r.code))
      .slice(0, q.limit)
      .map(({ r }) => ({ ...toResourceDto(db, r, { isFavorite: favs.has(r.id) }), availability: av.get(r.id) }));
  }),
  get('/resources/teammates', ({ db, user, query }) => {
    const q = teammatesQuery.parse(query);
    const scope = user.teamId ? (u: { teamId: string | null }) => u.teamId === user.teamId : user.departmentId ? (u: { departmentId: string | null }) => u.departmentId === user.departmentId : null;
    if (!scope) return [];
    const s = ms(q.startAt);
    const e = ms(q.endAt);
    return db.reservations
      .filter((r) => {
        if (r.type !== 'SEAT' || !['CONFIRMED', 'CHECKED_IN'].includes(r.status) || !overlaps(ms(r.startAt), ms(r.endAt), s, e)) return false;
        const res = db.resources.find((x) => x.id === r.resourceId);
        if (!res || res.deletedAt || (q.floorId && res.floorId !== q.floorId) || (q.buildingId && res.buildingId !== q.buildingId)) return false;
        const u = db.users.find((x) => x.id === r.userId);
        return !!u && u.status === 'ACTIVE' && scope(u as never) && (u.id === user.id || u.preferences.shareLocationWithTeam);
      })
      .sort((a, b) => ms(a.startAt) - ms(b.startAt))
      .slice(0, 500)
      .map((r) => {
        const u = db.users.find((x) => x.id === r.userId)!;
        const res = db.resources.find((x) => x.id === r.resourceId)!;
        return {
          userId: u.id,
          displayName: `${u.firstName} ${u.lastName}`,
          initials: `${u.firstName[0] ?? ''}${u.lastName[0] ?? ''}`.toUpperCase(),
          isMe: u.id === user.id,
          checkedIn: r.status === 'CHECKED_IN',
          resourceId: res.id,
          resourceCode: res.code,
          floorId: res.floorId,
          floorName: db.floors.find((f) => f.id === res.floorId)?.name ?? '',
          startAt: r.startAt,
          endAt: r.endAt,
        };
      });
  }),
  post('/resources/bulk', (ctx) => {
    requirePermission(ctx, 'resource:manage');
    const { resourceIds, patch: p } = bulkResourceUpdateSchema.parse(ctx.body);
    const rows = ctx.db.resources.filter((r) => resourceIds.includes(r.id) && !r.deletedAt);
    for (const r of rows) {
      if (p.status !== undefined) r.status = p.status;
      if (p.zoneId !== undefined) r.zoneId = p.zoneId;
      if (p.requiresApproval !== undefined) r.requiresApproval = p.requiresApproval;
      if (p.isBookable !== undefined) r.isBookable = p.isBookable;
      if (p.addAmenityIds?.length) r.amenityIds = [...new Set([...r.amenityIds, ...p.addAmenityIds])];
      if (p.removeAmenityIds?.length) r.amenityIds = r.amenityIds.filter((a) => !p.removeAmenityIds!.includes(a));
      r.updatedAt = iso(Date.now());
    }
    audit(ctx.db, { actorId: ctx.user.id, action: 'resource.bulk-update', entityType: 'Resource', entityId: `${rows.length} resources`, after: { resourceIds: rows.map((r) => r.id), patch: p } });
    return { updated: rows.length };
  }),
  get('/resources/:id', ({ db, user, params, query }) => {
    const row = findResource(db, params.id);
    if (!row) throw DemoError.notFound('Resource');
    const dto = toResourceDto(db, row, { isFavorite: favoriteIds(db, user.id).has(row.id) });
    if (query.startAt && query.endAt) dto.availability = computeAvailability(db, [row], { startAt: new Date(query.startAt), endAt: new Date(query.endAt), user }).get(row.id);
    return dto;
  }),
  get('/resources/:id/availability', ({ db, user, params, query }) => {
    const q = resourceAvailabilityQuerySchema.parse(query);
    const row = findResource(db, params.id);
    if (!row) throw DemoError.notFound('Resource');
    return dayAvailability(db, row, q.date, user, q.slotMinutes);
  }),
  get('/resources/:id/reservations', (ctx) => {
    requirePermission(ctx, 'resource:manage');
    return ctx.db.reservations
      .filter((r) => r.resourceId === ctx.params.id)
      .sort((a, b) => ms(b.startAt) - ms(a.startAt))
      .slice(0, 100)
      .map((r) => toReservationSummaryDto(ctx.db, r));
  }),
  get('/resources/:id/maintenance', ({ db, params }) =>
    db.maintenance
      .filter((m) => m.resourceId === params.id)
      .sort((a, b) => ms(b.startAt) - ms(a.startAt))
      .slice(0, 50)
      .map((m) => ({ id: m.id, startAt: m.startAt, endAt: m.endAt, reason: m.reason })),
  ),
  post('/resources/:id/maintenance', (ctx) => {
    requirePermission(ctx, 'resource:manage');
    const { db, user, params } = ctx;
    const input = maintenanceWindowSchema.parse(ctx.body);
    const row = findResource(db, params.id);
    if (!row) throw DemoError.notFound('Resource');
    if (ms(input.endAt) <= ms(input.startAt)) throw DemoError.invalidTime('endAt must be after startAt');
    const mw = { id: uuid(), resourceId: row.id, startAt: iso(ms(input.startAt)), endAt: iso(ms(input.endAt)), reason: input.reason ?? null };
    db.maintenance.push(mw);
    for (const a of db.reservations.filter((r) => r.resourceId === row.id && ['CONFIRMED', 'PENDING_APPROVAL'].includes(r.status) && overlaps(ms(r.startAt), ms(r.endAt), ms(mw.startAt), ms(mw.endAt)))) {
      notify(db, { userId: a.userId, type: 'RESOURCE_MAINTENANCE', title: `Maintenance scheduled for ${row.name}`, body: input.reason ?? 'Your booking overlaps a maintenance window. Please rebook.', data: { reservationId: a.id, resourceId: row.id } });
    }
    audit(db, { actorId: user.id, action: 'resource.maintenance.create', entityType: 'Resource', entityId: row.id, after: mw });
    return new Reply(201, { id: mw.id, startAt: mw.startAt, endAt: mw.endAt, reason: mw.reason });
  }),
  del('/resources/:id/maintenance/:windowId', (ctx) => {
    requirePermission(ctx, 'resource:manage');
    ctx.db.maintenance = ctx.db.maintenance.filter((m) => !(m.id === ctx.params.windowId && m.resourceId === ctx.params.id));
    return new Reply(204);
  }),

  // ---------------- Seat + room admin CRUD ----------------
  post('/seats', (ctx) => {
    requirePermission(ctx, 'resource:manage');
    return new Reply(201, upsertResource(ctx, 'SEAT', seatCreateSchema.parse(ctx.body)));
  }),
  patch('/seats/:id', (ctx) => {
    requirePermission(ctx, 'resource:manage');
    return upsertResource(ctx, 'SEAT', seatUpdateSchema.parse(ctx.body), ctx.params.id);
  }),
  del('/seats/:id', (ctx) => deleteResource(ctx, 'SEAT', ctx.params.id)),
  post('/meeting-rooms', (ctx) => {
    requirePermission(ctx, 'resource:manage');
    return new Reply(201, upsertResource(ctx, 'MEETING_ROOM', roomCreateSchema.parse(ctx.body)));
  }),
  patch('/meeting-rooms/:id', (ctx) => {
    requirePermission(ctx, 'resource:manage');
    return upsertResource(ctx, 'MEETING_ROOM', roomUpdateSchema.parse(ctx.body), ctx.params.id);
  }),
  del('/meeting-rooms/:id', (ctx) => deleteResource(ctx, 'MEETING_ROOM', ctx.params.id)),

  get('/amenities', ({ db }) => [...db.amenities].sort((a, b) => a.name.localeCompare(b.name))),
];
