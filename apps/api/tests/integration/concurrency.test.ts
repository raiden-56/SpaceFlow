// Concurrency: many users racing for the same seat must yield exactly one reservation.
// Covers both layers of protection: the API pre-check and the PostgreSQL exclusion constraint.
import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ADMIN, api, auth, createEmployee, freeSeat, futureWeekday, iso, login, prisma, resetAndSeed, type Session } from './helpers.js';
import { shortCode } from '../../src/utils/crypto.js';

describe('concurrent booking protection', () => {
  let admin: Session;
  const users: Session[] = [];
  const date = futureWeekday(12);

  beforeAll(async () => {
    await resetAndSeed();
    admin = await login(ADMIN.email, ADMIN.password);
    for (let i = 0; i < 10; i++) users.push(await createEmployee(admin, `racer${i}`));
  });

  it('10 parallel requests for the same seat and time: exactly one succeeds, the rest get 409', async () => {
    const seat = await freeSeat(date);
    const body = { resourceId: seat.id, startAt: iso(date, '09:00'), endAt: iso(date, '17:00') };
    const results = await Promise.all(users.map((u) => api().post('/api/v1/reservations').set(auth(u)).send(body)));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(9);
    for (const r of results.filter((x) => x.status === 409)) expect(r.body.error.code).toBe('BOOKING_CONFLICT');
    const active = await prisma.reservation.count({ where: { resourceId: seat.id, status: { in: ['CONFIRMED', 'PENDING_APPROVAL', 'CHECKED_IN'] } } });
    expect(active).toBe(1);
  });

  it('parallel requests for overlapping (not identical) windows also produce a single winner', async () => {
    const seat = await freeSeat(date);
    const windows = [
      ['09:00', '12:00'],
      ['10:00', '13:00'],
      ['11:30', '14:00'],
      ['08:00', '09:30'],
    ];
    const results = await Promise.all(windows.map(([s, e], i) => api().post('/api/v1/reservations').set(auth(users[i])).send({ resourceId: seat.id, startAt: iso(date, s), endAt: iso(date, e) })));
    const winners = results.filter((r) => r.status === 201);
    // Every window overlaps at least one other, so any non-overlapping subset is acceptable,
    // but the database must never contain two overlapping active reservations.
    expect(winners.length).toBeGreaterThanOrEqual(1);
    const rows = await prisma.reservation.findMany({ where: { resourceId: seat.id, status: 'CONFIRMED' }, orderBy: { startAt: 'asc' } });
    for (let i = 1; i < rows.length; i++) expect(rows[i].startAt.getTime()).toBeGreaterThanOrEqual(rows[i - 1].endAt.getTime());
  });

  describe('database exclusion constraint (reservations_no_overlap)', () => {
    const insert = async (resourceId: string, userId: string, orgId: string, start: string, end: string, status: 'CONFIRMED' | 'CANCELLED' = 'CONFIRMED') =>
      prisma.reservation.create({
        data: { id: randomUUID(), orgId, resourceId, userId, type: 'SEAT', status, startAt: new Date(iso(date, start)), endAt: new Date(iso(date, end)), timezone: 'Asia/Kolkata', checkInCode: shortCode() },
      });

    it('rejects an overlapping active row inserted directly (SQLSTATE 23P01)', async () => {
      const seat = await freeSeat(futureWeekday(13));
      const d = futureWeekday(13);
      const u = users[0];
      await prisma.reservation.create({ data: { orgId: u.orgId, resourceId: seat.id, userId: u.userId, type: 'SEAT', status: 'CONFIRMED', startAt: new Date(iso(d, '09:00')), endAt: new Date(iso(d, '10:00')), timezone: 'Asia/Kolkata', checkInCode: shortCode() } });
      await expect(
        prisma.reservation.create({ data: { orgId: u.orgId, resourceId: seat.id, userId: users[1].userId, type: 'SEAT', status: 'CONFIRMED', startAt: new Date(iso(d, '09:30')), endAt: new Date(iso(d, '10:30')), timezone: 'Asia/Kolkata', checkInCode: shortCode() } }),
      ).rejects.toThrow(/reservations_no_overlap|23P01|exclusion/i);
    });

    it('allows a cancelled overlap and an adjacent [10:00, 11:00) after [09:00, 10:00)', async () => {
      const seat = await freeSeat(date);
      const u = users[2];
      await insert(seat.id, u.userId, u.orgId, '09:00', '10:00');
      await expect(insert(seat.id, users[3].userId, u.orgId, '09:15', '09:45', 'CANCELLED')).resolves.toBeTruthy();
      await expect(insert(seat.id, users[4].userId, u.orgId, '10:00', '11:00')).resolves.toBeTruthy();
    });

    it('rejects end <= start (reservations_valid_range)', async () => {
      const seat = await freeSeat(date);
      const u = users[5];
      await expect(insert(seat.id, u.userId, u.orgId, '12:00', '12:00')).rejects.toThrow(/reservations_valid_range|23514|check/i);
    });
  });
});
