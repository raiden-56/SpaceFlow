import { Router } from 'express';
import { z } from 'zod';
import type { FloorMapDto } from '@spaceflow/shared';
import { requireAuth } from '../../middleware/auth.js';
import { validate, params, query } from '../../middleware/validate.js';
import { doc } from '../../openapi/registry.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { assetUrl, resourceInclude, toBuildingDto, toFloorDto, toMapObjectDto, toResourceDto, toZoneDto } from '../../utils/mappers.js';
import { computeAvailability } from '../availability/service.js';

export const buildingsRouter = Router();
export const floorsRouter = Router();
buildingsRouter.use(requireAuth);
floorsRouter.use(requireAuth);

const idParam = z.object({ id: z.string().uuid() });
const buildingInclude = { _count: { select: { floors: true } }, resources: { select: { type: true }, where: { deletedAt: null } } } as const;
const floorInclude = { floorPlan: { select: { status: true, widthM: true, depthM: true } }, resources: { select: { type: true }, where: { deletedAt: null } } } as const;

function isAdmin(req: { user?: { permissions: string[] } }) {
  return !!req.user?.permissions.includes('building:manage');
}

doc({ method: 'get', path: '/buildings', summary: 'List buildings (active only for employees)', tags: ['Buildings'] });
buildingsRouter.get('/', async (req, res) => {
  const rows = await prisma.building.findMany({
    where: { orgId: req.user!.orgId, deletedAt: null, ...(isAdmin(req) ? {} : { isActive: true }) },
    include: buildingInclude,
    orderBy: { name: 'asc' },
  });
  res.json(rows.map(toBuildingDto));
});

doc({ method: 'get', path: '/buildings/:id', summary: 'Building details', tags: ['Buildings'] });
buildingsRouter.get('/:id', validate(idParam, 'params'), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const row = await prisma.building.findFirst({ where: { id, orgId: req.user!.orgId, deletedAt: null, ...(isAdmin(req) ? {} : { isActive: true }) }, include: buildingInclude });
  if (!row) throw AppError.notFound('Building');
  res.json(toBuildingDto(row));
});

doc({ method: 'get', path: '/buildings/:id/floors', summary: 'Floors of a building (published only for employees)', tags: ['Floors'] });
buildingsRouter.get('/:id/floors', validate(idParam, 'params'), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const building = await prisma.building.findFirst({ where: { id, orgId: req.user!.orgId, deletedAt: null }, select: { id: true } });
  if (!building) throw AppError.notFound('Building');
  const rows = await prisma.floor.findMany({
    where: { buildingId: id, deletedAt: null, ...(isAdmin(req) ? {} : { isPublished: true }) },
    include: floorInclude,
    orderBy: [{ sortOrder: 'asc' }, { number: 'asc' }],
  });
  res.json(rows.map(toFloorDto));
});

doc({ method: 'get', path: '/floors/:id', summary: 'Floor details', tags: ['Floors'] });
floorsRouter.get('/:id', validate(idParam, 'params'), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const row = await prisma.floor.findFirst({ where: { id, deletedAt: null, building: { orgId: req.user!.orgId } }, include: floorInclude });
  if (!row || (!row.isPublished && !isAdmin(req))) throw AppError.notFound('Floor');
  res.json(toFloorDto(row));
});

const mapQuery = z.object({
  startAt: z.string().datetime({ offset: true }).optional(),
  endAt: z.string().datetime({ offset: true }).optional(),
});
doc({ method: 'get', path: '/floors/:id/map', summary: 'Floor map: plan, map objects, zones, resources (+availability when a window is given)', tags: ['Floors'], query: mapQuery });
floorsRouter.get('/:id/map', validate(idParam, 'params'), validate(mapQuery, 'query'), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const q = query<z.infer<typeof mapQuery>>(req);
  const floor = await prisma.floor.findFirst({
    where: { id, deletedAt: null, building: { orgId: req.user!.orgId } },
    include: { ...floorInclude, building: { select: { id: true, name: true, code: true, timezone: true, isActive: true } }, floorPlan: { include: { objects: true } }, zones: true },
  });
  if (!floor || (!floor.isPublished && !isAdmin(req))) throw AppError.notFound('Floor');
  const resources = await prisma.resource.findMany({ where: { floorId: id, deletedAt: null }, include: { ...resourceInclude, floor: { select: { id: true, name: true, number: true, isPublished: true } } }, orderBy: { code: 'asc' } });
  const favs = new Set((await prisma.favorite.findMany({ where: { userId: req.user!.id }, select: { resourceId: true } })).map((f) => f.resourceId));
  let availability: Map<string, { state: string }> | null = null;
  const dtos = resources.map((r) => toResourceDto(r, { isFavorite: favs.has(r.id) }));
  if (q.startAt && q.endAt) {
    const av = await computeAvailability(resources.map((r) => ({ ...r, building: { timezone: floor.building.timezone, isActive: floor.building.isActive } })), { startAt: new Date(q.startAt), endAt: new Date(q.endAt), user: req.user });
    availability = av;
    for (const d of dtos) d.availability = av.get(d.id);
  }
  void availability;
  const plan = floor.floorPlan;
  const payload: FloorMapDto = {
    floor: toFloorDto({ ...floor, floorPlan: plan ? { status: plan.status, widthM: plan.widthM, depthM: plan.depthM } : null }),
    building: { id: floor.building.id, name: floor.building.name, code: floor.building.code, timezone: floor.building.timezone },
    plan: plan
      ? { id: plan.id, widthM: plan.widthM, depthM: plan.depthM, status: plan.status, version: plan.version, imageUrl: assetUrl(plan.imageAssetId), modelUrl: assetUrl(plan.modelAssetId), publishedAt: plan.publishedAt?.toISOString() ?? null }
      : null,
    objects: plan ? plan.objects.map(toMapObjectDto) : [],
    resources: dtos,
    zones: floor.zones.map(toZoneDto),
  };
  res.json(payload);
});
