import type { Request } from 'express';
import { prisma, type Tx } from './prisma.js';
import { logger } from './logger.js';

export interface AuditInput {
  orgId: string;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

const SENSITIVE_KEYS = new Set([
  'passwordHash',
  'password',
  'inviteTokenHash',
  'passwordResetTokenHash',
  'tokenHash',
  'checkInCode',
]);

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k) ? '[REDACTED]' : v instanceof Date ? v.toISOString() : scrub(v);
    }
    return out;
  }
  return value;
}

export async function audit(input: AuditInput, tx: Tx | typeof prisma = prisma) {
  try {
    await tx.auditLog.create({
      data: {
        orgId: input.orgId,
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        before: input.before === undefined ? undefined : (scrub(input.before) as object),
        after: input.after === undefined ? undefined : (scrub(input.after) as object),
        ip: input.ip ?? null,
      },
    });
  } catch (err) {
    logger.error({ err, action: input.action }, 'failed to write audit log');
  }
}

export function clientIp(req: Request): string | null {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.ip ?? null;
}
