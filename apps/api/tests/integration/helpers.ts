// Shared helpers for integration tests. Uses the isolated test database (TEST_DATABASE_URL via
// NODE_ENV=test in env.ts) and supertest against the Express app — no server is started.
import supertest from 'supertest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { createDemoOrganization, type DemoResult } from '../../src/lib/demoData.js';
import { hashPassword } from '../../src/utils/crypto.js';
import { dayjs, fromLocal } from '../../src/utils/time.js';

export const app = createApp();
export const api = () => supertest(app);

export const ADMIN = { email: 'admin@spaceflow.local', password: 'Admin123!' };
export const EMPLOYEE = { email: 'employee@spaceflow.local', password: 'Password123!' };
export const WP_ADMIN = { email: 'facilities@spaceflow.local', password: 'Password123!' };
export const APPROVER = { email: 'approver@spaceflow.local', password: 'Password123!' };
export const PASSWORD = 'Password123!';
export const HT_TZ = 'Asia/Kolkata';

let hashes: { admin: string; user: string } | null = null;

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

export async function seedDemo(): Promise<DemoResult> {
  if (!hashes) hashes = { admin: await hashPassword(ADMIN.password), user: await hashPassword(PASSWORD) };
  return createDemoOrganization(prisma, {
    slug: 'northwind',
    name: 'Northwind Digital',
    emailDomain: 'spaceflow.local',
    adminEmail: ADMIN.email,
    adminPasswordHash: hashes.admin,
    userPasswordHash: hashes.user,
  });
}

export async function resetAndSeed() {
  await resetDb();
  return seedDemo();
}

export interface Session {
  token: string;
  cookie: string;
  userId: string;
  orgId: string;
}

export async function login(email: string, password = PASSWORD): Promise<Session> {
  const res = await api().post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  const setCookie = (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  return { token: res.body.accessToken, cookie, userId: res.body.user.id, orgId: res.body.user.orgId };
}

export const auth = (s: Session) => ({ Authorization: `Bearer ${s.token}`, 'X-Requested-With': 'SpaceFlow' });

/** Creates a fresh employee through the admin API so per-user booking limits start from zero. */
export async function createEmployee(admin: Session, suffix: string, extra: Record<string, unknown> = {}): Promise<Session> {
  const email = `test.${suffix}@spaceflow.local`;
  const res = await api().post('/api/v1/admin/users').set(auth(admin)).send({ email, firstName: 'Test', lastName: suffix, roles: ['EMPLOYEE'], password: PASSWORD, ...extra });
  if (res.status !== 201) throw new Error(`createEmployee failed: ${res.status} ${JSON.stringify(res.body)}`);
  return login(email);
}

/**
 * The Nth business day after today (YYYY-MM-DD in `tz`). Counting business days, not calendar
 * days, guarantees distinct offsets give distinct dates; calendar days collapse across weekends
 * (e.g. +2 and +3 from a Friday are both Monday).
 */
export function futureWeekday(businessDaysAhead = 1, tz = HT_TZ): string {
  let d = dayjs().tz(tz);
  let remaining = Math.max(1, businessDaysAhead);
  while (remaining > 0) {
    d = d.add(1, 'day');
    if (d.day() !== 0 && d.day() !== 6) remaining--;
  }
  return d.format('YYYY-MM-DD');
}

export function iso(date: string, time: string, tz = HT_TZ): string {
  return fromLocal(date, time, tz).toISOString();
}

export async function harborTower() {
  const b = await prisma.building.findFirstOrThrow({ where: { code: 'HT' } });
  const floors = await prisma.floor.findMany({ where: { buildingId: b.id }, orderBy: { number: 'asc' } });
  return { building: b, floors };
}

/** Returns a seat on Harbor Tower level 1 that has no active reservations on `date`. */
export async function freeSeat(date: string, exclude: string[] = []) {
  const { floors } = await harborTower();
  const dayStart = fromLocal(date, '00:00', HT_TZ);
  const dayEnd = fromLocal(date, '23:59', HT_TZ);
  const seats = await prisma.resource.findMany({ where: { floorId: floors[1].id, type: 'SEAT', status: 'ACTIVE', restrictedTeamIds: { isEmpty: true }, id: { notIn: exclude } }, orderBy: { code: 'asc' } });
  for (const s of seats) {
    const busy = await prisma.reservation.count({ where: { resourceId: s.id, status: { in: ['PENDING_APPROVAL', 'CONFIRMED', 'CHECKED_IN'] }, startAt: { lt: dayEnd }, endAt: { gt: dayStart } } });
    if (!busy) return s;
  }
  throw new Error('no free seat found');
}

export async function freeRoom(date: string, opts: { requiresApproval?: boolean } = {}) {
  const { floors } = await harborTower();
  const dayStart = fromLocal(date, '00:00', HT_TZ);
  const dayEnd = fromLocal(date, '23:59', HT_TZ);
  const rooms = await prisma.resource.findMany({ where: { buildingId: floors[0].buildingId, type: 'MEETING_ROOM', status: 'ACTIVE', requiresApproval: opts.requiresApproval ?? false }, orderBy: { code: 'asc' } });
  for (const r of rooms) {
    const busy = await prisma.reservation.count({ where: { resourceId: r.id, status: { in: ['PENDING_APPROVAL', 'CONFIRMED', 'CHECKED_IN'] }, startAt: { lt: dayEnd }, endAt: { gt: dayStart } } });
    if (!busy) return r;
  }
  throw new Error('no free room found');
}

/** Creates a seat open 24/7 so check-in tests do not depend on the wall clock. */
export async function alwaysOpenSeat(admin: Session, code: string) {
  const { floors } = await harborTower();
  const hours: Record<string, { open: string; close: string }> = {};
  for (let d = 0; d <= 6; d++) hours[String(d)] = { open: '00:00', close: '23:59' };
  const res = await api().post('/api/v1/seats').set(auth(admin)).send({ code, name: `Desk ${code}`, floorId: floors[1].id, operatingHours: hours, checkInRequired: true });
  if (res.status !== 201) throw new Error(`alwaysOpenSeat failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; code: string; floorId: string; buildingId: string };
}

export { prisma };
