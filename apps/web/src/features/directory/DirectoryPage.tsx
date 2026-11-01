import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Avatar, Box, Button, Card, CardActionArea, CardContent, Drawer, FormControl, Grid, IconButton, InputAdornment, InputLabel, MenuItem, Pagination, Select, Skeleton, Stack, TextField, Typography, useMediaQuery, useTheme } from '@mui/material';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import MapRoundedIcon from '@mui/icons-material/MapRounded';
import PeopleAltRoundedIcon from '@mui/icons-material/PeopleAltRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import type { UserSummaryDto } from '@spaceflow/shared';
import { useColleagueTodayQuery, useDirectoryQuery } from '@/services/endpoints';
import { PageHeader } from '@/components/common/PageHeader';
import { PageTransition } from '@/components/common/Motion';
import { ErrorState, GridSkeleton } from '@/components/common/Feedback';
import { EmptyState } from '@/components/common/EmptyState';
import { useViewOnMap } from '@/components/common/BookingCard';
import { StatusBadge } from '@/components/common/StatusBadge';
import { fmtTime } from '@/utils/time';

function initials(u: UserSummaryDto) {
  return `${u.firstName[0] ?? ''}${u.lastName[0] ?? ''}`.toUpperCase();
}

function ColleaguePanel({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { data, isLoading, error, refetch } = useColleagueTodayQuery({ id: userId });
  const viewOnMap = useViewOnMap();
  return (
    <Box sx={{ p: 2.5 }} data-testid="colleague-panel">
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="h4" component="h2">
          Where to find them
        </Typography>
        <IconButton aria-label="Close" size="small" onClick={onClose}>
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </Stack>
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading || !data ? (
        <Skeleton variant="rounded" height={120} sx={{ mt: 2 }} />
      ) : (
        <Stack spacing={1.5} sx={{ mt: 2 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Avatar sx={{ bgcolor: 'primary.main', fontWeight: 700 }}>{initials(data.user)}</Avatar>
            <Box>
              <Typography sx={{ fontWeight: 600 }}>{data.user.displayName}</Typography>
              <Typography variant="caption" color="text.secondary">
                {[data.user.jobTitle, data.user.departmentName, data.user.teamName].filter(Boolean).join(' · ')}
              </Typography>
            </Box>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {data.user.email}
          </Typography>
          {!data.shared ? (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', color: 'text.secondary' }}>
              <LockRoundedIcon fontSize="small" />
              <Typography variant="body2">This colleague does not share their office location.</Typography>
            </Stack>
          ) : data.seat ? (
            <Card variant="outlined">
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Typography variant="subtitle2">Today</Typography>
                <Typography sx={{ fontWeight: 600 }}>{data.seat.resource.name}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {data.seat.resource.buildingName} · {data.seat.resource.floorName}
                  {data.seat.resource.zoneName ? ` · ${data.seat.resource.zoneName}` : ''} · {fmtTime(data.seat.startAt, data.seat.resource.buildingTimezone)}–{fmtTime(data.seat.endAt, data.seat.resource.buildingTimezone)}
                </Typography>
                <Box sx={{ mt: 1 }}>
                  <StatusBadge status="RESERVED" label="Seat booked" />
                </Box>
                <Button size="small" startIcon={<MapRoundedIcon />} sx={{ mt: 1 }} onClick={() => viewOnMap({ buildingId: data.seat!.resource.buildingId, floorId: data.seat!.resource.floorId, resourceId: data.seat!.resource.id })}>
                  View on map
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No desk booked for today — probably working remotely.
            </Typography>
          )}
        </Stack>
      )}
    </Box>
  );
}

export function DirectoryPage() {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('md'));
  const [params, setParams] = useSearchParams();
  const selectedUser = params.get('user');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [department, setDepartment] = useState('');
  const [team, setTeam] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [debounced, department, team]);
  const { data, isLoading, isFetching, error, refetch } = useDirectoryQuery({ q: debounced || undefined, page, pageSize: 24 });
  // Department/team filters are derived from the loaded results (admin-only department API is not used here).
  const { data: all } = useDirectoryQuery({ pageSize: 200 });
  const departments = useMemo(() => [...new Set((all?.items ?? []).map((u) => u.departmentName).filter((d): d is string => !!d))].sort(), [all]);
  const teams = useMemo(() => [...new Set((all?.items ?? []).filter((u) => !department || u.departmentName === department).map((u) => u.teamName).filter((t): t is string => !!t))].sort(), [all, department]);
  const items = (data?.items ?? []).filter((u) => (!department || u.departmentName === department) && (!team || u.teamName === team));
  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('user', id);
    else next.delete('user');
    setParams(next, { replace: true });
  };
  const panel = selectedUser ? <ColleaguePanel key={selectedUser} userId={selectedUser} onClose={() => open(null)} /> : null;

  return (
    <PageTransition>
      <PageHeader title="Office directory" subtitle="Find colleagues and see where they are sitting today." />
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
            <TextField
              placeholder="Search by name, email or role"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> }, htmlInput: { 'aria-label': 'Search employees', 'data-testid': 'directory-search' } }}
            />
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel id="dir-dept">Department</InputLabel>
              <Select labelId="dir-dept" label="Department" value={department} onChange={(e) => { setDepartment(e.target.value); setTeam(''); }}>
                <MenuItem value="">All departments</MenuItem>
                {departments.map((d) => (
                  <MenuItem key={d} value={d}>
                    {d}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel id="dir-team">Team</InputLabel>
              <Select labelId="dir-team" label="Team" value={team} onChange={(e) => setTeam(e.target.value)}>
                <MenuItem value="">All teams</MenuItem>
                {teams.map((t) => (
                  <MenuItem key={t} value={t}>
                    {t}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </CardContent>
      </Card>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: selectedUser ? 8 : 12 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }} aria-live="polite">
            {data ? `${items.length} of ${data.total} people${isFetching ? ' · updating…' : ''}` : ''}
          </Typography>
          {error ? (
            <ErrorState error={error} onRetry={refetch} />
          ) : isLoading ? (
            <GridSkeleton count={6} height={96} />
          ) : items.length === 0 ? (
            <EmptyState icon={<PeopleAltRoundedIcon />} title="No one found" description="Try a different name or clear the filters." />
          ) : (
            <Grid container spacing={1.5}>
              {items.map((u) => (
                <Grid key={u.id} size={{ xs: 12, sm: 6, lg: selectedUser ? 6 : 4 }}>
                  <Card sx={{ borderColor: selectedUser === u.id ? 'primary.main' : undefined }}>
                    <CardActionArea onClick={() => open(u.id)} aria-label={`Open ${u.displayName}`}>
                      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                          <Avatar sx={{ bgcolor: 'primary.main', fontWeight: 700 }}>{initials(u)}</Avatar>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography sx={{ fontWeight: 600 }} noWrap>
                              {u.displayName}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                              {[u.jobTitle, u.departmentName, u.teamName].filter(Boolean).join(' · ') || u.email}
                            </Typography>
                          </Box>
                        </Stack>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                </Grid>
              ))}
            </Grid>
          )}
          {data && data.totalPages > 1 && (
            <Stack sx={{ alignItems: 'center', mt: 2 }}>
              <Pagination count={data.totalPages} page={page} onChange={(_e, p) => setPage(p)} color="primary" />
            </Stack>
          )}
        </Grid>
        {selectedUser && !mobile && (
          <Grid size={{ md: 4 }}>
            <Card sx={{ position: 'sticky', top: 80 }}>{panel}</Card>
          </Grid>
        )}
      </Grid>
      {mobile && (
        <Drawer anchor="bottom" open={!!selectedUser} onClose={() => open(null)} slotProps={{ paper: { sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '80dvh' } } }}>
          {panel}
        </Drawer>
      )}
    </PageTransition>
  );
}
