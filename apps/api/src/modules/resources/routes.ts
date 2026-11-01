import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
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
  type AvailabilityQuery,
  type ResourceListQuery,
  type RoomInput,
  type SeatInput,
} from '@spaceflow/shared';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { validate, body, params, query } from '../../middleware/validate.js';
import { doc } from '../../openapi/registry.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { audit, clientIp } from '../../lib/audit.js';
import { buildSearchText, resourceInclude, toAmenityDto, toResourceDto } from '../../utils/mappers.js';
import { paginate, skipTake } from '../../utils/pagination.js';
import { computeAvailability, dayAvailability } from '../availability/service.js';
import { broadcastToOrg } from '../../realtime/sse.js';
import { notify } from '../notifications/service.js';

export const resourcesRouter = Router();
export const seatsRouter = Router();
export const roomsRouter = Router();
export const amenitiesRouter = Router();
for (const r of [resourcesRouter, seatsRouter, roomsRouter, amenitiesRouter]) r.use(requireAuth);

const idParam = z.object({ id: z.string().uuid() });
const fullInclude = { ...resourceInclude, floor: { select: { id: true, name: true, number: true, isPublished: true } }, building: { select: { id: true, name: true, timezone: true, isActive: true } } } as const;

function seatAttrFilter(q: ResourceListQuery): Prisma.ResourceWhereInput[] {
  const keys = ['nearWindow', 'nearElevator', 'monitor', 'dockingStation', 'heightAdjustable', 'quietZone'] as const;
  const out: Prisma.ResourceWhereInput[] = [];
  for (const k of keys) if (q[k]) out.push({ seatAttributes: { path: [k], equals: true } });
  if (q.accessible) out.push({ OR: [{ accessible: true }, { seatAttributes: { path: ['accessible'], equals: true } }] });
  return out;
}

export async function listResources(req: Parameters<typeof requireAuth>[0], q: ResourceListQuery, forcedType?: 'SEAT' | 'MEETING_ROOM') {
  const user = req.user!;
  const isAdmin = user.permissions.includes('resource:manage');
  const where: Prisma.ResourceWhereInput = {
    orgId: user.orgId,
    deletedAt: null,
    ...(forcedType ? { type: forcedType } : q.type ? { type: q.type } : {}),
    ...(q.buildingId ? { buildingId: q.buildingId } : {}),
    ...(q.floorId ? { floorId: q.floorId } : {}),
    ...(q.zoneId ? { zoneId: q.zoneId } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.minCapacity ? { capacity: { gte: q.minCapacity } } : {}),
    ...(isAdmin ? {} : { floor: { isPublished: true }, building: { isActive: true } }),
    ...(q.q ? { searchText: { contains: q.q.toLowerCase() } } : {}),
    AND: [
      ...seatAttrFilter(q),
      ...(q.amenityIds?.length ? q.amenityIds.map((amenityId) => ({ amenities: { some: { amenityId } } })) : []),
    ],
  };
  // "Near my team": seats on floors/zones where teammates have a seat booked in the same window.
  if (q.nearTeam && q.startAt && q.endAt && user.teamId) {
    const teammates = await prisma.reservation.findMany({
      where: { type: 'SEAT', status: { in: ['CONFIRMED', 'CHECKED_IN'] }, startAt: { lt: new Date(q.endAt) }, endAt: { gt: new Date(q.startAt) }, user: { teamId: user.teamId, id: { not: user.id }, preferences: { is: { shareLocationWithTeam: true } } } },
      select: { resource: { select: { floorId: true, zoneId: true } } },
    });
    const zoneIds = [...new Set(teammates.map((t) => t.resource.zoneId).filter((z): z is string => !!z))];
    const floorIds = [...new Set(teammates.map((t) => t.resource.floorId))];
    if (zoneIds.length) where.zoneId = { in: zoneIds };
    else if (floorIds.length) where.floorId = { in: floorIds };
    else where.id = { in: [] };
  }
  const orderBy: Prisma.ResourceOrderByWithRelationInput = q.sortBy ? { [q.sortBy]: q.sortDir ?? 'asc' } : { code: 'asc' };
  const favs = new Set((await prisma.favorite.findMany({ where: { userId: user.id }, select: { resourceId: true } })).map((f) => f.resourceId));

  if (q.startAt && q.endAt) {
    // Availability filtering needs the full set, so fetch all matches (bounded) and paginate in memory.
    const rows = await prisma.resource.findMany({ where, include: fullInclude, orderBy, take: 2000 });
    const av = await computeAvailability(rows, { startAt: new Date(q.startAt), endAt: new Date(q.endAt), user });
    let dtos = rows.map((r) => ({ ...toResourceDto(r, { isFavorite: favs.has(r.id) }), availability: av.get(r.id) }));
    if (q.availableOnly) dtos = dtos.filter((d) => d.availability?.canBook);
    const total = dtos.length;
    const { skip, take } = skipTake(q.page, q.pageSize);
    return paginate(dtos.slice(skip, skip + take), total, q.page, q.pageSize);
  }
  const [total, rows] = await Promise.all([prisma.resource.count({ where }), prisma.resource.findMany({ where, include: fullInclude, orderBy, ...skipTake(q.page, q.pageSize) })]);
  return paginate(rows.map((r) => toResourceDto(r, { isFavorite: favs.has(r.id) })), total, q.page, q.pageSize);
}

// ---------------------------------------------------------------------------
// Generic resources
// ---------------------------------------------------------------------------

doc({ method: 'get', path: '/resources', summary: 'List seats and rooms with filters (+availability when startAt/endAt given)', tags: ['Resources'], query: resourceListQuerySchema });
resourcesRouter.get('/', validate(resourceListQuerySchema, 'query'), async (req, res) => {
  res.json(await listResources(req, query<ResourceListQuery>(req)));
});

doc({ method: 'get', path: '/resources/availability', summary: 'Availability state for many resources over a window', tags: ['Resources'], query: availabilityQuerySchema });
resourcesRouter.get('/availability', validate(availabilityQuerySchema, 'query'), async (req, res) => {
  const q = query<AvailabilityQuery>(req);
  const startAt = new Date(q.startAt);
  const endAt = new Date(q.endAt);
  if (endAt <= startAt) throw AppError.invalidTime('endAt must be after startAt');
  const rows = await prisma.resource.findMany({
    where: { orgId: req.user!.orgId, deletedAt: null, ...(q.floorId ? { floorId: q.floorId } : {}), ...(q.buildingId ? { buildingId: q.buildingId } : {}), ...(q.type ? { type: q.type } : {}), ...(q.resourceIds?.length ? { id: { in: q.resourceIds } } : {}) },
    include: { floor: { select: { isPublished: true } }, building: { select: { timezone: true, isActive: true } } },
    take: 5000,
  });
  const av = await computeAvailability(rows, { startAt, endAt, user: req.user });
  res.json({ startAt: startAt.toISOString(), endAt: endAt.toISOString(), items: [...av.values()] });
});

doc({ method: 'get', path: '/resources/suggest', summary: 'Find me a seat: ranked available seats for a window', tags: ['Resources', 'Seats'], query: suggestSeatsQuerySchema });
resourcesRouter.get('/suggest', validate(suggestSeatsQuerySchema, 'query'), async (req, res) => {
  const q = query<z.infer<typeof suggestSeatsQuerySchema>>(req);
  const user = req.user!;
  const [favs, history, prefs] = await Promise.all([
    prisma.favorite.findMany({ where: { userId: user.id }, select: { resourceId: true } }),
    prisma.reservation.findMany({ where: { userId: user.id, type: 'SEAT' }, orderBy: { createdAt: 'desc' }, take: 30, select: { resourceId: true, resource: { select: { floorId: true, zoneId: true } } } }),
    prisma.user.findUnique({ where: { id: user.id }, select: { homeBuildingId: true, preferences: { select: { defaultBuildingId: true, defaultFloorId: true } } } }),
  ]);
  const buildingId = q.buildingId ?? prefs?.preferences?.defaultBuildingId ?? prefs?.homeBuildingId ?? undefined;
  const rows = await prisma.resource.findMany({
    where: { orgId: user.orgId, type: 'SEAT', status: 'ACTIVE', isBookable: true, deletedAt: null, floor: { isPublished: true }, building: { isActive: true }, ...(buildingId ? { buildingId } : {}), ...(q.floorId ? { floorId: q.floorId } : {}) },
    include: fullInclude,
    take: 2000,
  });
  const av = await computeAvailability(rows, { startAt: new Date(q.startAt), endAt: new Date(q.endAt), user });
  const favSet = new Set(favs.map((f) => f.resourceId));
  const histCount = new Map<string, number>();
  const zoneCount = new Map<string, number>();
  for (const h of history) {
    histCount.set(h.resourceId, (histCount.get(h.resourceId) ?? 0) + 1);
    if (h.resource.zoneId) zoneCount.set(h.resource.zoneId, (zoneCount.get(h.resource.zoneId) ?? 0) + 1);
  }
  const scored = rows
    .filter((r) => av.get(r.id)?.state === 'AVAILABLE')
    .map((r) => {
      const attrs = (r.seatAttributes as Record<string, boolean> | null) ?? {};
      let score = 0;
      if (favSet.has(r.id)) score += 50;
      score += (histCount.get(r.id) ?? 0) * 10;
      if (r.zoneId) score += (zoneCount.get(r.zoneId) ?? 0) * 3;
      if (r.floorId === prefs?.preferences?.defaultFloorId) score += 5;
      if (attrs.monitor) score += 2;
      if (attrs.dockingStation) score += 2;
      if (attrs.nearWindow) score += 1;
      return { r, score };
    })
    .sort((a, b) => b.score - a.score || a.r.code.localeCompare(b.r.code))
    .slice(0, q.limit);
  res.json(scored.map(({ r }) => ({ ...toResourceDto(r, { isFavorite: favSet.has(r.id) }), availability: av.get(r.id) })));
});

const teammatesQuery = z.object({
  buildingId: z.string().uuid().optional(),
  floorId: z.string().uuid().optional(),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
});
doc({ method: 'get', path: '/resources/teammates', summary: "Where your teammates sit for a window (respects each colleague's location-sharing preference)", tags: ['Resources', 'Seats'], query: teammatesQuery });
resourcesRouter.get('/teammates', validate(teammatesQuery, 'query'), async (req, res) => {
  const q = query<z.infer<typeof teammatesQuery>>(req);
  const user = req.user!;
  // "Team" = same team; users without a team fall back to their department.
  const scope: Prisma.UserWhereInput | null = user.teamId ? { teamId: user.teamId } : user.departmentId ? { departmentId: user.departmentId } : null;
  if (!scope) return res.json([]);
  const rows = await prisma.reservation.findMany({
    where: {
      orgId: user.orgId,
      type: 'SEAT',
      status: { in: ['CONFIRMED', 'CHECKED_IN'] },
      startAt: { lt: new Date(q.endAt) },
      endAt: { gt: new Date(q.startAt) },
      resource: { deletedAt: null, ...(q.floorId ? { floorId: q.floorId } : {}), ...(q.buildingId ? { buildingId: q.buildingId } : {}) },
      user: { ...scope, status: 'ACTIVE', OR: [{ id: user.id }, { preferences: { is: { shareLocationWithTeam: true } } }, { preferences: { is: null } }] },
    },
    select: { startAt: true, endAt: true, status: true, user: { select: { id: true, firstName: true, lastName: true } }, resource: { select: { id: true, code: true, floorId: true, floor: { select: { name: true } } } } },
    orderBy: { startAt: 'asc' },
    take: 500,
  });
  res.json(
    rows.map((r) => ({
      userId: r.user.id,
      displayName: `${r.user.firstName} ${r.user.lastName}`,
      initials: `${r.user.firstName[0] ?? ''}${r.user.lastName[0] ?? ''}`.toUpperCase(),
      isMe: r.user.id === user.id,
      checkedIn: r.status === 'CHECKED_IN',
      resourceId: r.resource.id,
      resourceCode: r.resource.code,
      floorId: r.resource.floorId,
      floorName: r.resource.floor.name,
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString(),
    })),
  );
});

doc({ method: 'get', path: '/resources/:id', summary: 'Resource details', tags: ['Resources'] });
resourcesRouter.get('/:id', validate(idParam, 'params'), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const row = await prisma.resource.findFirst({ where: { id, orgId: req.user!.orgId, deletedAt: null }, include: fullInclude });
  if (!row) throw AppError.notFound('Resource');
  const fav = await prisma.favorite.findUnique({ where: { userId_resourceId: { userId: req.user!.id, resourceId: id } } });
  const dto = toResourceDto(row, { isFavorite: !!fav });
  if (typeof req.query.startAt === 'string' && typeof req.query.endAt === 'string') {
    const av = await computeAvailability([row], { startAt: new Date(req.query.startAt), endAt: new Date(req.query.endAt), user: req.user });
    dto.availability = av.get(id);
  }
  res.json(dto);
});

doc({ method: 'get', path: '/resources/:id/availability', summary: 'Slot-by-slot availability for one day', tags: ['Resources'], query: resourceAvailabilityQuerySchema });
resourcesRouter.get('/:id/availability', validate(idParam, 'params'), validate(resourceAvailabilityQuerySchema, 'query'), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const q = query<{ date: string; slotMinutes?: number }>(req);
  const row = await prisma.resource.findFirst({ where: { id, orgId: req.user!.orgId, deletedAt: null }, include: fullInclude });
  if (!row) throw AppError.notFound('Resource');
  res.json(await dayAvailability(row, q.date, req.user, q.slotMinutes));
});

doc({ method: 'get', path: '/resources/:id/reservations', summary: 'Reservation history for a resource (admin)', tags: ['Resources', 'Admin'], permissions: ['resource:manage'] });
resourcesRouter.get('/:id/reservations', requirePermission('resource:manage'), validate(idParam, 'params'), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const { reservationSummaryInclude, toReservationSummaryDto } = await import('../../utils/mappers.js');
  const rows = await prisma.reservation.findMany({ where: { resourceId: id, orgId: req.user!.orgId }, include: reservationSummaryInclude, orderBy: { startAt: 'desc' }, take: 100 });
  res.json(rows.map(toReservationSummaryDto));
});

// ---------------------------------------------------------------------------
// Seats + rooms: list (employee) + CRUD (admin)
// ---------------------------------------------------------------------------

doc({ method: 'get', path: '/seats', summary: 'List seats', tags: ['Seats'], query: resourceListQuerySchema });
seatsRouter.get('/', validate(resourceListQuerySchema, 'query'), async (req, res) => res.json(await listResources(req, query<ResourceListQuery>(req), 'SEAT')));

doc({ method: 'get', path: '/meeting-rooms', summary: 'List meeting rooms', tags: ['Meeting Rooms'], query: resourceListQuerySchema });
roomsRouter.get('/', validate(resourceListQuerySchema, 'query'), async (req, res) => res.json(await listResources(req, query<ResourceListQuery>(req), 'MEETING_ROOM')));

async function floorAndBuilding(orgId: string, floorId: string) {
  const floor = await prisma.floor.findFirst({ where: { id: floorId, deletedAt: null, building: { orgId } }, include: { building: true } });
  if (!floor) throw AppError.badRequest('Floor not found');
  return floor;
}

async function upsertResource(req: Parameters<typeof requireAuth>[0], type: 'SEAT' | 'MEETING_ROOM', input: Partial<SeatInput & RoomInput>, existingId?: string) {
  const orgId = req.user!.orgId;
  const existing = existingId ? await prisma.resource.findFirst({ where: { id: existingId, orgId, type, deletedAt: null }, include: fullInclude }) : null;
  if (existingId && !existing) throw AppError.notFound(type === 'SEAT' ? 'Seat' : 'Meeting room');
  const floorId = input.floorId ?? existing!.floorId;
  const floor = await floorAndBuilding(orgId, floorId);
  if (input.zoneId) {
    const zone = await prisma.zone.findFirst({ where: { id: input.zoneId, floorId } });
    if (!zone) throw AppError.badRequest('Zone does not belong to the selected floor');
  }
  const code = input.code ?? existing!.code;
  const name = input.name ?? existing!.name;
  const data: Prisma.ResourceUncheckedCreateInput = {
    orgId,
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
    capacity: type === 'MEETING_ROOM' ? (input.capacity ?? existing?.capacity ?? 4) : null,
    seatType: type === 'SEAT' ? (input.seatType ?? existing?.seatType ?? 'WORKSTATION') : null,
    roomType: type === 'MEETING_ROOM' ? (input.roomType ?? existing?.roomType ?? 'MEETING') : null,
    accessible: type === 'MEETING_ROOM' ? (input.accessible ?? existing?.accessible ?? false) : !!(input.seatAttributes?.accessible ?? (existing?.seatAttributes as Record<string, boolean> | null)?.accessible),
    seatAttributes: type === 'SEAT' ? ((input.seatAttributes ?? existing?.seatAttributes ?? {}) as object) : undefined,
    operatingHours: input.operatingHours === undefined ? (existing?.operatingHours as object | undefined) : input.operatingHours === null ? Prisma.DbNull : (input.operatingHours as object),
    maxDurationMinutes: input.maxDurationMinutes === undefined ? existing?.maxDurationMinutes ?? null : input.maxDurationMinutes,
    checkInRequired: input.checkInRequired === undefined ? existing?.checkInRequired ?? null : input.checkInRequired,
    restrictedDepartmentIds: input.restrictedDepartmentIds ?? existing?.restrictedDepartmentIds ?? [],
    restrictedTeamIds: input.restrictedTeamIds ?? existing?.restrictedTeamIds ?? [],
    searchText: buildSearchText([code, name, input.description ?? existing?.description, floor.name, floor.building.name]),
  };
  const row = await prisma.$transaction(async (tx) => {
    const saved = existing
      ? await tx.resource.update({ where: { id: existing.id }, data })
      : await tx.resource.create({ data });
    if (input.amenityIds) {
      await tx.resourceAmenity.deleteMany({ where: { resourceId: saved.id } });
      if (input.amenityIds.length) await tx.resourceAmenity.createMany({ data: input.amenityIds.map((amenityId) => ({ resourceId: saved.id, amenityId })), skipDuplicates: true });
    }
    await audit({ orgId, actorId: req.user!.id, action: existing ? 'resource.update' : 'resource.create', entityType: 'Resource', entityId: saved.id, before: existing ?? undefined, after: saved, ip: clientIp(req) }, tx);
    return tx.resource.findUniqueOrThrow({ where: { id: saved.id }, include: fullInclude });
  });
  if (existing && existing.status !== row.status && row.status !== 'ACTIVE') {
    // Tell people with upcoming bookings about maintenance / disabling.
    const affected = await prisma.reservation.findMany({ where: { resourceId: row.id, status: { in: ['CONFIRMED', 'PENDING_APPROVAL'] }, startAt: { gt: new Date() } }, select: { userId: true, id: true } });
    for (const a of affected) await notify({ userId: a.userId, type: 'RESOURCE_MAINTENANCE', title: `${row.name} is now ${row.status.toLowerCase()}`, body: 'One of your upcoming bookings may be affected. Please review it.', data: { reservationId: a.id, resourceId: row.id } });
  }
  broadcastToOrg(orgId, 'availability.changed', { resourceIds: [row.id], floorId: row.floorId, buildingId: row.buildingId });
  return toResourceDto(row);
}

const makeAdminRoutes = (router: Router, type: 'SEAT' | 'MEETING_ROOM', createSchema: z.ZodType, updateSchema: z.ZodType, base: string, tag: string) => {
  doc({ method: 'post', path: base, summary: `Create a ${tag.toLowerCase()}`, tags: [tag, 'Admin'], permissions: ['resource:manage'], body: createSchema as z.ZodType, responses: { 201: 'Created' } });
  router.post('/', requirePermission('resource:manage'), validate(createSchema), async (req, res) => {
    res.status(201).json(await upsertResource(req, type, body(req)));
  });
  doc({ method: 'patch', path: `${base}/:id`, summary: `Update a ${tag.toLowerCase()}`, tags: [tag, 'Admin'], permissions: ['resource:manage'], body: updateSchema as z.ZodType });
  router.patch('/:id', requirePermission('resource:manage'), validate(idParam, 'params'), validate(updateSchema), async (req, res) => {
    res.json(await upsertResource(req, type, body(req), params<{ id: string }>(req).id));
  });
  doc({ method: 'delete', path: `${base}/:id`, summary: `Archive a ${tag.toLowerCase()} (soft delete; history is kept)`, tags: [tag, 'Admin'], permissions: ['resource:manage'], responses: { 204: 'Archived' } });
  router.delete('/:id', requirePermission('resource:manage'), validate(idParam, 'params'), async (req, res) => {
    const { id } = params<{ id: string }>(req);
    const row = await prisma.resource.findFirst({ where: { id, orgId: req.user!.orgId, type, deletedAt: null } });
    if (!row) throw AppError.notFound(tag);
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      const upcoming = await tx.reservation.findMany({ where: { resourceId: id, status: { in: ['CONFIRMED', 'PENDING_APPROVAL', 'CHECKED_IN'] }, endAt: { gt: now } }, select: { id: true, userId: true } });
      await tx.reservation.updateMany({ where: { id: { in: upcoming.map((u) => u.id) } }, data: { status: 'CANCELLED', cancelledAt: now, cancelledById: req.user!.id, cancelReason: `${row.name} was removed by an administrator` } });
      await tx.resource.update({ where: { id }, data: { deletedAt: now, status: 'DISABLED', isBookable: false, code: `${row.code}~${now.getTime().toString(36)}` } });
      await tx.mapObject.updateMany({ where: { resourceId: id }, data: { resourceId: null } });
      await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: 'resource.delete', entityType: 'Resource', entityId: id, before: row, ip: clientIp(req) }, tx);
      for (const u of upcoming) await notify({ userId: u.userId, type: 'BOOKING_CANCELLED', title: `Booking cancelled: ${row.name}`, body: 'The resource was removed by an administrator.', data: { reservationId: u.id }, email: true }, tx);
    });
    broadcastToOrg(req.user!.orgId, 'availability.changed', { resourceIds: [id], floorId: row.floorId, buildingId: row.buildingId });
    res.status(204).end();
  });
};
makeAdminRoutes(seatsRouter, 'SEAT', seatCreateSchema, seatUpdateSchema, '/seats', 'Seats');
makeAdminRoutes(roomsRouter, 'MEETING_ROOM', roomCreateSchema, roomUpdateSchema, '/meeting-rooms', 'Meeting Rooms');

doc({ method: 'post', path: '/resources/bulk', summary: 'Bulk update resources', tags: ['Resources', 'Admin'], permissions: ['resource:manage'], body: bulkResourceUpdateSchema });
resourcesRouter.post('/bulk', requirePermission('resource:manage'), validate(bulkResourceUpdateSchema), async (req, res) => {
  const { resourceIds, patch } = body<z.infer<typeof bulkResourceUpdateSchema>>(req);
  const rows = await prisma.resource.findMany({ where: { id: { in: resourceIds }, orgId: req.user!.orgId, deletedAt: null }, select: { id: true, floorId: true, buildingId: true } });
  await prisma.$transaction(async (tx) => {
    await tx.resource.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: patch.status, zoneId: patch.zoneId, requiresApproval: patch.requiresApproval, isBookable: patch.isBookable } });
    if (patch.addAmenityIds?.length) await tx.resourceAmenity.createMany({ data: rows.flatMap((r) => patch.addAmenityIds!.map((amenityId) => ({ resourceId: r.id, amenityId }))), skipDuplicates: true });
    if (patch.removeAmenityIds?.length) await tx.resourceAmenity.deleteMany({ where: { resourceId: { in: rows.map((r) => r.id) }, amenityId: { in: patch.removeAmenityIds } } });
    await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: 'resource.bulk-update', entityType: 'Resource', entityId: `${rows.length} resources`, after: { resourceIds: rows.map((r) => r.id), patch }, ip: clientIp(req) }, tx);
  });
  for (const floorId of new Set(rows.map((r) => r.floorId))) broadcastToOrg(req.user!.orgId, 'availability.changed', { resourceIds: rows.filter((r) => r.floorId === floorId).map((r) => r.id), floorId });
  res.json({ updated: rows.length });
});

doc({ method: 'post', path: '/resources/:id/maintenance', summary: 'Add a maintenance window', tags: ['Resources', 'Admin'], permissions: ['resource:manage'], body: maintenanceWindowSchema, responses: { 201: 'Created' } });
resourcesRouter.post('/:id/maintenance', requirePermission('resource:manage'), validate(idParam, 'params'), validate(maintenanceWindowSchema), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const input = body<{ startAt: string; endAt: string; reason?: string | null }>(req);
  const row = await prisma.resource.findFirst({ where: { id, orgId: req.user!.orgId, deletedAt: null } });
  if (!row) throw AppError.notFound('Resource');
  if (new Date(input.endAt) <= new Date(input.startAt)) throw AppError.invalidTime('endAt must be after startAt');
  const mw = await prisma.maintenanceWindow.create({ data: { resourceId: id, startAt: new Date(input.startAt), endAt: new Date(input.endAt), reason: input.reason ?? null } });
  const affected = await prisma.reservation.findMany({ where: { resourceId: id, status: { in: ['CONFIRMED', 'PENDING_APPROVAL'] }, startAt: { lt: mw.endAt }, endAt: { gt: mw.startAt } }, select: { id: true, userId: true } });
  for (const a of affected) await notify({ userId: a.userId, type: 'RESOURCE_MAINTENANCE', title: `Maintenance scheduled for ${row.name}`, body: input.reason ?? 'Your booking overlaps a maintenance window. Please rebook.', data: { reservationId: a.id, resourceId: id }, email: true });
  await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: 'resource.maintenance.create', entityType: 'Resource', entityId: id, after: mw, ip: clientIp(req) });
  broadcastToOrg(req.user!.orgId, 'availability.changed', { resourceIds: [id], floorId: row.floorId, buildingId: row.buildingId });
  res.status(201).json({ id: mw.id, startAt: mw.startAt.toISOString(), endAt: mw.endAt.toISOString(), reason: mw.reason });
});

doc({ method: 'get', path: '/resources/:id/maintenance', summary: 'List maintenance windows', tags: ['Resources'] });
resourcesRouter.get('/:id/maintenance', validate(idParam, 'params'), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const rows = await prisma.maintenanceWindow.findMany({ where: { resourceId: id, resource: { orgId: req.user!.orgId } }, orderBy: { startAt: 'desc' }, take: 50 });
  res.json(rows.map((m) => ({ id: m.id, startAt: m.startAt.toISOString(), endAt: m.endAt.toISOString(), reason: m.reason })));
});

doc({ method: 'delete', path: '/resources/:id/maintenance/:windowId', summary: 'Remove a maintenance window', tags: ['Resources', 'Admin'], permissions: ['resource:manage'], responses: { 204: 'Removed' } });
resourcesRouter.delete('/:id/maintenance/:windowId', requirePermission('resource:manage'), async (req, res) => {
  const { id, windowId } = req.params as { id: string; windowId: string };
  await prisma.maintenanceWindow.deleteMany({ where: { id: windowId, resourceId: id, resource: { orgId: req.user!.orgId } } });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Amenities (read for everyone; CRUD in admin router)
// ---------------------------------------------------------------------------

doc({ method: 'get', path: '/amenities', summary: 'List amenities', tags: ['Resources'] });
amenitiesRouter.get('/', async (req, res) => {
  const rows = await prisma.amenity.findMany({ where: { orgId: req.user!.orgId }, orderBy: { name: 'asc' } });
  res.json(rows.map(toAmenityDto));
});
