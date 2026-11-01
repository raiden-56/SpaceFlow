import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { doc } from '../../openapi/registry.js';
import { signAccessToken } from '../auth/tokens.js';
import { addClient, connectedClients } from '../../realtime/sse.js';
import { AppError } from '../../lib/errors.js';

export const realtimeRouter = Router();

doc({ method: 'post', path: '/events/ticket', summary: 'Issue a short-lived ticket for the SSE stream (EventSource cannot send headers)', tags: ['Realtime'] });
realtimeRouter.post('/ticket', requireAuth, async (req, res) => {
  const u = req.user!;
  const ticket = await signAccessToken({ sub: u.id, org: u.orgId, email: u.email, roles: u.roles, perms: u.permissions, dep: u.departmentId, team: u.teamId, use: 'sse' }, 60);
  res.json({ ticket, expiresIn: 60 });
});

doc({ method: 'get', path: '/events', summary: 'Server-Sent Events stream: availability.changed, reservation.updated, notification.created, floorplan.published', tags: ['Realtime'], responses: { 200: 'text/event-stream' } });
realtimeRouter.get('/', requireAuth, (req, res) => {
  if (!req.user) throw AppError.unauthenticated();
  addClient(randomUUID(), req.user.orgId, req.user.id, res);
});

realtimeRouter.get('/stats', requireAuth, (_req, res) => {
  res.json({ connectedClients: connectedClients() });
});
