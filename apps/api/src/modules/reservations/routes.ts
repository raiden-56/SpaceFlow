import { Router } from 'express';
import { z } from 'zod';
import QRCode from 'qrcode';
import {
  approvalDecisionSchema,
  checkInSchema,
  paginationQuerySchema,
  reservationCancelSchema,
  reservationCreateSchema,
  reservationListQuerySchema,
  reservationUpdateSchema,
  type ReservationCreateInput,
  type ReservationListQuery,
  type ReservationUpdateInput,
} from '@spaceflow/shared';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { validate, body, params, query } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import { doc } from '../../openapi/registry.js';
import { clientIp } from '../../lib/audit.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { buildIcs } from '../../integrations/calendar.js';
import * as svc from './service.js';
import { env } from '../../config/env.js';

export const reservationsRouter = Router();
reservationsRouter.use(requireAuth);
const idParam = z.object({ id: z.string().uuid() });

doc({ method: 'get', path: '/reservations', summary: 'List reservations (own, or any with reservation:manage-any)', tags: ['Reservations'], query: reservationListQuerySchema });
reservationsRouter.get('/', validate(reservationListQuerySchema, 'query'), async (req, res) => {
  const q = query<ReservationListQuery>(req);
  const canSeeAll = req.user!.permissions.includes('reservation:manage-any');
  res.json(await svc.listReservations(req.user!, q, { ownOnly: !canSeeAll }));
});

doc({ method: 'get', path: '/reservations/approvals', summary: 'Pending approval requests', tags: ['Reservations'], permissions: ['reservation:approve'], query: paginationQuerySchema });
reservationsRouter.get('/approvals', requirePermission('reservation:approve'), validate(paginationQuerySchema, 'query'), async (req, res) => {
  const q = query<{ page: number; pageSize: number }>(req);
  res.json(await svc.listPendingApprovals(req.user!, q.page, q.pageSize));
});

doc({ method: 'post', path: '/reservations', summary: 'Create a reservation (single, multi-day or recurring)', tags: ['Reservations'], body: reservationCreateSchema, responses: { 201: 'Created (BatchReservationResult)', 409: 'Booking conflict (with alternatives)', 422: 'Policy violation' } });
reservationsRouter.post('/', writeLimiter, validate(reservationCreateSchema), async (req, res) => {
  const result = await svc.createReservations(req.user!, body<ReservationCreateInput>(req), { ip: clientIp(req) });
  res.status(result.created.length ? 201 : 409).json(result);
});

doc({ method: 'get', path: '/reservations/:id', summary: 'Reservation details', tags: ['Reservations'] });
reservationsRouter.get('/:id', validate(idParam, 'params'), async (req, res) => {
  res.json(await svc.getReservation(req.user!, params<{ id: string }>(req).id));
});

doc({ method: 'patch', path: '/reservations/:id', summary: 'Modify a reservation', tags: ['Reservations'], body: reservationUpdateSchema, responses: { 200: 'Updated', 409: 'Conflict', 422: 'Policy violation' } });
reservationsRouter.patch('/:id', writeLimiter, validate(idParam, 'params'), validate(reservationUpdateSchema), async (req, res) => {
  res.json(await svc.updateReservation(req.user!, params<{ id: string }>(req).id, body<ReservationUpdateInput>(req), { ip: clientIp(req) }));
});

doc({ method: 'post', path: '/reservations/:id/cancel', summary: 'Cancel a reservation (record is kept)', tags: ['Reservations'], body: reservationCancelSchema });
reservationsRouter.post('/:id/cancel', validate(idParam, 'params'), validate(reservationCancelSchema), async (req, res) => {
  res.json(await svc.cancelReservation(req.user!, params<{ id: string }>(req).id, body<{ reason?: string; cancelSeries?: boolean }>(req), { ip: clientIp(req) }));
});

doc({ method: 'post', path: '/reservations/:id/check-in', summary: 'Check in (optionally with the QR/confirmation code)', tags: ['Reservations'], body: checkInSchema });
reservationsRouter.post('/:id/check-in', validate(idParam, 'params'), validate(checkInSchema), async (req, res) => {
  res.json(await svc.checkIn(req.user!, params<{ id: string }>(req).id, body<{ code?: string }>(req).code, { ip: clientIp(req) }));
});

doc({ method: 'post', path: '/reservations/:id/check-out', summary: 'Check out early and release the resource', tags: ['Reservations'] });
reservationsRouter.post('/:id/check-out', validate(idParam, 'params'), async (req, res) => {
  res.json(await svc.checkOut(req.user!, params<{ id: string }>(req).id, { ip: clientIp(req) }));
});

doc({ method: 'post', path: '/reservations/:id/approval', summary: 'Approve or reject a pending reservation', tags: ['Reservations'], permissions: ['reservation:approve'], body: approvalDecisionSchema });
reservationsRouter.post('/:id/approval', requirePermission('reservation:approve'), validate(idParam, 'params'), validate(approvalDecisionSchema), async (req, res) => {
  const { decision, note } = body<{ decision: 'APPROVED' | 'REJECTED'; note?: string }>(req);
  res.json(await svc.decideApproval(req.user!, params<{ id: string }>(req).id, decision, note, { ip: clientIp(req) }));
});

doc({ method: 'get', path: '/reservations/:id/qr', summary: 'QR code (PNG data URL) encoding the check-in link', tags: ['Reservations'] });
reservationsRouter.get('/:id/qr', validate(idParam, 'params'), async (req, res) => {
  const dto = await svc.getReservation(req.user!, params<{ id: string }>(req).id);
  if (!dto.checkInCode) throw AppError.forbidden();
  const url = `${env.webOrigins[0]}/check-in?reservation=${dto.id}&code=${encodeURIComponent(dto.checkInCode)}`;
  const dataUrl = await QRCode.toDataURL(url, { width: 320, margin: 1, errorCorrectionLevel: 'M' });
  res.json({ reservationId: dto.id, code: dto.checkInCode, url, dataUrl });
});

doc({ method: 'get', path: '/reservations/:id/ics', summary: 'Download an .ics calendar file', tags: ['Reservations'] });
reservationsRouter.get('/:id/ics', validate(idParam, 'params'), async (req, res) => {
  const dto = await svc.getReservation(req.user!, params<{ id: string }>(req).id);
  const owner = await prisma.user.findUnique({ where: { id: dto.userId }, select: { email: true } });
  const ics = buildIcs({
    reservationId: dto.id,
    title: dto.title ?? `${dto.resourceName} (${dto.resourceCode})`,
    description: `${dto.resourceType === 'SEAT' ? 'Desk' : 'Meeting room'} booking in SpaceFlow. Check-in code: ${dto.checkInCode ?? 'n/a'}`,
    location: `${dto.resourceName}, ${dto.floorName}, ${dto.buildingName}`,
    startAt: new Date(dto.startAt),
    endAt: new Date(dto.endAt),
    timezone: dto.timezone,
    organizerEmail: owner?.email ?? 'no-reply@spaceflow.local',
    attendeeEmails: dto.attendees.map((a) => a.email).filter((e): e is string => !!e),
  });
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="spaceflow-${dto.resourceCode}.ics"`);
  res.send(ics);
});
