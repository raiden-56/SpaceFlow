import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, CardContent, FormControl, Grid, InputAdornment, InputLabel, MenuItem, Pagination, Select, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import EventNoteRoundedIcon from '@mui/icons-material/EventNoteRounded';
import { ReservationStatuses } from '@spaceflow/shared';
import { useBuildingsQuery, useMyReservationsQuery } from '@/services/endpoints';
import { PageHeader } from '@/components/common/PageHeader';
import { PageTransition, StaggerItem, StaggerList } from '@/components/common/Motion';
import { BookingCard } from '@/components/common/BookingCard';
import { ErrorState, GridSkeleton } from '@/components/common/Feedback';
import { EmptyState } from '@/components/common/EmptyState';
import { dayjs } from '@/utils/time';

const SCOPES = ['upcoming', 'ongoing', 'past', 'cancelled'] as const;
type Scope = (typeof SCOPES)[number];

export function MyBookingsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const scope = (SCOPES.includes(params.get('tab') as Scope) ? params.get('tab') : 'upcoming') as Scope;
  const [type, setType] = useState('');
  const [buildingId, setBuildingId] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [page, setPage] = useState(1);
  const { data: buildings } = useBuildingsQuery();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [scope, type, buildingId, status, from, to, debouncedQ]);

  const query = useMemo(
    () => ({
      scope,
      type: (type || undefined) as 'SEAT' | 'MEETING_ROOM' | undefined,
      buildingId: buildingId || undefined,
      status: (status || undefined) as (typeof ReservationStatuses)[number] | undefined,
      from: from ? dayjs(from).startOf('day').toISOString() : undefined,
      to: to ? dayjs(to).endOf('day').toISOString() : undefined,
      q: debouncedQ || undefined,
      page,
      pageSize: 12,
    }),
    [scope, type, buildingId, status, from, to, debouncedQ, page],
  );
  const { data, isLoading, isFetching, error, refetch } = useMyReservationsQuery(query);
  const statusesForScope = scope === 'cancelled' ? ['CANCELLED', 'REJECTED', 'RELEASED'] : scope === 'past' ? ['COMPLETED', 'NO_SHOW'] : scope === 'ongoing' ? ['CONFIRMED', 'CHECKED_IN'] : ['CONFIRMED', 'PENDING_APPROVAL'];

  return (
    <PageTransition>
      <PageHeader title="My bookings" subtitle="All your desk and meeting room reservations in one place." actions={<Button variant="contained" onClick={() => navigate('/book-seat')}>New booking</Button>} />
      <Tabs value={scope} onChange={(_e, v) => setParams({ tab: v })} variant="scrollable" allowScrollButtonsMobile aria-label="Booking categories" sx={{ mb: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
        {SCOPES.map((s) => (
          <Tab key={s} value={s} label={s.charAt(0).toUpperCase() + s.slice(1)} data-testid={`bookings-tab-${s}`} />
        ))}
      </Tabs>
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ flexWrap: 'wrap', alignItems: { md: 'center' } }} useFlexGap>
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel id="bk-type">Type</InputLabel>
              <Select labelId="bk-type" label="Type" value={type} onChange={(e) => setType(e.target.value)}>
                <MenuItem value="">All types</MenuItem>
                <MenuItem value="SEAT">Seats</MenuItem>
                <MenuItem value="MEETING_ROOM">Meeting rooms</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 170 }}>
              <InputLabel id="bk-building">Building</InputLabel>
              <Select labelId="bk-building" label="Building" value={buildingId} onChange={(e) => setBuildingId(e.target.value)}>
                <MenuItem value="">All buildings</MenuItem>
                {(buildings ?? []).map((b) => (
                  <MenuItem key={b.id} value={b.id}>
                    {b.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel id="bk-status">Status</InputLabel>
              <Select labelId="bk-status" label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <MenuItem value="">Any status</MenuItem>
                {statusesForScope.map((s) => (
                  <MenuItem key={s} value={s}>
                    {s.toLowerCase().replace('_', ' ')}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <DatePicker label="From" value={from ? dayjs(from) : null} onChange={(v) => { if (!v) setFrom(null); else if (v.isValid()) setFrom(v.format('YYYY-MM-DD')); }} slotProps={{ textField: { size: 'small', sx: { minWidth: 150 } }, field: { clearable: true } }} />
            <DatePicker label="To" value={to ? dayjs(to) : null} onChange={(v) => { if (!v) setTo(null); else if (v.isValid()) setTo(v.format('YYYY-MM-DD')); }} slotProps={{ textField: { size: 'small', sx: { minWidth: 150 } }, field: { clearable: true } }} />
            {(scope === 'past' || scope === 'cancelled') && (
              <TextField
                size="small"
                placeholder="Search by resource or title"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> }, htmlInput: { 'aria-label': 'Search past bookings' } }}
                sx={{ minWidth: 220 }}
              />
            )}
          </Stack>
        </CardContent>
      </Card>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }} aria-live="polite">
        {data ? `${data.total} booking${data.total === 1 ? '' : 's'}${isFetching ? ' · updating…' : ''}` : ''}
      </Typography>
      {error ? (
        <ErrorState error={error} onRetry={refetch} title="Could not load bookings" />
      ) : isLoading ? (
        <GridSkeleton count={6} height={180} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={<EventNoteRoundedIcon />} title={`No ${scope} bookings`} description={scope === 'upcoming' ? 'Book a desk or a meeting room and it will show up here.' : 'Nothing to show for the selected filters.'} actionLabel={scope === 'upcoming' ? 'Book a seat' : undefined} onAction={() => navigate('/book-seat')} />
      ) : (
        <>
          <StaggerList>
            <Grid container spacing={2}>
              {data.items.map((b) => (
                <Grid key={b.id} size={{ xs: 12, sm: 6, lg: 4 }}>
                  <StaggerItem>
                    <BookingCard booking={b} onOpen={(x) => navigate(`/bookings/${x.id}`)} />
                  </StaggerItem>
                </Grid>
              ))}
            </Grid>
          </StaggerList>
          {data.totalPages > 1 && (
            <Stack sx={{ alignItems: 'center', mt: 3 }}>
              <Pagination count={data.totalPages} page={page} onChange={(_e, p) => setPage(p)} color="primary" />
            </Stack>
          )}
        </>
      )}
    </PageTransition>
  );
}
