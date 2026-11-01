// Admin: employees, roles, departments, teams, invitations.
import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import {
  departmentSchema,
  teamSchema,
  userCreateSchema,
  userListQuerySchema,
  userUpdateSchema,
  type AdminUserDto,
  type DepartmentDto,
  type RoleCode,
} from '@spaceflow/shared';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { validate, body, params, query } from '../../middleware/validate.js';
import { doc } from '../../openapi/registry.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { audit, clientIp } from '../../lib/audit.js';
import { hashPassword } from '../../utils/crypto.js';
import { paginate, skipTake } from '../../utils/pagination.js';
import { createInviteToken, inviteUrl, revokeAllSessions } from '../auth/service.js';
import { emailProvider } from '../../integrations/email.js';
import { listReservations } from '../reservations/service.js';
import { reservationListQuerySchema, type ReservationListQuery } from '@spaceflow/shared';

export const adminPeopleRouter = Router();
adminPeopleRouter.use(requireAuth);

const idParam = z.object({ id: z.string().uuid() });
const userInclude = { roles: { include: { role: true } }, department: true, team: true, homeBuilding: { select: { name: true } } } as const;
type UserRow = Prisma.UserGetPayload<{ include: typeof userInclude }>;

function toAdminUserDto(u: UserRow, extra: { inviteUrl?: string | null } = {}): AdminUserDto {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    displayName: `${u.firstName} ${u.lastName}`,
    avatarUrl: u.avatarUrl,
    jobTitle: u.jobTitle,
    departmentId: u.departmentId,
    departmentName: u.department?.name ?? null,
    teamId: u.teamId,
    teamName: u.team?.name ?? null,
    roles: u.roles.map((r) => r.role.code),
    status: u.status,
    homeBuildingId: u.homeBuildingId,
    homeBuildingName: u.homeBuilding?.name ?? null,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    inviteUrl: extra.inviteUrl,
  };
}

/** Only org admins may grant ORG_ADMIN; workplace admins may manage employees/approvers. */
function assertCanAssignRoles(actorPerms: string[], roles: RoleCode[]) {
  if (!actorPerms.includes('settings:manage') && roles.some((r) => r === 'ORG_ADMIN' || r === 'WORKPLACE_ADMIN')) {
    throw AppError.forbidden('Only organization administrators can assign administrator roles.');
  }
}

async function setRoles(tx: Prisma.TransactionClient, userId: string, roles: RoleCode[]) {
  const roleRows = await tx.role.findMany({ where: { code: { in: roles } } });
  await tx.userRole.deleteMany({ where: { userId } });
  await tx.userRole.createMany({ data: roleRows.map((r) => ({ userId, roleId: r.id })) });
}

doc({ method: 'get', path: '/admin/users', summary: 'List employees', tags: ['Admin', 'Users'], permissions: ['user:manage'], query: userListQuerySchema });
adminPeopleRouter.get('/users', requirePermission('user:manage'), validate(userListQuerySchema, 'query'), async (req, res) => {
  const q = query<z.infer<typeof userListQuerySchema>>(req);
  const where: Prisma.UserWhereInput = {
    orgId: req.user!.orgId,
    deletedAt: null,
    ...(q.departmentId ? { departmentId: q.departmentId } : {}),
    ...(q.teamId ? { teamId: q.teamId } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.role ? { roles: { some: { role: { code: q.role } } } } : {}),
    ...(q.q ? { OR: [{ firstName: { contains: q.q, mode: 'insensitive' } }, { lastName: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }] } : {}),
  };
  const [total, rows] = await Promise.all([prisma.user.count({ where }), prisma.user.findMany({ where, include: userInclude, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], ...skipTake(q.page, q.pageSize) })]);
  res.json(paginate(rows.map((u) => toAdminUserDto(u)), total, q.page, q.pageSize));
});

doc({ method: 'post', path: '/admin/users', summary: 'Create / invite an employee', tags: ['Admin', 'Users'], permissions: ['user:manage'], body: userCreateSchema, responses: { 201: 'Created (includes inviteUrl when invited)' } });
adminPeopleRouter.post('/users', requirePermission('user:manage'), validate(userCreateSchema), async (req, res) => {
  const input = body<z.infer<typeof userCreateSchema>>(req);
  assertCanAssignRoles(req.user!.permissions, input.roles);
  const email = input.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) throw AppError.conflict('An account with this email already exists.');
  const created = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        orgId: req.user!.orgId,
        email,
        firstName: input.firstName,
        lastName: input.lastName,
        jobTitle: input.jobTitle ?? null,
        departmentId: input.departmentId ?? null,
        teamId: input.teamId ?? null,
        homeBuildingId: input.homeBuildingId ?? null,
        status: input.password ? 'ACTIVE' : 'INVITED',
        passwordHash: input.password ? await hashPassword(input.password) : null,
        preferences: { create: {} },
      },
    });
    await setRoles(tx, u.id, input.roles);
    await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: 'user.create', entityType: 'User', entityId: u.id, after: { email, roles: input.roles, status: u.status }, ip: clientIp(req) }, tx);
    return u;
  });
  let link: string | null = null;
  if (!input.password) {
    const token = await createInviteToken(created.id);
    link = inviteUrl(token);
    await emailProvider.send({ to: email, subject: '[SpaceFlow] You have been invited', text: `Hi ${input.firstName},\n\nYou have been invited to SpaceFlow. Set your password here (valid for 7 days):\n${link}` });
  }
  const row = await prisma.user.findUniqueOrThrow({ where: { id: created.id }, include: userInclude });
  res.status(201).json(toAdminUserDto(row, { inviteUrl: link }));
});

doc({ method: 'get', path: '/admin/users/:id', summary: 'Employee details', tags: ['Admin', 'Users'], permissions: ['user:manage'] });
adminPeopleRouter.get('/users/:id', requirePermission('user:manage'), validate(idParam, 'params'), async (req, res) => {
  const row = await prisma.user.findFirst({ where: { id: params<{ id: string }>(req).id, orgId: req.user!.orgId, deletedAt: null }, include: userInclude });
  if (!row) throw AppError.notFound('Employee');
  res.json(toAdminUserDto(row));
});

doc({ method: 'patch', path: '/admin/users/:id', summary: 'Update employee, roles, status', tags: ['Admin', 'Users'], permissions: ['user:manage'], body: userUpdateSchema });
adminPeopleRouter.patch('/users/:id', requirePermission('user:manage'), validate(idParam, 'params'), validate(userUpdateSchema), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const input = body<z.infer<typeof userUpdateSchema>>(req);
  const before = await prisma.user.findFirst({ where: { id, orgId: req.user!.orgId, deletedAt: null }, include: userInclude });
  if (!before) throw AppError.notFound('Employee');
  if (input.roles) {
    assertCanAssignRoles(req.user!.permissions, input.roles);
    const wasOrgAdmin = before.roles.some((r) => r.role.code === 'ORG_ADMIN');
    if (wasOrgAdmin && !input.roles.includes('ORG_ADMIN')) {
      const remaining = await prisma.user.count({ where: { orgId: req.user!.orgId, status: 'ACTIVE', deletedAt: null, id: { not: id }, roles: { some: { role: { code: 'ORG_ADMIN' } } } } });
      if (remaining === 0) throw AppError.policy('At least one active organization administrator is required.');
    }
  }
  if (input.status === 'DEACTIVATED' && id === req.user!.id) throw AppError.policy('You cannot deactivate your own account.');
  const row = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id },
      data: {
        email: input.email?.toLowerCase(),
        firstName: input.firstName,
        lastName: input.lastName,
        jobTitle: input.jobTitle,
        departmentId: input.departmentId,
        teamId: input.teamId,
        homeBuildingId: input.homeBuildingId,
        status: input.status,
      },
    });
    if (input.roles) await setRoles(tx, id, input.roles);
    await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: 'user.update', entityType: 'User', entityId: id, before: { status: before.status, roles: before.roles.map((r) => r.role.code) }, after: { status: u.status, roles: input.roles ?? undefined, ...input }, ip: clientIp(req) }, tx);
    return tx.user.findUniqueOrThrow({ where: { id }, include: userInclude });
  });
  if (input.status === 'DEACTIVATED' || input.roles) await revokeAllSessions(id);
  if (input.status === 'DEACTIVATED') {
    // Release future bookings of a deactivated account.
    await prisma.reservation.updateMany({ where: { userId: id, status: { in: ['CONFIRMED', 'PENDING_APPROVAL'] }, startAt: { gt: new Date() } }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: req.user!.id, cancelReason: 'Account deactivated' } });
  }
  res.json(toAdminUserDto(row));
});

doc({ method: 'post', path: '/admin/users/:id/invite', summary: 'Re-send an invitation', tags: ['Admin', 'Users'], permissions: ['user:manage'] });
adminPeopleRouter.post('/users/:id/invite', requirePermission('user:manage'), validate(idParam, 'params'), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const user = await prisma.user.findFirst({ where: { id, orgId: req.user!.orgId, deletedAt: null } });
  if (!user) throw AppError.notFound('Employee');
  if (user.status === 'DEACTIVATED') throw AppError.policy('Reactivate the account before inviting.');
  const token = await createInviteToken(id);
  const link = inviteUrl(token);
  await emailProvider.send({ to: user.email, subject: '[SpaceFlow] Your invitation', text: `Hi ${user.firstName},\n\nSet your SpaceFlow password here (valid for 7 days):\n${link}` });
  await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: 'user.invite', entityType: 'User', entityId: id, ip: clientIp(req) });
  res.json({ ok: true, inviteUrl: link });
});

doc({ method: 'get', path: '/admin/users/:id/reservations', summary: "An employee's booking history", tags: ['Admin', 'Users'], permissions: ['user:manage', 'reservation:manage-any'], query: reservationListQuerySchema });
adminPeopleRouter.get('/users/:id/reservations', requirePermission('user:manage', 'reservation:manage-any'), validate(idParam, 'params'), validate(reservationListQuerySchema, 'query'), async (req, res) => {
  const q = { ...query<ReservationListQuery>(req), userId: params<{ id: string }>(req).id };
  res.json(await listReservations(req.user!, q, { ownOnly: false }));
});

doc({ method: 'delete', path: '/admin/users/:id', summary: 'Soft-delete an employee', tags: ['Admin', 'Users'], permissions: ['user:manage'], responses: { 204: 'Deleted' } });
adminPeopleRouter.delete('/users/:id', requirePermission('user:manage'), validate(idParam, 'params'), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  if (id === req.user!.id) throw AppError.policy('You cannot delete your own account.');
  const user = await prisma.user.findFirst({ where: { id, orgId: req.user!.orgId, deletedAt: null } });
  if (!user) throw AppError.notFound('Employee');
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { deletedAt: new Date(), status: 'DEACTIVATED', email: `${user.email}~deleted-${Date.now()}` } });
    await tx.reservation.updateMany({ where: { userId: id, status: { in: ['CONFIRMED', 'PENDING_APPROVAL'] }, startAt: { gt: new Date() } }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: req.user!.id, cancelReason: 'Account removed' } });
    await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: 'user.delete', entityType: 'User', entityId: id, before: { email: user.email }, ip: clientIp(req) }, tx);
  });
  await revokeAllSessions(id);
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Departments & teams
// ---------------------------------------------------------------------------

async function departmentDtos(orgId: string): Promise<DepartmentDto[]> {
  const rows = await prisma.department.findMany({ where: { orgId }, include: { teams: { include: { _count: { select: { users: true } } }, orderBy: { name: 'asc' } }, _count: { select: { users: true } } }, orderBy: { name: 'asc' } });
  return rows.map((d) => ({ id: d.id, name: d.name, memberCount: d._count.users, teams: d.teams.map((t) => ({ id: t.id, name: t.name, memberCount: t._count.users })) }));
}

doc({ method: 'get', path: '/admin/departments', summary: 'Departments with teams', tags: ['Admin', 'Users'], permissions: ['user:read'] });
adminPeopleRouter.get('/departments', requirePermission('user:read'), async (req, res) => res.json(await departmentDtos(req.user!.orgId)));

doc({ method: 'post', path: '/admin/departments', summary: 'Create a department', tags: ['Admin', 'Users'], permissions: ['user:manage'], body: departmentSchema, responses: { 201: 'Created' } });
adminPeopleRouter.post('/departments', requirePermission('user:manage'), validate(departmentSchema), async (req, res) => {
  const row = await prisma.department.create({ data: { orgId: req.user!.orgId, name: body<{ name: string }>(req).name } });
  res.status(201).json({ id: row.id, name: row.name, teams: [], memberCount: 0 });
});
doc({ method: 'patch', path: '/admin/departments/:id', summary: 'Rename a department', tags: ['Admin', 'Users'], permissions: ['user:manage'], body: departmentSchema });
adminPeopleRouter.patch('/departments/:id', requirePermission('user:manage'), validate(idParam, 'params'), validate(departmentSchema), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const existing = await prisma.department.findFirst({ where: { id, orgId: req.user!.orgId } });
  if (!existing) throw AppError.notFound('Department');
  await prisma.department.update({ where: { id }, data: { name: body<{ name: string }>(req).name } });
  res.json((await departmentDtos(req.user!.orgId)).find((d) => d.id === id));
});
doc({ method: 'delete', path: '/admin/departments/:id', summary: 'Delete a department (members are unassigned)', tags: ['Admin', 'Users'], permissions: ['user:manage'], responses: { 204: 'Deleted' } });
adminPeopleRouter.delete('/departments/:id', requirePermission('user:manage'), validate(idParam, 'params'), async (req, res) => {
  await prisma.department.deleteMany({ where: { id: params<{ id: string }>(req).id, orgId: req.user!.orgId } });
  res.status(204).end();
});

doc({ method: 'post', path: '/admin/teams', summary: 'Create a team', tags: ['Admin', 'Users'], permissions: ['user:manage'], body: teamSchema, responses: { 201: 'Created' } });
adminPeopleRouter.post('/teams', requirePermission('user:manage'), validate(teamSchema), async (req, res) => {
  const input = body<{ name: string; departmentId: string }>(req);
  const dep = await prisma.department.findFirst({ where: { id: input.departmentId, orgId: req.user!.orgId } });
  if (!dep) throw AppError.badRequest('Department not found');
  const row = await prisma.team.create({ data: input });
  res.status(201).json({ id: row.id, name: row.name, departmentId: row.departmentId, memberCount: 0 });
});
doc({ method: 'patch', path: '/admin/teams/:id', summary: 'Update a team', tags: ['Admin', 'Users'], permissions: ['user:manage'], body: teamSchema.partial() });
adminPeopleRouter.patch('/teams/:id', requirePermission('user:manage'), validate(idParam, 'params'), validate(teamSchema.partial()), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const existing = await prisma.team.findFirst({ where: { id, department: { orgId: req.user!.orgId } } });
  if (!existing) throw AppError.notFound('Team');
  const row = await prisma.team.update({ where: { id }, data: body(req) as object });
  res.json({ id: row.id, name: row.name, departmentId: row.departmentId });
});
doc({ method: 'delete', path: '/admin/teams/:id', summary: 'Delete a team', tags: ['Admin', 'Users'], permissions: ['user:manage'], responses: { 204: 'Deleted' } });
adminPeopleRouter.delete('/teams/:id', requirePermission('user:manage'), validate(idParam, 'params'), async (req, res) => {
  await prisma.team.deleteMany({ where: { id: params<{ id: string }>(req).id, department: { orgId: req.user!.orgId } } });
  res.status(204).end();
});
