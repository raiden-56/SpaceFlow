import { useState } from 'react';
import { Alert, Box, Card, CardContent, Chip, Grid, Stack, Switch, Typography, FormControlLabel } from '@mui/material';
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import EmailRoundedIcon from '@mui/icons-material/EmailRounded';
import KeyRoundedIcon from '@mui/icons-material/KeyRounded';
import QrCodeRoundedIcon from '@mui/icons-material/QrCodeRounded';
import type { IntegrationDto, IntegrationProvider } from '@spaceflow/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { PageTransition } from '@/components/common/Motion';
import { GridSkeleton, ErrorState } from '@/components/common/Feedback';
import { useIntegrationsQuery, useUpdateIntegrationMutation } from '@/services/endpoints';
import { errorCode, errorDetails, errorMessage } from '@/services/api';
import { useToast } from '@/components/common/ToastProvider';
import { fmtRelative } from '@/utils/time';

const META: Record<IntegrationProvider, { name: string; description: string; icon: React.ReactNode }> = {
  MS365_CALENDAR: { name: 'Microsoft 365 / Outlook Calendar', description: 'Creates and updates Outlook events for confirmed meeting-room bookings via Microsoft Graph. Idempotent: one event per booking, removed on cancellation.', icon: <CalendarMonthRoundedIcon /> },
  GOOGLE_CALENDAR: { name: 'Google Calendar', description: 'Service-account based synchronisation of meeting-room bookings to Google Calendar.', icon: <CalendarMonthRoundedIcon /> },
  MS_TEAMS: { name: 'Microsoft Teams', description: 'Adds a Teams meeting link to room bookings (requires Microsoft Graph credentials).', icon: <GroupsRoundedIcon /> },
  EMAIL_SMTP: { name: 'Email (SMTP)', description: 'Sends booking confirmations, reminders, invitations and password resets. Without SMTP, emails are written to the API log.', icon: <EmailRoundedIcon /> },
  SSO_OIDC: { name: 'Enterprise SSO (OpenID Connect)', description: 'Authorization-code login with PKCE against your identity provider. Users must already exist in SpaceFlow (no silent provisioning).', icon: <KeyRoundedIcon /> },
  QR_CHECKIN: { name: 'QR check-in', description: 'Every booking gets a confirmation code and QR image. Employees check in by scanning or typing the code; no external service needed.', icon: <QrCodeRoundedIcon /> },
};

const STATUS_COLOR: Record<IntegrationDto['status'], 'success' | 'warning' | 'error' | 'default'> = { READY: 'success', DISABLED: 'default', NOT_CONFIGURED: 'warning', ERROR: 'error' };

export function AdminIntegrationsPage() {
  const { data, isLoading, error, refetch } = useIntegrationsQuery();
  const [update, { isLoading: saving }] = useUpdateIntegrationMutation();
  const [notice, setNotice] = useState<{ provider: string; message: string; env?: string[] } | null>(null);
  const toast = useToast();

  const toggle = async (i: IntegrationDto, enabled: boolean) => {
    setNotice(null);
    try {
      await update({ provider: i.provider, isEnabled: enabled, config: i.config }).unwrap();
      toast.success(`${META[i.provider].name} ${enabled ? 'enabled' : 'disabled'}`);
    } catch (err) {
      const code = errorCode(err);
      const details = errorDetails<{ requiredEnv?: string[] }>(err);
      setNotice({ provider: i.provider, message: code === 'INTEGRATION_NOT_CONFIGURED' ? 'This integration is not configured on the server yet.' : errorMessage(err), env: details?.requiredEnv ?? i.requiredEnv });
    }
  };

  return (
    <PageTransition>
      <PageHeader title="Integrations" subtitle="Calendar, email, Teams, SSO and check-in adapters. Credentials live in server environment variables, never in the database." crumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Integrations' }]} />
      {isLoading ? (
        <GridSkeleton count={6} />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <Grid container spacing={2}>
          {(data ?? []).map((i) => {
            const m = META[i.provider];
            return (
              <Grid key={i.provider} size={{ xs: 12, md: 6, xl: 4 }}>
                <Card sx={{ height: '100%' }}>
                  <CardContent>
                    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
                      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
                        <Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: 'rgba(79,70,229,0.08)', color: 'primary.main', display: 'grid', placeItems: 'center' }} aria-hidden>
                          {m.icon}
                        </Box>
                        <Box>
                          <Typography variant="h5" component="h3">
                            {m.name}
                          </Typography>
                          <Chip size="small" label={i.status.replace('_', ' ').toLowerCase()} color={STATUS_COLOR[i.status]} sx={{ mt: 0.5, textTransform: 'capitalize' }} />
                        </Box>
                      </Stack>
                      <FormControlLabel labelPlacement="start" control={<Switch checked={i.isEnabled} disabled={saving || (!i.isConfigured && !i.isEnabled)} onChange={(e) => toggle(i, e.target.checked)} slotProps={{ input: { 'aria-label': `Enable ${m.name}` } }} />} label={<Typography variant="caption">{i.isEnabled ? 'On' : 'Off'}</Typography>} />
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                      {m.description}
                    </Typography>
                    {i.requiredEnv.length > 0 && (
                      <Box sx={{ mt: 1.5 }}>
                        <Typography variant="caption" sx={{ fontWeight: 600 }}>
                          {i.isConfigured ? 'Configured via' : 'Set these environment variables to enable'}
                        </Typography>
                        <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', mt: 0.5 }}>
                          {i.requiredEnv.map((e) => (
                            <Chip key={e} size="small" label={e} sx={{ fontFamily: 'monospace', fontSize: 11 }} />
                          ))}
                        </Stack>
                      </Box>
                    )}
                    {i.lastSyncedAt && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                        Last sync {fmtRelative(i.lastSyncedAt)}
                      </Typography>
                    )}
                    {i.lastError && (
                      <Alert severity="error" sx={{ mt: 1 }}>
                        {i.lastError}
                      </Alert>
                    )}
                    {notice?.provider === i.provider && (
                      <Alert severity="warning" sx={{ mt: 1 }} onClose={() => setNotice(null)}>
                        {notice.message} {notice.env?.length ? `Required: ${notice.env.join(', ')}.` : ''} See docs/integrations.md.
                      </Alert>
                    )}
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}
    </PageTransition>
  );
}
