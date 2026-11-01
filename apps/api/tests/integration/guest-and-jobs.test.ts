// Guest mode (sandbox tenants) and background jobs, using the jobs' injectable `now`.
import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, api, auth, freeSeat, futureWeekday, login, prisma, resetAndSeed, type Session } from './helpers.js';
import { env } from '../../src/config/env.js';
import { shortCode } from '../../src/utils/crypto.js';
import { completeEndedReservations, purgeGuestSandboxes, releaseNoShows, sendUpcomingReminders } from '../../src/jobs/scheduler.js';

describe('guest mode', () => {
  let admin: Session;

  beforeAll(async () => {
    await resetAndSeed();
    admin = await login(ADMIN.email, ADMIN.password);
  });

  it('creates an isolated sandbox with full demo data where every feature works', async () => {
    const res = await api().post('/api/v1/auth/guest').set('X-Requested-With', 'SpaceFlow');
    expect(res.status).toBe(200);
    expect(res.body.user.isGuest).toBe(true);
    expect(res.body.user.guestExpiresAt).toBeTypeOf('string');
    expect(res.body.user.roles).toContain('ORG_ADMIN');
    const guest = { token: res.body.accessToken } as Session;
    const g = { Authorization: `Bearer ${guest.token}`, 'X-Requested-With': 'SpaceFlow' };

    const buildings = await api().get('/api/v1/buildings').set(g);
    expect(buildings.body.map((b: { name: string }) => b.name)).toEqual(['Harbor Tower', 'Riverside Campus']);
    const dash = await api().get('/api/v1/dashboard').set(g);
    expect(dash.status).toBe(200);
    expect(dash.body.favorites.length).toBeGreaterThan(0);
    const analytics = await api().get('/api/v1/admin/analytics/overview').set(g);
    expect(analytics.status).toBe(200);
    expect(analytics.body.totals.seats).toBeGreaterThan(50);

    // Booking works for the guest.
    const floors = await api().get(`/api/v1/buildings/${buildings.body[0].id}/floors`).set(g);
    const d = futureWeekday(11);
    const startAt = new Date(`${d}T09:00:00+05:30`).toISOString();
    const endAt = new Date(`${d}T12:00:00+05:30`).toISOString();
    const map = await api().get(`/api/v1/floors/${floors.body[1].id}/map?startAt=${startAt}&endAt=${endAt}`).set(g);
    const seat = map.body.resources.find((r: { type: string; availability: { state: string } }) => r.type === 'SEAT' && r.availability.state === 'AVAILABLE');
    const book = await api().post('/api/v1/reservations').set(g).send({ resourceId: seat.id, startAt, endAt });
    expect(book.status).toBe(201);

    // Isolation: the main organisation cannot see guest data and vice versa.
    const mainBuildings = await api().get('/api/v1/buildings').set(auth(admin));
    expect(mainBuildings.body.some((b: { id: string }) => b.id === buildings.body[0].id)).toBe(false);
    expect((await api().get(`/api/v1/floors/${floors.body[1].id}/map`).set(auth(admin))).status).toBe(404);
    expect((await api().get(`/api/v1/reservations/${book.body.created[0].id}`).set(auth(admin))).status).toBe(404);
    const guestUsers = await api().get('/api/v1/admin/users?q=admin%40spaceflow.local').set(g);
    expect(guestUsers.body.total).toBe(0);

    // Sandbox users cannot sign in with a password.
    const sandboxAdmin = await prisma.user.findFirstOrThrow({ where: { organization: { slug: { startsWith: 'guest-' } }, roles: { some: { role: { code: 'ORG_ADMIN' } } }, firstName: 'Alex' } });
    expect((await api().post('/api/v1/auth/login').send({ email: sandboxAdmin.email, password: 'Admin123!' })).status).toBe(401);
  });

  it('two guests get separate sandboxes', async () => {
    const a = await api().post('/api/v1/auth/guest').set('X-Requested-With', 'SpaceFlow');
    const b = await api().post('/api/v1/auth/guest').set('X-Requested-With', 'SpaceFlow');
    expect(a.body.user.orgId).not.toBe(b.body.user.orgId);
  });

  it('can be disabled with GUEST_MODE_ENABLED=false', async () => {
    const original = env.GUEST_MODE_ENABLED;
    (env as { GUEST_MODE_ENABLED: boolean }).GUEST_MODE_ENABLED = false;
    try {
      expect((await api().post('/api/v1/auth/guest').set('X-Requested-With', 'SpaceFlow')).status).toBe(403);
      expect((await api().get('/api/v1/auth/guest/status')).body.enabled).toBe(false);
    } finally {
      (env as { GUEST_MODE_ENABLED: boolean }).GUEST_MODE_ENABLED = original;
    }
  });

  it('expired sandboxes are purged by the scheduler, the main organisation is untouched', async () => {
    const before = await prisma.organization.count({ where: { slug: { startsWith: 'guest-' } } });
    expect(before).toBeGreaterThan(0);
    const later = new Date(Date.now() + (env.GUEST_SANDBOX_TTL_HOURS + 1) * 3600000);
    const purged = await purgeGuestSandboxes(later);
    expect(purged).toBe(before);
    expect(await prisma.organization.count({ where: { slug: { startsWith: 'guest-' } } })).toBe(0);
    expect(await prisma.organization.count({ where: { slug: 'northwind' } })).toBe(1);
    expect((await api().get('/api/v1/buildings').set(auth(admin))).body).toHaveLength(2);
  });
});

describe('background jobs', () => {
  let orgId: string;
  let userId: string;

  beforeAll(async () => {
    await resetAndSeed();
    const u = await prisma.user.findFirstOrThrow({ where: { email: 'employee@spaceflow.local' } });
    orgId = u.orgId;
    userId = u.id;
  });

  const makeReservation = async (start: Date, end: Date, status: 'CONFIRMED' | 'CHECKED_IN' = 'CONFIRMED') => {
    const seat = await freeSeat(futureWeekday(14));
    // Remove any seed rows on this seat around the window so the exclusion constraint allows the fixture.
    await prisma.reservation.deleteMany({ where: { resourceId: seat.id, startAt: { lt: end }, endAt: { gt: start } } });
    return prisma.reservation.create({ data: { orgId, resourceId: seat.id, userId, type: 'SEAT', status, startAt: start, endAt: end, timezone: 'Asia/Kolkata', checkInCode: shortCode(), checkedInAt: status === 'CHECKED_IN' ? start : null } });
  };

  it('sends a reminder once for bookings starting within the hour', async () => {
    const now = new Date('2030-03-04T03:00:00Z');
    const r = await makeReservation(new Date('2030-03-04T03:30:00Z'), new Date('2030-03-04T05:00:00Z'));
    expect(await sendUpcomingReminders(now)).toBeGreaterThanOrEqual(1);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } })).reminderSentAt).not.toBeNull();
    expect(await prisma.notification.count({ where: { userId, type: 'BOOKING_REMINDER', data: { path: ['reservationId'], equals: r.id } } })).toBe(1);
    await sendUpcomingReminders(now);
    expect(await prisma.notification.count({ where: { userId, type: 'BOOKING_REMINDER', data: { path: ['reservationId'], equals: r.id } } })).toBe(1);
  });

  it('releases a no-show after the check-in grace period and notifies the user', async () => {
    const r = await makeReservation(new Date('2030-03-05T03:00:00Z'), new Date('2030-03-05T11:00:00Z'));
    expect(await releaseNoShows(new Date('2030-03-05T03:10:00Z'))).toBe(0); // still within grace
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('CONFIRMED');
    await releaseNoShows(new Date('2030-03-05T03:45:00Z'));
    const row = await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.status).toBe('RELEASED');
    expect(await prisma.notification.count({ where: { userId, type: 'BOOKING_RELEASED' } })).toBeGreaterThanOrEqual(1);
    expect(await prisma.auditLog.count({ where: { entityId: r.id, action: 'reservation.auto-release' } })).toBe(1);
  });

  it('completes checked-in bookings and marks unattended ones as no-shows when they end', async () => {
    const attended = await makeReservation(new Date('2030-03-06T03:00:00Z'), new Date('2030-03-06T04:00:00Z'), 'CHECKED_IN');
    const missed = await makeReservation(new Date('2030-03-06T05:00:00Z'), new Date('2030-03-06T06:00:00Z'));
    await completeEndedReservations(new Date('2030-03-06T07:00:00Z'));
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: attended.id } })).status).toBe('COMPLETED');
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: missed.id } })).status).toBe('NO_SHOW');
  });
});
