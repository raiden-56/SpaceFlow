import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { validate, params } from '../../middleware/validate.js';
import { doc } from '../../openapi/registry.js';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { audit, clientIp } from '../../lib/audit.js';
import { deleteAsset, readAssetFile, storeAsset, toAssetDto } from './service.js';

export const assetsRouter = Router();
assetsRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 } });
const idParam = z.object({ id: z.string().uuid() });
const kindSchema = z.object({ kind: z.enum(['BUILDING_MODEL', 'FLOOR_MODEL', 'FLOOR_PLAN_IMAGE']) });

doc({ method: 'get', path: '/assets', summary: 'List uploaded 3D models and floor-plan images', tags: ['Assets'], permissions: ['floorplan:manage'] });
assetsRouter.get('/', requirePermission('floorplan:manage'), async (req, res) => {
  const rows = await prisma.asset.findMany({ where: { orgId: req.user!.orgId }, orderBy: { createdAt: 'desc' }, take: 200 });
  res.json(rows.map(toAssetDto));
});

doc({ method: 'post', path: '/assets', summary: 'Upload a GLB model or floor-plan image (multipart: file, kind)', tags: ['Assets'], permissions: ['floorplan:manage'], responses: { 201: 'Asset', 413: 'Too large', 415: 'Unsupported' } });
assetsRouter.post('/', requirePermission('floorplan:manage'), upload.single('file'), async (req, res) => {
  const parsed = kindSchema.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('kind must be BUILDING_MODEL, FLOOR_MODEL or FLOOR_PLAN_IMAGE');
  if (!req.file) throw AppError.badRequest('A file is required (multipart field "file")');
  const asset = await storeAsset({ orgId: req.user!.orgId, kind: parsed.data.kind, fileName: req.file.originalname, buffer: req.file.buffer, uploadedById: req.user!.id });
  await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: 'asset.upload', entityType: 'Asset', entityId: asset.id, after: asset, ip: clientIp(req) });
  res.status(201).json(asset);
});

doc({ method: 'get', path: '/assets/:id/file', summary: 'Stream the asset file (same-origin download; never executed)', tags: ['Assets'] });
assetsRouter.get('/:id/file', validate(idParam, 'params'), async (req, res) => {
  const { asset, abs } = await readAssetFile(req.user!.orgId, params<{ id: string }>(req).id);
  res.setHeader('Content-Type', asset.mimeType);
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('Content-Disposition', `inline; filename="${asset.fileName}"`);
  res.sendFile(abs);
});

doc({ method: 'delete', path: '/assets/:id', summary: 'Delete an asset', tags: ['Assets'], permissions: ['floorplan:manage'], responses: { 204: 'Deleted' } });
assetsRouter.delete('/:id', requirePermission('floorplan:manage'), validate(idParam, 'params'), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  await deleteAsset(req.user!.orgId, id);
  await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: 'asset.delete', entityType: 'Asset', entityId: id, ip: clientIp(req) });
  res.status(204).end();
});
