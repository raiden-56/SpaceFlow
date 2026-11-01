// Reusable demo-data generator. Used by `prisma/seed.ts` (development seed) and by guest mode,
// which provisions a private sandbox organisation per guest so every feature works on realistic
// data without touching other tenants. Never runs automatically in production.
import { randomUUID } from 'node:crypto';
import type { MapObjectKind, Prisma, PrismaClient, ReservationStatus } from '@prisma/client';
import { Permissions, ROLE_PERMISSIONS, RoleCodes } from '@spaceflow/shared';
import { shortCode } from '../utils/crypto.js';
import { dayjs, fromLocal } from '../utils/time.js';

type Db = PrismaClient | Prisma.TransactionClient;

export interface DemoOptions {
  slug: string;
  name: string;
  emailDomain: string;
  adminEmail: string;
  adminPasswordHash: string;
  userPasswordHash: string;
  /** When set, the organisation is a guest sandbox and this user becomes its owner. */
  guest?: { email: string; firstName: string; lastName: string };
  seed?: number;
}

export interface DemoResult {
  orgId: string;
  adminUserId: string;
  employeeUserId: string;
  stats: { buildings: number; floors: number; desks: number; rooms: number; users: number; reservations: number };
}

interface FloorSpec {
  name: string;
  number: number;
  kind: 'lobby' | 'office' | 'top';
  pods: number;
  rooms: { name: string; capacity: number; type: 'MEETING' | 'CONFERENCE' | 'HUDDLE' | 'BOARDROOM' | 'TRAINING'; approval?: boolean; accessible?: boolean }[];
  zones: { name: string; kind: 'NEIGHBORHOOD' | 'QUIET' | 'COLLABORATION' | 'GENERAL'; color: string }[];
}

interface BuildingSpec {
  name: string;
  code: string;
  city: string;
  country: string;
  timezone: string;
  addressLine: string;
  description: string;
  widthM: number;
  depthM: number;
  floors: FloorSpec[];
}

export const DEMO_BUILDINGS: BuildingSpec[] = [
  {
    name: 'Harbor Tower',
    code: 'HT',
    city: 'Bengaluru',
    country: 'India',
    timezone: 'Asia/Kolkata',
    addressLine: '12 Marina Boulevard, Whitefield',
    description: 'Headquarters. Three office floors above a reception lobby, rooftop cafeteria on level 3.',
    widthM: 44,
    depthM: 26,
    floors: [
      { name: 'Ground Floor', number: 0, kind: 'lobby', pods: 4, rooms: [{ name: 'Orion', capacity: 6, type: 'MEETING' }, { name: 'Vega', capacity: 4, type: 'HUDDLE', accessible: true }], zones: [{ name: 'Reception Wing', kind: 'GENERAL', color: '#E0E7FF' }] },
      { name: 'Level 1', number: 1, kind: 'office', pods: 12, rooms: [{ name: 'Lyra', capacity: 8, type: 'MEETING' }, { name: 'Nova', capacity: 12, type: 'CONFERENCE', accessible: true }, { name: 'Sirius', capacity: 4, type: 'HUDDLE' }, { name: 'Atlas', capacity: 20, type: 'TRAINING' }], zones: [{ name: 'Engineering North', kind: 'NEIGHBORHOOD', color: '#DBEAFE' }, { name: 'Engineering South', kind: 'NEIGHBORHOOD', color: '#DCFCE7' }, { name: 'Focus Zone', kind: 'QUIET', color: '#FEF3C7' }] },
      { name: 'Level 2', number: 2, kind: 'office', pods: 12, rooms: [{ name: 'Luna', capacity: 6, type: 'MEETING' }, { name: 'Titan', capacity: 16, type: 'BOARDROOM', approval: true, accessible: true }, { name: 'Polaris', capacity: 4, type: 'HUDDLE' }, { name: 'Nebula', capacity: 10, type: 'MEETING' }], zones: [{ name: 'Product & Design', kind: 'NEIGHBORHOOD', color: '#FCE7F3' }, { name: 'Sales Hub', kind: 'COLLABORATION', color: '#FFEDD5' }, { name: 'Quiet Library', kind: 'QUIET', color: '#FEF3C7' }] },
      { name: 'Level 3', number: 3, kind: 'top', pods: 8, rooms: [{ name: 'Aurora', capacity: 8, type: 'MEETING', accessible: true }, { name: 'Comet', capacity: 4, type: 'HUDDLE' }], zones: [{ name: 'Operations', kind: 'NEIGHBORHOOD', color: '#E0F2FE' }, { name: 'Skyline Collab', kind: 'COLLABORATION', color: '#FFEDD5' }] },
    ],
  },
  {
    name: 'Riverside Campus',
    code: 'RC',
    city: 'Zurich',
    country: 'Switzerland',
    timezone: 'Europe/Zurich',
    addressLine: 'Limmatstrasse 88',
    description: 'European hub. Two open-plan floors with a strong focus on collaboration spaces.',
    widthM: 40,
    depthM: 24,
    floors: [
      { name: 'Ground Floor', number: 0, kind: 'lobby', pods: 6, rooms: [{ name: 'Helix', capacity: 8, type: 'MEETING', accessible: true }, { name: 'Zenith', capacity: 14, type: 'CONFERENCE', approval: true }], zones: [{ name: 'Welcome Area', kind: 'GENERAL', color: '#E0E7FF' }, { name: 'Finance', kind: 'NEIGHBORHOOD', color: '#DCFCE7' }] },
      { name: 'First Floor', number: 1, kind: 'top', pods: 10, rooms: [{ name: 'Delta', capacity: 6, type: 'MEETING' }, { name: 'Echo', capacity: 4, type: 'HUDDLE' }, { name: 'Summit', capacity: 10, type: 'MEETING', accessible: true }], zones: [{ name: 'Engineering EU', kind: 'NEIGHBORHOOD', color: '#DBEAFE' }, { name: 'Deep Work', kind: 'QUIET', color: '#FEF3C7' }] },
    ],
  },
];

const AMENITIES = [
  ['display', 'Display', 'ROOM', 'tv'],
  ['projector', 'Projector', 'ROOM', 'projector'],
  ['whiteboard', 'Whiteboard', 'ROOM', 'whiteboard'],
  ['video-conferencing', 'Video conferencing', 'ROOM', 'videocam'],
  ['conference-phone', 'Conference phone', 'ROOM', 'phone'],
  ['speakers', 'Speakers', 'ROOM', 'speaker'],
  ['microphones', 'Microphones', 'ROOM', 'mic'],
  ['hdmi', 'HDMI connectivity', 'ROOM', 'cable'],
  ['accessible-entrance', 'Accessible entrance', 'BOTH', 'accessible'],
  ['flexible-seating', 'Flexible seating', 'ROOM', 'chair'],
  ['monitor', 'External monitor', 'SEAT', 'monitor'],
  ['dual-monitor', 'Dual monitors', 'SEAT', 'monitor'],
  ['docking-station', 'Docking station', 'SEAT', 'dock'],
  ['standing-desk', 'Height-adjustable desk', 'SEAT', 'height'],
  ['locker', 'Personal locker', 'SEAT', 'lock'],
] as const;

const PEOPLE = [
  ['Priya', 'Sharma', 'Engineering', 'Platform', 'Staff Engineer', 'HT'],
  ['Arjun', 'Mehta', 'Engineering', 'Platform', 'Software Engineer', 'HT'],
  ['Neha', 'Iyer', 'Engineering', 'Mobile', 'Mobile Engineer', 'HT'],
  ['Rahul', 'Verma', 'Engineering', 'Mobile', 'Engineering Manager', 'HT'],
  ['Sofia', 'Rossi', 'Engineering', 'Platform EU', 'Software Engineer', 'RC'],
  ['Lukas', 'Meier', 'Engineering', 'Platform EU', 'Site Reliability Engineer', 'RC'],
  ['Ananya', 'Reddy', 'Design', 'Product Design', 'Product Designer', 'HT'],
  ['Marco', 'Keller', 'Design', 'Product Design', 'UX Researcher', 'RC'],
  ['Karan', 'Patel', 'Sales', 'Enterprise', 'Account Executive', 'HT'],
  ['Elena', 'Fischer', 'Sales', 'Enterprise', 'Sales Director', 'RC'],
  ['Divya', 'Nair', 'Operations', 'Facilities', 'Facilities Coordinator', 'HT'],
  ['Thomas', 'Weber', 'Operations', 'Finance', 'Financial Analyst', 'RC'],
  ['Meera', 'Krishnan', 'People', 'HR', 'HR Business Partner', 'HT'],
  ['Jonas', 'Brunner', 'People', 'HR', 'Recruiter', 'RC'],
] as const;

const MEETING_TITLES = ['Sprint planning', 'Design review', 'Customer call', 'Quarterly business review', '1:1', 'Architecture sync', 'Hiring debrief', 'Roadmap workshop', 'Incident retro', 'Vendor demo'];

/** Roles and permissions are global; create them once (idempotent). */
export async function ensureRolesAndPermissions(db: Db): Promise<Record<string, string>> {
  const permByCode = new Map<string, string>();
  for (const code of Permissions) {
    const p = await db.permission.upsert({ where: { code }, create: { code, description: code }, update: {} });
    permByCode.set(code, p.id);
  }
  const roles: Record<string, string> = {};
  for (const code of RoleCodes) {
    const role = await db.role.upsert({
      where: { code },
      create: { code, name: code.replace('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) },
      update: {},
    });
    roles[code] = role.id;
    const wanted = ROLE_PERMISSIONS[code].map((p) => permByCode.get(p)!);
    await db.rolePermission.createMany({ data: wanted.map((permissionId) => ({ roleId: role.id, permissionId })), skipDuplicates: true });
  }
  return roles;
}

export async function createDemoOrganization(db: Db, opts: DemoOptions): Promise<DemoResult> {
  let seedState = opts.seed ?? 42;
  const rand = () => {
    seedState = (seedState * 1103515245 + 12345) & 0x7fffffff;
    return seedState / 0x7fffffff;
  };
  const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
  const roles = await ensureRolesAndPermissions(db);

  const org = await db.organization.create({
    data: {
      name: opts.name,
      slug: opts.slug,
      timezone: 'Asia/Kolkata',
      settings: { allowTeamLocationSharing: true, defaultView: '3D', workingDays: [1, 2, 3, 4, 5], ...(opts.guest ? { guest: true, expiresAt: new Date(Date.now() + 24 * 3600000).toISOString() } : {}) },
    },
  });

  const amenityIds = new Map<string, string>();
  for (const [code, name, category, icon] of AMENITIES) {
    const a = await db.amenity.create({ data: { orgId: org.id, code, name, category, icon } });
    amenityIds.set(code, a.id);
  }

  const deptIds = new Map<string, string>();
  const teamIds = new Map<string, string>();
  for (const [, , dept, team] of PEOPLE) {
    if (!deptIds.has(dept)) deptIds.set(dept, (await db.department.create({ data: { orgId: org.id, name: dept } })).id);
    const key = `${dept}/${team}`;
    if (!teamIds.has(key)) teamIds.set(key, (await db.team.create({ data: { departmentId: deptIds.get(dept)!, name: team } })).id);
  }

  const buildingIds = new Map<string, string>();
  const seatsByBuilding = new Map<string, { id: string; floorId: string; floorNumber: number }[]>();
  const roomsByBuilding = new Map<string, { id: string; floorId: string; requiresApproval: boolean }[]>();
  let floorCount = 0;
  let totalDesks = 0;
  let totalRooms = 0;

  for (const spec of DEMO_BUILDINGS) {
    const building = await db.building.create({
      data: { orgId: org.id, name: spec.name, code: spec.code, city: spec.city, country: spec.country, timezone: spec.timezone, addressLine: spec.addressLine, description: spec.description, isActive: true },
    });
    buildingIds.set(spec.code, building.id);
    seatsByBuilding.set(spec.code, []);
    roomsByBuilding.set(spec.code, []);

    for (const [fi, fs] of spec.floors.entries()) {
      const floor = await db.floor.create({ data: { buildingId: building.id, name: fs.name, number: fs.number, sortOrder: fi, isPublished: true } });
      floorCount++;
      const plan = await db.floorPlan.create({ data: { floorId: floor.id, widthM: spec.widthM, depthM: spec.depthM, status: 'PUBLISHED', publishedAt: new Date(), version: 1 } });
      const zones = [] as { id: string; name: string; kind: string; color: string }[];
      for (const z of fs.zones) zones.push({ ...(await db.zone.create({ data: { floorId: floor.id, name: z.name, kind: z.kind, color: z.color } })), color: z.color });

      const objects: Prisma.MapObjectCreateManyInput[] = [];
      const add = (kind: MapObjectKind, label: string | null, x: number, y: number, width: number, depth: number, extra: Partial<Prisma.MapObjectCreateManyInput> = {}) =>
        objects.push({ floorPlanId: plan.id, kind, label, x, y, width, depth, rotation: 0, ...extra });

      add('ELEVATOR', 'Elevators', 1, 1, 3, 3);
      add('STAIRS', 'Stairs', 1, 4.5, 3, 3);
      add('RESTROOM', 'Restrooms', 1, 8, 3, 4);
      add('PRINTER', 'Print station', 1, 12.5, 2, 1);
      add('EMERGENCY_EXIT', 'Emergency exit', 0.2, spec.depthM - 2.2, 1.2, 2);
      add('EMERGENCY_EXIT', 'Emergency exit', spec.widthM - 1.4, spec.depthM - 2.2, 1.2, 2);
      add('ACCESSIBLE_ROUTE', 'Accessible route', 4.5, 1, 1.5, spec.depthM - 2, { meta: { dashed: true } });
      if (fs.kind === 'lobby') add('RECEPTION', 'Reception', 7, 1, 8, 3);
      // Right-hand column (x = widthM-11.5 .. widthM-1.5): cafeteria on top floors, then meeting
      // rooms stacked without overlap. Bottom band: collaboration lounge and manager office.
      const colX = spec.widthM - 11.5;
      const colW = 10;
      if (fs.kind === 'top') add('CAFETERIA', 'Cafeteria', colX, 1, colW, 6);
      add('COLLAB_SPACE', 'Collaboration lounge', 7, spec.depthM - 6, 9, 5);
      if (fs.kind !== 'lobby') add('PRIVATE_OFFICE', 'Manager office', 17, spec.depthM - 6, 6, 5);

      const roomStartY = fs.kind === 'top' ? 8 : 1;
      const roomGap = 0.8;
      // Room depth follows its floor area (bigger rooms are deeper), scaled down if needed so the
      // whole column fits above the bottom-right emergency exit.
      const areaFor = (cap: number) => (cap >= 14 ? 63 : cap >= 8 ? 38.5 : 20);
      const rawDepths = fs.rooms.map((r) => Math.max(2.5, areaFor(r.capacity) / colW));
      const available = spec.depthM - 2.5 - roomStartY - roomGap * Math.max(0, fs.rooms.length - 1);
      const sumDepth = rawDepths.reduce((a, b) => a + b, 0);
      const depthScale = sumDepth > available ? available / sumDepth : 1;
      let ry = roomStartY;
      const roomRows: Prisma.ResourceCreateManyInput[] = [];
      const roomAmenityRows: { resourceId: string; amenityId: string }[] = [];
      for (const [ri, r] of fs.rooms.entries()) {
        const depth = Math.round(rawDepths[ri] * depthScale * 10) / 10;
        const width = colW;
        const code = `${spec.code}${fs.number}-${r.name.slice(0, 3).toUpperCase()}`;
        const id = randomUUID();
        const roomAmenities = ['display', 'hdmi', ...(r.capacity >= 6 ? ['video-conferencing', 'whiteboard'] : []), ...(r.capacity >= 10 ? ['projector', 'conference-phone', 'speakers', 'microphones'] : []), ...(r.accessible ? ['accessible-entrance'] : []), ...(r.type === 'TRAINING' ? ['flexible-seating'] : [])];
        roomRows.push({
          id, orgId: org.id, buildingId: building.id, floorId: floor.id, type: 'MEETING_ROOM', code, name: r.name, capacity: r.capacity, roomType: r.type, accessible: !!r.accessible,
          requiresApproval: !!r.approval, status: 'ACTIVE', isBookable: true, maxDurationMinutes: r.type === 'BOARDROOM' ? 240 : null, checkInRequired: true,
          description: `${r.type === 'HUDDLE' ? 'Compact huddle room' : r.type === 'BOARDROOM' ? 'Executive boardroom' : r.type === 'TRAINING' ? 'Training room with flexible seating' : 'Meeting room'} seating ${r.capacity} on ${fs.name}.`,
          searchText: `${code} ${r.name} ${fs.name} ${spec.name} ${r.type.toLowerCase()}`.toLowerCase(),
        });
        for (const c of roomAmenities) roomAmenityRows.push({ resourceId: id, amenityId: amenityIds.get(c)! });
        add('MEETING_ROOM', r.name, colX, ry, width, depth, { resourceId: id, height: 3 });
        roomsByBuilding.get(spec.code)!.push({ id, floorId: floor.id, requiresApproval: !!r.approval });
        ry += depth + roomGap;
        totalRooms++;
      }

      const podW = 3.6;
      const podD = 3.2;
      const gridX0 = 7;
      const gridY0 = fs.kind === 'lobby' ? 5 : 1.5;
      const gridXMax = spec.widthM - 12;
      const gridYMax = spec.depthM - 7;
      const cols = Math.floor((gridXMax - gridX0) / (podW + 1.2));
      let deskIndex = 1;
      const seatRows: Prisma.ResourceCreateManyInput[] = [];
      const seatAmenityRows: { resourceId: string; amenityId: string }[] = [];
      for (let p = 0; p < fs.pods; p++) {
        const col = p % cols;
        const row = Math.floor(p / cols);
        const px = gridX0 + col * (podW + 1.2);
        const py = gridY0 + row * (podD + 1.4);
        if (py + podD > gridYMax) break;
        const zone = zones[Math.min(zones.length - 1, Math.floor((p / fs.pods) * zones.length))];
        for (let d = 0; d < 4; d++) {
          const dx = px + (d % 2) * 1.8;
          const dy = py + Math.floor(d / 2) * 2.0;
          const code = `${spec.code}${fs.number}-${String(deskIndex).padStart(3, '0')}`;
          const nearWindow = row === 0 || px + podW > gridXMax - 5;
          const nearElevator = px < 12 && py < 10;
          const attrs = { nearWindow, nearElevator, monitor: rand() > 0.2, dualMonitor: rand() > 0.7, dockingStation: rand() > 0.3, heightAdjustable: rand() > 0.6, accessible: d === 0 && p % 3 === 0, quietZone: zone.kind === 'QUIET' };
          const seatAmenities = [...(attrs.monitor ? ['monitor'] : []), ...(attrs.dualMonitor ? ['dual-monitor'] : []), ...(attrs.dockingStation ? ['docking-station'] : []), ...(attrs.heightAdjustable ? ['standing-desk'] : []), ...(rand() > 0.5 ? ['locker'] : [])];
          const seatType = attrs.heightAdjustable && rand() > 0.5 ? 'STANDING' : p % 5 === 4 ? 'HOT_DESK' : 'WORKSTATION';
          const id = randomUUID();
          seatRows.push({
            id, orgId: org.id, buildingId: building.id, floorId: floor.id, zoneId: zone.id, type: 'SEAT', code, name: `Desk ${code}`, seatType, accessible: attrs.accessible,
            status: p === fs.pods - 1 && d === 3 ? 'MAINTENANCE' : 'ACTIVE', isBookable: true, seatAttributes: attrs, checkInRequired: true,
            restrictedTeamIds: zone.name === 'Quiet Library' && d === 0 ? [teamIds.get('Design/Product Design')!] : [],
            searchText: `${code} desk ${zone.name} ${fs.name} ${spec.name}`.toLowerCase(),
          });
          for (const c of seatAmenities) seatAmenityRows.push({ resourceId: id, amenityId: amenityIds.get(c)! });
          add('DESK', code, dx, dy, 1.6, 0.8, { resourceId: id, rotation: Math.floor(d / 2) === 1 ? 180 : 0 });
          seatsByBuilding.get(spec.code)!.push({ id, floorId: floor.id, floorNumber: fs.number });
          deskIndex++;
          totalDesks++;
        }
        if (p % Math.ceil(fs.pods / zones.length) === 0) add('ZONE', zone.name, px - 0.5, py - 0.5, Math.min(podW + 1.2, gridXMax - px) * Math.min(cols, Math.ceil(fs.pods / zones.length)) - 0.2, podD + 1, { meta: { color: zone.color } });
      }
      await db.resource.createMany({ data: [...roomRows, ...seatRows] });
      await db.resourceAmenity.createMany({ data: [...roomAmenityRows, ...seatAmenityRows], skipDuplicates: true });
      await db.mapObject.createMany({ data: objects });
    }
  }

  // Policies
  await db.bookingPolicy.createMany({
    data: [
      { orgId: org.id, name: 'Organisation default', advanceBookingDays: 30, maxDurationMinutes: 600, maxDailyBookings: 3, maxWeeklyBookings: 15, operatingStart: '07:00', operatingEnd: '20:00', checkInGraceMinutes: 30, checkInOpensMinutesBefore: 15, autoReleaseEnabled: true },
      { orgId: org.id, name: 'Meeting rooms', resourceType: 'MEETING_ROOM', advanceBookingDays: 60, minDurationMinutes: 15, maxDurationMinutes: 240, slotMinutes: 15, maxDailyBookings: 6, maxWeeklyBookings: 25, operatingStart: '07:30', operatingEnd: '19:30', checkInGraceMinutes: 15, autoReleaseEnabled: true, cancellationDeadlineMinutes: 0 },
      { orgId: org.id, name: 'Riverside desks', buildingId: buildingIds.get('RC')!, resourceType: 'SEAT', advanceBookingDays: 21, maxDurationMinutes: 600, operatingStart: '07:00', operatingEnd: '19:00', allowWeekends: false, checkInGraceMinutes: 45 },
    ],
  });

  // Users
  const mkUser = (email: string, firstName: string, lastName: string, roleCodes: string[], extra: Partial<Prisma.UserUncheckedCreateInput> = {}, hash = opts.userPasswordHash) =>
    db.user.create({ data: { orgId: org.id, email, firstName, lastName, passwordHash: hash, status: 'ACTIVE', preferences: { create: { shareLocationWithTeam: true } }, roles: { create: roleCodes.map((c) => ({ roleId: roles[c] })) }, ...extra } });
  const dom = opts.emailDomain;
  const employees: { id: string; building: string }[] = [];
  const admin = await mkUser(opts.adminEmail, 'Alex', 'Morgan', ['ORG_ADMIN'], { jobTitle: 'Workplace Platform Owner', homeBuildingId: buildingIds.get('HT'), departmentId: deptIds.get('Operations'), teamId: teamIds.get('Operations/Facilities') }, opts.adminPasswordHash);
  const wpAdmin = await mkUser(`facilities@${dom}`, 'Divya', 'Nair', ['WORKPLACE_ADMIN'], { jobTitle: 'Facilities Coordinator', homeBuildingId: buildingIds.get('HT'), departmentId: deptIds.get('Operations'), teamId: teamIds.get('Operations/Facilities') });
  const approver = await mkUser(`approver@${dom}`, 'Rahul', 'Verma', ['APPROVER'], { jobTitle: 'Engineering Manager', homeBuildingId: buildingIds.get('HT'), departmentId: deptIds.get('Engineering'), teamId: teamIds.get('Engineering/Mobile') });
  for (const [first, last, dept, team, title, bcode] of PEOPLE) {
    if (first === 'Divya' || first === 'Rahul') continue;
    const u = await mkUser(`${first.toLowerCase()}.${last.toLowerCase()}@${dom}`, first, last, ['EMPLOYEE'], { jobTitle: title, homeBuildingId: buildingIds.get(bcode), departmentId: deptIds.get(dept), teamId: teamIds.get(`${dept}/${team}`) });
    employees.push({ id: u.id, building: bcode });
  }
  const demoEmployee = opts.guest
    ? await mkUser(opts.guest.email, opts.guest.firstName, opts.guest.lastName, ['ORG_ADMIN'], { jobTitle: 'Guest explorer', homeBuildingId: buildingIds.get('HT'), departmentId: deptIds.get('Engineering'), teamId: teamIds.get('Engineering/Platform'), passwordHash: null })
    : await mkUser(`employee@${dom}`, 'Sam', 'Taylor', ['EMPLOYEE'], { jobTitle: 'Software Engineer', homeBuildingId: buildingIds.get('HT'), departmentId: deptIds.get('Engineering'), teamId: teamIds.get('Engineering/Platform') });
  employees.push({ id: demoEmployee.id, building: 'HT' }, { id: approver.id, building: 'HT' }, { id: wpAdmin.id, building: 'HT' });
  await db.user.create({ data: { orgId: org.id, email: `invited@${dom}`, firstName: 'Jordan', lastName: 'Lee', status: 'INVITED', jobTitle: 'New Joiner', homeBuildingId: buildingIds.get('RC'), roles: { create: [{ roleId: roles.EMPLOYEE }] }, preferences: { create: {} } } });

  // Reservations (batched)
  const now = new Date();
  const used = new Set<string>();
  const resRows: Prisma.ReservationCreateManyInput[] = [];
  const checkInRows: Prisma.CheckInRecordCreateManyInput[] = [];
  const approvalRows: Prisma.ApprovalRequestCreateManyInput[] = [];
  const makeRes = (o: { userId: string; resource: { id: string }; type: 'SEAT' | 'MEETING_ROOM'; date: string; start: string; end: string; tz: string; status: ReservationStatus; title?: string; checkIn?: boolean; cancelReason?: string; createdDaysAgo?: number }) => {
    const key = `${o.resource.id}|${o.date}|${o.start}`;
    if (used.has(key)) return;
    used.add(key);
    const startAt = fromLocal(o.date, o.start, o.tz);
    const endAt = fromLocal(o.date, o.end, o.tz);
    const id = randomUUID();
    resRows.push({
      id, orgId: org.id, resourceId: o.resource.id, userId: o.userId, createdById: o.userId, type: o.type, status: o.status, title: o.title ?? null, startAt, endAt, timezone: o.tz, checkInCode: shortCode(),
      checkedInAt: o.checkIn ? new Date(startAt.getTime() + 5 * 60000) : null,
      checkedOutAt: o.checkIn && o.status === 'COMPLETED' ? endAt : null,
      cancelledAt: o.status === 'CANCELLED' ? new Date(startAt.getTime() - 3600000 * 20) : null,
      cancelReason: o.cancelReason ?? null,
      createdAt: new Date(startAt.getTime() - (o.createdDaysAgo ?? 2) * 86400000),
      reminderSentAt: startAt < now ? startAt : null,
      checkInReminderSentAt: startAt < now ? startAt : null,
    });
    if (o.checkIn) checkInRows.push({ reservationId: id, userId: o.userId, method: pick(['QR', 'MANUAL']), kind: 'IN', at: new Date(startAt.getTime() + 5 * 60000) });
    if (o.status === 'PENDING_APPROVAL') approvalRows.push({ reservationId: id, requestedById: o.userId });
  };

  for (const spec of DEMO_BUILDINGS) {
    const tz = spec.timezone;
    const seats = seatsByBuilding.get(spec.code)!.filter((s) => s.floorNumber !== 0);
    const rooms = roomsByBuilding.get(spec.code)!;
    const people = employees.filter((e) => e.building === spec.code);
    const todayLocal = dayjs(now).tz(tz).format('YYYY-MM-DD');
    const nowLocalMinutes = dayjs(now).tz(tz).hour() * 60 + dayjs(now).tz(tz).minute();

    for (let d = 14; d >= 1; d--) {
      const date = dayjs(todayLocal, 'YYYY-MM-DD').subtract(d, 'day');
      if (date.day() === 0 || date.day() === 6) continue;
      const ds = date.format('YYYY-MM-DD');
      for (const p of people) {
        const r = rand();
        if (r < 0.25) continue;
        const status: ReservationStatus = r < 0.33 ? 'CANCELLED' : r < 0.45 ? 'NO_SHOW' : 'COMPLETED';
        makeRes({ userId: p.id, resource: pick(seats), type: 'SEAT', date: ds, start: '09:00', end: '17:30', tz, status, checkIn: status === 'COMPLETED', cancelReason: status === 'CANCELLED' ? pick(['Working from home', 'Sick day', 'Travel']) : undefined, createdDaysAgo: 3 });
      }
      for (let m = 0; m < 3; m++) {
        const startH = 9 + Math.floor(rand() * 7);
        makeRes({ userId: pick(people).id, resource: pick(rooms.filter((x) => !x.requiresApproval)), type: 'MEETING_ROOM', date: ds, start: `${String(startH).padStart(2, '0')}:00`, end: `${String(startH + 1).padStart(2, '0')}:00`, tz, status: rand() < 0.85 ? 'COMPLETED' : 'CANCELLED', checkIn: true, title: pick(MEETING_TITLES) });
      }
    }
    const todayIsWeekend = dayjs(todayLocal, 'YYYY-MM-DD').day() % 6 === 0;
    for (const [i, p] of people.entries()) {
      if (i % 4 === 3) continue;
      const started = nowLocalMinutes > 9 * 60 + 15;
      const status: ReservationStatus = todayIsWeekend ? 'CONFIRMED' : started ? (i % 3 === 0 ? 'CONFIRMED' : 'CHECKED_IN') : 'CONFIRMED';
      makeRes({ userId: p.id, resource: pick(seats), type: 'SEAT', date: todayLocal, start: '09:00', end: '18:00', tz, status, checkIn: status === 'CHECKED_IN' });
    }
    for (let m = 0; m < 4; m++) {
      const startH = 10 + m * 2;
      const startMin = startH * 60;
      const status: ReservationStatus = startMin + 60 <= nowLocalMinutes ? 'COMPLETED' : startMin <= nowLocalMinutes ? 'CHECKED_IN' : 'CONFIRMED';
      makeRes({ userId: pick(people).id, resource: pick(rooms.filter((x) => !x.requiresApproval)), type: 'MEETING_ROOM', date: todayLocal, start: `${String(startH).padStart(2, '0')}:00`, end: `${String(startH + 1).padStart(2, '0')}:00`, tz, status, checkIn: status !== 'CONFIRMED', title: pick(MEETING_TITLES) });
    }
    for (let d = 1; d <= 7; d++) {
      const date = dayjs(todayLocal, 'YYYY-MM-DD').add(d, 'day');
      if (date.day() === 0 || date.day() === 6) continue;
      const ds = date.format('YYYY-MM-DD');
      for (const [i, p] of people.entries()) {
        if ((i + d) % 3 === 0) continue;
        makeRes({ userId: p.id, resource: pick(seats), type: 'SEAT', date: ds, start: '09:00', end: '17:30', tz, status: 'CONFIRMED', createdDaysAgo: 1 });
      }
      for (let m = 0; m < 2; m++) {
        const startH = 9 + Math.floor(rand() * 8);
        makeRes({ userId: pick(people).id, resource: pick(rooms.filter((x) => !x.requiresApproval)), type: 'MEETING_ROOM', date: ds, start: `${String(startH).padStart(2, '0')}:30`, end: `${String(startH + 1).padStart(2, '0')}:30`, tz, status: 'CONFIRMED', title: pick(MEETING_TITLES) });
      }
    }
    const approvalRoom = rooms.find((x) => x.requiresApproval);
    if (approvalRoom) {
      const date = dayjs(todayLocal, 'YYYY-MM-DD').add(2, 'day').format('YYYY-MM-DD');
      makeRes({ userId: demoEmployee.id, resource: approvalRoom, type: 'MEETING_ROOM', date, start: '14:00', end: '16:00', tz, status: 'PENDING_APPROVAL', title: 'Executive roadmap review' });
      // A second request by a colleague so approvers (and guests) always have something to decide.
      const date2 = dayjs(todayLocal, 'YYYY-MM-DD').add(3, 'day').format('YYYY-MM-DD');
      makeRes({ userId: employees[0].id, resource: approvalRoom, type: 'MEETING_ROOM', date: date2, start: '10:00', end: '12:00', tz, status: 'PENDING_APPROVAL', title: 'Board prep session' });
    }
  }
  await db.reservation.createMany({ data: resRows });
  if (checkInRows.length) await db.checkInRecord.createMany({ data: checkInRows });
  if (approvalRows.length) await db.approvalRequest.createMany({ data: approvalRows });

  const htSeats = seatsByBuilding.get('HT')!;
  await db.favorite.createMany({ data: [htSeats[20], htSeats[21], htSeats[60]].map((s) => ({ userId: demoEmployee.id, resourceId: s.id })) });
  await db.favorite.create({ data: { userId: demoEmployee.id, resourceId: roomsByBuilding.get('HT')![2].id } });
  await db.notification.createMany({
    data: [
      { userId: demoEmployee.id, type: 'ANNOUNCEMENT', title: 'Welcome to SpaceFlow', body: 'Book a desk in seconds, explore the office in 3D and check in with your QR code.', data: {} },
      { userId: demoEmployee.id, type: 'APPROVAL_REQUESTED', title: 'Boardroom booking awaiting approval', body: 'Your request for Titan is waiting for an approver.', data: {} },
    ],
  });
  await db.announcement.createMany({
    data: [
      { orgId: org.id, title: 'Rooftop cafeteria reopens Monday', body: 'Level 3 cafeteria at Harbor Tower reopens with a new menu. Breakfast from 08:00.', buildingId: buildingIds.get('HT') },
      { orgId: org.id, title: 'Quarterly fire drill', body: 'A fire drill will take place next Wednesday at 11:00 in both buildings. Please follow the marked emergency exits.' },
    ],
  });
  await db.integrationConfig.create({ data: { orgId: org.id, provider: 'QR_CHECKIN', isEnabled: true, status: 'READY', config: { allowKioskCheckIn: true } } });
  await db.maintenanceWindow.create({ data: { resourceId: roomsByBuilding.get('RC')![0].id, startAt: dayjs(now).add(3, 'day').hour(8).minute(0).toDate(), endAt: dayjs(now).add(3, 'day').hour(12).minute(0).toDate(), reason: 'AV equipment upgrade' } });

  return {
    orgId: org.id,
    adminUserId: admin.id,
    employeeUserId: demoEmployee.id,
    stats: { buildings: DEMO_BUILDINGS.length, floors: floorCount, desks: totalDesks, rooms: totalRooms, users: employees.length + 2, reservations: resRows.length },
  };
}

/** Remove a whole organisation and everything it owns (used to purge expired guest sandboxes). */
export async function deleteOrganization(db: PrismaClient, orgId: string) {
  const userIds = (await db.user.findMany({ where: { orgId }, select: { id: true } })).map((u) => u.id);
  const seriesIds = (await db.reservation.findMany({ where: { orgId, seriesId: { not: null } }, select: { seriesId: true }, distinct: ['seriesId'] })).map((r) => r.seriesId!);
  await db.$transaction(async (tx) => {
    await tx.reservation.deleteMany({ where: { orgId } });
    if (seriesIds.length) await tx.reservationSeries.deleteMany({ where: { id: { in: seriesIds } } });
    await tx.notification.deleteMany({ where: { userId: { in: userIds } } });
    await tx.favorite.deleteMany({ where: { userId: { in: userIds } } });
    await tx.auditLog.deleteMany({ where: { orgId } });
    await tx.announcement.deleteMany({ where: { orgId } });
    await tx.integrationConfig.deleteMany({ where: { orgId } });
    await tx.bookingPolicy.deleteMany({ where: { orgId } });
    await tx.resource.deleteMany({ where: { orgId } });
    await tx.building.deleteMany({ where: { orgId } });
    await tx.asset.deleteMany({ where: { orgId } });
    await tx.amenity.deleteMany({ where: { orgId } });
    await tx.user.deleteMany({ where: { orgId } });
    await tx.department.deleteMany({ where: { orgId } });
    await tx.organization.delete({ where: { id: orgId } });
  }, { timeout: 60000 });
}
