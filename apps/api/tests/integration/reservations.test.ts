import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, APPROVER, alwaysOpenSeat, api, auth, createEmployee, freeRoom, freeSeat, futureWeekday, iso, login, prisma, resetAndSeed, type Session } from './helpers.js';

describe('reservations', () => {
  let admin: Session;
  let alice: Session;
  let bob: Session;
  let approver: Session;
  const date = futureWeekday(2);
  const date2 = futureWeekday(3);

  beforeAll(async () => {
    await resetAndSeed();
    admin = await login(ADMIN.email, ADMIN.password);
    approver = await login(APPROVER.email);
    alice = await createEmployee(admin, 'alice');
    bob = await createEmployee(admin, 'bob');
  });

  it('creates a seat booking with a check-in code and a notification', async () => {
    const seat = await freeSeat(date);
    const res = await api().post('/api/v1/reservations').set(auth(alice)).send({ resourceId: seat.id, startAt: iso(date, '09:00'), endAt: iso(date, '17:00') });
    expect(res.status).toBe(201);
    expect(res.body.created).toHaveLength(1);
    const r = res.body.created[0];
    expect(r.status).toBe('CONFIRMED');
    expect(r.resourceCode).toBe(seat.code);
    expect(r.checkInCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(r.actions.canCancel).toBe(true);
    expect(r.actions.canCheckIn).toBe(false);
    const notif = await api().get('/api/v1/users/me/notifications').set(auth(alice));
    expect(notif.body.items[0].type).toBe('BOOKING_CONFIRMED');
    expect(notif.body.unread).toBe(1);
    const mine = await api().get('/api/v1/users/me/reservations?scope=upcoming').set(auth(alice));
    expect(mine.body.items.map((i: { id: string }) => i.id)).toContain(r.id);
  });

  it('rejects an overlapping booking with 409 and suggests alternatives', async () => {
    // Fresh users: alice already holds a seat on `date`, and one person cannot hold two seats at once.
    const first = await createEmployee(admin, 'overlap1');
    const second = await createEmployee(admin, 'overlap2');
    const seat = await freeSeat(date);
    const held = await api().post('/api/v1/reservations').set(auth(first)).send({ resourceId: seat.id, startAt: iso(date, '10:00'), endAt: iso(date, '12:00') });
    expect(held.status).toBe(201);
    const res = await api().post('/api/v1/reservations').set(auth(second)).send({ resourceId: seat.id, startAt: iso(date, '11:00'), endAt: iso(date, '13:00') });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BOOKING_CONFLICT');
    expect(res.body.error.details.alternatives.length).toBeGreaterThan(0);
    expect(res.body.error.details.alternatives[0].resource.id).not.toBe(seat.id);
  });

  it('allows back-to-back bookings sharing a boundary', async () => {
    const seat = await freeSeat(date2);
    const a = await api().post('/api/v1/reservations').set(auth(alice)).send({ resourceId: seat.id, startAt: iso(date2, '09:00'), endAt: iso(date2, '12:00') });
    const b = await api().post('/api/v1/reservations').set(auth(bob)).send({ resourceId: seat.id, startAt: iso(date2, '12:00'), endAt: iso(date2, '15:00') });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
  });

  it('enforces booking policies on the backend', async () => {
    const seat = await freeSeat(date);
    const carol = await createEmployee(admin, 'carol');
    const far = futureWeekday(90);
    const advance = await api().post('/api/v1/reservations').set(auth(carol)).send({ resourceId: seat.id, startAt: iso(far, '09:00'), endAt: iso(far, '10:00') });
    expect(advance.status).toBe(422);
    expect(advance.body.error.code).toBe('POLICY_VIOLATION');
    expect(advance.body.error.message).toMatch(/30 days/);

    const tooLong = await api().post('/api/v1/reservations').set(auth(carol)).send({ resourceId: seat.id, startAt: iso(date, '07:00'), endAt: iso(date, '19:00') });
    expect(tooLong.status).toBe(422);
    expect(tooLong.body.error.message).toMatch(/Maximum booking duration/);

    const past = await api().post('/api/v1/reservations').set(auth(carol)).send({ resourceId: seat.id, startAt: '2020-01-06T04:00:00Z', endAt: '2020-01-06T06:00:00Z' });
    expect(past.status).toBe(422);
    expect(past.body.error.code).toBe('INVALID_TIME_RANGE');

    const outside = await api().post('/api/v1/reservations').set(auth(carol)).send({ resourceId: seat.id, startAt: iso(date, '05:00'), endAt: iso(date, '06:00') });
    expect(outside.status).toBe(422);
    expect(outside.body.error.message).toMatch(/between 07:00 and 20:00/);

    // Two seats at the same time are not allowed for one person.
    const other = await freeSeat(date, [seat.id]);
    expect((await api().post('/api/v1/reservations').set(auth(carol)).send({ resourceId: seat.id, startAt: iso(date, '09:00'), endAt: iso(date, '10:00') })).status).toBe(201);
    const double = await api().post('/api/v1/reservations').set(auth(carol)).send({ resourceId: other.id, startAt: iso(date, '09:30'), endAt: iso(date, '10:30') });
    expect(double.status).toBe(422);
    expect(double.body.error.message).toMatch(/already have seat/);

    // Daily limit: 3 seat bookings per day (policy default).
    const third = await freeSeat(date, [seat.id, other.id]);
    expect((await api().post('/api/v1/reservations').set(auth(carol)).send({ resourceId: other.id, startAt: iso(date, '11:00'), endAt: iso(date, '12:00') })).status).toBe(201);
    expect((await api().post('/api/v1/reservations').set(auth(carol)).send({ resourceId: third.id, startAt: iso(date, '13:00'), endAt: iso(date, '14:00') })).status).toBe(201);
    const fourth = await api().post('/api/v1/reservations').set(auth(carol)).send({ resourceId: third.id, startAt: iso(date, '15:00'), endAt: iso(date, '16:00') });
    expect(fourth.status).toBe(422);
    expect(fourth.body.error.message).toMatch(/Daily limit/);

    const capacity = await freeRoom(date);
    const tooMany = await api().post('/api/v1/reservations').set(auth(carol)).send({ resourceId: capacity.id, startAt: iso(date, '09:00'), endAt: iso(date, '10:00'), attendees: Array.from({ length: (capacity.capacity ?? 4) + 1 }, (_, i) => ({ email: `p${i}@x.io` })) });
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.error.message).toMatch(/seats/);
  });

  it('non-atomic recurring bookings report per-date success and failure', async () => {
    const seat = await freeSeat(futureWeekday(5));
    const dave = await createEmployee(admin, 'dave');
    const d0 = futureWeekday(5);
    // Pre-book the second weekly occurrence for someone else so it fails.
    const { dayjs } = await import('../../src/utils/time.js');
    const d1 = dayjs(d0, 'YYYY-MM-DD').add(7, 'day').format('YYYY-MM-DD');
    expect((await api().post('/api/v1/reservations').set(auth(bob)).send({ resourceId: seat.id, startAt: iso(d1, '09:00'), endAt: iso(d1, '10:00') })).status).toBe(201);
    const res = await api().post('/api/v1/reservations').set(auth(dave)).send({ resourceId: seat.id, startAt: iso(d0, '09:00'), endAt: iso(d0, '11:00'), recurrence: { frequency: 'WEEKLY', interval: 1, count: 3 }, atomic: false });
    expect(res.status).toBe(201);
    expect(res.body.created).toHaveLength(2);
    expect(res.body.failed).toHaveLength(1);
    expect(res.body.failed[0].code).toBe('BOOKING_CONFLICT');
    expect(res.body.seriesId).toBeTypeOf('string');
    expect(res.body.created.every((c: { seriesId: string }) => c.seriesId === res.body.seriesId)).toBe(true);
  });

  it('atomic multi-day bookings roll back entirely when one date conflicts', async () => {
    const seat = await freeSeat(futureWeekday(8));
    const erin = await createEmployee(admin, 'erin');
    const d0 = futureWeekday(8);
    const d1 = futureWeekday(9);
    expect((await api().post('/api/v1/reservations').set(auth(bob)).send({ resourceId: seat.id, startAt: iso(d1, '09:00'), endAt: iso(d1, '10:00') })).status).toBe(201);
    const res = await api().post('/api/v1/reservations').set(auth(erin)).send({ resourceId: seat.id, startAt: iso(d0, '09:00'), endAt: iso(d0, '11:00'), additionalDates: [d1], atomic: true });
    expect(res.status).toBe(409);
    expect(res.body.created).toHaveLength(0);
    expect(res.body.failed).toHaveLength(1);
    const count = await prisma.reservation.count({ where: { userId: erin.userId } });
    expect(count).toBe(0);
  });

  it('modifies a booking (time + title) and re-validates conflicts', async () => {
    const room = await freeRoom(date);
    const created = await api().post('/api/v1/reservations').set(auth(alice)).send({ resourceId: room.id, startAt: iso(date, '14:00'), endAt: iso(date, '15:00'), title: 'Sync' });
    expect(created.status).toBe(201);
    const id = created.body.created[0].id;
    const upd = await api().patch(`/api/v1/reservations/${id}`).set(auth(alice)).send({ endAt: iso(date, '15:30'), title: 'Sync (longer)' });
    expect(upd.status).toBe(200);
    expect(upd.body.title).toBe('Sync (longer)');
    expect(upd.body.endAt).toBe(iso(date, '15:30'));
    const notMine = await api().patch(`/api/v1/reservations/${id}`).set(auth(bob)).send({ title: 'hijack' });
    expect(notMine.status).toBe(404);
    // Bob books right after; Alice cannot extend into it.
    expect((await api().post('/api/v1/reservations').set(auth(bob)).send({ resourceId: room.id, startAt: iso(date, '15:30'), endAt: iso(date, '16:30') })).status).toBe(201);
    const clash = await api().patch(`/api/v1/reservations/${id}`).set(auth(alice)).send({ endAt: iso(date, '16:00') });
    expect(clash.status).toBe(409);
    const audit = await prisma.auditLog.findMany({ where: { entityId: id, action: 'reservation.update' } });
    expect(audit.length).toBe(1);
  });

  it('cancels a booking, keeps the record and frees the resource', async () => {
    const seat = await freeSeat(date2, []);
    const created = await api().post('/api/v1/reservations').set(auth(bob)).send({ resourceId: seat.id, startAt: iso(date2, '16:00'), endAt: iso(date2, '18:00') });
    expect(created.status).toBe(201);
    const id = created.body.created[0].id;
    const cancel = await api().post(`/api/v1/reservations/${id}/cancel`).set(auth(bob)).send({ reason: 'Plans changed' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('CANCELLED');
    expect(cancel.body.cancelReason).toBe('Plans changed');
    expect(await prisma.reservation.findUnique({ where: { id } })).not.toBeNull();
    const again = await api().post('/api/v1/reservations').set(auth(alice)).send({ resourceId: seat.id, startAt: iso(date2, '16:00'), endAt: iso(date2, '18:00') });
    expect(again.status).toBe(201);
    const cancelled = await api().get('/api/v1/users/me/reservations?scope=cancelled').set(auth(bob));
    expect(cancelled.body.items.map((i: { id: string }) => i.id)).toContain(id);
    expect((await api().post(`/api/v1/reservations/${id}/cancel`).set(auth(bob)).send({})).status).toBe(422);
  });

  it('check-in respects the opening window, accepts the QR code and supports check-out', async () => {
    const seat = await alwaysOpenSeat(admin, 'CHK-001');
    const now = new Date();
    // Bookings may not cross local midnight, so keep both windows inside a single local day
    // regardless of when the suite runs: "later" is tomorrow 03:00-04:00 local; "live" is clamped
    // to today and booked by the admin on Frank's behalf (only admins may start in the past).
    const { dayjs } = await import('../../src/utils/time.js');
    const localNow = dayjs(now).tz('Asia/Kolkata');
    const tomorrow = localNow.add(1, 'day').startOf('day');
    const later = await api().post('/api/v1/reservations').set(auth(alice)).send({ resourceId: seat.id, startAt: tomorrow.add(3, 'hour').toISOString(), endAt: tomorrow.add(4, 'hour').toISOString() });
    expect(later.status, JSON.stringify(later.body)).toBe(201);
    const early = await api().post(`/api/v1/reservations/${later.body.created[0].id}/check-in`).set(auth(alice)).send({});
    expect(early.status).toBe(422);
    expect(early.body.error.message).toMatch(/opens/);

    const frank = await createEmployee(admin, 'frank');
    const seat2 = await alwaysOpenSeat(admin, 'CHK-002');
    const dayStart = localNow.startOf('day').valueOf();
    const dayEnd = localNow.endOf('day').subtract(59, 'second').valueOf(); // 23:59 local
    const liveStart = new Date(Math.max(dayStart, now.getTime() - 60 * 60000));
    const liveEnd = new Date(Math.min(dayEnd, now.getTime() + 2 * 3600000));
    const live = await api().post('/api/v1/reservations').set(auth(admin)).send({ resourceId: seat2.id, startAt: liveStart.toISOString(), endAt: liveEnd.toISOString(), onBehalfOfUserId: frank.userId });
    expect(live.status, JSON.stringify(live.body)).toBe(201);
    const r = live.body.created[0];
    expect(r.actions.canCheckIn).toBe(true);
    const wrongCode = await api().post(`/api/v1/reservations/${r.id}/check-in`).set(auth(bob)).send({ code: 'XXXX-XXXX' });
    expect(wrongCode.status).toBe(403);
    const qr = await api().get(`/api/v1/reservations/${r.id}/qr`).set(auth(frank));
    expect(qr.status).toBe(200);
    expect(qr.body.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    // Another user scanning the correct code (kiosk) can check the booking in.
    const checked = await api().post(`/api/v1/reservations/${r.id}/check-in`).set(auth(bob)).send({ code: qr.body.code });
    expect(checked.status).toBe(200);
    expect(checked.body.status).toBe('CHECKED_IN');
    const records = await prisma.checkInRecord.findMany({ where: { reservationId: r.id } });
    expect(records[0].method).toBe('QR');
    const out = await api().post(`/api/v1/reservations/${r.id}/check-out`).set(auth(frank));
    expect(out.status).toBe(200);
    expect(out.body.status).toBe('COMPLETED');
    const row = await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.endAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    const ics = await api().get(`/api/v1/reservations/${r.id}/ics`).set(auth(frank));
    expect(ics.status).toBe(200);
    expect(ics.headers['content-type']).toMatch(/text\/calendar/);
  });

  it('approval workflow: restricted rooms go PENDING_APPROVAL, approvers decide, requesters cannot self-approve', async () => {
    const boardroom = await freeRoom(futureWeekday(6), { requiresApproval: true });
    const d = futureWeekday(6);
    const res = await api().post('/api/v1/reservations').set(auth(alice)).send({ resourceId: boardroom.id, startAt: iso(d, '09:00'), endAt: iso(d, '10:00'), title: 'Board prep' });
    expect(res.status).toBe(201);
    const r = res.body.created[0];
    expect(r.status).toBe('PENDING_APPROVAL');
    expect(r.approval.status).toBe('PENDING');
    const pending = await api().get('/api/v1/reservations/approvals').set(auth(approver));
    expect(pending.body.items.map((i: { id: string }) => i.id)).toContain(r.id);
    expect((await api().post(`/api/v1/reservations/${r.id}/approval`).set(auth(alice)).send({ decision: 'APPROVED' })).status).toBe(403);
    const decided = await api().post(`/api/v1/reservations/${r.id}/approval`).set(auth(approver)).send({ decision: 'APPROVED', note: 'ok' });
    expect(decided.status).toBe(200);
    expect(decided.body.status).toBe('CONFIRMED');
    expect(decided.body.approval.approverName).toBe('Rahul Verma');
    expect((await api().post(`/api/v1/reservations/${r.id}/approval`).set(auth(approver)).send({ decision: 'REJECTED' })).status).toBe(409);
    const notif = await api().get('/api/v1/users/me/notifications').set(auth(alice));
    expect(notif.body.items.some((n: { type: string }) => n.type === 'APPROVAL_DECIDED')).toBe(true);
  });

  it('favorites and notifications', async () => {
    const seat = await freeSeat(date);
    const add = await api().post('/api/v1/users/me/favorites').set(auth(alice)).send({ resourceId: seat.id });
    expect(add.status).toBe(201);
    const list = await api().get('/api/v1/users/me/favorites').set(auth(alice));
    expect(list.body.map((f: { resource: { id: string } }) => f.resource.id)).toContain(seat.id);
    const detail = await api().get(`/api/v1/resources/${seat.id}`).set(auth(alice));
    expect(detail.body.isFavorite).toBe(true);
    expect((await api().delete(`/api/v1/users/me/favorites/${seat.id}`).set(auth(alice))).status).toBe(204);
    expect((await api().get('/api/v1/users/me/favorites').set(auth(alice))).body.some((f: { resource: { id: string } }) => f.resource.id === seat.id)).toBe(false);

    const notifs = await api().get('/api/v1/users/me/notifications').set(auth(alice));
    expect(notifs.body.unread).toBeGreaterThan(0);
    const first = notifs.body.items[0];
    expect((await api().post(`/api/v1/users/me/notifications/${first.id}/read`).set(auth(alice))).status).toBe(200);
    expect((await api().post('/api/v1/users/me/notifications/read-all').set(auth(alice))).status).toBe(200);
    expect((await api().get('/api/v1/users/me/notifications').set(auth(alice))).body.unread).toBe(0);
    expect((await api().delete(`/api/v1/users/me/notifications/${first.id}`).set(auth(alice))).status).toBe(204);
  });

  it('admins can book on behalf of a user and cancel with a reason (audited)', async () => {
    const seat = await freeSeat(futureWeekday(4));
    const d = futureWeekday(4);
    const res = await api().post('/api/v1/reservations').set(auth(admin)).send({ resourceId: seat.id, startAt: iso(d, '09:00'), endAt: iso(d, '12:00'), onBehalfOfUserId: bob.userId });
    expect(res.status).toBe(201);
    expect(res.body.created[0].userId).toBe(bob.userId);
    const id = res.body.created[0].id;
    expect((await api().post(`/api/v1/admin/reservations/${id}/cancel`).set(auth(admin)).send({})).status).toBe(400);
    const cancel = await api().post(`/api/v1/admin/reservations/${id}/cancel`).set(auth(admin)).send({ reason: 'Maintenance' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('CANCELLED');
    const audit = await prisma.auditLog.findFirst({ where: { entityId: id, action: 'reservation.admin-cancel' } });
    expect(audit?.actorId).toBe(admin.userId);
    const all = await api().get(`/api/v1/admin/reservations?status=CANCELLED&q=${seat.code}`).set(auth(admin));
    expect(all.body.items.map((i: { id: string }) => i.id)).toContain(id);
    // Date filters use overlap semantics: a 09:00-12:00 booking appears in a 10:00-11:00 range.
    const from = encodeURIComponent(iso(d, '10:00'));
    const to = encodeURIComponent(iso(d, '11:00'));
    const ranged = await api().get(`/api/v1/admin/reservations?from=${from}&to=${to}&q=${seat.code}`).set(auth(admin));
    expect(ranged.body.items.map((i: { id: string }) => i.id)).toContain(id);
    const outside = await api().get(`/api/v1/admin/reservations?from=${encodeURIComponent(iso(d, '12:00'))}&to=${encodeURIComponent(iso(d, '13:00'))}&q=${seat.code}`).set(auth(admin));
    expect(outside.body.items.map((i: { id: string }) => i.id)).not.toContain(id);
  });
});
