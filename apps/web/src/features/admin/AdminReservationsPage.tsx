// Reservation administration: search/filter, details with check-in records, cancel with reason,
// conflict investigation per resource, CSV export.
import { useMemo, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Drawer, FormControl, IconButton, InputLabel, List, ListItem, ListItemText, MenuItem, Select, Stack, TextField, Typography, Chip } from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import ManageSearchRoundedIcon from '@mui/icons-material/ManageSearchRounded';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { ReservationStatuses, type ReservationSummaryDto } from '@spaceflow/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { PageTransition } from '@/components/common/Motion';
import { ErrorState } from '@/components/common/Feedback';
import { StatusBadge } from '@/components/common/StatusBadge';
import { useToast } from '@/components/common/ToastProvider';
import { useViewOnMap } from '@/components/common/BookingCard';
import { useAdminCancelReservationMutation, useAdminReservationsQuery, useBuildingsQuery, useFloorsQuery, useReservationCheckInsQuery, useReservationConflictsQuery, useReservationQuery } from '@/services/endpoints';
import { errorMessage } from '@/services/api';
import { dayjs, fmtRange } from '@/utils/time';
import { DataTable, type Column } from './components/DataTable';
import { FilterBar } from './components/FilterBar';
import { downloadFile, qs } from './components/authFetch';

type Scope = 'all' | 'upcoming' | 'ongoing' | 'past' | 'cancelled';

export function AdminReservationsPage() {
  const toast = useToast();
  const [scope, setScope] = useState<Scope>('all');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [buildingId, setBuildingId] = useState('');
  const [floorId, setFloorId] = useState('');
  const [from, setFrom] = useState<string | null>(dayjs().subtract(7, 'day').format('YYYY-MM-DD'));
  const [to, setTo] = useState<string | null>(dayjs().add(14, 'day').format('YYYY-MM-DD'));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [detail, setDetail] = useState<ReservationSummaryDto | null>(null);
  const [conflict, setConflict] = useState<ReservationSummaryDto | null>(null);
  const { data: buildings } = useBuildingsQuery();
  const { data: floors } = useFloorsQuery({ buildingId }, { skip: !buildingId });
  const filters = {
    scope,
    q: q || undefined,
    status: (status || undefined) as ReservationSummaryDto['status'] | undefined,
    type: (type || undefined) as 'SEAT' | 'MEETING_ROOM' | undefined,
    buildingId: buildingId || undefined,
    floorId: floorId || undefined,
    from: from ? dayjs(from).startOf('day').toISOString() : undefined,
    to: to ? dayjs(to).endOf('day').toISOString() : undefined,
    sortDir: 'desc' as const,
  };
  const { data, isLoading, error, refetch, isFetching } = useAdminReservationsQuery({ ...filters, page, pageSize });

  const columns = useMemo<Column<ReservationSummaryDto>[]>(
    () => [
      { key: 'when', header: 'When', render: (r) => <Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>{fmtRange(r.startAt, r.endAt, r.timezone)}</Typography>, sortValue: (r) => r.startAt },
      { key: 'res', header: 'Resource', render: (r) => <Box><Typography variant="body2" sx={{ fontWeight: 600 }}>{r.title && r.type === 'MEETING_ROOM' ? r.title : r.resourceName}</Typography><Typography variant="caption" color="text.secondary">{r.resourceCode} · {r.buildingName} · {r.floorName}</Typography></Box>, sortValue: (r) => r.resourceCode },
      { key: 'type', header: 'Type', render: (r) => (r.type === 'SEAT' ? 'Desk' : 'Room') },
      { key: 'user', header: 'Booked by', render: (r) => r.userDisplayName, sortValue: (r) => r.userDisplayName },
      { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} />, sortValue: (r) => r.status },
      { key: 'ci', header: 'Checked in', render: (r) => (r.checkedInAt ? dayjs(r.checkedInAt).tz(r.timezone).format('HH:mm') : '–') },
    ],
    [],
  );

  const exportCsv = () => {
    const query = qs({ scope: filters.scope, q: filters.q, status: filters.status, type: filters.type, buildingId: filters.buildingId, floorId: filters.floorId, from: filters.from, to: filters.to });
    downloadFile(`/admin/reservations/export${query}`, `spaceflow-reservations-${dayjs().format('YYYYMMDD')}.csv`).catch((e) => toast.error(e.message));
  };

  return (
    <PageTransition>
      <PageHeader title="Reservations" subtitle="Search, inspect and manage every booking in the organization." crumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Reservations' }]} actions={<Button variant="outlined" startIcon={<DownloadRoundedIcon />} onClick={exportCsv}>Export CSV</Button>} />
      <FilterBar>
        <TextField label="Search resource, title or person" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} size="small" />
        <FormControl size="small">
          <InputLabel id="r-scope">Period</InputLabel>
          <Select labelId="r-scope" label="Period" value={scope} onChange={(e) => { setScope(e.target.value as Scope); setPage(1); }}>
            <MenuItem value="all">All</MenuItem>
            <MenuItem value="upcoming">Upcoming</MenuItem>
            <MenuItem value="ongoing">Ongoing</MenuItem>
            <MenuItem value="past">Past</MenuItem>
            <MenuItem value="cancelled">Cancelled / released</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small">
          <InputLabel id="r-status">Status</InputLabel>
          <Select labelId="r-status" label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <MenuItem value="">Any</MenuItem>
            {ReservationStatuses.map((s) => <MenuItem key={s} value={s}>{s.toLowerCase().replace('_', ' ')}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small">
          <InputLabel id="r-type">Type</InputLabel>
          <Select labelId="r-type" label="Type" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
            <MenuItem value="">All</MenuItem>
            <MenuItem value="SEAT">Desks</MenuItem>
            <MenuItem value="MEETING_ROOM">Rooms</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small">
          <InputLabel id="r-b">Building</InputLabel>
          <Select labelId="r-b" label="Building" value={buildingId} onChange={(e) => { setBuildingId(e.target.value); setFloorId(''); setPage(1); }}>
            <MenuItem value="">All</MenuItem>
            {(buildings ?? []).map((b) => <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" disabled={!buildingId}>
          <InputLabel id="r-f">Floor</InputLabel>
          <Select labelId="r-f" label="Floor" value={floorId} onChange={(e) => { setFloorId(e.target.value); setPage(1); }}>
            <MenuItem value="">All</MenuItem>
            {(floors ?? []).map((f) => <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>)}
          </Select>
        </FormControl>
        <DatePicker label="From" value={from ? dayjs(from) : null} onChange={(v) => { if (v && !v.isValid()) return; setFrom(v ? v.format('YYYY-MM-DD') : null); setPage(1); }} slotProps={{ textField: { size: 'small' }, field: { clearable: true } }} />
        <DatePicker label="To" value={to ? dayjs(to) : null} onChange={(v) => { if (v && !v.isValid()) return; setTo(v ? v.format('YYYY-MM-DD') : null); setPage(1); }} slotProps={{ textField: { size: 'small' }, field: { clearable: true } }} />
      </FilterBar>
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <DataTable ariaLabel="Reservations" data-testid="admin-reservations-table" rows={data?.items ?? []} columns={columns} rowKey={(r) => r.id} loading={isLoading} total={data?.total ?? 0} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} onRowClick={setDetail} emptyTitle="No reservations match these filters" dense />
      )}
      {isFetching && !isLoading && <Typography variant="caption" color="text.secondary" aria-live="polite">Refreshing…</Typography>}
      <DetailDrawer summary={detail} onClose={() => setDetail(null)} onInvestigate={(r) => setConflict(r)} />
      <ConflictDialog reservation={conflict} onClose={() => setConflict(null)} />
    </PageTransition>
  );
}

function DetailDrawer({ summary, onClose, onInvestigate }: { summary: ReservationSummaryDto | null; onClose: () => void; onInvestigate: (r: ReservationSummaryDto) => void }) {
  const id = summary?.id ?? '';
  const { data: r, isLoading, error } = useReservationQuery({ id }, { skip: !summary });
  const { data: checkIns } = useReservationCheckInsQuery({ id }, { skip: !summary });
  const [cancel, { isLoading: cancelling }] = useAdminCancelReservationMutation();
  const [reason, setReason] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const toast = useToast();
  const viewOnMap = useViewOnMap();
  const active = r && ['CONFIRMED', 'PENDING_APPROVAL', 'CHECKED_IN'].includes(r.status);
  return (
    <Drawer anchor="right" open={!!summary} onClose={onClose} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 480 } } } }}>
      <Box sx={{ p: 2.5 }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h4" component="h2">Reservation details</Typography>
          <IconButton aria-label="Close" onClick={onClose}><CloseRoundedIcon /></IconButton>
        </Stack>
        {isLoading && <CircularProgress sx={{ mt: 2 }} />}
        {error && <Alert severity="error" sx={{ mt: 2 }}>{errorMessage(error)}</Alert>}
        {r && (
          <Stack spacing={2} sx={{ mt: 2 }}>
            <Box>
              <Typography variant="h5">{r.title && r.type === 'MEETING_ROOM' ? r.title : r.resourceName}</Typography>
              <Typography variant="body2" color="text.secondary">{r.resourceName} ({r.resourceCode}) · {r.buildingName} · {r.floorName}{r.zoneName ? ` · ${r.zoneName}` : ''}</Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                <StatusBadge status={r.status} />
                {r.seriesId && <Chip size="small" variant="outlined" label="Recurring series" />}
              </Stack>
            </Box>
            <Row label="When" value={`${fmtRange(r.startAt, r.endAt, r.timezone)} (${r.timezone})`} />
            <Row label="Booked by" value={r.userDisplayName} />
            <Row label="Created" value={dayjs(r.createdAt).format('D MMM YYYY HH:mm')} />
            {r.description && <Row label="Description" value={r.description} />}
            {r.setupNotes && <Row label="Setup requests" value={r.setupNotes} />}
            {r.attendees.length > 0 && <Row label="Attendees" value={r.attendees.map((a) => a.email ?? a.name).join(', ')} />}
            {r.cancelledAt && <Row label="Cancelled" value={`${dayjs(r.cancelledAt).format('D MMM HH:mm')}${r.cancelReason ? ` · ${r.cancelReason}` : ''}`} />}
            {r.approval && <Row label="Approval" value={`${r.approval.status.toLowerCase()}${r.approval.approverName ? ` by ${r.approval.approverName}` : ''}${r.approval.decisionNote ? ` · ${r.approval.decisionNote}` : ''}`} />}
            <Row label="Check-in code" value={r.checkInCode ?? '–'} />
            <Divider />
            <Box>
              <Typography variant="subtitle2" gutterBottom>Check-in records</Typography>
              {(checkIns ?? []).length === 0 ? (
                <Typography variant="body2" color="text.secondary">No check-in recorded.</Typography>
              ) : (
                <List dense disablePadding>
                  {(checkIns ?? []).map((c) => (
                    <ListItem key={c.id} disableGutters>
                      <ListItemText primary={`${c.kind === 'IN' ? 'Checked in' : 'Checked out'} · ${c.method.toLowerCase()}`} secondary={`${dayjs(c.at).tz(r.timezone).format('D MMM HH:mm')}${c.by ? ` by ${c.by}` : ''}`} />
                    </ListItem>
                  ))}
                </List>
              )}
            </Box>
            <Divider />
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <Button variant="outlined" onClick={() => viewOnMap({ buildingId: r.buildingId, floorId: r.floorId, resourceId: r.resourceId })}>View on map</Button>
              <Button variant="outlined" startIcon={<ManageSearchRoundedIcon />} onClick={() => summary && onInvestigate(summary)}>Investigate conflicts</Button>
              {active && <Button variant="contained" color="error" onClick={() => { setReason(''); setCancelError(null); setCancelOpen(true); }}>Cancel booking</Button>}
            </Stack>
          </Stack>
        )}
      </Box>
      <Dialog open={cancelOpen} onClose={() => setCancelOpen(false)} fullWidth maxWidth="xs" aria-labelledby="admin-cancel-title">
        <DialogTitle id="admin-cancel-title">Cancel on behalf of {r?.userDisplayName}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>The booking is kept for history with status cancelled. The employee is notified with your reason and the action is recorded in the audit log.</Typography>
          {cancelError && <Alert severity="error" sx={{ mb: 2 }}>{cancelError}</Alert>}
          <TextField autoFocus label="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 300 } }} />
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setCancelOpen(false)}>Back</Button>
          <Button
            variant="contained"
            color="error"
            disabled={reason.trim().length < 3 || cancelling}
            onClick={async () => {
              if (!r) return;
              try {
                await cancel({ id: r.id, reason: reason.trim() }).unwrap();
                toast.success('Reservation cancelled');
                setCancelOpen(false);
              } catch (err) {
                setCancelError(errorMessage(err));
              }
            }}
          >
            Cancel booking
          </Button>
        </DialogActions>
      </Dialog>
    </Drawer>
  );
}

function ConflictDialog({ reservation, onClose }: { reservation: ReservationSummaryDto | null; onClose: () => void }) {
  const from = reservation ? dayjs(reservation.startAt).subtract(1, 'day').toISOString() : undefined;
  const to = reservation ? dayjs(reservation.endAt).add(1, 'day').toISOString() : undefined;
  const { data, isLoading, error } = useReservationConflictsQuery({ resourceId: reservation?.resourceId ?? '', from, to }, { skip: !reservation });
  const overlapsWith = (a: { startAt: string; endAt: string; status: string }) => reservation && a.startAt < reservation.endAt && reservation.startAt < a.endAt;
  return (
    <Dialog open={!!reservation} onClose={onClose} fullWidth maxWidth="md" aria-labelledby="conflict-title">
      <DialogTitle id="conflict-title">Activity on {reservation?.resourceName} around this booking</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          All reservations on this resource from one day before to one day after, with their audit trail. Active reservations can never overlap (enforced by the database); overlapping rows below are cancelled, rejected or released ones.
        </Typography>
        {isLoading && <CircularProgress />}
        {error && <Alert severity="error">{errorMessage(error)}</Alert>}
        {data && (
          <Stack spacing={2}>
            <List dense>
              {data.reservations.map((x) => (
                <ListItem key={x.id} divider sx={{ bgcolor: x.id === reservation?.id ? 'rgba(79,70,229,0.06)' : overlapsWith(x) ? 'rgba(220,38,38,0.05)' : undefined }} secondaryAction={<StatusBadge status={x.status as ReservationSummaryDto['status']} />}>
                  <ListItemText primary={`${fmtRange(x.startAt, x.endAt, reservation?.timezone)} · ${x.user}`} secondary={`${x.email} · created ${dayjs(x.createdAt).format('D MMM HH:mm:ss')}${x.id === reservation?.id ? ' · this booking' : overlapsWith(x) ? ' · overlaps' : ''}`} />
                </ListItem>
              ))}
            </List>
            <Box>
              <Typography variant="subtitle2" gutterBottom>Audit trail</Typography>
              <List dense>
                {data.audit.map((a) => (
                  <ListItem key={a.id} disableGutters>
                    <ListItemText primary={a.action} secondary={`${dayjs(a.createdAt).format('D MMM HH:mm:ss')} · reservation ${a.entityId.slice(0, 8)}`} />
                  </ListItem>
                ))}
                {data.audit.length === 0 && <Typography variant="body2" color="text.secondary">No audit entries.</Typography>}
              </List>
            </Box>
          </Stack>
        )}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="subtitle2">{label}</Typography>
      <Typography variant="body2">{value}</Typography>
    </Box>
  );
}
