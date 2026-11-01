// Admin: buildings, floors, floor plans (Map Studio), zones, amenities, announcements, CSV import.
import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import type { Prisma } from '@prisma/client';
import {
  amenityCreateSchema,
  amenityUpdateSchema,
  announcementSchema,
  buildingCreateSchema,
  buildingUpdateSchema,
  floorCreateSchema,
  floorPlanUpsertSchema,
  floorReorderSchema,
  floorUpdateSchema,
  roomCsvRowSchema,
  seatCsvRowSchema,
  zoneCreateSchema,
  zoneUpdateSchema,
  BOOKABLE_MAP_KINDS,
  type BuildingInput,
  type FloorPlanUpsertInput,
} from '@spaceflow/shared';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { validate, body, params } from '../../middleware/validate.js';
import { doc } from '../../openapi/registry.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { audit, clientIp } from '../../lib/audit.js';
import { isValidTimezone } from '../../utils/time.js';
import { buildSearchText, toAmenityDto, toBuildingDto, toFloorDto, toMapObjectDto, toZoneDto } from '../../utils/mappers.js';
import { broadcastToOrg } from '../../realtime/sse.js';

export const adminWorkplaceRouter = Router();

/**
 * Bookable objects (desks, meeting rooms) must not overlap: the one underneath could never be
 * selected on the map. Uses axis-aligned bounds; rotations of 90°/270° swap width and depth.
 */
export function findBookableOverlaps(objects: { kind: string; label?: string | null; x: number; y: number; width: number; depth: number; rotation?: number | null }[]): string[] {
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
adminWorkplaceRouter.use(requireAuth);

const idParam = z.object({ id: z.string().uuid() });
const buildingInclude = { _count: { select: { floors: true } }, resources: { select: { type: true }, where: { deletedAt: null } } } as const;
const floorInclude = { floorPlan: { select: { status: true, widthM: true, depthM: true } }, resources: { select: { type: true }, where: { deletedAt: null } } } as const;

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

doc({ method: 'post', path: '/admin/buildings', summary: 'Create a building', tags: ['Admin', 'Buildings'], permissions: ['building:manage'], body: buildingCreateSchema, responses: { 201: 'Created' } });
adminWorkplaceRouter.post('/buildings', requirePermission('building:manage'), validate(buildingCreateSchema), async (req, res) => {
  const input = body<BuildingInput>(req);
  if (!isValidTimezone(input.timezone)) throw AppError.badRequest(`Unknown timezone "${input.timezone}"`);
  const row = await prisma.building.create({ data: { ...input, code: input.code.toUpperCase(), orgId: req.user!.orgId }, include: buildingInclude });
  await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: 'building.create', entityType: 'Building', entityId: row.id, after: row, ip: clientIp(req) });
  res.status(201).json(toBuildingDto(row));
});

doc({ method: 'patch', path: '/admin/buildings/:id', summary: 'Update a building', tags: ['Admin', 'Buildings'], permissions: ['building:manage'], body: buildingUpdateSchema });
adminWorkplaceRouter.patch('/buildings/:id', requirePermission('building:manage'), validate(idParam, 'params'), validate(buildingUpdateSchema), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const input = body<Partial<BuildingInput>>(req);
  if (input.timezone && !isValidTimezone(input.timezone)) throw AppError.badRequest(`Unknown timezone "${input.timezone}"`);
  const before = await prisma.building.findFirst({ where: { id, orgId: req.user!.orgId, deletedAt: null } });
  if (!before) throw AppError.notFound('Building');
  const row = await prisma.building.update({ where: { id }, data: { ...input, code: input.code?.toUpperCase() }, include: buildingInclude });
  await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: 'building.update', entityType: 'Building', entityId: id, before, after: row, ip: clientIp(req) });
  res.json(toBuildingDto(row));
});

const modelSchema = z.object({ modelAssetId: z.string().uuid().nullable() });
doc({ method: 'put', path: '/admin/buildings/:id/model', summary: 'Attach or detach a GLB building model', tags: ['Admin', 'Buildings'], permissions: ['floorplan:manage'], body: modelSchema });
adminWorkplaceRouter.put('/buildings/:id/model', requirePermission('floorplan:manage'), validate(idParam, 'params'), validate(modelSchema), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const { modelAssetId } = body<{ modelAssetId: string | null }>(req);
  if (modelAssetId) {
    const asset = await prisma.asset.findFirst({ where: { id: modelAssetId, orgId: req.user!.orgId, kind: 'BUILDING_MODEL' } });
    if (!asset) throw AppError.badRequest('Asset must be an uploaded BUILDING_MODEL');
  }
  const row = await prisma.building.update({ where: { id }, data: { modelAssetId }, include: buildingInclude });
  await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: 'building.model', entityType: 'Building', entityId: id, after: { modelAssetId }, ip: clientIp(req) });
  res.json(toBuildingDto(row));
});

doc({ method: 'delete', path: '/admin/buildings/:id', summary: 'Archive a building (soft delete)', tags: ['Admin', 'Buildings'], permissions: ['building:manage'], responses: { 204: 'Archived' } });
adminWorkplaceRouter.delete('/buildings/:id', requirePermission('building:manage'), validate(idParam, 'params'), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const before = await prisma.building.findFirst({ where: { id, orgId: req.user!.orgId, deletedAt: null } });
  if (!before) throw AppError.notFound('Building');
  const active = await prisma.reservation.count({ where: { resource: { buildingId: id }, status: { in: ['CONFIRMED', 'CHECKED_IN', 'PENDING_APPROVAL'] }, endAt: { gt: new Date() } } });
  if (active > 0) throw AppError.conflict(`Cannot archive: ${active} active reservation(s) exist. Deactivate the building first and cancel them.`);
  await prisma.building.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, code: `${before.code}~${Date.now().toString(36)}` } });
  await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: 'building.delete', entityType: 'Building', entityId: id, before, ip: clientIp(req) });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Floors
// ---------------------------------------------------------------------------

doc({ method: 'post', path: '/admin/buildings/:id/floors', summary: 'Create a floor', tags: ['Admin', 'Floors'], permissions: ['building:manage'], body: floorCreateSchema, responses: { 201: 'Created' } });
adminWorkplaceRouter.post('/buildings/:id/floors', requirePermission('building:manage'), validate(idParam, 'params'), validate(floorCreateSchema), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const input = body<z.infer<typeof floorCreateSchema>>(req);
  const building = await prisma.building.findFirst({ where: { id, orgId: req.user!.orgId, deletedAt: null } });
  if (!building) throw AppError.notFound('Building');
  const maxSort = await prisma.floor.aggregate({ where: { buildingId: id }, _max: { sortOrder: true } });
  const row = await prisma.floor.create({ data: { ...input, buildingId: id, sortOrder: (maxSort._max.sortOrder ?? -1) + 1 }, include: floorInclude });
  await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: 'floor.create', entityType: 'Floor', entityId: row.id, after: row, ip: clientIp(req) });
  res.status(201).json(toFloorDto(row));
});

doc({ method: 'patch', path: '/admin/floors/:id', summary: 'Update a floor (name, number, publish state)', tags: ['Admin', 'Floors'], permissions: ['building:manage'], body: floorUpdateSchema });
adminWorkplaceRouter.patch('/floors/:id', requirePermission('building:manage'), validate(idParam, 'params'), validate(floorUpdateSchema), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const input = body<z.infer<typeof floorUpdateSchema>>(req);
  const before = await prisma.floor.findFirst({ where: { id, deletedAt: null, building: { orgId: req.user!.orgId } }, include: { floorPlan: true } });
  if (!before) throw AppError.notFound('Floor');
  if (input.isPublished && !before.floorPlan) throw AppError.policy('Publish a floor plan before publishing the floor.');
  const row = await prisma.floor.update({ where: { id }, data: input, include: floorInclude });
  await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: 'floor.update', entityType: 'Floor', entityId: id, before, after: row, ip: clientIp(req) });
  broadcastToOrg(req.user!.orgId, 'floorplan.published', { floorId: id, buildingId: row.buildingId, isPublished: row.isPublished });
  res.json(toFloorDto(row));
});

doc({ method: 'post', path: '/admin/buildings/:id/floors/reorder', summary: 'Reorder floors', tags: ['Admin', 'Floors'], permissions: ['building:manage'], body: floorReorderSchema });
adminWorkplaceRouter.post('/buildings/:id/floors/reorder', requirePermission('building:manage'), validate(idParam, 'params'), validate(floorReorderSchema), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const { floorIds } = body<{ floorIds: string[] }>(req);
  const building = await prisma.building.findFirst({ where: { id, orgId: req.user!.orgId, deletedAt: null }, select: { id: true } });
  if (!building) throw AppError.notFound('Building');
  await prisma.$transaction(floorIds.map((fid, i) => prisma.floor.updateMany({ where: { id: fid, buildingId: id }, data: { sortOrder: i } })));
  await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: 'floor.reorder', entityType: 'Building', entityId: id, after: { floorIds }, ip: clientIp(req) });
  res.json({ ok: true });
});

doc({ method: 'delete', path: '/admin/floors/:id', summary: 'Archive a floor', tags: ['Admin', 'Floors'], permissions: ['building:manage'], responses: { 204: 'Archived' } });
adminWorkplaceRouter.delete('/floors/:id', requirePermission('building:manage'), validate(idParam, 'params'), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const before = await prisma.floor.findFirst({ where: { id, deletedAt: null, building: { orgId: req.user!.orgId } } });
  if (!before) throw AppError.notFound('Floor');
  const active = await prisma.reservation.count({ where: { resource: { floorId: id }, status: { in: ['CONFIRMED', 'CHECKED_IN', 'PENDING_APPROVAL'] }, endAt: { gt: new Date() } } });
  if (active > 0) throw AppError.conflict(`Cannot archive: ${active} active reservation(s) exist on this floor.`);
  await prisma.floor.update({ where: { id }, data: { deletedAt: new Date(), isPublished: false, number: before.number + 100000 } });
  await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: 'floor.delete', entityType: 'Floor', entityId: id, before, ip: clientIp(req) });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Floor plans (Map Studio)
// ---------------------------------------------------------------------------

doc({ method: 'get', path: '/admin/floors/:id/plan', summary: 'Floor plan draft incl. unlinked resources', tags: ['Admin', 'Floors'], permissions: ['floorplan:manage'] });
adminWorkplaceRouter.get('/floors/:id/plan', requirePermission('floorplan:manage'), validate(idParam, 'params'), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const floor = await prisma.floor.findFirst({ where: { id, deletedAt: null, building: { orgId: req.user!.orgId } }, include: { floorPlan: { include: { objects: true } }, zones: true, resources: { where: { deletedAt: null }, select: { id: true, code: true, name: true, type: true, mapObject: { select: { id: true } } } } } });
  if (!floor) throw AppError.notFound('Floor');
  res.json({
    plan: floor.floorPlan ? { id: floor.floorPlan.id, widthM: floor.floorPlan.widthM, depthM: floor.floorPlan.depthM, status: floor.floorPlan.status, version: floor.floorPlan.version, imageAssetId: floor.floorPlan.imageAssetId, modelAssetId: floor.floorPlan.modelAssetId, publishedAt: floor.floorPlan.publishedAt?.toISOString() ?? null } : null,
    objects: floor.floorPlan?.objects.map(toMapObjectDto) ?? [],
    zones: floor.zones.map(toZoneDto),
    resources: floor.resources.map((r) => ({ id: r.id, code: r.code, name: r.name, type: r.type, linked: !!r.mapObject })),
  });
});

/**
 * Save the floor plan draft. Objects are replaced wholesale, but resource identity is preserved:
 * objects reference resources by id (or by code for imports). Replacing a plan never deletes
 * resources or booking history.
 */
doc({ method: 'put', path: '/admin/floors/:id/plan', summary: 'Save floor plan draft (replaces map objects; keeps resources + history)', tags: ['Admin', 'Floors'], permissions: ['floorplan:manage'], body: floorPlanUpsertSchema });
adminWorkplaceRouter.put('/floors/:id/plan', requirePermission('floorplan:manage'), validate(idParam, 'params'), validate(floorPlanUpsertSchema), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const input = body<FloorPlanUpsertInput>(req);
  const orgId = req.user!.orgId;
  const floor = await prisma.floor.findFirst({ where: { id, deletedAt: null, building: { orgId } }, include: { floorPlan: true } });
  if (!floor) throw AppError.notFound('Floor');
  if (input.imageAssetId) {
    const a = await prisma.asset.findFirst({ where: { id: input.imageAssetId, orgId, kind: 'FLOOR_PLAN_IMAGE' } });
    if (!a) throw AppError.badRequest('imageAssetId must be an uploaded FLOOR_PLAN_IMAGE');
  }
  if (input.modelAssetId) {
    const a = await prisma.asset.findFirst({ where: { id: input.modelAssetId, orgId, kind: 'FLOOR_MODEL' } });
    if (!a) throw AppError.badRequest('modelAssetId must be an uploaded FLOOR_MODEL');
  }
  // Resolve resource links and validate they belong to this floor.
  const floorResources = await prisma.resource.findMany({ where: { floorId: id, deletedAt: null }, select: { id: true, code: true, type: true } });
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
  if (errors.length) throw AppError.badRequest('Floor plan validation failed', { issues: errors.slice(0, 50) });

  const plan = await prisma.$transaction(async (tx) => {
    const saved = floor.floorPlan
      ? await tx.floorPlan.update({ where: { id: floor.floorPlan.id }, data: { widthM: input.widthM, depthM: input.depthM, imageAssetId: input.imageAssetId ?? null, modelAssetId: input.modelAssetId ?? null, status: 'DRAFT', version: { increment: 1 } } })
      : await tx.floorPlan.create({ data: { floorId: id, widthM: input.widthM, depthM: input.depthM, imageAssetId: input.imageAssetId ?? null, modelAssetId: input.modelAssetId ?? null } });
    await tx.mapObject.deleteMany({ where: { floorPlanId: saved.id } });
    if (resolved.length) {
      await tx.mapObject.createMany({ data: resolved.map((o) => ({ floorPlanId: saved.id, kind: o.kind, label: o.label ?? null, x: o.x, y: o.y, width: o.width, depth: o.depth, rotation: o.rotation ?? 0, height: o.height ?? null, resourceId: o.resourceId, meta: (o.meta as Prisma.InputJsonValue) ?? undefined })) });
    }
    await audit({ orgId, actorId: req.user!.id, action: 'floorplan.save', entityType: 'Floor', entityId: id, after: { version: saved.version, objects: resolved.length }, ip: clientIp(req) }, tx);
    return tx.floorPlan.findUniqueOrThrow({ where: { id: saved.id }, include: { objects: true } });
  });
  res.json({ plan: { id: plan.id, widthM: plan.widthM, depthM: plan.depthM, status: plan.status, version: plan.version, imageAssetId: plan.imageAssetId, modelAssetId: plan.modelAssetId, publishedAt: plan.publishedAt?.toISOString() ?? null }, objects: plan.objects.map(toMapObjectDto), linked: seen.size, unlinkedResources: floorResources.filter((r) => !seen.has(r.id)).map((r) => r.code) });
});

doc({ method: 'post', path: '/admin/floors/:id/plan/publish', summary: 'Validate and publish the floor plan', tags: ['Admin', 'Floors'], permissions: ['floorplan:manage'] });
adminWorkplaceRouter.post('/floors/:id/plan/publish', requirePermission('floorplan:manage'), validate(idParam, 'params'), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const floor = await prisma.floor.findFirst({ where: { id, deletedAt: null, building: { orgId: req.user!.orgId } }, include: { floorPlan: { include: { objects: true } }, resources: { where: { deletedAt: null, status: 'ACTIVE' }, select: { id: true, code: true } } } });
  if (!floor?.floorPlan) throw AppError.policy('Save a floor plan before publishing.');
  const linked = new Set(floor.floorPlan.objects.map((o) => o.resourceId).filter(Boolean));
  const unlinked = floor.resources.filter((r) => !linked.has(r.id));
  const unlinkedObjects = floor.floorPlan.objects.filter((o) => BOOKABLE_MAP_KINDS.includes(o.kind) && !o.resourceId);
  const warnings = [
    ...(unlinked.length ? [`${unlinked.length} active resource(s) have no map position: ${unlinked.slice(0, 10).map((r) => r.code).join(', ')}${unlinked.length > 10 ? '…' : ''}`] : []),
    ...(unlinkedObjects.length ? [`${unlinkedObjects.length} desk/room object(s) are not linked to a resource and will be shown as non-bookable`] : []),
  ];
  const plan = await prisma.floorPlan.update({ where: { id: floor.floorPlan.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
  await prisma.floor.update({ where: { id }, data: { isPublished: true } });
  await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: 'floorplan.publish', entityType: 'Floor', entityId: id, after: { version: plan.version, warnings }, ip: clientIp(req) });
  broadcastToOrg(req.user!.orgId, 'floorplan.published', { floorId: id, buildingId: floor.buildingId, version: plan.version });
  res.json({ ok: true, version: plan.version, publishedAt: plan.publishedAt?.toISOString(), warnings });
});

doc({ method: 'post', path: '/admin/floors/:id/plan/unpublish', summary: 'Unpublish the floor plan (floor becomes hidden to employees)', tags: ['Admin', 'Floors'], permissions: ['floorplan:manage'] });
adminWorkplaceRouter.post('/floors/:id/plan/unpublish', requirePermission('floorplan:manage'), validate(idParam, 'params'), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const floor = await prisma.floor.findFirst({ where: { id, building: { orgId: req.user!.orgId } }, include: { floorPlan: true } });
  if (!floor?.floorPlan) throw AppError.notFound('Floor plan');
  await prisma.floorPlan.update({ where: { id: floor.floorPlan.id }, data: { status: 'DRAFT' } });
  await prisma.floor.update({ where: { id }, data: { isPublished: false } });
  await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: 'floorplan.unpublish', entityType: 'Floor', entityId: id, ip: clientIp(req) });
  broadcastToOrg(req.user!.orgId, 'floorplan.published', { floorId: id, buildingId: floor.buildingId, isPublished: false });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

doc({ method: 'get', path: '/admin/floors/:id/zones', summary: 'List zones on a floor', tags: ['Admin', 'Floors'], permissions: ['resource:manage'] });
adminWorkplaceRouter.get('/floors/:id/zones', requirePermission('resource:manage'), validate(idParam, 'params'), async (req, res) => {
  const rows = await prisma.zone.findMany({ where: { floorId: params<{ id: string }>(req).id, floor: { building: { orgId: req.user!.orgId } } }, orderBy: { name: 'asc' } });
  res.json(rows.map(toZoneDto));
});
doc({ method: 'post', path: '/admin/floors/:id/zones', summary: 'Create a zone / neighborhood', tags: ['Admin', 'Floors'], permissions: ['resource:manage'], body: zoneCreateSchema, responses: { 201: 'Created' } });
adminWorkplaceRouter.post('/floors/:id/zones', requirePermission('resource:manage'), validate(idParam, 'params'), validate(zoneCreateSchema), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const floor = await prisma.floor.findFirst({ where: { id, building: { orgId: req.user!.orgId } } });
  if (!floor) throw AppError.notFound('Floor');
  const row = await prisma.zone.create({ data: { ...body<z.infer<typeof zoneCreateSchema>>(req), floorId: id } });
  await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: 'zone.create', entityType: 'Zone', entityId: row.id, after: row, ip: clientIp(req) });
  res.status(201).json(toZoneDto(row));
});
doc({ method: 'patch', path: '/admin/zones/:id', summary: 'Update a zone', tags: ['Admin', 'Floors'], permissions: ['resource:manage'], body: zoneUpdateSchema });
adminWorkplaceRouter.patch('/zones/:id', requirePermission('resource:manage'), validate(idParam, 'params'), validate(zoneUpdateSchema), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const existing = await prisma.zone.findFirst({ where: { id, floor: { building: { orgId: req.user!.orgId } } } });
  if (!existing) throw AppError.notFound('Zone');
  const updated = await prisma.zone.update({ where: { id }, data: body(req) as object });
  await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: 'zone.update', entityType: 'Zone', entityId: id, before: existing, after: updated, ip: clientIp(req) });
  res.json(toZoneDto(updated));
});
doc({ method: 'delete', path: '/admin/zones/:id', summary: 'Delete a zone (resources are unassigned)', tags: ['Admin', 'Floors'], permissions: ['resource:manage'], responses: { 204: 'Deleted' } });
adminWorkplaceRouter.delete('/zones/:id', requirePermission('resource:manage'), validate(idParam, 'params'), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const existing = await prisma.zone.findFirst({ where: { id, floor: { building: { orgId: req.user!.orgId } } } });
  if (existing) {
    await prisma.zone.delete({ where: { id } });
    await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: 'zone.delete', entityType: 'Zone', entityId: id, before: existing, ip: clientIp(req) });
  }
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Amenities
// ---------------------------------------------------------------------------

doc({ method: 'post', path: '/admin/amenities', summary: 'Create an amenity', tags: ['Admin', 'Resources'], permissions: ['resource:manage'], body: amenityCreateSchema, responses: { 201: 'Created' } });
adminWorkplaceRouter.post('/amenities', requirePermission('resource:manage'), validate(amenityCreateSchema), async (req, res) => {
  const row = await prisma.amenity.create({ data: { ...body<z.infer<typeof amenityCreateSchema>>(req), orgId: req.user!.orgId } });
  res.status(201).json(toAmenityDto(row));
});
doc({ method: 'patch', path: '/admin/amenities/:id', summary: 'Update an amenity', tags: ['Admin', 'Resources'], permissions: ['resource:manage'], body: amenityUpdateSchema });
adminWorkplaceRouter.patch('/amenities/:id', requirePermission('resource:manage'), validate(idParam, 'params'), validate(amenityUpdateSchema), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const existing = await prisma.amenity.findFirst({ where: { id, orgId: req.user!.orgId } });
  if (!existing) throw AppError.notFound('Amenity');
  res.json(toAmenityDto(await prisma.amenity.update({ where: { id }, data: body(req) as object })));
});
doc({ method: 'delete', path: '/admin/amenities/:id', summary: 'Delete an amenity', tags: ['Admin', 'Resources'], permissions: ['resource:manage'], responses: { 204: 'Deleted' } });
adminWorkplaceRouter.delete('/amenities/:id', requirePermission('resource:manage'), validate(idParam, 'params'), async (req, res) => {
  await prisma.amenity.deleteMany({ where: { id: params<{ id: string }>(req).id, orgId: req.user!.orgId } });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

doc({ method: 'get', path: '/admin/announcements', summary: 'List announcements', tags: ['Admin'], permissions: ['building:manage'] });
adminWorkplaceRouter.get('/announcements', requirePermission('building:manage'), async (req, res) => {
  const rows = await prisma.announcement.findMany({ where: { orgId: req.user!.orgId }, orderBy: { publishedAt: 'desc' }, take: 100 });
  res.json(rows.map((a) => ({ id: a.id, title: a.title, body: a.body, buildingId: a.buildingId, publishedAt: a.publishedAt.toISOString(), expiresAt: a.expiresAt?.toISOString() ?? null })));
});
doc({ method: 'post', path: '/admin/announcements', summary: 'Publish an announcement', tags: ['Admin'], permissions: ['building:manage'], body: announcementSchema, responses: { 201: 'Created' } });
adminWorkplaceRouter.post('/announcements', requirePermission('building:manage'), validate(announcementSchema), async (req, res) => {
  const input = body<z.infer<typeof announcementSchema>>(req);
  const row = await prisma.announcement.create({ data: { orgId: req.user!.orgId, title: input.title, body: input.body, buildingId: input.buildingId ?? null, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null } });
  await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: 'announcement.create', entityType: 'Announcement', entityId: row.id, after: row, ip: clientIp(req) });
  res.status(201).json({ id: row.id, title: row.title, body: row.body, buildingId: row.buildingId, publishedAt: row.publishedAt.toISOString(), expiresAt: row.expiresAt?.toISOString() ?? null });
});
doc({ method: 'delete', path: '/admin/announcements/:id', summary: 'Delete an announcement', tags: ['Admin'], permissions: ['building:manage'], responses: { 204: 'Deleted' } });
adminWorkplaceRouter.delete('/announcements/:id', requirePermission('building:manage'), validate(idParam, 'params'), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const existing = await prisma.announcement.findFirst({ where: { id, orgId: req.user!.orgId } });
  if (existing) {
    await prisma.announcement.delete({ where: { id } });
    await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: 'announcement.delete', entityType: 'Announcement', entityId: id, before: existing, ip: clientIp(req) });
  }
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// CSV import / export
// ---------------------------------------------------------------------------

const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return [];
  const split = (line: string) => {
    const out: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQ = false;
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const headers = split(lines[0]).map((h) => h.replace(/\s+/g, ''));
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [headers[i] ?? `col${i}`, v])));
}

const SEAT_TEMPLATE = 'code,name,floorNumber,zone,seatType,x,y,nearWindow,nearElevator,monitor,dockingStation,heightAdjustable,accessible,quietZone,amenities\nA-101,Desk A-101,1,North Wing,WORKSTATION,4,3,true,false,true,true,false,false,false,"monitor;docking"\n';
const ROOM_TEMPLATE = 'code,name,floorNumber,capacity,roomType,x,y,width,depth,requiresApproval,accessible,amenities\nMR-201,Orion,2,8,MEETING,20,4,6,5,false,true,"display;video-conferencing;whiteboard"\n';

doc({ method: 'get', path: '/admin/buildings/:id/import/template', summary: 'Download the CSV template (?type=seats|rooms)', tags: ['Admin', 'Resources'], permissions: ['resource:manage'] });
adminWorkplaceRouter.get('/buildings/:id/import/template', requirePermission('resource:manage'), (req, res) => {
  const rooms = req.query.type === 'rooms';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="spaceflow-${rooms ? 'rooms' : 'seats'}-template.csv"`);
  res.send(rooms ? ROOM_TEMPLATE : SEAT_TEMPLATE);
});

doc({ method: 'post', path: '/admin/buildings/:id/import', summary: 'Import seats or rooms from CSV (multipart: file, type=seats|rooms, dryRun=true|false)', tags: ['Admin', 'Resources'], permissions: ['resource:manage'] });
adminWorkplaceRouter.post('/buildings/:id/import', requirePermission('resource:manage'), validate(idParam, 'params'), csvUpload.single('file'), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const type = req.body?.type === 'rooms' ? 'MEETING_ROOM' : 'SEAT';
  const dryRun = req.body?.dryRun === 'true';
  if (!req.file) throw AppError.badRequest('A CSV file is required (multipart field "file")');
  const orgId = req.user!.orgId;
  const building = await prisma.building.findFirst({ where: { id, orgId, deletedAt: null }, include: { floors: { where: { deletedAt: null }, include: { zones: true } } } });
  if (!building) throw AppError.notFound('Building');
  const amenities = await prisma.amenity.findMany({ where: { orgId } });
  const amenityByCode = new Map(amenities.map((a) => [a.code.toLowerCase(), a.id]));
  const rows = parseCsv(req.file.buffer.toString('utf8'));
  if (!rows.length) throw AppError.badRequest('The CSV file has no data rows');
  if (rows.length > 2000) throw AppError.badRequest('At most 2000 rows per import');

  const errors: { row: number; message: string }[] = [];
  const prepared: { row: number; data: Prisma.ResourceUncheckedCreateInput; amenityIds: string[]; x?: number; y?: number; width?: number; depth?: number }[] = [];
  const seenCodes = new Set<string>();
  rows.forEach((raw, i) => {
    const rowNo = i + 2;
    const parsed = type === 'SEAT' ? seatCsvRowSchema.safeParse(raw) : roomCsvRowSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push({ row: rowNo, message: parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ') });
      return;
    }
    const r = parsed.data as z.infer<typeof seatCsvRowSchema> & z.infer<typeof roomCsvRowSchema>;
    const floor = building.floors.find((f) => f.number === r.floorNumber);
    if (!floor) { errors.push({ row: rowNo, message: `Floor ${r.floorNumber} does not exist in ${building.name}` }); return; }
    if (seenCodes.has(r.code.toLowerCase())) { errors.push({ row: rowNo, message: `Duplicate code ${r.code} in file` }); return; }
    seenCodes.add(r.code.toLowerCase());
    const zone = r.zone ? floor.zones.find((zn) => zn.name.toLowerCase() === r.zone!.toLowerCase()) : null;
    if (r.zone && !zone) { errors.push({ row: rowNo, message: `Zone "${r.zone}" not found on floor ${floor.name}` }); return; }
    const amenityIds: string[] = [];
    for (const code of (r.amenities ?? '').split(/[;|]/).map((s) => s.trim().toLowerCase()).filter(Boolean)) {
      const aid = amenityByCode.get(code);
      if (!aid) { errors.push({ row: rowNo, message: `Unknown amenity "${code}"` }); return; }
      amenityIds.push(aid);
    }
    const seatAttributes = type === 'SEAT' ? { nearWindow: r.nearWindow, nearElevator: r.nearElevator, monitor: r.monitor, dockingStation: r.dockingStation, heightAdjustable: r.heightAdjustable, accessible: r.accessible, quietZone: r.quietZone } : undefined;
    prepared.push({
      row: rowNo,
      data: {
        orgId, buildingId: building.id, floorId: floor.id, zoneId: zone?.id ?? null, type, code: r.code, name: r.name,
        seatType: type === 'SEAT' ? (r.seatType ?? 'WORKSTATION') : null,
        roomType: type === 'MEETING_ROOM' ? ((['MEETING', 'CONFERENCE', 'HUDDLE', 'BOARDROOM', 'TRAINING'].includes((r.roomType ?? '').toUpperCase()) ? (r.roomType!.toUpperCase() as 'MEETING') : 'MEETING')) : null,
        capacity: type === 'MEETING_ROOM' ? r.capacity : null,
        accessible: !!r.accessible,
        requiresApproval: type === 'MEETING_ROOM' ? !!r.requiresApproval : false,
        seatAttributes: seatAttributes as object | undefined,
        searchText: buildSearchText([r.code, r.name, floor.name, building.name]),
      },
      amenityIds,
      x: r.x, y: r.y, width: r.width, depth: r.depth,
    });
  });

  if (dryRun || errors.length) {
    return res.status(errors.length ? 422 : 200).json({ dryRun, valid: prepared.length, errors, created: 0, updated: 0 });
  }

  let created = 0;
  let updated = 0;
  await prisma.$transaction(async (tx) => {
    for (const p of prepared) {
      const existing = await tx.resource.findFirst({ where: { buildingId: building.id, code: p.data.code, deletedAt: null } });
      const saved = existing
        ? await tx.resource.update({ where: { id: existing.id }, data: { ...p.data, type } })
        : await tx.resource.create({ data: p.data });
      existing ? updated++ : created++;
      await tx.resourceAmenity.deleteMany({ where: { resourceId: saved.id } });
      if (p.amenityIds.length) await tx.resourceAmenity.createMany({ data: p.amenityIds.map((amenityId) => ({ resourceId: saved.id, amenityId })), skipDuplicates: true });
      // Optional map placement: upsert a map object when coordinates are supplied and a plan exists.
      if (p.x !== undefined && p.y !== undefined) {
        const plan = await tx.floorPlan.findUnique({ where: { floorId: p.data.floorId } });
        if (plan) {
          const kind = type === 'SEAT' ? 'DESK' : 'MEETING_ROOM';
          const width = p.width ?? (type === 'SEAT' ? 1.6 : 5);
          const depth = p.depth ?? (type === 'SEAT' ? 0.8 : 4);
          const existingObj = await tx.mapObject.findUnique({ where: { resourceId: saved.id } });
          if (existingObj) await tx.mapObject.update({ where: { id: existingObj.id }, data: { x: p.x, y: p.y, width, depth } });
          else await tx.mapObject.create({ data: { floorPlanId: plan.id, kind, label: p.data.code, x: p.x, y: p.y, width, depth, rotation: 0, resourceId: saved.id } });
        }
      }
    }
    await audit({ orgId, actorId: req.user!.id, action: 'resource.import', entityType: 'Building', entityId: building.id, after: { type, created, updated }, ip: clientIp(req) }, tx);
  }, { timeout: 60000 });
  broadcastToOrg(orgId, 'availability.changed', { buildingId: building.id, resourceIds: [] });
  res.json({ dryRun: false, valid: prepared.length, errors: [], created, updated });
});

doc({ method: 'get', path: '/admin/buildings/:id/export', summary: 'Export seats or rooms as CSV (?type=seats|rooms)', tags: ['Admin', 'Resources'], permissions: ['resource:manage'] });
adminWorkplaceRouter.get('/buildings/:id/export', requirePermission('resource:manage'), validate(idParam, 'params'), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const type = req.query.type === 'rooms' ? 'MEETING_ROOM' : 'SEAT';
  const rows = await prisma.resource.findMany({ where: { buildingId: id, orgId: req.user!.orgId, type, deletedAt: null }, include: { floor: true, zone: true, amenities: { include: { amenity: true } }, mapObject: true }, orderBy: { code: 'asc' } });
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines: string[] = [];
  if (type === 'SEAT') {
    lines.push('code,name,floorNumber,zone,seatType,x,y,nearWindow,nearElevator,monitor,dockingStation,heightAdjustable,accessible,quietZone,amenities,status');
    for (const r of rows) {
      const a = (r.seatAttributes as Record<string, boolean> | null) ?? {};
      lines.push([r.code, r.name, r.floor.number, r.zone?.name, r.seatType, r.mapObject?.x, r.mapObject?.y, !!a.nearWindow, !!a.nearElevator, !!a.monitor, !!a.dockingStation, !!a.heightAdjustable, !!a.accessible, !!a.quietZone, r.amenities.map((x) => x.amenity.code).join(';'), r.status].map(esc).join(','));
    }
  } else {
    lines.push('code,name,floorNumber,capacity,roomType,x,y,width,depth,requiresApproval,accessible,amenities,status');
    for (const r of rows) lines.push([r.code, r.name, r.floor.number, r.capacity, r.roomType, r.mapObject?.x, r.mapObject?.y, r.mapObject?.width, r.mapObject?.depth, r.requiresApproval, r.accessible, r.amenities.map((x) => x.amenity.code).join(';'), r.status].map(esc).join(','));
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="spaceflow-${type === 'SEAT' ? 'seats' : 'rooms'}.csv"`);
  res.send(lines.join('\n'));
});
