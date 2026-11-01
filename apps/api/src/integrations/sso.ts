// Enterprise SSO boundary (OpenID Connect, authorization-code flow with PKCE).
// Activated when OIDC_ISSUER_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET and OIDC_REDIRECT_URI are set.
// Discovery, JWKS verification (via jose) and user provisioning are implemented; the identity
// provider must issue an `email` claim. Users are matched by email and must already exist in
// SpaceFlow (just-in-time provisioning is intentionally disabled for least privilege).
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../config/env.js';

export const SSO_REQUIRED_ENV = ['OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI'];

export function ssoConfigured(): boolean {
  return !!(env.OIDC_ISSUER_URL && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET && env.OIDC_REDIRECT_URI);
}

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
}

let discoveryCache: { at: number; doc: Discovery } | null = null;
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

async function discover(): Promise<Discovery> {
  if (discoveryCache && Date.now() - discoveryCache.at < 60 * 60 * 1000) return discoveryCache.doc;
  const url = `${env.OIDC_ISSUER_URL.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
  const doc = (await res.json()) as Discovery;
  discoveryCache = { at: Date.now(), doc };
  jwks = createRemoteJWKSet(new URL(doc.jwks_uri));
  return doc;
}

// In-memory state store for the auth-code flow (single-instance). For multi-instance deploys,
// move this to Redis using REDIS_URL.
const pending = new Map<string, { verifier: string; createdAt: number; returnTo: string }>();

export async function beginSsoLogin(returnTo: string): Promise<string> {
  const doc = await discover();
  const state = randomBytes(16).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  pending.set(state, { verifier, createdAt: Date.now(), returnTo });
  for (const [k, v] of pending) if (Date.now() - v.createdAt > 10 * 60 * 1000) pending.delete(k);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.OIDC_CLIENT_ID,
    redirect_uri: env.OIDC_REDIRECT_URI,
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${doc.authorization_endpoint}?${params.toString()}`;
}

export async function completeSsoLogin(code: string, state: string) {
  const entry = pending.get(state);
  if (!entry) throw new Error('Unknown or expired SSO state');
  pending.delete(state);
  const doc = await discover();
  const res = await fetch(doc.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: env.OIDC_REDIRECT_URI,
      client_id: env.OIDC_CLIENT_ID,
      client_secret: env.OIDC_CLIENT_SECRET,
      code_verifier: entry.verifier,
    }),
  });
  if (!res.ok) throw new Error(`OIDC token exchange failed: ${res.status}`);
  const tokens = (await res.json()) as { id_token: string };
  if (!jwks) throw new Error('JWKS not initialised');
  const { payload } = await jwtVerify(tokens.id_token, jwks, {
    issuer: doc.issuer,
    audience: env.OIDC_CLIENT_ID,
  });
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
  if (!email) throw new Error('Identity provider did not return an email claim');
  return { email, subject: payload.sub ?? null, returnTo: entry.returnTo };
}
