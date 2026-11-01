import { Router } from 'express';
import { z } from 'zod';
import type { DashboardDto } from '@spaceflow/shared';
import { requireAuth } from '../../middleware/auth.js';
import { validate, query } from '../../middleware/validate.js';
import { doc } from '../../openapi/registry.js';
import { prisma } from '../../lib/prisma.js';
import { resourceInclude, reservationSummaryInclude, toReservationSummaryDto, toResourceDto } from '../../utils/mappers.js';
import { computeAvailability } from '../availability/service.js';
import { endOfLocalDay, localDate, startOfLocalDay } from '../../utils/time.js';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

const dashQuery = z.object({
  buildingId: z.string().uuid().optional(),
  startAt: z.string().datetime({ offset: true }).optional(),
  endAt: z.string().datetime({ offset: true }).optional(),
});

doc({ method: 'get', path: '/dashboard', summary: 'Personalised employee dashboard', tags: ['Dashboard'], query: dashQuery });
dashboardRouter.get('/', validate(dashQuery, 'query'), async (req, res) => {
  const user = req.user!;
  const q = query<z.infer<typeof dashQuery>>(req);
  const now = new Date();
  const me = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { homeBuilding: true, preferences: true } });
  const buildingId = q.buildingId ?? me.preferences?.defaultBuildingId ?? me.homeBuildingId ?? null;
  const building = buildingId ? await prisma.building.findFirst({ where: { id: buildingId, orgId: user.orgId } }) : null;
  const tz = building?.timezone ?? 'UTC';
  const today = localDate(now, tz);
  const dayStart = startOfLocalDay(today, tz);
  const dayEnd = endOfLocalDay(today, tz);
  const windowStart = q.startAt ? new Date(q.startAt) : now;
  const windowEnd = q.endAt ? new Date(q.endAt) : new Date(now.getTime() + 60 * 60000);

  const [todaySeat, todayMeetings, upcoming, recent, favorites, recentRes, announcements, unread] = await Promise.all([
    prisma.reservation.findFirst({ where: { userId: user.id, type: 'SEAT', status: { in: ['CONFIRMED', 'CHECKED_IN', 'PENDING_APPROVAL'] }, startAt: { lt: dayEnd }, endAt: { gt: Math.max(dayStart.getTime(), now.getTime()) > dayStart.getTime() ? now : dayStart } }, include: reservationSummaryInclude, orderBy: { startAt: 'asc' } }),
    prisma.reservation.findMany({ where: { userId: user.id, type: 'MEETING_ROOM', status: { in: ['CONFIRMED', 'CHECKED_IN', 'PENDING_APPROVAL'] }, startAt: { gte: dayStart, lt: dayEnd } }, include: reservationSummaryInclude, orderBy: { startAt: 'asc' } }),
    prisma.reservation.findMany({ where: { userId: user.id, status: { in: ['CONFIRMED', 'CHECKED_IN', 'PENDING_APPROVAL'] }, endAt: { gt: now } }, include: reservationSummaryInclude, orderBy: { startAt: 'asc' }, take: 6 }),
    prisma.reservation.findMany({ where: { userId: user.id, endAt: { lte: now } }, include: reservationSummaryInclude, orderBy: { startAt: 'desc' }, take: 5 }),
    prisma.favorite.findMany({ where: { userId: user.id, resource: { deletedAt: null } }, include: { resource: { include: resourceInclude } }, orderBy: { createdAt: 'desc' }, take: 6 }),
    prisma.reservation.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, select: { resourceId: true }, distinct: ['resourceId'], take: 8 }),
    prisma.announcement.findMany({ where: { orgId: user.orgId, publishedAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], AND: [{ OR: [{ buildingId: null }, ...(buildingId ? [{ buildingId }] : [])] }] }, orderBy: { publishedAt: 'desc' }, take: 5 }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);

  // Availability summary for the selected building and window.
  const resources = await prisma.resource.findMany({
    where: { orgId: user.orgId, deletedAt: null, status: 'ACTIVE', isBookable: true, floor: { isPublished: true }, building: { isActive: true }, ...(buildingId ? { buildingId } : {}) },
    include: { floor: { select: { isPublished: true } }, building: { select: { timezone: true, isActive: true } } },
  });
  const av = await computeAvailability(resources, { startAt: windowStart, endAt: windowEnd, user, now });
  let availableSeats = 0;
  let availableRooms = 0;
  let checkedInNow = 0;
  let reservedNow = 0;
  for (const r of resources) {
    const a = av.get(r.id);
    if (!a) continue;
    if (a.state === 'AVAILABLE' || a.state === 'RESTRICTED') r.type === 'SEAT' ? availableSeats++ : availableRooms++;
    if (a.state === 'OCCUPIED') checkedInNow++;
    if (a.state === 'RESERVED') reservedNow++;
  }

  // Suggested seats: next hour, same building.
  const seatPool = resources.filter((r) => r.type === 'SEAT' && av.get(r.id)?.state === 'AVAILABLE');
  const histIds = new Set(recentRes.map((r) => r.resourceId));
  const favIds = new Set(favorites.map((f) => f.resourceId));
  seatPool.sort((a, b) => Number(favIds.has(b.id)) - Number(favIds.has(a.id)) || Number(histIds.has(b.id)) - Number(histIds.has(a.id)) || a.code.localeCompare(b.code));
  const suggestedRows = await prisma.resource.findMany({ where: { id: { in: seatPool.slice(0, 4).map((r) => r.id) } }, include: resourceInclude });
  const recentRows = await prisma.resource.findMany({ where: { id: { in: recentRes.map((r) => r.resourceId) }, deletedAt: null }, include: resourceInclude });

  const dto: DashboardDto = {
    user: { displayName: `${me.firstName} ${me.lastName}`, homeBuildingName: me.homeBuilding?.name ?? null },
    today: { date: today, seatBooking: todaySeat ? toReservationSummaryDto(todaySeat) : null, meetings: todayMeetings.map(toReservationSummaryDto) },
    nextBooking: upcoming[0] ? toReservationSummaryDto(upcoming[0]) : null,
    upcoming: upcoming.map(toReservationSummaryDto),
    recent: recent.map(toReservationSummaryDto),
    availability: {
      buildingId,
      totalSeats: resources.filter((r) => r.type === 'SEAT').length,
      availableSeats,
      totalRooms: resources.filter((r) => r.type === 'MEETING_ROOM').length,
      availableRooms,
      checkedInNow,
      reservedNow,
    },
    favorites: favorites.map((f) => toResourceDto(f.resource, { isFavorite: true })),
    recentResources: recentRes.map((r) => recentRows.find((x) => x.id === r.resourceId)).filter(Boolean).map((r) => toResourceDto(r!, { isFavorite: favIds.has(r!.id) })),
    suggestedSeats: seatPool.slice(0, 4).map((r) => suggestedRows.find((x) => x.id === r.id)!).filter(Boolean).map((r) => ({ ...toResourceDto(r, { isFavorite: favIds.has(r.id) }), availability: av.get(r.id) })),
    announcements: announcements.map((a) => ({ id: a.id, title: a.title, body: a.body, buildingId: a.buildingId, publishedAt: a.publishedAt.toISOString(), expiresAt: a.expiresAt?.toISOString() ?? null })),
    unreadNotifications: unread,
  };
  res.json(dto);
});
