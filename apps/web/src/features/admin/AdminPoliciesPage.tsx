import { useEffect, useState } from 'react';
import { Alert, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, FormControlLabel, Grid, IconButton, InputLabel, MenuItem, Select, Stack, Switch, TextField, Typography, CircularProgress, Tooltip } from '@mui/material';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import { policySchema, type PolicyDto, type PolicyInput } from '@spaceflow/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { PageTransition } from '@/components/common/Motion';
import { ErrorState, TableSkeleton } from '@/components/common/Feedback';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useBuildingsQuery, useCreatePolicyMutation, useDeletePolicyMutation, useEffectivePolicyQuery, usePoliciesQuery, useUpdatePolicyMutation } from '@/services/endpoints';
import { errorMessage } from '@/services/api';
import { useToast } from '@/components/common/ToastProvider';
import { DataTable, type Column } from './components/DataTable';
import { KeyValue } from './components/JsonDiff';
import { timeOptions } from '@/utils/time';

type Form = Omit<PolicyInput, 'buildingId' | 'resourceType'> & { buildingId: string; resourceType: '' | 'SEAT' | 'MEETING_ROOM' };

const DEFAULTS: Form = {
  name: '',
  buildingId: '',
  resourceType: '',
  advanceBookingDays: 30,
  minDurationMinutes: 30,
  maxDurationMinutes: 600,
  slotMinutes: 30,
  maxActiveReservations: 10,
  maxDailyBookings: 3,
  maxWeeklyBookings: 15,
  operatingStart: '07:00',
  operatingEnd: '20:00',
  allowWeekends: false,
  cancellationDeadlineMinutes: 0,
  checkInRequired: true,
  checkInGraceMinutes: 30,
  checkInOpensMinutesBefore: 15,
  autoReleaseEnabled: true,
  allowRecurring: true,
  maxRecurringOccurrences: 12,
  allowMultiDay: true,
  isActive: true,
};

const TIMES = timeOptions('00:00', '23:30', 30);

function PolicyDialog({ open, onClose, policy }: { open: boolean; onClose: () => void; policy: PolicyDto | null }) {
  const [form, setForm] = useState<Form>(DEFAULTS);
  const [issues, setIssues] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const { data: buildings } = useBuildingsQuery();
  const [create, c] = useCreatePolicyMutation();
  const [update, u] = useUpdatePolicyMutation();
  const toast = useToast();
  const busy = c.isLoading || u.isLoading;
  useEffect(() => {
    if (!open) return;
    setIssues([]);
    setErr(null);
    setForm(policy ? { ...DEFAULTS, ...policy, buildingId: policy.buildingId ?? '', resourceType: policy.resourceType ?? '' } : DEFAULTS);
  }, [open, policy]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const num = (k: keyof Form, label: string, min: number, max: number, step = 1, help?: string) => (
    <TextField label={label} type="number" value={form[k] as number} onChange={(e) => set(k, Number(e.target.value) as never)} slotProps={{ htmlInput: { min, max, step } }} helperText={help} />
  );
  const submit = async () => {
    const payload = { ...form, buildingId: form.buildingId || null, resourceType: form.resourceType || null };
    const parsed = policySchema.safeParse(payload);
    if (!parsed.success) {
      setIssues(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
      return;
    }
    setIssues([]);
    setErr(null);
    try {
      if (policy) await update({ id: policy.id, ...parsed.data }).unwrap();
      else await create(parsed.data).unwrap();
      toast.success(`Policy ${policy ? 'updated' : 'created'}`);
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    }
  };
  const section = (title: string, children: React.ReactNode) => (
    <>
      <Typography variant="subtitle2" sx={{ mt: 1 }}>
        {title}
      </Typography>
      <Grid container spacing={2}>
        {children}
      </Grid>
    </>
  );
  const G = ({ children, md = 4 }: { children: React.ReactNode; md?: number }) => <Grid size={{ xs: 12, sm: 6, md }}>{children}</Grid>;
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="md" aria-labelledby="policy-title">
      <DialogTitle id="policy-title">{policy ? `Edit policy · ${policy.name}` : 'New booking policy'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          {err && <Alert severity="error">{err}</Alert>}
          {issues.length > 0 && (
            <Alert severity="warning">
              <ul style={{ margin: 0, paddingLeft: 18 }}>{issues.map((i) => <li key={i}>{i}</li>)}</ul>
            </Alert>
          )}
          <Alert severity="info" icon={false}>
            Resolution order: building + resource type → building only → resource type only → organisation default. The most specific active policy wins.
          </Alert>
          {section('Scope', <>
            <G><TextField label="Name" required value={form.name} onChange={(e) => set('name', e.target.value)} slotProps={{ htmlInput: { maxLength: 80 } }} /></G>
            <G>
              <FormControl size="small" fullWidth>
                <InputLabel id="p-b">Building</InputLabel>
                <Select labelId="p-b" label="Building" value={form.buildingId} onChange={(e) => set('buildingId', e.target.value)}>
                  <MenuItem value="">All buildings</MenuItem>
                  {(buildings ?? []).map((b) => <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>)}
                </Select>
              </FormControl>
            </G>
            <G>
              <FormControl size="small" fullWidth>
                <InputLabel id="p-t">Resource type</InputLabel>
                <Select labelId="p-t" label="Resource type" value={form.resourceType} onChange={(e) => set('resourceType', e.target.value as Form['resourceType'])}>
                  <MenuItem value="">Seats and rooms</MenuItem>
                  <MenuItem value="SEAT">Seats only</MenuItem>
                  <MenuItem value="MEETING_ROOM">Meeting rooms only</MenuItem>
                </Select>
              </FormControl>
            </G>
          </>)}
          {section('Advance window & duration', <>
            <G>{num('advanceBookingDays', 'Advance booking window (days)', 0, 365)}</G>
            <G>{num('minDurationMinutes', 'Minimum duration (min)', 5, 1440, 5)}</G>
            <G>{num('maxDurationMinutes', 'Maximum duration (min)', 15, 1440, 15)}</G>
            <G>{num('slotMinutes', 'Slot size (min)', 5, 240, 5)}</G>
          </>)}
          {section('Booking limits', <>
            <G>{num('maxActiveReservations', 'Max active reservations', 1, 100)}</G>
            <G>{num('maxDailyBookings', 'Max bookings per day', 1, 50)}</G>
            <G>{num('maxWeeklyBookings', 'Max bookings per week', 1, 200)}</G>
          </>)}
          {section('Operating hours', <>
            <G>
              <FormControl size="small" fullWidth>
                <InputLabel id="p-os">Opens</InputLabel>
                <Select labelId="p-os" label="Opens" value={form.operatingStart} onChange={(e) => set('operatingStart', e.target.value)}>{TIMES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}</Select>
              </FormControl>
            </G>
            <G>
              <FormControl size="small" fullWidth>
                <InputLabel id="p-oe">Closes</InputLabel>
                <Select labelId="p-oe" label="Closes" value={form.operatingEnd} onChange={(e) => set('operatingEnd', e.target.value)}>{TIMES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}</Select>
              </FormControl>
            </G>
            <G><FormControlLabel control={<Switch checked={form.allowWeekends} onChange={(e) => set('allowWeekends', e.target.checked)} />} label="Allow weekends" /></G>
          </>)}
          {section('Cancellation & check-in', <>
            <G>{num('cancellationDeadlineMinutes', 'Cancellation deadline (min before start)', 0, 1440, 5, '0 = cancel any time before start')}</G>
            <G><FormControlLabel control={<Switch checked={form.checkInRequired} onChange={(e) => set('checkInRequired', e.target.checked)} />} label="Check-in required" /></G>
            <G>{num('checkInOpensMinutesBefore', 'Check-in opens (min before)', 0, 240, 5)}</G>
            <G>{num('checkInGraceMinutes', 'Check-in grace period (min)', 0, 240, 5)}</G>
            <G><FormControlLabel control={<Switch checked={form.autoReleaseEnabled} onChange={(e) => set('autoReleaseEnabled', e.target.checked)} />} label="Auto-release no-shows" /></G>
          </>)}
          {section('Recurring & multi-day', <>
            <G><FormControlLabel control={<Switch checked={form.allowRecurring} onChange={(e) => set('allowRecurring', e.target.checked)} />} label="Allow recurring bookings" /></G>
            <G>{num('maxRecurringOccurrences', 'Max occurrences per series', 1, 52)}</G>
            <G><FormControlLabel control={<Switch checked={form.allowMultiDay} onChange={(e) => set('allowMultiDay', e.target.checked)} />} label="Allow multi-day bookings" /></G>
            <G><FormControlLabel control={<Switch checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />} label="Policy active" /></G>
          </>)}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button color="inherit" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={busy || !form.name.trim()} startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}>{policy ? 'Save' : 'Create'}</Button>
      </DialogActions>
    </Dialog>
  );
}

function EffectivePolicyInspector() {
  const { data: buildings } = useBuildingsQuery();
  const [buildingId, setBuildingId] = useState('');
  const [type, setType] = useState<'SEAT' | 'MEETING_ROOM'>('SEAT');
  useEffect(() => { if (!buildingId && buildings?.[0]) setBuildingId(buildings[0].id); }, [buildings, buildingId]);
  const { data, isFetching } = useEffectivePolicyQuery({ buildingId, resourceType: type }, { skip: !buildingId });
  return (
    <Card>
      <CardContent>
        <Typography variant="h4" gutterBottom>Effective policy</Typography>
        <Typography variant="caption" color="text.secondary">See which rules apply to a building and resource type after resolution.</Typography>
        <Stack direction="row" spacing={1} sx={{ my: 1.5 }}>
          <FormControl size="small" fullWidth>
            <InputLabel id="ep-b">Building</InputLabel>
            <Select labelId="ep-b" label="Building" value={buildingId} onChange={(e) => setBuildingId(e.target.value)}>{(buildings ?? []).map((b) => <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>)}</Select>
          </FormControl>
          <FormControl size="small" fullWidth>
            <InputLabel id="ep-t">Type</InputLabel>
            <Select labelId="ep-t" label="Type" value={type} onChange={(e) => setType(e.target.value as 'SEAT' | 'MEETING_ROOM')}>
              <MenuItem value="SEAT">Seats</MenuItem>
              <MenuItem value="MEETING_ROOM">Meeting rooms</MenuItem>
            </Select>
          </FormControl>
        </Stack>
        {isFetching && <CircularProgress size={18} />}
        {data && (
          <KeyValue items={[
            { label: 'Policy', value: <strong>{data.name}</strong> },
            { label: 'Advance window', value: `${data.advanceBookingDays} days` },
            { label: 'Duration', value: `${data.minDurationMinutes}–${data.maxDurationMinutes} min · ${data.slotMinutes} min slots` },
            { label: 'Limits', value: `${data.maxActiveReservations} active · ${data.maxDailyBookings}/day · ${data.maxWeeklyBookings}/week` },
            { label: 'Hours', value: `${data.operatingStart}–${data.operatingEnd}${data.allowWeekends ? ' incl. weekends' : ' weekdays'}` },
            { label: 'Cancellation', value: data.cancellationDeadlineMinutes ? `≥ ${data.cancellationDeadlineMinutes} min before` : 'until start' },
            { label: 'Check-in', value: data.checkInRequired ? `opens ${data.checkInOpensMinutesBefore} min before · grace ${data.checkInGraceMinutes} min · auto-release ${data.autoReleaseEnabled ? 'on' : 'off'}` : 'not required' },
            { label: 'Recurring', value: data.allowRecurring ? `up to ${data.maxRecurringOccurrences}` : 'off' },
            { label: 'Multi-day', value: data.allowMultiDay ? 'allowed' : 'off' },
          ]} />
        )}
      </CardContent>
    </Card>
  );
}

export function AdminPoliciesPage() {
  const { data, isLoading, error, refetch } = usePoliciesQuery();
  const [remove] = useDeletePolicyMutation();
  const [editing, setEditing] = useState<PolicyDto | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toDelete, setToDelete] = useState<PolicyDto | null>(null);
  const toast = useToast();
  const columns: Column<PolicyDto>[] = [
    { key: 'name', header: 'Policy', render: (p) => <><Typography variant="body2" sx={{ fontWeight: 600 }}>{p.name}</Typography>{!p.isActive && <Chip size="small" label="inactive" sx={{ ml: 1 }} />}</>, sortValue: (p) => p.name },
    { key: 'scope', header: 'Scope', render: (p) => `${p.buildingName ?? 'All buildings'} · ${p.resourceType ? (p.resourceType === 'SEAT' ? 'Seats' : 'Rooms') : 'All types'}`, sortValue: (p) => `${p.buildingName ?? ''}${p.resourceType ?? ''}` },
    { key: 'window', header: 'Advance', render: (p) => `${p.advanceBookingDays} d`, sortValue: (p) => p.advanceBookingDays, align: 'right' },
    { key: 'dur', header: 'Duration', render: (p) => `${p.minDurationMinutes}–${p.maxDurationMinutes} min` },
    { key: 'limits', header: 'Limits', render: (p) => `${p.maxDailyBookings}/day · ${p.maxWeeklyBookings}/wk · ${p.maxActiveReservations} active` },
    { key: 'hours', header: 'Hours', render: (p) => `${p.operatingStart}–${p.operatingEnd}${p.allowWeekends ? ' +wknd' : ''}` },
    { key: 'checkin', header: 'Check-in', render: (p) => (p.checkInRequired ? `${p.checkInGraceMinutes} min grace${p.autoReleaseEnabled ? ', auto-release' : ''}` : 'off') },
    { key: 'actions', header: 'Actions', align: 'right', render: (p) => <Stack direction="row" sx={{ justifyContent: 'flex-end' }}><Tooltip title="Edit"><IconButton aria-label={`Edit ${p.name}`} onClick={(e) => { e.stopPropagation(); setEditing(p); setDialogOpen(true); }}><EditRoundedIcon fontSize="small" /></IconButton></Tooltip><Tooltip title="Delete"><IconButton aria-label={`Delete ${p.name}`} onClick={(e) => { e.stopPropagation(); setToDelete(p); }}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton></Tooltip></Stack> },
  ];
  return (
    <PageTransition>
      <PageHeader title="Booking policies" subtitle="Rules enforced by the booking engine on every reservation, including conflicts, limits and check-in." crumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Policies' }]} actions={<Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => { setEditing(null); setDialogOpen(true); }}>New policy</Button>} />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 8 }}>
          {isLoading ? <TableSkeleton /> : error ? <ErrorState error={error} onRetry={refetch} /> : <DataTable rows={data ?? []} columns={columns} rowKey={(p) => p.id} ariaLabel="Booking policies" emptyTitle="No policies yet" emptyDescription="Without a policy the system defaults apply (30-day window, 07:00–20:00, 3 bookings/day)." onRowClick={(p) => { setEditing(p); setDialogOpen(true); }} />}
        </Grid>
        <Grid size={{ xs: 12, lg: 4 }}>
          <EffectivePolicyInspector />
          <Divider sx={{ my: 2 }} />
          <Typography variant="caption" color="text.secondary">All policy rules are validated on the server; the interface only mirrors them.</Typography>
        </Grid>
      </Grid>
      <PolicyDialog open={dialogOpen} onClose={() => setDialogOpen(false)} policy={editing} />
      <ConfirmDialog open={!!toDelete} title="Delete policy?" description={`${toDelete?.name} will no longer apply. Resources fall back to the next matching policy.`} destructive confirmLabel="Delete" onClose={() => setToDelete(null)} onConfirm={async () => { if (!toDelete) return; try { await remove({ id: toDelete.id }).unwrap(); toast.success('Policy deleted'); } catch (e) { toast.error(errorMessage(e)); } setToDelete(null); }} />
    </PageTransition>
  );
}
