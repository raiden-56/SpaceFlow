import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Button, Card, CardContent, Divider, FormControl, FormControlLabel, Grid, InputLabel, List, ListItem, ListItemText, MenuItem, Select, Stack, Switch, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import { changePasswordSchema, updateProfileSchema } from '@spaceflow/shared';
import { useAuth } from '@/hooks/useAuth';
import { useBuildingsQuery, useChangePasswordMutation, useFloorsQuery, useLogoutMutation, useMyAuditQuery, useUpdatePreferencesMutation, useUpdateProfileMutation } from '@/services/endpoints';
import { errorMessage } from '@/services/api';
import { PageHeader } from '@/components/common/PageHeader';
import { PageTransition } from '@/components/common/Motion';
import { useToast } from '@/components/common/ToastProvider';
import { dayjs } from '@/utils/time';

type ProfileForm = z.infer<typeof updateProfileSchema>;
type PasswordForm = z.infer<typeof changePasswordSchema> & { confirm: string };
const passwordFormSchema = changePasswordSchema.extend({ confirm: z.string() }).refine((v) => v.newPassword === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });

export function SettingsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [updateProfile, { isLoading: savingProfile }] = useUpdateProfileMutation();
  const [updatePreferences, { isLoading: savingPrefs }] = useUpdatePreferencesMutation();
  const [changePassword, { isLoading: changingPw }] = useChangePasswordMutation();
  const [logout] = useLogoutMutation();
  const { data: buildings } = useBuildingsQuery();
  const prefs = user?.preferences;
  const { data: floors } = useFloorsQuery({ buildingId: prefs?.defaultBuildingId ?? '' }, { skip: !prefs?.defaultBuildingId });
  const { data: activity } = useMyAuditQuery();

  const profile = useForm<ProfileForm>({ resolver: zodResolver(updateProfileSchema), defaultValues: { firstName: user?.firstName, lastName: user?.lastName, phone: user?.phone ?? '', jobTitle: user?.jobTitle ?? '' } });
  useEffect(() => {
    if (user) profile.reset({ firstName: user.firstName, lastName: user.lastName, phone: user.phone ?? '', jobTitle: user.jobTitle ?? '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  const pw = useForm<PasswordForm>({ resolver: zodResolver(passwordFormSchema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });

  const savePrefs = async (patch: Parameters<typeof updatePreferences>[0]) => {
    try {
      await updatePreferences(patch).unwrap();
      toast.success('Preferences saved');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  if (!user) return null;
  return (
    <PageTransition>
      <PageHeader
        title="Profile & settings"
        subtitle={`${user.email} · ${user.roles.map((r) => r.toLowerCase().replace('_', ' ')).join(', ')}`}
        actions={
          <Button variant="outlined" color="inherit" startIcon={<LogoutRoundedIcon />} onClick={async () => { await logout().unwrap().catch(() => undefined); navigate('/login'); }}>
            Sign out
          </Button>
        }
      />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent component="form" noValidate onSubmit={profile.handleSubmit(async (v) => { try { await updateProfile({ ...v, phone: v.phone || null, jobTitle: v.jobTitle || null }).unwrap(); toast.success('Profile updated'); } catch (err) { toast.error(errorMessage(err)); } })}>
              <Typography variant="h4" component="h2" gutterBottom>
                Profile
              </Typography>
              <Stack spacing={2}>
                <Stack direction="row" spacing={2}>
                  <TextField label="First name" {...profile.register('firstName')} error={!!profile.formState.errors.firstName} helperText={profile.formState.errors.firstName?.message} />
                  <TextField label="Last name" {...profile.register('lastName')} error={!!profile.formState.errors.lastName} helperText={profile.formState.errors.lastName?.message} />
                </Stack>
                <TextField label="Job title" {...profile.register('jobTitle')} error={!!profile.formState.errors.jobTitle} helperText={profile.formState.errors.jobTitle?.message} />
                <TextField label="Phone" {...profile.register('phone')} error={!!profile.formState.errors.phone} helperText={profile.formState.errors.phone?.message} />
                <TextField label="Work email" value={user.email} disabled helperText="Managed by your administrator" />
                <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
                  <Button type="submit" variant="contained" disabled={savingProfile}>
                    Save profile
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>

          <Card sx={{ mt: 2 }}>
            <CardContent component="form" noValidate onSubmit={pw.handleSubmit(async (v) => { try { await changePassword({ currentPassword: v.currentPassword, newPassword: v.newPassword }).unwrap(); toast.success('Password changed. Other sessions were signed out.'); pw.reset(); } catch (err) { toast.error(errorMessage(err)); } })}>
              <Typography variant="h4" component="h2" gutterBottom>
                Change password
              </Typography>
              {user.isGuest ? (
                <Alert severity="info">Guest sandboxes have no password. Sign in with an account to manage credentials.</Alert>
              ) : (
                <Stack spacing={2}>
                  <TextField label="Current password" type="password" autoComplete="current-password" {...pw.register('currentPassword')} error={!!pw.formState.errors.currentPassword} helperText={pw.formState.errors.currentPassword?.message} />
                  <TextField label="New password" type="password" autoComplete="new-password" {...pw.register('newPassword')} error={!!pw.formState.errors.newPassword} helperText={pw.formState.errors.newPassword?.message ?? 'At least 8 characters with a letter and a number'} />
                  <TextField label="Confirm new password" type="password" autoComplete="new-password" {...pw.register('confirm')} error={!!pw.formState.errors.confirm} helperText={pw.formState.errors.confirm?.message} />
                  <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
                    <Button type="submit" variant="contained" disabled={changingPw}>
                      Update password
                    </Button>
                  </Stack>
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Typography variant="h4" component="h2" gutterBottom>
                Workplace preferences
              </Typography>
              <Stack spacing={2}>
                <FormControl size="small">
                  <InputLabel id="pref-building">Default building</InputLabel>
                  <Select labelId="pref-building" label="Default building" value={prefs?.defaultBuildingId ?? ''} onChange={(e) => savePrefs({ defaultBuildingId: e.target.value || null, defaultFloorId: null })} disabled={savingPrefs}>
                    <MenuItem value="">Use my home building{user.homeBuildingName ? ` (${user.homeBuildingName})` : ''}</MenuItem>
                    {(buildings ?? []).map((b) => (
                      <MenuItem key={b.id} value={b.id}>
                        {b.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" disabled={!prefs?.defaultBuildingId || savingPrefs}>
                  <InputLabel id="pref-floor">Default floor</InputLabel>
                  <Select labelId="pref-floor" label="Default floor" value={prefs?.defaultFloorId ?? ''} onChange={(e) => savePrefs({ defaultFloorId: e.target.value || null })}>
                    <MenuItem value="">No preference</MenuItem>
                    {(floors ?? []).map((f) => (
                      <MenuItem key={f.id} value={f.id}>
                        {f.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <div>
                  <Typography variant="subtitle2" gutterBottom>
                    Preferred office view
                  </Typography>
                  <ToggleButtonGroup exclusive size="small" value={prefs?.preferredView ?? '3D'} onChange={(_e, v) => v && savePrefs({ preferredView: v })} aria-label="Preferred view">
                    <ToggleButton value="3D">3D</ToggleButton>
                    <ToggleButton value="2D">2D plan</ToggleButton>
                    <ToggleButton value="LIST">List</ToggleButton>
                  </ToggleButtonGroup>
                </div>
                <Divider />
                <FormControlLabel control={<Switch checked={prefs?.shareLocationWithTeam ?? true} onChange={(e) => savePrefs({ shareLocationWithTeam: e.target.checked })} />} label="Let colleagues see which desk I booked today" />
                <FormControlLabel control={<Switch checked={prefs?.emailNotifications ?? true} onChange={(e) => savePrefs({ emailNotifications: e.target.checked })} />} label="Email me booking confirmations and reminders" />
                <FormControlLabel control={<Switch checked={prefs?.reducedMotion ?? false} onChange={(e) => savePrefs({ reducedMotion: e.target.checked })} />} label="Reduce motion and animations" />
                <Typography variant="caption" color="text.secondary">
                  Your operating system's reduced-motion setting is always respected.
                </Typography>
              </Stack>
            </CardContent>
          </Card>

          <Card sx={{ mt: 2 }}>
            <CardContent>
              <Typography variant="h4" component="h2" gutterBottom>
                Recent account activity
              </Typography>
              {activity && activity.length ? (
                <List dense disablePadding>
                  {activity.map((a) => (
                    <ListItem key={a.id} disableGutters>
                      <ListItemText primary={a.action.replace('auth.', '').replace(/-/g, ' ')} secondary={`${dayjs(a.createdAt).format('D MMM YYYY, HH:mm')}${a.ip ? ` · ${a.ip}` : ''}`} slotProps={{ primary: { sx: { textTransform: 'capitalize', fontWeight: 500 } } }} />
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No sign-in activity recorded yet.
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </PageTransition>
  );
}
