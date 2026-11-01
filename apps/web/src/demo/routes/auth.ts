// Sign-in for demo mode. There are no accounts: "Continue as guest" builds a fresh sandbox in the
// browser and the session survives reloads (localStorage) until sign-out or the sandbox expires.
import type { AuthResponseDto } from '@spaceflow/shared';
import { DemoError, Reply, SANDBOX_TTL, dropSandbox, findUser, getDb, hasSession, newSandbox, setSession, toCurrentUserDto } from '../core';
import { get, post, type Route } from '../router';
import type { DemoDb } from '../db';

const NO_ACCOUNTS = 'This is a demo without a backend, so there are no accounts. Use “Continue as guest” to explore SpaceFlow with sample data.';

function session(db: DemoDb): AuthResponseDto {
  const me = findUser(db, db.guestUserId)!;
  return { accessToken: `demo.${db.org.slug}`, expiresIn: 900, user: toCurrentUserDto(db, me) };
}

export const authRoutes: Route[] = [
  get('/auth/guest/status', () => ({ enabled: true, sandboxTtlHours: SANDBOX_TTL }), { public: true }),
  get('/auth/sso/status', () => ({ enabled: false, provider: null }), { public: true }),
  post(
    '/auth/guest',
    () => {
      dropSandbox();
      const db = newSandbox();
      setSession(true);
      return session(db);
    },
    { public: true },
  ),
  post(
    '/auth/refresh',
    () => {
      const db = getDb();
      if (!db || !hasSession()) throw DemoError.unauthenticated();
      return session(db);
    },
    { public: true },
  ),
  post(
    '/auth/logout',
    () => {
      dropSandbox();
      return new Reply(204);
    },
    { public: true },
  ),
  post(
    '/auth/login',
    () => {
      throw new DemoError(401, 'UNAUTHENTICATED', NO_ACCOUNTS);
    },
    { public: true },
  ),
  post('/auth/forgot-password', () => ({ ok: true, message: NO_ACCOUNTS }), { public: true }),
  post(
    '/auth/reset-password',
    () => {
      throw DemoError.badRequest(NO_ACCOUNTS);
    },
    { public: true },
  ),
  post(
    '/auth/accept-invite',
    () => {
      throw DemoError.badRequest(NO_ACCOUNTS);
    },
    { public: true },
  ),
  get('/auth/me', ({ db }) => toCurrentUserDto(db, findUser(db, db.guestUserId)!)),
  post('/auth/change-password', () => {
    throw DemoError.badRequest('Guest sessions have no password to change.');
  }),
];
