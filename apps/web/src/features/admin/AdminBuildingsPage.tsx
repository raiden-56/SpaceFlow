// Buildings & floors: create/edit buildings (timezone validated), activate/deactivate, archive,
// attach a GLB model, and manage floors (create, rename, reorder, publish/unpublish, delete).
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Autocomplete, Box, Button, Card, CardActionArea, CardContent, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel, Grid, IconButton, List, ListItem, ListItemText, Menu, MenuItem, Stack, Switch, TextField, Tooltip, Typography } from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded';
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import ViewInArRoundedIcon from '@mui/icons-material/ViewInArRounded';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import { buildingCreateSchema, floorCreateSchema, type BuildingDto, type BuildingInput, type FloorDto } from '@spaceflow/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { PageTransition } from '@/components/common/Motion';
import { ErrorState, GridSkeleton, CardSkeleton } from '@/components/common/Feedback';
import { EmptyState } from '@/components/common/EmptyState';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { StatusBadge } from '@/components/common/StatusBadge';
import { useToast } from '@/components/common/ToastProvider';
import {
  useBuildingsQuery,
  useCreateBuildingMutation,
  useCreateFloorMutation,
  useDeleteBuildingMutation,
  useDeleteFloorMutation,
  useFloorsQuery,
  usePublishFloorPlanMutation,
  useReorderFloorsMutation,
  useSetBuildingModelMutation,
  useUnpublishFloorPlanMutation,
  useUpdateBuildingMutation,
  useUpdateFloorMutation,
} from '@/services/endpoints';
import { errorMessage } from '@/services/api';
import { AssetPicker } from './components/AssetPicker';
import { TIMEZONES } from './components/useLookups';

export function AdminBuildingsPage() {
  const { buildingId } = useParams();
  const navigate = useNavigate();
  const { data: buildings, isLoading, error, refetch } = useBuildingsQuery();
  const [dialog, setDialog] = useState<{ building: BuildingDto | null } | null>(null);
  const selected = buildings?.find((b) => b.id === buildingId) ?? null;

  useEffect(() => {
    if (!buildingId && buildings?.length) navigate(`/admin/buildings/${buildings[0].id}`, { replace: true });
  }, [buildingId, buildings, navigate]);

  return (
    <PageTransition>
      <PageHeader
        title="Buildings & floors"
        subtitle="Locations, time zones, floors and published layouts."
        crumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Buildings & floors', to: '/admin/buildings' }, ...(selected ? [{ label: selected.name }] : [])]}
        actions={<Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setDialog({ building: null })} data-testid="admin-create-building">New building</Button>}
      />
      {isLoading ? (
        <GridSkeleton count={3} height={120} />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !buildings?.length ? (
        <EmptyState icon={<ApartmentRoundedIcon />} title="No buildings yet" description="Create your first building, then add floors and design their layout in the Map Studio." actionLabel="New building" onAction={() => setDialog({ building: null })} />
      ) : (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 4, lg: 3 }}>
            <Stack spacing={1.5} role="list" aria-label="Buildings">
              {buildings.map((b) => (
                <Card key={b.id} role="listitem" sx={{ borderColor: b.id === buildingId ? 'primary.main' : undefined, boxShadow: b.id === buildingId ? '0 0 0 2px rgba(79,70,229,0.2)' : undefined }}>
                  <CardActionArea onClick={() => navigate(`/admin/buildings/${b.id}`)} aria-current={b.id === buildingId ? 'true' : undefined}>
                    <CardContent>
                      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }} spacing={1}>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="subtitle1" sx={{ fontWeight: 600 }} noWrap>{b.name}</Typography>
                          <Typography variant="caption" color="text.secondary">{b.code} · {b.city ?? 'No city'} · {b.timezone}</Typography>
                        </Box>
                        {!b.isActive && <Chip size="small" label="Inactive" />}
                      </Stack>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                        {b.floorCount} floors · {b.seatCount} seats · {b.roomCount} rooms
                      </Typography>
                    </CardContent>
                  </CardActionArea>
                </Card>
              ))}
            </Stack>
          </Grid>
          <Grid size={{ xs: 12, md: 8, lg: 9 }}>{selected ? <BuildingDetail building={selected} onEdit={() => setDialog({ building: selected })} /> : <CardSkeleton count={2} />}</Grid>
        </Grid>
      )}
      <BuildingDialog open={!!dialog} building={dialog?.building ?? null} onClose={() => setDialog(null)} onCreated={(b) => navigate(`/admin/buildings/${b.id}`)} />
    </PageTransition>
  );
}

function BuildingDialog({ open, building, onClose, onCreated }: { open: boolean; building: BuildingDto | null; onClose: () => void; onCreated: (b: BuildingDto) => void }) {
  const [create, cs] = useCreateBuildingMutation();
  const [update, us] = useUpdateBuildingMutation();
  const toast = useToast();
  const empty = (b: BuildingDto | null): BuildingInput => ({ name: b?.name ?? '', code: b?.code ?? '', addressLine: b?.addressLine ?? '', city: b?.city ?? '', country: b?.country ?? '', timezone: b?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, isActive: b?.isActive ?? true, description: b?.description ?? '' });
  const [form, setForm] = useState<BuildingInput>(() => empty(building));
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setForm(empty(building));
      setIssues({});
      setError(null);
    }
  }, [open, building]);
  const busy = cs.isLoading || us.isLoading;
  const submit = async () => {
    const parsed = buildingCreateSchema.safeParse({ ...form, addressLine: form.addressLine || null, city: form.city || null, country: form.country || null, description: form.description || null });
    if (!parsed.success) {
      setIssues(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setIssues({});
    try {
      if (building) {
        await update({ id: building.id, ...parsed.data }).unwrap();
        toast.success('Building updated');
      } else {
        const b = await create(parsed.data).unwrap();
        toast.success(`${b.name} created. Add floors next.`);
        onCreated(b);
      }
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby="building-dialog-title">
      <DialogTitle id="building-dialog-title">{building ? `Edit ${building.name}` : 'New building'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 8 }}><TextField label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={!!issues.name} helperText={issues.name} slotProps={{ htmlInput: { 'data-testid': 'building-name' } as object }} /></Grid>
            <Grid size={{ xs: 12, sm: 4 }}><TextField label="Code" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} error={!!issues.code} helperText={issues.code ?? 'Letters, digits, dashes'} slotProps={{ htmlInput: { maxLength: 20, 'data-testid': 'building-code' } as object }} /></Grid>
            <Grid size={{ xs: 12 }}><TextField label="Address" value={form.addressLine ?? ''} onChange={(e) => setForm({ ...form, addressLine: e.target.value })} /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}><TextField label="City" value={form.city ?? ''} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}><TextField label="Country" value={form.country ?? ''} onChange={(e) => setForm({ ...form, country: e.target.value })} /></Grid>
            <Grid size={{ xs: 12 }}>
              <Autocomplete
                freeSolo
                options={TIMEZONES}
                value={form.timezone}
                onInputChange={(_e, v) => setForm({ ...form, timezone: v })}
                renderInput={(params) => <TextField {...params} label="Time zone (IANA)" required error={!!issues.timezone} helperText={issues.timezone ?? 'Booking hours are interpreted in this time zone, including daylight-saving changes.'} />}
              />
            </Grid>
            <Grid size={{ xs: 12 }}><TextField label="Description" value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} multiline minRows={2} /></Grid>
          </Grid>
          <FormControlLabel control={<Switch checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />} label="Active (visible and bookable for employees)" />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button color="inherit" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={busy || !form.name || !form.code} startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined} data-testid="building-save">
          {building ? 'Save' : 'Create building'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function BuildingDetail({ building, onEdit }: { building: BuildingDto; onEdit: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { data: floors, isLoading, error, refetch } = useFloorsQuery({ buildingId: building.id });
  const [updateBuilding] = useUpdateBuildingMutation();
  const [setModel] = useSetBuildingModelMutation();
  const [deleteBuilding, delState] = useDeleteBuildingMutation();
  const [reorder] = useReorderFloorsMutation();
  const [publish] = usePublishFloorPlanMutation();
  const [unpublish] = useUnpublishFloorPlanMutation();
  const [deleteFloor, delFloorState] = useDeleteFloorMutation();
  const [floorDialog, setFloorDialog] = useState<{ floor: FloorDto | null } | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [floorToDelete, setFloorToDelete] = useState<FloorDto | null>(null);
  const [menu, setMenu] = useState<{ el: HTMLElement; f: FloorDto } | null>(null);
  const ordered = [...(floors ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.number - b.number);

  const run = async (p: Promise<unknown>, ok: string) => {
    try {
      await p;
      toast.success(ok);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...ordered];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    void run(reorder({ buildingId: building.id, floorIds: next.map((f) => f.id) }).unwrap(), 'Floor order saved');
  };

  const togglePublish = async (f: FloorDto) => {
    if (!f.hasFloorPlan) {
      toast.info('Design and save a floor plan in the Map Studio before publishing.');
      navigate(`/admin/map-studio/${f.id}`);
      return;
    }
    if (f.isPublished) await run(unpublish({ floorId: f.id }).unwrap(), `${f.name} unpublished`);
    else {
      try {
        const res = await publish({ floorId: f.id }).unwrap();
        toast.success(`${f.name} published${res.warnings.length ? ` with ${res.warnings.length} warning(s): ${res.warnings.join(' ')}` : ''}`);
      } catch (err) {
        toast.error(errorMessage(err));
      }
    }
  };

  return (
    <Stack spacing={2}>
      <Card>
        <CardContent>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { sm: 'flex-start' } }}>
            <Box>
              <Typography variant="h3" component="h2">{building.name}</Typography>
              <Typography variant="body2" color="text.secondary">{[building.addressLine, building.city, building.country].filter(Boolean).join(', ') || 'No address'} · {building.timezone}</Typography>
              {building.description && <Typography variant="body2" sx={{ mt: 1 }}>{building.description}</Typography>}
              <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                {building.isActive ? <StatusBadge status="CONFIRMED" label="Active" /> : <StatusBadge status="CANCELLED" label="Inactive" />}
                <Chip size="small" variant="outlined" label={`${building.seatCount} seats`} />
                <Chip size="small" variant="outlined" label={`${building.roomCount} rooms`} />
              </Stack>
            </Box>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <Button variant="outlined" startIcon={<EditRoundedIcon />} onClick={onEdit}>Edit</Button>
              <Button variant="outlined" onClick={() => run(updateBuilding({ id: building.id, isActive: !building.isActive }).unwrap(), building.isActive ? 'Building deactivated' : 'Building activated')}>
                {building.isActive ? 'Deactivate' : 'Activate'}
              </Button>
              <Button variant="outlined" color="error" startIcon={<DeleteOutlineRoundedIcon />} onClick={() => setArchiveOpen(true)}>Archive</Button>
            </Stack>
          </Stack>
          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" gutterBottom>3D building model (optional)</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Upload a GLB/glTF binary to replace the generated building shell in the 3D explorer. Without a model, SpaceFlow builds a simplified 3D view from your floor plans.</Typography>
          <AssetPicker kind="BUILDING_MODEL" label="Building model" value={building.modelAssetId} onChange={(assetId) => run(setModel({ id: building.id, modelAssetId: assetId }).unwrap(), assetId ? 'Model attached' : 'Model removed')} />
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="h4" component="h2">Floors</Typography>
            <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setFloorDialog({ floor: null })} data-testid="admin-create-floor">Add floor</Button>
          </Stack>
          {isLoading ? (
            <CardSkeleton count={3} height={56} />
          ) : error ? (
            <ErrorState error={error} onRetry={refetch} />
          ) : ordered.length === 0 ? (
            <EmptyState compact title="No floors yet" description="Add a floor, then design its layout in the Map Studio and publish it." />
          ) : (
            <List aria-label="Floors" disablePadding>
              {ordered.map((f, i) => (
                <ListItem
                  key={f.id}
                  divider
                  sx={{ pr: 1, flexWrap: 'wrap', gap: 1 }}
                  data-testid={`admin-floor-${f.number}`}
                >
                  <ListItemText primary={<Typography sx={{ fontWeight: 600 }}>{f.name} <Typography component="span" variant="caption" color="text.secondary">level {f.number}</Typography></Typography>} secondary={`${f.seatCount} seats · ${f.roomCount} rooms · layout ${f.floorPlanStatus.toLowerCase()}${f.widthM ? ` · ${f.widthM}×${f.depthM} m` : ''}`} sx={{ minWidth: 200 }} />
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                    <Chip size="small" color={f.isPublished ? 'success' : 'default'} variant={f.isPublished ? 'filled' : 'outlined'} label={f.isPublished ? 'Published' : 'Hidden'} />
                    <Tooltip title="Move up"><span><IconButton size="small" aria-label={`Move ${f.name} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUpwardRoundedIcon fontSize="small" /></IconButton></span></Tooltip>
                    <Tooltip title="Move down"><span><IconButton size="small" aria-label={`Move ${f.name} down`} disabled={i === ordered.length - 1} onClick={() => move(i, 1)}><ArrowDownwardRoundedIcon fontSize="small" /></IconButton></span></Tooltip>
                    <Button size="small" startIcon={<ViewInArRoundedIcon />} onClick={() => navigate(`/admin/map-studio/${f.id}`)}>Map Studio</Button>
                    <Button size="small" variant="outlined" onClick={() => void togglePublish(f)}>{f.isPublished ? 'Unpublish' : 'Publish'}</Button>
                    <IconButton size="small" aria-label={`More actions for ${f.name}`} onClick={(e) => setMenu({ el: e.currentTarget, f })}><MoreVertRoundedIcon fontSize="small" /></IconButton>
                  </Stack>
                </ListItem>
              ))}
            </List>
          )}
        </CardContent>
      </Card>

      <Menu open={!!menu} anchorEl={menu?.el} onClose={() => setMenu(null)}>
        <MenuItem onClick={() => { setFloorDialog({ floor: menu!.f }); setMenu(null); }}>Rename / renumber</MenuItem>
        <MenuItem onClick={() => { setFloorToDelete(menu!.f); setMenu(null); }} sx={{ color: 'error.main' }}>Delete floor</MenuItem>
      </Menu>
      <FloorDialog open={!!floorDialog} floor={floorDialog?.floor ?? null} buildingId={building.id} nextNumber={(ordered.at(-1)?.number ?? -1) + 1} onClose={() => setFloorDialog(null)} />
      <ConfirmDialog
        open={archiveOpen}
        title={`Archive ${building.name}?`}
        description="The building and its floors disappear from SpaceFlow. This is refused while active reservations exist; deactivate the building first and let bookings finish or cancel them. Historical bookings are kept."
        confirmLabel="Archive"
        destructive
        loading={delState.isLoading}
        onClose={() => setArchiveOpen(false)}
        onConfirm={async () => {
          try {
            await deleteBuilding({ id: building.id }).unwrap();
            toast.success('Building archived');
            setArchiveOpen(false);
            navigate('/admin/buildings');
          } catch (err) {
            toast.error(errorMessage(err));
            setArchiveOpen(false);
          }
        }}
      />
      <ConfirmDialog
        open={!!floorToDelete}
        title={`Delete ${floorToDelete?.name}?`}
        description="Refused while the floor has active reservations. Resource and booking history is kept."
        confirmLabel="Delete"
        destructive
        loading={delFloorState.isLoading}
        onClose={() => setFloorToDelete(null)}
        onConfirm={async () => {
          try {
            await deleteFloor({ id: floorToDelete!.id }).unwrap();
            toast.success('Floor deleted');
          } catch (err) {
            toast.error(errorMessage(err));
          }
          setFloorToDelete(null);
        }}
      />
    </Stack>
  );
}

function FloorDialog({ open, floor, buildingId, nextNumber, onClose }: { open: boolean; floor: FloorDto | null; buildingId: string; nextNumber: number; onClose: () => void }) {
  const [create, cs] = useCreateFloorMutation();
  const [update, us] = useUpdateFloorMutation();
  const toast = useToast();
  const [name, setName] = useState('');
  const [number, setNumber] = useState('0');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setName(floor?.name ?? `Level ${nextNumber}`);
      setNumber(String(floor?.number ?? nextNumber));
      setError(null);
    }
  }, [open, floor, nextNumber]);
  const busy = cs.isLoading || us.isLoading;
  const submit = async () => {
    const parsed = floorCreateSchema.safeParse({ name: name.trim(), number: Number(number) });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    try {
      if (floor) await update({ id: floor.id, name: parsed.data.name, number: parsed.data.number }).unwrap();
      else await create({ buildingId, name: parsed.data.name, number: parsed.data.number }).unwrap();
      toast.success(floor ? 'Floor updated' : 'Floor created. Design its layout in the Map Studio.');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" aria-labelledby="floor-dialog-title">
      <DialogTitle id="floor-dialog-title">{floor ? `Edit ${floor.name}` : 'Add floor'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Floor name" value={name} onChange={(e) => setName(e.target.value)} required slotProps={{ htmlInput: { 'data-testid': 'floor-name' } as object }} />
          <TextField label="Level number" type="number" value={number} onChange={(e) => setNumber(e.target.value)} required helperText="0 = ground floor, negative numbers for basements. Must be unique within the building." slotProps={{ htmlInput: { 'data-testid': 'floor-number' } as object }} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button color="inherit" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={busy || !name.trim()} data-testid="floor-save">{floor ? 'Save' : 'Add floor'}</Button>
      </DialogActions>
    </Dialog>
  );
}
