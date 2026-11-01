import { Router } from 'express';
import { searchQuerySchema, type SearchResultsDto } from '@spaceflow/shared';
import { requireAuth } from '../../middleware/auth.js';
import { validate, query } from '../../middleware/validate.js';
import { doc } from '../../openapi/registry.js';
import { prisma } from '../../lib/prisma.js';
import { resourceInclude, toResourceDto, toUserSummaryDto } from '../../utils/mappers.js';

export const searchRouter = Router();
searchRouter.use(requireAuth);

doc({ method: 'get', path: '/search', summary: 'Global search across buildings, floors, seats, rooms, amenities, facilities and employees', tags: ['Search'], query: searchQuerySchema });
searchRouter.get('/', validate(searchQuerySchema, 'query'), async (req, res) => {
  const { q, limit } = query<{ q: string; limit: number }>(req);
  const user = req.user!;
  const orgId = user.orgId;
  const isAdmin = user.permissions.includes('resource:manage');
  const term = q.trim();
  const ci = { contains: term, mode: 'insensitive' as const };
  const resourceWhere = { orgId, deletedAt: null, searchText: { contains: term.toLowerCase() }, ...(isAdmin ? {} : { floor: { isPublished: true }, building: { isActive: true } }) };

  const [buildings, floors, seats, rooms, amenities, facilities, employees, favs] = await Promise.all([
    prisma.building.findMany({ where: { orgId, deletedAt: null, ...(isAdmin ? {} : { isActive: true }), OR: [{ name: ci }, { code: ci }, { city: ci }] }, take: limit, select: { id: true, name: true, code: true, city: true } }),
    prisma.floor.findMany({ where: { deletedAt: null, building: { orgId, deletedAt: null }, ...(isAdmin ? {} : { isPublished: true }), name: ci }, take: limit, include: { building: { select: { id: true, name: true } } } }),
    prisma.resource.findMany({ where: { ...resourceWhere, type: 'SEAT' }, include: resourceInclude, take: limit, orderBy: { code: 'asc' } }),
    prisma.resource.findMany({ where: { ...resourceWhere, type: 'MEETING_ROOM' }, include: resourceInclude, take: limit, orderBy: { code: 'asc' } }),
    prisma.amenity.findMany({ where: { orgId, OR: [{ name: ci }, { code: ci }] }, take: limit, include: { _count: { select: { resources: true } } } }),
    prisma.mapObject.findMany({
      where: { label: ci, resourceId: null, floorPlan: { floor: { deletedAt: null, ...(isAdmin ? {} : { isPublished: true }), building: { orgId } } } },
      take: limit,
      include: { floorPlan: { include: { floor: { include: { building: { select: { id: true, name: true } } } } } } },
    }),
    user.permissions.includes('user:read')
      ? prisma.user.findMany({ where: { orgId, status: 'ACTIVE', deletedAt: null, OR: [{ firstName: ci }, { lastName: ci }, { email: ci }, { jobTitle: ci }] }, take: limit, include: { department: true, team: true } })
      : Promise.resolve([]),
    prisma.favorite.findMany({ where: { userId: user.id }, select: { resourceId: true } }),
  ]);
  const favSet = new Set(favs.map((f) => f.resourceId));
  const out: SearchResultsDto = {
    buildings,
    floors: floors.map((f) => ({ id: f.id, name: f.name, number: f.number, buildingId: f.building.id, buildingName: f.building.name })),
    seats: seats.map((r) => toResourceDto(r, { isFavorite: favSet.has(r.id) })),
    rooms: rooms.map((r) => toResourceDto(r, { isFavorite: favSet.has(r.id) })),
    amenities: amenities.map((a) => ({ id: a.id, name: a.name, resourceCount: a._count.resources })),
    facilities: facilities.map((o) => ({ id: o.id, label: o.label ?? o.kind, kind: o.kind, floorId: o.floorPlan.floor.id, floorName: o.floorPlan.floor.name, buildingId: o.floorPlan.floor.building.id, buildingName: o.floorPlan.floor.building.name })),
    employees: employees.map(toUserSummaryDto),
  };
  res.json(out);
});
