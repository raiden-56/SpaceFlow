import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Card, CardContent, Checkbox, Chip, FormControl, FormControlLabel, Grid, InputLabel, MenuItem, Pagination, Select, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Typography, Skeleton } from '@mui/material';
import GridViewRoundedIcon from '@mui/icons-material/GridViewRounded';
import ViewListRoundedIcon from '@mui/icons-material/ViewListRounded';
import MapRoundedIcon from '@mui/icons-material/MapRounded';
import PeopleAltRoundedIcon from '@mui/icons-material/PeopleAltRounded';
import { RoomTypes, type ResourceDto } from '@spaceflow/shared';
import { useAmenitiesQuery, useResourceDayQuery, useResourcesQuery } from '@/services/endpoints';
import { FloorMapPicker } from '@/features/map3d/FloorMapPicker';
import { ResourceDetailsPanel } from '@/components/common/ResourceDetailsPanel';
import { useBookingWindow } from '@/hooks/useBookingWindow';
import { useAppDispatch } from '@/store';
import { setFloor, setTimeWindow } from '@/store/bookingSlice';
import { PageHeader } from '@/components/common/PageHeader';
import { PageTransition } from '@/components/common/Motion';
import { BookingCriteriaBar } from '@/components/common/BookingCriteriaBar';
import { ResourceCard } from '@/components/common/ResourceCard';
import { SlotStrip } from '@/components/common/ResourceDetailsPanel';
import { StatusBadge } from '@/components/common/StatusBadge';
import { BookingDialog } from '@/features/bookings/BookingDialog';
import { ErrorState, GridSkeleton } from '@/components/common/Feedback';
import { EmptyState } from '@/components/common/EmptyState';
import { useViewOnMap } from '@/components/common/BookingCard';
import { dayjs } from '@/utils/time';

function RoomSlots({ room, date, startAt, endAt, onPick }: { room: ResourceDto; date: string; startAt: string; endAt: string; onPick: (startAt: string) => void }) {
  const { data, isLoading } = useResourceDayQuery({ id: room.id, date });
  if (isLoading) return <Skeleton variant="rounded" height={32} />;
  return <SlotStrip slots={data?.slots ?? []} tz={room.buildingTimezone} selectedStart={startAt} selectedEnd={endAt} onPick={(s) => onPick(s.startAt)} />;
}

export function MeetingRoomsPage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const viewOnMap = useViewOnMap();
  const ctx = useBookingWindow();
  const { data: amenities } = useAmenitiesQuery();
  const [attendees, setAttendees] = useState(2);
  const [duration, setDuration] = useState(60);
  const [roomType, setRoomType] = useState('');
  const [accessible, setAccessible] = useState(false);
  const [availableOnly, setAvailableOnly] = useState(true);
  const [amenityIds, setAmenityIds] = useState<string[]>([]);
  const [view, setView] = useState<'cards' | 'list' | 'map'>('cards');
  const [mapRoom, setMapRoom] = useState<ResourceDto | null>(null);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [booking, setBooking] = useState<{ resource: ResourceDto; startAt: string; endAt: string } | null>(null);

  // Duration drives the end time when the user is not in full-day mode.
  const applyDuration = (mins: number) => {
    setDuration(mins);
    const end = dayjs(`2000-01-01 ${ctx.startTime}`, 'YYYY-MM-DD HH:mm').add(mins, 'minute').format('HH:mm');
    dispatch(setTimeWindow({ allDay: false, endTime: end }));
  };

  const baseQuery = {
      type: 'MEETING_ROOM' as const,
      buildingId: ctx.buildingId ?? undefined,
      floorId: ctx.floorId ?? undefined,
      startAt: ctx.startAt,
      endAt: ctx.endAt,
      minCapacity: attendees || undefined,
      accessible: accessible || undefined,
      availableOnly: availableOnly || undefined,
      amenityIds: amenityIds.length ? amenityIds : undefined,
  };
  const { data, isLoading, isFetching, error, refetch } = useResourcesQuery({ ...baseQuery, page, pageSize: 20 }, { skip: !ctx.buildingId || view === 'map' });
  const { data: mapMatches } = useResourcesQuery({ ...baseQuery, page: 1, pageSize: 200 }, { skip: !ctx.floorId || view !== 'map' });
  const highlightIds = useMemo(() => (mapMatches ? new Set(mapMatches.items.filter((r) => !roomType || r.roomType === roomType).map((r) => r.id)) : null), [mapMatches, roomType]);
  /** Show a room on the in-page map (stays on this page, keeps all filters). */
  const showOnMap = (r: ResourceDto) => {
    dispatch(setFloor(r.floorId));
    setMapRoom(r);
    setView('map');
  };
  const roomAmenities = (amenities ?? []).filter((a) => a.category !== 'SEAT');
  const items = useMemo(() => {
    const list = (data?.items ?? []).filter((r) => !roomType || r.roomType === roomType);
    // Smart matching: best capacity fit first, then availability.
    return [...list].sort((a, b) => {
      const av = (r: ResourceDto) => (r.availability?.state === 'AVAILABLE' ? 0 : r.availability?.state === 'RESTRICTED' ? 1 : 2);
      const fit = (r: ResourceDto) => Math.abs((r.capacity ?? 0) - attendees);
      return av(a) - av(b) || fit(a) - fit(b);
    });
  }, [data, roomType, attendees]);

  const book = (r: ResourceDto, startAt = ctx.startAt) => {
    const endAt = dayjs(startAt).add(duration, 'minute').toISOString();
    setBooking({ resource: r, startAt, endAt });
  };

  return (
    <PageTransition>
      <PageHeader
        title="Meeting rooms"
        subtitle="Find a room that fits your meeting and reserve it in seconds."
        actions={
          <Button variant="outlined" startIcon={<MapRoundedIcon />} onClick={() => setView('map')} data-testid="rooms-pick-on-map">
            Pick on the map
          </Button>
        }
      />
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <BookingCriteriaBar showAllFloors allowAllDay={false} />
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mt: 1.5, alignItems: { md: 'center' }, flexWrap: 'wrap' }} useFlexGap>
            <FormControl size="small" sx={{ minWidth: 130 }}>
              <InputLabel id="dur-label">Duration</InputLabel>
              <Select labelId="dur-label" label="Duration" value={duration} onChange={(e) => applyDuration(Number(e.target.value))}>
                {[15, 30, 45, 60, 90, 120, 180, 240].map((m) => (
                  <MenuItem key={m} value={m}>
                    {m < 60 ? `${m} min` : `${m / 60} h${m % 60 ? ` ${m % 60}m` : ''}`}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField label="Attendees" type="number" size="small" value={attendees} onChange={(e) => setAttendees(Math.max(1, Math.min(500, Number(e.target.value) || 1)))} slotProps={{ htmlInput: { min: 1, max: 500, 'aria-label': 'Number of attendees' } }} sx={{ width: 120 }} />
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel id="rt-label">Room type</InputLabel>
              <Select labelId="rt-label" label="Room type" value={roomType} onChange={(e) => setRoomType(e.target.value)}>
                <MenuItem value="">Any</MenuItem>
                {RoomTypes.map((t) => (
                  <MenuItem key={t} value={t}>
                    {t.charAt(0) + t.slice(1).toLowerCase()}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel id="ra-label">Equipment</InputLabel>
              <Select labelId="ra-label" label="Equipment" multiple value={amenityIds} onChange={(e) => setAmenityIds(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)} renderValue={(sel) => sel.map((id) => roomAmenities.find((a) => a.id === id)?.name ?? id).join(', ')}>
                {roomAmenities.map((a) => (
                  <MenuItem key={a.id} value={a.id}>
                    <Checkbox size="small" checked={amenityIds.includes(a.id)} />
                    {a.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControlLabel control={<Checkbox checked={accessible} onChange={(e) => setAccessible(e.target.checked)} />} label="Accessible" />
            <FormControlLabel control={<Checkbox checked={availableOnly} onChange={(e) => setAvailableOnly(e.target.checked)} />} label="Available only" />
          </Stack>
        </CardContent>
      </Card>

      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
        <Typography variant="body2" color="text.secondary" aria-live="polite">
          {view === 'map' ? 'Tap a room on the map to see its free slots and book it.' : data ? `${items.length} room${items.length === 1 ? '' : 's'} for ${attendees} attendee${attendees === 1 ? '' : 's'}${isFetching ? ' · updating…' : ''}` : ''}
        </Typography>
        <ToggleButtonGroup size="small" exclusive value={view} onChange={(_e, v) => v && setView(v)} aria-label="Layout">
          <ToggleButton value="cards" aria-label="Card view">
            <GridViewRoundedIcon fontSize="small" />
          </ToggleButton>
          <ToggleButton value="list" aria-label="List view">
            <ViewListRoundedIcon fontSize="small" />
          </ToggleButton>
          <ToggleButton value="map" aria-label="Map view" data-testid="rooms-view-map">
            <MapRoundedIcon fontSize="small" />
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {view === 'map' ? (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, lg: 8 }}>
            <FloorMapPicker type="MEETING_ROOM" highlightIds={highlightIds} selectedResourceId={mapRoom?.id ?? null} onSelect={setMapRoom} showTeammates={false} height={520} />
          </Grid>
          <Grid size={{ xs: 12, lg: 4 }}>
            <Card sx={{ position: { lg: 'sticky' }, top: 80 }}>
              <ResourceDetailsPanel resource={mapRoom} date={ctx.date} startAt={ctx.startAt} endAt={dayjs(ctx.startAt).add(duration, 'minute').toISOString()} onClose={() => setMapRoom(null)} onSelectAlternative={() => setMapRoom(null)} />
            </Card>
          </Grid>
        </Grid>
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} title="Could not load rooms" />
      ) : isLoading ? (
        <GridSkeleton count={6} height={200} />
      ) : items.length === 0 ? (
        <EmptyState title="No rooms match" description="Try a different time, fewer attendees or another building." />
      ) : view === 'cards' ? (
        <Grid container spacing={2}>
          {items.map((r) => (
            <Grid key={r.id} size={{ xs: 12, sm: 6, lg: 4 }}>
              <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <ResourceCard resource={r} selected={expanded === r.id} onSelect={(x) => setExpanded((e) => (e === x.id ? null : x.id))} onBook={(x) => book(x)} />
                {expanded === r.id && (
                  <Card sx={{ mt: 1 }}>
                    <CardContent sx={{ py: 1.5 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                        Slots on {dayjs(ctx.date).format('ddd D MMM')} · tap a free slot to book from that time
                      </Typography>
                      <RoomSlots room={r} date={ctx.date} startAt={ctx.startAt} endAt={ctx.endAt} onPick={(s) => book(r, s)} />
                      <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                        <Button size="small" startIcon={<MapRoundedIcon />} onClick={() => showOnMap(r)}>
                          Show on map
                        </Button>
                      </Stack>
                    </CardContent>
                  </Card>
                )}
              </Box>
            </Grid>
          ))}
        </Grid>
      ) : (
        <Card sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label="Meeting rooms">
            <TableHead>
              <TableRow>
                <TableCell>Room</TableCell>
                <TableCell>Capacity</TableCell>
                <TableCell>Location</TableCell>
                <TableCell>Availability</TableCell>
                <TableCell>Amenities</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {r.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {r.code} · {(r.roomType ?? '').toLowerCase()}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" icon={<PeopleAltRoundedIcon />} label={r.capacity} variant="outlined" />
                  </TableCell>
                  <TableCell>
                    {r.buildingName} · {r.floorName}
                  </TableCell>
                  <TableCell>{r.availability ? <StatusBadge status={r.availability.state} /> : '—'}</TableCell>
                  <TableCell sx={{ maxWidth: 260 }}>
                    <Typography variant="caption" noWrap sx={{ display: 'block' }}>
                      {r.amenities.map((a) => a.name).join(', ') || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Button size="small" onClick={() => showOnMap(r)}>
                      Map
                    </Button>
                    <Button size="small" variant="contained" disabled={!r.availability?.canBook} onClick={() => book(r)} sx={{ ml: 1 }}>
                      Book
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {view !== 'map' && data && data.totalPages > 1 && (
        <Stack sx={{ alignItems: 'center', mt: 2 }}>
          <Pagination count={data.totalPages} page={page} onChange={(_e, p) => setPage(p)} color="primary" />
        </Stack>
      )}
      <BookingDialog open={!!booking} resource={booking?.resource ?? null} startAt={booking?.startAt} endAt={booking?.endAt} onClose={() => setBooking(null)} onSelectAlternative={(alt) => setBooking({ resource: alt.resource, startAt: alt.startAt, endAt: alt.endAt })} />
    </PageTransition>
  );
}
