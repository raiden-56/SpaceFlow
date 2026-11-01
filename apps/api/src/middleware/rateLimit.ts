import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const common = {
  standardHeaders: 'draft-7' as const,
  legacyHeaders: false,
  skip: () => env.isTest,
  handler: (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
    res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down and try again shortly.' },
    });
  },
};

/** Tight limit for credential-based endpoints (login, password reset, invite). */
export const authLimiter = rateLimit({ ...common, windowMs: 15 * 60 * 1000, limit: 20 });

/** Moderate limit for write-heavy endpoints (reservations, uploads). */
export const writeLimiter = rateLimit({ ...common, windowMs: 60 * 1000, limit: 120 });

/** Baseline limit applied to the whole API. */
export const apiLimiter = rateLimit({ ...common, windowMs: 60 * 1000, limit: 600 });
