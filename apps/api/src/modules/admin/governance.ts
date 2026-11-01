// Admin: booking policies, reservation administration, analytics, audit log, integrations, org settings.
import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import {
  adminCancelSchema,
  analyticsQuerySchema,
  auditQuerySchema,
  integrationUpdateSchema,
  orgSettingsSchema,
  policySchema,
  policyUpdateSchema,
  reservationListQuerySchema,
  type AdminOverviewDto,
  type AuditLogDto,
  type PolicyInput,
  type ReservationListQuery,
} from '@spaceflow/shared';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { validate, body, params, query } from '../../middleware/validate.js';
import { doc } from '../../openapi/registry.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { audit, clientIp } from '../../lib/audit.js';
import { toPolicyDto } from '../../utils/mappers.js';
import { paginate, skipTake } from '../../utils/pagination.js';
import { cancelReservation, listReservations } from '../reservations/service.js';
import { listIntegrations, providerMeta } from '../../integrations/index.js';
import { dayjs, endOfLocalDay, startOfLocalDay, timeToMinutes } from '../../utils/time.js';
import { resolvePolicy } from '../policies/service.js';
import { isValidTimezone } from '../../utils/time.js';

export const adminGovernanceRouter = Router();
adminGovernanceRouter.use(requireAuth);
const idParam = z.object({ id: z.string().uuid() });

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

function validatePolicy(p: Partial<PolicyInput>) {
  if (p.operatingStart && p.operatingEnd && timeToMinutes(p.operatingEnd) <= timeToMinutes(p.operatingStart)) throw AppError.badRequest('operatingEnd must be after operatingStart');
  if (p.minDurationMinutes && p.maxDurationMinutes && p.minDurationMinutes > p.maxDurationMinutes) throw AppError.badRequest('minDurationMinutes cannot exceed maxDurationMinutes');
  if (p.maxDailyBookings && p.maxWeeklyBookings && p.maxDailyBookings > p.maxWeeklyBookings) throw AppError.badRequest('maxDailyBookings cannot exceed maxWeeklyBookings');
}

doc({ method: 'get', path: '/admin/policies', summary: 'List booking policies', tags: ['Admin'], permissions: ['policy:manage'] });
adminGovernanceRouter.get('/policies', requirePermission('policy:manage'), async (req, res) => {
  const rows = await prisma.bookingPolicy.findMany({ where: { orgId: req.user!.orgId }, include: { building: { select: { name: true } } }, orderBy: [{ buildingId: 'asc' }, { resourceType: 'asc' }, { name: 'asc' }] });
  res.json(rows.map(toPolicyDto));
});

doc({ method: 'get', path: '/admin/policies/effective', summary: 'Resolve the effective policy for a building + resource type', tags: ['Admin'], permissions: ['policy:manage'] });
adminGovernanceRouter.get('/policies/effective', requirePermission('policy:manage'), async (req, res) => {
  const buildingId = String(req.query.buildingId ?? '');
  const type = req.query.resourceType === 'MEETING_ROOM' ? 'MEETING_ROOM' : 'SEAT';
  const p = await resolvePolicy(req.user!.orgId, buildingId, type);
  res.json(toPolicyDto({ ...p, building: null }));
});

doc({ method: 'post', path: '/admin/policies', summary: 'Create a booking policy', tags: ['Admin'], permissions: ['policy:manage'], body: policySchema, responses: { 201: 'Created' } });
adminGovernanceRouter.post('/policies', requirePermission('policy:manage'), validate(policySchema), async (req, res) => {
  const input = body<PolicyInput>(req);
  validatePolicy(input);
  if (input.buildingId) {
    const b = await prisma.building.findFirst({ where: { id: input.buildingId, orgId: req.user!.orgId } });
    if (!b) throw AppError.badRequest('Building not found');
  }
  const row = await prisma.bookingPolicy.create({ data: { ...input, orgId: req.user!.orgId, buildingId: input.buildingId ?? null, resourceType: input.resourceType ?? null }, include: { building: { select: { name: true } } } });
  await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: 'policy.create', entityType: 'BookingPolicy', entityId: row.id, after: row, ip: clientIp(req) });
  res.status(201).json(toPolicyDto(row));
});

doc({ method: 'patch', path: '/admin/policies/:id', summary: 'Update a booking policy', tags: ['Admin'], permissions: ['policy:manage'], body: policyUpdateSchema });
adminGovernanceRouter.patch('/policies/:id', requirePermission('policy:manage'), validate(idParam, 'params'), validate(policyUpdateSchema), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const input = body<Partial<PolicyInput>>(req);
  const before = await prisma.bookingPolicy.findFirst({ where: { id, orgId: req.user!.orgId } });
  if (!before) throw AppError.notFound('Policy');
  validatePolicy({ ...before, ...input } as PolicyInput);
  const row = await prisma.bookingPolicy.update({ where: { id }, data: input, include: { building: { select: { name: true } } } });
  await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: 'policy.update', entityType: 'BookingPolicy', entityId: id, before, after: row, ip: clientIp(req) });
  res.json(toPolicyDto(row));
});

doc({ method: 'delete', path: '/admin/policies/:id', summary: 'Delete a booking policy', tags: ['Admin'], permissions: ['policy:manage'], responses: { 204: 'Deleted' } });
adminGovernanceRouter.delete('/policies/:id', requirePermission('policy:manage'), validate(idParam, 'params'), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const before = await prisma.bookingPolicy.findFirst({ where: { id, orgId: req.user!.orgId } });
  if (!before) throw AppError.notFound('Policy');
  await prisma.bookingPolicy.delete({ where: { id } });
  await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: 'policy.delete', entityType: 'BookingPolicy', entityId: id, before, ip: clientIp(req) });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Reservation administration
// ---------------------------------------------------------------------------

doc({ method: 'get', path: '/admin/reservations', summary: 'Search all reservations', tags: ['Admin', 'Reservations'], permissions: ['reservation:manage-any'], query: reservationListQuerySchema });
adminGovernanceRouter.get('/reservations', requirePermission('reservation:manage-any'), validate(reservationListQuerySchema, 'query'), async (req, res) => {
  res.json(await listReservations(req.user!, query<ReservationListQuery>(req), { ownOnly: false }));
});

doc({ method: 'post', path: '/admin/reservations/:id/cancel', summary: 'Cancel any reservation with a reason (audited)', tags: ['Admin', 'Reservations'], permissions: ['reservation:manage-any'], body: adminCancelSchema });
adminGovernanceRouter.post('/reservations/:id/cancel', requirePermission('reservation:manage-any'), validate(idParam, 'params'), validate(adminCancelSchema), async (req, res) => {
  res.json(await cancelReservation(req.user!, params<{ id: string }>(req).id, body<{ reason: string }>(req), { ip: clientIp(req), admin: true }));
});

doc({ method: 'get', path: '/admin/reservations/:id/check-ins', summary: 'Check-in records of a reservation', tags: ['Admin', 'Reservations'], permissions: ['reservation:manage-any'] });
adminGovernanceRouter.get('/reservations/:id/check-ins', requirePermission('reservation:manage-any'), validate(idParam, 'params'), async (req, res) => {
  const rows = await prisma.checkInRecord.findMany({ where: { reservationId: params<{ id: string }>(req).id, reservation: { orgId: req.user!.orgId } }, include: { user: { select: { firstName: true, lastName: true } } }, orderBy: { at: 'asc' } });
  res.json(rows.map((r) => ({ id: r.id, kind: r.kind, method: r.method, at: r.at.toISOString(), by: r.user ? `${r.user.firstName} ${r.user.lastName}` : null })));
});

doc({ method: 'get', path: '/admin/reservations/conflicts', summary: 'Investigate reservations that touch the same resource within a window', tags: ['Admin', 'Reservations'], permissions: ['reservation:manage-any'] });
adminGovernanceRouter.get('/reservations/conflicts', requirePermission('reservation:manage-any'), async (req, res) => {
  const resourceId = String(req.query.resourceId ?? '');
  const from = req.query.from ? new Date(String(req.query.from)) : new Date();
  const to = req.query.to ? new Date(String(req.query.to)) : new Date(from.getTime() + 7 * 86400000);
  if (!resourceId) throw AppError.badRequest('resourceId is required');
  const rows = await prisma.reservation.findMany({ where: { orgId: req.user!.orgId, resourceId, startAt: { lt: to }, endAt: { gt: from } }, include: { user: { select: { firstName: true, lastName: true, email: true } } }, orderBy: { startAt: 'asc' } });
  const audits = await prisma.auditLog.findMany({ where: { entityType: 'Reservation', entityId: { in: rows.map((r) => r.id) } }, orderBy: { createdAt: 'asc' } });
  res.json({ reservations: rows.map((r) => ({ id: r.id, status: r.status, startAt: r.startAt.toISOString(), endAt: r.endAt.toISOString(), user: `${r.user.firstName} ${r.user.lastName}`, email: r.user.email, createdAt: r.createdAt.toISOString() })), audit: audits.map((a) => ({ id: a.id, action: a.action, entityId: a.entityId, createdAt: a.createdAt.toISOString(), after: a.after })) });
});

doc({ method: 'get', path: '/admin/reservations/export', summary: 'Export reservations as CSV', tags: ['Admin', 'Reservations'], permissions: ['reservation:manage-any'], query: reservationListQuerySchema });
adminGovernanceRouter.get('/reservations/export', requirePermission('reservation:manage-any'), validate(reservationListQuerySchema, 'query'), async (req, res) => {
  const q = { ...query<ReservationListQuery>(req), page: 1, pageSize: 200 };
  const first = await listReservations(req.user!, q, { ownOnly: false });
  const items = [...first.items];
  for (let p = 2; p <= Math.min(first.totalPages, 25); p++) items.push(...(await listReservations(req.user!, { ...q, page: p }, { ownOnly: false })).items);
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['id,type,status,resource,code,building,floor,user,startAt,endAt,timezone,checkedInAt,cancelledAt,cancelReason'];
  for (const r of items) lines.push([r.id, r.type, r.status, r.resourceName, r.resourceCode, r.buildingName, r.floorName, r.userDisplayName, r.startAt, r.endAt, r.timezone, r.checkedInAt, r.cancelledAt, r.cancelReason].map(esc).join(','));
  await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: 'reservation.export', entityType: 'Reservation', entityId: `${items.length} rows`, ip: clientIp(req) });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="spaceflow-reservations.csv"');
  res.send(lines.join('\n'));
});

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

doc({ method: 'get', path: '/admin/analytics/overview', summary: 'Admin overview: totals, occupancy, volume, utilization, peaks, rates, top resources', tags: ['Admin', 'Analytics'], permissions: ['analytics:read'], query: analyticsQuerySchema });
adminGovernanceRouter.get('/analytics/overview', requirePermission('analytics:read'), validate(analyticsQuerySchema, 'query'), async (req, res) => {
  const q = query<z.infer<typeof analyticsQuerySchema>>(req);
  const orgId = req.user!.orgId;
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
  const building = q.buildingId ? await prisma.building.findFirst({ where: { id: q.buildingId, orgId } }) : null;
  const tz = building?.timezone ?? org.timezone;
  const now = new Date();
  const toDate = q.to ?? dayjs(now).tz(tz).format('YYYY-MM-DD');
  const fromDate = q.from ?? dayjs(toDate, 'YYYY-MM-DD').subtract(29, 'day').format('YYYY-MM-DD');
  const from = startOfLocalDay(fromDate, tz);
  const to = endOfLocalDay(toDate, tz);
  const resourceFilter: Prisma.ResourceWhereInput = { orgId, deletedAt: null, ...(q.buildingId ? { buildingId: q.buildingId } : {}) };

  const [buildings, floors, seats, rooms, employees, resourcesList, reservations, pendingApprovals] = await Promise.all([
    prisma.building.count({ where: { orgId, deletedAt: null, ...(q.buildingId ? { id: q.buildingId } : {}) } }),
    prisma.floor.count({ where: { deletedAt: null, building: { orgId, ...(q.buildingId ? { id: q.buildingId } : {}) } } }),
    prisma.resource.count({ where: { ...resourceFilter, type: 'SEAT', status: 'ACTIVE', isBookable: true } }),
    prisma.resource.count({ where: { ...resourceFilter, type: 'MEETING_ROOM', status: 'ACTIVE', isBookable: true } }),
    prisma.user.count({ where: { orgId, status: 'ACTIVE', deletedAt: null } }),
    prisma.resource.findMany({ where: { ...resourceFilter, status: 'ACTIVE', isBookable: true }, select: { id: true, type: true, floorId: true, buildingId: true, code: true, name: true, floor: { select: { name: true, building: { select: { name: true } } } } } }),
    prisma.reservation.findMany({ where: { orgId, startAt: { lt: to }, endAt: { gt: from }, ...(q.buildingId ? { resource: { buildingId: q.buildingId } } : {}) }, select: { id: true, type: true, status: true, startAt: true, endAt: true, resourceId: true, checkedInAt: true, resource: { select: { floorId: true, buildingId: true, checkInRequired: true } } } }),
    prisma.reservation.count({ where: { orgId, status: 'PENDING_APPROVAL' } }),
  ]);

  // Today
  const todayStr = dayjs(now).tz(tz).format('YYYY-MM-DD');
  const todayStart = startOfLocalDay(todayStr, tz);
  const todayEnd = endOfLocalDay(todayStr, tz);
  const todays = reservations.filter((r) => r.startAt < todayEnd && r.endAt > todayStart && ['CONFIRMED', 'CHECKED_IN', 'PENDING_APPROVAL'].includes(r.status));
  const nowActive = reservations.filter((r) => r.startAt <= now && r.endAt > now && ['CONFIRMED', 'CHECKED_IN'].includes(r.status));
  const reservedSeatsToday = new Set(todays.filter((r) => r.type === 'SEAT').map((r) => r.resourceId)).size;
  const reservedRoomsToday = new Set(todays.filter((r) => r.type === 'MEETING_ROOM').map((r) => r.resourceId)).size;

  // Daily series
  const days: string[] = [];
  for (let d = dayjs(fromDate, 'YYYY-MM-DD'); d.format('YYYY-MM-DD') <= toDate; d = d.add(1, 'day')) days.push(d.format('YYYY-MM-DD'));
  const operatingHoursPerDay = 12; // normalising constant for utilization (07:00-19:00 core hours)
  const bookingVolume = days.map((date) => ({ date, seats: 0, rooms: 0 }));
  const utilization = days.map((date) => ({ date, seatHours: 0, roomHours: 0 }));
  const peakHours = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  const perResource = new Map<string, number>();
  const perFloorHours = new Map<string, number>();
  const perBuilding = new Map<string, { bookings: number; hours: number }>();
  const counted = reservations.filter((r) => r.status !== 'REJECTED');
  for (const r of counted) {
    const dayKey = dayjs(r.startAt).tz(tz).format('YYYY-MM-DD');
    const idx = days.indexOf(dayKey);
    if (idx >= 0) {
      if (r.type === 'SEAT') bookingVolume[idx].seats++;
      else bookingVolume[idx].rooms++;
    }
    if (['CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW'].includes(r.status)) {
      const hours = Math.max(0, (Math.min(r.endAt.getTime(), to.getTime()) - Math.max(r.startAt.getTime(), from.getTime())) / 3600000);
      if (idx >= 0) r.type === 'SEAT' ? (utilization[idx].seatHours += hours) : (utilization[idx].roomHours += hours);
      const h = dayjs(r.startAt).tz(tz).hour();
      peakHours[h].count++;
      perResource.set(r.resourceId, (perResource.get(r.resourceId) ?? 0) + 1);
      if (r.type === 'SEAT') perFloorHours.set(r.resource.floorId, (perFloorHours.get(r.resource.floorId) ?? 0) + hours);
      const b = perBuilding.get(r.resource.buildingId) ?? { bookings: 0, hours: 0 };
      b.bookings++;
      b.hours += hours;
      perBuilding.set(r.resource.buildingId, b);
    }
  }
  const finished = counted.filter((r) => r.endAt <= now && ['COMPLETED', 'NO_SHOW', 'CHECKED_IN', 'CONFIRMED', 'RELEASED'].includes(r.status));
  const requiredCheckIn = finished.filter((r) => r.resource.checkInRequired !== false);
  const checkedIn = finished.filter((r) => !!r.checkedInAt).length;
  const noShows = counted.filter((r) => r.status === 'NO_SHOW' || r.status === 'RELEASED').length;
  const cancelled = counted.filter((r) => r.status === 'CANCELLED').length;
  const totalBookings = counted.length;
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
  const seatsByFloor = new Map<string, number>();
  const seatsByBuilding = new Map<string, number>();
  for (const r of resourcesList) {
    if (r.type !== 'SEAT') continue;
    seatsByFloor.set(r.floorId, (seatsByFloor.get(r.floorId) ?? 0) + 1);
    seatsByBuilding.set(r.buildingId, (seatsByBuilding.get(r.buildingId) ?? 0) + 1);
  }
  const floorsMeta = await prisma.floor.findMany({ where: { id: { in: [...seatsByFloor.keys()] } }, select: { id: true, name: true, building: { select: { name: true } } } });
  const buildingsMeta = await prisma.building.findMany({ where: { id: { in: [...perBuilding.keys(), ...seatsByBuilding.keys()] } }, select: { id: true, name: true } });
  const dayCount = days.length;

  const dto: AdminOverviewDto = {
    totals: { buildings, floors, seats, rooms, employees },
    today: { reservedSeats: reservedSeatsToday, reservedRooms: reservedRoomsToday, checkedIn: nowActive.filter((r) => r.status === 'CHECKED_IN').length, availableSeats: Math.max(0, seats - new Set(nowActive.filter((r) => r.type === 'SEAT').map((r) => r.resourceId)).size), availableRooms: Math.max(0, rooms - new Set(nowActive.filter((r) => r.type === 'MEETING_ROOM').map((r) => r.resourceId)).size), pendingApprovals },
    range: { from: fromDate, to: toDate },
    bookingVolume,
    utilization: utilization.map((u) => ({ date: u.date, seatUtilization: pct(u.seatHours, seats * operatingHoursPerDay), roomUtilization: pct(u.roomHours, rooms * operatingHoursPerDay) })),
    peakHours: peakHours.filter((p) => p.hour >= 6 && p.hour <= 21),
    rates: { totalBookings, cancelled, cancellationRate: pct(cancelled, totalBookings), checkInRequired: requiredCheckIn.length, checkedIn, checkInRate: pct(checkedIn, requiredCheckIn.length), noShows, noShowRate: pct(noShows, requiredCheckIn.length) },
    topResources: [...perResource.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, count]) => { const r = resourcesList.find((x) => x.id === id); return { resourceId: id, code: r?.code ?? '?', name: r?.name ?? '?', type: r?.type ?? 'SEAT', count }; }),
    floorUtilization: [...seatsByFloor.entries()].map(([floorId, seatCount]) => { const f = floorsMeta.find((x) => x.id === floorId); const bookedHours = perFloorHours.get(floorId) ?? 0; return { floorId, floorName: f?.name ?? '?', buildingName: f?.building.name ?? '?', seats: seatCount, bookedHours: Math.round(bookedHours), utilization: pct(bookedHours, seatCount * operatingHoursPerDay * dayCount) }; }).sort((a, b) => b.utilization - a.utilization),
    buildingComparison: buildingsMeta.map((b) => { const stats = perBuilding.get(b.id) ?? { bookings: 0, hours: 0 }; const seatCount = seatsByBuilding.get(b.id) ?? 0; return { buildingId: b.id, buildingName: b.name, bookings: stats.bookings, utilization: pct(stats.hours, seatCount * operatingHoursPerDay * dayCount) }; }),
  };
  res.json(dto);
});

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

doc({ method: 'get', path: '/admin/audit', summary: 'Audit log', tags: ['Admin'], permissions: ['audit:read'], query: auditQuerySchema });
adminGovernanceRouter.get('/audit', requirePermission('audit:read'), validate(auditQuerySchema, 'query'), async (req, res) => {
  const q = query<z.infer<typeof auditQuerySchema>>(req);
  const where: Prisma.AuditLogWhereInput = {
    orgId: req.user!.orgId,
    ...(q.entityType ? { entityType: q.entityType } : {}),
    ...(q.entityId ? { entityId: q.entityId } : {}),
    ...(q.actorId ? { actorId: q.actorId } : {}),
    ...(q.action ? { action: { startsWith: q.action } } : {}),
    ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
  };
  const [total, rows] = await Promise.all([prisma.auditLog.count({ where }), prisma.auditLog.findMany({ where, include: { actor: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' }, ...skipTake(q.page, q.pageSize) })]);
  const items: AuditLogDto[] = rows.map((r) => ({ id: r.id, actorId: r.actorId, actorName: r.actor ? `${r.actor.firstName} ${r.actor.lastName}` : null, action: r.action, entityType: r.entityType, entityId: r.entityId, before: r.before, after: r.after, ip: r.ip, createdAt: r.createdAt.toISOString() }));
  res.json(paginate(items, total, q.page, q.pageSize));
});

// ---------------------------------------------------------------------------
// Integrations + organisation settings
// ---------------------------------------------------------------------------

doc({ method: 'get', path: '/admin/integrations', summary: 'Integration status (configured / enabled / errors)', tags: ['Admin'], permissions: ['integration:manage'] });
adminGovernanceRouter.get('/integrations', requirePermission('integration:manage'), async (req, res) => res.json(await listIntegrations(req.user!.orgId)));

doc({ method: 'put', path: '/admin/integrations', summary: 'Enable/disable an integration and store its non-secret config', tags: ['Admin'], permissions: ['integration:manage'], body: integrationUpdateSchema });
adminGovernanceRouter.put('/integrations', requirePermission('integration:manage'), validate(integrationUpdateSchema), async (req, res) => {
  const input = body<z.infer<typeof integrationUpdateSchema>>(req);
  const meta = providerMeta.find((m) => m.provider === input.provider)!;
  if (input.isEnabled && !meta.configured()) throw AppError.integrationNotConfigured(input.provider, meta.requiredEnv);
  // Never persist secrets in the DB; config holds only non-sensitive options.
  const config = Object.fromEntries(Object.entries(input.config).filter(([k]) => !/secret|password|token|key/i.test(k))) as Prisma.InputJsonObject;
  await prisma.integrationConfig.upsert({
    where: { orgId_provider: { orgId: req.user!.orgId, provider: input.provider } },
    create: { orgId: req.user!.orgId, provider: input.provider, isEnabled: input.isEnabled, config, status: input.isEnabled ? 'READY' : 'DISABLED' },
    update: { isEnabled: input.isEnabled, config, status: input.isEnabled ? 'READY' : 'DISABLED', lastError: null },
  });
  await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: 'integration.update', entityType: 'IntegrationConfig', entityId: input.provider, after: { isEnabled: input.isEnabled, config }, ip: clientIp(req) });
  res.json(await listIntegrations(req.user!.orgId));
});

doc({ method: 'get', path: '/admin/settings', summary: 'Organisation settings', tags: ['Admin'], permissions: ['settings:manage'] });
adminGovernanceRouter.get('/settings', requirePermission('settings:manage'), async (req, res) => {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.user!.orgId } });
  res.json({ id: org.id, name: org.name, slug: org.slug, timezone: org.timezone, settings: org.settings });
});

doc({ method: 'patch', path: '/admin/settings', summary: 'Update organisation settings', tags: ['Admin'], permissions: ['settings:manage'], body: orgSettingsSchema });
adminGovernanceRouter.patch('/settings', requirePermission('settings:manage'), validate(orgSettingsSchema), async (req, res) => {
  const input = body<z.infer<typeof orgSettingsSchema>>(req);
  if (input.timezone && !isValidTimezone(input.timezone)) throw AppError.badRequest('Unknown timezone');
  const before = await prisma.organization.findUniqueOrThrow({ where: { id: req.user!.orgId } });
  const org = await prisma.organization.update({ where: { id: req.user!.orgId }, data: { name: input.name, timezone: input.timezone, settings: input.settings ? { ...(before.settings as object), ...input.settings } : undefined } });
  await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: 'settings.update', entityType: 'Organization', entityId: org.id, before: { name: before.name, timezone: before.timezone, settings: before.settings }, after: { name: org.name, timezone: org.timezone, settings: org.settings }, ip: clientIp(req) });
  res.json({ id: org.id, name: org.name, slug: org.slug, timezone: org.timezone, settings: org.settings });
});
