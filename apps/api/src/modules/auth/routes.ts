import { Router } from 'express';
import {
  acceptInviteSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
} from '@spaceflow/shared';
import { validate, body } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { authLimiter } from '../../middleware/rateLimit.js';
import { doc } from '../../openapi/registry.js';
import { AppError } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import * as auth from './service.js';
import { beginSsoLogin, completeSsoLogin, ssoConfigured, SSO_REQUIRED_ENV } from '../../integrations/sso.js';
import { signAccessToken } from './tokens.js';
import { audit, clientIp } from '../../lib/audit.js';

export const authRouter = Router();

/** Refresh/logout use the HttpOnly cookie; require a custom header as CSRF protection (SameSite=strict + header). */
function requireCsrfHeader(req: Parameters<typeof requireAuth>[0], _res: unknown, next: (err?: unknown) => void) {
  if (req.headers['x-requested-with'] !== 'SpaceFlow') return next(AppError.forbidden('Missing CSRF header'));
  next();
}

doc({ method: 'post', path: '/auth/login', summary: 'Sign in with email and password', tags: ['Auth'], auth: false, body: loginSchema, responses: { 200: 'Access token + user', 401: 'Invalid credentials' } });
authRouter.post('/login', authLimiter, validate(loginSchema), async (req, res) => {
  const { email, password } = body<{ email: string; password: string }>(req);
  res.json(await auth.login(email, password, req, res));
});

doc({ method: 'post', path: '/auth/refresh', summary: 'Rotate the refresh cookie and issue a new access token', tags: ['Auth'], auth: false });
authRouter.post('/refresh', authLimiter, requireCsrfHeader, async (req, res) => {
  res.json(await auth.refresh(req, res));
});

doc({ method: 'post', path: '/auth/logout', summary: 'Revoke the current session', tags: ['Auth'], auth: false });
authRouter.post('/logout', requireCsrfHeader, async (req, res) => {
  let userId: string | undefined;
  try {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      const { verifyAccessToken } = await import('./tokens.js');
      userId = (await verifyAccessToken(header.slice(7))).sub;
    }
  } catch {
    /* token may be expired; logout still clears the cookie */
  }
  await auth.logout(req, res, userId);
  res.status(204).end();
});

doc({ method: 'post', path: '/auth/forgot-password', summary: 'Request a password reset email', tags: ['Auth'], auth: false, body: forgotPasswordSchema });
authRouter.post('/forgot-password', authLimiter, validate(forgotPasswordSchema), async (req, res) => {
  await auth.forgotPassword(body<{ email: string }>(req).email);
  res.json({ ok: true, message: 'If an account exists for that email, a reset link has been sent.' });
});

doc({ method: 'post', path: '/auth/reset-password', summary: 'Set a new password using a reset token', tags: ['Auth'], auth: false, body: resetPasswordSchema });
authRouter.post('/reset-password', authLimiter, validate(resetPasswordSchema), async (req, res) => {
  const { token, password } = body<{ token: string; password: string }>(req);
  await auth.resetPassword(token, password);
  res.json({ ok: true });
});

doc({ method: 'post', path: '/auth/accept-invite', summary: 'Activate an invited account by setting a password', tags: ['Auth'], auth: false, body: acceptInviteSchema });
authRouter.post('/accept-invite', authLimiter, validate(acceptInviteSchema), async (req, res) => {
  const { token, password } = body<{ token: string; password: string }>(req);
  res.json(await auth.acceptInvite(token, password, req, res));
});

doc({ method: 'post', path: '/auth/change-password', summary: 'Change the current password', tags: ['Auth'], body: changePasswordSchema });
authRouter.post('/change-password', requireAuth, validate(changePasswordSchema), async (req, res) => {
  const { currentPassword, newPassword } = body<{ currentPassword: string; newPassword: string }>(req);
  await auth.changePassword(req.user!.id, currentPassword, newPassword);
  res.json({ ok: true });
});

doc({ method: 'post', path: '/auth/guest', summary: 'Guest mode: create a private demo sandbox and sign in without an account', tags: ['Auth'], auth: false, responses: { 200: 'Access token + guest user', 403: 'Guest mode disabled' } });
authRouter.post('/guest', authLimiter, async (req, res) => {
  res.json(await auth.guestLogin(req, res));
});

doc({ method: 'get', path: '/auth/guest/status', summary: 'Whether guest mode is enabled', tags: ['Auth'], auth: false });
authRouter.get('/guest/status', (_req, res) => {
  res.json({ enabled: env.GUEST_MODE_ENABLED, sandboxTtlHours: env.GUEST_SANDBOX_TTL_HOURS });
});

doc({ method: 'get', path: '/auth/me', summary: 'Current user profile, roles and permissions', tags: ['Auth'] });
authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await auth.loadUser(req.user!.id);
  if (!user) throw AppError.unauthenticated();
  res.json(auth.toCurrentUserDto(user));
});

doc({ method: 'get', path: '/auth/sso/status', summary: 'Whether enterprise SSO (OIDC) is configured', tags: ['Auth'], auth: false });
authRouter.get('/sso/status', (_req, res) => {
  res.json({ enabled: ssoConfigured(), provider: ssoConfigured() ? 'OIDC' : null, requiredEnv: SSO_REQUIRED_ENV });
});

doc({ method: 'get', path: '/auth/sso/login', summary: 'Start the OIDC authorization-code flow', tags: ['Auth'], auth: false, responses: { 302: 'Redirect to identity provider', 501: 'SSO not configured' } });
authRouter.get('/sso/login', async (req, res) => {
  if (!ssoConfigured()) throw AppError.integrationNotConfigured('SSO', SSO_REQUIRED_ENV);
  const returnTo = typeof req.query.returnTo === 'string' && req.query.returnTo.startsWith('/') ? req.query.returnTo : '/';
  res.redirect(await beginSsoLogin(returnTo));
});

doc({ method: 'get', path: '/auth/sso/callback', summary: 'OIDC callback: exchanges the code and starts a SpaceFlow session', tags: ['Auth'], auth: false });
authRouter.get('/sso/callback', async (req, res) => {
  if (!ssoConfigured()) throw AppError.integrationNotConfigured('SSO', SSO_REQUIRED_ENV);
  const code = String(req.query.code ?? '');
  const state = String(req.query.state ?? '');
  const { email, subject, returnTo } = await completeSsoLogin(code, state);
  const user = await prisma.user.findFirst({ where: { email, deletedAt: null }, include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } }, organization: true, department: true, team: true, homeBuilding: true, preferences: true } });
  if (!user || user.status === 'DEACTIVATED') return res.redirect(`${env.webOrigins[0]}/login?error=sso_no_account`);
  await prisma.user.update({ where: { id: user.id }, data: { ssoSubject: subject, status: 'ACTIVE', lastLoginAt: new Date() } });
  await audit({ orgId: user.orgId, actorId: user.id, action: 'auth.sso-login', entityType: 'User', entityId: user.id, ip: clientIp(req) });
  const session = await auth.issueSession(user, req, res);
  // Hand the access token to the SPA through a one-time short-lived token in the fragment.
  const handoff = await signAccessToken(auth.claimsFor(user), 60);
  void session;
  res.redirect(`${env.webOrigins[0]}/sso/complete#token=${handoff}&returnTo=${encodeURIComponent(returnTo)}`);
});
