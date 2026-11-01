import type { Request, Response } from 'express';
import type { CurrentUserDto, Permission, RoleCode } from '@spaceflow/shared';
import { ROLE_PERMISSIONS } from '@spaceflow/shared';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { audit, clientIp } from '../../lib/audit.js';
import { hashPassword, randomToken, sha256, verifyPassword } from '../../utils/crypto.js';
import { ACCESS_TTL_SECONDS, signAccessToken, type AccessTokenClaims } from './tokens.js';
import { emailProvider } from '../../integrations/email.js';
import { logger } from '../../lib/logger.js';

export const REFRESH_COOKIE = 'sf_refresh';
const REFRESH_PATH = '/api/v1/auth';

const userInclude = {
  organization: { select: { name: true, settings: true } },
  roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
  department: { select: { name: true } },
  team: { select: { name: true } },
  homeBuilding: { select: { name: true } },
  preferences: true,
} as const;

type UserRow = NonNullable<Awaited<ReturnType<typeof loadUser>>>;

export function loadUser(id: string) {
  return prisma.user.findFirst({ where: { id, deletedAt: null }, include: userInclude });
}

export function permissionsFor(user: { roles: { role: { code: RoleCode; permissions: { permission: { code: string } }[] } }[] }): Permission[] {
  const set = new Set<Permission>();
  for (const ur of user.roles) {
    // DB-assigned permissions are authoritative; fall back to the static map if a role has none seeded.
    const codes = ur.role.permissions.length
      ? ur.role.permissions.map((rp) => rp.permission.code as Permission)
      : ROLE_PERMISSIONS[ur.role.code];
    codes.forEach((c) => set.add(c));
  }
  return [...set];
}

export function toCurrentUserDto(u: UserRow): CurrentUserDto {
  const view = u.preferences?.preferredView ?? 'THREE_D';
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    displayName: `${u.firstName} ${u.lastName}`,
    avatarUrl: u.avatarUrl,
    jobTitle: u.jobTitle,
    departmentId: u.departmentId,
    departmentName: u.department?.name ?? null,
    teamId: u.teamId,
    teamName: u.team?.name ?? null,
    orgId: u.orgId,
    orgName: u.organization.name,
    roles: u.roles.map((r) => r.role.code),
    permissions: permissionsFor(u),
    status: u.status,
    homeBuildingId: u.homeBuildingId,
    homeBuildingName: u.homeBuilding?.name ?? null,
    phone: u.phone,
    preferences: {
      defaultBuildingId: u.preferences?.defaultBuildingId ?? null,
      defaultFloorId: u.preferences?.defaultFloorId ?? null,
      shareLocationWithTeam: u.preferences?.shareLocationWithTeam ?? true,
      emailNotifications: u.preferences?.emailNotifications ?? true,
      preferredView: view === 'THREE_D' ? '3D' : view === 'TWO_D' ? '2D' : 'LIST',
      reducedMotion: u.preferences?.reducedMotion ?? false,
    },
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    isGuest: !!(u.organization.settings as { guest?: boolean } | null)?.guest,
    guestExpiresAt: ((u.organization.settings as { expiresAt?: string } | null)?.expiresAt as string | undefined) ?? null,
  };
}

export function claimsFor(u: UserRow, use: 'access' | 'sse' = 'access'): AccessTokenClaims {
  return {
    sub: u.id,
    org: u.orgId,
    email: u.email,
    roles: u.roles.map((r) => r.role.code),
    perms: permissionsFor(u),
    dep: u.departmentId,
    team: u.teamId,
    use,
  };
}

function setRefreshCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE || env.isProd,
    sameSite: 'strict',
    path: REFRESH_PATH,
    expires: expiresAt,
  });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
}

async function issueRefreshToken(userId: string, req: Request, replacedById?: string) {
  const token = randomToken(48);
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86400000);
  const row = await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256(token),
      expiresAt,
      userAgent: req.headers['user-agent']?.slice(0, 200) ?? null,
      ip: clientIp(req),
      replacedById: replacedById ?? null,
    },
  });
  return { id: row.id, token, expiresAt };
}

/**
 * A rotated refresh token presented again within this window is treated as a concurrent refresh
 * (two tabs refreshing at once), not theft. Outside the window, or for tokens revoked by logout
 * (no replacement recorded), reuse still revokes every session for the user.
 */
export const REFRESH_REUSE_GRACE_MS = 30_000;

export async function issueSession(user: UserRow, req: Request, res: Response) {
  const accessToken = await signAccessToken(claimsFor(user));
  const { token, expiresAt } = await issueRefreshToken(user.id, req);
  setRefreshCookie(res, token, expiresAt);
  return { accessToken, expiresIn: ACCESS_TTL_SECONDS, user: toCurrentUserDto(user) };
}

export async function login(email: string, password: string, req: Request, res: Response) {
  const user = await prisma.user.findFirst({ where: { email: email.toLowerCase(), deletedAt: null }, include: userInclude });
  // Always run the hash comparison to keep timing uniform.
  const ok = await verifyPassword(password, user?.passwordHash ?? 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA');
  if (!user || !ok) throw AppError.unauthenticated('Incorrect email or password.');
  if (user.status === 'DEACTIVATED') throw AppError.forbidden('This account has been deactivated.');
  if (user.status === 'INVITED') throw AppError.forbidden('Please accept your invitation to set a password first.');
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({ orgId: user.orgId, actorId: user.id, action: 'auth.login', entityType: 'User', entityId: user.id, ip: clientIp(req) });
  return issueSession(user, req, res);
}

export async function refresh(req: Request, res: Response) {
  const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!raw) throw AppError.unauthenticated('No refresh token.');
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) }, include: { user: { include: userInclude } } });
  if (!row) throw AppError.unauthenticated('Invalid refresh token.');
  const concurrentRefresh = !!row.revokedAt && !!row.replacedById && Date.now() - row.revokedAt.getTime() <= REFRESH_REUSE_GRACE_MS;
  if (row.revokedAt && !concurrentRefresh) {
    // Reuse of a rotated token outside the grace window indicates theft: revoke every session.
    await prisma.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    logger.warn({ userId: row.userId }, 'refresh token reuse detected; all sessions revoked');
    clearRefreshCookie(res);
    throw AppError.unauthenticated('Session invalidated. Please sign in again.');
  }
  if (row.expiresAt < new Date()) {
    clearRefreshCookie(res);
    throw AppError.tokenExpired();
  }
  if (row.user.status !== 'ACTIVE' || row.user.deletedAt) throw AppError.forbidden('Account is not active.');
  const next = await issueRefreshToken(row.userId, req);
  // Record the replacement so a near-simultaneous second use can be recognised as concurrent.
  // In the grace case the old row is already revoked; keep its original revocation time.
  if (!concurrentRefresh) await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date(), replacedById: next.id } });
  setRefreshCookie(res, next.token, next.expiresAt);
  const accessToken = await signAccessToken(claimsFor(row.user));
  return { accessToken, expiresIn: ACCESS_TTL_SECONDS, user: toCurrentUserDto(row.user) };
}

export async function logout(req: Request, res: Response, userId?: string) {
  const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (raw) await prisma.refreshToken.updateMany({ where: { tokenHash: sha256(raw), revokedAt: null }, data: { revokedAt: new Date() } });
  clearRefreshCookie(res);
  if (userId) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { orgId: true } });
    if (u) await audit({ orgId: u.orgId, actorId: userId, action: 'auth.logout', entityType: 'User', entityId: userId, ip: clientIp(req) });
  }
}

export async function revokeAllSessions(userId: string) {
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function forgotPassword(email: string) {
  const user = await prisma.user.findFirst({ where: { email: email.toLowerCase(), deletedAt: null, status: 'ACTIVE' } });
  // Always respond identically to avoid account enumeration.
  if (!user) return;
  const token = randomToken(32);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordResetTokenHash: sha256(token), passwordResetExpiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  });
  const link = `${env.webOrigins[0]}/reset-password?token=${token}`;
  await emailProvider.send({
    to: user.email,
    subject: '[SpaceFlow] Reset your password',
    text: `Hi ${user.firstName},\n\nUse this link to reset your SpaceFlow password (valid for 1 hour):\n${link}\n\nIf you did not request this, you can ignore this email.`,
  });
}

export async function resetPassword(token: string, password: string) {
  const user = await prisma.user.findFirst({
    where: { passwordResetTokenHash: sha256(token), passwordResetExpiresAt: { gt: new Date() }, deletedAt: null },
  });
  if (!user) throw AppError.badRequest('This reset link is invalid or has expired.');
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password), passwordResetTokenHash: null, passwordResetExpiresAt: null },
  });
  await revokeAllSessions(user.id);
  await audit({ orgId: user.orgId, actorId: user.id, action: 'auth.password-reset', entityType: 'User', entityId: user.id });
}

export async function acceptInvite(token: string, password: string, req: Request, res: Response) {
  const user = await prisma.user.findFirst({
    where: { inviteTokenHash: sha256(token), inviteExpiresAt: { gt: new Date() }, status: 'INVITED', deletedAt: null },
  });
  if (!user) throw AppError.badRequest('This invitation is invalid or has expired.');
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password), inviteTokenHash: null, inviteExpiresAt: null, status: 'ACTIVE', lastLoginAt: new Date() },
    include: userInclude,
  });
  await audit({ orgId: user.orgId, actorId: user.id, action: 'auth.invite-accepted', entityType: 'User', entityId: user.id, ip: clientIp(req) });
  return issueSession(updated, req, res);
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw AppError.badRequest('Current password is incorrect.');
  }
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } });
  await revokeAllSessions(userId);
  await audit({ orgId: user.orgId, actorId: userId, action: 'auth.password-changed', entityType: 'User', entityId: userId });
}

export async function createInviteToken(userId: string): Promise<string> {
  const token = randomToken(32);
  await prisma.user.update({
    where: { id: userId },
    data: { inviteTokenHash: sha256(token), inviteExpiresAt: new Date(Date.now() + 7 * 86400000), status: 'INVITED' },
  });
  return token;
}

export function inviteUrl(token: string) {
  return `${env.webOrigins[0]}/accept-invite?token=${token}`;
}

/** Guest mode: provision a private sandbox organisation with demo data and start a session. */
export async function guestLogin(req: Request, res: Response) {
  if (!env.GUEST_MODE_ENABLED) throw AppError.forbidden('Guest mode is disabled.');
  const { createDemoOrganization } = await import('../../lib/demoData.js');
  const id = randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || Date.now().toString(36);
  const slug = 'guest-' + id;
  const result = await createDemoOrganization(prisma, {
    slug,
    name: 'Guest Workspace',
    emailDomain: slug + '.guest.local',
    adminEmail: 'admin@' + slug + '.guest.local',
    adminPasswordHash: GUEST_LOCKED_HASH,
    userPasswordHash: GUEST_LOCKED_HASH,
    guest: { email: 'guest@' + slug + '.guest.local', firstName: 'Guest', lastName: 'Explorer' },
    seed: Math.floor(Math.random() * 1_000_000),
  });
  const user = (await loadUser(result.employeeUserId))!;
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({ orgId: user.orgId, actorId: user.id, action: 'auth.guest-login', entityType: 'User', entityId: user.id, ip: clientIp(req) });
  logger.info({ orgId: result.orgId, slug }, 'guest sandbox created');
  return issueSession(user, req, res);
}

/** Placeholder hash that can never be matched (password login is disabled for sandbox users). */
const GUEST_LOCKED_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$locked';
