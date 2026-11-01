import type { AuthUser } from '../middleware/auth.js';

declare global {
  namespace Express {
    interface Request {
      /** Authenticated principal (set by requireAuth / optionalAuth). */
      user?: AuthUser;
      /** Correlation id echoed in the X-Request-Id header and logs. */
      requestId: string;
      /** Parsed + validated inputs populated by the validate() middleware. */
      validated: { body?: unknown; query?: unknown; params?: unknown };
    }
  }
}

export {};
