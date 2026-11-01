// Background jobs: reminders, check-in reminders, no-show release, status transitions,
// refresh-token cleanup. Runs in-process on an interval and uses a PostgreSQL advisory lock so
// only one API instance executes a tick at a time. Redis is not required; if you scale beyond a
// handful of instances, swap this for a Redis-backed queue behind the same `runTick` function.
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { resolvePolicy } from '../modules/policies/service.js';
import { notify } from '../modules/notifications/service.js';
import { broadcastToOrg } from '../realtime/sse.js';
import { formatRange } from '../utils/time.js';
import { audit } from '../lib/audit.js';

const LOCK_KEY = 7_361_902; // arbitrary constant for pg_try_advisory_lock
let timer: NodeJS.Timeout | null = null;
let lastRun: { at: Date; ok: boolean } | null = null;

export function jobsStatus(): 'ok' | 'disabled' | 'error' {
  if (!env.JOBS_ENABLED) return 'disabled';
  if (!lastRun) return 'ok';
  return lastRun.ok ? 'ok' : 'error';
}

/** Send a reminder ~60 minutes before a booking starts. */
export async function sendUpcomingReminders(now = new Date()) {
  const windowEnd = new Date(now.getTime() + 60 * 60000);
  const rows = await prisma.reservation.findMany({
    where: { status: 'CONFIRMED', reminderSentAt: null, startAt: { gt: now, lte: windowEnd } },
    include: { resource: { include: { building: true, floor: true } } },
    take: 200,
  });
  for (const r of rows) {
    await prisma.reservation.update({ where: { id: r.id }, data: { reminderSentAt: now } });
    await notify({
      userId: r.userId,
      type: 'BOOKING_REMINDER',
      title: `Upcoming: ${r.resource.name}`,
      body: `${r.resource.building.name}, ${r.resource.floor.name} · ${formatRange(r.startAt, r.endAt, r.timezone)}`,
      data: { reservationId: r.id, resourceId: r.resourceId, floorId: r.resource.floorId },
      email: true,
    });
  }
  return rows.length;
}

/** Remind users to check in once a booking has started and check-in is required. */
export async function sendCheckInReminders(now = new Date()) {
  const rows = await prisma.reservation.findMany({
    where: { status: 'CONFIRMED', checkInReminderSentAt: null, startAt: { lte: now }, endAt: { gt: now } },
    include: { resource: { include: { building: true } } },
    take: 200,
  });
  let sent = 0;
  for (const r of rows) {
    const policy = await resolvePolicy(r.orgId, r.resource.buildingId, r.type);
    const required = r.resource.checkInRequired ?? policy.checkInRequired;
    await prisma.reservation.update({ where: { id: r.id }, data: { checkInReminderSentAt: now } });
    if (!required) continue;
    const deadline = new Date(r.startAt.getTime() + policy.checkInGraceMinutes * 60000);
    await notify({
      userId: r.userId,
      type: policy.autoReleaseEnabled ? 'NO_SHOW_WARNING' : 'CHECKIN_REMINDER',
      title: `Check in to ${r.resource.name}`,
      body: policy.autoReleaseEnabled
        ? `Your booking will be released automatically if you do not check in by ${formatRange(deadline, deadline, r.timezone).split(', ')[1]?.split('–')[0] ?? ''}.`
        : 'Your booking has started. Please check in when you arrive.',
      data: { reservationId: r.id, resourceId: r.resourceId },
    });
    sent++;
  }
  return sent;
}

/** Release bookings whose check-in grace period has elapsed without a check-in. */
export async function releaseNoShows(now = new Date()) {
  const rows = await prisma.reservation.findMany({
    where: { status: 'CONFIRMED', startAt: { lte: now }, endAt: { gt: now } },
    include: { resource: { include: { building: true, floor: true } } },
    take: 500,
  });
  let released = 0;
  for (const r of rows) {
    const policy = await resolvePolicy(r.orgId, r.resource.buildingId, r.type);
    const required = r.resource.checkInRequired ?? policy.checkInRequired;
    if (!required || !policy.autoReleaseEnabled) continue;
    const deadline = new Date(r.startAt.getTime() + policy.checkInGraceMinutes * 60000);
    if (now < deadline) continue;
    await prisma.$transaction(async (tx) => {
      await tx.reservation.update({ where: { id: r.id }, data: { status: 'RELEASED', cancelledAt: now, cancelReason: 'Released automatically: no check-in within the grace period' } });
      await audit({ orgId: r.orgId, actorId: null, action: 'reservation.auto-release', entityType: 'Reservation', entityId: r.id, before: { status: 'CONFIRMED' }, after: { status: 'RELEASED' } }, tx);
    });
    await notify({
      userId: r.userId,
      type: 'BOOKING_RELEASED',
      title: `Booking released: ${r.resource.name}`,
      body: `No check-in was recorded within ${policy.checkInGraceMinutes} minutes of the start time, so the booking was released.`,
      data: { reservationId: r.id, resourceId: r.resourceId, floorId: r.resource.floorId },
      email: true,
    });
    broadcastToOrg(r.orgId, 'availability.changed', { resourceIds: [r.resourceId], floorId: r.resource.floorId, buildingId: r.resource.buildingId, reservationIds: [r.id] });
    released++;
  }
  return released;
}

/** Transition ended bookings: CHECKED_IN -> COMPLETED, CONFIRMED (no check-in needed) -> COMPLETED, otherwise NO_SHOW. */
export async function completeEndedReservations(now = new Date()) {
  const rows = await prisma.reservation.findMany({
    where: { status: { in: ['CONFIRMED', 'CHECKED_IN', 'PENDING_APPROVAL'] }, endAt: { lte: now } },
    include: { resource: { select: { buildingId: true, checkInRequired: true, floorId: true } } },
    take: 500,
  });
  for (const r of rows) {
    let next: 'COMPLETED' | 'NO_SHOW' | 'REJECTED' = 'COMPLETED';
    if (r.status === 'PENDING_APPROVAL') next = 'REJECTED';
    else if (r.status === 'CONFIRMED') {
      const policy = await resolvePolicy(r.orgId, r.resource.buildingId, r.type);
      const required = r.resource.checkInRequired ?? policy.checkInRequired;
      next = required ? 'NO_SHOW' : 'COMPLETED';
    }
    await prisma.reservation.update({ where: { id: r.id }, data: { status: next, ...(next === 'REJECTED' ? { cancelReason: 'Expired before approval' } : {}) } });
    if (next === 'REJECTED') await prisma.approvalRequest.updateMany({ where: { reservationId: r.id, status: 'PENDING' }, data: { status: 'REJECTED', decisionNote: 'Expired', decidedAt: now } });
  }
  return rows.length;
}

export async function cleanupExpiredTokens(now = new Date()) {
  const res = await prisma.refreshToken.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: new Date(now.getTime() - 7 * 86400000) } }] } });
  return res.count;
}

/** Delete guest sandbox organisations older than GUEST_SANDBOX_TTL_HOURS. */
export async function purgeGuestSandboxes(now = new Date()) {
  const { deleteOrganization } = await import('../lib/demoData.js');
  const cutoff = new Date(now.getTime() - env.GUEST_SANDBOX_TTL_HOURS * 3600000);
  const orgs = await prisma.organization.findMany({ where: { slug: { startsWith: 'guest-' }, createdAt: { lt: cutoff } }, select: { id: true, slug: true }, take: 20 });
  for (const o of orgs) {
    try {
      await deleteOrganization(prisma, o.id);
      logger.info({ slug: o.slug }, 'guest sandbox purged');
    } catch (err) {
      logger.error({ err, slug: o.slug }, 'failed to purge guest sandbox');
    }
  }
  return orgs.length;
}

export async function runTick(now = new Date()) {
  const [lock] = await prisma.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(${LOCK_KEY}) AS locked`;
  if (!lock?.locked) return null;
  const run = await prisma.jobRun.create({ data: { name: 'scheduler.tick', status: 'RUNNING' } });
  try {
    const details = {
      reminders: await sendUpcomingReminders(now),
      checkInReminders: await sendCheckInReminders(now),
      released: await releaseNoShows(now),
      completed: await completeEndedReservations(now),
      tokensCleaned: await cleanupExpiredTokens(now),
      guestSandboxesPurged: await purgeGuestSandboxes(now),
    };
    await prisma.jobRun.update({ where: { id: run.id }, data: { status: 'SUCCESS', finishedAt: new Date(), details } });
    lastRun = { at: now, ok: true };
    return details;
  } catch (err) {
    lastRun = { at: now, ok: false };
    await prisma.jobRun.update({ where: { id: run.id }, data: { status: 'FAILED', finishedAt: new Date(), details: { error: (err as Error).message } } });
    throw err;
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${LOCK_KEY})`;
    // Keep the job_runs table small.
    await prisma.jobRun.deleteMany({ where: { startedAt: { lt: new Date(Date.now() - 3 * 86400000) } } }).catch(() => undefined);
  }
}

export function startScheduler() {
  if (!env.JOBS_ENABLED || env.isTest) return;
  const tick = () =>
    runTick().catch((err) => logger.error({ err }, 'scheduler tick failed'));
  timer = setInterval(tick, env.JOBS_INTERVAL_SECONDS * 1000);
  timer.unref();
  setTimeout(tick, 2000).unref();
  logger.info({ intervalSeconds: env.JOBS_INTERVAL_SECONDS }, 'background scheduler started');
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
