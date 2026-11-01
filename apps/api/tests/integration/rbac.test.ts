import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, APPROVER, EMPLOYEE, WP_ADMIN, api, auth, harborTower, login, resetAndSeed, type Session } from './helpers.js';

describe('role-based access control', () => {
  let employee: Session;
  let wpAdmin: Session;
  let orgAdmin: Session;
  let approver: Session;

  beforeAll(async () => {
    await resetAndSeed();
    [employee, wpAdmin, orgAdmin, approver] = await Promise.all([login(EMPLOYEE.email), login(WP_ADMIN.email), login(ADMIN.email, ADMIN.password), login(APPROVER.email)]);
  });

  it('requires authentication on protected routes', async () => {
    for (const path of ['/api/v1/buildings', '/api/v1/reservations', '/api/v1/dashboard', '/api/v1/admin/users', '/api/v1/users/me/favorites']) {
      const res = await api().get(path);
      expect(res.status, path).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
    const bad = await api().get('/api/v1/buildings').set('Authorization', 'Bearer not.a.token');
    expect(bad.status).toBe(401);
  });

  it('blocks employees from admin endpoints with 403', async () => {
    const checks: [string, 'get' | 'post' | 'patch' | 'delete', unknown?][] = [
      ['/api/v1/admin/users', 'get'],
      ['/api/v1/admin/buildings', 'post', { name: 'X', code: 'X', timezone: 'UTC' }],
      ['/api/v1/admin/policies', 'get'],
      ['/api/v1/admin/analytics/overview', 'get'],
      ['/api/v1/admin/audit', 'get'],
      ['/api/v1/admin/reservations', 'get'],
      ['/api/v1/seats', 'post', { code: 'X', name: 'X', floorId: '3f4e8b1a-2c4d-4e6f-8a9b-0c1d2e3f4a5b' }],
      ['/api/v1/assets', 'get'],
      ['/api/v1/reservations/approvals', 'get'],
    ];
    for (const [path, method, body] of checks) {
      const res = await api()[method](path).set(auth(employee)).send(body as object);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('approvers can see approvals but not manage resources', async () => {
    expect((await api().get('/api/v1/reservations/approvals').set(auth(approver))).status).toBe(200);
    expect((await api().get('/api/v1/admin/users').set(auth(approver))).status).toBe(403);
  });

  it('workplace admins manage resources and policies but cannot assign admin roles or change settings', async () => {
    const { floors } = await harborTower();
    const seat = await api().post('/api/v1/seats').set(auth(wpAdmin)).send({ code: 'RBAC-001', name: 'Desk RBAC-001', floorId: floors[1].id });
    expect(seat.status).toBe(201);
    expect((await api().get('/api/v1/admin/policies').set(auth(wpAdmin))).status).toBe(200);
    expect((await api().get('/api/v1/admin/analytics/overview').set(auth(wpAdmin))).status).toBe(200);
    // user:manage is an org-admin permission
    expect((await api().get('/api/v1/admin/users').set(auth(wpAdmin))).status).toBe(403);
    expect((await api().get('/api/v1/admin/settings').set(auth(wpAdmin))).status).toBe(403);
    expect((await api().get('/api/v1/admin/integrations').set(auth(wpAdmin))).status).toBe(403);
  });

  it('org admins can manage users, but cannot remove the last org admin or deactivate themselves', async () => {
    const list = await api().get('/api/v1/admin/users?pageSize=50').set(auth(orgAdmin));
    expect(list.status).toBe(200);
    const self = await api().patch(`/api/v1/admin/users/${orgAdmin.userId}`).set(auth(orgAdmin)).send({ status: 'DEACTIVATED' });
    expect(self.status).toBe(422);
    const demote = await api().patch(`/api/v1/admin/users/${orgAdmin.userId}`).set(auth(orgAdmin)).send({ roles: ['EMPLOYEE'] });
    expect(demote.status).toBe(422);
  });

  it('employees only see published floors and active buildings', async () => {
    const { building, floors } = await harborTower();
    const { prisma } = await import('./helpers.js');
    await prisma.floor.update({ where: { id: floors[3].id }, data: { isPublished: false } });
    const emp = await api().get(`/api/v1/buildings/${building.id}/floors`).set(auth(employee));
    expect(emp.body.map((f: { id: string }) => f.id)).not.toContain(floors[3].id);
    const adm = await api().get(`/api/v1/buildings/${building.id}/floors`).set(auth(wpAdmin));
    expect(adm.body.map((f: { id: string }) => f.id)).toContain(floors[3].id);
    expect((await api().get(`/api/v1/floors/${floors[3].id}/map`).set(auth(employee))).status).toBe(404);
    expect((await api().get(`/api/v1/floors/${floors[3].id}/map`).set(auth(wpAdmin))).status).toBe(200);
    await prisma.floor.update({ where: { id: floors[3].id }, data: { isPublished: true } });
  });

  it('users cannot read other users’ reservations by id', async () => {
    const { prisma } = await import('./helpers.js');
    const other = await prisma.reservation.findFirstOrThrow({ where: { userId: { not: employee.userId }, status: 'CONFIRMED' } });
    expect((await api().get(`/api/v1/reservations/${other.id}`).set(auth(employee))).status).toBe(404);
    expect((await api().post(`/api/v1/reservations/${other.id}/cancel`).set(auth(employee)).send({})).status).toBe(404);
    expect((await api().get(`/api/v1/reservations/${other.id}`).set(auth(wpAdmin))).status).toBe(200);
  });
});
