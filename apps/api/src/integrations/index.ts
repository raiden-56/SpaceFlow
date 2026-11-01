import type { IntegrationDto, IntegrationProvider } from '@spaceflow/shared';
import { prisma } from '../lib/prisma.js';
import { EMAIL_REQUIRED_ENV, emailConfigured } from './email.js';
import { calendarAdapters } from './calendar.js';
import { SSO_REQUIRED_ENV, ssoConfigured } from './sso.js';
import { env } from '../config/env.js';

interface ProviderMeta {
  provider: IntegrationProvider;
  requiredEnv: string[];
  configured: () => boolean;
}

export const providerMeta: ProviderMeta[] = [
  {
    provider: 'MS365_CALENDAR',
    requiredEnv: calendarAdapters[0].requiredEnv,
    configured: () => calendarAdapters[0].configured,
  },
  {
    provider: 'GOOGLE_CALENDAR',
    requiredEnv: calendarAdapters[1].requiredEnv,
    configured: () => calendarAdapters[1].configured,
  },
  {
    provider: 'MS_TEAMS',
    requiredEnv: ['MS_GRAPH_TENANT_ID', 'MS_GRAPH_CLIENT_ID', 'MS_GRAPH_CLIENT_SECRET'],
    configured: () => !!(env.MS_GRAPH_TENANT_ID && env.MS_GRAPH_CLIENT_ID && env.MS_GRAPH_CLIENT_SECRET),
  },
  { provider: 'EMAIL_SMTP', requiredEnv: EMAIL_REQUIRED_ENV, configured: () => emailConfigured },
  { provider: 'SSO_OIDC', requiredEnv: SSO_REQUIRED_ENV, configured: ssoConfigured },
  // QR check-in has no external dependency: codes are generated and verified locally.
  { provider: 'QR_CHECKIN', requiredEnv: [], configured: () => true },
];

export async function listIntegrations(orgId: string): Promise<IntegrationDto[]> {
  const rows = await prisma.integrationConfig.findMany({ where: { orgId } });
  return providerMeta.map((meta) => {
    const row = rows.find((r) => r.provider === meta.provider);
    const configured = meta.configured();
    const isEnabled = row?.isEnabled ?? meta.provider === 'QR_CHECKIN';
    let status: IntegrationDto['status'] = 'NOT_CONFIGURED';
    if (configured && isEnabled) status = row?.status === 'ERROR' ? 'ERROR' : 'READY';
    else if (configured && !isEnabled) status = 'DISABLED';
    return {
      provider: meta.provider,
      isEnabled,
      isConfigured: configured,
      status,
      config: (row?.config as Record<string, unknown>) ?? {},
      requiredEnv: meta.requiredEnv,
      lastError: row?.lastError ?? null,
      lastSyncedAt: row?.lastSyncedAt?.toISOString() ?? null,
    };
  });
}
