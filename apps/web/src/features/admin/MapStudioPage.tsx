// 3D Map Studio: the floor-plan editor. Admins draw the floor (or trace an uploaded plan image),
// place facilities, link desk/room objects to real resources, preview availability, then save a
// validated draft and publish it. Replacing a plan never deletes resources or booking history:
// objects reference resources by id.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert, AlertTitle, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, FormControlLabel, Grid, IconButton,
  InputLabel, LinearProgress, List, ListItem, ListItemText, MenuItem, Select, Stack, Switch, Tab, Tabs, TextField, Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import SaveRoundedIcon from '@mui/icons-material/SaveRounded';
import PublishRoundedIcon from '@mui/icons-material/PublishRounded';
import UnpublishedRoundedIcon from '@mui/icons-material/UnpublishedRounded';
import UndoRoundedIcon from '@mui/icons-material/UndoRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import RotateRightRoundedIcon from '@mui/icons-material/RotateRightRounded';
import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ViewInArRoundedIcon from '@mui/icons-material/ViewInArRounded';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { MapObjectKinds, ZoneKinds, type AvailabilityState, type MapObjectDto, type MapObjectKind, type ResourceDto, type ZoneDto } from '@spaceflow/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { PageTransition } from '@/components/common/Motion';
import { ErrorState } from '@/components/common/Feedback';
import { EmptyState } from '@/components/common/EmptyState';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useToast } from '@/components/common/ToastProvider';
import { useLeaveGuard } from '@/hooks/useLeaveGuard';
import {
  useBuildingsQuery,
  useCreateZoneMutation,
  useDeleteZoneMutation,
  useFloorMapQuery,
  useFloorPlanDraftQuery,
  useFloorsQuery,
  usePublishFloorPlanMutation,
  useSaveFloorPlanMutation,
  useUnpublishFloorPlanMutation,
  useUpdateZoneMutation,
} from '@/services/endpoints';
import { errorDetails, errorMessage } from '@/services/api';
import { dayjs, toIso } from '@/utils/time';
import { AssetPicker } from './components/AssetPicker';
import { ResourceFormDialog } from './components/ResourceFormDialog';
import { authFetch } from './components/authFetch';
import { StudioCanvas } from './mapStudio/StudioCanvas';
import { DEFAULT_SIZES, KIND_FILL, KIND_LABELS, autoPlace, clampToFloor, linkableType, validateDraft, type StudioObject, type StudioResource } from './mapStudio/studioUtils';

let keySeq = 0;
const newKey = () => `n${Date.now().toString(36)}${(keySeq++).toString(36)}`;

function fromDto(o: MapObjectDto): StudioObject {
  return { key: o.id, kind: o.kind, label: o.label, x: o.x, y: o.y, width: o.width, depth: o.depth, rotation: o.rotation, height: o.height, resourceId: o.resourceId, meta: o.meta };
}

/** Fetches an authenticated asset into a blob URL so it can be used as an <image href>. */
function useAssetBlobUrl(assetId: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!assetId) {
      setUrl(null);
      return;
    }
    let revoked = false;
    let objectUrl: string | null = null;
    authFetch(`/assets/${assetId}/file`)
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (b && !revoked) {
          objectUrl = URL.createObjectURL(b);
          setUrl(objectUrl);
        }
      })
      .catch(() => setUrl(null));
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId]);
  return url;
}

export function MapStudioPage() {
  const { floorId } = useParams();
  const navigate = useNavigate();
  const { data: buildings } = useBuildingsQuery();
  const [buildingId, setBuildingId] = useState<string>('');
  const { data: floors } = useFloorsQuery({ buildingId }, { skip: !buildingId });
  const [dirty, setDirty] = useState(false);
  const [pendingNav, setPendingNav] = useState<string | null>(null);

  // Resolve the building of the floor in the URL (floors are fetched per building).
  const { data: draftForBuilding } = useFloorMapQuery({ floorId: floorId ?? '' }, { skip: !floorId || !!buildingId });
  useEffect(() => {
    if (draftForBuilding && !buildingId) setBuildingId(draftForBuilding.building.id);
  }, [draftForBuilding, buildingId]);
  useEffect(() => {
    if (!floorId && !buildingId && buildings?.length) setBuildingId(buildings[0].id);
  }, [floorId, buildingId, buildings]);
  useEffect(() => {
    if (!floorId && floors?.length) navigate(`/admin/map-studio/${[...floors].sort((a, b) => a.sortOrder - b.sortOrder)[0].id}`, { replace: true });
  }, [floorId, floors, navigate]);

  const go = (path: string) => {
    if (dirty) setPendingNav(path);
    else navigate(path);
  };

  return (
    <PageTransition>
      <PageHeader title="3D Map Studio" subtitle="Design floor layouts, link desks and rooms to real resources, then publish them to the 3D, 2D and list views." crumbs={[{ label: 'Admin', to: '/admin' }, { label: '3D Map Studio' }]} dense />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel id="ms-b">Building</InputLabel>
          <Select labelId="ms-b" label="Building" value={buildingId} onChange={(e) => { if (dirty) { setPendingNav(`__building:${e.target.value}`); return; } setBuildingId(e.target.value); navigate('/admin/map-studio'); }}>
            {(buildings ?? []).map((b) => <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 220 }} disabled={!floors?.length}>
          <InputLabel id="ms-f">Floor</InputLabel>
          <Select labelId="ms-f" label="Floor" value={floors?.some((f) => f.id === floorId) ? floorId : ''} onChange={(e) => go(`/admin/map-studio/${e.target.value}`)}>
            {[...(floors ?? [])].sort((a, b) => a.sortOrder - b.sortOrder).map((f) => (
              <MenuItem key={f.id} value={f.id}>{f.name} · {f.floorPlanStatus.toLowerCase()}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button variant="text" onClick={() => go(`/admin/buildings/${buildingId}`)} disabled={!buildingId}>Manage floors</Button>
      </Stack>
      {floors && floors.length === 0 ? (
        <EmptyState title="This building has no floors" description="Add a floor under Buildings & floors, then come back to design its layout." actionLabel="Buildings & floors" onAction={() => navigate(`/admin/buildings/${buildingId}`)} />
      ) : floorId ? (
        <Editor key={floorId} floorId={floorId} buildingId={buildingId} tz={buildings?.find((b) => b.id === buildingId)?.timezone ?? dayjs.tz.guess()} onDirtyChange={setDirty} />
      ) : (
        <LinearProgress />
      )}
      <ConfirmDialog
        open={!!pendingNav}
        title="Discard unsaved changes?"
        description="You have edits to this floor plan that are not saved. Leaving now discards them."
        confirmLabel="Discard and leave"
        destructive
        onClose={() => setPendingNav(null)}
        onConfirm={() => {
          const target = pendingNav!;
          setPendingNav(null);
          setDirty(false);
          if (target.startsWith('__building:')) {
            setBuildingId(target.slice('__building:'.length));
            navigate('/admin/map-studio');
          } else navigate(target);
        }}
      />
    </PageTransition>
  );
}

function Editor({ floorId, buildingId, tz, onDirtyChange }: { floorId: string; buildingId: string; tz: string; onDirtyChange: (d: boolean) => void }) {
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down('lg'));
  const toast = useToast();
  const navigate = useNavigate();
  const { data: draft, isLoading, error, refetch } = useFloorPlanDraftQuery({ floorId });
  const [save, saveState] = useSaveFloorPlanMutation();
  const [publish, publishState] = usePublishFloorPlanMutation();
  const [unpublish, unpublishState] = useUnpublishFloorPlanMutation();

  const [widthM, setWidthM] = useState(40);
  const [depthM, setDepthM] = useState(24);
  const [imageAssetId, setImageAssetId] = useState<string | null>(null);
  const [modelAssetId, setModelAssetId] = useState<string | null>(null);
  const [objects, setObjectsState] = useState<StudioObject[]>([]);
  // Ref mirror so rapid pointer events always build on the latest objects (no stale closures).
  const objectsRef = useRef<StudioObject[]>([]);
  const setObjects = useCallback((next: StudioObject[]) => {
    objectsRef.current = next;
    setObjectsState(next);
  }, []);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [dirty, setDirtyState] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [undo, setUndo] = useState<StudioObject[][]>([]);
  const inGesture = useRef(false);
  const [snapStep, setSnapStep] = useState(0.1);
  const [tab, setTab] = useState(0);
  const [serverIssues, setServerIssues] = useState<string[]>([]);
  const [result, setResult] = useState<{ kind: 'save' | 'publish'; text: string; list?: string[] } | null>(null);
  const [overlay, setOverlay] = useState(false);
  const [overlayDate, setOverlayDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [createFor, setCreateFor] = useState<{ key: string; type: 'SEAT' | 'MEETING_ROOM'; code: string } | null>(null);

  const setDirty = useCallback((d: boolean) => {
    setDirtyState(d);
    onDirtyChange(d);
  }, [onDirtyChange]);

  // Initialise local state from the server draft, and re-sync whenever a NEW draft response arrives
  // while there are no local edits. Tracking the response identity (not `dirty`) avoids clobbering
  // a just-saved layout with the stale cached draft before the refetch lands.
  const lastDraft = useRef<typeof draft>(undefined);
  useEffect(() => {
    if (!draft || draft === lastDraft.current) return;
    lastDraft.current = draft;
    if (initialized && dirty) return;
    if (draft.plan) {
      setWidthM(draft.plan.widthM);
      setDepthM(draft.plan.depthM);
      setImageAssetId(draft.plan.imageAssetId);
      setModelAssetId(draft.plan.modelAssetId);
    }
    setObjects(draft.objects.map(fromDto));
    setInitialized(true);
  }, [draft, initialized, dirty, setObjects]);

  // Browser-level guard for reload / tab close.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
  // In-app guard: sidebar / menu navigation asks before discarding unsaved floor-plan edits.
  useLeaveGuard(dirty, 'You have unsaved floor-plan changes. Leave Map Studio and discard them?');

  const resources: StudioResource[] = useMemo(() => draft?.resources.map((r) => ({ id: r.id, code: r.code, name: r.name, type: r.type })) ?? [], [draft]);
  const resourceCodes = useMemo(() => new Map(resources.map((r) => [r.id, r.code])), [resources]);
  const linkedIds = useMemo(() => new Set(objects.map((o) => o.resourceId).filter((x): x is string => !!x)), [objects]);
  const unlinked = resources.filter((r) => !linkedIds.has(r.id));
  const issues = useMemo(() => validateDraft(objects, widthM, depthM, resources), [objects, widthM, depthM, resources]);
  const selected = objects.find((o) => o.key === selectedKey) ?? null;
  const backgroundUrl = useAssetBlobUrl(imageAssetId);

  const overlayWindow = useMemo(() => ({ startAt: toIso(overlayDate, '08:00', tz), endAt: toIso(overlayDate, '18:00', tz) }), [overlayDate, tz]);
  const { data: liveMap } = useFloorMapQuery({ floorId, ...overlayWindow }, { skip: !overlay });
  const availability = useMemo(() => {
    if (!overlay || !liveMap) return null;
    return new Map<string, AvailabilityState>(liveMap.resources.filter((r: ResourceDto) => r.availability).map((r: ResourceDto) => [r.id, r.availability!.state]));
  }, [overlay, liveMap]);

  const mutate = (fn: (prev: StudioObject[]) => StudioObject[], opts: { commit?: boolean } = { commit: true }) => {
    const prev = objectsRef.current;
    // One undo entry per gesture: snapshot before the first change of a drag, or before a one-off edit.
    if (!inGesture.current) setUndo((u) => [...u.slice(-49), prev]);
    inGesture.current = !opts.commit;
    setObjects(fn(prev));
    setDirty(true);
  };

  const onCanvasChange = (key: string, patch: Partial<StudioObject>, opts?: { commit?: boolean }) => {
    if (!Object.keys(patch).length) {
      inGesture.current = false;
      return;
    }
    mutate((prev) => prev.map((o) => (o.key === key ? { ...o, ...patch } : o)), { commit: opts?.commit ?? false });
  };

  const updateSelected = (patch: Partial<StudioObject>) => {
    if (!selected) return;
    mutate((prev) => prev.map((o) => (o.key === selected.key ? clampToFloor({ ...o, ...patch }, widthM, depthM) : o)));
  };

  const addObject = (kind: MapObjectKind) => {
    const size = DEFAULT_SIZES[kind];
    const obj = clampToFloor<StudioObject>({ key: newKey(), kind, label: kind === 'DESK' || kind === 'MEETING_ROOM' ? null : KIND_LABELS[kind], x: widthM / 2 - size.width / 2, y: depthM / 2 - size.depth / 2, width: size.width, depth: size.depth, rotation: 0, height: size.height ?? null, resourceId: null, meta: kind === 'ZONE' ? { color: '#E0E7FF' } : null }, widthM, depthM);
    mutate((prev) => [...prev, obj]);
    setSelectedKey(obj.key);
    setTab(1);
  };

  const removeObject = (key: string) => {
    mutate((prev) => prev.filter((o) => o.key !== key));
    if (selectedKey === key) setSelectedKey(null);
  };

  const duplicate = () => {
    if (!selected) return;
    const copy = clampToFloor<StudioObject>({ ...selected, key: newKey(), x: selected.x + 0.5, y: selected.y + 0.5, resourceId: null, label: selected.resourceId ? null : selected.label }, widthM, depthM);
    mutate((prev) => [...prev, copy]);
    setSelectedKey(copy.key);
  };

  const runAutoPlace = () => {
    const { placed, unplaced } = autoPlace(unlinked, objects, widthM, depthM, newKey);
    if (placed.length) mutate((prev) => [...prev, ...placed]);
    toast.info(`Placed ${placed.length} resource(s)${unplaced.length ? `; ${unplaced.length} did not fit (${unplaced.slice(0, 5).map((r) => r.code).join(', ')})` : ''}. Review positions, then save.`);
  };

  const doUndo = () => {
    if (!undo.length) return;
    setObjects(undo[undo.length - 1]);
    setUndo(undo.slice(0, -1));
    setDirty(true);
  };

  const doSave = async (): Promise<boolean> => {
    setServerIssues([]);
    setResult(null);
    try {
      const res = await save({
        floorId,
        widthM,
        depthM,
        imageAssetId,
        modelAssetId,
        objects: objects.map((o) => ({ kind: o.kind, label: o.label, x: o.x, y: o.y, width: o.width, depth: o.depth, rotation: o.rotation, height: o.height, resourceId: o.resourceId, meta: o.meta })),
      }).unwrap();
      setDirty(false);
      setObjects(res.objects.map(fromDto));
      setUndo([]);
      setSelectedKey(null);
      setResult({ kind: 'save', text: `Draft v${res.plan?.version ?? ''} saved: ${res.linked} resource(s) linked.${res.unlinkedResources.length ? ' Some resources have no map position yet.' : ''}`, list: res.unlinkedResources });
      toast.success('Floor plan draft saved');
      return true;
    } catch (err) {
      const details = errorDetails<{ issues?: string[] }>(err);
      if (details?.issues?.length) setServerIssues(details.issues);
      else toast.error(errorMessage(err));
      return false;
    }
  };

  const doPublish = async () => {
    if (dirty && !(await doSave())) return;
    try {
      const res = await publish({ floorId }).unwrap();
      setResult({ kind: 'publish', text: `Published version ${res.version}. Employees now see this layout in the 3D, 2D and list views.`, list: res.warnings });
      toast.success('Floor plan published');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const doUnpublish = async () => {
    try {
      await unpublish({ floorId }).unwrap();
      toast.success('Floor hidden from employees');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  if (isLoading || !initialized) return <LinearProgress aria-label="Loading floor plan" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!draft) return null;

  const published = draft.plan?.status === 'PUBLISHED' && !dirty;
  const linkType = selected ? linkableType(selected.kind) : null;
  const linkOptions = linkType ? resources.filter((r) => r.type === linkType && (!linkedIds.has(r.id) || r.id === selected?.resourceId)) : [];

  return (
    <Stack spacing={2}>
      <Card>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <Chip size="small" color={published ? 'success' : 'default'} label={draft.plan ? `${draft.plan.status === 'PUBLISHED' ? 'Published' : 'Draft'} v${draft.plan.version}${dirty ? ' · unsaved changes' : ''}` : 'No plan yet'} />
              <TextField label="Width (m)" type="number" value={widthM} onChange={(e) => { setWidthM(Math.max(1, Number(e.target.value) || 1)); setDirty(true); }} sx={{ width: 110 }} slotProps={{ htmlInput: { min: 1, max: 1000, step: 0.5 } }} />
              <TextField label="Depth (m)" type="number" value={depthM} onChange={(e) => { setDepthM(Math.max(1, Number(e.target.value) || 1)); setDirty(true); }} sx={{ width: 110 }} slotProps={{ htmlInput: { min: 1, max: 1000, step: 0.5 } }} />
              <FormControl size="small" sx={{ width: 120 }}>
                <InputLabel id="ms-snap">Snap</InputLabel>
                <Select labelId="ms-snap" label="Snap" value={snapStep} onChange={(e) => setSnapStep(Number(e.target.value))}>
                  <MenuItem value={0}>Off</MenuItem>
                  <MenuItem value={0.1}>10 cm</MenuItem>
                  <MenuItem value={0.5}>50 cm</MenuItem>
                  <MenuItem value={1}>1 m</MenuItem>
                </Select>
              </FormControl>
              <Tooltip title="Undo (last 50 edits)"><span><IconButton aria-label="Undo" onClick={doUndo} disabled={!undo.length}><UndoRoundedIcon /></IconButton></span></Tooltip>
            </Stack>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <Button variant="outlined" startIcon={<ViewInArRoundedIcon />} onClick={() => navigate('/explore')}>Open explorer</Button>
              {draft.plan?.status === 'PUBLISHED' && (
                <Button variant="outlined" color="warning" startIcon={<UnpublishedRoundedIcon />} onClick={doUnpublish} disabled={unpublishState.isLoading}>Unpublish</Button>
              )}
              <Button variant="outlined" startIcon={<SaveRoundedIcon />} onClick={() => void doSave()} disabled={saveState.isLoading || !dirty} data-testid="admin-save-plan">
                {saveState.isLoading ? 'Saving…' : 'Save draft'}
              </Button>
              <Button variant="contained" startIcon={<PublishRoundedIcon />} onClick={doPublish} disabled={publishState.isLoading || saveState.isLoading || (!draft.plan && !dirty) || issues.length > 0} data-testid="admin-publish-plan">
                {dirty ? 'Save & publish' : 'Publish'}
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Box aria-live="polite">
        {serverIssues.length > 0 && (
          <Alert severity="error" onClose={() => setServerIssues([])}>
            <AlertTitle>The server rejected the floor plan</AlertTitle>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>{serverIssues.map((i) => <li key={i}>{i}</li>)}</Box>
          </Alert>
        )}
        {result && (
          <Alert severity={result.list?.length ? 'warning' : 'success'} onClose={() => setResult(null)}>
            {result.text}
            {result.list && result.list.length > 0 && <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>{result.list.slice(0, 12).map((w) => <li key={w}>{w}</li>)}{result.list.length > 12 && <li>…and {result.list.length - 12} more</li>}</Box>}
          </Alert>
        )}
        {issues.length > 0 && (
          <Alert severity="warning" sx={{ mt: serverIssues.length || result ? 1 : 0 }}>
            <AlertTitle>{issues.length} problem(s) to fix before publishing</AlertTitle>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>{issues.slice(0, 8).map((i) => <li key={i}>{i}</li>)}{issues.length > 8 && <li>…and {issues.length - 8} more</li>}</Box>
          </Alert>
        )}
      </Box>

      {narrow && <Alert severity="info">The Map Studio works best on a large screen. All edits are also possible with the property panel below the canvas.</Alert>}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 8.5 }}>
          <Box sx={{ height: { xs: 420, md: 600 } }}>
            <StudioCanvas
              widthM={widthM}
              depthM={depthM}
              objects={objects}
              selectedKey={selectedKey}
              onSelect={(k) => { setSelectedKey(k); if (k) setTab(1); }}
              onChange={onCanvasChange}
              onDelete={removeObject}
              snapStep={snapStep}
              backgroundUrl={backgroundUrl}
              availability={availability}
              resourceCodes={resourceCodes}
            />
          </Box>
          <Stack direction="row" spacing={2} useFlexGap sx={{ mt: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <FormControlLabel control={<Switch checked={overlay} onChange={(e) => setOverlay(e.target.checked)} />} label="Availability overlay" />
            {overlay && <DatePicker label="Overlay date" value={dayjs(overlayDate)} onChange={(v) => v?.isValid() && setOverlayDate(v.format('YYYY-MM-DD'))} slotProps={{ textField: { size: 'small', sx: { width: 170 } } }} />}
            {overlay && <Typography variant="caption" color="text.secondary">08:00–18:00 building time · green available, amber reserved, red in use, grey not bookable. Reflects the saved plan's resources.</Typography>}
            {!overlay && <Typography variant="caption" color="text.secondary">Dashed red outline = desk/room not linked to a resource. Drag to move, corner handle to resize, wheel to zoom, drag the background to pan.</Typography>}
          </Stack>
        </Grid>
        <Grid size={{ xs: 12, lg: 3.5 }}>
          <Card sx={{ height: '100%' }}>
            <Tabs value={tab} onChange={(_e, v) => setTab(v)} variant="fullWidth" aria-label="Map Studio panels">
              <Tab label="Add" />
              <Tab label="Properties" />
              <Tab label="Floor" />
              <Tab label="Zones" />
            </Tabs>
            <Divider />
            <CardContent>
              {tab === 0 && (
                <Stack spacing={2}>
                  <Typography variant="subtitle2">Place objects</Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 0.75 }}>
                    {MapObjectKinds.map((k) => (
                      <Button key={k} size="small" variant="outlined" onClick={() => addObject(k)} sx={{ justifyContent: 'flex-start', gap: 1 }} data-testid={`palette-${k}`}>
                        <Box aria-hidden sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: KIND_FILL[k], border: '1px solid #64748B', flexShrink: 0 }} />
                        <Typography variant="caption" noWrap>{KIND_LABELS[k]}</Typography>
                      </Button>
                    ))}
                  </Box>
                  <Divider />
                  <Typography variant="subtitle2">Resources on this floor</Typography>
                  <Typography variant="body2">{resources.length - unlinked.length} of {resources.length} placed on the map.</Typography>
                  {unlinked.length > 0 && (
                    <>
                      <Button variant="contained" startIcon={<AutoFixHighRoundedIcon />} onClick={runAutoPlace}>Auto-place {unlinked.length} unplaced</Button>
                      <List dense sx={{ maxHeight: 200, overflow: 'auto' }}>
                        {unlinked.map((r) => <ListItem key={r.id} disableGutters><ListItemText primary={r.code} secondary={r.type === 'SEAT' ? 'Seat' : 'Meeting room'} /></ListItem>)}
                      </List>
                    </>
                  )}
                  <Button variant="outlined" startIcon={<AddRoundedIcon />} onClick={() => setCreateFor({ key: '', type: 'SEAT', code: '' })}>New seat on this floor</Button>
                </Stack>
              )}
              {tab === 1 && (
                selected ? (
                  <Stack spacing={1.5}>
                    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="subtitle2">{KIND_LABELS[selected.kind]}</Typography>
                      <Stack direction="row">
                        <Tooltip title="Rotate 90°"><IconButton size="small" aria-label="Rotate 90 degrees" onClick={() => updateSelected({ rotation: (selected.rotation + 90) % 360 })}><RotateRightRoundedIcon fontSize="small" /></IconButton></Tooltip>
                        <Tooltip title="Duplicate"><IconButton size="small" aria-label="Duplicate" onClick={duplicate}><ContentCopyRoundedIcon fontSize="small" /></IconButton></Tooltip>
                        <Tooltip title="Delete"><IconButton size="small" aria-label="Delete object" onClick={() => removeObject(selected.key)}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton></Tooltip>
                      </Stack>
                    </Stack>
                    <FormControl size="small" fullWidth>
                      <InputLabel id="ms-kind">Kind</InputLabel>
                      <Select labelId="ms-kind" label="Kind" value={selected.kind} onChange={(e) => updateSelected({ kind: e.target.value as MapObjectKind, resourceId: linkableType(e.target.value as MapObjectKind) === linkType ? selected.resourceId : null })}>
                        {MapObjectKinds.map((k) => <MenuItem key={k} value={k}>{KIND_LABELS[k]}</MenuItem>)}
                      </Select>
                    </FormControl>
                    <TextField label="Label" value={selected.label ?? ''} onChange={(e) => updateSelected({ label: e.target.value || null })} slotProps={{ htmlInput: { maxLength: 60 } }} />
                    <Grid container spacing={1}>
                      {(['x', 'y', 'width', 'depth'] as const).map((f) => (
                        <Grid key={f} size={{ xs: 6 }}>
                          <TextField label={`${f === 'x' ? 'X' : f === 'y' ? 'Y' : f[0].toUpperCase() + f.slice(1)} (m)`} type="number" value={selected[f]} onChange={(e) => updateSelected({ [f]: Number(e.target.value) || 0 })} slotProps={{ htmlInput: { step: 0.1, min: 0 } }} />
                        </Grid>
                      ))}
                      <Grid size={{ xs: 6 }}>
                        <TextField label="Rotation (°)" type="number" value={selected.rotation} onChange={(e) => updateSelected({ rotation: ((Number(e.target.value) || 0) % 360 + 360) % 360 })} slotProps={{ htmlInput: { step: 15 } }} />
                      </Grid>
                      <Grid size={{ xs: 6 }}>
                        <TextField label="Height (m)" type="number" value={selected.height ?? ''} onChange={(e) => updateSelected({ height: e.target.value ? Number(e.target.value) : null })} slotProps={{ htmlInput: { step: 0.1, min: 0 } }} helperText="3D only" />
                      </Grid>
                    </Grid>
                    {selected.kind === 'ZONE' && (
                      <TextField label="Zone color" type="color" value={(selected.meta?.color as string) ?? '#E0E7FF'} onChange={(e) => updateSelected({ meta: { ...(selected.meta ?? {}), color: e.target.value } })} />
                    )}
                    {linkType && (
                      <>
                        <Divider />
                        <FormControl size="small" fullWidth>
                          <InputLabel id="ms-link">Linked {linkType === 'SEAT' ? 'seat' : 'meeting room'}</InputLabel>
                          <Select labelId="ms-link" label={`Linked ${linkType === 'SEAT' ? 'seat' : 'meeting room'}`} value={selected.resourceId ?? ''} onChange={(e) => { const id = e.target.value || null; const r = resources.find((x) => x.id === id); updateSelected({ resourceId: id, label: r ? r.code : selected.label }); }} data-testid="map-link-resource">
                            <MenuItem value="">Not linked (shown as not bookable)</MenuItem>
                            {linkOptions.map((r) => <MenuItem key={r.id} value={r.id}>{r.code} · {r.name}</MenuItem>)}
                          </Select>
                        </FormControl>
                        {!selected.resourceId && (
                          <Button variant="outlined" startIcon={<AddRoundedIcon />} onClick={() => setCreateFor({ key: selected.key, type: linkType, code: selected.label ?? '' })}>
                            Create {linkType === 'SEAT' ? 'seat' : 'room'} here
                          </Button>
                        )}
                      </>
                    )}
                  </Stack>
                ) : (
                  <Typography variant="body2" color="text.secondary">Select an object on the canvas to edit its position, size, rotation and resource link. Keyboard: arrows move, Shift+arrows move 1 m, R rotates, Delete removes.</Typography>
                )
              )}
              {tab === 2 && (
                <Stack spacing={2}>
                  <Typography variant="body2" color="text.secondary">
                    Upload a floor-plan image (PNG, JPG or SVG) to trace over, and optionally a GLB model of this floor for the 3D explorer. Files are validated and size-limited by the server.
                  </Typography>
                  <AssetPicker kind="FLOOR_PLAN_IMAGE" label="Floor-plan image" value={imageAssetId} onChange={(id) => { setImageAssetId(id); setDirty(true); }} />
                  <AssetPicker kind="FLOOR_MODEL" label="Floor 3D model (GLB)" value={modelAssetId} onChange={(id) => { setModelAssetId(id); setDirty(true); }} />
                  <Alert severity="info" icon={false}>
                    <Typography variant="caption">Replacing the plan or its image never deletes resources or bookings. Desks and rooms keep their identity because map objects reference them by id.</Typography>
                  </Alert>
                </Stack>
              )}
              {tab === 3 && <ZonesPanel floorId={floorId} zones={draft.zones} />}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <ResourceFormDialog
        open={!!createFor}
        onClose={() => setCreateFor(null)}
        type={createFor?.type ?? 'SEAT'}
        defaults={{ buildingId, floorId, code: createFor?.code, name: createFor?.code ? `${createFor.type === 'SEAT' ? 'Desk' : 'Room'} ${createFor.code}` : undefined }}
        onSaved={(r) => {
          if (createFor?.key) mutate((prev) => prev.map((o) => (o.key === createFor.key ? { ...o, resourceId: r.id, label: r.code } : o)));
          else {
            const size = DEFAULT_SIZES.DESK;
            const obj = clampToFloor<StudioObject>({ key: newKey(), kind: 'DESK', label: r.code, x: widthM / 2, y: depthM / 2, width: size.width, depth: size.depth, rotation: 0, height: null, resourceId: r.id, meta: null }, widthM, depthM);
            mutate((prev) => [...prev, obj]);
            setSelectedKey(obj.key);
            setTab(1);
          }
        }}
      />
    </Stack>
  );
}

function ZonesPanel({ floorId, zones }: { floorId: string; zones: ZoneDto[] }) {
  const [create, cs] = useCreateZoneMutation();
  const [update] = useUpdateZoneMutation();
  const [remove] = useDeleteZoneMutation();
  const toast = useToast();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<(typeof ZoneKinds)[number]>('NEIGHBORHOOD');
  const [color, setColor] = useState('#DBEAFE');
  const [editing, setEditing] = useState<ZoneDto | null>(null);
  const run = async (p: Promise<unknown>, msg: string) => {
    try {
      await p;
      toast.success(msg);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">Zones group desks into neighborhoods, quiet areas and collaboration spaces. Assign seats to zones in Seat management; draw zone outlines with the Zone outline object.</Typography>
      <List dense>
        {zones.length === 0 && <Typography variant="caption" color="text.secondary">No zones yet.</Typography>}
        {zones.map((z) => (
          <ListItem key={z.id} disableGutters secondaryAction={<Stack direction="row"><Button size="small" onClick={() => setEditing(z)}>Edit</Button><IconButton size="small" aria-label={`Delete zone ${z.name}`} onClick={() => run(remove({ id: z.id }).unwrap(), 'Zone deleted')}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton></Stack>}>
            <Box aria-hidden sx={{ width: 14, height: 14, borderRadius: 0.5, bgcolor: z.color ?? '#E2E8F0', mr: 1, border: '1px solid #94A3B8' }} />
            <ListItemText primary={z.name} secondary={z.kind.toLowerCase()} />
          </ListItem>
        ))}
      </List>
      <Divider />
      <Stack spacing={1} component="form" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; void run(create({ floorId, name: name.trim(), kind, color }).unwrap(), 'Zone created'); setName(''); }}>
        <TextField label="New zone name" value={name} onChange={(e) => setName(e.target.value)} />
        <Stack direction="row" spacing={1}>
          <FormControl size="small" fullWidth>
            <InputLabel id="zone-kind">Type</InputLabel>
            <Select labelId="zone-kind" label="Type" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              {ZoneKinds.map((k) => <MenuItem key={k} value={k}>{k.toLowerCase()}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField label="Color" type="color" value={color} onChange={(e) => setColor(e.target.value)} sx={{ width: 90 }} />
        </Stack>
        <Button type="submit" variant="outlined" disabled={!name.trim() || cs.isLoading}>Add zone</Button>
      </Stack>
      <Dialog open={!!editing} onClose={() => setEditing(null)} fullWidth maxWidth="xs" aria-labelledby="zone-edit-title">
        <DialogTitle id="zone-edit-title">Edit zone</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Name" value={editing?.name ?? ''} onChange={(e) => setEditing(editing ? { ...editing, name: e.target.value } : null)} />
            <FormControl size="small" fullWidth>
              <InputLabel id="zone-edit-kind">Type</InputLabel>
              <Select labelId="zone-edit-kind" label="Type" value={editing?.kind ?? 'GENERAL'} onChange={(e) => setEditing(editing ? { ...editing, kind: e.target.value as ZoneDto['kind'] } : null)}>
                {ZoneKinds.map((k) => <MenuItem key={k} value={k}>{k.toLowerCase()}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField label="Color" type="color" value={editing?.color ?? '#E2E8F0'} onChange={(e) => setEditing(editing ? { ...editing, color: e.target.value } : null)} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setEditing(null)}>Cancel</Button>
          <Button variant="contained" disabled={!editing?.name.trim()} onClick={() => { if (editing) void run(update({ id: editing.id, name: editing.name.trim(), kind: editing.kind, color: editing.color }).unwrap(), 'Zone updated'); setEditing(null); }}>Save</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
