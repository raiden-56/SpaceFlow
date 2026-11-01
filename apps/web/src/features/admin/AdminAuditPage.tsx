import { useState } from 'react';
import { Box, Chip, Drawer, FormControl, IconButton, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import type { AuditLogDto } from '@spaceflow/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { PageTransition } from '@/components/common/Motion';
import { ErrorState } from '@/components/common/Feedback';
import { useAuditLogQuery } from '@/services/endpoints';
import { DataTable, type Column } from './components/DataTable';
import { FilterBar } from './components/FilterBar';
import { JsonDiff, KeyValue } from './components/JsonDiff';
import { dayjs } from '@/utils/time';

const ENTITY_TYPES = ['Reservation', 'Resource', 'Building', 'Floor', 'User', 'BookingPolicy', 'Asset', 'Announcement', 'IntegrationConfig', 'Organization'];
const ACTIONS = ['reservation.', 'approval.', 'resource.', 'building.', 'floor.', 'floorplan.', 'user.', 'policy.', 'auth.', 'asset.', 'integration.', 'settings.', 'announcement.'];

export function AdminAuditPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [entityId, setEntityId] = useState('');
  const [from, setFrom] = useState<ReturnType<typeof dayjs> | null>(null);
  const [to, setTo] = useState<ReturnType<typeof dayjs> | null>(null);
  const [selected, setSelected] = useState<AuditLogDto | null>(null);
  const { data, isLoading, error, refetch } = useAuditLogQuery({ page, pageSize, entityType: entityType || undefined, action: action || undefined, entityId: entityId.trim() || undefined, from: from ? from.startOf('day').toISOString() : undefined, to: to ? to.endOf('day').toISOString() : undefined });

  const columns: Column<AuditLogDto>[] = [
    { key: 'when', header: 'When', render: (r) => <Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>{dayjs(r.createdAt).format('D MMM YYYY HH:mm:ss')}</Typography>, sortValue: (r) => r.createdAt },
    { key: 'action', header: 'Action', render: (r) => <Chip size="small" label={r.action} sx={{ fontFamily: 'monospace', fontSize: 11 }} />, sortValue: (r) => r.action },
    { key: 'actor', header: 'Actor', render: (r) => r.actorName ?? <Typography variant="caption" color="text.secondary">system</Typography>, sortValue: (r) => r.actorName ?? '' },
    { key: 'entity', header: 'Entity', render: (r) => <><Typography variant="body2">{r.entityType}</Typography><Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>{r.entityId.slice(0, 13)}{r.entityId.length > 13 ? '…' : ''}</Typography></> },
    { key: 'ip', header: 'IP', render: (r) => r.ip ?? '—' },
  ];

  return (
    <PageTransition>
      <PageHeader title="Audit log" subtitle="Every sensitive change (bookings, resources, people, policies, sign-ins) with who, when and what changed." crumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Audit log' }]} />
      <FilterBar>
        <FormControl size="small">
          <InputLabel id="au-entity">Entity type</InputLabel>
          <Select labelId="au-entity" label="Entity type" value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }}>
            <MenuItem value="">All</MenuItem>
            {ENTITY_TYPES.map((t) => (
              <MenuItem key={t} value={t}>{t}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small">
          <InputLabel id="au-action">Action</InputLabel>
          <Select labelId="au-action" label="Action" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
            <MenuItem value="">All</MenuItem>
            {ACTIONS.map((a) => (
              <MenuItem key={a} value={a}>{a}*</MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField size="small" label="Entity id" value={entityId} onChange={(e) => { setEntityId(e.target.value); setPage(1); }} />
        <DatePicker label="From" value={from} onChange={(v) => { if (v && !v.isValid()) return; setFrom(v); setPage(1); }} slotProps={{ textField: { size: 'small' } }} />
        <DatePicker label="To" value={to} onChange={(v) => { if (v && !v.isValid()) return; setTo(v); setPage(1); }} slotProps={{ textField: { size: 'small' } }} />
      </FilterBar>
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <DataTable rows={data?.items ?? []} columns={columns} rowKey={(r) => r.id} loading={isLoading} total={data?.total ?? 0} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} onRowClick={setSelected} ariaLabel="Audit log" emptyTitle="No audit entries match" dense />
      )}
      <Drawer anchor="right" open={!!selected} onClose={() => setSelected(null)} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 520 } } } }}>
        {selected && (
          <Box sx={{ p: 3 }}>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h3">Change details</Typography>
              <IconButton aria-label="Close" onClick={() => setSelected(null)}>
                <CloseRoundedIcon />
              </IconButton>
            </Stack>
            <KeyValue items={[{ label: 'Action', value: <code>{selected.action}</code> }, { label: 'Actor', value: selected.actorName ?? 'system' }, { label: 'Entity', value: `${selected.entityType} ${selected.entityId}` }, { label: 'When', value: dayjs(selected.createdAt).format('D MMM YYYY HH:mm:ss') }, { label: 'IP', value: selected.ip ?? '—' }]} />
            <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>
              Before / after
            </Typography>
            <JsonDiff before={selected.before} after={selected.after} />
          </Box>
        )}
      </Drawer>
    </PageTransition>
  );
}
