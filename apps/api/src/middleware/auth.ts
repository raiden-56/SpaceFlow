import type { NextFunction, Request, Response } from 'express';
import type { Permission, RoleCode } from '@spaceflow/shared';
import { AppError } from '../lib/errors.js';
import { verifyAccessToken, type AccessTokenClaims } from '../modules/auth/tokens.js';

export interface AuthUser {
  id: string;
  orgId: string;
  email: string;
  roles: RoleCode[];
  permissions: Permission[];
  departmentId: string | null;
  teamId: string | null;
}

export function claimsToUser(claims: AccessTokenClaims): AuthUser {
  return {
    id: claims.sub,
    orgId: claims.org,
    email: claims.email,
    roles: claims.roles,
    permissions: claims.perms,
    departmentId: claims.dep ?? null,
    teamId: claims.team ?? null,
  };
}

async function readToken(req: Request): Promise<AuthUser | null> {
  const header = req.headers.authorization;
  let token: string | undefined;
  if (header?.startsWith('Bearer ')) token = header.slice(7).trim();
  // Short-lived SSE tickets are passed as a query param because EventSource cannot set headers.
  if (!token && typeof req.query.ticket === 'string' && req.path.endsWith('/events')) {
    token = req.query.ticket;
  }
  if (!token) return null;
  const claims = await verifyAccessToken(token);
  return claimsToUser(claims);
}

/** Requires a valid access token. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const user = await readToken(req);
    if (!user) return next(AppError.unauthenticated());
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** Attaches the user when a token is present, but does not fail without one. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const user = await readToken(req);
    if (user) req.user = user;
    next();
  } catch {
    next();
  }
}

/** Requires that the authenticated user holds every listed permission. */
export function requirePermission(...perms: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(AppError.unauthenticated());
    const missing = perms.filter((p) => !req.user!.permissions.includes(p));
    if (missing.length) {
      return next(AppError.forbidden(`Missing permission: ${missing.join(', ')}`));
    }
    next();
  };
}

/** Requires at least one of the listed permissions. */
export function requireAnyPermission(...perms: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(AppError.unauthenticated());
    if (!perms.some((p) => req.user!.permissions.includes(p))) {
      return next(AppError.forbidden());
    }
    next();
  };
}

export function hasPermission(user: AuthUser | undefined, perm: Permission): boolean {
  return !!user?.permissions.includes(perm);
}
