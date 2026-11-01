// Shared admin screen for seats and meeting rooms: filters, server-paged table, create/edit,
// maintenance, archive, bulk update, CSV import/export and reservation history.
import { useMemo, useState } from 'react';
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Drawer, FormControl, IconButton, InputLabel, List, ListItem, ListItemText, Menu, MenuItem, Select, Stack, TextField, Tooltip, Typography, Alert, CircularProgress, Checkbox, OutlinedInput } from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import type { ResourceDto } from '@spaceflow/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { PageTransition } from '@/components/common/Motion';
import { ErrorState } from '@/components/common/Feedback';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { StatusBadge } from '@/components/common/StatusBadge';
import { useToast } from '@/components/common/ToastProvider';
import { useBulkUpdateResourcesMutation, useDeleteRoomMutation, useDeleteSeatMutation, useResourceReservationsQuery, useResourcesQuery } from '@/services/endpoints';
import { errorMessage } from '@/services/api';
import { fmtRange } from '@/utils/time';
import { DataTable, type Column } from './DataTable';
import { FilterBar } from './FilterBar';
import { ResourceFormDialog } from './ResourceFormDialog';
import { MaintenanceDialog } from './MaintenanceDialog';
import { CsvImportDialog } from './CsvImportDialog';
import { downloadFile } from './authFetch';
import { useLookups } from './useLookups';

type Kind = 'SEAT' | 'MEETING_ROOM';

function statusChip(r: ResourceDto) {
  if (r.status === 'ACTIVE' && r.isBookable) return <StatusBadge status="AVAILABLE" label="Active" />;
  if (r.status === 'MAINTENANCE') return <StatusBadge status="RESTRICTED" label="Maintenance" />;
  return <StatusBadge status="DISABLED" label={r.status === 'DISABLED' ? 'Disabled' : 'Not bookable'} />;
}

export function ResourceAdmin({ type }: { type: Kind }) {
  const isSeat = type === 'SEAT';
  const noun = isSeat ? 'seat' : 'meeting room';
  const toast = useToast();
  const [buildingId, setBuildingId] = useState('');
  const [floorId, setFloorId] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<ResourceDto | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [maint, setMaint] = useState<ResourceDto | null>(null);
  const [archive, setArchive] = useState<ResourceDto | null>(null);
  const [history, setHistory] = useState<ResourceDto | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [menu, setMenu] = useState<{ el: HTMLElement; r: ResourceDto } | null>(null);
  const { buildings, floors, zones } = useLookups(buildingId || null, floorId || null);
  const { data, isLoading, isFetching, error, refetch } = useResourcesQuery({ type, buildingId: buildingId || undefined, floorId: floorId || undefined, zoneId: zoneId || undefined, status: (status || undefined) as ResourceDto['status'] | undefined, q: q || undefined, page, pageSize, sortBy: 'code', sortDir: 'asc' });
  const [delSeat, ds] = useDeleteSeatMutation();
  const [delRoom, dr] = useDeleteRoomMutation();
  const building = buildings.find((b) => b.id === buildingId);

  const columns = useMemo<Column<ResourceDto>[]>(() => {
    const cols: Column<ResourceDto>[] = [
      { key: 'code', header: 'Code', render: (r) => <Typography variant="body2" sx={{ fontWeight: 600 }}>{r.code}</Typography>, sortValue: (r) => r.code },
      { key: 'name', header: 'Name', render: (r) => r.name, sortValue: (r) => r.name },
      { key: 'loc', header: 'Location', render: (r) => <Typography variant="body2">{r.buildingName} · {r.floorName}{r.zoneName ? <Typography component="span" variant="caption" color="text.secondary"> · {r.zoneName}</Typography> : null}</Typography> },
    ];
    if (isSeat) cols.push({ key: 'type', header: 'Type', render: (r) => (r.seatType ?? '').toLowerCase().replace('_', ' ') });
    else cols.push({ key: 'cap', header: 'Capacity', align: 'right', render: (r) => r.capacity ?? '–', sortValue: (r) => r.capacity ?? 0 });
    cols.push(
      { key: 'amen', header: isSeat ? 'Amenities' : 'Equipment', render: (r) => <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', maxWidth: 260 }}>{r.amenities.slice(0, 3).map((a) => <Chip key={a.id} size="small" label={a.name} />)}{r.amenities.length > 3 && <Chip size="small" label={`+${r.amenities.length - 3}`} />}</Stack> },
      { key: 'rules', header: 'Rules', render: (r) => <Stack direction="row" spacing={0.5}>{r.requiresApproval && <Chip size="small" color="warning" variant="outlined" label="Approval" />}{(r.restrictedDepartmentIds.length > 0 || r.restrictedTeamIds.length > 0) && <Chip size="small" variant="outlined" label="Restricted" />}{!r.mapPosition && <Tooltip title="Not placed on the floor plan"><Chip size="small" variant="outlined" color="error" label="No map" /></Tooltip>}</Stack> },
      { key: 'status', header: 'Status', render: statusChip, sortValue: (r) => r.status },
      {
        key: 'actions',
        header: 'Actions',
        align: 'right',
        render: (r) => (
          <IconButton size="small" aria-label={`Actions for ${r.code}`} onClick={(e) => { e.stopPropagation(); setMenu({ el: e.currentTarget, r }); }}>
            <MoreVertRoundedIcon fontSize="small" />
          </IconButton>
        ),
      },
    );
    return cols;
  }, [isSeat]);

  const doArchive = async () => {
    if (!archive) return;
    try {
      if (isSeat) await delSeat({ id: archive.id }).unwrap();
      else await delRoom({ id: archive.id }).unwrap();
      toast.success(`${archive.code} archived. Booking history is kept and future bookings were cancelled.`);
      setArchive(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <PageTransition>
      <PageHeader
        title={isSeat ? 'Seat management' : 'Meeting rooms'}
        subtitle={isSeat ? 'Create desks, configure amenities, restrictions and availability, import in bulk.' : 'Configure rooms, capacity, equipment, opening hours and approval rules.'}
        crumbs={[{ label: 'Admin', to: '/admin' }, { label: isSeat ? 'Seats' : 'Meeting rooms' }]}
        actions={
          <>
            <Tooltip title={buildingId ? '' : 'Select a building first'}>
              <span>
                <Button variant="outlined" startIcon={<UploadFileRoundedIcon />} disabled={!buildingId} onClick={() => setImportOpen(true)}>Import CSV</Button>
              </span>
            </Tooltip>
            <Tooltip title={buildingId ? '' : 'Select a building first'}>
              <span>
                <Button variant="outlined" startIcon={<DownloadRoundedIcon />} disabled={!buildingId} onClick={() => downloadFile(`/admin/buildings/${buildingId}/export?type=${isSeat ? 'seats' : 'rooms'}`, `spaceflow-${building?.code ?? 'building'}-${isSeat ? 'seats' : 'rooms'}.csv`).catch((e) => toast.error(e.message))}>Export</Button>
              </span>
            </Tooltip>
            <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => { setEditing(null); setFormOpen(true); }} data-testid={isSeat ? 'admin-create-seat' : 'admin-create-room'}>
              New {noun}
            </Button>
          </>
        }
      />
      <FilterBar actions={selected.size > 0 ? <Button variant="contained" color="secondary" onClick={() => setBulkOpen(true)}>Bulk update ({selected.size})</Button> : undefined}>
        <TextField label="Search code or name" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} size="small" />
        <FormControl size="small">
          <InputLabel id="ra-b">Building</InputLabel>
          <Select labelId="ra-b" label="Building" value={buildingId} onChange={(e) => { setBuildingId(e.target.value); setFloorId(''); setZoneId(''); setPage(1); }}>
            <MenuItem value="">All buildings</MenuItem>
            {buildings.map((b) => <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" disabled={!buildingId}>
          <InputLabel id="ra-f">Floor</InputLabel>
          <Select labelId="ra-f" label="Floor" value={floorId} onChange={(e) => { setFloorId(e.target.value); setZoneId(''); setPage(1); }}>
            <MenuItem value="">All floors</MenuItem>
            {floors.map((f) => <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" disabled={!floorId}>
          <InputLabel id="ra-z">Zone</InputLabel>
          <Select labelId="ra-z" label="Zone" value={zoneId} onChange={(e) => { setZoneId(e.target.value); setPage(1); }}>
            <MenuItem value="">All zones</MenuItem>
            {zones.map((z) => <MenuItem key={z.id} value={z.id}>{z.name}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small">
          <InputLabel id="ra-s">Status</InputLabel>
          <Select labelId="ra-s" label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <MenuItem value="">Any status</MenuItem>
            <MenuItem value="ACTIVE">Active</MenuItem>
            <MenuItem value="MAINTENANCE">Maintenance</MenuItem>
            <MenuItem value="DISABLED">Disabled</MenuItem>
          </Select>
        </FormControl>
      </FilterBar>
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <DataTable
          ariaLabel={isSeat ? 'Seats' : 'Meeting rooms'}
          data-testid={isSeat ? 'admin-seats-table' : 'admin-rooms-table'}
          rows={data?.items ?? []}
          columns={columns}
          rowKey={(r) => r.id}
          loading={isLoading}
          total={data?.total ?? 0}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          selectable
          selected={selected}
          onSelectedChange={setSelected}
          onRowClick={(r) => { setEditing(r); setFormOpen(true); }}
          emptyTitle={`No ${noun}s match`}
          emptyDescription="Adjust the filters or create a new one."
          dense
        />
      )}
      {isFetching && !isLoading && <Typography variant="caption" color="text.secondary" aria-live="polite">Refreshing…</Typography>}

      <Menu open={!!menu} anchorEl={menu?.el} onClose={() => setMenu(null)}>
        <MenuItem onClick={() => { setEditing(menu!.r); setFormOpen(true); setMenu(null); }}>Edit</MenuItem>
        <MenuItem onClick={() => { setMaint(menu!.r); setMenu(null); }}>Maintenance windows</MenuItem>
        <MenuItem onClick={() => { setHistory(menu!.r); setMenu(null); }}>Reservation history</MenuItem>
        <MenuItem onClick={() => { setArchive(menu!.r); setMenu(null); }} sx={{ color: 'error.main' }}>Archive</MenuItem>
      </Menu>

      <ResourceFormDialog open={formOpen} onClose={() => setFormOpen(false)} type={type} resource={editing} defaults={{ buildingId: buildingId || undefined, floorId: floorId || undefined }} />
      <MaintenanceDialog open={!!maint} onClose={() => setMaint(null)} resource={maint} />
      <ConfirmDialog
        open={!!archive}
        title={`Archive ${archive?.code}?`}
        description={`The ${noun} disappears from booking and the map. Its booking history is kept; upcoming bookings are cancelled and the people affected are notified.`}
        confirmLabel="Archive"
        destructive
        loading={ds.isLoading || dr.isLoading}
        onConfirm={doArchive}
        onClose={() => setArchive(null)}
      />
      {building && <CsvImportDialog open={importOpen} onClose={() => setImportOpen(false)} buildingId={building.id} buildingName={building.name} type={isSeat ? 'seats' : 'rooms'} />}
      <BulkDialog open={bulkOpen} onClose={() => setBulkOpen(false)} ids={[...selected]} floorId={floorId} onDone={() => setSelected(new Set())} isSeat={isSeat} />
      <HistoryDrawer resource={history} onClose={() => setHistory(null)} />
    </PageTransition>
  );
}

function BulkDialog({ open, onClose, ids, floorId, onDone, isSeat }: { open: boolean; onClose: () => void; ids: string[]; floorId: string; onDone: () => void; isSeat: boolean }) {
  const [status, setStatus] = useState('');
  const [approval, setApproval] = useState('');
  const [zoneId, setZoneId] = useState('__keep');
  const [add, setAdd] = useState<string[]>([]);
  const [remove, setRemove] = useState<string[]>([]);
  const { zones, amenities } = useLookups(null, floorId || null);
  const [bulk, { isLoading, error }] = useBulkUpdateResourcesMutation();
  const toast = useToast();
  const relevant = amenities.filter((a) => a.category === 'BOTH' || a.category === (isSeat ? 'SEAT' : 'ROOM'));
  const submit = async () => {
    const patch: Record<string, unknown> = {};
    if (status) patch.status = status;
    if (approval) patch.requiresApproval = approval === 'yes';
    if (zoneId !== '__keep') patch.zoneId = zoneId || null;
    if (add.length) patch.addAmenityIds = add;
    if (remove.length) patch.removeAmenityIds = remove;
    try {
      const res = await bulk({ resourceIds: ids, patch }).unwrap();
      toast.success(`Updated ${res.updated} resources`);
      onDone();
      onClose();
    } catch {
      /* shown */
    }
  };
  const multi = (label: string, value: string[], set: (v: string[]) => void) => (
    <FormControl size="small" fullWidth>
      <InputLabel id={`bulk-${label}`}>{label}</InputLabel>
      <Select labelId={`bulk-${label}`} multiple value={value} input={<OutlinedInput label={label} />} onChange={(e) => set(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)} renderValue={(s) => (s as string[]).map((id) => relevant.find((a) => a.id === id)?.name).join(', ')}>
        {relevant.map((a) => <MenuItem key={a.id} value={a.id}><Checkbox size="small" checked={value.includes(a.id)} /><ListItemText primary={a.name} /></MenuItem>)}
      </Select>
    </FormControl>
  );
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="bulk-title">
      <DialogTitle id="bulk-title">Bulk update {ids.length} resources</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error && <Alert severity="error">{errorMessage(error)}</Alert>}
          <FormControl size="small" fullWidth>
            <InputLabel id="bulk-status">Status</InputLabel>
            <Select labelId="bulk-status" label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <MenuItem value="">Keep</MenuItem>
              <MenuItem value="ACTIVE">Active</MenuItem>
              <MenuItem value="MAINTENANCE">Maintenance</MenuItem>
              <MenuItem value="DISABLED">Disabled</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" fullWidth>
            <InputLabel id="bulk-appr">Requires approval</InputLabel>
            <Select labelId="bulk-appr" label="Requires approval" value={approval} onChange={(e) => setApproval(e.target.value)}>
              <MenuItem value="">Keep</MenuItem>
              <MenuItem value="yes">Yes</MenuItem>
              <MenuItem value="no">No</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" fullWidth disabled={!floorId}>
            <InputLabel id="bulk-zone">Zone</InputLabel>
            <Select labelId="bulk-zone" label="Zone" value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
              <MenuItem value="__keep">Keep</MenuItem>
              <MenuItem value="">No zone</MenuItem>
              {zones.map((z) => <MenuItem key={z.id} value={z.id}>{z.name}</MenuItem>)}
            </Select>
          </FormControl>
          {!floorId && <Typography variant="caption" color="text.secondary">Filter by a floor to change zones in bulk.</Typography>}
          {multi('Add amenities', add, setAdd)}
          {multi('Remove amenities', remove, setRemove)}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button color="inherit" onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={isLoading} startIcon={isLoading ? <CircularProgress size={14} color="inherit" /> : undefined}>Apply</Button>
      </DialogActions>
    </Dialog>
  );
}

function HistoryDrawer({ resource, onClose }: { resource: ResourceDto | null; onClose: () => void }) {
  const { data, isLoading } = useResourceReservationsQuery({ id: resource?.id ?? '' }, { skip: !resource });
  return (
    <Drawer anchor="right" open={!!resource} onClose={onClose} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 440 } } } }}>
      <Box sx={{ p: 2 }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h4" component="h2">Reservation history · {resource?.code}</Typography>
          <IconButton aria-label="Close" onClick={onClose}><CloseRoundedIcon /></IconButton>
        </Stack>
        <Typography variant="caption" color="text.secondary">Most recent 100 reservations</Typography>
        {isLoading ? <CircularProgress sx={{ display: 'block', mt: 2 }} /> : (
          <List dense>
            {(data ?? []).length === 0 && <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>No reservations yet.</Typography>}
            {(data ?? []).map((r) => (
              <ListItem key={r.id} divider secondaryAction={<StatusBadge status={r.status} />}>
                <ListItemText primary={r.userDisplayName} secondary={fmtRange(r.startAt, r.endAt, r.timezone)} />
              </ListItem>
            ))}
          </List>
        )}
      </Box>
    </Drawer>
  );
}
