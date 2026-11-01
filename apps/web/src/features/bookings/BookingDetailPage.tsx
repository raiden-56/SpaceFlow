import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Box, Button, Card, CardContent, Checkbox, Chip, Divider, FormControlLabel, Grid, Skeleton, Stack, TextField, Typography } from '@mui/material';
import MapRoundedIcon from '@mui/icons-material/MapRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import CancelRoundedIcon from '@mui/icons-material/CancelRounded';
import LoginRoundedIcon from '@mui/icons-material/LoginRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import EventRoundedIcon from '@mui/icons-material/EventRounded';
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded';
import QrCodeRoundedIcon from '@mui/icons-material/QrCodeRounded';
import type { ResourceDto } from '@spaceflow/shared';
import { useCancelReservationMutation, useCheckInMutation, useCheckOutMutation, useReservationQrQuery, useReservationQuery, useResourceQuery } from '@/services/endpoints';
import { API_BASE, errorMessage } from '@/services/api';
import { apiFetch } from '@/demo';
import { useAppSelector } from '@/store';
import { PageHeader } from '@/components/common/PageHeader';
import { PageTransition } from '@/components/common/Motion';
import { StatusBadge } from '@/components/common/StatusBadge';
import { ErrorState } from '@/components/common/Feedback';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useViewOnMap } from '@/components/common/BookingCard';
import { useToast } from '@/components/common/ToastProvider';
import { BookingDialog } from './BookingDialog';
import { dayjs, durationLabel, fmtDateLong, fmtRelative, fmtTime } from '@/utils/time';

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box>
      <Typography variant="subtitle2">{label}</Typography>
      <Typography variant="body2" component="div">
        {value}
      </Typography>
    </Box>
  );
}

export function BookingDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const viewOnMap = useViewOnMap();
  const token = useAppSelector((s) => s.auth.accessToken);
  const { data: b, isLoading, error, refetch } = useReservationQuery({ id }, { skip: !id });
  const { data: qr } = useReservationQrQuery({ id }, { skip: !b || !b.checkInCode || !['CONFIRMED', 'PENDING_APPROVAL'].includes(b.status) });
  const { data: resource } = useResourceQuery({ id: b?.resourceId ?? '' }, { skip: !b });
  const [cancel, { isLoading: cancelling }] = useCancelReservationMutation();
  const [checkIn, { isLoading: checkingIn }] = useCheckInMutation();
  const [checkOut, { isLoading: checkingOut }] = useCheckOutMutation();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [cancelSeries, setCancelSeries] = useState(false);
  const [modifyOpen, setModifyOpen] = useState(false);
  const [rebookOpen, setRebookOpen] = useState(false);

  if (error) return <ErrorState error={error} onRetry={refetch} title="Could not load this booking" />;
  if (isLoading || !b) {
    return (
      <PageTransition>
        <Skeleton width={320} height={40} />
        <Skeleton variant="rounded" height={320} sx={{ mt: 2 }} />
      </PageTransition>
    );
  }
  const isSeat = b.type === 'SEAT';
  const run = async (fn: () => Promise<unknown>, success: string) => {
    try {
      await fn();
      toast.success(success);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const addToCalendar = async () => {
    try {
      const res = await apiFetch(`${API_BASE}/reservations/${b.id}/ics`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Could not generate the calendar file');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `spaceflow-${b.resourceCode}.ics`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Calendar file downloaded');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const rebookResource: ResourceDto | null = resource ?? null;
  const tomorrow = dayjs(b.startAt).tz(b.timezone).add(1, 'day');

  return (
    <PageTransition>
      <PageHeader
        title={b.title && !isSeat ? b.title : b.resourceName}
        subtitle={`${isSeat ? 'Desk' : 'Meeting room'} booking · ${b.resourceName} (${b.resourceCode})`}
        crumbs={[{ label: 'My bookings', to: '/bookings' }, { label: b.resourceName }]}
        actions={<StatusBadge status={b.status} size="medium" />}
      />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card>
            <CardContent>
              <Stack spacing={2}>
                <Field label="When" value={<>{fmtDateLong(b.startAt, b.timezone)} · {fmtTime(b.startAt, b.timezone)}–{fmtTime(b.endAt, b.timezone)} ({durationLabel(b.startAt, b.endAt)}) · {b.timezone}</>} />
                <Field label="Where" value={<>{b.buildingName} · {b.floorName}{b.zoneName ? ` · ${b.zoneName}` : ''}</>} />
                {b.description && <Field label="Description" value={b.description} />}
                {b.setupNotes && <Field label="Setup requests" value={b.setupNotes} />}
                {!isSeat && (
                  <Field
                    label={`Attendees${b.capacity ? ` (${b.attendees.length + 1} of ${b.capacity})` : ''}`}
                    value={
                      <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', mt: 0.5 }}>
                        <Chip size="small" label={`${b.userDisplayName} (organizer)`} color="primary" variant="outlined" />
                        {b.attendees.map((a) => (
                          <Chip key={a.id} size="small" label={a.email ?? a.name ?? 'Attendee'} />
                        ))}
                      </Stack>
                    }
                  />
                )}
                {b.seriesId && <Field label="Series" value="Part of a recurring / multi-day booking." />}
                {b.approval && <Field label="Approval" value={<>{b.approval.status.toLowerCase()}{b.approval.approverName ? ` by ${b.approval.approverName}` : ''}{b.approval.decisionNote ? ` · ${b.approval.decisionNote}` : ''}</>} />}
                {b.cancelledAt && <Field label="Cancelled" value={<>{fmtRelative(b.cancelledAt)}{b.cancelReason ? ` · ${b.cancelReason}` : ''}</>} />}
                {b.checkedInAt && <Field label="Checked in" value={dayjs(b.checkedInAt).tz(b.timezone).format('D MMM HH:mm')} />}
                {b.checkedOutAt && <Field label="Checked out" value={dayjs(b.checkedOutAt).tz(b.timezone).format('D MMM HH:mm')} />}
                <Divider />
                <Box>
                  <Typography variant="subtitle2" gutterBottom>
                    Rules
                  </Typography>
                  <Stack spacing={0.5}>
                    {b.policy.checkInRequired ? (
                      <Typography variant="body2">
                        Check-in required{b.policy.checkInOpensAt ? ` · opens ${dayjs(b.policy.checkInOpensAt).tz(b.timezone).format('HH:mm')}` : ''}
                        {b.policy.checkInDeadlineAt ? ` · released automatically if not checked in by ${dayjs(b.policy.checkInDeadlineAt).tz(b.timezone).format('HH:mm')}` : ''}
                      </Typography>
                    ) : (
                      <Typography variant="body2">No check-in required.</Typography>
                    )}
                    {b.policy.cancellationDeadlineAt && <Typography variant="body2">Free cancellation until {dayjs(b.policy.cancellationDeadlineAt).tz(b.timezone).format('D MMM HH:mm')}.</Typography>}
                  </Stack>
                </Box>
              </Stack>
            </CardContent>
          </Card>
          <Card sx={{ mt: 2 }}>
            <CardContent>
              <Typography variant="h4" component="h2" gutterBottom>
                Actions
              </Typography>
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                <Button variant="outlined" startIcon={<MapRoundedIcon />} onClick={() => viewOnMap({ buildingId: b.buildingId, floorId: b.floorId, resourceId: b.resourceId })}>
                  View on map
                </Button>
                {b.actions.canCheckIn && (
                  <Button variant="contained" startIcon={<LoginRoundedIcon />} disabled={checkingIn} onClick={() => run(() => checkIn({ id: b.id }).unwrap(), 'Checked in. Enjoy your day!')} data-testid="booking-checkin">
                    Check in
                  </Button>
                )}
                {b.actions.canCheckOut && (
                  <Button variant="contained" color="secondary" startIcon={<LogoutRoundedIcon />} disabled={checkingOut} onClick={() => run(() => checkOut({ id: b.id }).unwrap(), 'Checked out. The space is free for others.')}>
                    Check out
                  </Button>
                )}
                {b.actions.canModify && (
                  <Button variant="outlined" startIcon={<EditRoundedIcon />} onClick={() => setModifyOpen(true)} disabled={!resource}>
                    Modify
                  </Button>
                )}
                {['CONFIRMED', 'PENDING_APPROVAL', 'CHECKED_IN'].includes(b.status) && (
                  <Button variant="outlined" startIcon={<EventRoundedIcon />} onClick={addToCalendar}>
                    Add to calendar
                  </Button>
                )}
                {b.actions.canRebook && (
                  <Button variant="contained" startIcon={<ReplayRoundedIcon />} onClick={() => setRebookOpen(true)} disabled={!resource}>
                    Book again
                  </Button>
                )}
                {b.actions.canCancel && (
                  <Button variant="outlined" color="error" startIcon={<CancelRoundedIcon />} onClick={() => setCancelOpen(true)} data-testid="booking-cancel">
                    Cancel booking
                  </Button>
                )}
              </Stack>
              {!b.actions.canCheckIn && b.status === 'CONFIRMED' && b.policy.checkInRequired && b.policy.checkInOpensAt && new Date(b.policy.checkInOpensAt) > new Date() && (
                <Alert severity="info" sx={{ mt: 2 }}>
                  Check-in opens {fmtRelative(b.policy.checkInOpensAt)}.
                </Alert>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Card>
            <CardContent sx={{ textAlign: 'center' }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'center', mb: 1 }}>
                <QrCodeRoundedIcon color="primary" />
                <Typography variant="h4" component="h2">
                  Check-in code
                </Typography>
              </Stack>
              {qr ? (
                <>
                  <img src={qr.dataUrl} alt={`QR code for check-in, code ${qr.code}`} width={220} height={220} style={{ borderRadius: 12, border: '1px solid #E2E8F0' }} />
                  <Typography variant="h3" sx={{ fontFamily: 'monospace', letterSpacing: '0.1em', mt: 1 }}>
                    {qr.code}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Scan at the desk or room, or enter the code on the check-in page.
                  </Typography>
                </>
              ) : b.checkInCode ? (
                <Typography variant="body2" color="text.secondary">
                  {['CONFIRMED', 'PENDING_APPROVAL'].includes(b.status) ? <Skeleton width={220} height={220} sx={{ mx: 'auto' }} /> : `Code ${b.checkInCode} · no longer needed for a ${b.status.toLowerCase().replace('_', ' ')} booking.`}
                </Typography>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Only the booking owner can see the check-in code.
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <ConfirmDialog
        open={cancelOpen}
        title="Cancel this booking?"
        description="The reservation record is kept in your history with a cancelled status."
        confirmLabel="Cancel booking"
        destructive
        loading={cancelling}
        onClose={() => setCancelOpen(false)}
        onConfirm={async () => {
          await run(() => cancel({ id: b.id, reason: reason || undefined, cancelSeries: cancelSeries || undefined }).unwrap(), 'Booking cancelled');
          setCancelOpen(false);
        }}
      >
        <TextField label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} sx={{ mt: 2 }} slotProps={{ htmlInput: { maxLength: 300 } }} />
        {b.seriesId && <FormControlLabel control={<Checkbox checked={cancelSeries} onChange={(e) => setCancelSeries(e.target.checked)} />} label="Also cancel all future occurrences of this series" sx={{ mt: 1 }} />}
      </ConfirmDialog>

      <BookingDialog open={modifyOpen} resource={rebookResource} startAt={b.startAt} endAt={b.endAt} modifyReservation={b} onClose={() => setModifyOpen(false)} />
      <BookingDialog open={rebookOpen} resource={rebookResource} startAt={tomorrow.hour(dayjs(b.startAt).tz(b.timezone).hour()).minute(dayjs(b.startAt).tz(b.timezone).minute()).toISOString()} endAt={tomorrow.hour(dayjs(b.endAt).tz(b.timezone).hour()).minute(dayjs(b.endAt).tz(b.timezone).minute()).toISOString()} onClose={() => setRebookOpen(false)} onBooked={() => navigate('/bookings')} />
    </PageTransition>
  );
}
