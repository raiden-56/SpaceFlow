import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import type { Permission, RoleCode } from '@spaceflow/shared';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';

export interface AccessTokenClaims {
  sub: string;
  org: string;
  email: string;
  roles: RoleCode[];
  perms: Permission[];
  dep?: string | null;
  team?: string | null;
  /** token purpose: "access" (API) or "sse" (short-lived EventSource ticket) */
  use?: 'access' | 'sse';
}

const accessKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const ISSUER = 'spaceflow';
const AUDIENCE = 'spaceflow-web';

export function ttlToSeconds(ttl: string): number {
  const m = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!m) return 900;
  const n = Number(m[1]);
  return m[2] === 's' ? n : m[2] === 'm' ? n * 60 : m[2] === 'h' ? n * 3600 : n * 86400;
}

export const ACCESS_TTL_SECONDS = ttlToSeconds(env.ACCESS_TOKEN_TTL);

export async function signAccessToken(claims: AccessTokenClaims, ttlSeconds = ACCESS_TTL_SECONDS) {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(accessKey);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, accessKey, { issuer: ISSUER, audience: AUDIENCE });
    return payload as unknown as AccessTokenClaims;
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) throw AppError.tokenExpired();
    throw AppError.unauthenticated('Invalid access token');
  }
}
