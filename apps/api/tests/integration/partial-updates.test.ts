// PATCH endpoints must only change the fields the client sent. Zod 4 keeps `.default()` values
// inside `.partial()`, which used to reset e.g. a building's isActive or a user's roles whenever
// another field was edited.
import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, api, auth, harborTower, login, resetAndSeed, type Session } from './helpers.js';

describe('partial PATCH keeps fields that were not sent', () => {
  let admin: Session;
  let buildingId: string;
  let floorId: string;

  beforeAll(async () => {
    await resetAndSeed();
    admin = await login(ADMIN.email, ADMIN.password);
    const ht = await harborTower();
    buildingId = ht.building.id;
    floorId = ht.floors[1].id;
  });

  const patch = (path: string, body: object) => api().patch(`/api/v1${path}`).set(auth(admin)).send(body);

  it('buildings: renaming keeps isActive=false', async () => {
    const b = await api().post('/api/v1/admin/buildings').set(auth(admin)).send({ name: 'Annex', code: 'PU-ANX', timezone: 'Europe/London', isActive: false });
    expect(b.status).toBe(201);
    const res = await patch(`/admin/buildings/${b.body.id}`, { name: 'Annex East' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Annex East', isActive: false });
  });

  it('floors: renaming a published floor keeps it published', async () => {
    const res = await patch(`/admin/floors/${floorId}`, { name: 'Level One' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Level One', isPublished: true });
  });

  it('zones and amenities: renaming keeps kind and category', async () => {
    const zone = await api().post(`/api/v1/admin/floors/${floorId}/zones`).set(auth(admin)).send({ name: 'Library', kind: 'QUIET' });
    expect(zone.status).toBe(201);
    const z = await patch(`/admin/zones/${zone.body.id}`, { name: 'Reading room' });
    expect(z.status).toBe(200);
    expect(z.body).toMatchObject({ name: 'Reading room', kind: 'QUIET' });

    const amenity = await api().post('/api/v1/admin/amenities').set(auth(admin)).send({ code: 'pu-lamp', name: 'Lamp', category: 'SEAT' });
    expect(amenity.status).toBe(201);
    const a = await patch(`/admin/amenities/${amenity.body.id}`, { name: 'Desk lamp' });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ name: 'Desk lamp', category: 'SEAT' });
  });

  it('seats and rooms: renaming keeps status, approval, bookability and type', async () => {
    const seat = await api().post('/api/v1/seats').set(auth(admin)).send({ code: 'PU-001', name: 'Desk PU-001', floorId, status: 'MAINTENANCE', isBookable: false, requiresApproval: true, seatType: 'STANDING' });
    expect(seat.status).toBe(201);
    const s = await patch(`/seats/${seat.body.id}`, { name: 'Standing desk' });
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ name: 'Standing desk', status: 'MAINTENANCE', isBookable: false, requiresApproval: true, seatType: 'STANDING' });

    const room = await api().post('/api/v1/meeting-rooms').set(auth(admin)).send({ code: 'PU-BRD', name: 'Board', floorId, capacity: 12, roomType: 'BOARDROOM', requiresApproval: true });
    expect(room.status).toBe(201);
    const r = await patch(`/meeting-rooms/${room.body.id}`, { name: 'Boardroom' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: 'Boardroom', roomType: 'BOARDROOM', requiresApproval: true, capacity: 12 });
  });

  it('policies: renaming keeps every other rule', async () => {
    const created = await api().post('/api/v1/admin/policies').set(auth(admin)).send({ name: 'Weekend crew', buildingId, advanceBookingDays: 60, allowWeekends: true, checkInRequired: false, maxDailyBookings: 5, operatingStart: '06:00', isActive: false });
    expect(created.status).toBe(201);
    const res = await patch(`/admin/policies/${created.body.id}`, { name: 'Weekend team' });
    expect(res.status).toBe(200);
    const { name, updatedAt, ...rest } = res.body;
    const { name: _n, updatedAt: _u, ...before } = created.body;
    expect(name).toBe('Weekend team');
    expect(rest).toEqual(before);
  });

  it('users: editing the job title keeps roles', async () => {
    const created = await api().post('/api/v1/admin/users').set(auth(admin)).send({ email: 'pu.approver@spaceflow.local', firstName: 'Pat', lastName: 'Approver', roles: ['EMPLOYEE', 'APPROVER'] });
    expect(created.status).toBe(201);
    const res = await patch(`/admin/users/${created.body.id}`, { jobTitle: 'Team lead' });
    expect(res.status).toBe(200);
    expect(res.body.jobTitle).toBe('Team lead');
    expect([...res.body.roles].sort()).toEqual(['APPROVER', 'EMPLOYEE']);
  });

  it('users: an org admin can edit their own profile without losing ORG_ADMIN', async () => {
    const res = await patch(`/admin/users/${admin.userId}`, { jobTitle: 'Head of Workplace' });
    expect(res.status).toBe(200);
    expect(res.body.roles).toContain('ORG_ADMIN');
  });
});
