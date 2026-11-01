// Conventional list of a floor's resources: fully keyboard operable alternative to the 3D/2D views.
import { useMemo, useState } from 'react';
import { Box, Chip, InputAdornment, MenuItem, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField, Typography } from '@mui/material';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import DesktopWindowsRoundedIcon from '@mui/icons-material/DesktopWindowsRounded';
import MeetingRoomRoundedIcon from '@mui/icons-material/MeetingRoomRounded';
import type { ResourceDto } from '@spaceflow/shared';
import { StatusBadge } from '@/components/common/StatusBadge';
import { FavoriteButton, seatFeatureChips } from '@/components/common/ResourceCard';
import { EmptyState } from '@/components/common/EmptyState';
import { resourceState } from './geometry';

export function ResourceListView({ resources, selectedResourceId, onSelectResource, floorName }: { resources: ResourceDto[]; selectedResourceId: string | null; onSelectResource: (id: string) => void; floorName?: string }) {
  const [q, setQ] = useState('');
  const [type, setType] = useState<'ALL' | 'SEAT' | 'MEETING_ROOM'>('ALL');
  const [state, setState] = useState<'ALL' | 'AVAILABLE' | 'RESERVED' | 'DISABLED'>('ALL');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return resources
      .filter((r) => (type === 'ALL' || r.type === type))
      .filter((r) => {
        const s = resourceState(r);
        if (state === 'ALL') return true;
        if (state === 'AVAILABLE') return s === 'AVAILABLE' || s === 'RESTRICTED';
        if (state === 'RESERVED') return s === 'RESERVED' || s === 'OCCUPIED';
        return s === 'DISABLED';
      })
      .filter((r) => !term || `${r.code} ${r.name} ${r.zoneName ?? ''} ${r.amenities.map((a) => a.name).join(' ')}`.toLowerCase().includes(term))
      .sort((a, b) => a.type.localeCompare(b.type) || a.code.localeCompare(b.code));
  }, [resources, q, type, state]);
  const pageRows = filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <Box data-testid="resource-list" sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', bgcolor: '#fff' }}>
      {/* Wrapping row (not a column) so on phones the filters stay compact and rows remain visible;
          left padding keeps the viewer's overlay controls from covering the filter field. */}
      <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1, p: 1.5, pl: 7, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
        <TextField
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(0); }}
          placeholder={`Filter ${floorName ? `${floorName} ` : ''}resources…`}
          size="small"
          slotProps={{ htmlInput: { 'aria-label': 'Filter resources' }, input: { startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> } }}
          sx={{ flex: '1 1 200px' }}
        />
        <TextField select size="small" label="Type" value={type} onChange={(e) => { setType(e.target.value as typeof type); setPage(0); }} sx={{ flex: '1 1 120px', minWidth: 120 }}>
          <MenuItem value="ALL">All types</MenuItem>
          <MenuItem value="SEAT">Desks</MenuItem>
          <MenuItem value="MEETING_ROOM">Meeting rooms</MenuItem>
        </TextField>
        <TextField select size="small" label="Status" value={state} onChange={(e) => { setState(e.target.value as typeof state); setPage(0); }} sx={{ flex: '1 1 120px', minWidth: 120 }}>
          <MenuItem value="ALL">Any status</MenuItem>
          <MenuItem value="AVAILABLE">Available</MenuItem>
          <MenuItem value="RESERVED">Reserved / in use</MenuItem>
          <MenuItem value="DISABLED">Not bookable</MenuItem>
        </TextField>
      </Stack>
      <TableContainer sx={{ flex: 1, minHeight: 0 }}>
        {filtered.length === 0 ? (
          <EmptyState title="No resources match" description="Try another filter, time window or floor." compact />
        ) : (
          <Table size="small" stickyHeader aria-label="Resources on this floor">
            <TableHead>
              <TableRow>
                <TableCell>Resource</TableCell>
                <TableCell>Zone</TableCell>
                <TableCell>Capacity</TableCell>
                <TableCell>Features</TableCell>
                <TableCell>Availability</TableCell>
                <TableCell align="right">Favorite</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pageRows.map((r) => {
                const selected = r.id === selectedResourceId;
                return (
                  <TableRow
                    key={r.id}
                    hover
                    selected={selected}
                    tabIndex={0}
                    role="button"
                    aria-pressed={selected}
                    aria-label={`${r.name}, ${resourceState(r).toLowerCase()}`}
                    onClick={() => onSelectResource(r.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectResource(r.id); } }}
                    sx={{ cursor: 'pointer', '&:focus-visible': { outline: '3px solid #2563EB', outlineOffset: -3 } }}
                    data-testid={`resource-row-${r.code}`}
                  >
                    <TableCell>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Box sx={{ color: 'primary.main', display: 'flex' }} aria-hidden>{r.type === 'SEAT' ? <DesktopWindowsRoundedIcon fontSize="small" /> : <MeetingRoomRoundedIcon fontSize="small" />}</Box>
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>{r.name}</Typography>
                          <Typography variant="caption" color="text.secondary">{r.code}</Typography>
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell>{r.zoneName ?? '—'}</TableCell>
                    <TableCell>{r.capacity ?? '—'}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
                        {seatFeatureChips(r, 3).map((f) => <Chip key={f} size="small" label={f} sx={{ bgcolor: '#F1F5F9' }} />)}
                      </Stack>
                    </TableCell>
                    <TableCell><StatusBadge status={resourceState(r)} /></TableCell>
                    <TableCell align="right" onClick={(e) => e.stopPropagation()}><FavoriteButton resource={r} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </TableContainer>
      <TablePagination component="div" count={filtered.length} page={page} onPageChange={(_e, p) => setPage(p)} rowsPerPage={rowsPerPage} onRowsPerPageChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(0); }} rowsPerPageOptions={[25, 50, 100]} sx={{ borderTop: '1px solid', borderColor: 'divider' }} />
    </Box>
  );
}
