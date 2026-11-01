import { useState } from 'react';
import { Alert, Button, Card, CardContent, Chip, FormControl, Grid, IconButton, InputLabel, MenuItem, Select, Stack, TextField, Typography, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import { NotificationTypes, type AnnouncementDto } from '@spaceflow/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { PageTransition } from '@/components/common/Motion';
import { CardSkeleton, ErrorState } from '@/components/common/Feedback';
import { EmptyState } from '@/components/common/EmptyState';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useAdminAnnouncementsQuery, useBuildingsQuery, useCreateAnnouncementMutation, useDeleteAnnouncementMutation } from '@/services/endpoints';
import { errorMessage } from '@/services/api';
import { useToast } from '@/components/common/ToastProvider';
import { dayjs, fmtDate, fmtRelative } from '@/utils/time';

const TYPE_HELP: Record<(typeof NotificationTypes)[number], string> = {
  BOOKING_CONFIRMED: 'Sent when a reservation is created (also by email when enabled).',
  BOOKING_CANCELLED: 'Sent to the owner when a booking is cancelled by them, an admin or a resource change.',
  BOOKING_MODIFIED: 'Sent when time, resource or attendees change.',
  BOOKING_REMINDER: 'Sent about 60 minutes before a booking starts (background job).',
  CHECKIN_REMINDER: 'Sent when a booking that requires check-in starts and auto-release is off.',
  NO_SHOW_WARNING: 'Sent at start time when auto-release is on; explains the release deadline.',
  BOOKING_RELEASED: 'Sent when a booking is released for missing the check-in grace period.',
  APPROVAL_REQUESTED: 'Sent to approvers when a restricted resource is requested.',
  APPROVAL_DECIDED: 'Sent to the requester once approved or rejected.',
  RESOURCE_MAINTENANCE: 'Sent when a resource with upcoming bookings is disabled or scheduled for maintenance.',
  ANNOUNCEMENT: 'Office announcements published here appear on the dashboard.',
};

export function AdminNotificationsPage() {
  const { data, isLoading, error, refetch } = useAdminAnnouncementsQuery();
  const { data: buildings } = useBuildingsQuery();
  const [create, { isLoading: creating }] = useCreateAnnouncementMutation();
  const [remove] = useDeleteAnnouncementMutation();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [buildingId, setBuildingId] = useState('');
  const [expiresAt, setExpiresAt] = useState<ReturnType<typeof dayjs> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<AnnouncementDto | null>(null);

  return (
    <PageTransition>
      <PageHeader title="Notifications" subtitle="Publish office announcements and review which in-app notifications the platform sends." crumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Notifications' }]} />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 5 }}>
          <Card>
            <CardContent>
              <Typography variant="h4" gutterBottom>
                New announcement
              </Typography>
              <Stack spacing={1.5}>
                {err && <Alert severity="error">{err}</Alert>}
                <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} slotProps={{ htmlInput: { maxLength: 120 } }} />
                <TextField label="Message" value={body} onChange={(e) => setBody(e.target.value)} multiline minRows={3} slotProps={{ htmlInput: { maxLength: 2000 } }} />
                <FormControl size="small">
                  <InputLabel id="ann-b">Audience</InputLabel>
                  <Select labelId="ann-b" label="Audience" value={buildingId} onChange={(e) => setBuildingId(e.target.value)}>
                    <MenuItem value="">Everyone</MenuItem>
                    {(buildings ?? []).map((b) => (
                      <MenuItem key={b.id} value={b.id}>{b.name} only</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <DateTimePicker label="Expires (optional)" value={expiresAt} onChange={(v) => { if (!v || v.isValid()) setExpiresAt(v); }} slotProps={{ textField: { size: 'small' } }} />
                <Button variant="contained" disabled={creating || !title.trim() || !body.trim()} onClick={async () => { setErr(null); try { await create({ title: title.trim(), body: body.trim(), buildingId: buildingId || null, expiresAt: expiresAt ? expiresAt.toISOString() : null }).unwrap(); toast.success('Announcement published'); setTitle(''); setBody(''); setExpiresAt(null); } catch (e) { setErr(errorMessage(e)); } }}>
                  Publish
                </Button>
              </Stack>
            </CardContent>
          </Card>
          <Card sx={{ mt: 2 }}>
            <CardContent>
              <Typography variant="h4" gutterBottom>
                Automatic notifications
              </Typography>
              <Stack spacing={1}>
                {NotificationTypes.map((t) => (
                  <Stack key={t} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                    <Chip size="small" label={t.replace(/_/g, ' ').toLowerCase()} sx={{ textTransform: 'capitalize', minWidth: 150, justifyContent: 'flex-start' }} />
                    <Typography variant="caption" color="text.secondary">
                      {TYPE_HELP[t]}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card>
            <CardContent>
              <Typography variant="h4" gutterBottom>
                Published announcements
              </Typography>
              {isLoading ? (
                <CardSkeleton />
              ) : error ? (
                <ErrorState error={error} onRetry={refetch} />
              ) : !data?.length ? (
                <EmptyState compact title="No announcements yet" description="Announcements appear on every employee's dashboard." />
              ) : (
                <Table size="small" aria-label="Announcements">
                  <TableHead>
                    <TableRow>
                      <TableCell>Title</TableCell>
                      <TableCell>Audience</TableCell>
                      <TableCell>Published</TableCell>
                      <TableCell>Expires</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>{a.title}</Typography>
                          <Typography variant="caption" color="text.secondary">{a.body.slice(0, 120)}{a.body.length > 120 ? '…' : ''}</Typography>
                        </TableCell>
                        <TableCell>{a.buildingId ? buildings?.find((b) => b.id === a.buildingId)?.name ?? 'Building' : 'Everyone'}</TableCell>
                        <TableCell>{fmtRelative(a.publishedAt)}</TableCell>
                        <TableCell>{a.expiresAt ? fmtDate(a.expiresAt) : '—'}</TableCell>
                        <TableCell align="right">
                          <IconButton aria-label={`Delete ${a.title}`} onClick={() => setToDelete(a)}>
                            <DeleteOutlineRoundedIcon />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      <ConfirmDialog open={!!toDelete} title="Delete announcement?" description={toDelete?.title} destructive confirmLabel="Delete" onClose={() => setToDelete(null)} onConfirm={async () => { if (!toDelete) return; try { await remove({ id: toDelete.id }).unwrap(); toast.success('Announcement deleted'); } catch (e) { toast.error(errorMessage(e)); } setToDelete(null); }} />
    </PageTransition>
  );
}
