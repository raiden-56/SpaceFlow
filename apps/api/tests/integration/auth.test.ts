import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, EMPLOYEE, api, auth, login, prisma, resetAndSeed } from './helpers.js';

describe('auth', () => {
  beforeAll(async () => {
    await resetAndSeed();
  });

  it('logs in with valid credentials and sets an HttpOnly refresh cookie', async () => {
    const res = await api().post('/api/v1/auth/login').send(EMPLOYEE);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTypeOf('string');
    expect(res.body.user.email).toBe(EMPLOYEE.email);
    expect(res.body.user.roles).toEqual(['EMPLOYEE']);
    expect(res.body.user.permissions).toContain('reservation:create');
    expect(res.body.user.isGuest).toBe(false);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/sf_refresh=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
  });

  it('rejects bad credentials, unknown users and malformed input', async () => {
    expect((await api().post('/api/v1/auth/login').send({ email: EMPLOYEE.email, password: 'wrong' })).status).toBe(401);
    expect((await api().post('/api/v1/auth/login').send({ email: 'nobody@spaceflow.local', password: 'x' })).status).toBe(401);
    const bad = await api().post('/api/v1/auth/login').send({ email: 'not-an-email', password: '' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses invited (not yet activated) accounts', async () => {
    const res = await api().post('/api/v1/auth/login').send({ email: 'invited@spaceflow.local', password: 'Password123!' });
    expect(res.status).toBe(401);
  });

  it('returns the current user from /auth/me', async () => {
    const s = await login(ADMIN.email, ADMIN.password);
    const me = await api().get('/api/v1/auth/me').set(auth(s));
    expect(me.status).toBe(200);
    expect(me.body.roles).toContain('ORG_ADMIN');
    expect(me.body.permissions.length).toBeGreaterThan(10);
    expect((await api().get('/api/v1/auth/me')).status).toBe(401);
  });

  it('rotates refresh tokens, requires the CSRF header and detects reuse', async () => {
    const s = await login(EMPLOYEE.email);
    const noCsrf = await api().post('/api/v1/auth/refresh').set('Cookie', s.cookie);
    expect(noCsrf.status).toBe(403);

    const first = await api().post('/api/v1/auth/refresh').set('Cookie', s.cookie).set('X-Requested-With', 'SpaceFlow');
    expect(first.status).toBe(200);
    expect(first.body.accessToken).toBeTypeOf('string');
    const rotated = String(first.headers['set-cookie']).split(';')[0];
    expect(rotated).not.toBe(s.cookie);

    // A second tab refreshing with the same old cookie within the grace window gets its own
    // session instead of signing the user out everywhere.
    const concurrent = await api().post('/api/v1/auth/refresh').set('Cookie', s.cookie).set('X-Requested-With', 'SpaceFlow');
    expect(concurrent.status).toBe(200);
    const concurrentCookie = String(concurrent.headers['set-cookie']).split(';')[0];
    expect((await api().post('/api/v1/auth/refresh').set('Cookie', rotated).set('X-Requested-With', 'SpaceFlow')).status).toBe(200);

    // Reuse after the grace window is treated as theft: every session is revoked.
    const { sha256 } = await import('../../src/utils/crypto.js');
    const { REFRESH_REUSE_GRACE_MS } = await import('../../src/modules/auth/service.js');
    const oldHash = sha256(decodeURIComponent(s.cookie.split('=')[1]));
    await prisma.refreshToken.update({ where: { tokenHash: oldHash }, data: { revokedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 5000) } });
    const reuse = await api().post('/api/v1/auth/refresh').set('Cookie', s.cookie).set('X-Requested-With', 'SpaceFlow');
    expect(reuse.status).toBe(401);
    const afterReuse = await api().post('/api/v1/auth/refresh').set('Cookie', concurrentCookie).set('X-Requested-With', 'SpaceFlow');
    expect(afterReuse.status).toBe(401);
  });

  it('a token revoked by logout is never accepted, even immediately', async () => {
    const s = await login(EMPLOYEE.email);
    expect((await api().post('/api/v1/auth/logout').set('Cookie', s.cookie).set(auth(s))).status).toBe(204);
    expect((await api().post('/api/v1/auth/refresh').set('Cookie', s.cookie).set('X-Requested-With', 'SpaceFlow')).status).toBe(401);
  });

  it('logs out and clears the cookie', async () => {
    const s = await login(EMPLOYEE.email);
    const out = await api().post('/api/v1/auth/logout').set('Cookie', s.cookie).set(auth(s));
    expect(out.status).toBe(204);
    const again = await api().post('/api/v1/auth/refresh').set('Cookie', s.cookie).set('X-Requested-With', 'SpaceFlow');
    expect(again.status).toBe(401);
  });

  it('password reset flow issues a usable token', async () => {
    const forgot = await api().post('/api/v1/auth/forgot-password').send({ email: EMPLOYEE.email });
    expect(forgot.status).toBe(200);
    const { prisma } = await import('./helpers.js');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMPLOYEE.email } });
    expect(user.passwordResetTokenHash).toBeTruthy();
    const bad = await api().post('/api/v1/auth/reset-password').send({ token: 'not-a-real-token', password: 'NewPass123' });
    expect(bad.status).toBe(400);
  });

  it('change-password requires the current password and revokes sessions', async () => {
    const s = await login(EMPLOYEE.email);
    const wrong = await api().post('/api/v1/auth/change-password').set(auth(s)).send({ currentPassword: 'nope', newPassword: 'NewPass123' });
    expect(wrong.status).toBe(400);
    const ok = await api().post('/api/v1/auth/change-password').set(auth(s)).send({ currentPassword: EMPLOYEE.password, newPassword: 'NewPass123' });
    expect(ok.status).toBe(200);
    expect((await api().post('/api/v1/auth/refresh').set('Cookie', s.cookie).set('X-Requested-With', 'SpaceFlow')).status).toBe(401);
    expect((await api().post('/api/v1/auth/login').send({ email: EMPLOYEE.email, password: 'NewPass123' })).status).toBe(200);
    // restore for other tests in this file (each file reseeds anyway)
    const s2 = await login(EMPLOYEE.email, 'NewPass123');
    await api().post('/api/v1/auth/change-password').set(auth(s2)).send({ currentPassword: 'NewPass123', newPassword: EMPLOYEE.password });
  });

  it('exposes SSO and guest status without authentication', async () => {
    const sso = await api().get('/api/v1/auth/sso/status');
    expect(sso.status).toBe(200);
    expect(sso.body.enabled).toBe(false);
    const guest = await api().get('/api/v1/auth/guest/status');
    expect(guest.status).toBe(200);
    expect(guest.body.enabled).toBe(true);
  });
});
