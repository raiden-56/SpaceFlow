// Employees & teams: directory, invitations, roles, activation, booking history, departments/teams.
import { useMemo, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Drawer, FormControl, FormControlLabel, Grid, IconButton, InputAdornment, InputLabel, List, ListItem, ListItemText, Menu, MenuItem, OutlinedInput, Select, Stack, Switch, Tab, Tabs, TextField, Tooltip, Typography } from '@mui/material';
import PersonAddRoundedIcon from '@mui/icons-material/PersonAddRounded';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import { RoleCodes, type AdminUserDto, type RoleCode } from '@spaceflow/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { PageTransition } from '@/components/common/Motion';
import { ErrorState, CardSkeleton } from '@/components/common/Feedback';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { StatusBadge } from '@/components/common/StatusBadge';
import { EmptyState } from '@/components/common/EmptyState';
import { useToast } from '@/components/common/ToastProvider';
import { useAuth } from '@/hooks/useAuth';
import {
  useAdminUsersQuery,
  useBuildingsQuery,
  useCreateDepartmentMutation,
  useCreateTeamMutation,
  useCreateUserMutation,
  useDeleteDepartmentMutation,
  useDeleteTeamMutation,
  useDeleteUserMutation,
  useDepartmentsQuery,
  useInviteUserMutation,
  useUpdateDepartmentMutation,
  useUpdateTeamMutation,
  useUpdateUserMutation,
  useUserReservationsQuery,
} from '@/services/endpoints';
import { errorMessage } from '@/services/api';
import { fmtRange, fmtRelative } from '@/utils/time';
import { DataTable, type Column } from './components/DataTable';
import { FilterBar } from './components/FilterBar';

const ROLE_LABEL: Record<RoleCode, string> = { EMPLOYEE: 'Employee', APPROVER: 'Approver', WORKPLACE_ADMIN: 'Workplace admin', ORG_ADMIN: 'Organization admin' };

function userStatus(u: AdminUserDto) {
  if (u.status === 'ACTIVE') return <StatusBadge status="CONFIRMED" label="Active" />;
  if (u.status === 'INVITED') return <StatusBadge status="PENDING_APPROVAL" label="Invited" />;
  return <StatusBadge status="CANCELLED" label="Deactivated" />;
}

export function AdminEmployeesPage() {
  const [tab, setTab] = useState(0);
  return (
    <PageTransition>
      <PageHeader title="Employees & teams" subtitle="Manage accounts, roles, invitations and the department / team structure." crumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Employees & teams' }]} />
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 2 }} aria-label="Employees sections">
        <Tab label="Employees" id="emp-tab-0" aria-controls="emp-panel-0" />
        <Tab label="Departments & teams" id="emp-tab-1" aria-controls="emp-panel-1" />
      </Tabs>
      <Box role="tabpanel" id={`emp-panel-${tab}`} aria-labelledby={`emp-tab-${tab}`}>
        {tab === 0 ? <UsersTab /> : <DepartmentsTab />}
      </Box>
    </PageTransition>
  );
}

function UsersTab() {
  const [q, setQ] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [editing, setEditing] = useState<AdminUserDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<{ el: HTMLElement; u: AdminUserDto } | null>(null);
  const [deleting, setDeleting] = useState<AdminUserDto | null>(null);
  const [history, setHistory] = useState<AdminUserDto | null>(null);
  const [inviteLink, setInviteLink] = useState<{ email: string; url: string } | null>(null);
  const { data: departments } = useDepartmentsQuery();
  const { data, isLoading, error, refetch } = useAdminUsersQuery({ q: q || undefined, departmentId: departmentId || undefined, role: role || undefined, status: status || undefined, page, pageSize });
  const [update] = useUpdateUserMutation();
  const [invite] = useInviteUserMutation();
  const [del, delState] = useDeleteUserMutation();
  const toast = useToast();
  const { user: me } = useAuth();

  const columns = useMemo<Column<AdminUserDto>[]>(
    () => [
      { key: 'name', header: 'Name', render: (u) => <Box><Typography variant="body2" sx={{ fontWeight: 600 }}>{u.displayName}</Typography><Typography variant="caption" color="text.secondary">{u.email}</Typography></Box>, sortValue: (u) => u.displayName },
      { key: 'dept', header: 'Department / team', render: (u) => [u.departmentName, u.teamName].filter(Boolean).join(' · ') || '–' },
      { key: 'roles', header: 'Roles', render: (u) => <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>{u.roles.map((r) => <Chip key={r} size="small" label={ROLE_LABEL[r]} color={r === 'ORG_ADMIN' || r === 'WORKPLACE_ADMIN' ? 'primary' : 'default'} variant="outlined" />)}</Stack> },
      { key: 'home', header: 'Home building', render: (u) => u.homeBuildingName ?? '–' },
      { key: 'status', header: 'Status', render: userStatus, sortValue: (u) => u.status },
      { key: 'last', header: 'Last sign-in', render: (u) => (u.lastLoginAt ? fmtRelative(u.lastLoginAt) : 'Never'), sortValue: (u) => u.lastLoginAt ?? '' },
      { key: 'a', header: 'Actions', align: 'right', render: (u) => <IconButton size="small" aria-label={`Actions for ${u.displayName}`} onClick={(e) => { e.stopPropagation(); setMenu({ el: e.currentTarget, u }); }}><MoreVertRoundedIcon fontSize="small" /></IconButton> },
    ],
    [],
  );

  const setStatusOf = async (u: AdminUserDto, s: 'ACTIVE' | 'DEACTIVATED') => {
    try {
      await update({ id: u.id, status: s }).unwrap();
      toast.success(s === 'ACTIVE' ? `${u.displayName} reactivated` : `${u.displayName} deactivated; their sessions and future bookings were cancelled`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <>
      <FilterBar actions={<Button variant="contained" startIcon={<PersonAddRoundedIcon />} onClick={() => setCreating(true)} data-testid="admin-invite-user">Add employee</Button>}>
        <TextField label="Search name or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} size="small" />
        <FormControl size="small">
          <InputLabel id="u-d">Department</InputLabel>
          <Select labelId="u-d" label="Department" value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setPage(1); }}>
            <MenuItem value="">All</MenuItem>
            {(departments ?? []).map((d) => <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small">
          <InputLabel id="u-r">Role</InputLabel>
          <Select labelId="u-r" label="Role" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
            <MenuItem value="">All</MenuItem>
            {RoleCodes.map((r) => <MenuItem key={r} value={r}>{ROLE_LABEL[r]}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small">
          <InputLabel id="u-s">Status</InputLabel>
          <Select labelId="u-s" label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <MenuItem value="">All</MenuItem>
            <MenuItem value="ACTIVE">Active</MenuItem>
            <MenuItem value="INVITED">Invited</MenuItem>
            <MenuItem value="DEACTIVATED">Deactivated</MenuItem>
          </Select>
        </FormControl>
      </FilterBar>
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <DataTable ariaLabel="Employees" data-testid="admin-users-table" rows={data?.items ?? []} columns={columns} rowKey={(u) => u.id} loading={isLoading} total={data?.total ?? 0} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} onRowClick={setEditing} emptyTitle="No employees match" dense />
      )}
      <Menu open={!!menu} anchorEl={menu?.el} onClose={() => setMenu(null)}>
        <MenuItem onClick={() => { setEditing(menu!.u); setMenu(null); }}>Edit</MenuItem>
        <MenuItem onClick={() => { setHistory(menu!.u); setMenu(null); }}>Booking history</MenuItem>
        {menu?.u.status !== 'DEACTIVATED' && menu?.u.status !== 'ACTIVE' && (
          <MenuItem
            onClick={async () => {
              const u = menu!.u;
              setMenu(null);
              try {
                const res = await invite({ id: u.id }).unwrap();
                setInviteLink({ email: u.email, url: res.inviteUrl });
              } catch (err) {
                toast.error(errorMessage(err));
              }
            }}
          >
            Resend invitation
          </MenuItem>
        )}
        {menu?.u.status === 'DEACTIVATED' ? (
          <MenuItem onClick={() => { void setStatusOf(menu!.u, 'ACTIVE'); setMenu(null); }}>Reactivate</MenuItem>
        ) : (
          <MenuItem disabled={menu?.u.id === me?.id} onClick={() => { void setStatusOf(menu!.u, 'DEACTIVATED'); setMenu(null); }}>Deactivate</MenuItem>
        )}
        <MenuItem disabled={menu?.u.id === me?.id} onClick={() => { setDeleting(menu!.u); setMenu(null); }} sx={{ color: 'error.main' }}>Delete</MenuItem>
      </Menu>
      <UserDialog open={creating || !!editing} user={editing} onClose={() => { setCreating(false); setEditing(null); }} onInvited={(email, url) => setInviteLink({ email, url })} />
      <ConfirmDialog
        open={!!deleting}
        title={`Delete ${deleting?.displayName}?`}
        description="The account is removed and future bookings are cancelled. Past booking history is kept for reporting."
        confirmLabel="Delete"
        destructive
        loading={delState.isLoading}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          try {
            await del({ id: deleting!.id }).unwrap();
            toast.success('Employee deleted');
            setDeleting(null);
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
      <Dialog open={!!inviteLink} onClose={() => setInviteLink(null)} fullWidth maxWidth="sm" aria-labelledby="invite-title">
        <DialogTitle id="invite-title">Invitation sent</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            An invitation email was sent to <strong>{inviteLink?.email}</strong> (when SMTP is not configured it is written to the API log). You can also share this link directly; it is valid for 7 days.
          </Typography>
          <TextField
            value={inviteLink?.url ?? ''}
            slotProps={{
              htmlInput: { readOnly: true, 'aria-label': 'Invitation link' },
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton aria-label="Copy link" onClick={() => { void navigator.clipboard?.writeText(inviteLink?.url ?? ''); toast.success('Link copied'); }}>
                      <ContentCopyRoundedIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
        </DialogContent>
        <DialogActions><Button onClick={() => setInviteLink(null)}>Done</Button></DialogActions>
      </Dialog>
      <HistoryDrawer user={history} onClose={() => setHistory(null)} />
    </>
  );
}

function UserDialog({ open, user, onClose, onInvited }: { open: boolean; user: AdminUserDto | null; onClose: () => void; onInvited: (email: string, url: string) => void }) {
  const { can } = useAuth();
  const canAssignAdmin = can('settings:manage');
  const { data: departments } = useDepartmentsQuery();
  const { data: buildings } = useBuildingsQuery();
  const [create, cs] = useCreateUserMutation();
  const [update, us] = useUpdateUserMutation();
  const toast = useToast();
  const [form, setForm] = useState(() => blank(user));
  const [setPassword, setSetPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Reset the form every time the dialog opens (not only when the user changes), so cancelled
  // edits don't reappear. While closing, keep showing the last user so the title doesn't flip.
  const [session, setSession] = useState<{ open: boolean; user: AdminUserDto | null }>({ open: false, user });
  if (open && (!session.open || session.user !== user)) {
    setSession({ open: true, user });
    setForm(blank(user));
    setSetPassword(false);
    setError(null);
  } else if (!open && session.open) {
    setSession({ open: false, user: session.user });
  }
  const shownUser = open ? user : session.user;
  function blank(u: AdminUserDto | null) {
    return { email: u?.email ?? '', firstName: u?.firstName ?? '', lastName: u?.lastName ?? '', jobTitle: u?.jobTitle ?? '', departmentId: u?.departmentId ?? '', teamId: u?.teamId ?? '', homeBuildingId: u?.homeBuildingId ?? '', roles: (u?.roles ?? ['EMPLOYEE']) as RoleCode[], password: '' };
  }
  const teams = (departments ?? []).find((d) => d.id === form.departmentId)?.teams ?? [];
  const busy = cs.isLoading || us.isLoading;
  const roleOptions = RoleCodes.filter((r) => canAssignAdmin || (r !== 'ORG_ADMIN' && r !== 'WORKPLACE_ADMIN') || form.roles.includes(r));
  const submit = async () => {
    setError(null);
    const body = { email: form.email.trim(), firstName: form.firstName.trim(), lastName: form.lastName.trim(), jobTitle: form.jobTitle || null, departmentId: form.departmentId || null, teamId: form.teamId || null, homeBuildingId: form.homeBuildingId || null, roles: form.roles };
    try {
      if (user) {
        await update({ id: user.id, ...body }).unwrap();
        toast.success('Employee updated');
      } else {
        const created = await create({ ...body, ...(setPassword && form.password ? { password: form.password } : {}) }).unwrap();
        toast.success(`${created.displayName} added`);
        if (created.inviteUrl) onInvited(created.email, created.inviteUrl);
      }
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby="user-dialog-title">
      <DialogTitle id="user-dialog-title">{shownUser ? `Edit ${shownUser.displayName}` : 'Add employee'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}><TextField label="First name" required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}><TextField label="Last name" required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></Grid>
            <Grid size={{ xs: 12 }}><TextField label="Work email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Grid>
            <Grid size={{ xs: 12 }}><TextField label="Job title" value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl size="small" fullWidth>
                <InputLabel id="ud-d">Department</InputLabel>
                <Select labelId="ud-d" label="Department" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value, teamId: '' })}>
                  <MenuItem value="">None</MenuItem>
                  {(departments ?? []).map((d) => <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl size="small" fullWidth disabled={!form.departmentId}>
                <InputLabel id="ud-t">Team</InputLabel>
                <Select labelId="ud-t" label="Team" value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })}>
                  <MenuItem value="">None</MenuItem>
                  {teams.map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl size="small" fullWidth>
                <InputLabel id="ud-b">Home building</InputLabel>
                <Select labelId="ud-b" label="Home building" value={form.homeBuildingId} onChange={(e) => setForm({ ...form, homeBuildingId: e.target.value })}>
                  <MenuItem value="">None</MenuItem>
                  {(buildings ?? []).map((b) => <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl size="small" fullWidth>
                <InputLabel id="ud-r">Roles</InputLabel>
                <Select labelId="ud-r" multiple value={form.roles} input={<OutlinedInput label="Roles" />} onChange={(e) => setForm({ ...form, roles: (typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value) as RoleCode[] })} renderValue={(s) => (s as RoleCode[]).map((r) => ROLE_LABEL[r]).join(', ')}>
                  {roleOptions.map((r) => (
                    <MenuItem key={r} value={r} disabled={!canAssignAdmin && (r === 'ORG_ADMIN' || r === 'WORKPLACE_ADMIN')}>
                      <Checkbox size="small" checked={form.roles.includes(r)} />
                      <ListItemText primary={ROLE_LABEL[r]} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          </Grid>
          {!canAssignAdmin && <Typography variant="caption" color="text.secondary">Only organization administrators can grant administrator roles.</Typography>}
          {!shownUser && (
            <>
              <FormControlLabel control={<Switch checked={setPassword} onChange={(e) => setSetPassword(e.target.checked)} />} label="Set a password now instead of sending an invitation" />
              {setPassword && <TextField label="Initial password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} helperText="At least 8 characters with a letter and a number" />}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button color="inherit" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={busy || !form.email || !form.firstName || !form.lastName || form.roles.length === 0} startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}>
          {shownUser ? 'Save' : setPassword ? 'Create account' : 'Send invitation'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function HistoryDrawer({ user, onClose }: { user: AdminUserDto | null; onClose: () => void }) {
  const { can } = useAuth();
  const allowed = can('reservation:manage-any');
  const { data, isLoading } = useUserReservationsQuery({ id: user?.id ?? '', pageSize: 50, sortDir: 'desc' }, { skip: !user || !allowed });
  return (
    <Drawer anchor="right" open={!!user} onClose={onClose} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 460 } } } }}>
      <Box sx={{ p: 2 }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h4" component="h2">Bookings · {user?.displayName}</Typography>
          <IconButton aria-label="Close" onClick={onClose}><CloseRoundedIcon /></IconButton>
        </Stack>
        {!allowed ? (
          <Alert severity="info" sx={{ mt: 2 }}>You need the reservation management permission to view booking history.</Alert>
        ) : isLoading ? (
          <CircularProgress sx={{ mt: 2 }} />
        ) : (
          <List dense>
            {(data?.items ?? []).length === 0 && <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>No bookings.</Typography>}
            {(data?.items ?? []).map((r) => (
              <ListItem key={r.id} divider secondaryAction={<StatusBadge status={r.status} />}>
                <ListItemText primary={`${r.resourceName} · ${r.buildingName}`} secondary={fmtRange(r.startAt, r.endAt, r.timezone)} />
              </ListItem>
            ))}
          </List>
        )}
      </Box>
    </Drawer>
  );
}

function DepartmentsTab() {
  const { data, isLoading, error, refetch } = useDepartmentsQuery();
  const [createDep] = useCreateDepartmentMutation();
  const [updateDep] = useUpdateDepartmentMutation();
  const [deleteDep] = useDeleteDepartmentMutation();
  const [createTeam] = useCreateTeamMutation();
  const [updateTeam] = useUpdateTeamMutation();
  const [deleteTeam] = useDeleteTeamMutation();
  const toast = useToast();
  const [newDep, setNewDep] = useState('');
  const [rename, setRename] = useState<{ kind: 'dep' | 'team'; id: string; name: string } | null>(null);
  const [newTeam, setNewTeam] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<{ kind: 'dep' | 'team'; id: string; name: string } | null>(null);
  const run = async (p: Promise<unknown>, msg: string) => {
    try {
      await p;
      toast.success(msg);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  if (isLoading) return <CardSkeleton count={3} />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} component="form" onSubmit={(e) => { e.preventDefault(); if (newDep.trim()) { void run(createDep({ name: newDep.trim() }).unwrap(), 'Department created'); setNewDep(''); } }}>
        <TextField label="New department" value={newDep} onChange={(e) => setNewDep(e.target.value)} sx={{ maxWidth: 320 }} />
        <Button type="submit" variant="contained" startIcon={<AddRoundedIcon />} disabled={!newDep.trim()}>Add</Button>
      </Stack>
      {(data ?? []).length === 0 && <EmptyState title="No departments yet" description="Create departments and teams to restrict resources and enable 'near my team' seating." />}
      <Grid container spacing={2}>
        {(data ?? []).map((d) => (
          <Grid key={d.id} size={{ xs: 12, md: 6, lg: 4 }}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <Box>
                    <Typography variant="h5" component="h3">{d.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{d.memberCount} members · {d.teams.length} teams</Typography>
                  </Box>
                  <Stack direction="row">
                    <Tooltip title="Rename"><IconButton size="small" aria-label={`Rename ${d.name}`} onClick={() => setRename({ kind: 'dep', id: d.id, name: d.name })}><EditRoundedIcon fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title="Delete"><IconButton size="small" aria-label={`Delete ${d.name}`} onClick={() => setConfirm({ kind: 'dep', id: d.id, name: d.name })}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton></Tooltip>
                  </Stack>
                </Stack>
                <List dense>
                  {d.teams.map((t) => (
                    <ListItem
                      key={t.id}
                      secondaryAction={
                        <Stack direction="row">
                          <IconButton size="small" aria-label={`Rename ${t.name}`} onClick={() => setRename({ kind: 'team', id: t.id, name: t.name })}><EditRoundedIcon fontSize="small" /></IconButton>
                          <IconButton size="small" aria-label={`Delete ${t.name}`} onClick={() => setConfirm({ kind: 'team', id: t.id, name: t.name })}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton>
                        </Stack>
                      }
                    >
                      <ListItemText primary={t.name} secondary={`${t.memberCount} members`} />
                    </ListItem>
                  ))}
                </List>
                <Stack direction="row" spacing={1} component="form" onSubmit={(e) => { e.preventDefault(); const n = (newTeam[d.id] ?? '').trim(); if (n) { void run(createTeam({ name: n, departmentId: d.id }).unwrap(), 'Team created'); setNewTeam({ ...newTeam, [d.id]: '' }); } }}>
                  <TextField label="New team" value={newTeam[d.id] ?? ''} onChange={(e) => setNewTeam({ ...newTeam, [d.id]: e.target.value })} />
                  <Button type="submit" variant="outlined" disabled={!(newTeam[d.id] ?? '').trim()}>Add</Button>
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
      <Dialog open={!!rename} onClose={() => setRename(null)} fullWidth maxWidth="xs" aria-labelledby="rename-title">
        <DialogTitle id="rename-title">Rename {rename?.kind === 'dep' ? 'department' : 'team'}</DialogTitle>
        <DialogContent>
          <TextField autoFocus label="Name" value={rename?.name ?? ''} onChange={(e) => setRename(rename ? { ...rename, name: e.target.value } : null)} sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setRename(null)}>Cancel</Button>
          <Button variant="contained" disabled={!rename?.name.trim()} onClick={() => { if (!rename) return; void run(rename.kind === 'dep' ? updateDep({ id: rename.id, name: rename.name.trim() }).unwrap() : updateTeam({ id: rename.id, name: rename.name.trim() }).unwrap(), 'Renamed'); setRename(null); }}>Save</Button>
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        open={!!confirm}
        title={`Delete ${confirm?.name}?`}
        description={confirm?.kind === 'dep' ? 'Its teams are deleted and members become unassigned.' : 'Members of this team become unassigned.'}
        confirmLabel="Delete"
        destructive
        onClose={() => setConfirm(null)}
        onConfirm={() => { if (!confirm) return; void run(confirm.kind === 'dep' ? deleteDep({ id: confirm.id }).unwrap() : deleteTeam({ id: confirm.id }).unwrap(), 'Deleted'); setConfirm(null); }}
      />
    </Stack>
  );
}
