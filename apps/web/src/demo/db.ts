// In-browser data store for demo mode (no backend). Tables mirror the Prisma models the API uses,
// with instants stored as ISO strings so the whole store can be persisted to localStorage.
// The generator is a port of apps/api/src/lib/demoData.ts: same buildings, people and bookings.
import type {
  AmenityDto,
  ApprovalStatus,
  AssetKind,
  IntegrationProvider,
  MapObjectKind,
  NotificationType,
  OperatingHours,
  ReservationStatus,
  ResourceStatus,
  ResourceType,
  RoleCode,
  RoomType,
  SeatAttributes,
  SeatType,
  UserPreferencesDto,
  UserStatus,
  ZoneKind,
} from '@spaceflow/shared';
import { dayjs } from '@/utils/time';

export interface DbBuilding {
  id: string;
  name: string;
  code: string;
  addressLine: string | null;
  city: string | null;
  country: string | null;
  timezone: string;
  isActive: boolean;
  description: string | null;
  modelAssetId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface DbFloor {
  id: string;
  buildingId: string;
  name: string;
  number: number;
  sortOrder: number;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface DbFloorPlan {
  id: string;
  floorId: string;
  widthM: number;
  depthM: number;
  status: 'DRAFT' | 'PUBLISHED';
  version: number;
  imageAssetId: string | null;
  modelAssetId: string | null;
  publishedAt: string | null;
}

export interface DbZone {
  id: string;
  floorId: string;
  name: string;
  kind: ZoneKind;
  color: string | null;
}

export interface DbMapObject {
  id: string;
  floorPlanId: string;
  kind: MapObjectKind;
  label: string | null;
  x: number;
  y: number;
  width: number;
  depth: number;
  rotation: number;
  height: number | null;
  resourceId: string | null;
  meta: Record<string, unknown> | null;
}

export interface DbResource {
  id: string;
  buildingId: string;
  floorId: string;
  zoneId: string | null;
  type: ResourceType;
  code: string;
  name: string;
  description: string | null;
  status: ResourceStatus;
  isBookable: boolean;
  requiresApproval: boolean;
  capacity: number | null;
  seatType: SeatType | null;
  roomType: RoomType | null;
  seatAttributes: SeatAttributes | null;
  accessible: boolean;
  amenityIds: string[];
  operatingHours: OperatingHours | null;
  maxDurationMinutes: number | null;
  checkInRequired: boolean | null;
  restrictedDepartmentIds: string[];
  restrictedTeamIds: string[];
  searchText: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface DbPolicy {
  id: string;
  name: string;
  buildingId: string | null;
  resourceType: ResourceType | null;
  advanceBookingDays: number;
  minDurationMinutes: number;
  maxDurationMinutes: number;
  slotMinutes: number;
  maxActiveReservations: number;
  maxDailyBookings: number;
  maxWeeklyBookings: number;
  operatingStart: string;
  operatingEnd: string;
  allowWeekends: boolean;
  cancellationDeadlineMinutes: number;
  checkInRequired: boolean;
  checkInGraceMinutes: number;
  checkInOpensMinutesBefore: number;
  autoReleaseEnabled: boolean;
  allowRecurring: boolean;
  maxRecurringOccurrences: number;
  allowMultiDay: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DbUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  phone: string | null;
  departmentId: string | null;
  teamId: string | null;
  homeBuildingId: string | null;
  status: UserStatus;
  roles: RoleCode[];
  preferences: UserPreferencesDto;
  lastLoginAt: string | null;
  createdAt: string;
  deletedAt: string | null;
}

export interface DbReservation {
  id: string;
  resourceId: string;
  userId: string;
  createdById: string;
  type: ResourceType;
  status: ReservationStatus;
  title: string | null;
  description: string | null;
  setupNotes: string | null;
  startAt: string;
  endAt: string;
  timezone: string;
  isAllDay: boolean;
  seriesId: string | null;
  checkInCode: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  cancelledAt: string | null;
  cancelledById: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  attendees: { id: string; userId: string | null; email: string | null; name: string | null }[];
  approval: {
    id: string;
    status: ApprovalStatus;
    requestedById: string;
    approverId: string | null;
    decisionNote: string | null;
    decidedAt: string | null;
  } | null;
}

export interface DbCheckIn {
  id: string;
  reservationId: string;
  userId: string;
  method: 'QR' | 'MANUAL' | 'ADMIN';
  kind: 'IN' | 'OUT';
  at: string;
}

export interface DbFavorite {
  id: string;
  userId: string;
  resourceId: string;
  createdAt: string;
}

export interface DbNotification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface DbAnnouncement {
  id: string;
  title: string;
  body: string;
  buildingId: string | null;
  publishedAt: string;
  expiresAt: string | null;
}

export interface DbMaintenance {
  id: string;
  resourceId: string;
  startAt: string;
  endAt: string;
  reason: string | null;
}

export interface DbAudit {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
}

export interface DbIntegration {
  provider: IntegrationProvider;
  isEnabled: boolean;
  status: 'NOT_CONFIGURED' | 'READY' | 'ERROR' | 'DISABLED';
  config: Record<string, unknown>;
  lastError: string | null;
  lastSyncedAt: string | null;
}

export interface DbAsset {
  id: string;
  kind: AssetKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface DemoDb {
  version: number;
  org: { id: string; name: string; slug: string; timezone: string; settings: Record<string, unknown> };
  guestUserId: string;
  expiresAt: string;
  amenities: AmenityDto[];
  departments: { id: string; name: string }[];
  teams: { id: string; departmentId: string; name: string }[];
  buildings: DbBuilding[];
  floors: DbFloor[];
  floorPlans: DbFloorPlan[];
  zones: DbZone[];
  mapObjects: DbMapObject[];
  resources: DbResource[];
  policies: DbPolicy[];
  users: DbUser[];
  reservations: DbReservation[];
  checkIns: DbCheckIn[];
  favorites: DbFavorite[];
  notifications: DbNotification[];
  announcements: DbAnnouncement[];
  maintenance: DbMaintenance[];
  audit: DbAudit[];
  integrations: DbIntegration[];
  assets: DbAsset[];
}

export const DB_VERSION = 1;
export const SANDBOX_TTL_HOURS = 24;

export function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function shortCode(len = 6): string {
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

export function fromLocal(date: string, time: string, tz: string): Date {
  return dayjs.tz(`${date} ${time}`, 'YYYY-MM-DD HH:mm', tz).toDate();
}

export const DEFAULT_PREFERENCES: UserPreferencesDto = {
  defaultBuildingId: null,
  defaultFloorId: null,
  shareLocationWithTeam: true,
  emailNotifications: true,
  preferredView: '3D',
  reducedMotion: false,
};

// ---------------------------------------------------------------------------
// Generator (port of apps/api/src/lib/demoData.ts)
// ---------------------------------------------------------------------------

interface FloorSpec {
  name: string;
  number: number;
  kind: 'lobby' | 'office' | 'top';
  pods: number;
  rooms: { name: string; capacity: number; type: RoomType; approval?: boolean; accessible?: boolean }[];
  zones: { name: string; kind: ZoneKind; color: string }[];
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

const DEMO_BUILDINGS: BuildingSpec[] = [
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

function policyRow(p: Partial<DbPolicy> & { name: string }, nowIso: string): DbPolicy {
  return {
    id: uuid(),
    buildingId: null,
    resourceType: null,
    advanceBookingDays: 30,
    minDurationMinutes: 30,
    maxDurationMinutes: 600,
    slotMinutes: 30,
    maxActiveReservations: 10,
    maxDailyBookings: 3,
    maxWeeklyBookings: 15,
    operatingStart: '07:00',
    operatingEnd: '20:00',
    allowWeekends: false,
    cancellationDeadlineMinutes: 0,
    checkInRequired: true,
    checkInGraceMinutes: 30,
    checkInOpensMinutesBefore: 15,
    autoReleaseEnabled: true,
    allowRecurring: true,
    maxRecurringOccurrences: 12,
    allowMultiDay: true,
    isActive: true,
    createdAt: nowIso,
    updatedAt: nowIso,
    ...p,
  };
}

/** Build a fresh guest sandbox. Mirrors createDemoOrganization() with opts.guest set. */
export function createDemoDb(now = new Date(), seed = 42): DemoDb {
  let seedState = seed;
  const rand = () => {
    seedState = (seedState * 1103515245 + 12345) & 0x7fffffff;
    return seedState / 0x7fffffff;
  };
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
  const nowIso = now.toISOString();
  const guestId = uuid().slice(0, 8);
  const dom = `guest-${guestId}.guest.local`;
  const expiresAt = new Date(now.getTime() + SANDBOX_TTL_HOURS * 3600000).toISOString();

  const db: DemoDb = {
    version: DB_VERSION,
    org: { id: uuid(), name: 'SpaceFlow Demo', slug: `guest-${guestId}`, timezone: 'Asia/Kolkata', settings: { allowTeamLocationSharing: true, defaultView: '3D', workingDays: [1, 2, 3, 4, 5], guest: true, expiresAt } },
    guestUserId: '',
    expiresAt,
    amenities: [],
    departments: [],
    teams: [],
    buildings: [],
    floors: [],
    floorPlans: [],
    zones: [],
    mapObjects: [],
    resources: [],
    policies: [],
    users: [],
    reservations: [],
    checkIns: [],
    favorites: [],
    notifications: [],
    announcements: [],
    maintenance: [],
    audit: [],
    integrations: [],
    assets: [],
  };

  const amenityIds = new Map<string, string>();
  for (const [code, name, category, icon] of AMENITIES) {
    const id = uuid();
    db.amenities.push({ id, code, name, category, icon });
    amenityIds.set(code, id);
  }

  const deptIds = new Map<string, string>();
  const teamIds = new Map<string, string>();
  for (const [, , dept, team] of PEOPLE) {
    if (!deptIds.has(dept)) {
      const id = uuid();
      db.departments.push({ id, name: dept });
      deptIds.set(dept, id);
    }
    const key = `${dept}/${team}`;
    if (!teamIds.has(key)) {
      const id = uuid();
      db.teams.push({ id, departmentId: deptIds.get(dept)!, name: team });
      teamIds.set(key, id);
    }
  }

  const buildingIds = new Map<string, string>();
  const seatsByBuilding = new Map<string, { id: string; floorId: string; floorNumber: number }[]>();
  const roomsByBuilding = new Map<string, { id: string; floorId: string; requiresApproval: boolean }[]>();

  for (const spec of DEMO_BUILDINGS) {
    const buildingId = uuid();
    db.buildings.push({ id: buildingId, name: spec.name, code: spec.code, city: spec.city, country: spec.country, timezone: spec.timezone, addressLine: spec.addressLine, description: spec.description, isActive: true, modelAssetId: null, createdAt: nowIso, updatedAt: nowIso, deletedAt: null });
    buildingIds.set(spec.code, buildingId);
    seatsByBuilding.set(spec.code, []);
    roomsByBuilding.set(spec.code, []);

    for (const [fi, fs] of spec.floors.entries()) {
      const floorId = uuid();
      db.floors.push({ id: floorId, buildingId, name: fs.name, number: fs.number, sortOrder: fi, isPublished: true, createdAt: nowIso, updatedAt: nowIso, deletedAt: null });
      const planId = uuid();
      db.floorPlans.push({ id: planId, floorId, widthM: spec.widthM, depthM: spec.depthM, status: 'PUBLISHED', version: 1, imageAssetId: null, modelAssetId: null, publishedAt: nowIso });
      const zones = fs.zones.map((z) => {
        const row: DbZone = { id: uuid(), floorId, name: z.name, kind: z.kind, color: z.color };
        db.zones.push(row);
        return row;
      });

      const add = (kind: MapObjectKind, label: string | null, x: number, y: number, width: number, depth: number, extra: Partial<DbMapObject> = {}) =>
        db.mapObjects.push({ id: uuid(), floorPlanId: planId, kind, label, x, y, width, depth, rotation: 0, height: null, resourceId: null, meta: null, ...extra });

      add('ELEVATOR', 'Elevators', 1, 1, 3, 3);
      add('STAIRS', 'Stairs', 1, 4.5, 3, 3);
      add('RESTROOM', 'Restrooms', 1, 8, 3, 4);
      add('PRINTER', 'Print station', 1, 12.5, 2, 1);
      add('EMERGENCY_EXIT', 'Emergency exit', 0.2, spec.depthM - 2.2, 1.2, 2);
      add('EMERGENCY_EXIT', 'Emergency exit', spec.widthM - 1.4, spec.depthM - 2.2, 1.2, 2);
      add('ACCESSIBLE_ROUTE', 'Accessible route', 4.5, 1, 1.5, spec.depthM - 2, { meta: { dashed: true } });
      if (fs.kind === 'lobby') add('RECEPTION', 'Reception', 7, 1, 8, 3);
      const colX = spec.widthM - 11.5;
      const colW = 10;
      if (fs.kind === 'top') add('CAFETERIA', 'Cafeteria', colX, 1, colW, 6);
      add('COLLAB_SPACE', 'Collaboration lounge', 7, spec.depthM - 6, 9, 5);
      if (fs.kind !== 'lobby') add('PRIVATE_OFFICE', 'Manager office', 17, spec.depthM - 6, 6, 5);

      const roomStartY = fs.kind === 'top' ? 8 : 1;
      const roomGap = 0.8;
      const areaFor = (cap: number) => (cap >= 14 ? 63 : cap >= 8 ? 38.5 : 20);
      const rawDepths = fs.rooms.map((r) => Math.max(2.5, areaFor(r.capacity) / colW));
      const available = spec.depthM - 2.5 - roomStartY - roomGap * Math.max(0, fs.rooms.length - 1);
      const sumDepth = rawDepths.reduce((a, b) => a + b, 0);
      const depthScale = sumDepth > available ? available / sumDepth : 1;
      let ry = roomStartY;
      for (const [ri, r] of fs.rooms.entries()) {
        const depth = Math.round(rawDepths[ri] * depthScale * 10) / 10;
        const code = `${spec.code}${fs.number}-${r.name.slice(0, 3).toUpperCase()}`;
        const id = uuid();
        const roomAmenities = ['display', 'hdmi', ...(r.capacity >= 6 ? ['video-conferencing', 'whiteboard'] : []), ...(r.capacity >= 10 ? ['projector', 'conference-phone', 'speakers', 'microphones'] : []), ...(r.accessible ? ['accessible-entrance'] : []), ...(r.type === 'TRAINING' ? ['flexible-seating'] : [])];
        db.resources.push({
          id, buildingId, floorId, zoneId: null, type: 'MEETING_ROOM', code, name: r.name, capacity: r.capacity, roomType: r.type, seatType: null, seatAttributes: null, accessible: !!r.accessible,
          requiresApproval: !!r.approval, status: 'ACTIVE', isBookable: true, maxDurationMinutes: r.type === 'BOARDROOM' ? 240 : null, checkInRequired: true,
          description: `${r.type === 'HUDDLE' ? 'Compact huddle room' : r.type === 'BOARDROOM' ? 'Executive boardroom' : r.type === 'TRAINING' ? 'Training room with flexible seating' : 'Meeting room'} seating ${r.capacity} on ${fs.name}.`,
          amenityIds: roomAmenities.map((c) => amenityIds.get(c)!), operatingHours: null, restrictedDepartmentIds: [], restrictedTeamIds: [],
          searchText: `${code} ${r.name} ${fs.name} ${spec.name} ${r.type.toLowerCase()}`.toLowerCase(),
          createdAt: nowIso, updatedAt: nowIso, deletedAt: null,
        });
        add('MEETING_ROOM', r.name, colX, ry, colW, depth, { resourceId: id, height: 3 });
        roomsByBuilding.get(spec.code)!.push({ id, floorId, requiresApproval: !!r.approval });
        ry += depth + roomGap;
      }

      const podW = 3.6;
      const podD = 3.2;
      const gridX0 = 7;
      const gridY0 = fs.kind === 'lobby' ? 5 : 1.5;
      const gridXMax = spec.widthM - 12;
      const gridYMax = spec.depthM - 7;
      const cols = Math.floor((gridXMax - gridX0) / (podW + 1.2));
      let deskIndex = 1;
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
          const seatType: SeatType = attrs.heightAdjustable && rand() > 0.5 ? 'STANDING' : p % 5 === 4 ? 'HOT_DESK' : 'WORKSTATION';
          const id = uuid();
          db.resources.push({
            id, buildingId, floorId, zoneId: zone.id, type: 'SEAT', code, name: `Desk ${code}`, seatType, roomType: null, capacity: null, accessible: attrs.accessible, description: null,
            status: p === fs.pods - 1 && d === 3 ? 'MAINTENANCE' : 'ACTIVE', isBookable: true, requiresApproval: false, seatAttributes: attrs, checkInRequired: true, maxDurationMinutes: null, operatingHours: null,
            amenityIds: seatAmenities.map((c) => amenityIds.get(c)!), restrictedDepartmentIds: [],
            restrictedTeamIds: zone.name === 'Quiet Library' && d === 0 ? [teamIds.get('Design/Product Design')!] : [],
            searchText: `${code} desk ${zone.name} ${fs.name} ${spec.name}`.toLowerCase(),
            createdAt: nowIso, updatedAt: nowIso, deletedAt: null,
          });
          add('DESK', code, dx, dy, 1.6, 0.8, { resourceId: id, rotation: Math.floor(d / 2) === 1 ? 180 : 0 });
          seatsByBuilding.get(spec.code)!.push({ id, floorId, floorNumber: fs.number });
          deskIndex++;
        }
        if (p % Math.ceil(fs.pods / zones.length) === 0) add('ZONE', zone.name, px - 0.5, py - 0.5, Math.min(podW + 1.2, gridXMax - px) * Math.min(cols, Math.ceil(fs.pods / zones.length)) - 0.2, podD + 1, { meta: { color: zone.color } });
      }
    }
  }

  db.policies.push(
    policyRow({ name: 'Organisation default', advanceBookingDays: 30, maxDurationMinutes: 600, maxDailyBookings: 3, maxWeeklyBookings: 15, operatingStart: '07:00', operatingEnd: '20:00', checkInGraceMinutes: 30, checkInOpensMinutesBefore: 15, autoReleaseEnabled: true }, nowIso),
    policyRow({ name: 'Meeting rooms', resourceType: 'MEETING_ROOM', advanceBookingDays: 60, minDurationMinutes: 15, maxDurationMinutes: 240, slotMinutes: 15, maxDailyBookings: 6, maxWeeklyBookings: 25, operatingStart: '07:30', operatingEnd: '19:30', checkInGraceMinutes: 15, autoReleaseEnabled: true, cancellationDeadlineMinutes: 0 }, nowIso),
    policyRow({ name: 'Riverside desks', buildingId: buildingIds.get('RC')!, resourceType: 'SEAT', advanceBookingDays: 21, maxDurationMinutes: 600, operatingStart: '07:00', operatingEnd: '19:00', allowWeekends: false, checkInGraceMinutes: 45 }, nowIso),
  );

  const mkUser = (email: string, firstName: string, lastName: string, roles: RoleCode[], extra: Partial<DbUser> = {}): DbUser => {
    const u: DbUser = { id: uuid(), email, firstName, lastName, avatarUrl: null, jobTitle: null, phone: null, departmentId: null, teamId: null, homeBuildingId: null, status: 'ACTIVE', roles, preferences: { ...DEFAULT_PREFERENCES }, lastLoginAt: null, createdAt: nowIso, deletedAt: null, ...extra };
    db.users.push(u);
    return u;
  };
  const employees: { id: string; building: string }[] = [];
  mkUser(`admin@${dom}`, 'Alex', 'Morgan', ['ORG_ADMIN'], { jobTitle: 'Workplace Platform Owner', homeBuildingId: buildingIds.get('HT'), departmentId: deptIds.get('Operations'), teamId: teamIds.get('Operations/Facilities') });
  const wpAdmin = mkUser(`facilities@${dom}`, 'Divya', 'Nair', ['WORKPLACE_ADMIN'], { jobTitle: 'Facilities Coordinator', homeBuildingId: buildingIds.get('HT'), departmentId: deptIds.get('Operations'), teamId: teamIds.get('Operations/Facilities') });
  const approver = mkUser(`approver@${dom}`, 'Rahul', 'Verma', ['APPROVER'], { jobTitle: 'Engineering Manager', homeBuildingId: buildingIds.get('HT'), departmentId: deptIds.get('Engineering'), teamId: teamIds.get('Engineering/Mobile') });
  for (const [first, last, dept, team, title, bcode] of PEOPLE) {
    if (first === 'Divya' || first === 'Rahul') continue;
    const u = mkUser(`${first.toLowerCase()}.${last.toLowerCase()}@${dom}`, first, last, ['EMPLOYEE'], { jobTitle: title, homeBuildingId: buildingIds.get(bcode), departmentId: deptIds.get(dept), teamId: teamIds.get(`${dept}/${team}`) });
    employees.push({ id: u.id, building: bcode });
  }
  const guest = mkUser(`guest@${dom}`, 'Guest', 'Explorer', ['ORG_ADMIN'], { jobTitle: 'Guest explorer', homeBuildingId: buildingIds.get('HT'), departmentId: deptIds.get('Engineering'), teamId: teamIds.get('Engineering/Platform'), lastLoginAt: nowIso });
  db.guestUserId = guest.id;
  employees.push({ id: guest.id, building: 'HT' }, { id: approver.id, building: 'HT' }, { id: wpAdmin.id, building: 'HT' });
  mkUser(`invited@${dom}`, 'Jordan', 'Lee', ['EMPLOYEE'], { status: 'INVITED', jobTitle: 'New Joiner', homeBuildingId: buildingIds.get('RC') });

  const used = new Set<string>();
  const makeRes = (o: { userId: string; resource: { id: string }; type: ResourceType; date: string; start: string; end: string; tz: string; status: ReservationStatus; title?: string; checkIn?: boolean; cancelReason?: string; createdDaysAgo?: number }) => {
    const key = `${o.resource.id}|${o.date}|${o.start}`;
    if (used.has(key)) return;
    used.add(key);
    const startAt = fromLocal(o.date, o.start, o.tz);
    const endAt = fromLocal(o.date, o.end, o.tz);
    const id = uuid();
    // Never created in the future (the API seed can do that for bookings a few days ahead).
    const createdAt = new Date(Math.min(startAt.getTime() - (o.createdDaysAgo ?? 2) * 86400000, now.getTime() - 3600000)).toISOString();
    db.reservations.push({
      id, resourceId: o.resource.id, userId: o.userId, createdById: o.userId, type: o.type, status: o.status, title: o.title ?? null, description: null, setupNotes: null,
      startAt: startAt.toISOString(), endAt: endAt.toISOString(), timezone: o.tz, isAllDay: false, seriesId: null, checkInCode: shortCode(),
      checkedInAt: o.checkIn ? new Date(startAt.getTime() + 5 * 60000).toISOString() : null,
      checkedOutAt: o.checkIn && o.status === 'COMPLETED' ? endAt.toISOString() : null,
      cancelledAt: o.status === 'CANCELLED' ? new Date(startAt.getTime() - 3600000 * 20).toISOString() : null,
      cancelledById: o.status === 'CANCELLED' ? o.userId : null,
      cancelReason: o.cancelReason ?? null,
      createdAt, updatedAt: createdAt, attendees: [],
      approval: o.status === 'PENDING_APPROVAL' ? { id: uuid(), status: 'PENDING', requestedById: o.userId, approverId: null, decisionNote: null, decidedAt: null } : null,
    });
    if (o.checkIn) db.checkIns.push({ id: uuid(), reservationId: id, userId: o.userId, method: pick(['QR', 'MANUAL'] as const), kind: 'IN', at: new Date(startAt.getTime() + 5 * 60000).toISOString() });
  };

  for (const spec of DEMO_BUILDINGS) {
    const tz = spec.timezone;
    const seats = seatsByBuilding.get(spec.code)!.filter((s) => s.floorNumber !== 0);
    const rooms = roomsByBuilding.get(spec.code)!;
    const openRooms = rooms.filter((x) => !x.requiresApproval);
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
        makeRes({ userId: pick(people).id, resource: pick(openRooms), type: 'MEETING_ROOM', date: ds, start: `${String(startH).padStart(2, '0')}:00`, end: `${String(startH + 1).padStart(2, '0')}:00`, tz, status: rand() < 0.85 ? 'COMPLETED' : 'CANCELLED', checkIn: true, title: pick(MEETING_TITLES) });
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
      makeRes({ userId: pick(people).id, resource: pick(openRooms), type: 'MEETING_ROOM', date: todayLocal, start: `${String(startH).padStart(2, '0')}:00`, end: `${String(startH + 1).padStart(2, '0')}:00`, tz, status, checkIn: status !== 'CONFIRMED', title: pick(MEETING_TITLES) });
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
        makeRes({ userId: pick(people).id, resource: pick(openRooms), type: 'MEETING_ROOM', date: ds, start: `${String(startH).padStart(2, '0')}:30`, end: `${String(startH + 1).padStart(2, '0')}:30`, tz, status: 'CONFIRMED', title: pick(MEETING_TITLES) });
      }
    }
    const approvalRoom = rooms.find((x) => x.requiresApproval);
    if (approvalRoom) {
      const date = dayjs(todayLocal, 'YYYY-MM-DD').add(2, 'day').format('YYYY-MM-DD');
      makeRes({ userId: guest.id, resource: approvalRoom, type: 'MEETING_ROOM', date, start: '14:00', end: '16:00', tz, status: 'PENDING_APPROVAL', title: 'Executive roadmap review' });
      const date2 = dayjs(todayLocal, 'YYYY-MM-DD').add(3, 'day').format('YYYY-MM-DD');
      makeRes({ userId: employees[0].id, resource: approvalRoom, type: 'MEETING_ROOM', date: date2, start: '10:00', end: '12:00', tz, status: 'PENDING_APPROVAL', title: 'Board prep session' });
    }
  }

  const htSeats = seatsByBuilding.get('HT')!;
  for (const s of [htSeats[20], htSeats[21], htSeats[60]]) db.favorites.push({ id: uuid(), userId: guest.id, resourceId: s.id, createdAt: nowIso });
  db.favorites.push({ id: uuid(), userId: guest.id, resourceId: roomsByBuilding.get('HT')![2].id, createdAt: nowIso });
  db.notifications.push(
    { id: uuid(), userId: guest.id, type: 'ANNOUNCEMENT', title: 'Welcome to SpaceFlow', body: 'Book a desk in seconds, explore the office in 3D and check in with your QR code.', data: {}, readAt: null, createdAt: nowIso },
    { id: uuid(), userId: guest.id, type: 'APPROVAL_REQUESTED', title: 'Boardroom booking awaiting approval', body: 'Your request for Titan is waiting for an approver.', data: {}, readAt: null, createdAt: nowIso },
  );
  db.announcements.push(
    { id: uuid(), title: 'Rooftop cafeteria reopens Monday', body: 'Level 3 cafeteria at Harbor Tower reopens with a new menu. Breakfast from 08:00.', buildingId: buildingIds.get('HT')!, publishedAt: nowIso, expiresAt: null },
    { id: uuid(), title: 'Quarterly fire drill', body: 'A fire drill will take place next Wednesday at 11:00 in both buildings. Please follow the marked emergency exits.', buildingId: null, publishedAt: nowIso, expiresAt: null },
  );
  db.integrations.push({ provider: 'QR_CHECKIN', isEnabled: true, status: 'READY', config: { allowKioskCheckIn: true }, lastError: null, lastSyncedAt: null });
  db.maintenance.push({ id: uuid(), resourceId: roomsByBuilding.get('RC')![0].id, startAt: dayjs(now).add(3, 'day').hour(8).minute(0).second(0).millisecond(0).toISOString(), endAt: dayjs(now).add(3, 'day').hour(12).minute(0).second(0).millisecond(0).toISOString(), reason: 'AV equipment upgrade' });
  db.audit.push({ id: uuid(), actorId: guest.id, action: 'auth.guest-login', entityType: 'User', entityId: guest.id, before: null, after: null, ip: null, createdAt: nowIso });

  return db;
}
