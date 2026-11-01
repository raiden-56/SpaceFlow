import { Router } from 'express';
import { z } from 'zod';
import {
  favoriteCreateSchema,
  paginationQuerySchema,
  reservationListQuerySchema,
  updatePreferencesSchema,
  updateProfileSchema,
  type FavoriteDto,
  type ReservationListQuery,
  type UpdatePreferencesInput,
} from '@spaceflow/shared';
import { requireAuth } from '../../middleware/auth.js';
import { validate, body, query, params } from '../../middleware/validate.js';
import { doc } from '../../openapi/registry.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { resourceInclude, toNotificationDto, toResourceDto, toUserSummaryDto } from '../../utils/mappers.js';
import { paginate, skipTake } from '../../utils/pagination.js';
import { listReservations } from '../reservations/service.js';
import { loadUser, toCurrentUserDto } from '../auth/service.js';

export const usersRouter = Router();
usersRouter.use(requireAuth);

const idParam = z.object({ id: z.string().uuid() });

doc({ method: 'patch', path: '/users/me', summary: 'Update profile', tags: ['Users'], body: updateProfileSchema });
usersRouter.patch('/me', validate(updateProfileSchema), async (req, res) => {
  const input = body<z.infer<typeof updateProfileSchema>>(req);
  await prisma.user.update({ where: { id: req.user!.id }, data: input });
  res.json(toCurrentUserDto((await loadUser(req.user!.id))!));
});

doc({ method: 'patch', path: '/users/me/preferences', summary: 'Update preferences', tags: ['Users'], body: updatePreferencesSchema });
usersRouter.patch('/me/preferences', validate(updatePreferencesSchema), async (req, res) => {
  const input = body<UpdatePreferencesInput>(req);
  const view = input.preferredView === '3D' ? 'THREE_D' : input.preferredView === '2D' ? 'TWO_D' : input.preferredView === 'LIST' ? 'LIST' : undefined;
  const data = {
    defaultBuildingId: input.defaultBuildingId,
    defaultFloorId: input.defaultFloorId,
    shareLocationWithTeam: input.shareLocationWithTeam,
    emailNotifications: input.emailNotifications,
    reducedMotion: input.reducedMotion,
    preferredView: view as 'THREE_D' | 'TWO_D' | 'LIST' | undefined,
  };
  await prisma.userPreference.upsert({ where: { userId: req.user!.id }, create: { userId: req.user!.id, ...data }, update: data });
  res.json(toCurrentUserDto((await loadUser(req.user!.id))!));
});

doc({ method: 'get', path: '/users/me/reservations', summary: 'My reservations (upcoming / ongoing / past / cancelled)', tags: ['Users', 'Reservations'], query: reservationListQuerySchema });
usersRouter.get('/me/reservations', validate(reservationListQuerySchema, 'query'), async (req, res) => {
  res.json(await listReservations(req.user!, query<ReservationListQuery>(req), { ownOnly: true }));
});

doc({ method: 'get', path: '/users/me/favorites', summary: 'My favorite seats and rooms', tags: ['Users'] });
usersRouter.get('/me/favorites', async (req, res) => {
  const rows = await prisma.favorite.findMany({ where: { userId: req.user!.id, resource: { deletedAt: null } }, include: { resource: { include: resourceInclude } }, orderBy: { createdAt: 'desc' } });
  const out: FavoriteDto[] = rows.map((f) => ({ id: f.id, resource: toResourceDto(f.resource, { isFavorite: true }), createdAt: f.createdAt.toISOString() }));
  res.json(out);
});

doc({ method: 'post', path: '/users/me/favorites', summary: 'Add a favorite', tags: ['Users'], body: favoriteCreateSchema, responses: { 201: 'Created' } });
usersRouter.post('/me/favorites', validate(favoriteCreateSchema), async (req, res) => {
  const { resourceId } = body<{ resourceId: string }>(req);
  const resource = await prisma.resource.findFirst({ where: { id: resourceId, orgId: req.user!.orgId, deletedAt: null }, include: resourceInclude });
  if (!resource) throw AppError.notFound('Resource');
  const fav = await prisma.favorite.upsert({ where: { userId_resourceId: { userId: req.user!.id, resourceId } }, create: { userId: req.user!.id, resourceId }, update: {} });
  res.status(201).json({ id: fav.id, resource: toResourceDto(resource, { isFavorite: true }), createdAt: fav.createdAt.toISOString() } satisfies FavoriteDto);
});

doc({ method: 'delete', path: '/users/me/favorites/:id', summary: 'Remove a favorite (by favorite id or resource id)', tags: ['Users'], responses: { 204: 'Removed' } });
usersRouter.delete('/me/favorites/:id', validate(idParam, 'params'), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  await prisma.favorite.deleteMany({ where: { userId: req.user!.id, OR: [{ id }, { resourceId: id }] } });
  res.status(204).end();
});

const notifQuery = paginationQuerySchema.extend({ unreadOnly: z.enum(['true', 'false']).optional() });
doc({ method: 'get', path: '/users/me/notifications', summary: 'My notifications', tags: ['Users', 'Notifications'], query: notifQuery });
usersRouter.get('/me/notifications', validate(notifQuery, 'query'), async (req, res) => {
  const q = query<z.infer<typeof notifQuery>>(req);
  const where = { userId: req.user!.id, ...(q.unreadOnly === 'true' ? { readAt: null } : {}) };
  const [total, unread, rows] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: req.user!.id, readAt: null } }),
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q.page, q.pageSize) }),
  ]);
  res.json({ ...paginate(rows.map(toNotificationDto), total, q.page, q.pageSize), unread });
});

doc({ method: 'post', path: '/users/me/notifications/read-all', summary: 'Mark all notifications read', tags: ['Notifications'] });
usersRouter.post('/me/notifications/read-all', async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
  res.json({ ok: true });
});

doc({ method: 'post', path: '/users/me/notifications/:id/read', summary: 'Mark one notification read', tags: ['Notifications'] });
usersRouter.post('/me/notifications/:id/read', validate(idParam, 'params'), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  await prisma.notification.updateMany({ where: { id, userId: req.user!.id }, data: { readAt: new Date() } });
  res.json({ ok: true });
});

doc({ method: 'delete', path: '/users/me/notifications/:id', summary: 'Delete a notification', tags: ['Notifications'], responses: { 204: 'Deleted' } });
usersRouter.delete('/me/notifications/:id', validate(idParam, 'params'), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  await prisma.notification.deleteMany({ where: { id, userId: req.user!.id } });
  res.status(204).end();
});

doc({ method: 'get', path: '/users/me/recent-resources', summary: 'Resources I booked recently', tags: ['Users'] });
usersRouter.get('/me/recent-resources', async (req, res) => {
  const rows = await prisma.reservation.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, select: { resourceId: true }, take: 50, distinct: ['resourceId'] });
  const ids = rows.map((r) => r.resourceId).slice(0, 6);
  const resources = await prisma.resource.findMany({ where: { id: { in: ids }, deletedAt: null }, include: resourceInclude });
  const favs = new Set((await prisma.favorite.findMany({ where: { userId: req.user!.id }, select: { resourceId: true } })).map((f) => f.resourceId));
  res.json(ids.map((id) => resources.find((r) => r.id === id)).filter(Boolean).map((r) => toResourceDto(r!, { isFavorite: favs.has(r!.id) })));
});

const directoryQuery = paginationQuerySchema.extend({ q: z.string().max(100).optional(), departmentId: z.string().uuid().optional(), teamId: z.string().uuid().optional() });
doc({ method: 'get', path: '/users/directory', summary: 'Office directory (active employees)', tags: ['Users'], query: directoryQuery });
usersRouter.get('/directory', validate(directoryQuery, 'query'), async (req, res) => {
  const q = query<z.infer<typeof directoryQuery>>(req);
  const where = {
    orgId: req.user!.orgId,
    status: 'ACTIVE' as const,
    deletedAt: null,
    ...(q.departmentId ? { departmentId: q.departmentId } : {}),
    ...(q.teamId ? { teamId: q.teamId } : {}),
    ...(q.q
      ? { OR: [{ firstName: { contains: q.q, mode: 'insensitive' as const } }, { lastName: { contains: q.q, mode: 'insensitive' as const } }, { email: { contains: q.q, mode: 'insensitive' as const } }, { jobTitle: { contains: q.q, mode: 'insensitive' as const } }] }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, include: { department: true, team: true }, orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }], ...skipTake(q.page, q.pageSize) }),
  ]);
  res.json(paginate(rows.map(toUserSummaryDto), total, q.page, q.pageSize));
});

doc({ method: 'get', path: '/users/directory/:id/today', summary: "A colleague's seat for today (respects privacy preference)", tags: ['Users'] });
usersRouter.get('/directory/:id/today', validate(idParam, 'params'), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const colleague = await prisma.user.findFirst({ where: { id, orgId: req.user!.orgId, status: 'ACTIVE' }, include: { preferences: true, department: true, team: true } });
  if (!colleague) throw AppError.notFound('Employee');
  const shares = colleague.preferences?.shareLocationWithTeam ?? true;
  const isAdmin = req.user!.permissions.includes('reservation:manage-any');
  if (!shares && !isAdmin && colleague.id !== req.user!.id) return res.json({ user: toUserSummaryDto(colleague), shared: false, seat: null });
  const now = new Date();
  const end = new Date(now.getTime() + 24 * 3600000);
  const seat = await prisma.reservation.findFirst({
    where: { userId: id, type: 'SEAT', status: { in: ['CONFIRMED', 'CHECKED_IN'] }, endAt: { gt: now }, startAt: { lt: end } },
    include: { resource: { include: resourceInclude } },
    orderBy: { startAt: 'asc' },
  });
  res.json({ user: toUserSummaryDto(colleague), shared: true, seat: seat ? { reservationId: seat.id, startAt: seat.startAt.toISOString(), endAt: seat.endAt.toISOString(), resource: toResourceDto(seat.resource) } : null });
});

doc({ method: 'get', path: '/users/me/audit', summary: 'My own recent account activity', tags: ['Users'] });
usersRouter.get('/me/audit', async (req, res) => {
  const rows = await prisma.auditLog.findMany({ where: { actorId: req.user!.id, action: { startsWith: 'auth.' } }, orderBy: { createdAt: 'desc' }, take: 20 });
  res.json(rows.map((r) => ({ id: r.id, action: r.action, ip: r.ip, createdAt: r.createdAt.toISOString() })));
});

void audit;
