import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export const prisma = new PrismaClient({
  datasources: { db: { url: env.DATABASE_URL } },
  log: env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'trace' ? ['query', 'warn', 'error'] : ['error'],
});

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export async function checkDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (err) {
    logger.error({ err }, 'database health check failed');
    return false;
  }
}

/** PostgreSQL exclusion constraint violation (overlapping reservation). */
export function isExclusionViolation(err: unknown): boolean {
  const e = err as { code?: string; meta?: { code?: string }; message?: string };
  return (
    e?.code === '23P01' ||
    e?.meta?.code === '23P01' ||
    (typeof e?.message === 'string' && e.message.includes('reservations_no_overlap'))
  );
}

/** Serialization failure under SERIALIZABLE isolation (retryable). */
export function isSerializationFailure(err: unknown): boolean {
  const e = err as { code?: string; meta?: { code?: string }; message?: string };
  return (
    e?.code === '40001' ||
    e?.meta?.code === '40001' ||
    (typeof e?.message === 'string' && e.message.includes('could not serialize'))
  );
}
