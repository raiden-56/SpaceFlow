// Admin portal + assets for the demo backend. Port of apps/api/src/modules/admin/{workplace,people,governance}.ts
// and modules/assets. Uploaded files live in memory only (assetFiles); their rows persist but the bytes
// are gone after a reload.
import {
  BOOKABLE_MAP_KINDS,
  RoomTypes,
  adminCancelSchema,
  amenityCreateSchema,
  amenityUpdateSchema,
  analyticsQuerySchema,
  announcementSchema,
  auditQuerySchema,
  buildingCreateSchema,
  buildingUpdateSchema,
  departmentSchema,
  floorCreateSchema,
  floorPlanUpsertSchema,
  floorReorderSchema,
  floorUpdateSchema,
  integrationUpdateSchema,
  orgSettingsSchema,
  policySchema,
  policyUpdateSchema,
  reservationListQuerySchema,
  roomCsvRowSchema,
  seatCsvRowSchema,
  teamSchema,
  userCreateSchema,
  userListQuerySchema,
  userUpdateSchema,
  zoneCreateSchema,
  zoneUpdateSchema,
  type AdminOverviewDto,
  type AdminUserDto,
  type AnnouncementDto,
  type AssetDto,
  type AssetKind,
  type AuditLogDto,
  type DepartmentDto,
  type IntegrationDto,
  type IntegrationProvider,
  type PolicyInput,
  type ReservationListQuery,
  type RoleCode,
  type RoomType,
  type SeatCsvRow,
} from '@spaceflow/shared';
import { dayjs } from '@/utils/time';
import { DEFAULT_PREFERENCES, uuid, type DbAsset, type DbBuilding, type DbMapObject, type DbPolicy, type DbReservation, type DbResource, type DbUser, type DemoDb } from '../db';
import {
  DemoError,
  Reply,
  assetFiles,
  assetObjectUrls,
  assetUrl,
  audit,
  buildSearchText,
  contains,
  endOfLocalDay,
  findBuilding,
  findFloor,
  findUser,
  iso,
  mapObjectFor,
  ms,
  paginate,
  requirePermission,
  resolvePolicy,
  startOfLocalDay,
  timeToMinutes,
  toBuildingDto,
  toFloorDto,
  toMapObjectDto,
  toPolicyDto,
  toUserSummaryDto,
  toZoneDto,
  type Ctx,
} from '../core';
import { del, get, patch, post, put, type Route } from '../router';
import { cancelReservation, listReservations } from './reservations';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const now = () => iso(Date.now());
const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const csv = (text: string) => new Reply(200, text, 'text/csv');
const ACTIVE = ['CONFIRMED', 'CHECKED_IN', 'PENDING_APPROVAL'];

/** Zod 4 applies .default()s inside .partial(): keep only the keys the client actually sent, so a PATCH never resets other fields. */
function patchOf<T extends object>(schema: { parse(v: unknown): T }, raw: unknown): Partial<T> {
  const parsed = schema.parse(raw ?? {});
  const sent = raw && typeof raw === 'object' ? (raw as object) : {};
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => k in sent)) as Partial<T>;
}

function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function formOf(ctx: Ctx): FormData {
  if (!(ctx.body instanceof FormData)) throw DemoError.badRequest('Expected a multipart/form-data body');
  return ctx.body;
}

/** Reservations on matching resources that still occupy them. */
function activeReservationCount(db: DemoDb, match: (r: DbResource) => boolean): number {
  const ids = new Set(db.resources.filter(match).map((r) => r.id));
  const t = Date.now();
  return db.reservations.filter((r) => ids.has(r.resourceId) && ACTIVE.includes(r.status) && ms(r.endAt) > t).length;
}

/** Release future bookings of a deactivated / removed account. */
function cancelFutureBookings(db: DemoDb, userId: string, actorId: string, reason: string) {
  const t = Date.now();
  for (const r of db.reservations) {
    if (r.userId !== userId || !['CONFIRMED', 'PENDING_APPROVAL'].includes(r.status) || ms(r.startAt) <= t) continue;
    Object.assign(r, { status: 'CANCELLED', cancelledAt: now(), cancelledById: actorId, cancelReason: reason, updatedAt: now() });
  }
}

/**
 * Bookable objects (desks, meeting rooms) must not overlap: the one underneath could never be
 * selected on the map. Uses axis-aligned bounds; rotations of 90°/270° swap width and depth.
 */
function findBookableOverlaps(objects: { kind: string; label?: string | null; x: number; y: number; width: number; depth: number; rotation?: number | null }[]): string[] {
  const boxes = objects
    .map((o, i) => {
      const quarter = Math.round(((o.rotation ?? 0) % 180) / 90) % 2 !== 0;
      const w = quarter ? o.depth : o.width;
      const d = quarter ? o.width : o.depth;
      const cx = o.x + o.width / 2;
      const cy = o.y + o.depth / 2;
      return { i, kind: o.kind, label: o.label, x0: cx - w / 2, x1: cx + w / 2, y0: cy - d / 2, y1: cy + d / 2 };
    })
    .filter((b) => b.kind === 'DESK' || b.kind === 'MEETING_ROOM')
    .sort((a, b) => a.x0 - b.x0);
  const issues: string[] = [];
  const EPS = 0.01; // touching edges are fine
  for (let a = 0; a < boxes.length && issues.length < 20; a++) {
    for (let b = a + 1; b < boxes.length && boxes[b].x0 < boxes[a].x1 - EPS; b++) {
      const A = boxes[a];
      const B = boxes[b];
      if (A.y0 < B.y1 - EPS && B.y0 < A.y1 - EPS) {
        const name = (o: typeof A) => `object ${o.i + 1}${o.label ? ` (${o.label})` : ''}`;
        issues.push(`${name(A)} overlaps ${name(B)}; overlapping desks or rooms cannot be selected on the map`);
      }
    }
  }
  return issues;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return [];
  const split = (line: string) => {
    const out: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') inQ = false;
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const headers = split(lines[0]).map((h) => h.replace(/\s+/g, ''));
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [headers[i] ?? `col${i}`, v])));
}

const SEAT_TEMPLATE = 'code,name,floorNumber,zone,seatType,x,y,nearWindow,nearElevator,monitor,dockingStation,heightAdjustable,accessible,quietZone,amenities\nA-101,Desk A-101,1,North Wing,WORKSTATION,4,3,true,false,true,true,false,false,false,"monitor;docking"\n';
const ROOM_TEMPLATE = 'code,name,floorNumber,capacity,roomType,x,y,width,depth,requiresApproval,accessible,amenities\nMR-201,Orion,2,8,MEETING,20,4,6,5,false,true,"display;video-conferencing;whiteboard"\n';

function planDto(p: DemoDb['floorPlans'][number]) {
  return { id: p.id, widthM: p.widthM, depthM: p.depthM, status: p.status, version: p.version, imageAssetId: p.imageAssetId, modelAssetId: p.modelAssetId, publishedAt: p.publishedAt };
}

function toAnnouncementDto(a: DemoDb['announcements'][number]): AnnouncementDto {
  return { id: a.id, title: a.title, body: a.body, buildingId: a.buildingId, publishedAt: a.publishedAt, expiresAt: a.expiresAt };
}

// ---------------------------------------------------------------------------
// Assets (modules/assets/service.ts)
// ---------------------------------------------------------------------------

const MAX_UPLOAD_MB = 25;
const ALLOWED_EXTS: Record<AssetKind, string[]> = { BUILDING_MODEL: ['.glb'], FLOOR_MODEL: ['.glb'], FLOOR_PLAN_IMAGE: ['.png', '.jpg', '.jpeg', '.svg'] };

async function sniff(file: Blob, ext: string): Promise<string | null> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (ext === '.glb') return String.fromCharCode(...head.subarray(0, 4)) === 'glTF' ? 'model/gltf-binary' : null;
  if (ext === '.png') return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => head[i] === b) ? 'image/png' : null;
  if (ext === '.jpg' || ext === '.jpeg') return head[0] === 0xff && head[1] === 0xd8 ? 'image/jpeg' : null;
  if (ext === '.svg') {
    const all = await file.text();
    if (!/<svg[\s>]/i.test(all.slice(0, 4096))) return null;
    if (/<script|on[a-z]+\s*=|javascript:|<foreignObject|<iframe|xlink:href\s*=\s*["']?\s*(?!#)/i.test(all)) return null;
    return 'image/svg+xml';
  }
  return null;
}

function toAssetDto(a: DbAsset): AssetDto {
  // url is a blob: URL while the file is in memory; empty after a reload (the bytes are not persisted).
  return { id: a.id, kind: a.kind, fileName: a.fileName, mimeType: a.mimeType, sizeBytes: a.sizeBytes, url: assetUrl(a.id) ?? '', createdAt: a.createdAt };
}

function dropAssetFile(id: string) {
  const url = assetObjectUrls.get(id);
  if (url) URL.revokeObjectURL(url);
  assetObjectUrls.delete(id);
  assetFiles.delete(id);
}

// ---------------------------------------------------------------------------
// People (admin/people.ts)
// ---------------------------------------------------------------------------

function toAdminUserDto(db: DemoDb, u: DbUser, extra: { inviteUrl?: string | null } = {}): AdminUserDto {
  return {
    ...toUserSummaryDto(db, u),
    roles: u.roles,
    status: u.status,
    homeBuildingId: u.homeBuildingId,
    homeBuildingName: db.buildings.find((b) => b.id === u.homeBuildingId)?.name ?? null,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    inviteUrl: extra.inviteUrl,
  };
}

/** Only org admins may grant ORG_ADMIN; workplace admins may manage employees/approvers. */
function assertCanAssignRoles(ctx: Ctx, roles: RoleCode[]) {
  if (!ctx.user.permissions.includes('settings:manage') && roles.some((r) => r === 'ORG_ADMIN' || r === 'WORKPLACE_ADMIN')) {
    throw DemoError.forbidden('Only organization administrators can assign administrator roles.');
  }
}

function assertOrgRefs(db: DemoDb, input: { departmentId?: string | null; teamId?: string | null; homeBuildingId?: string | null }) {
  if (input.departmentId && !db.departments.some((d) => d.id === input.departmentId)) throw DemoError.badRequest('Department not found');
  if (input.teamId && !db.teams.some((t) => t.id === input.teamId)) throw DemoError.badRequest('Team not found');
  if (input.homeBuildingId && !findBuilding(db, input.homeBuildingId)) throw DemoError.badRequest('Building not found');
}

/** No real invitation tokens in the demo; the link just opens the accept-invite screen. */
const inviteUrl = () => `${location.origin}${import.meta.env.BASE_URL}accept-invite?token=demo`;

function departmentDtos(db: DemoDb): DepartmentDto[] {
  const members = (pred: (u: DbUser) => boolean) => db.users.filter((u) => !u.deletedAt && pred(u)).length;
  return [...db.departments]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d) => ({
      id: d.id,
      name: d.name,
      memberCount: members((u) => u.departmentId === d.id),
      teams: db.teams
        .filter((t) => t.departmentId === d.id)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => ({ id: t.id, name: t.name, memberCount: members((u) => u.teamId === t.id) })),
    }));
}

// ---------------------------------------------------------------------------
// Governance (admin/governance.ts)
// ---------------------------------------------------------------------------

function validatePolicy(p: Partial<PolicyInput>) {
  if (p.operatingStart && p.operatingEnd && timeToMinutes(p.operatingEnd) <= timeToMinutes(p.operatingStart)) throw DemoError.badRequest('operatingEnd must be after operatingStart');
  if (p.minDurationMinutes && p.maxDurationMinutes && p.minDurationMinutes > p.maxDurationMinutes) throw DemoError.badRequest('minDurationMinutes cannot exceed maxDurationMinutes');
  if (p.maxDailyBookings && p.maxWeeklyBookings && p.maxDailyBookings > p.maxWeeklyBookings) throw DemoError.badRequest('maxDailyBookings cannot exceed maxWeeklyBookings');
}

const cmpNullsLast = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1);

/** The demo has no server environment: only QR check-in (no external dependency) is configured. */
const PROVIDERS: { provider: IntegrationProvider; requiredEnv: string[]; configured: boolean }[] = [
  { provider: 'MS365_CALENDAR', requiredEnv: ['MS_GRAPH_TENANT_ID', 'MS_GRAPH_CLIENT_ID', 'MS_GRAPH_CLIENT_SECRET'], configured: false },
  { provider: 'GOOGLE_CALENDAR', requiredEnv: ['GOOGLE_CALENDAR_CREDENTIALS_PATH'], configured: false },
  { provider: 'MS_TEAMS', requiredEnv: ['MS_GRAPH_TENANT_ID', 'MS_GRAPH_CLIENT_ID', 'MS_GRAPH_CLIENT_SECRET'], configured: false },
  { provider: 'EMAIL_SMTP', requiredEnv: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'], configured: false },
  { provider: 'SSO_OIDC', requiredEnv: ['OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI'], configured: false },
  { provider: 'QR_CHECKIN', requiredEnv: [], configured: true },
];

function listIntegrations(db: DemoDb): IntegrationDto[] {
  return PROVIDERS.map((meta) => {
    const row = db.integrations.find((r) => r.provider === meta.provider);
    const isEnabled = row?.isEnabled ?? meta.provider === 'QR_CHECKIN';
    let status: IntegrationDto['status'] = 'NOT_CONFIGURED';
    if (meta.configured && isEnabled) status = row?.status === 'ERROR' ? 'ERROR' : 'READY';
    else if (meta.configured && !isEnabled) status = 'DISABLED';
    return { provider: meta.provider, isEnabled, isConfigured: meta.configured, status, config: row?.config ?? {}, requiredEnv: meta.requiredEnv, lastError: row?.lastError ?? null, lastSyncedAt: row?.lastSyncedAt ?? null };
  });
}

const orgDto = (db: DemoDb) => ({ id: db.org.id, name: db.org.name, slug: db.org.slug, timezone: db.org.timezone, settings: db.org.settings });

function analyticsOverview(ctx: Ctx): AdminOverviewDto {
  const { db } = ctx;
  const q = analyticsQuerySchema.parse(ctx.query);
  const building = q.buildingId ? db.buildings.find((b) => b.id === q.buildingId) : undefined;
  const tz = building?.timezone ?? db.org.timezone;
  const nowD = new Date();
  const nowMs = nowD.getTime();
  const toDate = q.to ?? dayjs(nowD).tz(tz).format('YYYY-MM-DD');
  const fromDate = q.from ?? dayjs(toDate, 'YYYY-MM-DD').subtract(29, 'day').format('YYYY-MM-DD');
  const from = startOfLocalDay(fromDate, tz).getTime();
  const to = endOfLocalDay(toDate, tz).getTime();
  const inBuilding = (buildingId: string) => !q.buildingId || buildingId === q.buildingId;

  const resById = new Map(db.resources.map((r) => [r.id, r]));
  const resourcesList = db.resources.filter((r) => !r.deletedAt && inBuilding(r.buildingId) && r.status === 'ACTIVE' && r.isBookable);
  const buildings = db.buildings.filter((b) => !b.deletedAt && inBuilding(b.id)).length;
  const floors = db.floors.filter((f) => !f.deletedAt && inBuilding(f.buildingId)).length;
  const seats = resourcesList.filter((r) => r.type === 'SEAT').length;
  const rooms = resourcesList.filter((r) => r.type === 'MEETING_ROOM').length;
  const employees = db.users.filter((u) => u.status === 'ACTIVE' && !u.deletedAt).length;
  const reservations = db.reservations
    .filter((r) => ms(r.startAt) < to && ms(r.endAt) > from && resById.has(r.resourceId) && inBuilding(resById.get(r.resourceId)!.buildingId))
    .map((r) => ({ ...r, s: ms(r.startAt), e: ms(r.endAt), resource: resById.get(r.resourceId)! }));
  const pendingApprovals = db.reservations.filter((r) => r.status === 'PENDING_APPROVAL').length;

  // Today
  const todayStr = dayjs(nowD).tz(tz).format('YYYY-MM-DD');
  const todayStart = startOfLocalDay(todayStr, tz).getTime();
  const todayEnd = endOfLocalDay(todayStr, tz).getTime();
  const todays = reservations.filter((r) => r.s < todayEnd && r.e > todayStart && ACTIVE.includes(r.status));
  const nowActive = reservations.filter((r) => r.s <= nowMs && r.e > nowMs && ['CONFIRMED', 'CHECKED_IN'].includes(r.status));
  const reservedSeatsToday = new Set(todays.filter((r) => r.type === 'SEAT').map((r) => r.resourceId)).size;
  const reservedRoomsToday = new Set(todays.filter((r) => r.type === 'MEETING_ROOM').map((r) => r.resourceId)).size;

  // Daily series
  const days: string[] = [];
  for (let d = dayjs(fromDate, 'YYYY-MM-DD'); d.format('YYYY-MM-DD') <= toDate; d = d.add(1, 'day')) days.push(d.format('YYYY-MM-DD'));
  const operatingHoursPerDay = 12; // normalising constant for utilization (07:00-19:00 core hours)
  const bookingVolume = days.map((date) => ({ date, seats: 0, rooms: 0 }));
  const utilization = days.map((date) => ({ date, seatHours: 0, roomHours: 0 }));
  const peakHours = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  const perResource = new Map<string, number>();
  const perFloorHours = new Map<string, number>();
  const perBuilding = new Map<string, { bookings: number; hours: number }>();
  const counted = reservations.filter((r) => r.status !== 'REJECTED');
  for (const r of counted) {
    const idx = days.indexOf(dayjs(r.s).tz(tz).format('YYYY-MM-DD'));
    if (idx >= 0) {
      if (r.type === 'SEAT') bookingVolume[idx].seats++;
      else bookingVolume[idx].rooms++;
    }
    if (['CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW'].includes(r.status)) {
      const hours = Math.max(0, (Math.min(r.e, to) - Math.max(r.s, from)) / 3600000);
      if (idx >= 0) {
        if (r.type === 'SEAT') utilization[idx].seatHours += hours;
        else utilization[idx].roomHours += hours;
      }
      peakHours[dayjs(r.s).tz(tz).hour()].count++;
      perResource.set(r.resourceId, (perResource.get(r.resourceId) ?? 0) + 1);
      if (r.type === 'SEAT') perFloorHours.set(r.resource.floorId, (perFloorHours.get(r.resource.floorId) ?? 0) + hours);
      const b = perBuilding.get(r.resource.buildingId) ?? { bookings: 0, hours: 0 };
      b.bookings++;
      b.hours += hours;
      perBuilding.set(r.resource.buildingId, b);
    }
  }
  const finished = counted.filter((r) => r.e <= nowMs && ['COMPLETED', 'NO_SHOW', 'CHECKED_IN', 'CONFIRMED', 'RELEASED'].includes(r.status));
  const requiredCheckIn = finished.filter((r) => r.resource.checkInRequired !== false);
  const checkedIn = finished.filter((r) => !!r.checkedInAt).length;
  const noShows = counted.filter((r) => r.status === 'NO_SHOW' || r.status === 'RELEASED').length;
  const cancelled = counted.filter((r) => r.status === 'CANCELLED').length;
  const totalBookings = counted.length;
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
  const seatsByFloor = new Map<string, number>();
  const seatsByBuilding = new Map<string, number>();
  for (const r of resourcesList) {
    if (r.type !== 'SEAT') continue;
    seatsByFloor.set(r.floorId, (seatsByFloor.get(r.floorId) ?? 0) + 1);
    seatsByBuilding.set(r.buildingId, (seatsByBuilding.get(r.buildingId) ?? 0) + 1);
  }
  const buildingIds = new Set([...perBuilding.keys(), ...seatsByBuilding.keys()]);
  const dayCount = days.length;

  return {
    totals: { buildings, floors, seats, rooms, employees },
    today: {
      reservedSeats: reservedSeatsToday,
      reservedRooms: reservedRoomsToday,
      checkedIn: nowActive.filter((r) => r.status === 'CHECKED_IN').length,
      availableSeats: Math.max(0, seats - new Set(nowActive.filter((r) => r.type === 'SEAT').map((r) => r.resourceId)).size),
      availableRooms: Math.max(0, rooms - new Set(nowActive.filter((r) => r.type === 'MEETING_ROOM').map((r) => r.resourceId)).size),
      pendingApprovals,
    },
    range: { from: fromDate, to: toDate },
    bookingVolume,
    utilization: utilization.map((u) => ({ date: u.date, seatUtilization: pct(u.seatHours, seats * operatingHoursPerDay), roomUtilization: pct(u.roomHours, rooms * operatingHoursPerDay) })),
    peakHours: peakHours.filter((p) => p.hour >= 6 && p.hour <= 21),
    rates: { totalBookings, cancelled, cancellationRate: pct(cancelled, totalBookings), checkInRequired: requiredCheckIn.length, checkedIn, checkInRate: pct(checkedIn, requiredCheckIn.length), noShows, noShowRate: pct(noShows, requiredCheckIn.length) },
    topResources: [...perResource.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id, count]) => {
        const r = resourcesList.find((x) => x.id === id);
        return { resourceId: id, code: r?.code ?? '?', name: r?.name ?? '?', type: r?.type ?? 'SEAT', count };
      }),
    floorUtilization: [...seatsByFloor.entries()]
      .map(([floorId, seatCount]) => {
        const f = db.floors.find((x) => x.id === floorId);
        const bookedHours = perFloorHours.get(floorId) ?? 0;
        return { floorId, floorName: f?.name ?? '?', buildingName: db.buildings.find((b) => b.id === f?.buildingId)?.name ?? '?', seats: seatCount, bookedHours: Math.round(bookedHours), utilization: pct(bookedHours, seatCount * operatingHoursPerDay * dayCount) };
      })
      .sort((a, b) => b.utilization - a.utilization),
    buildingComparison: db.buildings
      .filter((b) => buildingIds.has(b.id))
      .map((b) => {
        const stats = perBuilding.get(b.id) ?? { bookings: 0, hours: 0 };
        const seatCount = seatsByBuilding.get(b.id) ?? 0;
        return { buildingId: b.id, buildingName: b.name, bookings: stats.bookings, utilization: pct(stats.hours, seatCount * operatingHoursPerDay * dayCount) };
      }),
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const adminRoutes: Route[] = [
  // ---------------- Buildings ----------------
  post('/admin/buildings', (ctx) => {
    requirePermission(ctx, 'building:manage');
    const { db } = ctx;
    const input = buildingCreateSchema.parse(ctx.body);
    if (!isValidTimezone(input.timezone)) throw DemoError.badRequest(`Unknown timezone "${input.timezone}"`);
    const code = input.code.toUpperCase();
    if (db.buildings.some((b) => b.code === code)) throw DemoError.conflict('A record with the same unique value already exists', { fields: ['code'] });
    const row: DbBuilding = { id: uuid(), name: input.name, code, addressLine: input.addressLine ?? null, city: input.city ?? null, country: input.country ?? null, timezone: input.timezone, isActive: input.isActive, description: input.description ?? null, modelAssetId: null, createdAt: now(), updatedAt: now(), deletedAt: null };
    db.buildings.push(row);
    audit(db, { actorId: ctx.user.id, action: 'building.create', entityType: 'Building', entityId: row.id, after: row });
    return new Reply(201, toBuildingDto(db, row));
  }),

  patch('/admin/buildings/:id', (ctx) => {
    requirePermission(ctx, 'building:manage');
    const { db } = ctx;
    const input = patchOf(buildingUpdateSchema, ctx.body);
    if (input.timezone && !isValidTimezone(input.timezone)) throw DemoError.badRequest(`Unknown timezone "${input.timezone}"`);
    const row = findBuilding(db, ctx.params.id);
    if (!row) throw DemoError.notFound('Building');
    if (input.code) input.code = input.code.toUpperCase();
    if (input.code && db.buildings.some((b) => b.id !== row.id && b.code === input.code)) throw DemoError.conflict('A record with the same unique value already exists', { fields: ['code'] });
    const before = { ...row };
    Object.assign(row, input, { updatedAt: now() });
    audit(db, { actorId: ctx.user.id, action: 'building.update', entityType: 'Building', entityId: row.id, before, after: row });
    return toBuildingDto(db, row);
  }),

  put('/admin/buildings/:id/model', (ctx) => {
    requirePermission(ctx, 'floorplan:manage');
    const { db } = ctx;
    const { modelAssetId } = (ctx.body ?? {}) as { modelAssetId?: string | null };
    if (modelAssetId === undefined) throw DemoError.badRequest('modelAssetId is required');
    if (modelAssetId && !db.assets.some((a) => a.id === modelAssetId && a.kind === 'BUILDING_MODEL')) throw DemoError.badRequest('Asset must be an uploaded BUILDING_MODEL');
    const row = findBuilding(db, ctx.params.id);
    if (!row) throw DemoError.notFound('Building');
    Object.assign(row, { modelAssetId, updatedAt: now() });
    audit(db, { actorId: ctx.user.id, action: 'building.model', entityType: 'Building', entityId: row.id, after: { modelAssetId } });
    return toBuildingDto(db, row);
  }),

  del('/admin/buildings/:id', (ctx) => {
    requirePermission(ctx, 'building:manage');
    const { db } = ctx;
    const row = findBuilding(db, ctx.params.id);
    if (!row) throw DemoError.notFound('Building');
    const active = activeReservationCount(db, (r) => r.buildingId === row.id);
    if (active > 0) throw DemoError.conflict(`Cannot archive: ${active} active reservation(s) exist. Deactivate the building first and cancel them.`);
    const before = { ...row };
    Object.assign(row, { deletedAt: now(), isActive: false, code: `${row.code}~${Date.now().toString(36)}`, updatedAt: now() });
    audit(db, { actorId: ctx.user.id, action: 'building.delete', entityType: 'Building', entityId: row.id, before });
    return new Reply(204);
  }),

  // ---------------- Floors ----------------
  post('/admin/buildings/:id/floors', (ctx) => {
    requirePermission(ctx, 'building:manage');
    const { db } = ctx;
    const input = floorCreateSchema.parse(ctx.body);
    const building = findBuilding(db, ctx.params.id);
    if (!building) throw DemoError.notFound('Building');
    const siblings = db.floors.filter((f) => f.buildingId === building.id);
    if (siblings.some((f) => f.number === input.number)) throw DemoError.conflict('A record with the same unique value already exists', { fields: ['buildingId', 'number'] });
    const maxSort = siblings.reduce((m, f) => Math.max(m, f.sortOrder), -1);
    const row = { id: uuid(), buildingId: building.id, name: input.name, number: input.number, sortOrder: maxSort + 1, isPublished: input.isPublished, createdAt: now(), updatedAt: now(), deletedAt: null };
    db.floors.push(row);
    audit(db, { actorId: ctx.user.id, action: 'floor.create', entityType: 'Floor', entityId: row.id, after: row });
    return new Reply(201, toFloorDto(db, row));
  }),

  patch('/admin/floors/:id', (ctx) => {
    requirePermission(ctx, 'building:manage');
    const { db } = ctx;
    const input = patchOf(floorUpdateSchema, ctx.body);
    const row = findFloor(db, ctx.params.id);
    if (!row) throw DemoError.notFound('Floor');
    if (input.isPublished && !db.floorPlans.some((p) => p.floorId === row.id)) throw DemoError.policy('Publish a floor plan before publishing the floor.');
    if (input.number !== undefined && db.floors.some((f) => f.id !== row.id && f.buildingId === row.buildingId && f.number === input.number)) throw DemoError.conflict('A record with the same unique value already exists', { fields: ['buildingId', 'number'] });
    const before = { ...row };
    Object.assign(row, input, { updatedAt: now() });
    audit(db, { actorId: ctx.user.id, action: 'floor.update', entityType: 'Floor', entityId: row.id, before, after: row });
    return toFloorDto(db, row);
  }),

  post('/admin/buildings/:id/floors/reorder', (ctx) => {
    requirePermission(ctx, 'building:manage');
    const { db } = ctx;
    const { floorIds } = floorReorderSchema.parse(ctx.body);
    const building = findBuilding(db, ctx.params.id);
    if (!building) throw DemoError.notFound('Building');
    floorIds.forEach((fid, i) => {
      const f = db.floors.find((x) => x.id === fid && x.buildingId === building.id);
      if (f) Object.assign(f, { sortOrder: i, updatedAt: now() });
    });
    audit(db, { actorId: ctx.user.id, action: 'floor.reorder', entityType: 'Building', entityId: building.id, after: { floorIds } });
    return { ok: true };
  }),

  del('/admin/floors/:id', (ctx) => {
    requirePermission(ctx, 'building:manage');
    const { db } = ctx;
    const row = findFloor(db, ctx.params.id);
    if (!row) throw DemoError.notFound('Floor');
    const active = activeReservationCount(db, (r) => r.floorId === row.id);
    if (active > 0) throw DemoError.conflict(`Cannot archive: ${active} active reservation(s) exist on this floor.`);
    const before = { ...row };
    Object.assign(row, { deletedAt: now(), isPublished: false, number: row.number + 100000, updatedAt: now() });
    audit(db, { actorId: ctx.user.id, action: 'floor.delete', entityType: 'Floor', entityId: row.id, before });
    return new Reply(204);
  }),

  // ---------------- Floor plans (Map Studio) ----------------
  get('/admin/floors/:id/plan', (ctx) => {
    requirePermission(ctx, 'floorplan:manage');
    const { db } = ctx;
    const floor = findFloor(db, ctx.params.id);
    if (!floor) throw DemoError.notFound('Floor');
    const plan = db.floorPlans.find((p) => p.floorId === floor.id);
    return {
      plan: plan ? planDto(plan) : null,
      objects: plan ? db.mapObjects.filter((o) => o.floorPlanId === plan.id).map(toMapObjectDto) : [],
      zones: db.zones.filter((z) => z.floorId === floor.id).map(toZoneDto),
      resources: db.resources.filter((r) => r.floorId === floor.id && !r.deletedAt).map((r) => ({ id: r.id, code: r.code, name: r.name, type: r.type, linked: !!mapObjectFor(db, r.id) })),
    };
  }),

  /**
   * Save the floor plan draft. Objects are replaced wholesale, but resource identity is preserved:
   * objects reference resources by id (or by code for imports). Replacing a plan never deletes
   * resources or booking history.
   */
  put('/admin/floors/:id/plan', (ctx) => {
    requirePermission(ctx, 'floorplan:manage');
    const { db } = ctx;
    const input = floorPlanUpsertSchema.parse(ctx.body);
    const floor = findFloor(db, ctx.params.id);
    if (!floor) throw DemoError.notFound('Floor');
    if (input.imageAssetId && !db.assets.some((a) => a.id === input.imageAssetId && a.kind === 'FLOOR_PLAN_IMAGE')) throw DemoError.badRequest('imageAssetId must be an uploaded FLOOR_PLAN_IMAGE');
    if (input.modelAssetId && !db.assets.some((a) => a.id === input.modelAssetId && a.kind === 'FLOOR_MODEL')) throw DemoError.badRequest('modelAssetId must be an uploaded FLOOR_MODEL');
    // Resolve resource links and validate they belong to this floor.
    const floorResources = db.resources.filter((r) => r.floorId === floor.id && !r.deletedAt);
    const byId = new Map(floorResources.map((r) => [r.id, r]));
    const byCode = new Map(floorResources.map((r) => [r.code.toLowerCase(), r]));
    const seen = new Set<string>();
    const errors: string[] = [];
    const resolved = input.objects.map((o, i) => {
      let resourceId: string | null = null;
      if (o.resourceId) {
        if (!byId.has(o.resourceId)) errors.push(`Object ${i + 1}: resource ${o.resourceId} is not on this floor`);
        else resourceId = o.resourceId;
      } else if (o.resourceCode) {
        const r = byCode.get(o.resourceCode.toLowerCase());
        if (!r) errors.push(`Object ${i + 1}: no resource with code "${o.resourceCode}" on this floor`);
        else resourceId = r.id;
      }
      if (resourceId) {
        if (seen.has(resourceId)) errors.push(`Object ${i + 1}: resource ${byId.get(resourceId)?.code} is linked twice`);
        seen.add(resourceId);
        const r = byId.get(resourceId)!;
        if ((r.type === 'SEAT' && o.kind !== 'DESK') || (r.type === 'MEETING_ROOM' && o.kind !== 'MEETING_ROOM')) {
          errors.push(`Object ${i + 1}: ${r.code} is a ${r.type.toLowerCase().replace('_', ' ')} but the object kind is ${o.kind}`);
        }
      } else if (BOOKABLE_MAP_KINDS.includes(o.kind) && !o.label) {
        // Unlinked desk/room objects are allowed in drafts but must carry a label.
        errors.push(`Object ${i + 1}: unlinked ${o.kind} must have a label`);
      }
      if (o.x < 0 || o.y < 0 || o.x + o.width > input.widthM + 0.001 || o.y + o.depth > input.depthM + 0.001) {
        errors.push(`Object ${i + 1}${o.label ? ` (${o.label})` : ''}: outside the floor bounds`);
      }
      return { ...o, resourceId };
    });
    errors.push(...findBookableOverlaps(resolved));
    if (errors.length) throw DemoError.badRequest('Floor plan validation failed', { issues: errors.slice(0, 50) });

    let plan = db.floorPlans.find((p) => p.floorId === floor.id);
    const assets = { widthM: input.widthM, depthM: input.depthM, imageAssetId: input.imageAssetId ?? null, modelAssetId: input.modelAssetId ?? null };
    if (plan) Object.assign(plan, assets, { status: 'DRAFT', version: plan.version + 1 });
    else db.floorPlans.push((plan = { id: uuid(), floorId: floor.id, ...assets, status: 'DRAFT', version: 1, publishedAt: null }));
    const planId = plan.id;
    db.mapObjects = db.mapObjects.filter((o) => o.floorPlanId !== planId);
    const objects: DbMapObject[] = resolved.map((o) => ({ id: uuid(), floorPlanId: planId, kind: o.kind, label: o.label ?? null, x: o.x, y: o.y, width: o.width, depth: o.depth, rotation: o.rotation ?? 0, height: o.height ?? null, resourceId: o.resourceId, meta: o.meta ?? null }));
    db.mapObjects.push(...objects);
    audit(db, { actorId: ctx.user.id, action: 'floorplan.save', entityType: 'Floor', entityId: floor.id, after: { version: plan.version, objects: resolved.length } });
    return { plan: planDto(plan), objects: objects.map(toMapObjectDto), linked: seen.size, unlinkedResources: floorResources.filter((r) => !seen.has(r.id)).map((r) => r.code) };
  }),

  post('/admin/floors/:id/plan/publish', (ctx) => {
    requirePermission(ctx, 'floorplan:manage');
    const { db } = ctx;
    const floor = findFloor(db, ctx.params.id);
    const plan = floor && db.floorPlans.find((p) => p.floorId === floor.id);
    if (!floor || !plan) throw DemoError.policy('Save a floor plan before publishing.');
    const objects = db.mapObjects.filter((o) => o.floorPlanId === plan.id);
    const linked = new Set(objects.map((o) => o.resourceId).filter(Boolean));
    const unlinked = db.resources.filter((r) => r.floorId === floor.id && !r.deletedAt && r.status === 'ACTIVE' && !linked.has(r.id));
    const unlinkedObjects = objects.filter((o) => BOOKABLE_MAP_KINDS.includes(o.kind) && !o.resourceId);
    const warnings = [
      ...(unlinked.length ? [`${unlinked.length} active resource(s) have no map position: ${unlinked.slice(0, 10).map((r) => r.code).join(', ')}${unlinked.length > 10 ? '…' : ''}`] : []),
      ...(unlinkedObjects.length ? [`${unlinkedObjects.length} desk/room object(s) are not linked to a resource and will be shown as non-bookable`] : []),
    ];
    Object.assign(plan, { status: 'PUBLISHED', publishedAt: now() });
    Object.assign(floor, { isPublished: true, updatedAt: now() });
    audit(db, { actorId: ctx.user.id, action: 'floorplan.publish', entityType: 'Floor', entityId: floor.id, after: { version: plan.version, warnings } });
    return { ok: true, version: plan.version, publishedAt: plan.publishedAt, warnings };
  }),

  post('/admin/floors/:id/plan/unpublish', (ctx) => {
    requirePermission(ctx, 'floorplan:manage');
    const { db } = ctx;
    const floor = db.floors.find((f) => f.id === ctx.params.id);
    const plan = floor && db.floorPlans.find((p) => p.floorId === floor.id);
    if (!floor || !plan) throw DemoError.notFound('Floor plan');
    plan.status = 'DRAFT';
    Object.assign(floor, { isPublished: false, updatedAt: now() });
    audit(db, { actorId: ctx.user.id, action: 'floorplan.unpublish', entityType: 'Floor', entityId: floor.id });
    return { ok: true };
  }),

  // ---------------- Zones ----------------
  get('/admin/floors/:id/zones', (ctx) => {
    requirePermission(ctx, 'resource:manage');
    return ctx.db.zones
      .filter((z) => z.floorId === ctx.params.id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(toZoneDto);
  }),

  post('/admin/floors/:id/zones', (ctx) => {
    requirePermission(ctx, 'resource:manage');
    const { db } = ctx;
    const input = zoneCreateSchema.parse(ctx.body);
    const floor = db.floors.find((f) => f.id === ctx.params.id);
    if (!floor) throw DemoError.notFound('Floor');
    if (db.zones.some((z) => z.floorId === floor.id && z.name === input.name)) throw DemoError.conflict('A record with the same unique value already exists', { fields: ['floorId', 'name'] });
    const row = { id: uuid(), floorId: floor.id, name: input.name, kind: input.kind, color: input.color ?? null };
    db.zones.push(row);
    audit(db, { actorId: ctx.user.id, action: 'zone.create', entityType: 'Zone', entityId: row.id, after: row });
    return new Reply(201, toZoneDto(row));
  }),

  patch('/admin/zones/:id', (ctx) => {
    requirePermission(ctx, 'resource:manage');
    const { db } = ctx;
    const input = patchOf(zoneUpdateSchema, ctx.body);
    const row = db.zones.find((z) => z.id === ctx.params.id);
    if (!row) throw DemoError.notFound('Zone');
    if (input.name && db.zones.some((z) => z.id !== row.id && z.floorId === row.floorId && z.name === input.name)) throw DemoError.conflict('A record with the same unique value already exists', { fields: ['floorId', 'name'] });
    const before = { ...row };
    Object.assign(row, input);
    audit(db, { actorId: ctx.user.id, action: 'zone.update', entityType: 'Zone', entityId: row.id, before, after: row });
    return toZoneDto(row);
  }),

  del('/admin/zones/:id', (ctx) => {
    requirePermission(ctx, 'resource:manage');
    const { db } = ctx;
    const existing = db.zones.find((z) => z.id === ctx.params.id);
    if (existing) {
      db.zones = db.zones.filter((z) => z.id !== existing.id);
      for (const r of db.resources) if (r.zoneId === existing.id) r.zoneId = null;
      audit(db, { actorId: ctx.user.id, action: 'zone.delete', entityType: 'Zone', entityId: existing.id, before: existing });
    }
    return new Reply(204);
  }),

  // ---------------- Amenities ----------------
  post('/admin/amenities', (ctx) => {
    requirePermission(ctx, 'resource:manage');
    const { db } = ctx;
    const input = amenityCreateSchema.parse(ctx.body);
    if (db.amenities.some((a) => a.code === input.code)) throw DemoError.conflict('A record with the same unique value already exists', { fields: ['code'] });
    const row = { id: uuid(), code: input.code, name: input.name, category: input.category, icon: input.icon ?? null };
    db.amenities.push(row);
    return new Reply(201, { ...row });
  }),

  patch('/admin/amenities/:id', (ctx) => {
    requirePermission(ctx, 'resource:manage');
    const { db } = ctx;
    const input = patchOf(amenityUpdateSchema, ctx.body);
    const row = db.amenities.find((a) => a.id === ctx.params.id);
    if (!row) throw DemoError.notFound('Amenity');
    if (input.code && db.amenities.some((a) => a.id !== row.id && a.code === input.code)) throw DemoError.conflict('A record with the same unique value already exists', { fields: ['code'] });
    Object.assign(row, input);
    return { ...row };
  }),

  del('/admin/amenities/:id', (ctx) => {
    requirePermission(ctx, 'resource:manage');
    const { db } = ctx;
    const id = ctx.params.id;
    db.amenities = db.amenities.filter((a) => a.id !== id);
    for (const r of db.resources) if (r.amenityIds.includes(id)) r.amenityIds = r.amenityIds.filter((x) => x !== id);
    return new Reply(204);
  }),

  // ---------------- Announcements ----------------
  get('/admin/announcements', (ctx) => {
    requirePermission(ctx, 'building:manage');
    return [...ctx.db.announcements]
      .sort((a, b) => ms(b.publishedAt) - ms(a.publishedAt))
      .slice(0, 100)
      .map(toAnnouncementDto);
  }),

  post('/admin/announcements', (ctx) => {
    requirePermission(ctx, 'building:manage');
    const { db } = ctx;
    const input = announcementSchema.parse(ctx.body);
    if (input.buildingId && !db.buildings.some((b) => b.id === input.buildingId)) throw DemoError.badRequest('Building not found');
    const row = { id: uuid(), title: input.title, body: input.body, buildingId: input.buildingId ?? null, publishedAt: now(), expiresAt: input.expiresAt ? iso(ms(input.expiresAt)) : null };
    db.announcements.push(row);
    audit(db, { actorId: ctx.user.id, action: 'announcement.create', entityType: 'Announcement', entityId: row.id, after: row });
    return new Reply(201, toAnnouncementDto(row));
  }),

  del('/admin/announcements/:id', (ctx) => {
    requirePermission(ctx, 'building:manage');
    const { db } = ctx;
    const existing = db.announcements.find((a) => a.id === ctx.params.id);
    if (existing) {
      db.announcements = db.announcements.filter((a) => a.id !== existing.id);
      audit(db, { actorId: ctx.user.id, action: 'announcement.delete', entityType: 'Announcement', entityId: existing.id, before: existing });
    }
    return new Reply(204);
  }),

  // ---------------- CSV import / export ----------------
  get('/admin/buildings/:id/import/template', (ctx) => {
    requirePermission(ctx, 'resource:manage');
    return csv(ctx.query.type === 'rooms' ? ROOM_TEMPLATE : SEAT_TEMPLATE);
  }),

  post('/admin/buildings/:id/import', async (ctx) => {
    requirePermission(ctx, 'resource:manage');
    const { db } = ctx;
    const form = formOf(ctx);
    const type = form.get('type') === 'rooms' ? 'MEETING_ROOM' : 'SEAT';
    const dryRun = form.get('dryRun') === 'true';
    const file = form.get('file');
    if (!(file instanceof Blob)) throw DemoError.badRequest('A CSV file is required (multipart field "file")');
    if (file.size > 5 * 1024 * 1024) throw new DemoError(413, 'FILE_TOO_LARGE', 'File too large');
    const building = findBuilding(db, ctx.params.id);
    if (!building) throw DemoError.notFound('Building');
    const floors = db.floors.filter((f) => f.buildingId === building.id && !f.deletedAt);
    const amenityByCode = new Map(db.amenities.map((a) => [a.code.toLowerCase(), a.id]));
    const rows = parseCsv(await file.text());
    if (!rows.length) throw DemoError.badRequest('The CSV file has no data rows');
    if (rows.length > 2000) throw DemoError.badRequest('At most 2000 rows per import');

    type RowData = Pick<DbResource, 'buildingId' | 'floorId' | 'zoneId' | 'type' | 'code' | 'name' | 'seatType' | 'roomType' | 'capacity' | 'accessible' | 'requiresApproval' | 'searchText'> & { seatAttributes?: DbResource['seatAttributes'] };
    const errors: { row: number; message: string }[] = [];
    const prepared: { row: number; data: RowData; amenityIds: string[]; x?: number; y?: number; width?: number; depth?: number }[] = [];
    const seenCodes = new Set<string>();
    rows.forEach((raw, i) => {
      const rowNo = i + 2;
      const parsed = type === 'SEAT' ? seatCsvRowSchema.safeParse(raw) : roomCsvRowSchema.safeParse(raw);
      if (!parsed.success) {
        errors.push({ row: rowNo, message: parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ') });
        return;
      }
      const r = parsed.data as SeatCsvRow & ReturnType<typeof roomCsvRowSchema.parse>;
      const floor = floors.find((f) => f.number === r.floorNumber);
      if (!floor) return void errors.push({ row: rowNo, message: `Floor ${r.floorNumber} does not exist in ${building.name}` });
      if (seenCodes.has(r.code.toLowerCase())) return void errors.push({ row: rowNo, message: `Duplicate code ${r.code} in file` });
      seenCodes.add(r.code.toLowerCase());
      const zone = r.zone ? db.zones.find((zn) => zn.floorId === floor.id && zn.name.toLowerCase() === r.zone!.toLowerCase()) : null;
      if (r.zone && !zone) return void errors.push({ row: rowNo, message: `Zone "${r.zone}" not found on floor ${floor.name}` });
      const amenityIds: string[] = [];
      for (const code of (r.amenities ?? '').split(/[;|]/).map((s) => s.trim().toLowerCase()).filter(Boolean)) {
        const aid = amenityByCode.get(code);
        if (!aid) return void errors.push({ row: rowNo, message: `Unknown amenity "${code}"` });
        amenityIds.push(aid);
      }
      const roomType = (r.roomType ?? '').toUpperCase() as RoomType;
      prepared.push({
        row: rowNo,
        data: {
          buildingId: building.id, floorId: floor.id, zoneId: zone?.id ?? null, type, code: r.code, name: r.name,
          seatType: type === 'SEAT' ? (r.seatType ?? 'WORKSTATION') : null,
          roomType: type === 'MEETING_ROOM' ? (RoomTypes.includes(roomType) ? roomType : 'MEETING') : null,
          capacity: type === 'MEETING_ROOM' ? r.capacity : null,
          accessible: !!r.accessible,
          requiresApproval: type === 'MEETING_ROOM' ? !!r.requiresApproval : false,
          ...(type === 'SEAT' ? { seatAttributes: { nearWindow: r.nearWindow, nearElevator: r.nearElevator, monitor: r.monitor, dockingStation: r.dockingStation, heightAdjustable: r.heightAdjustable, accessible: r.accessible, quietZone: r.quietZone } } : {}),
          searchText: buildSearchText([r.code, r.name, floor.name, building.name]),
        },
        amenityIds,
        x: r.x, y: r.y, width: r.width, depth: r.depth,
      });
    });

    if (dryRun || errors.length) return new Reply(errors.length ? 422 : 200, { dryRun, valid: prepared.length, errors, created: 0, updated: 0 });

    let created = 0;
    let updated = 0;
    for (const p of prepared) {
      let saved = db.resources.find((x) => x.buildingId === building.id && x.code === p.data.code && !x.deletedAt);
      if (saved) {
        Object.assign(saved, p.data, { amenityIds: p.amenityIds, updatedAt: now() });
        updated++;
      } else {
        saved = { ...p.data, id: uuid(), description: null, status: 'ACTIVE', isBookable: true, seatAttributes: p.data.seatAttributes ?? null, amenityIds: p.amenityIds, operatingHours: null, maxDurationMinutes: null, checkInRequired: null, restrictedDepartmentIds: [], restrictedTeamIds: [], createdAt: now(), updatedAt: now(), deletedAt: null };
        db.resources.push(saved);
        created++;
      }
      // Optional map placement: upsert a map object when coordinates are supplied and a plan exists.
      if (p.x !== undefined && p.y !== undefined) {
        const plan = db.floorPlans.find((fp) => fp.floorId === p.data.floorId);
        if (plan) {
          const width = p.width ?? (type === 'SEAT' ? 1.6 : 5);
          const depth = p.depth ?? (type === 'SEAT' ? 0.8 : 4);
          const existingObj = mapObjectFor(db, saved.id);
          if (existingObj) Object.assign(existingObj, { x: p.x, y: p.y, width, depth });
          else db.mapObjects.push({ id: uuid(), floorPlanId: plan.id, kind: type === 'SEAT' ? 'DESK' : 'MEETING_ROOM', label: p.data.code, x: p.x, y: p.y, width, depth, rotation: 0, height: null, resourceId: saved.id, meta: null });
        }
      }
    }
    audit(db, { actorId: ctx.user.id, action: 'resource.import', entityType: 'Building', entityId: building.id, after: { type, created, updated } });
    return { dryRun: false, valid: prepared.length, errors: [], created, updated };
  }),

  get('/admin/buildings/:id/export', (ctx) => {
    requirePermission(ctx, 'resource:manage');
    const { db } = ctx;
    const type = ctx.query.type === 'rooms' ? 'MEETING_ROOM' : 'SEAT';
    const rows = db.resources.filter((r) => r.buildingId === ctx.params.id && r.type === type && !r.deletedAt).sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    const amenityCodes = (r: DbResource) => r.amenityIds.map((id) => db.amenities.find((a) => a.id === id)?.code).filter(Boolean).join(';');
    const floorNo = (r: DbResource) => db.floors.find((f) => f.id === r.floorId)?.number;
    const lines: string[] = [];
    if (type === 'SEAT') {
      lines.push('code,name,floorNumber,zone,seatType,x,y,nearWindow,nearElevator,monitor,dockingStation,heightAdjustable,accessible,quietZone,amenities,status');
      for (const r of rows) {
        const a = r.seatAttributes ?? {};
        const mo = mapObjectFor(db, r.id);
        const zone = db.zones.find((z) => z.id === r.zoneId);
        lines.push([r.code, r.name, floorNo(r), zone?.name, r.seatType, mo?.x, mo?.y, !!a.nearWindow, !!a.nearElevator, !!a.monitor, !!a.dockingStation, !!a.heightAdjustable, !!a.accessible, !!a.quietZone, amenityCodes(r), r.status].map(esc).join(','));
      }
    } else {
      lines.push('code,name,floorNumber,capacity,roomType,x,y,width,depth,requiresApproval,accessible,amenities,status');
      for (const r of rows) {
        const mo = mapObjectFor(db, r.id);
        lines.push([r.code, r.name, floorNo(r), r.capacity, r.roomType, mo?.x, mo?.y, mo?.width, mo?.depth, r.requiresApproval, r.accessible, amenityCodes(r), r.status].map(esc).join(','));
      }
    }
    return csv(lines.join('\n'));
  }),

  // ---------------- Assets ----------------
  get('/assets', (ctx) => {
    requirePermission(ctx, 'floorplan:manage');
    return [...ctx.db.assets]
      .sort((a, b) => ms(b.createdAt) - ms(a.createdAt))
      .slice(0, 200)
      .map(toAssetDto);
  }),

  post('/assets', async (ctx) => {
    requirePermission(ctx, 'floorplan:manage');
    const { db } = ctx;
    const form = formOf(ctx);
    const kind = form.get('kind');
    if (kind !== 'BUILDING_MODEL' && kind !== 'FLOOR_MODEL' && kind !== 'FLOOR_PLAN_IMAGE') throw DemoError.badRequest('kind must be BUILDING_MODEL, FLOOR_MODEL or FLOOR_PLAN_IMAGE');
    const file = form.get('file');
    if (!(file instanceof File)) throw DemoError.badRequest('A file is required (multipart field "file")');
    const dot = file.name.lastIndexOf('.');
    const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : '';
    const exts = ALLOWED_EXTS[kind];
    if (!exts.includes(ext)) throw new DemoError(415, 'UNSUPPORTED_FILE', `Unsupported file type ${ext || '(none)'}. Allowed: ${exts.join(', ')}`);
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) throw new DemoError(413, 'FILE_TOO_LARGE', `File exceeds the ${MAX_UPLOAD_MB} MB limit`);
    if (file.size === 0) throw DemoError.badRequest('Uploaded file is empty');
    const mimeType = await sniff(file, ext);
    if (!mimeType) throw new DemoError(415, 'UNSUPPORTED_FILE', 'The file content does not match its extension or contains disallowed content.');
    const row: DbAsset = { id: uuid(), kind, fileName: file.name.replace(/[^\w.\- ]/g, '_').slice(0, 120), mimeType, sizeBytes: file.size, createdAt: now() };
    assetFiles.set(row.id, file.slice(0, file.size, mimeType));
    db.assets.push(row);
    const dto = toAssetDto(row);
    audit(db, { actorId: ctx.user.id, action: 'asset.upload', entityType: 'Asset', entityId: row.id, after: dto });
    return new Reply(201, dto);
  }),

  get('/assets/:id/file', (ctx) => {
    const asset = ctx.db.assets.find((a) => a.id === ctx.params.id);
    if (!asset) throw DemoError.notFound('Asset');
    const blob = assetFiles.get(asset.id);
    if (!blob) throw new DemoError(404, 'NOT_FOUND', 'Asset file not found. Demo uploads are kept in memory only and are lost when the page reloads.');
    return new Reply(200, blob, asset.mimeType);
  }),

  del('/assets/:id', (ctx) => {
    requirePermission(ctx, 'floorplan:manage');
    const { db } = ctx;
    const id = ctx.params.id;
    if (!db.assets.some((a) => a.id === id)) throw DemoError.notFound('Asset');
    db.assets = db.assets.filter((a) => a.id !== id);
    dropAssetFile(id);
    // FK onDelete: SetNull
    for (const b of db.buildings) if (b.modelAssetId === id) b.modelAssetId = null;
    for (const p of db.floorPlans) {
      if (p.imageAssetId === id) p.imageAssetId = null;
      if (p.modelAssetId === id) p.modelAssetId = null;
    }
    audit(db, { actorId: ctx.user.id, action: 'asset.delete', entityType: 'Asset', entityId: id });
    return new Reply(204);
  }),

  // ---------------- People ----------------
  get('/admin/users', (ctx) => {
    requirePermission(ctx, 'user:manage');
    const { db } = ctx;
    const q = userListQuerySchema.parse(ctx.query);
    const rows = db.users
      .filter((u) => !u.deletedAt && (!q.departmentId || u.departmentId === q.departmentId) && (!q.teamId || u.teamId === q.teamId) && (!q.status || u.status === q.status) && (!q.role || u.roles.includes(q.role)))
      .filter((u) => !q.q || contains(u.firstName, q.q) || contains(u.lastName, q.q) || contains(u.email, q.q))
      .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
    return paginate(rows.map((u) => toAdminUserDto(db, u)), q.page, q.pageSize);
  }),

  post('/admin/users', (ctx) => {
    requirePermission(ctx, 'user:manage');
    const { db } = ctx;
    const input = userCreateSchema.parse(ctx.body);
    assertCanAssignRoles(ctx, input.roles);
    assertOrgRefs(db, input);
    const email = input.email.toLowerCase();
    if (db.users.some((u) => u.email === email)) throw DemoError.conflict('An account with this email already exists.');
    // Passwords are not stored in the demo; a password just makes the account active immediately.
    const row: DbUser = { id: uuid(), email, firstName: input.firstName, lastName: input.lastName, avatarUrl: null, jobTitle: input.jobTitle ?? null, phone: null, departmentId: input.departmentId ?? null, teamId: input.teamId ?? null, homeBuildingId: input.homeBuildingId ?? null, status: input.password ? 'ACTIVE' : 'INVITED', roles: [...new Set(input.roles)], preferences: { ...DEFAULT_PREFERENCES }, lastLoginAt: null, createdAt: now(), deletedAt: null };
    db.users.push(row);
    audit(db, { actorId: ctx.user.id, action: 'user.create', entityType: 'User', entityId: row.id, after: { email, roles: row.roles, status: row.status } });
    return new Reply(201, toAdminUserDto(db, row, { inviteUrl: input.password ? null : inviteUrl() }));
  }),

  get('/admin/users/:id', (ctx) => {
    requirePermission(ctx, 'user:manage');
    const row = findUser(ctx.db, ctx.params.id);
    if (!row) throw DemoError.notFound('Employee');
    return toAdminUserDto(ctx.db, row);
  }),

  patch('/admin/users/:id', (ctx) => {
    requirePermission(ctx, 'user:manage');
    const { db } = ctx;
    const id = ctx.params.id;
    const input = patchOf(userUpdateSchema, ctx.body);
    const row = findUser(db, id);
    if (!row) throw DemoError.notFound('Employee');
    if (input.roles) {
      assertCanAssignRoles(ctx, input.roles);
      if (row.roles.includes('ORG_ADMIN') && !input.roles.includes('ORG_ADMIN')) {
        const remaining = db.users.filter((u) => u.id !== id && u.status === 'ACTIVE' && !u.deletedAt && u.roles.includes('ORG_ADMIN')).length;
        if (remaining === 0) throw DemoError.policy('At least one active organization administrator is required.');
      }
    }
    if (input.status === 'DEACTIVATED' && id === ctx.user.id) throw DemoError.policy('You cannot deactivate your own account.');
    assertOrgRefs(db, input);
    const email = input.email?.toLowerCase();
    if (email && db.users.some((u) => u.id !== id && u.email === email)) throw DemoError.conflict('A record with the same unique value already exists', { fields: ['email'] });
    const before = { status: row.status, roles: row.roles };
    const set = <K extends keyof DbUser>(k: K, v: DbUser[K] | undefined) => {
      if (v !== undefined) row[k] = v;
    };
    set('email', email);
    set('firstName', input.firstName);
    set('lastName', input.lastName);
    set('jobTitle', input.jobTitle);
    set('departmentId', input.departmentId);
    set('teamId', input.teamId);
    set('homeBuildingId', input.homeBuildingId);
    set('status', input.status);
    if (input.roles) row.roles = [...new Set(input.roles)];
    audit(db, { actorId: ctx.user.id, action: 'user.update', entityType: 'User', entityId: id, before, after: { status: row.status, roles: input.roles ?? undefined, ...input } });
    if (input.status === 'DEACTIVATED') cancelFutureBookings(db, id, ctx.user.id, 'Account deactivated');
    return toAdminUserDto(db, row);
  }),

  post('/admin/users/:id/invite', (ctx) => {
    requirePermission(ctx, 'user:manage');
    const { db } = ctx;
    const user = findUser(db, ctx.params.id);
    if (!user) throw DemoError.notFound('Employee');
    if (user.status === 'DEACTIVATED') throw DemoError.policy('Reactivate the account before inviting.');
    audit(db, { actorId: ctx.user.id, action: 'user.invite', entityType: 'User', entityId: user.id });
    return { ok: true, inviteUrl: inviteUrl() };
  }),

  get('/admin/users/:id/reservations', (ctx) => {
    requirePermission(ctx, 'user:manage');
    requirePermission(ctx, 'reservation:manage-any');
    const q = { ...reservationListQuerySchema.parse(ctx.query), userId: ctx.params.id };
    return listReservations(ctx.db, ctx.user, q, { ownOnly: false });
  }),

  del('/admin/users/:id', (ctx) => {
    requirePermission(ctx, 'user:manage');
    const { db } = ctx;
    const id = ctx.params.id;
    if (id === ctx.user.id) throw DemoError.policy('You cannot delete your own account.');
    const user = findUser(db, id);
    if (!user) throw DemoError.notFound('Employee');
    const email = user.email;
    Object.assign(user, { deletedAt: now(), status: 'DEACTIVATED', email: `${email}~deleted-${Date.now()}` });
    cancelFutureBookings(db, id, ctx.user.id, 'Account removed');
    audit(db, { actorId: ctx.user.id, action: 'user.delete', entityType: 'User', entityId: id, before: { email } });
    return new Reply(204);
  }),

  // ---------------- Departments & teams ----------------
  get('/admin/departments', (ctx) => {
    requirePermission(ctx, 'user:read');
    return departmentDtos(ctx.db);
  }),

  post('/admin/departments', (ctx) => {
    requirePermission(ctx, 'user:manage');
    const { db } = ctx;
    const { name } = departmentSchema.parse(ctx.body);
    if (db.departments.some((d) => d.name === name)) throw DemoError.conflict('A record with the same unique value already exists', { fields: ['name'] });
    const row = { id: uuid(), name };
    db.departments.push(row);
    return new Reply(201, { id: row.id, name: row.name, teams: [], memberCount: 0 });
  }),

  patch('/admin/departments/:id', (ctx) => {
    requirePermission(ctx, 'user:manage');
    const { db } = ctx;
    const { name } = departmentSchema.parse(ctx.body);
    const row = db.departments.find((d) => d.id === ctx.params.id);
    if (!row) throw DemoError.notFound('Department');
    if (db.departments.some((d) => d.id !== row.id && d.name === name)) throw DemoError.conflict('A record with the same unique value already exists', { fields: ['name'] });
    row.name = name;
    return departmentDtos(db).find((d) => d.id === row.id);
  }),

  del('/admin/departments/:id', (ctx) => {
    requirePermission(ctx, 'user:manage');
    const { db } = ctx;
    const id = ctx.params.id;
    // Teams cascade; members of the department and its teams are unassigned.
    const teamIds = new Set(db.teams.filter((t) => t.departmentId === id).map((t) => t.id));
    db.departments = db.departments.filter((d) => d.id !== id);
    db.teams = db.teams.filter((t) => t.departmentId !== id);
    for (const u of db.users) {
      if (u.departmentId === id) u.departmentId = null;
      if (u.teamId && teamIds.has(u.teamId)) u.teamId = null;
    }
    return new Reply(204);
  }),

  post('/admin/teams', (ctx) => {
    requirePermission(ctx, 'user:manage');
    const { db } = ctx;
    const input = teamSchema.parse(ctx.body);
    if (!db.departments.some((d) => d.id === input.departmentId)) throw DemoError.badRequest('Department not found');
    if (db.teams.some((t) => t.departmentId === input.departmentId && t.name === input.name)) throw DemoError.conflict('A record with the same unique value already exists', { fields: ['departmentId', 'name'] });
    const row = { id: uuid(), departmentId: input.departmentId, name: input.name };
    db.teams.push(row);
    return new Reply(201, { id: row.id, name: row.name, departmentId: row.departmentId, memberCount: 0 });
  }),

  patch('/admin/teams/:id', (ctx) => {
    requirePermission(ctx, 'user:manage');
    const { db } = ctx;
    const input = patchOf(teamSchema.partial(), ctx.body);
    const row = db.teams.find((t) => t.id === ctx.params.id);
    if (!row) throw DemoError.notFound('Team');
    if (input.departmentId && !db.departments.some((d) => d.id === input.departmentId)) throw DemoError.badRequest('Department not found');
    const next = { ...row, ...input };
    if (db.teams.some((t) => t.id !== row.id && t.departmentId === next.departmentId && t.name === next.name)) throw DemoError.conflict('A record with the same unique value already exists', { fields: ['departmentId', 'name'] });
    Object.assign(row, input);
    return { id: row.id, name: row.name, departmentId: row.departmentId };
  }),

  del('/admin/teams/:id', (ctx) => {
    requirePermission(ctx, 'user:manage');
    const { db } = ctx;
    const id = ctx.params.id;
    db.teams = db.teams.filter((t) => t.id !== id);
    for (const u of db.users) if (u.teamId === id) u.teamId = null;
    return new Reply(204);
  }),

  // ---------------- Policies ----------------
  get('/admin/policies', (ctx) => {
    requirePermission(ctx, 'policy:manage');
    const { db } = ctx;
    return [...db.policies]
      .sort((a, b) => cmpNullsLast(a.buildingId, b.buildingId) || cmpNullsLast(a.resourceType, b.resourceType) || a.name.localeCompare(b.name))
      .map((p) => toPolicyDto(db, p));
  }),

  get('/admin/policies/effective', (ctx) => {
    requirePermission(ctx, 'policy:manage');
    const type = ctx.query.resourceType === 'MEETING_ROOM' ? 'MEETING_ROOM' : 'SEAT';
    const p = resolvePolicy(ctx.db, ctx.query.buildingId ?? '', type);
    return { ...toPolicyDto(ctx.db, p), buildingName: null };
  }),

  post('/admin/policies', (ctx) => {
    requirePermission(ctx, 'policy:manage');
    const { db } = ctx;
    const input = policySchema.parse(ctx.body);
    validatePolicy(input);
    if (input.buildingId && !db.buildings.some((b) => b.id === input.buildingId)) throw DemoError.badRequest('Building not found');
    const row: DbPolicy = { ...input, id: uuid(), buildingId: input.buildingId ?? null, resourceType: input.resourceType ?? null, createdAt: now(), updatedAt: now() };
    db.policies.push(row);
    audit(db, { actorId: ctx.user.id, action: 'policy.create', entityType: 'BookingPolicy', entityId: row.id, after: row });
    return new Reply(201, toPolicyDto(db, row));
  }),

  patch('/admin/policies/:id', (ctx) => {
    requirePermission(ctx, 'policy:manage');
    const { db } = ctx;
    const input = patchOf(policyUpdateSchema, ctx.body);
    const row = db.policies.find((p) => p.id === ctx.params.id);
    if (!row) throw DemoError.notFound('Policy');
    validatePolicy({ ...row, ...input } as PolicyInput);
    if (input.buildingId && !db.buildings.some((b) => b.id === input.buildingId)) throw DemoError.badRequest('Building not found');
    const before = { ...row };
    Object.assign(row, input, { updatedAt: now() });
    audit(db, { actorId: ctx.user.id, action: 'policy.update', entityType: 'BookingPolicy', entityId: row.id, before, after: row });
    return toPolicyDto(db, row);
  }),

  del('/admin/policies/:id', (ctx) => {
    requirePermission(ctx, 'policy:manage');
    const { db } = ctx;
    const before = db.policies.find((p) => p.id === ctx.params.id);
    if (!before) throw DemoError.notFound('Policy');
    db.policies = db.policies.filter((p) => p.id !== before.id);
    audit(db, { actorId: ctx.user.id, action: 'policy.delete', entityType: 'BookingPolicy', entityId: before.id, before });
    return new Reply(204);
  }),

  // ---------------- Reservation administration ----------------
  // Literal segments (/conflicts, /export) before /:id routes.
  get('/admin/reservations/conflicts', (ctx) => {
    requirePermission(ctx, 'reservation:manage-any');
    const { db } = ctx;
    const resourceId = ctx.query.resourceId ?? '';
    const from = ctx.query.from ? ms(ctx.query.from) : Date.now();
    const to = ctx.query.to ? ms(ctx.query.to) : from + 7 * 86400000;
    if (!resourceId) throw DemoError.badRequest('resourceId is required');
    if (Number.isNaN(from) || Number.isNaN(to)) throw DemoError.badRequest('from / to must be ISO date-times');
    const rows = db.reservations.filter((r) => r.resourceId === resourceId && ms(r.startAt) < to && ms(r.endAt) > from).sort((a, b) => ms(a.startAt) - ms(b.startAt));
    const ids = new Set(rows.map((r) => r.id));
    const audits = db.audit.filter((a) => a.entityType === 'Reservation' && ids.has(a.entityId)).sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
    const owner = (r: DbReservation) => db.users.find((u) => u.id === r.userId);
    return {
      reservations: rows.map((r) => {
        const u = owner(r);
        return { id: r.id, status: r.status, startAt: r.startAt, endAt: r.endAt, user: u ? `${u.firstName} ${u.lastName}` : 'Former colleague', email: u?.email ?? '', createdAt: r.createdAt };
      }),
      audit: audits.map((a) => ({ id: a.id, action: a.action, entityId: a.entityId, createdAt: a.createdAt, after: a.after })),
    };
  }),

  get('/admin/reservations/export', (ctx) => {
    requirePermission(ctx, 'reservation:manage-any');
    const { db } = ctx;
    const q: ReservationListQuery = { ...reservationListQuerySchema.parse(ctx.query), page: 1, pageSize: 200 };
    const first = listReservations(db, ctx.user, q, { ownOnly: false });
    const items = [...first.items];
    for (let p = 2; p <= Math.min(first.totalPages, 25); p++) items.push(...listReservations(db, ctx.user, { ...q, page: p }, { ownOnly: false }).items);
    const lines = ['id,type,status,resource,code,building,floor,user,startAt,endAt,timezone,checkedInAt,cancelledAt,cancelReason'];
    for (const r of items) lines.push([r.id, r.type, r.status, r.resourceName, r.resourceCode, r.buildingName, r.floorName, r.userDisplayName, r.startAt, r.endAt, r.timezone, r.checkedInAt, r.cancelledAt, r.cancelReason].map(esc).join(','));
    audit(db, { actorId: ctx.user.id, action: 'reservation.export', entityType: 'Reservation', entityId: `${items.length} rows` });
    return csv(lines.join('\n'));
  }),

  get('/admin/reservations', (ctx) => {
    requirePermission(ctx, 'reservation:manage-any');
    return listReservations(ctx.db, ctx.user, reservationListQuerySchema.parse(ctx.query), { ownOnly: false });
  }),

  post('/admin/reservations/:id/cancel', (ctx) => {
    requirePermission(ctx, 'reservation:manage-any');
    return cancelReservation(ctx.db, ctx.user, ctx.params.id, adminCancelSchema.parse(ctx.body), { admin: true });
  }),

  get('/admin/reservations/:id/check-ins', (ctx) => {
    requirePermission(ctx, 'reservation:manage-any');
    const { db } = ctx;
    return db.checkIns
      .filter((c) => c.reservationId === ctx.params.id)
      .sort((a, b) => ms(a.at) - ms(b.at))
      .map((c) => {
        const u = db.users.find((x) => x.id === c.userId);
        return { id: c.id, kind: c.kind, method: c.method, at: c.at, by: u ? `${u.firstName} ${u.lastName}` : null };
      });
  }),

  // ---------------- Analytics ----------------
  get('/admin/analytics/overview', (ctx) => {
    requirePermission(ctx, 'analytics:read');
    return analyticsOverview(ctx);
  }),

  // ---------------- Audit log ----------------
  get('/admin/audit', (ctx) => {
    requirePermission(ctx, 'audit:read');
    const { db } = ctx;
    const q = auditQuerySchema.parse(ctx.query);
    const fromMs = q.from ? ms(q.from) : null;
    const toMs = q.to ? ms(q.to) : null;
    const rows = db.audit
      .filter((r) => (!q.entityType || r.entityType === q.entityType) && (!q.entityId || r.entityId === q.entityId) && (!q.actorId || r.actorId === q.actorId) && (!q.action || r.action.startsWith(q.action)))
      .filter((r) => (fromMs === null || ms(r.createdAt) >= fromMs) && (toMs === null || ms(r.createdAt) <= toMs))
      .sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
    const items: AuditLogDto[] = rows.map((r) => {
      const actor = r.actorId ? db.users.find((u) => u.id === r.actorId) : undefined;
      return { id: r.id, actorId: r.actorId, actorName: actor ? `${actor.firstName} ${actor.lastName}` : null, action: r.action, entityType: r.entityType, entityId: r.entityId, before: r.before, after: r.after, ip: r.ip, createdAt: r.createdAt };
    });
    return paginate(items, q.page, q.pageSize);
  }),

  // ---------------- Integrations + organisation settings ----------------
  get('/admin/integrations', (ctx) => {
    requirePermission(ctx, 'integration:manage');
    return listIntegrations(ctx.db);
  }),

  put('/admin/integrations', (ctx) => {
    requirePermission(ctx, 'integration:manage');
    const { db } = ctx;
    const input = integrationUpdateSchema.parse(ctx.body);
    const meta = PROVIDERS.find((m) => m.provider === input.provider)!;
    if (input.isEnabled && !meta.configured) {
      throw new DemoError(501, 'INTEGRATION_NOT_CONFIGURED', `${input.provider} integration is not available in the demo. Connect a SpaceFlow backend and set ${meta.requiredEnv.join(', ')} to enable it.`, { provider: input.provider, requiredEnv: meta.requiredEnv });
    }
    // Never persist secrets; config holds only non-sensitive options.
    const config = Object.fromEntries(Object.entries(input.config).filter(([k]) => !/secret|password|token|key/i.test(k)));
    const status = input.isEnabled ? 'READY' : 'DISABLED';
    const row = db.integrations.find((r) => r.provider === input.provider);
    if (row) Object.assign(row, { isEnabled: input.isEnabled, config, status, lastError: null });
    else db.integrations.push({ provider: input.provider, isEnabled: input.isEnabled, config, status, lastError: null, lastSyncedAt: null });
    audit(db, { actorId: ctx.user.id, action: 'integration.update', entityType: 'IntegrationConfig', entityId: input.provider, after: { isEnabled: input.isEnabled, config } });
    return listIntegrations(db);
  }),

  get('/admin/settings', (ctx) => {
    requirePermission(ctx, 'settings:manage');
    return orgDto(ctx.db);
  }),

  patch('/admin/settings', (ctx) => {
    requirePermission(ctx, 'settings:manage');
    const { db } = ctx;
    const input = orgSettingsSchema.parse(ctx.body);
    if (input.timezone && !isValidTimezone(input.timezone)) throw DemoError.badRequest('Unknown timezone');
    const before = { name: db.org.name, timezone: db.org.timezone, settings: db.org.settings };
    if (input.name !== undefined) db.org.name = input.name;
    if (input.timezone !== undefined) db.org.timezone = input.timezone;
    if (input.settings) db.org.settings = { ...db.org.settings, ...input.settings };
    audit(db, { actorId: ctx.user.id, action: 'settings.update', entityType: 'Organization', entityId: db.org.id, before, after: { name: db.org.name, timezone: db.org.timezone, settings: db.org.settings } });
    return orgDto(db);
  }),
];
