import { useEffect, useState } from 'react';
import { Alert, Autocomplete, Button, Card, CardContent, Checkbox, FormControl, FormControlLabel, FormGroup, Grid, InputLabel, MenuItem, Select, Stack, Switch, TextField, Typography, CircularProgress } from '@mui/material';
import { PageHeader } from '@/components/common/PageHeader';
import { PageTransition } from '@/components/common/Motion';
import { CardSkeleton, ErrorState } from '@/components/common/Feedback';
import { useOrgSettingsQuery, useUpdateOrgSettingsMutation } from '@/services/endpoints';
import { errorMessage } from '@/services/api';
import { useToast } from '@/components/common/ToastProvider';
import { TIMEZONES } from './components/useLookups';
import { useAuth } from '@/hooks/useAuth';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function AdminSettingsPage() {
  const { data, isLoading, error, refetch } = useOrgSettingsQuery();
  const [save, { isLoading: saving }] = useUpdateOrgSettingsMutation();
  const toast = useToast();
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [allowShare, setAllowShare] = useState(true);
  const [defaultView, setDefaultView] = useState<'3D' | '2D' | 'LIST'>('3D');
  const [workingDays, setWorkingDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    const s = (data.settings ?? {}) as { allowTeamLocationSharing?: boolean; defaultView?: '3D' | '2D' | 'LIST'; workingDays?: number[] };
    setName(data.name);
    setTimezone(data.timezone);
    setAllowShare(s.allowTeamLocationSharing ?? true);
    setDefaultView(s.defaultView ?? '3D');
    setWorkingDays(s.workingDays ?? [1, 2, 3, 4, 5]);
  }, [data]);

  return (
    <PageTransition>
      <PageHeader title="Settings" subtitle="Organisation-wide configuration." crumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Settings' }]} />
      {isLoading ? (
        <CardSkeleton count={2} />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 7 }}>
            <Card>
              <CardContent>
                <Typography variant="h4" gutterBottom>
                  Organisation
                </Typography>
                <Stack spacing={2}>
                  {err && <Alert severity="error">{err}</Alert>}
                  <TextField label="Organisation name" value={name} onChange={(e) => setName(e.target.value)} slotProps={{ htmlInput: { maxLength: 120 } }} />
                  <Autocomplete freeSolo options={TIMEZONES} value={timezone} onInputChange={(_e, v) => setTimezone(v)} renderInput={(p) => <TextField {...p} label="Default time zone (IANA)" helperText="Buildings keep their own time zone; this is the fallback for reports." />} />
                  <FormControl size="small">
                    <InputLabel id="dv">Default map view for new users</InputLabel>
                    <Select labelId="dv" label="Default map view for new users" value={defaultView} onChange={(e) => setDefaultView(e.target.value as '3D' | '2D' | 'LIST')}>
                      <MenuItem value="3D">3D explorer</MenuItem>
                      <MenuItem value="2D">2D floor plan</MenuItem>
                      <MenuItem value="LIST">List</MenuItem>
                    </Select>
                  </FormControl>
                  <FormControlLabel control={<Switch checked={allowShare} onChange={(e) => setAllowShare(e.target.checked)} />} label="Allow employees to share their seat location with teammates" />
                  <FormGroup row aria-label="Working days">
                    {DAYS.map((d, i) => (
                      <FormControlLabel key={d} control={<Checkbox checked={workingDays.includes(i)} onChange={(e) => setWorkingDays((w) => (e.target.checked ? [...w, i].sort() : w.filter((x) => x !== i)))} />} label={d} />
                    ))}
                  </FormGroup>
                  <Stack direction="row" spacing={1}>
                    <Button variant="contained" disabled={saving || !name.trim()} startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined} onClick={async () => { setErr(null); try { await save({ name: name.trim(), timezone, settings: { allowTeamLocationSharing: allowShare, defaultView, workingDays } }).unwrap(); toast.success('Settings saved'); } catch (e) { setErr(errorMessage(e)); } }}>
                      Save settings
                    </Button>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 12, md: 5 }}>
            <Card>
              <CardContent>
                <Typography variant="h4" gutterBottom>
                  About this workspace
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Slug: <code>{data?.slug}</code>
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Signed in as {user?.displayName} ({user?.roles.join(', ')})
                </Typography>
                {user?.isGuest && (
                  <Alert severity="info" sx={{ mt: 2 }}>
                    This is a guest sandbox. Settings changes apply to your sandbox only and disappear when it is purged.
                  </Alert>
                )}
                <Typography variant="body2" sx={{ mt: 2 }}>
                  Authentication and SSO, email delivery and calendar synchronisation are configured through environment variables; see Integrations for their status.
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}
    </PageTransition>
  );
}
