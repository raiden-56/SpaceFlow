import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, Button, Card, CardContent, Checkbox, Chip, Drawer, FormControl, FormControlLabel, FormGroup, Grid, InputLabel, MenuItem, Pagination, Select, Stack, ToggleButton, ToggleButtonGroup, Typography, useMediaQuery, useTheme, Collapse } from '@mui/material';
import ViewModuleRoundedIcon from '@mui/icons-material/ViewModuleRounded';
import ViewInArRoundedIcon from '@mui/icons-material/ViewInArRounded';
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import MapRoundedIcon from '@mui/icons-material/MapRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import { SEAT_ATTRIBUTE_LABELS, SeatTypes, type ResourceDto, type SeatAttributeKey } from '@spaceflow/shared';
import { useAmenitiesQuery, useFavoritesQuery, useFloorMapQuery, useRecentResourcesQuery, useResourcesQuery, useSuggestSeatsQuery } from '@/services/endpoints';
import { FloorMapPicker } from '@/features/map3d/FloorMapPicker';
import { useBookingWindow } from '@/hooks/useBookingWindow';
import { useAppDispatch, useAppSelector } from '@/store';
import { selectResource } from '@/store/bookingSlice';
import { PageHeader } from '@/components/common/PageHeader';
import { PageTransition } from '@/components/common/Motion';
import { BookingCriteriaBar } from '@/components/common/BookingCriteriaBar';
import { ResourceCard } from '@/components/common/ResourceCard';
import { ResourceDetailsPanel } from '@/components/common/ResourceDetailsPanel';
import { BookingDialog } from '@/features/bookings/BookingDialog';
import { ErrorState, GridSkeleton } from '@/components/common/Feedback';
import { EmptyState } from '@/components/common/EmptyState';
import { AvailabilityLegend } from '@/components/common/AvailabilityLegend';

type ResultsView = 'cards' | 'map' | '3d';
const VIEW_KEY = 'sf.bookSeat.view';
function initialView(): ResultsView {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'map' || v === '3d' || v === 'cards' ? v : 'cards';
  } catch {
    return 'cards';
  }
}

const ATTR_KEYS: SeatAttributeKey[] = ['nearWindow', 'nearElevator', 'monitor', 'dockingStation', 'heightAdjustable', 'accessible', 'quietZone'];

export function BookSeatPage() {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('lg'));
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [params, setParams] = useSearchParams();
  const ctx = useBookingWindow();
  const selectedId = useAppSelector((s) => s.booking.selectedResourceId);
  const { data: amenities } = useAmenitiesQuery();
  const { data: favorites } = useFavoritesQuery();
  const { data: map } = useFloorMapQuery({ floorId: ctx.floorId! }, { skip: !ctx.floorId });

  const [availableOnly, setAvailableOnly] = useState(true);
  const [attrs, setAttrs] = useState<Record<string, boolean>>({});
  const [nearTeam, setNearTeam] = useState(false);
  const [zoneId, setZoneId] = useState('');
  const [seatType, setSeatType] = useState('');
  const [amenityIds, setAmenityIds] = useState<string[]>(() => (params.get('amenityIds') ?? '').split(',').filter(Boolean));
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(!mobile);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [bookResource, setBookResource] = useState<ResourceDto | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [view, setView] = useState<ResultsView>(initialView);
  const changeView = (v: ResultsView | null) => {
    if (!v) return;
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* storage unavailable */
    }
  };
  const { data: recent } = useRecentResourcesQuery();
  const usualSeat = (recent ?? []).find((r) => r.type === 'SEAT' && r.status === 'ACTIVE') ?? null;

  useEffect(() => {
    const next = new URLSearchParams(params);
    if (amenityIds.length) next.set('amenityIds', amenityIds.join(','));
    else next.delete('amenityIds');
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [amenityIds, params, setParams]);

  useEffect(() => setPage(1), [ctx.floorId, ctx.buildingId, ctx.date, ctx.startAt, ctx.endAt, availableOnly, attrs, nearTeam, zoneId, seatType, amenityIds]);

  const query = useMemo(
    () => ({
      type: 'SEAT' as const,
      buildingId: ctx.buildingId ?? undefined,
      floorId: ctx.floorId ?? undefined,
      zoneId: zoneId || undefined,
      startAt: ctx.startAt,
      endAt: ctx.endAt,
      availableOnly: availableOnly || undefined,
      nearTeam: nearTeam || undefined,
      amenityIds: amenityIds.length ? amenityIds : undefined,
      page,
      pageSize: 24,
      ...Object.fromEntries(ATTR_KEYS.filter((k) => attrs[k]).map((k) => [k, true])),
    }),
    [ctx.buildingId, ctx.floorId, ctx.startAt, ctx.endAt, zoneId, availableOnly, nearTeam, amenityIds, page, attrs],
  );
  const { data, isLoading, isFetching, error, refetch } = useResourcesQuery(query, { skip: !ctx.buildingId || view !== 'cards' });
  const mapQuery = useMemo(() => ({ ...query, page: 1, pageSize: 200 }), [query]);
  const { data: mapMatches } = useResourcesQuery(mapQuery, { skip: !ctx.floorId || view === 'cards' });
  const highlightIds = useMemo(() => (mapMatches ? new Set(mapMatches.items.filter((r) => !seatType || r.seatType === seatType).map((r) => r.id)) : null), [mapMatches, seatType]);
  const [mapPicked, setMapPicked] = useState<ResourceDto | null>(null);
  const { data: suggestions, isFetching: suggesting } = useSuggestSeatsQuery({ buildingId: ctx.buildingId ?? undefined, floorId: ctx.floorId ?? undefined, startAt: ctx.startAt, endAt: ctx.endAt, limit: 4 }, { skip: !showSuggestions || !ctx.buildingId });

  const items = useMemo(() => (data?.items ?? []).filter((r) => !seatType || r.seatType === seatType), [data, seatType]);
  const selected = items.find((r) => r.id === selectedId) ?? (mapPicked?.id === selectedId ? mapPicked : null) ?? suggestions?.find((r) => r.id === selectedId) ?? favorites?.find((f) => f.resource.id === selectedId)?.resource ?? null;
  const seatAmenities = (amenities ?? []).filter((a) => a.category !== 'ROOM');
  const favSeats = (favorites ?? []).map((f) => f.resource).filter((r) => r.type === 'SEAT');

  const pick = (r: ResourceDto) => {
    dispatch(selectResource(r.id));
    if (mobile) setDetailsOpen(true);
  };

  const details = (
    <ResourceDetailsPanel
      resource={selected}
      date={ctx.date}
      startAt={ctx.startAt}
      endAt={ctx.endAt}
      onClose={mobile ? () => setDetailsOpen(false) : undefined}
      onSelectAlternative={(id) => dispatch(selectResource(id))}
      onBooked={() => setDetailsOpen(false)}
    />
  );

  return (
    <PageTransition>
      <PageHeader
        title="Book a seat"
        subtitle="Pick a date and time, filter by what you need, then book in one click."
        actions={
          <>
            <Button variant="outlined" startIcon={<AutoAwesomeRoundedIcon />} onClick={() => setShowSuggestions((s) => !s)} disabled={suggesting}>
              Find me a seat
            </Button>
            {usualSeat && (
              <Button variant="outlined" startIcon={<ReplayRoundedIcon />} onClick={() => setBookResource(usualSeat)} data-testid="book-usual-seat">
                Book {usualSeat.code} again
              </Button>
            )}
            <ToggleButtonGroup exclusive size="small" value={view} onChange={(_e, v) => changeView(v)} aria-label="Results view">
              <ToggleButton value="cards" aria-label="Show results as cards" data-testid="seat-view-cards"><ViewModuleRoundedIcon fontSize="small" sx={{ mr: 0.5 }} />Cards</ToggleButton>
              <ToggleButton value="map" aria-label="Pick on the floor map" data-testid="seat-view-map"><MapRoundedIcon fontSize="small" sx={{ mr: 0.5 }} />Map</ToggleButton>
              <ToggleButton value="3d" aria-label="Pick in 3D" data-testid="seat-view-3d"><ViewInArRoundedIcon fontSize="small" sx={{ mr: 0.5 }} />3D</ToggleButton>
            </ToggleButtonGroup>
          </>
        }
      />
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <BookingCriteriaBar />
        </CardContent>
      </Card>

      <Collapse in={showSuggestions}>
        <Card sx={{ mb: 2, borderColor: 'primary.light' }}>
          <CardContent>
            <Typography variant="h3" component="h2" gutterBottom>
              Suggested for you
            </Typography>
            {suggesting ? (
              <GridSkeleton count={4} height={140} />
            ) : suggestions && suggestions.length ? (
              <Grid container spacing={2}>
                {suggestions.map((r) => (
                  <Grid key={r.id} size={{ xs: 12, sm: 6, md: 3 }}>
                    <ResourceCard resource={r} selected={r.id === selectedId} onSelect={pick} onBook={setBookResource} dense showLocation={false} />
                  </Grid>
                ))}
              </Grid>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No free seats match your usual preferences for this time. Try another floor or time.
              </Typography>
            )}
          </CardContent>
        </Card>
      </Collapse>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 3 }}>
          <Card>
            <CardContent>
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="h4" component="h2">
                  Filters
                </Typography>
                <Button size="small" startIcon={<TuneRoundedIcon />} onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen}>
                  {filtersOpen ? 'Hide' : 'Show'}
                </Button>
              </Stack>
              <Collapse in={filtersOpen}>
                <FormGroup sx={{ mt: 1 }}>
                  <FormControlLabel control={<Checkbox checked={availableOnly} onChange={(e) => setAvailableOnly(e.target.checked)} />} label="Available only" />
                  <FormControlLabel control={<Checkbox checked={nearTeam} onChange={(e) => setNearTeam(e.target.checked)} />} label="Near my teammates" />
                  {ATTR_KEYS.map((k) => (
                    <FormControlLabel key={k} control={<Checkbox checked={!!attrs[k]} onChange={(e) => setAttrs((a) => ({ ...a, [k]: e.target.checked }))} />} label={SEAT_ATTRIBUTE_LABELS[k]} />
                  ))}
                </FormGroup>
                <FormControl size="small" fullWidth sx={{ mt: 1.5 }}>
                  <InputLabel id="zone-label">Zone / neighborhood</InputLabel>
                  <Select labelId="zone-label" label="Zone / neighborhood" value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                    <MenuItem value="">Any zone</MenuItem>
                    {(map?.zones ?? []).map((z) => (
                      <MenuItem key={z.id} value={z.id}>
                        {z.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" fullWidth sx={{ mt: 1.5 }}>
                  <InputLabel id="seat-type-label">Seat type</InputLabel>
                  <Select labelId="seat-type-label" label="Seat type" value={seatType} onChange={(e) => setSeatType(e.target.value)}>
                    <MenuItem value="">Any type</MenuItem>
                    {SeatTypes.map((t) => (
                      <MenuItem key={t} value={t}>
                        {t.toLowerCase().replace('_', ' ')}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" fullWidth sx={{ mt: 1.5 }}>
                  <InputLabel id="amen-label">Amenities</InputLabel>
                  <Select labelId="amen-label" label="Amenities" multiple value={amenityIds} onChange={(e) => setAmenityIds(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)} renderValue={(sel) => sel.map((id) => seatAmenities.find((a) => a.id === id)?.name ?? id).join(', ')}>
                    {seatAmenities.map((a) => (
                      <MenuItem key={a.id} value={a.id}>
                        <Checkbox size="small" checked={amenityIds.includes(a.id)} />
                        {a.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                {(amenityIds.length || zoneId || seatType || nearTeam || Object.values(attrs).some(Boolean)) && (
                  <Button size="small" sx={{ mt: 1.5 }} onClick={() => { setAmenityIds([]); setZoneId(''); setSeatType(''); setNearTeam(false); setAttrs({}); }}>
                    Clear filters
                  </Button>
                )}
              </Collapse>
            </CardContent>
          </Card>
          {favSeats.length > 0 && (
            <Card sx={{ mt: 2 }}>
              <CardContent>
                <Typography variant="h4" component="h2" gutterBottom>
                  Favorites
                </Typography>
                <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
                  {favSeats.map((r) => (
                    <Chip key={r.id} label={r.code} clickable color={r.id === selectedId ? 'primary' : 'default'} onClick={() => pick(r)} />
                  ))}
                </Stack>
              </CardContent>
            </Card>
          )}
        </Grid>

        <Grid size={{ xs: 12, lg: 6 }}>
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="body2" color="text.secondary" aria-live="polite">
              {view === 'cards'
                ? data ? `${data.total} seat${data.total === 1 ? '' : 's'}${isFetching ? ' · updating…' : ''}` : ''
                : 'Tap a desk on the map to see details and book it. Desks that do not match your filters are faded.'}
            </Typography>
            {view === 'cards' && <AvailabilityLegend compact />}
          </Stack>
          {view !== 'cards' ? (
            <FloorMapPicker
              type="SEAT"
              mode={view === '3d' ? '3D' : '2D'}
              highlightIds={highlightIds}
              selectedResourceId={selectedId}
              onSelect={(r) => {
                setMapPicked(r);
                if (r) pick(r);
                else dispatch(selectResource(null));
              }}
              height={mobile ? 420 : 560}
            />
          ) : error ? (
            <ErrorState error={error} onRetry={refetch} title="Could not load seats" />
          ) : isLoading ? (
            <GridSkeleton count={6} height={170} />
          ) : items.length === 0 ? (
            <EmptyState title="No seats match" description="Try another floor, time or fewer filters. The map view shows every seat on the floor." actionLabel="Show the map" onAction={() => changeView('map')} />
          ) : (
            <Box data-testid="seat-results">
              <Grid container spacing={2}>
                {items.map((r) => (
                  <Grid key={r.id} size={{ xs: 12, sm: 6 }}>
                    <ResourceCard resource={r} selected={r.id === selectedId} onSelect={pick} onBook={setBookResource} showLocation={!ctx.floorId} />
                  </Grid>
                ))}
              </Grid>
              {data && data.totalPages > 1 && (
                <Stack sx={{ alignItems: 'center', mt: 2 }}>
                  <Pagination count={data.totalPages} page={page} onChange={(_e, p) => setPage(p)} color="primary" />
                </Stack>
              )}
            </Box>
          )}
        </Grid>

        {!mobile && (
          <Grid size={{ lg: 3 }}>
            <Card sx={{ position: 'sticky', top: 80 }}>{details}</Card>
          </Grid>
        )}
      </Grid>

      {mobile && (
        <Drawer anchor="bottom" open={detailsOpen && !!selected} onClose={() => setDetailsOpen(false)} slotProps={{ paper: { sx: { maxHeight: '85dvh', borderTopLeftRadius: 16, borderTopRightRadius: 16 } } }}>
          {details}
        </Drawer>
      )}
      <BookingDialog open={!!bookResource} resource={bookResource} startAt={ctx.startAt} endAt={ctx.endAt} onClose={() => setBookResource(null)} onSelectAlternative={(alt) => { setBookResource(alt.resource); }} />
    </PageTransition>
  );
}
