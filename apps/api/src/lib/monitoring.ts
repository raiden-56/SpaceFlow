// Error monitoring boundary.
// When SENTRY_DSN is set, errors are forwarded to a Sentry-compatible endpoint using the
// store API over plain HTTPS (no SDK dependency). When unset, nothing leaves the process and
// errors are only logged.
import { env } from '../config/env.js';
import { logger } from './logger.js';

interface ParsedDsn {
  publicKey: string;
  host: string;
  projectId: string;
  protocol: string;
}

function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\//, '');
    if (!u.username || !projectId) return null;
    return { publicKey: u.username, host: u.host, projectId, protocol: u.protocol.replace(':', '') };
  } catch {
    return null;
  }
}

const dsn = env.SENTRY_DSN ? parseDsn(env.SENTRY_DSN) : null;

export const monitoringEnabled = !!dsn;

export function captureException(err: unknown, context: Record<string, unknown> = {}): void {
  if (!dsn) return;
  const e = err instanceof Error ? err : new Error(String(err));
  const payload = {
    event_id: crypto.randomUUID().replace(/-/g, ''),
    timestamp: new Date().toISOString(),
    platform: 'node',
    level: 'error',
    environment: env.NODE_ENV,
    release: `spaceflow-api@${process.env.npm_package_version ?? '0.1.0'}`,
    exception: { values: [{ type: e.name, value: e.message, stacktrace: { frames: [] } }] },
    extra: { ...context, stack: e.stack },
  };
  const url = `${dsn.protocol}://${dsn.host}/api/${dsn.projectId}/store/`;
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=spaceflow/0.1`,
    },
    body: JSON.stringify(payload),
  }).catch((fetchErr) => logger.warn({ err: fetchErr }, 'failed to forward error to monitoring'));
}
