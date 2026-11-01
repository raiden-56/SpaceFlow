import { beforeAll, describe, expect, it } from 'vitest';
import { EMPLOYEE, api, auth, futureWeekday, harborTower, iso, login, prisma, resetAndSeed, type Session } from './helpers.js';

describe('buildings, floors, maps, resources, search, dashboard', () => {
  let employee: Session;
  let buildingId: string;
  let floorId: string;
  // Beyond the seed's 7-day booking horizon, so the seeded employee has no desk that day.
  const date = futureWeekday(10);
  const startAt = iso(date, '09:00');
  const endAt = iso(date, '17:00');

  beforeAll(async () => {
    await resetAndSeed();
    employee = await login(EMPLOYEE.email);
    const ht = await harborTower();
    buildingId = ht.building.id;
    floorId = ht.floors[1].id;
  });

  it('lists buildings with counts and floor details', async () => {
    const res = await api().get('/api/v1/buildings').set(auth(employee));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const ht = res.body.find((b: { code: string }) => b.code === 'HT');
    expect(ht.floorCount).toBe(4);
    expect(ht.seatCount).toBeGreaterThan(100);
    expect(ht.timezone).toBe('Asia/Kolkata');
    const floors = await api().get(`/api/v1/buildings/${buildingId}/floors`).set(auth(employee));
    expect(floors.body.map((f: { number: number }) => f.number)).toEqual([0, 1, 2, 3]);
    expect(floors.body[1].floorPlanStatus).toBe('PUBLISHED');
    expect((await api().get('/api/v1/buildings/3f4e8b1a-2c4d-4e6f-8a9b-0c1d2e3f4a5b').set(auth(employee))).status).toBe(404);
  });

  it('returns the floor map with objects, zones and per-resource availability for a window', async () => {
    const res = await api().get(`/api/v1/floors/${floorId}/map?startAt=${startAt}&endAt=${endAt}`).set(auth(employee));
    expect(res.status).toBe(200);
    expect(res.body.plan.widthM).toBe(44);
    expect(res.body.objects.length).toBeGreaterThan(50);
    expect(res.body.zones).toHaveLength(3);
    expect(res.body.resources.length).toBe(52);
    const kinds = new Set(res.body.objects.map((o: { kind: string }) => o.kind));
    for (const k of ['DESK', 'MEETING_ROOM', 'ELEVATOR', 'STAIRS', 'RESTROOM', 'PRINTER', 'EMERGENCY_EXIT', 'ACCESSIBLE_ROUTE', 'COLLAB_SPACE', 'ZONE']) expect(kinds.has(k), k).toBe(true);
    const states = new Set(res.body.resources.map((r: { availability: { state: string } }) => r.availability.state));
    expect(states.has('AVAILABLE')).toBe(true);
    expect(states.has('DISABLED')).toBe(true); // one maintenance seat per floor
    const desk = res.body.resources.find((r: { type: string }) => r.type === 'SEAT');
    expect(desk.mapPosition).toMatchObject({ width: 1.6, depth: 0.8 });
    expect(desk.buildingTimezone).toBe('Asia/Kolkata');
  });

  it('marks a seat RESERVED for the window once booked and OCCUPIED when the booking is in progress', async () => {
    const map = await api().get(`/api/v1/floors/${floorId}/map?startAt=${startAt}&endAt=${endAt}`).set(auth(employee));
    const seat = map.body.resources.find((r: { type: string; availability: { state: string } }) => r.type === 'SEAT' && r.availability.state === 'AVAILABLE');
    const res = await api().post('/api/v1/reservations').set(auth(employee)).send({ resourceId: seat.id, startAt, endAt });
    expect(res.status).toBe(201);
    const after = await api().get(`/api/v1/resources/availability?resourceIds=${seat.id}&startAt=${startAt}&endAt=${endAt}`).set(auth(employee));
    expect(after.body.items[0].state).toBe('RESERVED');
    expect(after.body.items[0].conflictingReservation.isMine).toBe(true);
    // Flip the reservation to "now" directly in the DB to check the OCCUPIED state.
    const now = new Date();
    await prisma.reservation.update({ where: { id: res.body.created[0].id }, data: { startAt: new Date(now.getTime() - 3600000), endAt: new Date(now.getTime() + 3600000), status: 'CHECKED_IN' } });
    const live = await api().get(`/api/v1/resources/availability?resourceIds=${seat.id}&startAt=${now.toISOString()}&endAt=${new Date(now.getTime() + 60000).toISOString()}`).set(auth(employee));
    expect(live.body.items[0].state).toBe('OCCUPIED');
  });

  it('filters resources by attributes, amenities, capacity and availability', async () => {
    const win = await api().get(`/api/v1/seats?buildingId=${buildingId}&nearWindow=true&pageSize=200`).set(auth(employee));
    expect(win.status).toBe(200);
    expect(win.body.total).toBeGreaterThan(0);
    expect(win.body.items.every((r: { seatAttributes: { nearWindow?: boolean } }) => r.seatAttributes?.nearWindow)).toBe(true);

    const rooms = await api().get(`/api/v1/meeting-rooms?minCapacity=10&pageSize=50`).set(auth(employee));
    expect(rooms.body.items.every((r: { capacity: number }) => r.capacity >= 10)).toBe(true);

    const amenity = await prisma.amenity.findFirstOrThrow({ where: { code: 'video-conferencing' } });
    const vc = await api().get(`/api/v1/meeting-rooms?amenityIds=${amenity.id}&pageSize=50`).set(auth(employee));
    expect(vc.body.items.length).toBeGreaterThan(0);
    expect(vc.body.items.every((r: { amenities: { code: string }[] }) => r.amenities.some((a) => a.code === 'video-conferencing'))).toBe(true);

    const avail = await api().get(`/api/v1/seats?floorId=${floorId}&startAt=${startAt}&endAt=${endAt}&availableOnly=true&pageSize=200`).set(auth(employee));
    expect(avail.body.items.every((r: { availability: { canBook: boolean } }) => r.availability.canBook)).toBe(true);
    expect(avail.body.total).toBeLessThan(52);

    const q = await api().get('/api/v1/resources?q=orion').set(auth(employee));
    expect(q.body.items.map((r: { name: string }) => r.name)).toContain('Orion');
  });

  it('returns slot-by-slot day availability and suggestions', async () => {
    const room = await prisma.resource.findFirstOrThrow({ where: { name: 'Lyra' } });
    const day = await api().get(`/api/v1/resources/${room.id}/availability?date=${date}`).set(auth(employee));
    expect(day.status).toBe(200);
    expect(day.body.operatingStart).toBe('07:30'); // meeting-room policy
    expect(day.body.slotMinutes).toBe(15);
    expect(day.body.slots.length).toBeGreaterThan(40);
    const suggest = await api().get(`/api/v1/resources/suggest?startAt=${startAt}&endAt=${endAt}&limit=3`).set(auth(employee));
    expect(suggest.status).toBe(200);
    expect(suggest.body.length).toBe(3);
    expect(suggest.body.every((s: { availability: { state: string } }) => s.availability.state === 'AVAILABLE')).toBe(true);
  });

  it('global search returns grouped results and respects permissions', async () => {
    const res = await api().get('/api/v1/search?q=lev').set(auth(employee));
    expect(res.status).toBe(200);
    expect(res.body.floors.length).toBeGreaterThan(0);
    const room = await api().get('/api/v1/search?q=titan').set(auth(employee));
    expect(room.body.rooms.map((r: { name: string }) => r.name)).toContain('Titan');
    const people = await api().get('/api/v1/search?q=priya').set(auth(employee));
    expect(people.body.employees.length).toBe(1); // employees hold user:read
    const facility = await api().get('/api/v1/search?q=elevator').set(auth(employee));
    expect(facility.body.facilities.length).toBeGreaterThan(0);
  });

  it('dashboard aggregates real data', async () => {
    const res = await api().get('/api/v1/dashboard').set(auth(employee));
    expect(res.status).toBe(200);
    expect(res.body.user.displayName).toBe('Sam Taylor');
    expect(res.body.availability.totalSeats).toBeGreaterThan(100);
    expect(res.body.favorites.length).toBe(4);
    expect(res.body.announcements.length).toBe(2);
    expect(Array.isArray(res.body.upcoming)).toBe(true);
    expect(res.body.suggestedSeats.length).toBeGreaterThan(0);
  });

  it('directory lists active employees and exposes a colleague’s seat subject to privacy', async () => {
    const dir = await api().get('/api/v1/users/directory?q=sharma').set(auth(employee));
    expect(dir.body.items).toHaveLength(1);
    const priya = dir.body.items[0];
    const today = await api().get(`/api/v1/users/directory/${priya.id}/today`).set(auth(employee));
    expect(today.status).toBe(200);
    expect(today.body.shared).toBe(true);
    await prisma.userPreference.update({ where: { userId: priya.id }, data: { shareLocationWithTeam: false } });
    const hidden = await api().get(`/api/v1/users/directory/${priya.id}/today`).set(auth(employee));
    expect(hidden.body.shared).toBe(false);
    expect(hidden.body.seat).toBeNull();
  });
});
