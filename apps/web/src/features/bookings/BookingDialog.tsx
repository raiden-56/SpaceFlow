// Shared booking dialog used by the 3D/2D explorer, seat booking, meeting rooms and rebooking.
// Steps: configure (date, time, options) -> summary/confirm -> success. Handles conflicts by
// showing alternatives, policy errors inline, and multi-day/recurring partial results.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, FormControlLabel,
  IconButton, InputLabel, MenuItem, Select, Stack, TextField, Typography, useMediaQuery, useTheme, CircularProgress, Collapse,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import MapRoundedIcon from '@mui/icons-material/MapRounded';
import PlaceRoundedIcon from '@mui/icons-material/PlaceRounded';
import { motion } from 'framer-motion';
import type { BatchReservationResultDto, ConflictAlternativeDto, ReservationDto, ResourceDto } from '@spaceflow/shared';
import { useCreateReservationMutation, useFloorMapQuery, useResourceDayQuery, useUpdateReservationMutation } from '@/services/endpoints';
import { FloorPlan2D } from '@/features/map3d/FloorPlan2D';
import { errorCode, errorDetails, errorMessage } from '@/services/api';
import { dayjs, timeOptions, toIso } from '@/utils/time';
import { useToast } from '@/components/common/ToastProvider';
import { useViewOnMap } from '@/components/common/BookingCard';
import { StatusBadge } from '@/components/common/StatusBadge';

export interface BookingDialogProps {
  open: boolean;
  resource: ResourceDto | null;
  /** Initial window (ISO). */
  startAt?: string;
  endAt?: string;
  /** When set, the dialog modifies this reservation instead of creating one. */
  modifyReservation?: ReservationDto | null;
  onClose: () => void;
  onBooked?: (result: BatchReservationResultDto | ReservationDto) => void;
  /** Called when the user picks a suggested alternative resource. */
  onSelectAlternative?: (alt: ConflictAlternativeDto) => void;
}

interface Attendee {
  email: string;
}

export function BookingDialog({ open, resource, startAt, endAt, modifyReservation, onClose, onBooked, onSelectAlternative }: BookingDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const toast = useToast();
  const navigate = useNavigate();
  const viewOnMap = useViewOnMap();
  const [create, { isLoading: creating }] = useCreateReservationMutation();
  const [update, { isLoading: updating }] = useUpdateReservationMutation();
  const tz = resource?.buildingTimezone ?? dayjs.tz.guess();
  const isSeat = resource?.type === 'SEAT';

  const initial = useMemo(() => {
    const s = startAt ? dayjs(startAt).tz(tz) : dayjs().tz(tz).add(1, 'hour').minute(0);
    const e = endAt ? dayjs(endAt).tz(tz) : s.add(isSeat ? 8 : 1, 'hour');
    return { date: s.format('YYYY-MM-DD'), start: s.format('HH:mm'), end: e.format('HH:mm') };
  }, [startAt, endAt, tz, isSeat]);

  const [step, setStep] = useState<'form' | 'confirm' | 'done'>('form');
  const [date, setDate] = useState(initial.date);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [allDay, setAllDay] = useState(isSeat && !startAt);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [setupNotes, setSetupNotes] = useState('');
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [attendeeInput, setAttendeeInput] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [frequency, setFrequency] = useState<'DAILY' | 'WEEKLY'>('WEEKLY');
  const [count, setCount] = useState(4);
  const [extraDates, setExtraDates] = useState<string[]>([]);
  const [error, setError] = useState<{ message: string; code: string | null; alternatives?: ConflictAlternativeDto[] } | null>(null);
  const [result, setResult] = useState<BatchReservationResultDto | ReservationDto | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep('form');
    setDate(initial.date);
    setStart(initial.start);
    setEnd(initial.end);
    setAllDay(isSeat && !startAt);
    setTitle(modifyReservation?.title ?? '');
    setDescription(modifyReservation?.description ?? '');
    setSetupNotes(modifyReservation?.setupNotes ?? '');
    setAttendees(modifyReservation?.attendees.filter((a) => a.email).map((a) => ({ email: a.email! })) ?? []);
    setRecurring(false);
    setExtraDates([]);
    setError(null);
    setResult(null);
  }, [open, initial, isSeat, startAt, modifyReservation]);

  const { data: day } = useResourceDayQuery({ id: resource?.id ?? '', date }, { skip: !resource || !open });
  const opStart = day?.operatingStart ?? '07:00';
  const opEnd = day?.operatingEnd ?? '20:00';
  const slot = day?.slotMinutes ?? 30;
  const options = useMemo(() => timeOptions(opStart, opEnd, slot), [opStart, opEnd, slot]);
  const effStart = allDay ? opStart : start;
  const effEnd = allDay ? opEnd : end;
  const startIso = toIso(date, effStart, tz);
  const endIso = toIso(date, effEnd, tz);
  const invalidRange = effEnd <= effStart;
  const busySlots = (day?.slots ?? []).filter((s) => s.state === 'RESERVED' || s.state === 'OCCUPIED');
  // Location preview (confirm step): the resource's floor with the resource highlighted.
  const { data: previewMap } = useFloorMapQuery({ floorId: resource?.floorId ?? '' }, { skip: !resource || !open || step !== 'confirm' });

  // One-tap time presets, limited to the resource's opening hours.
  const presets = useMemo(() => {
    const within = (a: string, b: string) => a >= opStart && b <= opEnd && b > a;
    const list: { label: string; start: string; end: string; allDay?: boolean }[] = [];
    if (isSeat) list.push({ label: 'Full day', start: opStart, end: opEnd, allDay: true });
    if (within('09:00', '13:00')) list.push({ label: 'Morning 09–13', start: '09:00', end: '13:00' });
    if (within('13:00', '18:00')) list.push({ label: 'Afternoon 13–18', start: '13:00', end: '18:00' });
    if (dayjs(date, 'YYYY-MM-DD').isSame(dayjs().tz(tz), 'day')) {
      const now = dayjs().tz(tz);
      const m = Math.ceil((now.hour() * 60 + now.minute()) / slot) * slot;
      const fmt = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
      const s0 = fmt(m);
      const e0 = fmt(Math.min(m + (isSeat ? 120 : 60), 23 * 60 + 59));
      if (within(s0, e0)) list.push({ label: isSeat ? 'Next 2 hours' : 'Next hour', start: s0, end: e0 });
    }
    if (!isSeat) {
      for (const mins of [30, 60]) {
        const base = start;
        const e1 = dayjs(`2000-01-01 ${base}`, 'YYYY-MM-DD HH:mm').add(mins, 'minute').format('HH:mm');
        if (within(base, e1)) list.push({ label: `${mins === 30 ? '30 min' : '1 hour'} from ${base}`, start: base, end: e1 });
      }
    }
    return list;
  }, [isSeat, opStart, opEnd, date, tz, slot, start]);

  // Remaining weekdays of the selected week, for one-tap multi-day desk bookings.
  const restOfWeek = useMemo(() => {
    const d0 = dayjs(date, 'YYYY-MM-DD');
    const out: string[] = [];
    for (let i = 1; i <= 6; i++) {
      const d = d0.add(i, 'day');
      if (d.day() === 0) break; // stop at Sunday (end of the work week)
      if (d.day() !== 6) out.push(d.format('YYYY-MM-DD'));
    }
    return out;
  }, [date]);
  const overlapsBusy = busySlots.some((s) => new Date(s.startAt) < new Date(endIso) && new Date(startIso) < new Date(s.endAt) && s.reservationId !== modifyReservation?.id);
  const duration = dayjs(endIso).diff(dayjs(startIso), 'minute');

  const submit = async () => {
    if (!resource) return;
    setError(null);
    try {
      if (modifyReservation) {
        const res = await update({ id: modifyReservation.id, startAt: startIso, endAt: endIso, title: title || undefined, description: description || null, setupNotes: setupNotes || null, attendees: isSeat ? undefined : attendees.map((a) => ({ email: a.email })) }).unwrap();
        setResult(res);
        onBooked?.(res);
      } else {
        const res = await create({
          resourceId: resource.id,
          startAt: startIso,
          endAt: endIso,
          isAllDay: allDay,
          title: title || undefined,
          description: description || undefined,
          setupNotes: setupNotes || undefined,
          attendees: isSeat ? undefined : attendees.map((a) => ({ email: a.email })),
          recurrence: recurring ? { frequency, interval: 1, count } : undefined,
          additionalDates: extraDates.length ? extraDates : undefined,
          atomic: !(recurring || extraDates.length),
        }).unwrap();
        setResult(res);
        onBooked?.(res);
      }
      setStep('done');
    } catch (err) {
      const details = errorDetails<{ alternatives?: ConflictAlternativeDto[] }>(err);
      setError({ message: errorMessage(err), code: errorCode(err), alternatives: details?.alternatives });
      setStep('form');
    }
  };

  if (!resource) return null;
  const busy = creating || updating;
  const created = result && 'created' in result ? result.created : result ? [result as ReservationDto] : [];
  const failed = result && 'failed' in result ? result.failed : [];

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullScreen={fullScreen} fullWidth aria-labelledby="booking-dialog-title" sx={{ maxWidth: 'sm' }}>
      <DialogTitle id="booking-dialog-title" sx={{ pr: 6 }}>
        {step === 'done' ? (modifyReservation ? 'Booking updated' : 'Booking confirmed') : modifyReservation ? `Modify booking · ${resource.name}` : `${isSeat ? 'Book' : 'Reserve'} ${resource.name}`}
        <IconButton aria-label="Close" onClick={onClose} disabled={busy} sx={{ position: 'absolute', right: 8, top: 8 }}>
          <CloseRoundedIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {step === 'done' ? (
          <Box sx={{ textAlign: 'center', py: 2 }}>
            <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }}>
              <CheckCircleRoundedIcon sx={{ fontSize: 72, color: 'success.main' }} />
            </motion.div>
            <Typography variant="h3" sx={{ mt: 1 }}>
              {created.length > 1 ? `${created.length} bookings created` : failed.length && !created.length ? 'No bookings created' : `${resource.name} is yours`}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {resource.buildingName} · {resource.floorName}
              {resource.zoneName ? ` · ${resource.zoneName}` : ''}
            </Typography>
            {created[0] && (
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'center', mt: 1.5 }}>
                <StatusBadge status={created[0].status} />
                {created[0].checkInCode && <Chip size="small" label={`Code ${created[0].checkInCode}`} sx={{ fontFamily: 'monospace' }} />}
              </Stack>
            )}
            {created[0]?.status === 'PENDING_APPROVAL' && (
              <Alert severity="warning" sx={{ mt: 2, textAlign: 'left' }}>
                This resource requires approval. You will be notified once an approver decides.
              </Alert>
            )}
            {failed.length > 0 && (
              <Alert severity={created.length ? 'warning' : 'error'} sx={{ mt: 2, textAlign: 'left' }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {failed.length} date{failed.length > 1 ? 's' : ''} could not be booked:
                </Typography>
                <Box component="ul" sx={{ m: 0, pl: 2 }}>
                  {failed.map((f) => (
                    <li key={f.startAt}>
                      <Typography variant="caption">
                        {dayjs(f.startAt).tz(tz).format('ddd D MMM')} · {f.message}
                      </Typography>
                    </li>
                  ))}
                </Box>
              </Alert>
            )}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'center', mt: 3 }}>
              <Button variant="contained" startIcon={<MapRoundedIcon />} onClick={() => { onClose(); viewOnMap({ buildingId: resource.buildingId, floorId: resource.floorId, resourceId: resource.id }); }}>
                View on map
              </Button>
              <Button variant="outlined" onClick={() => { onClose(); navigate(created[0] ? `/bookings/${created[0].id}` : '/bookings'); }}>
                {created.length ? 'View booking' : 'My bookings'}
              </Button>
            </Stack>
          </Box>
        ) : step === 'confirm' ? (
          <Stack spacing={2}>
            <Typography variant="subtitle2">Summary</Typography>
            <Box sx={{ p: 2, borderRadius: 2, bgcolor: '#F8FAFC', border: '1px solid', borderColor: 'divider' }}>
              <Typography sx={{ fontWeight: 600 }}>{resource.name}</Typography>
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', color: 'text.secondary', mt: 0.5 }}>
                <PlaceRoundedIcon sx={{ fontSize: 16 }} />
                <Typography variant="caption">
                  {resource.buildingName} · {resource.floorName}
                  {resource.zoneName ? ` · ${resource.zoneName}` : ''}
                </Typography>
              </Stack>
              <Divider sx={{ my: 1.5 }} />
              <Typography variant="body2">
                <strong>{dayjs(date, 'YYYY-MM-DD').format('dddd, D MMMM YYYY')}</strong>
              </Typography>
              <Typography variant="body2">
                {effStart}–{effEnd} ({Math.floor(duration / 60)}h{duration % 60 ? ` ${duration % 60}m` : ''}) · {tz}
              </Typography>
              {recurring && <Typography variant="body2">Repeats {frequency.toLowerCase()} · {count} occurrences</Typography>}
              {extraDates.length > 0 && <Typography variant="body2">Also on {extraDates.map((d) => dayjs(d).format('D MMM')).join(', ')}</Typography>}
              {!isSeat && title && <Typography variant="body2">Title: {title}</Typography>}
              {!isSeat && attendees.length > 0 && <Typography variant="body2">{attendees.length + 1} attendee{attendees.length ? 's' : ''} (capacity {resource.capacity})</Typography>}
            </Box>
            {previewMap && previewMap.objects.some((o) => o.resourceId === resource.id) && (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
                  Where it is on {resource.floorName}
                </Typography>
                <Box sx={{ position: 'relative', height: 180, borderRadius: 2, overflow: 'hidden', border: '1px solid', borderColor: 'divider' }} data-testid="booking-location-preview">
                  <FloorPlan2D map={previewMap} resources={previewMap.resources} selectedResourceId={resource.id} onSelectResource={() => undefined} readOnly />
                </Box>
              </Box>
            )}
            <Alert severity="info" icon={false}>
              <Typography variant="caption" component="div">
                {resource.requiresApproval ? 'This booking will be sent for approval. ' : ''}
                {resource.checkInRequired !== false ? 'Check-in is required: open the booking and scan the QR code or tap Check in when you arrive, otherwise it may be released automatically. ' : ''}
                {resource.maxDurationMinutes ? `Maximum duration ${resource.maxDurationMinutes} minutes. ` : ''}
                Times are shown in the building's local time zone.
              </Typography>
            </Alert>
            {error && <Alert severity="error">{error.message}</Alert>}
          </Stack>
        ) : (
          <Stack spacing={2}>
            {error && (
              <Alert severity={error.code === 'BOOKING_CONFLICT' ? 'warning' : 'error'} role="alert">
                {error.message}
                {error.alternatives && error.alternatives.length > 0 && (
                  <Box sx={{ mt: 1 }}>
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>
                      Available alternatives:
                    </Typography>
                    <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', mt: 0.5 }}>
                      {error.alternatives.map((a) => (
                        <Chip key={a.resource.id} label={`${a.resource.name}${a.resource.zoneName ? ` · ${a.resource.zoneName}` : ''}`} size="small" clickable color="primary" variant="outlined" onClick={() => onSelectAlternative?.(a)} />
                      ))}
                    </Stack>
                  </Box>
                )}
              </Alert>
            )}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <DatePicker label="Date" value={dayjs(date, 'YYYY-MM-DD')} minDate={dayjs()} onChange={(v) => v?.isValid() && setDate(v.format('YYYY-MM-DD'))} slotProps={{ textField: { size: 'small', fullWidth: true, slotProps: { htmlInput: { 'data-testid': 'booking-date' } as object } } }} />
              {isSeat && <FormControlLabel control={<Checkbox checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />} label="Full day" sx={{ whiteSpace: 'nowrap' }} />}
            </Stack>
            {presets.length > 0 && (
              <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }} role="group" aria-label="Quick time presets">
                {presets.map((p) => {
                  const active = p.allDay ? allDay : !allDay && start === p.start && end === p.end;
                  return (
                    <Chip
                      key={p.label}
                      label={p.label}
                      size="small"
                      color={active ? 'primary' : 'default'}
                      variant={active ? 'filled' : 'outlined'}
                      aria-pressed={active}
                      onClick={() => {
                        setAllDay(!!p.allDay);
                        if (!p.allDay) {
                          setStart(p.start);
                          setEnd(p.end);
                        }
                      }}
                    />
                  );
                })}
              </Stack>
            )}
            <Collapse in={!allDay}>
              <Stack direction="row" spacing={2}>
                <FormControl fullWidth size="small">
                  <InputLabel id="start-label">Start</InputLabel>
                  <Select labelId="start-label" label="Start" value={options.includes(start) ? start : options[0] ?? ''} onChange={(e) => setStart(e.target.value)} data-testid="booking-start">
                    {options.slice(0, -1).map((t) => (
                      <MenuItem key={t} value={t}>{t}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl fullWidth size="small">
                  <InputLabel id="end-label">End</InputLabel>
                  <Select labelId="end-label" label="End" value={options.includes(end) ? end : options[options.length - 1] ?? ''} onChange={(e) => setEnd(e.target.value)} data-testid="booking-end">
                    {options.slice(1).map((t) => (
                      <MenuItem key={t} value={t} disabled={t <= start}>{t}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>
            </Collapse>
            {day && (
              <Box aria-label="Availability for the selected day">
                <Typography variant="caption" color="text.secondary">
                  Availability on {dayjs(date).format('D MMM')} ({opStart}–{opEnd})
                </Typography>
                <Box sx={{ display: 'flex', gap: '2px', mt: 0.5, height: 10, borderRadius: 1, overflow: 'hidden' }} role="img" aria-label={`${busySlots.length} of ${day.slots.length} slots reserved`}>
                  {day.slots.map((s) => {
                    const selected = new Date(s.startAt) < new Date(endIso) && new Date(startIso) < new Date(s.endAt);
                    const color = s.state === 'AVAILABLE' ? (selected ? theme.palette.status.selected : theme.palette.status.available) : s.state === 'DISABLED' ? theme.palette.status.disabled : s.state === 'RESTRICTED' ? (selected ? theme.palette.status.selected : theme.palette.status.restricted) : theme.palette.status.occupied;
                    return <Box key={s.startAt} title={`${dayjs(s.startAt).tz(tz).format('HH:mm')} ${s.state.toLowerCase()}`} sx={{ flex: 1, bgcolor: color, opacity: selected ? 1 : 0.7 }} />;
                  })}
                </Box>
              </Box>
            )}
            {overlapsBusy && <Alert severity="warning">The selected time overlaps an existing reservation. Choose another time or resource.</Alert>}
            {invalidRange && <Alert severity="error">End time must be after start time.</Alert>}
            {!isSeat && (
              <>
                <TextField label="Meeting title" value={title} onChange={(e) => setTitle(e.target.value)} slotProps={{ htmlInput: { maxLength: 120, 'data-testid': 'booking-title' } }} />
                <TextField label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 1000 } }} />
                <Box>
                  <TextField
                    label="Attendees (email, press Enter)"
                    value={attendeeInput}
                    onChange={(e) => setAttendeeInput(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.key === 'Enter' || e.key === ',') && attendeeInput.trim()) {
                        e.preventDefault();
                        const email = attendeeInput.trim().toLowerCase();
                        if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && !attendees.some((a) => a.email === email)) setAttendees((a) => [...a, { email }]);
                        setAttendeeInput('');
                      }
                    }}
                    helperText={resource.capacity ? `${attendees.length + 1} of ${resource.capacity} seats used` : undefined}
                    error={!!resource.capacity && attendees.length + 1 > resource.capacity}
                  />
                  <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', mt: 1 }}>
                    {attendees.map((a) => (
                      <Chip key={a.email} label={a.email} size="small" onDelete={() => setAttendees((list) => list.filter((x) => x.email !== a.email))} />
                    ))}
                  </Stack>
                </Box>
                <TextField label="Setup or facility requests (optional)" value={setupNotes} onChange={(e) => setSetupNotes(e.target.value)} slotProps={{ htmlInput: { maxLength: 500 } }} />
              </>
            )}
            {!modifyReservation && (
              <>
                <Divider />
                <FormControlLabel control={<Checkbox checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />} label="Repeat this booking" />
                <Collapse in={recurring}>
                  <Stack direction="row" spacing={2}>
                    <FormControl fullWidth size="small">
                      <InputLabel id="freq-label">Frequency</InputLabel>
                      <Select labelId="freq-label" label="Frequency" value={frequency} onChange={(e) => setFrequency(e.target.value as 'DAILY' | 'WEEKLY')}>
                        <MenuItem value="DAILY">Every weekday</MenuItem>
                        <MenuItem value="WEEKLY">Weekly</MenuItem>
                      </Select>
                    </FormControl>
                    <TextField label="Occurrences" type="number" value={count} onChange={(e) => setCount(Math.max(1, Math.min(52, Number(e.target.value) || 1)))} slotProps={{ htmlInput: { min: 1, max: 52 } }} />
                  </Stack>
                </Collapse>
                {isSeat && !recurring && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Additional days (multi-day booking)
                    </Typography>
                    {restOfWeek.length > 0 && (
                      <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', mt: 0.5 }} role="group" aria-label="Also book later this week">
                        {restOfWeek.map((d) => {
                          const on = extraDates.includes(d);
                          return (
                            <Chip key={d} size="small" label={dayjs(d).format('ddd D')} color={on ? 'primary' : 'default'} variant={on ? 'filled' : 'outlined'} aria-pressed={on} onClick={() => setExtraDates((x) => (on ? x.filter((y) => y !== d) : [...x, d].sort()))} />
                          );
                        })}
                        <Button size="small" onClick={() => setExtraDates((x) => [...new Set([...x, ...restOfWeek])].sort())} data-testid="booking-rest-of-week">
                          Rest of the week
                        </Button>
                      </Stack>
                    )}
                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center', mt: 0.5 }} useFlexGap>
                      {extraDates.map((d) => (
                        <Chip key={d} label={dayjs(d).format('ddd D MMM')} size="small" onDelete={() => setExtraDates((x) => x.filter((y) => y !== d))} />
                      ))}
                      <DatePicker label="Add day" value={null} minDate={dayjs()} onChange={(v) => { if (v?.isValid()) { const d = v.format('YYYY-MM-DD'); if (d !== date && !extraDates.includes(d)) setExtraDates((x) => [...x, d].sort()); } }} slotProps={{ textField: { size: 'small', sx: { width: 160 } } }} />
                    </Stack>
                  </Box>
                )}
              </>
            )}
          </Stack>
        )}
      </DialogContent>
      {step !== 'done' && (
        <DialogActions sx={{ px: 3, py: 2 }}>
          {step === 'confirm' ? (
            <>
              <Button onClick={() => setStep('form')} disabled={busy} color="inherit">
                Back
              </Button>
              <Button variant="contained" onClick={submit} disabled={busy} data-testid="booking-confirm" startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}>
                {busy ? 'Booking…' : modifyReservation ? 'Save changes' : resource.requiresApproval ? 'Request booking' : 'Confirm booking'}
              </Button>
            </>
          ) : (
            <>
              <Button onClick={onClose} color="inherit">
                Cancel
              </Button>
              <Button variant="contained" onClick={() => setStep('confirm')} disabled={invalidRange || (!isSeat && !!resource.capacity && attendees.length + 1 > resource.capacity)} data-testid="booking-continue">
                Continue
              </Button>
            </>
          )}
        </DialogActions>
      )}
      {step === 'done' && (
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => { onClose(); toast.success(modifyReservation ? 'Booking updated' : 'Booking confirmed'); }} variant="text">
            Done
          </Button>
        </DialogActions>
      )}
    </Dialog>
  );
}
