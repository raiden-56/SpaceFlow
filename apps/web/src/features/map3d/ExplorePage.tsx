// Explore Office: interactive 3D building explorer with 2D floor-plan and list fallbacks.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, Chip, Drawer, FormControl, FormControlLabel, IconButton, InputLabel, MenuItem, Paper, Select, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import ViewInArRoundedIcon from '@mui/icons-material/ViewInArRounded';
import MapRoundedIcon from '@mui/icons-material/MapRounded';
import ListRoundedIcon from '@mui/icons-material/ListRounded';
import FullscreenRoundedIcon from '@mui/icons-material/FullscreenRounded';
import FullscreenExitRoundedIcon from '@mui/icons-material/FullscreenExitRounded';
import CenterFocusStrongRoundedIcon from '@mui/icons-material/CenterFocusStrongRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded';
import LayersRoundedIcon from '@mui/icons-material/LayersRounded';
import { useAppDispatch } from '@/store';
import { clearFocus, selectResource, setBuilding, setDate, setExploded, setFloor, setTimeWindow, setViewMode, type ViewMode } from '@/store/bookingSlice';
import { useBookingWindow } from '@/hooks/useBookingWindow';
import { useFloorMapQuery } from '@/services/endpoints';
import { PageHeader } from '@/components/common/PageHeader';
import { PageTransition } from '@/components/common/Motion';
import { FloorSelector } from '@/components/common/FloorSelector';
import { AvailabilityLegend } from '@/components/common/AvailabilityLegend';
import { ResourceDetailsPanel } from '@/components/common/ResourceDetailsPanel';
import { ErrorState } from '@/components/common/Feedback';
import { useToast } from '@/components/common/ToastProvider';
import { dayjs, timeOptions } from '@/utils/time';
import { BuildingScene, type SceneHandle } from './BuildingScene';
import { FloorPlan2D } from './FloorPlan2D';
import { ResourceListView } from './ResourceListView';
import { hasWebGL, resourceState } from './geometry';

const TIMES = timeOptions('06:00', '22:00', 30);

export function ExplorePage() {
  const dispatch = useAppDispatch();
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('md'));
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const toast = useToast();
  const ctx = useBookingWindow();
  const { buildingId, floorId, building, buildings, floors, floor, date, startTime, endTime, allDay, viewMode, selectedResourceId, focusResourceId, explodedView, startAt, endAt, loading } = ctx;

  const [webgl] = useState(() => hasWebGL());
  const [availableOnly, setAvailableOnly] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'SEAT' | 'MEETING_ROOM'>('ALL');
  const [fullscreen, setFullscreen] = useState(false);
  const [focusNonce, setFocusNonce] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneHandle>(null);

  // WebGL unavailable -> fall back to 2D (once).
  useEffect(() => {
    if (!webgl && viewMode === '3D') {
      dispatch(setViewMode('2D'));
      toast.info('3D view is not supported on this device. Showing the 2D floor plan instead.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webgl]);

  const { data: map, isLoading: mapLoading, isFetching, error: mapError, refetch } = useFloorMapQuery({ floorId: floorId!, startAt, endAt }, { skip: !floorId });

  const resources = useMemo(() => {
    const list = map?.resources ?? [];
    return list.filter((r) => (typeFilter === 'ALL' || r.type === typeFilter)).filter((r) => !availableOnly || ['AVAILABLE', 'RESTRICTED'].includes(resourceState(r)));
  }, [map, typeFilter, availableOnly]);
  const selected = useMemo(() => (map?.resources ?? []).find((r) => r.id === selectedResourceId) ?? null, [map, selectedResourceId]);

  // "View on map": once the right floor map is loaded, focus the camera and clear the request.
  useEffect(() => {
    if (!focusResourceId || !map || map.floor.id !== floorId) return;
    if (map.resources.some((r) => r.id === focusResourceId)) {
      dispatch(selectResource(focusResourceId));
      setFocusNonce((n) => n + 1);
      if (mobile) setDetailsOpen(true);
    } else {
      toast.info('That resource is not on the current floor plan.');
    }
    dispatch(clearFocus());
  }, [focusResourceId, map, floorId, dispatch, mobile, toast]);

  // Fullscreen handling.
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await viewerRef.current?.requestFullscreen();
    } catch {
      toast.error('Fullscreen is not available in this browser.');
    }
  }, [toast]);

  const onSelectResource = useCallback(
    (id: string | null) => {
      dispatch(selectResource(id));
      if (id) {
        setFocusNonce((n) => n + 1);
        if (mobile) setDetailsOpen(true);
      }
    },
    [dispatch, mobile],
  );

  const changeView = (v: ViewMode | null) => {
    if (!v) return;
    if (v === '3D' && !webgl) return toast.info('3D is not supported on this device.');
    dispatch(setViewMode(v));
  };

  const counts = useMemo(() => {
    const all = map?.resources ?? [];
    const avail = all.filter((r) => ['AVAILABLE', 'RESTRICTED'].includes(resourceState(r)));
    return { seats: all.filter((r) => r.type === 'SEAT').length, rooms: all.filter((r) => r.type === 'MEETING_ROOM').length, availableSeats: avail.filter((r) => r.type === 'SEAT').length, availableRooms: avail.filter((r) => r.type === 'MEETING_ROOM').length };
  }, [map]);

  const viewerHeight = fullscreen ? '100vh' : mobile ? 'min(62vh, 520px)' : 'max(480px, calc(100vh - 300px))';

  const details = (
    <ResourceDetailsPanel
      resource={selected ? { ...selected } : null}
      date={date}
      startAt={startAt}
      endAt={endAt}
      compact
      onClose={mobile ? () => setDetailsOpen(false) : () => dispatch(selectResource(null))}
      onBooked={() => { refetch(); }}
      onSelectAlternative={(id) => {
        const alt = (map?.resources ?? []).find((r) => r.id === id);
        if (alt) onSelectResource(id);
        else toast.info('The suggested alternative is on another floor. Switch floors to see it.');
      }}
    />
  );

  return (
    <PageTransition>
      <PageHeader
        title="Explore Office"
        subtitle={building ? `${building.name}${building.city ? ` · ${building.city}` : ''} · ${building.floorCount} floors · ${building.seatCount} desks · ${building.roomCount} rooms` : 'Pick a building to start exploring'}
        dense
        actions={
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <ToggleButtonGroup exclusive size="small" value={viewMode} onChange={(_e, v) => changeView(v)} aria-label="View mode">
              <ToggleButton value="3D" aria-label="3D view" data-testid="explore-view-3d" disabled={!webgl}><ViewInArRoundedIcon fontSize="small" sx={{ mr: 0.5 }} />3D</ToggleButton>
              <ToggleButton value="2D" aria-label="2D floor plan" data-testid="explore-view-2d"><MapRoundedIcon fontSize="small" sx={{ mr: 0.5 }} />2D</ToggleButton>
              <ToggleButton value="LIST" aria-label="List view" data-testid="explore-view-list"><ListRoundedIcon fontSize="small" sx={{ mr: 0.5 }} />List</ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        }
      />

      {/* Criteria toolbar */}
      <Paper variant="outlined" sx={{ p: 1.5, mb: 2, borderRadius: 3 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' }, flexWrap: 'wrap' }} useFlexGap>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel id="building-label">Building</InputLabel>
            <Select labelId="building-label" label="Building" value={buildingId ?? ''} onChange={(e) => dispatch(setBuilding(e.target.value as string))} data-testid="explore-building">
              {buildings.map((b) => (
                <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <DatePicker label="Date" value={dayjs(date, 'YYYY-MM-DD')} minDate={dayjs()} onChange={(v) => v?.isValid() && dispatch(setDate(v.format('YYYY-MM-DD')))} slotProps={{ textField: { size: 'small', sx: { width: 170 } } }} />
          <FormControlLabel control={<Checkbox checked={allDay} onChange={(e) => dispatch(setTimeWindow({ allDay: e.target.checked }))} />} label="Full day" sx={{ whiteSpace: 'nowrap', mr: 0 }} />
          {!allDay && (
            <>
              <FormControl size="small" sx={{ minWidth: 110 }}>
                <InputLabel id="start-label">From</InputLabel>
                <Select labelId="start-label" label="From" value={startTime} onChange={(e) => dispatch(setTimeWindow({ startTime: e.target.value as string }))}>
                  {TIMES.slice(0, -1).map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 110 }}>
                <InputLabel id="end-label">To</InputLabel>
                <Select labelId="end-label" label="To" value={endTime} onChange={(e) => dispatch(setTimeWindow({ endTime: e.target.value as string }))}>
                  {TIMES.slice(1).map((t) => <MenuItem key={t} value={t} disabled={t <= startTime}>{t}</MenuItem>)}
                </Select>
              </FormControl>
            </>
          )}
          <Box sx={{ flex: 1 }} />
          <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }} role="group" aria-label="Quick filters">
            <Chip label="Available only" color={availableOnly ? 'primary' : 'default'} variant={availableOnly ? 'filled' : 'outlined'} onClick={() => setAvailableOnly((v) => !v)} aria-pressed={availableOnly} />
            <Chip label="Desks" color={typeFilter === 'SEAT' ? 'primary' : 'default'} variant={typeFilter === 'SEAT' ? 'filled' : 'outlined'} onClick={() => setTypeFilter((t) => (t === 'SEAT' ? 'ALL' : 'SEAT'))} aria-pressed={typeFilter === 'SEAT'} />
            <Chip label="Rooms" color={typeFilter === 'MEETING_ROOM' ? 'primary' : 'default'} variant={typeFilter === 'MEETING_ROOM' ? 'filled' : 'outlined'} onClick={() => setTypeFilter((t) => (t === 'MEETING_ROOM' ? 'ALL' : 'MEETING_ROOM'))} aria-pressed={typeFilter === 'MEETING_ROOM'} />
          </Stack>
        </Stack>
      </Paper>

      {mapError && <ErrorState error={mapError} onRetry={() => refetch()} title="Could not load the floor map" />}

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 320px' }, alignItems: 'start' }}>
        {/* Viewer */}
        <Box>
          <Box ref={viewerRef} sx={{ position: 'relative', height: viewerHeight, borderRadius: fullscreen ? 0 : 3, overflow: 'hidden', border: '1px solid', borderColor: 'divider', bgcolor: '#F5F7FB' }} aria-busy={mapLoading}>
            {viewMode === '3D' && webgl && (
              <BuildingScene
                ref={sceneRef}
                floors={floors}
                selectedFloorId={floorId}
                map={map && map.floor.id === floorId ? map : undefined}
                resources={resources}
                selectedResourceId={selectedResourceId}
                onSelectResource={onSelectResource}
                onSelectFloor={(id) => dispatch(setFloor(id))}
                exploded={explodedView}
                reducedMotion={reducedMotion}
                focusNonce={focusNonce}
                buildingModelUrl={building?.modelUrl}
                floorModelUrl={map?.plan?.modelUrl}
                onModelFallback={(which) => toast.info(`The ${which} 3D model could not be loaded. Showing the generated layout.`)}
              />
            )}
            {viewMode === '2D' && <FloorPlan2D map={map && map.floor.id === floorId ? map : undefined} resources={resources} selectedResourceId={selectedResourceId} onSelectResource={onSelectResource} focusNonce={focusNonce} reducedMotion={reducedMotion} />}
            {viewMode === 'LIST' && <ResourceListView resources={resources} selectedResourceId={selectedResourceId} onSelectResource={(id) => onSelectResource(id)} floorName={floor?.name} />}
            {viewMode !== '3D' && !floorId && floors.length > 0 && (
              <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', zIndex: 1, p: 2 }}>
                <Stack spacing={1.5} sx={{ alignItems: 'center', textAlign: 'center', maxWidth: 360 }} role="status">
                  <Typography variant="h5">Choose a floor</Typography>
                  <Typography variant="body2" color="text.secondary">
                    The {viewMode === '2D' ? 'floor plan' : 'list'} shows one floor at a time. Pick a floor to see its desks and rooms.
                  </Typography>
                  <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', justifyContent: 'center' }}>
                    {[...floors].sort((a, b) => a.sortOrder - b.sortOrder).map((f) => (
                      <Button key={f.id} size="small" variant="outlined" onClick={() => dispatch(setFloor(f.id))}>
                        {f.name}
                      </Button>
                    ))}
                  </Stack>
                </Stack>
              </Box>
            )}

            {/* Overlay controls */}
            <Stack direction="row" spacing={0.5} sx={{ position: 'absolute', left: 12, top: 12, bgcolor: 'rgba(255,255,255,0.95)', p: 0.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', zIndex: 2 }}>
              {viewMode === '3D' && (
                <>
                  <Tooltip title="Zoom in"><IconButton size="small" aria-label="Zoom in" onClick={() => sceneRef.current?.zoom(6)}><AddRoundedIcon fontSize="small" /></IconButton></Tooltip>
                  <Tooltip title="Zoom out"><IconButton size="small" aria-label="Zoom out" onClick={() => sceneRef.current?.zoom(-6)}><RemoveRoundedIcon fontSize="small" /></IconButton></Tooltip>
                  <Tooltip title="Reset view"><IconButton size="small" aria-label="Reset camera" data-testid="explore-reset" onClick={() => sceneRef.current?.reset()}><CenterFocusStrongRoundedIcon fontSize="small" /></IconButton></Tooltip>
                  <Tooltip title={explodedView ? 'Stack floors' : 'Exploded floor view'}><IconButton size="small" aria-label="Toggle exploded floor view" aria-pressed={explodedView} color={explodedView ? 'primary' : 'default'} onClick={() => dispatch(setExploded(!explodedView))}><LayersRoundedIcon fontSize="small" /></IconButton></Tooltip>
                </>
              )}
              <Tooltip title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}><IconButton size="small" aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} data-testid="explore-fullscreen" onClick={toggleFullscreen}>{fullscreen ? <FullscreenExitRoundedIcon fontSize="small" /> : <FullscreenRoundedIcon fontSize="small" />}</IconButton></Tooltip>
            </Stack>

            {viewMode === '3D' && floorId && (
              <Button size="small" variant="contained" color="inherit" sx={{ position: 'absolute', right: 12, top: 12, zIndex: 2, bgcolor: 'rgba(255,255,255,0.95)' }} onClick={() => dispatch(setFloor(null))}>
                Whole building
              </Button>
            )}
            {(mapLoading || isFetching) && (
              <Typography variant="caption" role="status" sx={{ position: 'absolute', right: 12, bottom: 12, zIndex: 2, bgcolor: 'rgba(255,255,255,0.9)', px: 1, py: 0.25, borderRadius: 1 }}>
                {mapLoading ? 'Loading floor…' : 'Updating availability…'}
              </Typography>
            )}
            {viewMode === '3D' && !floorId && floors.length > 0 && !loading && (
              <Typography variant="body2" role="status" sx={{ position: 'absolute', left: '50%', bottom: 14, transform: 'translateX(-50%)', zIndex: 2, bgcolor: 'rgba(23,32,51,0.85)', color: '#fff', px: 1.5, py: 0.5, borderRadius: 2, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
                Click a floor or use the floor selector to see desks and rooms
              </Typography>
            )}
            {!loading && floors.length === 0 && (
              <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', zIndex: 2 }}>
                <Alert severity="info">This building has no published floors yet.</Alert>
              </Box>
            )}
            {fullscreen && (
              <Box sx={{ position: 'absolute', right: 12, top: 60, zIndex: 3, width: 280, maxHeight: 'calc(100vh - 80px)', overflow: 'auto', bgcolor: 'rgba(255,255,255,0.97)', borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                <Box sx={{ p: 1.5 }}>
                  <FloorSelector floors={floors} value={floorId} onChange={(id) => dispatch(setFloor(id))} showAll dense />
                </Box>
                {details}
              </Box>
            )}
          </Box>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 1.5, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
            <AvailabilityLegend compact />
            {map && (
              <Typography variant="caption" color="text.secondary" role="status" aria-live="polite">
                {floor?.name}: {counts.availableSeats}/{counts.seats} desks and {counts.availableRooms}/{counts.rooms} rooms available for the selected time
              </Typography>
            )}
          </Stack>
          {viewMode === '3D' && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              Drag to orbit · scroll or pinch to zoom · right-drag or two-finger drag to pan · hover a desk for details · the List view offers a keyboard-accessible alternative.
            </Typography>
          )}
        </Box>

        {/* Side column */}
        {!mobile && (
          <Stack spacing={2}>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Floors</Typography>
              <FloorSelector floors={floors} value={floorId} onChange={(id) => dispatch(setFloor(id))} showAll dense />
            </Paper>
            <Paper variant="outlined" sx={{ borderRadius: 3 }}>{details}</Paper>
          </Stack>
        )}
        {mobile && (
          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 3 }}>
            <FloorSelector floors={floors} value={floorId} onChange={(id) => dispatch(setFloor(id))} showAll />
            {selected && (
              <Button fullWidth variant="outlined" sx={{ mt: 1.5 }} onClick={() => setDetailsOpen(true)}>
                {selected.name} · details & booking
              </Button>
            )}
          </Paper>
        )}
      </Box>

      {mobile && (
        <Drawer anchor="bottom" open={detailsOpen && !!selected} onClose={() => setDetailsOpen(false)} slotProps={{ paper: { sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '85vh', overflow: 'auto' } } }}>
          {details}
        </Drawer>
      )}
    </PageTransition>
  );
}
