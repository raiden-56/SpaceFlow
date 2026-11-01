// Admin workflows: buildings, floors, resources, Map Studio (floor plan save/validate/publish),
// CSV import, asset upload validation and audit logging.
import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, EMPLOYEE, api, auth, login, prisma, resetAndSeed, type Session } from './helpers.js';

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

describe('admin workflows', () => {
  let admin: Session;
  let employee: Session;
  let buildingId: string;
  let floorId: string;
  let seatId: string;

  beforeAll(async () => {
    await resetAndSeed();
    admin = await login(ADMIN.email, ADMIN.password);
    employee = await login(EMPLOYEE.email);
  });

  it('creates a building (validating the timezone) and a floor', async () => {
    const badTz = await api().post('/api/v1/admin/buildings').set(auth(admin)).send({ name: 'Annex', code: 'ANX', timezone: 'Mars/Olympus' });
    expect(badTz.status).toBe(400);
    const b = await api().post('/api/v1/admin/buildings').set(auth(admin)).send({ name: 'Annex', code: 'anx', timezone: 'Europe/London', city: 'London' });
    expect(b.status).toBe(201);
    expect(b.body.code).toBe('ANX');
    buildingId = b.body.id;
    const dup = await api().post('/api/v1/admin/buildings').set(auth(admin)).send({ name: 'Annex 2', code: 'ANX', timezone: 'Europe/London' });
    expect(dup.status).toBe(409);

    const f = await api().post(`/api/v1/admin/buildings/${buildingId}/floors`).set(auth(admin)).send({ name: 'Level 1', number: 1 });
    expect(f.status).toBe(201);
    floorId = f.body.id;
    // A floor cannot be published before it has a floor plan.
    const pub = await api().patch(`/api/v1/admin/floors/${floorId}`).set(auth(admin)).send({ isPublished: true });
    expect(pub.status).toBe(422);
    // Unpublished floors are invisible to employees.
    expect((await api().get(`/api/v1/floors/${floorId}`).set(auth(employee))).status).toBe(404);
  });

  it('creates seats and a meeting room on the floor', async () => {
    const seat = await api().post('/api/v1/seats').set(auth(admin)).send({ code: 'ANX1-001', name: 'Desk ANX1-001', floorId, seatAttributes: { monitor: true, nearWindow: true } });
    expect(seat.status).toBe(201);
    expect(seat.body.buildingId).toBe(buildingId);
    seatId = seat.body.id;
    const room = await api().post('/api/v1/meeting-rooms').set(auth(admin)).send({ code: 'ANX1-BIG', name: 'Big Ben', floorId, capacity: 10 });
    expect(room.status).toBe(201);
    expect(room.body.capacity).toBe(10);
    const dup = await api().post('/api/v1/seats').set(auth(admin)).send({ code: 'ANX1-001', name: 'dup', floorId });
    expect(dup.status).toBe(409);
  });

  it('Map Studio: validates the plan, links resources by code, publishes and keeps identity on replace', async () => {
    const invalid = await api().put(`/api/v1/admin/floors/${floorId}/plan`).set(auth(admin)).send({
      widthM: 20,
      depthM: 10,
      objects: [
        { kind: 'DESK', label: 'ANX1-001', x: 1, y: 1, width: 1.6, depth: 0.8, resourceCode: 'ANX1-001' },
        { kind: 'DESK', label: 'dup', x: 4, y: 1, width: 1.6, depth: 0.8, resourceCode: 'ANX1-001' },
        { kind: 'MEETING_ROOM', label: 'Big Ben', x: 18, y: 1, width: 6, depth: 4, resourceCode: 'ANX1-BIG' },
        { kind: 'DESK', label: 'ghost', x: 1, y: 4, width: 1.6, depth: 0.8, resourceCode: 'NOPE' },
      ],
    });
    expect(invalid.status).toBe(400);
    const issues: string[] = invalid.body.error.details.issues;
    expect(issues.some((i) => /linked twice/.test(i))).toBe(true);
    expect(issues.some((i) => /outside the floor bounds/.test(i))).toBe(true);
    expect(issues.some((i) => /no resource with code "NOPE"/.test(i))).toBe(true);

    const ok = await api().put(`/api/v1/admin/floors/${floorId}/plan`).set(auth(admin)).send({
      widthM: 20,
      depthM: 10,
      objects: [
        { kind: 'DESK', label: 'ANX1-001', x: 1, y: 1, width: 1.6, depth: 0.8, resourceCode: 'ANX1-001' },
        { kind: 'ELEVATOR', label: 'Lifts', x: 17, y: 7, width: 2, depth: 2 },
      ],
    });
    expect(ok.status).toBe(200);
    expect(ok.body.linked).toBe(1);
    expect(ok.body.unlinkedResources).toEqual(['ANX1-BIG']);

    const pub = await api().post(`/api/v1/admin/floors/${floorId}/plan/publish`).set(auth(admin));
    expect(pub.status).toBe(200);
    expect(pub.body.warnings.join(' ')).toMatch(/ANX1-BIG/);

    const map = await api().get(`/api/v1/floors/${floorId}/map`).set(auth(employee));
    expect(map.status).toBe(200);
    expect(map.body.objects.find((o: { resourceId: string }) => o.resourceId === seatId)).toBeTruthy();

    // Replacing the plan (new coordinates) keeps the resource id; booking history is untouched.
    const replaced = await api().put(`/api/v1/admin/floors/${floorId}/plan`).set(auth(admin)).send({ widthM: 20, depthM: 10, objects: [{ kind: 'DESK', label: 'ANX1-001', x: 5, y: 5, width: 1.6, depth: 0.8, resourceId: seatId }] });
    expect(replaced.status).toBe(200);
    expect(await prisma.resource.findUnique({ where: { id: seatId } })).not.toBeNull();
    const seatDto = await api().get(`/api/v1/resources/${seatId}`).set(auth(admin));
    expect(seatDto.body.mapPosition.x).toBe(5);
  });

  it('demo layouts have no overlapping or out-of-bounds desks and rooms on any floor', async () => {
    const { findBookableOverlaps } = await import('../../src/modules/admin/workplace.js');
    const plans = await prisma.floorPlan.findMany({ where: { floor: { building: { code: { in: ['HT', 'RC'] } } } }, include: { objects: true, floor: { select: { name: true } } } });
    expect(plans.length).toBe(6);
    for (const p of plans) {
      expect(findBookableOverlaps(p.objects), `overlaps on ${p.floor.name}`).toEqual([]);
      for (const o of p.objects.filter((x) => x.kind === 'DESK' || x.kind === 'MEETING_ROOM')) {
        expect(o.x >= 0 && o.y >= 0 && o.x + o.width <= p.widthM + 0.001 && o.y + o.depth <= p.depthM + 0.001, `${o.label} out of bounds on ${p.floor.name}`).toBe(true);
      }
    }
  });

  it('rejects a floor plan with overlapping bookable objects', async () => {
    const res = await api().put(`/api/v1/admin/floors/${floorId}/plan`).set(auth(admin)).send({
      widthM: 20,
      depthM: 10,
      objects: [
        { kind: 'DESK', label: 'ANX1-001', x: 1, y: 1, width: 1.6, depth: 0.8, resourceId: seatId },
        { kind: 'MEETING_ROOM', label: 'Big Ben', x: 2, y: 1, width: 6, depth: 4, resourceCode: 'ANX1-BIG' },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.issues.join(' ')).toMatch(/overlaps/);
  });

  it('imports seats from CSV with a dry run first, then commits', async () => {
    const csv = 'code,name,floorNumber,seatType,x,y,monitor,amenities\nANX1-002,Desk ANX1-002,1,WORKSTATION,3,3,true,monitor\nANX1-003,Desk ANX1-003,1,HOT_DESK,5,3,false,\n';
    const bad = 'code,name,floorNumber\nANX9-001,Desk,9\n';
    const badRes = await api().post(`/api/v1/admin/buildings/${buildingId}/import`).set(auth(admin)).field('type', 'seats').field('dryRun', 'true').attach('file', Buffer.from(bad), 'seats.csv');
    expect(badRes.status).toBe(422);
    expect(badRes.body.errors[0].message).toMatch(/Floor 9 does not exist/);

    const dry = await api().post(`/api/v1/admin/buildings/${buildingId}/import`).set(auth(admin)).field('type', 'seats').field('dryRun', 'true').attach('file', Buffer.from(csv), 'seats.csv');
    expect(dry.status).toBe(200);
    expect(dry.body).toMatchObject({ dryRun: true, valid: 2, created: 0 });
    expect(await prisma.resource.count({ where: { buildingId, code: { in: ['ANX1-002', 'ANX1-003'] } } })).toBe(0);

    const commit = await api().post(`/api/v1/admin/buildings/${buildingId}/import`).set(auth(admin)).field('type', 'seats').field('dryRun', 'false').attach('file', Buffer.from(csv), 'seats.csv');
    expect(commit.status).toBe(200);
    expect(commit.body.created).toBe(2);
    // Coordinates were supplied and a plan exists, so map objects were placed.
    const placed = await prisma.mapObject.count({ where: { resource: { buildingId, code: { in: ['ANX1-002', 'ANX1-003'] } } } });
    expect(placed).toBe(2);

    const exported = await api().get(`/api/v1/admin/buildings/${buildingId}/export?type=seats`).set(auth(admin));
    expect(exported.status).toBe(200);
    expect(exported.text).toMatch(/ANX1-002/);
  });

  it('validates uploaded assets by content, type and size', async () => {
    const ok = await api().post('/api/v1/assets').set(auth(admin)).field('kind', 'FLOOR_PLAN_IMAGE').attach('file', PNG_1PX, 'plan.png');
    expect(ok.status).toBe(201);
    expect(ok.body.mimeType).toBe('image/png');

    const exe = await api().post('/api/v1/assets').set(auth(admin)).field('kind', 'FLOOR_PLAN_IMAGE').attach('file', Buffer.from('MZ\x90\x00'), 'evil.exe');
    expect(exe.status).toBe(415);

    const fakePng = await api().post('/api/v1/assets').set(auth(admin)).field('kind', 'FLOOR_PLAN_IMAGE').attach('file', Buffer.from('<html>not a png</html>'), 'plan.png');
    expect(fakePng.status).toBe(415);

    const svg = await api().post('/api/v1/assets').set(auth(admin)).field('kind', 'FLOOR_PLAN_IMAGE').attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'plan.svg');
    expect(svg.status).toBe(415);

    const fakeGlb = await api().post('/api/v1/assets').set(auth(admin)).field('kind', 'BUILDING_MODEL').attach('file', Buffer.from('not gltf'), 'model.glb');
    expect(fakeGlb.status).toBe(415);

    const big = Buffer.alloc(26 * 1024 * 1024, 0);
    PNG_1PX.copy(big);
    const tooBig = await api().post('/api/v1/assets').set(auth(admin)).field('kind', 'FLOOR_PLAN_IMAGE').attach('file', big, 'huge.png');
    expect(tooBig.status).toBe(413);

    const forbidden = await api().post('/api/v1/assets').set(auth(employee)).field('kind', 'FLOOR_PLAN_IMAGE').attach('file', PNG_1PX, 'plan.png');
    expect(forbidden.status).toBe(403);

    expect((await api().delete(`/api/v1/assets/${ok.body.id}`).set(auth(admin))).status).toBe(204);
  });

  it('records administrative changes in the audit log', async () => {
    const res = await api().get(`/api/v1/admin/audit?pageSize=100`).set(auth(admin));
    expect(res.status).toBe(200);
    const actions = res.body.items.map((i: { action: string }) => i.action);
    for (const a of ['building.create', 'floor.create', 'resource.create', 'floorplan.save', 'floorplan.publish', 'resource.import', 'asset.upload']) {
      expect(actions).toContain(a);
    }
    expect((await api().get('/api/v1/admin/audit').set(auth(employee))).status).toBe(403);
  });

  it('archiving a building is blocked while it has active reservations', async () => {
    const d = new Date(Date.now() + 2 * 86400000);
    // Weekends are closed by default policy; use the admin override path through a 24/7 seat instead.
    const hours: Record<string, { open: string; close: string }> = {};
    for (let i = 0; i <= 6; i++) hours[String(i)] = { open: '00:00', close: '23:59' };
    await api().patch(`/api/v1/seats/${seatId}`).set(auth(admin)).send({ operatingHours: hours });
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 9));
    const booking = await api().post('/api/v1/reservations').set(auth(admin)).send({ resourceId: seatId, startAt: start.toISOString(), endAt: new Date(start.getTime() + 3600000).toISOString() });
    expect(booking.status).toBe(201);
    const blocked = await api().delete(`/api/v1/admin/buildings/${buildingId}`).set(auth(admin));
    expect(blocked.status).toBe(409);
  });
});
