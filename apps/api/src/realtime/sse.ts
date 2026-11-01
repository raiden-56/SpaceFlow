// Server-Sent Events hub. Clients connect to GET /api/v1/events?ticket=<short-lived token>.
// Events are broadcast per organization; the client decides which floors/resources it cares
// about. Real-time events are a hint to refresh — authoritative state always comes from the API.
import type { Response } from 'express';
import type { RealtimeEvent } from '@spaceflow/shared';
import { logger } from '../lib/logger.js';

interface Client {
  id: string;
  orgId: string;
  userId: string;
  res: Response;
}

const clients = new Map<string, Client>();
let heartbeat: NodeJS.Timeout | null = null;

function write(client: Client, event: RealtimeEvent) {
  try {
    client.res.write(`event: ${event.type}\n`);
    client.res.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch (err) {
    logger.debug({ err, clientId: client.id }, 'sse write failed, dropping client');
    clients.delete(client.id);
  }
}

export function addClient(id: string, orgId: string, userId: string, res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  const client: Client = { id, orgId, userId, res };
  clients.set(id, client);
  write(client, { type: 'ping', payload: { connected: true }, at: new Date().toISOString() });
  res.on('close', () => clients.delete(id));
  if (!heartbeat) {
    heartbeat = setInterval(() => {
      const ev: RealtimeEvent = { type: 'ping', payload: {}, at: new Date().toISOString() };
      for (const c of clients.values()) write(c, ev);
    }, 25_000);
    heartbeat.unref();
  }
}

export function broadcastToOrg(orgId: string, type: RealtimeEvent['type'], payload: Record<string, unknown>) {
  const event: RealtimeEvent = { type, payload, at: new Date().toISOString() };
  for (const c of clients.values()) if (c.orgId === orgId) write(c, event);
}

export function sendToUser(userId: string, type: RealtimeEvent['type'], payload: Record<string, unknown>) {
  const event: RealtimeEvent = { type, payload, at: new Date().toISOString() };
  for (const c of clients.values()) if (c.userId === userId) write(c, event);
}

export function connectedClients(): number {
  return clients.size;
}

export function closeAll() {
  for (const c of clients.values()) {
    try {
      c.res.end();
    } catch {
      /* ignore */
    }
  }
  clients.clear();
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
}
