// Create / edit dialog shared by seats and meeting rooms.
import { useEffect, useState } from 'react';
import { Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, FormControlLabel, Grid, InputLabel, ListItemText, MenuItem, OutlinedInput, Select, Stack, Switch, TextField, Typography, CircularProgress } from '@mui/material';
import { RoomTypes, SEAT_ATTRIBUTE_LABELS, SEAT_ATTRIBUTE_KEYS, SeatTypes, roomCreateSchema, seatCreateSchema, type OperatingHours, type ResourceDto, type RoomInput, type SeatInput } from '@spaceflow/shared';
import { useCreateRoomMutation, useCreateSeatMutation, useUpdateRoomMutation, useUpdateSeatMutation } from '@/services/endpoints';
import { errorMessage } from '@/services/api';
import { useToast } from '@/components/common/ToastProvider';
import { OperatingHoursEditor } from './OperatingHoursEditor';
import { useDepartmentsLookup, useLookups } from './useLookups';

export interface ResourceFormDialogProps {
  open: boolean;
  onClose: () => void;
  type: 'SEAT' | 'MEETING_ROOM';
  resource?: ResourceDto | null;
  /** Defaults for a new resource (e.g. from the Map Studio). */
  defaults?: { buildingId?: string; floorId?: string; code?: string; name?: string };
  onSaved?: (r: ResourceDto) => void;
}

interface FormState {
  buildingId: string;
  floorId: string;
  code: string;
  name: string;
  description: string;
  zoneId: string;
  status: 'ACTIVE' | 'DISABLED' | 'MAINTENANCE';
  isBookable: boolean;
  requiresApproval: boolean;
  checkInRequired: boolean | null;
  maxDurationMinutes: string;
  amenityIds: string[];
  restrictedDepartmentIds: string[];
  restrictedTeamIds: string[];
  operatingHours: OperatingHours | null;
  seatType: (typeof SeatTypes)[number];
  seatAttributes: Record<string, boolean>;
  capacity: string;
  roomType: (typeof RoomTypes)[number];
  accessible: boolean;
}

function initial(type: 'SEAT' | 'MEETING_ROOM', r?: ResourceDto | null, d?: ResourceFormDialogProps['defaults']): FormState {
  return {
    buildingId: r?.buildingId ?? d?.buildingId ?? '',
    floorId: r?.floorId ?? d?.floorId ?? '',
    code: r?.code ?? d?.code ?? '',
    name: r?.name ?? d?.name ?? '',
    description: r?.description ?? '',
    zoneId: r?.zoneId ?? '',
    status: r?.status ?? 'ACTIVE',
    isBookable: r?.isBookable ?? true,
    requiresApproval: r?.requiresApproval ?? false,
    checkInRequired: r?.checkInRequired ?? null,
    maxDurationMinutes: r?.maxDurationMinutes ? String(r.maxDurationMinutes) : '',
    amenityIds: r?.amenities.map((a) => a.id) ?? [],
    restrictedDepartmentIds: r?.restrictedDepartmentIds ?? [],
    restrictedTeamIds: r?.restrictedTeamIds ?? [],
    operatingHours: r?.operatingHours ?? null,
    seatType: r?.seatType ?? 'WORKSTATION',
    seatAttributes: (r?.seatAttributes as Record<string, boolean>) ?? {},
    capacity: r?.capacity ? String(r.capacity) : type === 'MEETING_ROOM' ? '6' : '',
    roomType: r?.roomType ?? 'MEETING',
    accessible: r?.accessible ?? false,
  };
}

export function ResourceFormDialog({ open, onClose, type, resource, defaults, onSaved }: ResourceFormDialogProps) {
  const isSeat = type === 'SEAT';
  const [form, setForm] = useState<FormState>(() => initial(type, resource, defaults));
  const [issues, setIssues] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const toast = useToast();
  const { buildings, floors, zones, amenities } = useLookups(form.buildingId || null, form.floorId || null);
  const departments = useDepartmentsLookup();
  const [createSeat, cs] = useCreateSeatMutation();
  const [updateSeat, us] = useUpdateSeatMutation();
  const [createRoom, cr] = useCreateRoomMutation();
  const [updateRoom, ur] = useUpdateRoomMutation();
  const busy = cs.isLoading || us.isLoading || cr.isLoading || ur.isLoading;

  useEffect(() => {
    if (open) {
      setForm(initial(type, resource, defaults));
      setIssues([]);
      setServerError(null);
    }
  }, [open, type, resource, defaults]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const relevantAmenities = amenities.filter((a) => a.category === 'BOTH' || a.category === (isSeat ? 'SEAT' : 'ROOM'));
  const teams = departments.flatMap((d) => d.teams.map((t) => ({ ...t, departmentName: d.name })));

  const submit = async () => {
    setServerError(null);
    const base = {
      code: form.code.trim(),
      name: form.name.trim(),
      floorId: form.floorId,
      zoneId: form.zoneId || null,
      status: form.status,
      isBookable: form.isBookable,
      requiresApproval: form.requiresApproval,
      description: form.description.trim() || null,
      amenityIds: form.amenityIds,
      restrictedDepartmentIds: form.restrictedDepartmentIds,
      restrictedTeamIds: form.restrictedTeamIds,
      operatingHours: form.operatingHours,
      maxDurationMinutes: form.maxDurationMinutes ? Number(form.maxDurationMinutes) : null,
      checkInRequired: form.checkInRequired,
    };
    const payload = isSeat ? { ...base, seatType: form.seatType, seatAttributes: form.seatAttributes } : { ...base, capacity: Number(form.capacity), roomType: form.roomType, accessible: form.accessible };
    const parsed = (isSeat ? seatCreateSchema : roomCreateSchema).safeParse(payload);
    if (!parsed.success) {
      setIssues(parsed.error.issues.map((i) => `${i.path.join('.') || 'form'}: ${i.message}`));
      return;
    }
    setIssues([]);
    try {
      let saved: ResourceDto;
      if (isSeat) saved = resource ? await updateSeat({ id: resource.id, ...(parsed.data as SeatInput) }).unwrap() : await createSeat(parsed.data as SeatInput).unwrap();
      else saved = resource ? await updateRoom({ id: resource.id, ...(parsed.data as RoomInput) }).unwrap() : await createRoom(parsed.data as RoomInput).unwrap();
      toast.success(`${isSeat ? 'Seat' : 'Room'} ${saved.code} ${resource ? 'updated' : 'created'}`);
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setServerError(errorMessage(err));
    }
  };

  const multi = (label: string, value: string[], options: { id: string; label: string }[], onChange: (v: string[]) => void) => (
    <FormControl size="small" fullWidth>
      <InputLabel id={`ms-${label}`}>{label}</InputLabel>
      <Select labelId={`ms-${label}`} multiple value={value} input={<OutlinedInput label={label} />} onChange={(e) => onChange(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)} renderValue={(sel) => (sel as string[]).map((id) => options.find((o) => o.id === id)?.label ?? id).join(', ')}>
        {options.map((o) => (
          <MenuItem key={o.id} value={o.id}>
            <Checkbox size="small" checked={value.includes(o.id)} />
            <ListItemText primary={o.label} />
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="md" aria-labelledby="resource-form-title">
      <DialogTitle id="resource-form-title">{resource ? `Edit ${resource.code}` : isSeat ? 'New seat' : 'New meeting room'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {serverError && <Alert severity="error">{serverError}</Alert>}
          {issues.length > 0 && (
            <Alert severity="warning">
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </Alert>
          )}
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl size="small" fullWidth required>
                <InputLabel id="rf-building">Building</InputLabel>
                <Select labelId="rf-building" label="Building" value={form.buildingId} onChange={(e) => { set('buildingId', e.target.value); set('floorId', ''); set('zoneId', ''); }} disabled={!!resource}>
                  {buildings.map((b) => (
                    <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl size="small" fullWidth required>
                <InputLabel id="rf-floor">Floor</InputLabel>
                <Select labelId="rf-floor" label="Floor" value={form.floorId} onChange={(e) => { set('floorId', e.target.value); set('zoneId', ''); }} disabled={!form.buildingId}>
                  {floors.map((f) => (
                    <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField label="Code" required value={form.code} onChange={(e) => set('code', e.target.value)} slotProps={{ htmlInput: { maxLength: 30, 'data-testid': 'resource-code' } as object }} helperText="Unique within the building, e.g. HT1-042" />
            </Grid>
            <Grid size={{ xs: 12, sm: 8 }}>
              <TextField label="Name" required value={form.name} onChange={(e) => set('name', e.target.value)} slotProps={{ htmlInput: { maxLength: 100, 'data-testid': 'resource-name' } as object }} />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField label="Description" value={form.description} onChange={(e) => set('description', e.target.value)} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 500 } }} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl size="small" fullWidth>
                <InputLabel id="rf-zone">Zone / neighborhood</InputLabel>
                <Select labelId="rf-zone" label="Zone / neighborhood" value={form.zoneId} onChange={(e) => set('zoneId', e.target.value)} disabled={!form.floorId}>
                  <MenuItem value="">None</MenuItem>
                  {zones.map((z) => (
                    <MenuItem key={z.id} value={z.id}>{z.name} · {z.kind.toLowerCase()}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl size="small" fullWidth>
                <InputLabel id="rf-status">Status</InputLabel>
                <Select labelId="rf-status" label="Status" value={form.status} onChange={(e) => set('status', e.target.value as FormState['status'])}>
                  <MenuItem value="ACTIVE">Active</MenuItem>
                  <MenuItem value="MAINTENANCE">Maintenance (temporarily unavailable)</MenuItem>
                  <MenuItem value="DISABLED">Disabled</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            {isSeat ? (
              <>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <FormControl size="small" fullWidth>
                    <InputLabel id="rf-seattype">Seat type</InputLabel>
                    <Select labelId="rf-seattype" label="Seat type" value={form.seatType} onChange={(e) => set('seatType', e.target.value as FormState['seatType'])}>
                      {SeatTypes.map((t) => (
                        <MenuItem key={t} value={t}>{t.toLowerCase().replace('_', ' ')}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Seat attributes
                  </Typography>
                  <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
                    {SEAT_ATTRIBUTE_KEYS.map((k) => (
                      <Chip key={k} label={SEAT_ATTRIBUTE_LABELS[k]} clickable color={form.seatAttributes[k] ? 'primary' : 'default'} variant={form.seatAttributes[k] ? 'filled' : 'outlined'} onClick={() => set('seatAttributes', { ...form.seatAttributes, [k]: !form.seatAttributes[k] })} role="checkbox" aria-checked={!!form.seatAttributes[k]} />
                    ))}
                  </Stack>
                </Grid>
              </>
            ) : (
              <>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField label="Capacity" type="number" required value={form.capacity} onChange={(e) => set('capacity', e.target.value)} slotProps={{ htmlInput: { min: 1, max: 500 } }} />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <FormControl size="small" fullWidth>
                    <InputLabel id="rf-roomtype">Room type</InputLabel>
                    <Select labelId="rf-roomtype" label="Room type" value={form.roomType} onChange={(e) => set('roomType', e.target.value as FormState['roomType'])}>
                      {RoomTypes.map((t) => (
                        <MenuItem key={t} value={t}>{t.toLowerCase()}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <FormControlLabel control={<Switch checked={form.accessible} onChange={(e) => set('accessible', e.target.checked)} />} label="Accessible entrance" />
                </Grid>
              </>
            )}
            <Grid size={{ xs: 12 }}>{multi(isSeat ? 'Amenities' : 'Equipment', form.amenityIds, relevantAmenities.map((a) => ({ id: a.id, label: a.name })), (v) => set('amenityIds', v))}</Grid>
          </Grid>
          <Divider />
          <Typography variant="subtitle2">Booking rules</Typography>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControlLabel control={<Switch checked={form.isBookable} onChange={(e) => set('isBookable', e.target.checked)} />} label="Bookable" />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControlLabel control={<Switch checked={form.requiresApproval} onChange={(e) => set('requiresApproval', e.target.checked)} />} label="Requires approval" />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControl size="small" fullWidth>
                <InputLabel id="rf-checkin">Check-in</InputLabel>
                <Select labelId="rf-checkin" label="Check-in" value={form.checkInRequired === null ? 'policy' : form.checkInRequired ? 'yes' : 'no'} onChange={(e) => set('checkInRequired', e.target.value === 'policy' ? null : e.target.value === 'yes')}>
                  <MenuItem value="policy">Follow policy</MenuItem>
                  <MenuItem value="yes">Required</MenuItem>
                  <MenuItem value="no">Not required</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField label="Max duration (minutes)" type="number" value={form.maxDurationMinutes} onChange={(e) => set('maxDurationMinutes', e.target.value)} slotProps={{ htmlInput: { min: 15, max: 1440, step: 15 } }} helperText="Empty = policy default" />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>{multi('Restrict to departments', form.restrictedDepartmentIds, departments.map((d) => ({ id: d.id, label: d.name })), (v) => set('restrictedDepartmentIds', v))}</Grid>
            <Grid size={{ xs: 12, sm: 4 }}>{multi('Restrict to teams', form.restrictedTeamIds, teams.map((t) => ({ id: t.id, label: `${t.name} (${t.departmentName})` })), (v) => set('restrictedTeamIds', v))}</Grid>
            <Grid size={{ xs: 12 }}>
              <OperatingHoursEditor value={form.operatingHours} onChange={(v) => set('operatingHours', v)} />
            </Grid>
          </Grid>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Changing status to maintenance or disabled notifies employees with upcoming bookings. Archiving keeps the booking history.
            </Typography>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button color="inherit" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" onClick={submit} disabled={busy || !form.floorId || !form.code || !form.name} startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined} data-testid="resource-save">
          {resource ? 'Save changes' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
