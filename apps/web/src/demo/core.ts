// Shared plumbing for the demo backend: the persisted store, errors, DTO mappers, policy
// resolution and the availability engine. Ported from apps/api/src (utils/mappers.ts,
// policies/service.ts, availability/service.ts) so the UI sees the same behaviour as with the API.
import {
  ROLE_PERMISSIONS,
  type AvailabilityState,
  type BuildingDto,
  type CurrentUserDto,
  type FloorDto,
  type MapObjectDto,
  type NotificationDto,
  type NotificationType,
  type Paginated,
  type Permission,
  type PolicyDto,
  type ReservationSummaryDto,
  type ResourceAvailabilityDto,
  type ResourceDto,
  type ResourceType,
  type UserSummaryDto,
  type ZoneDto,
} from '@spaceflow/shared';
import { dayjs } from '@/utils/time';
import { createDemoDb, DB_VERSION, SANDBOX_TTL_HOURS, uuid, type DbMapObject, type DbPolicy, type DbReservation, type DbResource, type DbUser, type DemoDb } from './db';

export const SANDBOX_TTL = SANDBOX_TTL_HOURS;

// ---------------------------------------------------------------------------
// Store + persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'sf.demo.v1';
const SESSION_KEY = 'sf.demo.session';

let store: DemoDb | null = null;

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage full or blocked: the sandbox still works for this page load */
  }
}

/** The current sandbox, restored from localStorage when it exists and has not expired. */
export function getDb(): DemoDb | null {
  if (store) return store;
  const raw = readStorage(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DemoDb;
    if (parsed.version !== DB_VERSION || Date.parse(parsed.expiresAt) <= Date.now()) {
      writeStorage(STORAGE_KEY, null);
      return null;
    }
    store = parsed;
    return store;
  } catch {
    writeStorage(STORAGE_KEY, null);
    return null;
  }
}

export function newSandbox(): DemoDb {
  store = createDemoDb();
  save();
  return store;
}

export function dropSandbox() {
  store = null;
  writeStorage(STORAGE_KEY, null);
  writeStorage(SESSION_KEY, null);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
export function save() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (store) writeStorage(STORAGE_KEY, JSON.stringify(store));
  }, 50);
}

export function hasSession(): boolean {
  return readStorage(SESSION_KEY) === 'active' && !!getDb();
}

export function setSession(active: boolean) {
  writeStorage(SESSION_KEY, active ? 'active' : null);
}

// ---------------------------------------------------------------------------
// Errors + request context
// ---------------------------------------------------------------------------

export class DemoError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
  static badRequest(message: string, details?: unknown) {
    return new DemoError(400, 'VALIDATION_ERROR', message, details);
  }
  static unauthenticated(message = 'Authentication required') {
    return new DemoError(401, 'UNAUTHENTICATED', message);
  }
  static forbidden(message = 'You do not have permission to perform this action') {
    return new DemoError(403, 'FORBIDDEN', message);
  }
  static notFound(entity = 'Resource') {
    return new DemoError(404, 'NOT_FOUND', `${entity} not found`);
  }
  static conflict(message: string, details?: unknown) {
    return new DemoError(409, 'CONFLICT', message, details);
  }
  static bookingConflict(message: string, details?: unknown) {
    return new DemoError(409, 'BOOKING_CONFLICT', message, details);
  }
  static policy(message: string, details?: unknown) {
    return new DemoError(422, 'POLICY_VIOLATION', message, details);
  }
  static unavailable(message: string, details?: unknown) {
    return new DemoError(422, 'RESOURCE_UNAVAILABLE', message, details);
  }
  static invalidTime(message: string) {
    return new DemoError(422, 'INVALID_TIME_RANGE', message);
  }
  static notInDemo(feature: string) {
    return new DemoError(501, 'INTEGRATION_NOT_CONFIGURED', `${feature} is not available in the demo. Connect a SpaceFlow backend to use it.`);
  }
}

/** Signed-in demo user plus the permissions derived from their roles. */
export interface AuthUser {
  id: string;
  email: string;
  orgId: string;
  departmentId: string | null;
  teamId: string | null;
  permissions: Permission[];
}

export interface Ctx {
  db: DemoDb;
  user: AuthUser;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
}

/** Return value of a handler that needs a status other than 200 or a non-JSON body. */
export class Reply {
  constructor(
    readonly status: number,
    readonly body?: unknown,
    readonly contentType = 'application/json',
  ) {}
}

export function permissionsFor(roles: DbUser['roles']): Permission[] {
  const set = new Set<Permission>();
  for (const r of roles) ROLE_PERMISSIONS[r].forEach((p) => set.add(p));
  return [...set];
}

export function toAuthUser(db: DemoDb, u: DbUser): AuthUser {
  return { id: u.id, email: u.email, orgId: db.org.id, departmentId: u.departmentId, teamId: u.teamId, permissions: permissionsFor(u.roles) };
}

export function requirePermission(ctx: Ctx, perm: Permission) {
  if (!ctx.user.permissions.includes(perm)) throw DemoError.forbidden();
}

// ---------------------------------------------------------------------------
// Time helpers (apps/api/src/utils/time.ts)
// ---------------------------------------------------------------------------

export const ms = (iso: string) => Date.parse(iso);
export const iso = (d: Date | number) => new Date(d).toISOString();

export function localDate(at: Date, tz: string): string {
  return dayjs(at).tz(tz).format('YYYY-MM-DD');
}
export function localTime(at: Date, tz: string): string {
  return dayjs(at).tz(tz).format('HH:mm');
}
export function localWeekday(at: Date, tz: string): number {
  return dayjs(at).tz(tz).day();
}
export function fromLocal(date: string, time: string, tz: string): Date {
  return dayjs.tz(`${date} ${time}`, 'YYYY-MM-DD HH:mm', tz).toDate();
}
export function startOfLocalDay(date: string, tz: string): Date {
  return dayjs.tz(date, 'YYYY-MM-DD', tz).startOf('day').toDate();
}
export function endOfLocalDay(date: string, tz: string): Date {
  return dayjs.tz(date, 'YYYY-MM-DD', tz).add(1, 'day').startOf('day').toDate();
}
export function startOfLocalWeek(at: Date, tz: string): Date {
  const d = dayjs(at).tz(tz).startOf('day');
  // ISO week: Monday start
  return d.subtract((d.day() + 6) % 7, 'day').toDate();
}
export function addDays(date: string, days: number): string {
  return dayjs(date, 'YYYY-MM-DD').add(days, 'day').format('YYYY-MM-DD');
}
export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60000);
}
export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
/** Half-open interval overlap test, on epoch milliseconds. */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}
export function formatRange(start: Date, end: Date, tz: string): string {
  const s = dayjs(start).tz(tz);
  const e = dayjs(end).tz(tz);
  if (s.isSame(e, 'day')) return `${s.format('ddd D MMM, HH:mm')}–${e.format('HH:mm')}`;
  return `${s.format('ddd D MMM HH:mm')} – ${e.format('ddd D MMM HH:mm')}`;
}

export function paginate<T>(items: T[], page: number, pageSize: number): Paginated<T> {
  const total = items.length;
  return { items: items.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export function contains(haystack: string | null | undefined, needle: string): boolean {
  return !!haystack && haystack.toLowerCase().includes(needle.toLowerCase());
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function findBuilding(db: DemoDb, id: string) {
  return db.buildings.find((b) => b.id === id && !b.deletedAt);
}
export function findFloor(db: DemoDb, id: string) {
  return db.floors.find((f) => f.id === id && !f.deletedAt);
}
export function findResource(db: DemoDb, id: string) {
  return db.resources.find((r) => r.id === id && !r.deletedAt);
}
export function findUser(db: DemoDb, id: string) {
  return db.users.find((u) => u.id === id && !u.deletedAt);
}
export function liveResources(db: DemoDb) {
  return db.resources.filter((r) => !r.deletedAt);
}
export function favoriteIds(db: DemoDb, userId: string): Set<string> {
  return new Set(db.favorites.filter((f) => f.userId === userId).map((f) => f.resourceId));
}

// ---------------------------------------------------------------------------
// Mappers (apps/api/src/utils/mappers.ts)
// ---------------------------------------------------------------------------

/** Map object (desk / room shape) linked to a resource on its floor's plan. */
export function mapObjectFor(db: DemoDb, resourceId: string): DbMapObject | undefined {
  return db.mapObjects.find((o) => o.resourceId === resourceId);
}

export function toResourceDto(db: DemoDb, r: DbResource, extras: { isFavorite?: boolean } = {}): ResourceDto {
  const building = db.buildings.find((b) => b.id === r.buildingId)!;
  const floor = db.floors.find((f) => f.id === r.floorId)!;
  const zone = r.zoneId ? db.zones.find((z) => z.id === r.zoneId) : undefined;
  const mo = mapObjectFor(db, r.id);
  return {
    id: r.id,
    type: r.type,
    code: r.code,
    name: r.name,
    description: r.description,
    status: r.status,
    isBookable: r.isBookable,
    requiresApproval: r.requiresApproval,
    buildingId: building.id,
    buildingName: building.name,
    buildingTimezone: building.timezone,
    floorId: floor.id,
    floorName: floor.name,
    floorNumber: floor.number,
    zoneId: zone?.id ?? null,
    zoneName: zone?.name ?? null,
    capacity: r.capacity,
    seatType: r.seatType,
    roomType: r.roomType,
    seatAttributes: r.seatAttributes,
    accessible: r.accessible,
    amenities: r.amenityIds.map((id) => db.amenities.find((a) => a.id === id)).filter((a): a is NonNullable<typeof a> => !!a),
    operatingHours: r.operatingHours,
    maxDurationMinutes: r.maxDurationMinutes,
    checkInRequired: r.checkInRequired,
    restrictedDepartmentIds: r.restrictedDepartmentIds,
    restrictedTeamIds: r.restrictedTeamIds,
    mapPosition: mo ? { x: mo.x, y: mo.y, width: mo.width, depth: mo.depth, rotation: mo.rotation } : null,
    isFavorite: extras.isFavorite,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function toBuildingDto(db: DemoDb, b: DemoDb['buildings'][number]): BuildingDto {
  const resources = db.resources.filter((r) => r.buildingId === b.id && !r.deletedAt);
  return {
    id: b.id,
    name: b.name,
    code: b.code,
    addressLine: b.addressLine,
    city: b.city,
    country: b.country,
    timezone: b.timezone,
    isActive: b.isActive,
    description: b.description,
    modelAssetId: b.modelAssetId,
    modelUrl: assetUrl(b.modelAssetId),
    floorCount: db.floors.filter((f) => f.buildingId === b.id && !f.deletedAt).length,
    seatCount: resources.filter((r) => r.type === 'SEAT').length,
    roomCount: resources.filter((r) => r.type === 'MEETING_ROOM').length,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

export function toFloorDto(db: DemoDb, f: DemoDb['floors'][number]): FloorDto {
  const plan = db.floorPlans.find((p) => p.floorId === f.id);
  const resources = db.resources.filter((r) => r.floorId === f.id && !r.deletedAt);
  return {
    id: f.id,
    buildingId: f.buildingId,
    name: f.name,
    number: f.number,
    sortOrder: f.sortOrder,
    isPublished: f.isPublished,
    hasFloorPlan: !!plan,
    floorPlanStatus: plan ? plan.status : 'NONE',
    seatCount: resources.filter((r) => r.type === 'SEAT').length,
    roomCount: resources.filter((r) => r.type === 'MEETING_ROOM').length,
    widthM: plan?.widthM ?? null,
    depthM: plan?.depthM ?? null,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}

export function toZoneDto(z: DemoDb['zones'][number]): ZoneDto {
  return { id: z.id, floorId: z.floorId, name: z.name, kind: z.kind, color: z.color };
}

export function toMapObjectDto(o: DbMapObject): MapObjectDto {
  return { id: o.id, kind: o.kind, label: o.label, x: o.x, y: o.y, width: o.width, depth: o.depth, rotation: o.rotation, height: o.height, resourceId: o.resourceId, meta: o.meta };
}

export function toReservationSummaryDto(db: DemoDb, r: DbReservation): ReservationSummaryDto {
  const resource = db.resources.find((x) => x.id === r.resourceId)!;
  const building = db.buildings.find((b) => b.id === resource.buildingId)!;
  const floor = db.floors.find((f) => f.id === resource.floorId)!;
  const zone = resource.zoneId ? db.zones.find((z) => z.id === resource.zoneId) : undefined;
  const user = db.users.find((u) => u.id === r.userId);
  return {
    id: r.id,
    resourceId: resource.id,
    resourceCode: resource.code,
    resourceName: resource.name,
    resourceType: resource.type,
    type: r.type,
    status: r.status,
    title: r.title,
    startAt: r.startAt,
    endAt: r.endAt,
    timezone: r.timezone,
    isAllDay: r.isAllDay,
    userId: r.userId,
    userDisplayName: user ? `${user.firstName} ${user.lastName}` : 'Former colleague',
    buildingId: building.id,
    buildingName: building.name,
    floorId: floor.id,
    floorName: floor.name,
    floorNumber: floor.number,
    zoneName: zone?.name ?? null,
    seriesId: r.seriesId,
    checkedInAt: r.checkedInAt,
    checkedOutAt: r.checkedOutAt,
    cancelledAt: r.cancelledAt,
    cancelReason: r.cancelReason,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function toUserSummaryDto(db: DemoDb, u: DbUser): UserSummaryDto {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    displayName: `${u.firstName} ${u.lastName}`,
    avatarUrl: u.avatarUrl,
    jobTitle: u.jobTitle,
    departmentId: u.departmentId,
    departmentName: db.departments.find((d) => d.id === u.departmentId)?.name ?? null,
    teamId: u.teamId,
    teamName: db.teams.find((t) => t.id === u.teamId)?.name ?? null,
  };
}

export function toCurrentUserDto(db: DemoDb, u: DbUser): CurrentUserDto {
  return {
    ...toUserSummaryDto(db, u),
    orgId: db.org.id,
    orgName: db.org.name,
    roles: u.roles,
    permissions: permissionsFor(u.roles),
    status: u.status,
    homeBuildingId: u.homeBuildingId,
    homeBuildingName: db.buildings.find((b) => b.id === u.homeBuildingId)?.name ?? null,
    phone: u.phone,
    preferences: u.preferences,
    lastLoginAt: u.lastLoginAt,
    isGuest: true,
    guestExpiresAt: db.expiresAt,
  };
}

export function toNotificationDto(n: DemoDb['notifications'][number]): NotificationDto {
  return { id: n.id, type: n.type, title: n.title, body: n.body, data: n.data, readAt: n.readAt, createdAt: n.createdAt };
}

export function toPolicyDto(db: DemoDb, p: DbPolicy): PolicyDto {
  return { ...p, buildingName: p.buildingId ? db.buildings.find((b) => b.id === p.buildingId)?.name ?? null : null };
}

/** Uploaded files live only in memory; see admin.ts. */
export const assetFiles = new Map<string, Blob>();
export const assetObjectUrls = new Map<string, string>();

export function assetUrl(assetId: string | null | undefined): string | null {
  if (!assetId) return null;
  const blob = assetFiles.get(assetId);
  if (!blob) return null;
  let url = assetObjectUrls.get(assetId);
  if (!url) {
    url = URL.createObjectURL(blob);
    assetObjectUrls.set(assetId, url);
  }
  return url;
}

export function buildSearchText(parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ').toLowerCase();
}

// ---------------------------------------------------------------------------
// Side effects: notifications + audit
// ---------------------------------------------------------------------------

export function notify(db: DemoDb, input: { userId: string; type: NotificationType; title: string; body: string; data?: Record<string, unknown> }) {
  db.notifications.push({ id: uuid(), userId: input.userId, type: input.type, title: input.title, body: input.body, data: input.data ?? null, readAt: null, createdAt: iso(Date.now()) });
}

export function audit(db: DemoDb, input: { actorId: string | null; action: string; entityType: string; entityId: string; before?: unknown; after?: unknown }) {
  db.audit.push({ id: uuid(), actorId: input.actorId, action: input.action, entityType: input.entityType, entityId: input.entityId, before: input.before ?? null, after: input.after ?? null, ip: null, createdAt: iso(Date.now()) });
}

// ---------------------------------------------------------------------------
// Policies (apps/api/src/modules/policies/service.ts)
// ---------------------------------------------------------------------------

const DEFAULT_POLICY: Omit<DbPolicy, 'id' | 'createdAt' | 'updatedAt'> = {
  buildingId: null,
  resourceType: null,
  name: 'System default',
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
};

/** Most specific active policy: building + type > building > type > org default > system default. */
export function resolvePolicy(db: DemoDb, buildingId: string, resourceType: ResourceType): DbPolicy {
  const candidates = db.policies.filter(
    (p) => p.isActive && (p.buildingId === buildingId || p.buildingId === null) && (p.resourceType === resourceType || p.resourceType === null),
  );
  const score = (p: DbPolicy) => (p.buildingId ? 2 : 0) + (p.resourceType ? 1 : 0);
  candidates.sort((a, b) => score(b) - score(a) || ms(b.updatedAt) - ms(a.updatedAt));
  return candidates[0] ?? { ...DEFAULT_POLICY, id: 'default', createdAt: iso(0), updatedAt: iso(0) };
}

// ---------------------------------------------------------------------------
// Availability (apps/api/src/modules/availability/service.ts)
// ---------------------------------------------------------------------------

export const ACTIVE_STATUSES = ['PENDING_APPROVAL', 'CONFIRMED', 'CHECKED_IN'] as const;
export const isActiveStatus = (s: string) => (ACTIVE_STATUSES as readonly string[]).includes(s);

export function operatingWindowFor(resource: Pick<DbResource, 'operatingHours'>, policy: Pick<DbPolicy, 'operatingStart' | 'operatingEnd' | 'allowWeekends'>, weekday: number): { open: string; close: string } | null {
  const hours = resource.operatingHours;
  if (hours && Object.keys(hours).length) {
    const day = hours[String(weekday)];
    return day ? { open: day.open, close: day.close } : null;
  }
  if (!policy.allowWeekends && (weekday === 0 || weekday === 6)) return null;
  return { open: policy.operatingStart, close: policy.operatingEnd };
}

export function checkOperatingHours(resource: DbResource, policy: DbPolicy, startAt: Date, endAt: Date, tz: string): { ok: true } | { ok: false; reason: string } {
  const startDay = localDate(startAt, tz);
  const endDay = localDate(new Date(endAt.getTime() - 1), tz);
  if (startDay !== endDay) return { ok: false, reason: 'A booking must start and end on the same day. Use multi-day booking for several days.' };
  const window = operatingWindowFor(resource, policy, localWeekday(startAt, tz));
  if (!window) return { ok: false, reason: 'The resource is closed on the selected day.' };
  const open = fromLocal(startDay, window.open, tz);
  const close = fromLocal(startDay, window.close, tz);
  if (startAt < open || endAt > close) return { ok: false, reason: `Bookings are only allowed between ${window.open} and ${window.close} (local time).` };
  return { ok: true };
}

export function userCanAccessResource(resource: Pick<DbResource, 'restrictedDepartmentIds' | 'restrictedTeamIds'>, user: AuthUser | undefined): boolean {
  const restricted = resource.restrictedDepartmentIds.length > 0 || resource.restrictedTeamIds.length > 0;
  if (!restricted) return true;
  if (!user) return false;
  if (user.permissions.includes('reservation:manage-any')) return true;
  if (user.departmentId && resource.restrictedDepartmentIds.includes(user.departmentId)) return true;
  if (user.teamId && resource.restrictedTeamIds.includes(user.teamId)) return true;
  return false;
}

export function computeAvailability(
  db: DemoDb,
  resources: DbResource[],
  opts: { startAt: Date; endAt: Date; user?: AuthUser; now?: Date; excludeReservationId?: string },
): Map<string, ResourceAvailabilityDto> {
  const now = (opts.now ?? new Date()).getTime();
  const s = opts.startAt.getTime();
  const e = opts.endAt.getTime();
  const ids = new Set(resources.map((r) => r.id));
  const result = new Map<string, ResourceAvailabilityDto>();
  if (!ids.size) return result;

  const conflictsByResource = new Map<string, DbReservation[]>();
  for (const c of db.reservations) {
    if (!ids.has(c.resourceId) || !isActiveStatus(c.status) || c.id === opts.excludeReservationId) continue;
    if (!overlaps(ms(c.startAt), ms(c.endAt), s, e)) continue;
    const list = conflictsByResource.get(c.resourceId) ?? [];
    list.push(c);
    conflictsByResource.set(c.resourceId, list);
  }
  for (const list of conflictsByResource.values()) list.sort((a, b) => ms(a.startAt) - ms(b.startAt));
  const maintenanceByResource = new Map(db.maintenance.filter((m) => ids.has(m.resourceId) && overlaps(ms(m.startAt), ms(m.endAt), s, e)).map((m) => [m.resourceId, m]));
  const canSeeNames = !!opts.user?.permissions.includes('reservation:manage-any');

  for (const r of resources) {
    const floor = db.floors.find((f) => f.id === r.floorId);
    const building = db.buildings.find((b) => b.id === r.buildingId);
    let state: AvailabilityState = 'AVAILABLE';
    let reason: string | null = null;
    let conflicting: ResourceAvailabilityDto['conflictingReservation'] = null;
    const m = maintenanceByResource.get(r.id);
    if (r.status !== 'ACTIVE' || !r.isBookable) {
      state = 'DISABLED';
      reason = r.status === 'MAINTENANCE' ? 'Under maintenance' : 'Not bookable';
    } else if (floor && !floor.isPublished) {
      state = 'DISABLED';
      reason = 'Floor layout is not published';
    } else if (building && !building.isActive) {
      state = 'DISABLED';
      reason = 'Building is inactive';
    } else if (m) {
      state = 'DISABLED';
      reason = m.reason ? `Maintenance: ${m.reason}` : 'Scheduled maintenance';
    } else {
      const list = conflictsByResource.get(r.id) ?? [];
      if (list.length) {
        const first = list[0];
        const fs = ms(first.startAt);
        const fe = ms(first.endAt);
        const inProgress = list.some((c) => ms(c.startAt) <= now && ms(c.endAt) > now && (c.status === 'CHECKED_IN' || c.status === 'CONFIRMED'));
        const isMine = !!opts.user && first.userId === opts.user.id;
        const owner = db.users.find((u) => u.id === first.userId);
        state = inProgress && overlaps(fs, fe, now, now + 1) ? 'OCCUPIED' : 'RESERVED';
        const first_ = owner?.firstName ?? 'A';
        const last_ = owner?.lastName ?? 'colleague';
        const who = isMine ? 'you' : canSeeNames || owner?.preferences.shareLocationWithTeam !== false ? `${first_} ${last_.charAt(0)}.` : 'a colleague';
        reason = `${state === 'OCCUPIED' ? 'In use' : 'Reserved'} ${formatRange(new Date(fs), new Date(fe), first.timezone)} by ${who}`;
        conflicting = { id: first.id, startAt: first.startAt, endAt: first.endAt, status: first.status, userDisplayName: isMine || canSeeNames ? `${first_} ${last_}` : null, isMine };
      } else if (!userCanAccessResource(r, opts.user)) {
        state = 'RESTRICTED';
        reason = 'Reserved for a specific department or team';
      } else if (r.requiresApproval) {
        state = 'RESTRICTED';
        reason = 'Booking requires approval';
      }
    }
    result.set(r.id, {
      resourceId: r.id,
      state,
      reason,
      canBook: state === 'AVAILABLE' || (state === 'RESTRICTED' && r.requiresApproval && userCanAccessResource(r, opts.user)),
      conflictingReservation: conflicting,
    });
  }
  return result;
}
